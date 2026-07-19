#!/usr/bin/env node
'use strict';
/**
 * eval/e2e/run-real-proof.js - THE real-model reproduction proof driver (docs/P3-TAIL-ACCEPTANCE.md,
 * U1). It runs the ENGINE'S OWN breach lane end to end - fixture bundle -> propose -> verify ->
 * (catalogue-faithful enrich) -> adjudicate - with a REAL llmCall (eval/e2e/lib/real-llm.js) and the
 * REAL Gate-3 entailment path, over the 5 known_breach reference entries (and, with headroom, 3 clean
 * matrix firms), then judges each firm against its hand-verified expectation.
 *
 * NOTHING IS BYPASSED AND NO PROMPT IS ALTERED. This driver only COMPOSES the real modules and injects
 * the real caller; every structural gate runs inside those modules unchanged:
 *   Gate 1 (retrieval)      llm/gate.js, applied by real-llm.js as the router validate on the NLI call
 *   Gate 2 (quote re-match)  breach/verifiers/quote-match.js (verify stage) + llm/gate.js at NLI
 *   Gate 3 (NLI entailment)  llm/entailment.js, called by breach/adjudicator on a `breach` verdict
 *   Gate 4 (abstain floor)   breach/adjudicator/verdict.js (default is needs_review)
 *   (Gate 5, the diverse-jury quorum, is llm/router.js quorum() - NOT invoked by the adjudicator's
 *    single-llmCall design in the live code; see the honest note in the report. route() is used, per the
 *    adjudicator's own {ok,out:{verdicts}} contract.)
 *
 * THE ONE STEP THE HARNESS PIPELINE OMITS, ADDED HERE FAITHFULLY: the mint joins each verified
 * candidate with its catalogue record to form the finding the adjudicator rules on - the OBLIGATION
 * text (the Gate-3 hypothesis), the law NAME and CITATION (Rule 2: catalogue-only), and it lifts the
 * verified quote to evidence_quote. eval/e2e/lib/pipeline.js passes BARE propose.js candidates (no
 * description), so its Gate-3 hypothesis is empty and every text candidate abstains before the model is
 * called. This driver enriches from the compiled catalogue ONLY (never fabricates a fact), mirroring the
 * mint, so the real model is actually asked. This enrichment is proven correct by the repo's own
 * eval/e2e/lib/scripted-llm.test.js CONTRACT test (an enriched candidate + a breach verdict -> violation).
 *
 * HONESTY (U1-B5): this driver NEVER weakens a gate, floor, threshold or prompt to force a pass. If no
 * candidate reaches violation it reports, per candidate, the deciding stage/gate and the verbatim model
 * verdict, and exits with a non-zero code. A reproduced known_breach is a real end-to-end result; a
 * contradicted known_non_breach is a hard failure.
 *
 * Usage:
 *   RUN_REAL_LLM=1 GROQ_API_KEY=... [GEMINI_API_KEY=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... NIM_API_KEY=...] \
 *     node eval/e2e/run-real-proof.js [--clean] [--json] [--no-preflight] [--domain <d>]
 *   node eval/e2e/run-real-proof.js --dry            # structural dry run, no network, no keys needed
 *
 * Exit codes: 0 = at least one known_breach reproduced AND zero known_non_breach contradictions.
 *             1 = zero reproduced, or any contradiction (the honest "not proven / regressed" signal).
 *             2 = usage/data error (bad arg, missing fixture, catalogue not compiled).
 */

const fs = require('fs');
const path = require('path');

const { propose } = require('../../breach/proposers/propose.js');
const { verifyAll } = require('../../breach/verifiers/index.js');
const { adjudicate } = require('../../breach/adjudicator/adjudicate.js');
const { atomicClaimFor, bridgeTextFor } = require('../../breach/adjudicator/claim.js'); // the ONE Gate-3 hypothesis + bridge-premise door (P3-tail Wave-2 FINAL UNIT iterations 1 + 2)
const coverageContract = require('../../evidence/crawler/coverage-contract.js');
const { loadCatalogueRecords } = require('./lib/catalogue-records.js');
const { judgeFirm } = require('./lib/judge.js');
const { loadReferenceSet, findFirm } = require('../reference-set/verify.js');
const realLlm = require('./lib/real-llm.js');

