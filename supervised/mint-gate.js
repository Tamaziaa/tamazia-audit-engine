'use strict';
// supervised/mint-gate.js - THE mint gate (Kimi K3 round-3 spec section 2 row 9, section 7). Mint proceeds
// ONLY if: (a) a recorded human signature exists for the run AND its latest verdict is SIGN, (b) re-running
// verify_quote over EVERY SHIPPED finding passes, and (c) a coverage manifest is present. Any unverifiable
// quote, unresolvable law_id (not present in the compiled catalogue handed to this gate), or a
// catalogue_hash mismatch (the finding was made against a DIFFERENT catalogue than the one now loaded) ->
// REFUSES with a typed, explicit MintRefusalError. This is wired ADDITIVELY alongside mint/persist.js and
// mint/post-write-assertions.js - it does not touch, weaken or bypass either; it is a NEW, EARLIER gate
// that must pass before persist()/assertMinted() are even called, and STUB_PERSIST mode (below) never
// calls the real persist.js door at all, so a dress rehearsal cannot touch production Neon/R2
// (AGENT-CONTEXT-PACK-2026-07-19.md's own rule 5: "any test mint of a real site: persistence MUST be
// stubbed").

const crypto = require('crypto');
const { verifyQuoteDetailed } = require('./verify-quote.js');
const { latestSignature, shippedFindingIds, signedReportSha256 } = require('./signature-store.js');
const { ManifestStore } = require('./manifest-store.js');
const { MintRefusalError } = require('./errors.js');
const { isFinding } = require('./finding.js');
const { lintNoOrphanClaims } = require('./orphan-lint.js');

const REFUSAL_CODES = Object.freeze({
  NO_SIGNATURE: 'no_signature',
  SIGNATURE_HOLD: 'signature_hold',
  UNDECIDED_FINDING: 'undecided_finding',
  UNVERIFIABLE_QUOTE: 'unverifiable_quote',
  UNRESOLVABLE_LAW_ID: 'unresolvable_law_id',
  CATALOGUE_HASH_MISMATCH: 'catalogue_hash_mismatch',
  JURISDICTION_MISMATCH: 'jurisdiction_mismatch',
  NO_COVERAGE_MANIFEST: 'no_coverage_manifest',
  NO_CATALOGUE: 'no_catalogue',
  DUPLICATE_FINDING_ID: 'duplicate_finding_id',
  UNBRANDED_FINDING: 'unbranded_finding',
  NO_PERSIST_FN: 'no_persist_fn',
  REPORT_TAMPERED: 'report_tampered',
  REPORT_MISSING: 'report_missing',
  REPORT_UNSIGNED: 'report_unsigned',
  ORPHAN_CLAIM: 'orphan_claim',
});

// artifactIdsOf(captureIndex) -> every real artifact id for the run (evidence_id AND sha256 of each
// captured artifact), the set orphan-lint accepts as a valid citation target alongside finding ids (the
// O3 wiring, reused here so the in-gate lint honours artifact citations exactly as the packet lint does).
function artifactIdsOf(captureIndex) {
  if (!captureIndex || typeof captureIndex.list !== 'function') return [];
  return captureIndex.list().flatMap((a) => [a.evidence_id, a.sha256]).filter(Boolean);
}

// reportSha256(report) -> the lowercase-hex sha256 of the report's UTF-8 bytes (the SAME commitment
// bin/engine.js's sign command computes over the report file it is handed).
function reportSha256(report) {
  return crypto.createHash('sha256').update(report, 'utf8').digest('hex');
}

