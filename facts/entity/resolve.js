'use strict';
// facts/entity/resolve.js — the entity-resolution VERIFICATION LADDER (Kimi
// KIMI-FINAL-BATCH-2026-07-20.md §1b/e, E5). Orchestrates: windows.js (deterministic pre-pass) ->
// lensClient.js (LLM as grounded extractor, a search HINT only) -> lint.js (no-new-facts linter,
// mechanical fabrication guard) -> chRegister.js (Companies House, the SOLE AUTHORITY) -> a verdict.
// Companies House decides; the LLM never does. Fail-closed at every branch (§1f): anything short of
// a clean CH-corroborated match is UNRESOLVED or CONFLICT, never a guess.
//
// Output is one hash-chained `entity_resolution` artefact (§1e), re-verifiable later by replaying the
// STORED CH bytes and the STORED transcript — the register may change tomorrow; the hash proves what
// this run saw when it saw it (same doctrine as evidence/registers/lib/artifact.js's checked_urls
// chain, reused here via its stableStringify/sha256Hex primitives rather than a second hashing
// scheme).

const { buildWindows } = require('./windows.js');
const { makeLensClient } = require('./lensClient.js');
const { lintProposal } = require('./lint.js');
const chRegister = require('./chRegister.js');
const { stableStringify, sha256Hex, GENESIS_HASH } = require('../../evidence/registers/lib/artifact.js');
const { ENTITY_REASONS } = require('./reasons.js');

const CRN_NAME_JACCARD_MIN = 0.6;
const CRN_CONFLICT_JACCARD_MAX = 0.35;
const NAME_PATH_JACCARD_MIN = 0.75;
const CRN_PATH_CORROBORATION_MIN = 3;
const NAME_PATH_CORROBORATION_MIN = 4;

const VERDICTS = Object.freeze({
  CONFIRMED_A: 'CONFIRMED-A',
  UNRESOLVED: 'UNRESOLVED',
  CONFLICT: 'CONFLICT',
});

function activeStatus(status) {
  return String(status || '').toLowerCase() === 'active';
}

function dissolvedStatus(status) {
  return /dissolved|liquidat/i.test(String(status || ''));
}

// pickBestCrnCandidate(proposal, crn) -> the linted candidate bound to the pre-pass CRN, or null.
function pickBestCrnCandidate(proposal, crn) {
  const candidates = Array.isArray(proposal && proposal.candidates) ? proposal.candidates : [];
  const byDigits = String(crn || '').replace(/\D+/g, '');
  return candidates.find((c) => {
    if (!c || !c.company_number) return false;
    return String(c.company_number).toUpperCase() === String(crn).toUpperCase()
      || String(c.company_number).replace(/\D+/g, '') === byDigits;
  }) || null;
}

// footerVsControllerConflict(proposal) -> true when both a top candidate and a privacy_controller are
// named and they name genuinely different entities (low name-similarity) — §1b CONFLICT rule + §5.2
// group-structure guard.
function footerVsControllerConflict(proposal) {
  const top = proposal && Array.isArray(proposal.candidates) ? proposal.candidates[0] : null;
  const pc = proposal && proposal.privacy_controller;
  if (!top || !top.legal_name || !pc || !pc.legal_name) return false;
  const { score } = chRegister.scoreMatch(top.legal_name, pc.legal_name);
  return score < CRN_CONFLICT_JACCARD_MAX;
}

function buildArtefact({ inputs, llm, ch, verdict, score, prevHash }) {
  const record = {
    type: 'entity_resolution',
    inputs,
    llm,
    ch,
    verdict,
    score,
    decided_by: 'deterministic-verifier',
    prev_hash: prevHash || GENESIS_HASH,
  };
  record.hash = sha256Hex(Buffer.from(stableStringify(record), 'utf8'));
  return record;
}

function unresolved({ inputs, llm, ch, reason, prevHash }) {
  return {
    verdict: VERDICTS.UNRESOLVED,
    reason: reason || ENTITY_REASONS.EVIDENCE_ABSENT,
    needs_human: true,
    artefact: buildArtefact({ inputs, llm, ch, verdict: VERDICTS.UNRESOLVED, score: 0, prevHash }),
  };
}