const REF_FIXTURES = path.join(__dirname, '..', 'reference-set', 'fixtures');
const SYNTHETIC_FIXTURE = path.join(__dirname, 'fixtures', 'synthetic-quote-breach.json');
const REF_SET = path.join(__dirname, '..', 'reference-set', 'reference-set.json');

const KNOWN_BREACH_FIRMS = ['neuclinic.co.uk', 'roxanaaesthetics.com', 'lomond.co.uk', 'dutchanddutch.com'];
const CLEAN_FIRMS = ['russell-cooke.co.uk', 'pallmallmedical.co.uk', 'medcare.ae'];

// ── fixture + expectation loading ────────────────────────────────────────────────────────────────────
function assertSafeDomain(domain) {
  if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(String(domain))) throw new Error('unsafe domain component: ' + JSON.stringify(domain));
}
function loadReferenceFirm(domain, refSet) {
  assertSafeDomain(domain);
  const p = path.join(REF_FIXTURES, domain + '.json');
  if (!fs.existsSync(p)) return { domain, error: 'no fixture on disk at ' + p };
  const bundle = JSON.parse(fs.readFileSync(p, 'utf8'));
  const firm = findFirm(refSet, domain);
  if (!firm) return { domain, error: 'domain not in reference-set.json' };
  return { domain, role: firm.role || 'reference', bundle, expected: firm.expected || {}, firmEntry: firm };
}
function loadSyntheticFirm() {
  const fx = JSON.parse(fs.readFileSync(SYNTHETIC_FIXTURE, 'utf8'));
  return { domain: fx.domain, role: fx.role || 'synthetic', bundle: fx.bundle, expected: fx.expected || {}, firmEntry: { domain: fx.domain, role: fx.role, expected: fx.expected } };
}

// ── catalogue enrichment (Rule 2: facts from the catalogue ONLY; never fabricated) ───────────────────
function recordIndex(records) {
  const m = new Map();
  for (const r of records) if (r && r.id) m.set(r.id, r);
  return m;
}
// dutyText(record, dutyIdx): the obligation prose for one duty - the ADJUDICATION-PROMPT obligation
// (briefOf reads it as `description`), NOT the Gate-3 hypothesis (that is `atomic_claim`, below). Reads
// the catalogue's website_obligations[dutyIdx].duty; falls back to the record name. Never invents text.
function dutyText(record, dutyIdx) {
  const obs = record && Array.isArray(record.website_obligations) ? record.website_obligations : [];
  const idx = Number.isInteger(dutyIdx) ? dutyIdx : 0;
  const duty = obs[idx] && obs[idx].duty;
  if (typeof duty === 'string' && duty) return duty;
  return record && record.name ? String(record.name) : '';
}
function citationText(record) {
  const c = record && record.citation;
  if (!c) return '';
  return String(c.section || c.act || c.url || '');
}
// enrichCandidate(candidate, record): the finding the adjudicator rules on. Mirrors eval/e2e/lib/
// pipeline.js's joinCatalogueFacts EXACTLY (Rule 2, catalogue-only fields; the mint and this driver
// build IDENTICAL findings). Adds description (the obligation, for briefOf's adjudication prompt),
// framework + statutory_citation, lifts the verified quote to evidence_quote (the Gate-2 span that
// feeds Gate 3 as the premise), and stamps atomic_claim - the Gate-3 (Rule 12 gate 3) NLI HYPOTHESIS -
// via the ONE shared door breach/adjudicator/claim.js atomicClaimFor (P3-tail Wave-2 FINAL UNIT). For a
// presence-breach that door returns the affirmative breach claim the verbatim quote ENTAILS (not the
// prohibition duty an offending quote CONTRADICTS - the U1 real-model blocker this closes); for every
// other kind it returns the duty, so atomic_claim equals description. It ALSO stamps `bridge` (FINAL
// UNIT iteration 2) - the Gate-3 SECOND premise, the record's OWN verbatim duty text (which lists the
// rule's indirect-reference examples, e.g. 'wrinkle-relaxing injections'), so the NLI can resolve an
// INDIRECT offending quote it could not bridge on its own (the iteration-1 `neutral` residual). The
// bridge is stamped from the FULL catalogue record via the same one door (bridgeTextFor), mirroring how
// adjudicate.js's claimFor attaches claim.bridge, so this driver and the engine path build IDENTICAL
// entailment premises; '' for non-presence kinds (their hypothesis IS the duty, so a duty bridge would
// be a trivial self-entailment). Everything else on the candidate passes through untouched.
function enrichCandidate(candidate, record) {
  const art = candidate.artifact || {};
  const quote = art.type === 'quote' ? String(art.quote != null ? art.quote : (art.text != null ? art.text : '')) : '';
  const bridge = bridgeTextFor(record, candidate);
  return Object.assign({}, candidate, {
    description: dutyText(record, candidate.duty_idx),
    framework: record ? String(record.name || '') : '',
    statutory_citation: citationText(record),
    evidence_quote: quote || undefined,
    evidence_source_id: candidate.page_url || undefined,
    checked_urls: candidate.page_url ? [candidate.page_url] : undefined,
    atomic_claim: atomicClaimFor(record, candidate),
    bridge: bridge || undefined,
  });
}