// checkReportBinding(signedHash, report) -> { ok, reasonCode?, detail?, lint? }. The report-binding leg of
// Kimi K3 finding HIGH-E3: a signature commits to the exact linted report bytes via report_sha256, so an
// edit after the founder signed is detectable here. `lint` (true only when a signed report is present and
// its hash matched) tells checkReport() whether to then run the in-gate orphan-lint.
function checkReportBinding(signedHash, report) {
  if (signedHash) {
    if (typeof report !== 'string') return { ok: false, reasonCode: REFUSAL_CODES.REPORT_MISSING, detail: 'the signature committed to a report (report_sha256 present) but no report was supplied to the mint gate' };
    if (reportSha256(report) !== signedHash) return { ok: false, reasonCode: REFUSAL_CODES.REPORT_TAMPERED, detail: 'the report being minted does not match the report_sha256 the founder signed (it was edited after signing)' };
    return { ok: true, lint: true };
  }
  if (typeof report === 'string') return { ok: false, reasonCode: REFUSAL_CODES.REPORT_UNSIGNED, detail: 'a report was supplied to the mint gate but the signature never committed to one (no report_sha256); an unsigned report is never minted' };
  return { ok: true, lint: false };
}

// checkReport(signature, i) -> { ok, reasonCode?, detail? }. THE report integrity check (Kimi K3 finding
// HIGH-E3), both halves as hard refusals:
//   1. BINDING: re-hash the report actually being minted and refuse on any mismatch with the founder's
//      signed report_sha256 (REPORT_TAMPERED / REPORT_MISSING / REPORT_UNSIGNED per checkReportBinding).
//   2. LINT AS A GATE: run lintNoOrphanClaims INSIDE the gate over the final report + the run's finding ids
//      + artifact ids, and treat ok:false as a HARD refusal (ORPHAN_CLAIM), never advisory - a signature
//      does not license an orphaned accusation. A findings-only mint (no report signed, none supplied) is
//      unaffected: checkReportBinding returns lint:false and this returns ok immediately.
function checkReport(signature, i) {
  const binding = checkReportBinding(signedReportSha256(signature), i.report);
  if (!binding.ok) return binding;
  if (!binding.lint) return { ok: true };
  const lint = lintNoOrphanClaims(i.report, i.findings || [], artifactIdsOf(i.captureIndex));
  if (!lint.ok) {
    const first = lint.violations[0];
    return { ok: false, reasonCode: REFUSAL_CODES.ORPHAN_CLAIM, detail: 'the signed report failed the no-orphan-claims lint (' + lint.violations.length + ' violation(s)); first: [' + first.type + '] ' + JSON.stringify(first.sentence) };
  }
  return { ok: true };
}

// firstUnbrandedFinding(findings) -> the first finding that is NOT a real, createFinding()-produced Finding
// (Kimi K3 finding E4, live audit 2026-07-20): finding.js brands every value it actually returns in a
// private WeakSet; a hand-built plain object carrying every right-looking field (finding_id, rule_id,
// quote, class, ...) is otherwise indistinguishable from a real Finding to every check below, which all
// read plain fields. This is the FIRST gate any finding must clear - a look-alike is refused before its
// fields are ever trusted for a signature/catalogue/quote check.
function firstUnbrandedFinding(findings) {
  return findings.find((f) => !isFinding(f)) || null;
}
function checkFindingsAreReal(findings) {
  const bad = firstUnbrandedFinding(findings);
  if (!bad) return { ok: true };
  return { ok: false, reasonCode: REFUSAL_CODES.UNBRANDED_FINDING, detail: 'a finding in this mint attempt was not produced by createFinding() (finding.js) - a field-correct look-alike is refused, never trusted' };
}

// firstDuplicateFindingId(findings) -> the finding_id of the first finding whose id already appeared
// earlier in the SAME findings array, or null when every finding_id is unique (Kimi K3 finding O7, live
// audit 2026-07-20). A duplicate silently double-counts a shipped finding (findingsShipped, any downstream
// per-finding billing/reporting) and must never mint.
function firstDuplicateFindingId(findings) {
  const seen = new Set();
  for (const f of findings) {
    if (seen.has(f.finding_id)) return f.finding_id;
    seen.add(f.finding_id);
  }
  return null;
}
function checkNoDuplicateFindings(findings) {
  const dup = firstDuplicateFindingId(findings);
  if (!dup) return { ok: true };
  return { ok: false, reasonCode: REFUSAL_CODES.DUPLICATE_FINDING_ID, detail: 'finding_id ' + dup + ' appears more than once among the findings being minted (each finding must ship exactly once)' };
}