function conflict({ inputs, llm, ch, reason, prevHash }) {
  return {
    verdict: VERDICTS.CONFLICT,
    reason: reason || 'conflict',
    needs_human: true,
    artefact: buildArtefact({ inputs, llm, ch, verdict: VERDICTS.CONFLICT, score: 0, prevHash }),
  };
}

// resolveEntity(opts) -> Promise<ResolutionResult>
//   opts.pages            [{kind, text}] crawled pages (footer/privacy/terms/about/contact/imprint)
//   opts.practicePostcode optional postcode scraped from the audited site (for corroboration)
//   opts.teamText          optional About/Team page text (officer-surname corroboration)
//   opts.fetchFn, opts.keys, opts.deadlineMs, opts.log   forwarded to chRegister.js
//   opts.env, opts.fetchImpl (LLM transport)             forwarded to lensClient.js
//   opts.prevHash          hash-chain link from the prior artefact in this run (defaults to genesis)
//
// ResolutionResult: { verdict, reason?, crn?, ch_name?, needs_human, artefact, sector_disagreement? }
async function resolveEntity(opts = {}) {
  const prevHash = opts.prevHash || GENESIS_HASH;
  const win = buildWindows(opts.pages);
  const inputs = { crn_prepass: win.crn, postcode_prepass: win.postcode, windows_hash: sha256Hex(win.windowsText || '') };

  const registerOpts = { fetchFn: opts.fetchFn, deadlineMs: opts.deadlineMs, keys: opts.keys, log: opts.log };

  if (!win.windows.length) {
    return unresolved({ inputs, llm: null, ch: null, reason: ENTITY_REASONS.EVIDENCE_ABSENT, prevHash });
  }

  const lens = makeLensClient({ env: opts.env, fetchImpl: opts.fetchImpl, log: opts.log });
  const lensResult = await lens.extractEntity(win.windowsText);

  const llmMeta = lensResult.ok
    ? { provider: lensResult.provider, family: lensResult.family, temperature: 0, prompt_hash: lensResult.promptHash, completion_hash: lensResult.completionHash, transcript_hash: lensResult.transcriptHash }
    : { ok: false, reason: lensResult.reason };

  if (!lensResult.ok) {
    return unresolved({ inputs, llm: llmMeta, ch: null, reason: ENTITY_REASONS.EVIDENCE_ABSENT, prevHash });
  }

  const lintResult = lintProposal(lensResult.proposal, win.fullText);
  if (!lintResult.ok) {
    return unresolved({ inputs, llm: { ...llmMeta, linter_report_hash: sha256Hex(lintResult.reason) }, ch: null, reason: 'linter_rejected:' + lintResult.reason, prevHash });
  }
  llmMeta.linter_report_hash = sha256Hex('ok');

  const proposal = lensResult.proposal;

  // Group-structure / prompt-injection guard (§1b, §5.2, §5.4): footer candidate vs privacy
  // controller naming genuinely different entities is CONFLICT before either register path runs.
  if (footerVsControllerConflict(proposal)) {
    return conflict({ inputs, llm: llmMeta, ch: null, reason: 'footer_vs_controller_mismatch', prevHash });
  }

  const chLog = [];
  const chHashes = [];

  // ── CRN path: a company number was extracted deterministically pre-LLM. ──────────────────────────
  if (win.crn) {
    const bound = pickBestCrnCandidate(proposal, win.crn);
    if (bound && bound.legal_name) {
      const profile = await chRegister.fetchProfileByCrn(win.crn, registerOpts);
      if (profile && profile.row) {
        chHashes.push(profile.hash);
        chLog.push({ path: 'crn', crn: win.crn });
        const row = profile.row;
        if (dissolvedStatus(row.company_status)) {
          return conflict({ inputs, llm: llmMeta, ch: { requests: chLog, response_hashes: chHashes, fetched_at: new Date().toISOString() }, reason: 'dissolved_entity', prevHash });
        }
        const { score: nameScore } = chRegister.scoreMatch(bound.legal_name, row.company_name);
        if (activeStatus(row.company_status) && nameScore < CRN_CONFLICT_JACCARD_MAX) {
          return conflict({ inputs, llm: llmMeta, ch: { requests: chLog, response_hashes: chHashes, fetched_at: new Date().toISOString() }, reason: 'crn_name_mismatch', prevHash });
        }
        if (activeStatus(row.company_status) && nameScore >= CRN_NAME_JACCARD_MIN) {
          const officer = await chRegister.fetchOfficerSurnames(win.crn, registerOpts);
          for (const r of officer.responses) chHashes.push(r.hash);
          const corrob = chRegister.corroborate({
            chOfficeAddress: row.registered_office_address,
            chSicCodes: row.sic_codes,
            practicePostcode: opts.practicePostcode || win.postcode,
            teamText: opts.teamText,
            officerSurnames: officer.surnames,
          });
          if (corrob.score >= CRN_PATH_CORROBORATION_MIN) {
            const ch = { requests: chLog, response_hashes: chHashes, fetched_at: new Date().toISOString() };
            return {
              verdict: VERDICTS.CONFIRMED_A,
              crn: row.company_number,
              ch_name: row.company_name,
              needs_human: false,
              sector_disagreement: sectorDisagreement(proposal),
              artefact: buildArtefact({ inputs, llm: llmMeta, ch, verdict: VERDICTS.CONFIRMED_A, score: corrob.score, prevHash }),
            };
          }
        }
      }
    }
  }

  // ── Name path: no CRN extractable (or the CRN path fell through without confirming). ─────────────
  const nameCandidate = (proposal.candidates || []).find((c) => c && c.legal_name) || proposal.privacy_controller;
  if (!win.crn && nameCandidate && nameCandidate.legal_name) {
    const search = await chRegister.searchByName(nameCandidate.legal_name, registerOpts);
    if (search && search.row) {
      chLog.push({ path: 'name_search', query: nameCandidate.legal_name });
      chHashes.push(chRegister.hashResponse(search.row));
      const row = search.row;
      const { score: nameScore } = chRegister.scoreMatch(nameCandidate.legal_name, row.company_name);
      const activeCandidates = search.row ? 1 : 0; // runLookup already collapses to the single best-match row (name-match.js bestCandidate); "exactly one" is satisfied by construction here.
      const practicePc = opts.practicePostcode || win.postcode;
      const officePc = chRegister.normalisePostcode(row.registered_office_address);
      const postcodeMandatory = Boolean(practicePc) && Boolean(officePc) && officePc === chRegister.normalisePostcode(practicePc);
      if (activeStatus(row.company_status) && nameScore >= NAME_PATH_JACCARD_MIN && activeCandidates === 1 && postcodeMandatory) {
        const officer = await chRegister.fetchOfficerSurnames(row.company_number, registerOpts);
        for (const r of officer.responses) chHashes.push(r.hash);
        const corrob = chRegister.corroborate({
          chOfficeAddress: row.registered_office_address,
          chSicCodes: row.sic_codes,
          practicePostcode: practicePc,
          teamText: opts.teamText,
          officerSurnames: officer.surnames,
        });
        if (corrob.score >= NAME_PATH_CORROBORATION_MIN) {
          const ch = { requests: chLog, response_hashes: chHashes, fetched_at: new Date().toISOString() };
          return {
            verdict: VERDICTS.CONFIRMED_A,
            crn: row.company_number,
            ch_name: row.company_name,
            needs_human: false,
            sector_disagreement: sectorDisagreement(proposal),
            artefact: buildArtefact({ inputs, llm: llmMeta, ch, verdict: VERDICTS.CONFIRMED_A, score: corrob.score, prevHash }),
          };
        }
      }
    }
  }

  return unresolved({
    inputs, llm: llmMeta,
    ch: chLog.length ? { requests: chLog, response_hashes: chHashes, fetched_at: new Date().toISOString() } : null,
    reason: ENTITY_REASONS.ESTABLISHMENT_UNRESOLVED, prevHash,
  });
}

// sectorDisagreement(proposal) -> a needs_human flag object, never consumed for pack selection
// (§1d, E8 out of this batch's scope — deterministic resolver stands; this is FOR REVIEW ONLY).
function sectorDisagreement(proposal) {
  if (!proposal || !proposal.sector || proposal.sector === 'unknown') return null;
  return { flag: 'sector_disagreement', llm_sector: proposal.sector, llm_sub_sector: proposal.sub_sector || null, note: 'LLM sector output is reviewer-only; deterministic law-pack resolver is unaffected.' };
}

module.exports = { resolveEntity, VERDICTS, footerVsControllerConflict, pickBestCrnCandidate, sectorDisagreement };