// ── the composition (mirrors eval/e2e/lib/pipeline.js's stage order; enrich added between verify+adjudicate) ──
function nonSuppressed(cands) { return cands.filter((c) => !c.suppressed_reason && c.artifact); }
function suppressionReasons(cands) {
  const m = {};
  for (const c of cands) if (c.suppressed_reason) { const key = String(c.suppressed_reason).slice(0, 70); m[key] = (m[key] || 0) + 1; }
  return m;
}

async function composeFirm(firm, records, recIdx, llmCall) {
  const bundle = firm.bundle;
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const perRule = coverageContract.coverageFor(records, pages, {});
  const proposed = propose(bundle, records, perRule);
  const real = nonSuppressed(proposed);
  const verifyRes = verifyAll(real, bundle);
  const verifiedCandidates = verifyRes.verified.map((e) => e.candidate);
  const enriched = verifiedCandidates.map((c) => enrichCandidate(c, recIdx.get(c.record_id) || null));
  let findings = [];
  let report = { text_derived: 0, ran: false };
  if (enriched.length > 0) {
    const res = await adjudicate(enriched, bundle, { llmCall: llmCall || undefined, deadlineMs: 120000 });
    findings = res.findings;
    report = res.report;
  }
  return {
    domain: firm.domain,
    proposedTotal: proposed.length,
    suppressedCount: proposed.length - real.length,
    suppressionReasons: suppressionReasons(proposed),
    real,
    verified: verifiedCandidates,
    rejected: verifyRes.rejected,
    enriched,
    findings,
    report,
    payload: { meta: { domain: firm.domain, sector: null }, findings },
  };
}

// ── per-candidate attribution: rule id, artifact kind, verdict, deciding gate ─────────────────────────
function findingRow(f) {
  const decided = decidingGate(f);
  return { rule_id: f.record_id || f.rule_id || '?', artifact: (f.artifact && f.artifact.type) || '?', verdict: f.state || '?', gate: decided };
}
// decidingGate(finding): the honest attribution of WHERE the finding's state was decided.
function decidingGate(f) {
  const adj = f.adjudication;
  if (adj === 'observed_fact') return 'evidence-kind(bypass)->violation';
  if (adj === 'kind_rejected') return 'evidence-kind(rejected)->needs_review';
  if (adj === 'nli_demoted') return 'gate3(entailment: ' + String(f.adjudication_reason || 'nli').replace(/^nli:/, '') + ')->needs_review';
  if (adj === 'unadjudicated') return 'gate4(abstain: no model verdict)->needs_review';
  if (adj === 'breach') return 'gate3(entailment ok)->violation';
  if (adj === 'no_breach') return 'verdict(no_breach+disproof)->pass';
  if (adj === 'insufficient') return 'verdict(insufficient)->needs_review';
  if (adj === 'unparseable') return 'verdict(unparseable)->needs_review';
  return 'adjudicated:' + String(adj || 'unknown');
}