// firstUndecidedFinding(findings, shipped) -> the first finding with no recorded 'ship' decision, or
// null when every finding was explicitly decided (fail closed - a finding never decided is treated as
// undecided, never assumed shippable).
function firstUndecidedFinding(findings, shipped) {
  return findings.find((f) => !shipped.has(f.finding_id)) || null;
}

// checkSignature(store, runId, findings) -> { ok, reasonCode?, detail?, signature? }. Requires SIGN, and
// requires EVERY finding the caller is trying to ship to have an explicit 'ship' decision recorded.
function checkSignature(store, runId, findings) {
  const signature = latestSignature(store, runId);
  if (!signature) return { ok: false, reasonCode: REFUSAL_CODES.NO_SIGNATURE, detail: 'no signature has been recorded for run ' + runId };
  if (signature.overall !== 'SIGN') return { ok: false, reasonCode: REFUSAL_CODES.SIGNATURE_HOLD, detail: 'the latest signature for run ' + runId + ' is ' + signature.overall + ', not SIGN' };
  const undecided = firstUndecidedFinding(findings, shippedFindingIds(signature));
  if (undecided) return { ok: false, reasonCode: REFUSAL_CODES.UNDECIDED_FINDING, detail: 'finding ' + undecided.finding_id + ' has no recorded "ship" decision in the signature' };
  return { ok: true, signature };
}

// firstUnverifiableFinding(captureIndex, findings) -> {finding, result} for the first finding whose
// verify_quote fails, or null when every finding verifies.
function firstUnverifiableFinding(captureIndex, findings) {
  for (const f of findings) {
    const result = verifyQuoteDetailed(captureIndex, f.quote);
    if (!result.ok) return { finding: f, result };
  }
  return null;
}

// checkQuotes(captureIndex, findings) -> { ok, reasonCode?, detail? }. Re-runs verify_quote over EVERY
// finding being minted, against the SAME hash-chained artifact store the run captured - independent of
// whatever check ran earlier in the harness (defence in depth: this is the check that runs immediately
// before persistence, not a trust of an earlier pass).
function checkQuotes(captureIndex, findings) {
  const bad = firstUnverifiableFinding(captureIndex, findings);
  if (!bad) return { ok: true };
  return { ok: false, reasonCode: REFUSAL_CODES.UNVERIFIABLE_QUOTE, detail: 'finding ' + bad.finding.finding_id + ' (' + bad.finding.rule_id + ') failed verify_quote: ' + bad.result.reason };
}

// catalogueRecordsById(catalogue) -> a Map of record id -> record for every record in the loaded catalogue
// (accepts either {records:[...]} or a bare array - both shapes are used across this repo). A Map (not just
// a Set of ids) so the jurisdiction check below can read each record's OWN declared jurisdiction, never a
// second hand-derived copy (Rule 1).
function catalogueRecordsById(catalogue) {
  const records = catalogue.records || catalogue;
  const map = new Map();
  for (const r of (Array.isArray(records) ? records : [])) {
    if (r && r.id) map.set(r.id, r);
  }
  return map;
}

// firstCatalogueProblem(catalogue, recordsById, findings) -> {finding, reasonCode, detail} for the first
// finding whose rule_id does not resolve, whose catalogue_hash does not match the loaded catalogue, or
// whose OWN declared jurisdiction disagrees with the catalogue record's jurisdiction; null when every
// finding resolves cleanly.
//
// The jurisdiction check (Kimi K3 finding E1, live audit 2026-07-20) closes a second leg of the same
// vector deriveFindingId's basis fix closes: checkCatalogue previously verified the rule_id resolved and
// the catalogue_hash matched, but NEVER that finding.jurisdiction actually agreed with the catalogue
// record's own jurisdiction - a jurisdiction flip (UK->US) on an otherwise-real finding was invisible here.
// Only records that DECLARE a jurisdiction are checked (a record with none is jurisdiction-agnostic by the
// catalogue's own convention; GLOBAL is an explicit catalogue value per Rule 13/caution.md C-113, not an
// absence).
function firstCatalogueProblem(catalogue, recordsById, findings) {
  for (const f of findings) {
    const record = recordsById.get(f.rule_id);
    if (!record) {
      return { finding: f, reasonCode: REFUSAL_CODES.UNRESOLVABLE_LAW_ID, detail: 'finding ' + f.finding_id + ' cites rule_id ' + JSON.stringify(f.rule_id) + ' which is not present in the loaded catalogue' };
    }
    if (f.catalogue_hash !== catalogue.content_hash) {
      return { finding: f, reasonCode: REFUSAL_CODES.CATALOGUE_HASH_MISMATCH, detail: 'finding ' + f.finding_id + ' carries catalogue_hash ' + f.catalogue_hash + ' but the loaded catalogue is ' + catalogue.content_hash };
    }
    if (record.jurisdiction && f.jurisdiction !== record.jurisdiction) {
      return { finding: f, reasonCode: REFUSAL_CODES.JURISDICTION_MISMATCH, detail: 'finding ' + f.finding_id + ' declares jurisdiction ' + JSON.stringify(f.jurisdiction) + ' but catalogue record ' + f.rule_id + ' is jurisdiction ' + JSON.stringify(record.jurisdiction) };
    }
  }
  return null;
}

// checkCatalogue(catalogue, findings) -> { ok, reasonCode?, detail? }. Every finding's law_id (rule_id)
// must resolve to a record IN the catalogue currently loaded, its catalogue_hash must match that
// catalogue's own content_hash (a finding minted against a stale/different catalogue is refused, never
// silently re-stamped), and its jurisdiction must agree with the catalogue record's own jurisdiction.
//
// A missing/malformed catalogue argument is a typed refusal, never a raw crash (Kimi K3 finding O2, live
// audit 2026-07-20): before this fix, an undefined catalogue reached `catalogue.records` and threw a bare
// TypeError that propagated straight out of mintGate() uncaught - Constitution Rule 4's own doctrine ("a
// gate that errors, times out or receives malformed input must BLOCK, not pass") applies to the gate's own
// inputs, not only to what it evaluates.
function checkCatalogue(catalogue, findings) {
  if (!catalogue || typeof catalogue !== 'object') {
    return { ok: false, reasonCode: REFUSAL_CODES.NO_CATALOGUE, detail: 'mint-gate was given no real catalogue object (expected {records:[...], content_hash}), got ' + JSON.stringify(catalogue) };
  }
  const problem = firstCatalogueProblem(catalogue, catalogueRecordsById(catalogue), findings);
  if (!problem) return { ok: true };
  return { ok: false, reasonCode: problem.reasonCode, detail: problem.detail };
}

// isNonBlankString(v) -> true for a real, trimmed-non-empty string (a rule id, never an empty placeholder).
function isNonBlankString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// checksPlannedErrors(checksPlanned) -> string[] of reasons checks_planned is invalid (empty = valid).
//
// Kimi K3 finding CRITICAL-3 (live audit 2026-07-20): checkCoverageManifest previously accepted ANY array,
// including an EMPTY one - `{checks_planned: []}` alongside `findings: []` sailed a SIGN straight through
// to a "clean audit" that had run zero checks (the exact caution.md C-068/Rule-18 disease: an empty result
// flowing through as a clean pass). checks_planned must be non-empty, and every entry must be a real rule
// id, never a blank placeholder.
function checksPlannedErrors(checksPlanned) {
  if (!Array.isArray(checksPlanned) || checksPlanned.length === 0) {
    return ['checks_planned must be a non-empty array of rule ids (an empty checks_planned would let a run with zero checks mint as "clean")'];
  }
  if (checksPlanned.some((c) => !isNonBlankString(c))) {
    return ['every checks_planned entry must be a non-empty string rule id'];
  }
  return [];
}