// ── recording assembly (recorded-llm.v1) - keyed OUT-OF-BAND on the candidate refs the adjudicator ────
// attaches to each request (P3-tail Wave-2 Builder B, C-211/C-222). The adjudicate request carries
// request.candidates = [{id, record_id, artifact}] (prompt.js candidateRefsFor) and the entailment
// request carries request.candidate = {record_id, artifact} (adjudicate.js claimFor -> entailment.js
// callModel). The recorder keys on the SAME (record_id, artifact) basis eval/e2e/lib/replay-llm.js reads
// (its candidateKey), via the SAME shared derivation (record-key.js's recordingKey/artifactFingerprint,
// re-exported by real-llm.js). No content-matching from the prompt text is needed any longer.
function candKey(kind, ref) {
  return realLlm.recordingKey(kind, ref && ref.record_id != null ? ref.record_id : '', realLlm.artifactFingerprint(ref && ref.artifact));
}
// entailmentEntryFor(event): one recording entry for a gate-3 NLI call, keyed on request.candidate.
function entailmentEntryFor(event) {
  const cand = event.request && event.request.candidate;
  if (!cand || cand.record_id == null) return null;
  return {
    key: candKey('entailment', cand),
    kind: 'entailment', raw: String(event.raw == null ? '' : event.raw),
    meta: { provider: event.provider || '', model: event.model || '' },
  };
}
// verdictsById(raw): the batch response's verdicts array indexed by its per-batch `id`, so each
// candidate ref can be paired with ITS OWN verdict (never the first one - replay-llm.js's
// verdictFromParsedRaw reads a single-verdict raw per candidate, so a batch of >1 must be split here).
function verdictsById(raw) {
  const parsed = realLlm.parseModelJson(String(raw == null ? '' : raw));
  const list = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  const m = new Map();
  for (const v of list) { const id = Number(v && v.id); if (Number.isInteger(id) && !m.has(id)) m.set(id, v); }
  return m;
}
// adjudicateEntriesFor(event): one recording entry PER candidate ref in the batch, each keyed on its own
// (record_id, artifact) and carrying ITS OWN verdict as the raw (matched by the per-batch id), so a
// replay serves the right verdict to each candidate regardless of batch size or later re-batching.
function adjudicateEntriesFor(event) {
  const refs = Array.isArray(event.request && event.request.candidates) ? event.request.candidates : [];
  if (!refs.length) return [];
  const byId = verdictsById(event.raw);
  const out = [];
  for (const ref of refs) {
    if (ref.record_id == null) continue;
    const verdict = byId.get(Number(ref.id));
    if (verdict === undefined) continue; // no verdict for this candidate in the batch -> record nothing.
    out.push({
      key: candKey('adjudicate', ref),
      kind: 'adjudicate', raw: JSON.stringify(verdict), // this candidate's OWN verdict object.
      meta: { provider: event.provider || '', model: event.model || '' },
    });
  }
  return out;
}
// buildResponses(callEvents): the responses[] for one firm's recording, deduped by key (last write wins).
// Only ok calls are recorded.
function buildResponses(callEvents) {
  const byKey = new Map();
  for (const ev of callEvents) {
    if (!ev.ok) continue;
    if (ev.kind === 'entailment') { const e = entailmentEntryFor(ev); if (e) byKey.set(e.key, e); }
    else if (ev.kind === 'adjudicate') { for (const e of adjudicateEntriesFor(ev)) byKey.set(e.key, e); }
  }
  return [...byKey.values()];
}