// unrunCheckNames(checksUnrun) -> the check ids actually accounted-for by checks_unrun: either a plain
// non-blank string id, or a { check, reason } object (Rule 21's shape) whose reason is ALSO non-blank - an
// unrun entry with no reason names nothing and is not a real terminal state (mirrors payload/contract/
// v1_2/manifest-errors.js's own R21 rule, at the lite shape this harness actually produces - see
// coverageGapErrors's own doc for why the full v1_2 CoverageManifest constructor is not reused here).
function unrunCheckNames(checksUnrun) {
  const names = [];
  for (const e of checksUnrun) {
    if (isNonBlankString(e)) { names.push(e); continue; }
    if (e && typeof e === 'object' && isNonBlankString(e.check) && isNonBlankString(e.reason)) names.push(e.check);
  }
  return names;
}

// coverageGapErrors(coverageManifest) -> string[] of reasons checks_planned is not fully accounted for by
// checks_run + checks_unrun (empty = valid, or nothing to check).
//
// This mirrors Rule 18/21's run-union-unrun-equals-planned invariant (payload/contract/v1_2/manifest-
// errors.js's coverageManifestErrors), reimplemented here at the LITE shape supervised/run-harness.js
// actually produces: the full v1_2 CoverageManifest constructor additionally REQUIRES lanes/evidence_ids/
// taxonomy_version/payload_version, fields this harness's coverage manifest does not carry (finding.js's
// own header documents this module's "v1.2-lite" scope) - importing the full constructor would refuse
// every real call here on missing fields it was never asked to prove, not "reuse a fitting check". When a
// caller supplies ONLY checks_planned (the minimal shape several existing tests and callers use), there is
// nothing further to verify and this returns no errors; when checks_run/checks_unrun ARE present, every
// planned id must be accounted for by one or the other, exactly as Rule 18 requires.
function coverageGapErrors(coverageManifest) {
  const planned = coverageManifest.checks_planned;
  const run = coverageManifest.checks_run;
  const unrun = coverageManifest.checks_unrun;
  if (!Array.isArray(run) && !Array.isArray(unrun)) return [];
  const runSet = new Set(Array.isArray(run) ? run : []);
  const unrunSet = new Set(unrunCheckNames(Array.isArray(unrun) ? unrun : []));
  const gaps = planned.filter((c) => !runSet.has(c) && !unrunSet.has(c));
  if (gaps.length === 0) return [];
  return ['planned check(s) ' + JSON.stringify(gaps) + ' are neither run nor declared unrun with a reason - a planned check with no terminal state is a silent coverage gap (Rule 18/21)'];
}

// checkCoverageManifest(coverageManifest) -> { ok, reasonCode?, detail? }.
function checkCoverageManifest(coverageManifest) {
  if (!coverageManifest || typeof coverageManifest !== 'object') {
    return { ok: false, reasonCode: REFUSAL_CODES.NO_COVERAGE_MANIFEST, detail: 'no coverage manifest present for this run' };
  }
  const errors = checksPlannedErrors(coverageManifest.checks_planned).concat(coverageGapErrors(coverageManifest));
  if (errors.length) {
    return { ok: false, reasonCode: REFUSAL_CODES.NO_COVERAGE_MANIFEST, detail: errors.join('; ') };
  }
  return { ok: true };
}