// ── reporting ─────────────────────────────────────────────────────────────────────────────────────────
function fmtReasons(reasons) {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, n]) => '      ' + n + 'x ' + r).join('\n');
}
function printFirmHuman(firm, composed, judged) {
  const out = [];
  out.push('');
  out.push('=== ' + firm.domain + ' (' + (firm.role || '?') + ') ===');
  out.push('  propose: ' + composed.proposedTotal + ' candidates, ' + composed.suppressedCount + ' suppressed, ' + composed.real.length + ' with a real artifact');
  if (composed.real.length === 0 && composed.suppressedCount > 0) {
    out.push('    top suppression reasons:');
    out.push(fmtReasons(composed.suppressionReasons));
  }
  out.push('  verify: ' + composed.verified.length + ' verified, ' + composed.rejected.length + ' rejected');
  out.push('  adjudicate: ' + composed.findings.length + ' findings (text_derived=' + (composed.report.text_derived || 0) + ', llm_available=' + (composed.report.llm_available === true) + ')');
  if (composed.findings.length) {
    out.push('    per-candidate: rule_id | artifact | verdict | deciding gate');
    for (const f of composed.findings) {
      const r = findingRow(f);
      out.push('      ' + r.rule_id + ' | ' + r.artifact + ' | ' + r.verdict + ' | ' + r.gate);
    }
  }
  const kb = judged.knownBreaches.map((k) => k.id + '=' + k.status).join(', ') || '(none)';
  const knb = judged.knownNonBreaches.map((k) => k.id + '=' + k.status).join(', ') || '(none)';
  out.push('  known_breaches:      ' + kb);
  out.push('  known_non_breaches:  ' + knb + (judged.contradiction ? '   *** CONTRADICTION ***' : ''));
  return out.join('\n');
}
function printPreflightHuman(rows) {
  const out = ['', '=== provider preflight (liveness, C-135) ==='];
  if (!rows || rows.length === 0) { out.push('  (preflight skipped)'); return out.join('\n'); }
  for (const r of rows) out.push('  ' + (r.ok ? 'LIVE ' : 'DEAD ') + r.provider + ' :: ' + r.model + '  (' + r.ms + 'ms)' + (r.error ? '  error=' + r.error : ''));
  return out.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { json: false, clean: false, dry: false, preflight: true, domain: null, all: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--clean') opts.clean = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--no-preflight') opts.preflight = false;
    else if (a === '--domain') opts.domain = args[++i];
    else { console.error('Unknown argument: ' + a); return { exitCode: 2 }; }
  }
  return { opts };
}

// allReferenceFirms(refSet): every reference-set firm that has a fixture on disk (a fixtureless firm is
// SKIPPED with a note, never a fatal error - the multi-sector --all run must not abort on one stub firm).
function allReferenceFirms(refSet) {
  const out = [];
  for (const f of (refSet.firms || [])) {
    const loaded = loadReferenceFirm(f.domain, refSet);
    if (loaded.error) { console.error('run-real-proof: --all skipping ' + f.domain + ' (' + loaded.error + ')'); continue; }
    out.push(loaded);
  }
  return out;
}
// loadFirms(opts, refSet): the synthetic control first, then either every reference firm (--all, the
// multi-sector absence run) or the 5 known_breach set (+ 3 clean matrix firms under --clean). --domain
// filters to one firm from whichever set was selected.
function loadFirms(opts, refSet) {
  const firms = [loadSyntheticFirm()];
  if (opts.all) {
    for (const f of allReferenceFirms(refSet)) firms.push(f);
  } else {
    for (const d of KNOWN_BREACH_FIRMS) firms.push(loadReferenceFirm(d, refSet));
    if (opts.clean) for (const d of CLEAN_FIRMS) firms.push(loadReferenceFirm(d, refSet));
  }
  if (opts.domain) return firms.filter((f) => f.domain === opts.domain);
  return firms;
}

// buildRealCaller(opts): construct the real caller (fail-closed) unless --dry. Returns {caller, callEvents}
// where caller.llmCall logs each call into callEvents (shared) so the driver can assemble recordings.
function buildRealCaller(opts) {
  if (opts.dry) return null;
  const callEvents = [];
  const caller = realLlm.createRealLlmCall({ log: (e) => { if (e && e.event === 'real_llm_call') callEvents.push(e); } });
  caller._callEvents = callEvents;
  return caller;
}

// resolveInputs(opts) -> {records, recIdx, firms} or {exitCode}. Loads the compiled catalogue (C-240)
// and the reference set, builds the firm list, and fails closed (exit 2) on a missing catalogue or a
// requested firm with no fixture on disk. Split out of main (C-254: keep main's decision count low).
function resolveInputs(opts) {
  const records = loadCatalogueRecords();
  if (!records.length) {
    console.error('run-real-proof: the compiled catalogue is empty or missing. Run `npm run catalogue` first (C-240).');
    return { exitCode: 2 };
  }
  const refSet = loadReferenceSet(REF_SET);
  const firms = loadFirms(opts, refSet);
  const missing = firms.filter((f) => f.error);
  if (missing.length) { for (const m of missing) console.error('run-real-proof: ' + m.domain + ': ' + m.error); return { exitCode: 2 }; }
  return { records, recIdx: recordIndex(records), firms };
}

// constructCaller(opts) -> {realCaller} (null under --dry) or {exitCode}. A construction failure (no
// RUN_REAL_LLM / no keys) is a usage error reported to the operator, never silently downgraded to a fake.
function constructCaller(opts) {
  if (opts.dry) return { realCaller: null };
  try {
    return { realCaller: buildRealCaller(opts) };
  } catch (e) {
    console.error('run-real-proof: cannot construct the real LLM caller: ' + e.message);
    console.error('  Re-run with RUN_REAL_LLM=1 and provider keys in env, or use --dry for a structural (no-network) run.');
    return { exitCode: 2 };
  }
}

// runAllFirms(...) -> firmResults[]. Per firm: compose + judge + assemble recording. Each firm gets its
// OWN call-event window (the shared realCaller log is drained before each firm) so a recording carries
// only that firm's calls.
async function runAllFirms(firms, records, recIdx, realCaller, recordedDir) {
  const firmResults = [];
  for (const firm of firms) {
    if (realCaller) realCaller._callEvents.length = 0; // drain: start this firm's call window
    firmResults.push(await runOneFirmWindowed(firm, records, recIdx, realCaller, recordedDir));
  }
  return firmResults;
}

// emitReport(...): the --json vs human report branch, split out of main.
function emitReport(opts, preflightRows, firmResults, summary, realCaller) {
  if (opts.json) {
    console.log(JSON.stringify({ preflight: preflightRows, firms: firmResults.map(serialiseFirm), summary }, null, 2));
    return;
  }
  console.log(printPreflightHuman(preflightRows));
  for (const r of firmResults) console.log(printFirmHuman(r.firm, r.composed, r.judged));
  console.log(printSummaryHuman(summary, realCaller));
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.exitCode) return parsed.exitCode;
  const { opts } = parsed;

  const inputs = resolveInputs(opts);
  if (inputs.exitCode) return inputs.exitCode;

  const caller = constructCaller(opts);
  if (caller.exitCode) return caller.exitCode;
  const realCaller = caller.realCaller;

  // Preflight (liveness) - proves the adapter reaches live providers and gathers U1-B4 data (C-135).
  const preflightRows = (realCaller && opts.preflight) ? await realCaller.preflight() : [];
  const recordedDir = realCaller ? realCaller.recordedDir : null; // --dry writes no recordings

  const firmResults = await runAllFirms(inputs.firms, inputs.records, inputs.recIdx, realCaller, recordedDir);
  const summary = summarise(firmResults);
  emitReport(opts, preflightRows, firmResults, summary, realCaller);
  return summary.reproduced >= 1 && summary.contradictions === 0 ? 0 : 1;
}