// evaluateMintGate({store, runId, findings, captureIndex, catalogue, coverageManifest}) -> { proceed,
// refusal? }. Pure decision function (no persistence side effect) - callers that need the typed throw form
// use mintGate() below; this is exported separately so a caller (e.g. the CLI, or a packet-time preview)
// can check "would the gate pass" without triggering the throw-based control flow.
function evaluateMintGate(input) {
  const i = input || {};
  const findings = Array.isArray(i.findings) ? i.findings : [];
  const coverage = checkCoverageManifest(i.coverageManifest);
  if (!coverage.ok) return coverage;
  const branded = checkFindingsAreReal(findings);
  if (!branded.ok) return branded;
  const dup = checkNoDuplicateFindings(findings);
  if (!dup.ok) return dup;
  const sig = checkSignature(i.store, i.runId, findings);
  if (!sig.ok) return sig;
  const cat = checkCatalogue(i.catalogue, findings);
  if (!cat.ok) return cat;
  const quotes = checkQuotes(i.captureIndex, findings);
  if (!quotes.ok) return quotes;
  // Report binding + in-gate orphan-lint (Kimi K3 finding HIGH-E3) - runs AFTER checkSignature so the
  // founder's signed report_sha256 is known, and after the findings/quotes are proven so the lint runs
  // over the real, verified finding-id set.
  const report = checkReport(sig.signature, i);
  if (!report.ok) return report;
  return { ok: true, signature: sig.signature };
}

// PERSIST_TIMEOUT_MS: the hard ceiling on the live persistFn path (Rule 8/Rule 9: any external call -
// LLM, browser, register API, or here a future Neon/R2 write - without a bounded Promise.race is a
// defect; CodeRabbit review, PR #36). Not yet reachable in v0 (STUB_PERSIST is always the default and no
// caller anywhere in this repo wires a real persistFn), but the seam exists and must fail closed the
// moment it is used, not hang the caller indefinitely on a stuck write.
const PERSIST_TIMEOUT_MS = 30000;

// withPersistTimeout(persistFn, findings, i, ms) -> races persistFn's own promise against a plain timer
// that REJECTS (never silently resolves as if nothing happened) when the ceiling elapses first, so a hung
// persistFn surfaces as a loud, typed rejection rather than an indefinite await. Kept local and
// dependency-free (no import from evidence/'s own per-lane deadline primitives - Rule 1 does not require
// sharing a door across architecturally separate layers; this module's own header already commits to the
// smallest possible import surface, mirrored here).
//
// Kimi K3 finding O4 (live audit 2026-07-20): a plain Promise.race against a timer REJECTS the caller at
// the deadline, but the LOSING persistFn promise is never actually stopped - it keeps running in the
// background. If it later resolves successfully, a row IS persisted while every caller of mintGate()
// believes the mint failed (the caution.md C-181/C-186 disease: an outcome the system silently disagrees
// with itself about). Two independent mitigations, since v0 has no real persistFn wired anywhere yet and
// cannot assume every future persistFn will honour cancellation:
//   1. an AbortController's signal is handed to persistFn as part of its context argument, so any
//      persistFn that DOES support cancellation (the intended production shape) is actually told to stop
//      writing the moment the deadline fires, not merely abandoned mid-flight.
//   2. whether or not persistFn honours the signal, this function keeps listening for its eventual
//      settlement and RECORDS it - never drops it silently. The thrown timeout error carries a live
//      `ambiguousOutcomes` array reference (mutated in place if/when the late settlement arrives) that a
//      caller can inspect afterwards, so "timed out" is never silently promoted to "confirmed failed" - the
//      true outcome, once known, is captured on the SAME error object the caller already has.
function withPersistTimeout(persistFn, findings, i, ms) {
  const controller = new AbortController();
  const ambiguousOutcomes = [];
  let timedOut = false;
  let timer = null;

  const persistPromise = Promise.resolve().then(() => persistFn(findings, Object.assign({}, i, { signal: controller.signal })));
  // Fire-and-forget listener: records the eventual outcome ONLY when it arrives after the deadline already
  // fired (the normal fast-settling case pushes nothing here, and never affects the race below).
  persistPromise.then(
    (value) => { if (timedOut) ambiguousOutcomes.push({ outcome: 'settled_after_timeout', ok: true, value }); },
    (err) => { if (timedOut) ambiguousOutcomes.push({ outcome: 'settled_after_timeout', ok: false, error: err && err.message ? err.message : String(err) }); }
  );

  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const err = new Error('mint-gate: persistFn exceeded its ' + ms + 'ms budget (Rule 8: budgets are caps, never floors)');
      err.timedOut = true;
      err.ambiguousOutcomes = ambiguousOutcomes;
      reject(err);
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([persistPromise, timeout]).finally(() => clearTimeout(timer));
}