// runOneFirmWindowed(firm, records, recIdx, realCaller, recordedDir): run one firm and snapshot the
// realCaller's call events for THIS firm (the shared log was drained before the call).
async function runOneFirmWindowed(firm, records, recIdx, realCaller, recordedDir) {
  const callEvents = [];
  const llmCall = realCaller ? realCaller.llmCall : null;
  const composed = await composeFirm(firm, records, recIdx, llmCall);
  if (realCaller) for (const e of realCaller._callEvents) callEvents.push(e);
  const judged = judgeFirm(firm.firmEntry, { payload: composed.payload, breachLaneComplete: true });
  const responses = buildResponses(callEvents);
  const recording = realLlm.buildRecordingFile({
    domain: firm.domain,
    providers: realCaller ? realCaller.families : [],
    responses,
    note: responses.length === 0
      ? 'no breach-path LLM call recorded (propose produced ' + composed.real.length + ' verifiable candidate(s); ' + composed.suppressedCount + ' suppressed upstream)'
      : null,
  });
  let recordingPath = null;
  if (recordedDir !== null) recordingPath = realLlm.writeRecordingFile(recordedDir, firm.domain, recording);
  return { firm, composed, judged, responses, recordingPath, callCount: callEvents.length };
}

function serialiseFirm(r) {
  return {
    domain: r.firm.domain, role: r.firm.role,
    proposed: r.composed.proposedTotal, suppressed: r.composed.suppressedCount, real: r.composed.real.length,
    verified: r.composed.verified.length, rejected: r.composed.rejected.length,
    findings: r.composed.findings.map(findingRow),
    knownBreaches: r.judged.knownBreaches, knownNonBreaches: r.judged.knownNonBreaches,
    contradiction: r.judged.contradiction, calls: r.callCount, recordedResponses: r.responses.length,
    recordingPath: r.recordingPath,
  };
}
function summarise(firmResults) {
  let reproduced = 0; let contradictions = 0; let calls = 0; let recordedResponses = 0;
  const kbTotal = [];
  for (const r of firmResults) {
    calls += r.callCount; recordedResponses += r.responses.length;
    if (r.judged.contradiction) contradictions++;
    for (const kb of r.judged.knownBreaches) { kbTotal.push(kb.status); if (kb.status === 'reproduced') reproduced++; }
  }
  return { firms: firmResults.length, reproduced, contradictions, totalCalls: calls, recordedResponses, knownBreachStatuses: kbTotal };
}
function printSummaryHuman(s, realCaller) {
  const out = ['', '=== SUMMARY ==='];
  out.push('  firms: ' + s.firms + ' | real LLM calls: ' + s.totalCalls + ' | recorded responses: ' + s.recordedResponses);
  out.push('  known_breaches reproduced: ' + s.reproduced);
  out.push('  known_non_breach contradictions: ' + s.contradictions);
  out.push('  mode: ' + (realCaller ? 'REAL model (' + realCaller.families.join(',') + ')' : 'DRY (structural, no network)'));
  out.push('  verdict: ' + (s.reproduced >= 1 && s.contradictions === 0 ? 'PASS (>=1 reproduced, 0 contradictions)' : 'NOT PROVEN (0 reproduced or a contradiction) -> route to Rob (U1-B5)'));
  return out.join('\n');
}

module.exports = {
  main, parseArgs, composeFirm, enrichCandidate, dutyText, citationText, findingRow, decidingGate,
  buildResponses, entailmentEntryFor, adjudicateEntriesFor, loadReferenceFirm, loadSyntheticFirm,
  nonSuppressed, summarise, recordIndex, KNOWN_BREACH_FIRMS, CLEAN_FIRMS, REF_FIXTURES,
};

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch((e) => {
    // FAIL-CLOSED: any uncaught error in the driver is a real failure of the proof run; it is written to
    // stderr and exits non-zero (never a silent success), so a broken run can never read as "proven".
    console.error('run-real-proof: uncaught: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(2);
  });
}