// mintGate(input) -> { proceeded: true, mode, persisted? }. Throws MintRefusalError on any failed check
// (typed, explicit reason - never a bare boolean false the caller might ignore). `mode` is 'stub' unless
// input.stubPersist === false AND a real persist function is supplied - production wiring for a later
// phase; this v0 defaults to stub always unless explicitly told otherwise, and even then requires an
// explicit persistFn injection (there is no accidental path to a real Neon/R2 write from this module).
// isStubPersist(i) -> true unless the caller explicitly opted out with stubPersist:false AND supplied a
// real persistFn (there is no accidental path to a real Neon/R2 write from this module). By the time this
// runs, mintGate() has already refused a stubPersist:false call with no persistFn (Kimi K3 finding O1
// below), so the `typeof i.persistFn !== 'function'` branch here can no longer be silently reached live.
function isStubPersist(i) {
  if (i.stubPersist === false) return typeof i.persistFn !== 'function';
  return true;
}

// resolvedPersistTimeoutMs(i) -> the persist budget for this call. A caller MAY lower it (e.g. a test
// proving the timeout path fires), never raise it past PERSIST_TIMEOUT_MS (Rule 8: a cap the caller can
// tighten, never loosen).
function resolvedPersistTimeoutMs(i) {
  if (!Number.isFinite(i.persistTimeoutMs) || i.persistTimeoutMs <= 0) return PERSIST_TIMEOUT_MS;
  return Math.min(i.persistTimeoutMs, PERSIST_TIMEOUT_MS);
}

async function mintGate(input) {
  const i = input || {};
  const decision = evaluateMintGate(i);
  if (!decision.ok) {
    throw new MintRefusalError(decision.reasonCode, decision.detail, { runId: i.runId });
  }
  // Kimi K3 finding O1 (live audit 2026-07-20): {stubPersist:false} with no persistFn previously fell
  // through isStubPersist()'s own opted-out branch and silently returned {proceeded:true, mode:'stub'} -
  // a caller who explicitly asked for a LIVE mint had no way to tell their write never happened at all
  // (fail-OPEN into a misleading success shape). Refusing loudly here means "I asked for live and got
  // nothing" can never look identical to "I asked for stub and got the stub I expected".
  if (i.stubPersist === false && typeof i.persistFn !== 'function') {
    throw new MintRefusalError(REFUSAL_CODES.NO_PERSIST_FN, 'stubPersist:false requires a real persistFn function to be supplied; mint-gate refuses to silently fall back to stub mode', { runId: i.runId });
  }
  const findingsShipped = (i.findings || []).length;
  if (isStubPersist(i)) {
    return { proceeded: true, mode: 'stub', persisted: null, signature: decision.signature, findingsShipped };
  }
  const persisted = await withPersistTimeout(i.persistFn, i.findings, i, resolvedPersistTimeoutMs(i));
  return { proceeded: true, mode: 'live', persisted, signature: decision.signature, findingsShipped };
}

module.exports = { mintGate, evaluateMintGate, checkSignature, checkQuotes, checkCatalogue, checkCoverageManifest, checkReport, REFUSAL_CODES, ManifestStore };
