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

const { verifyQuoteDetailed } = require('./verify-quote.js');
const { latestSignature, shippedFindingIds } = require('./signature-store.js');
const { ManifestStore } = require('./manifest-store.js');
const { MintRefusalError } = require('./errors.js');

const REFUSAL_CODES = Object.freeze({
  NO_SIGNATURE: 'no_signature',
  SIGNATURE_HOLD: 'signature_hold',
  UNDECIDED_FINDING: 'undecided_finding',
  UNVERIFIABLE_QUOTE: 'unverifiable_quote',
  UNRESOLVABLE_LAW_ID: 'unresolvable_law_id',
  CATALOGUE_HASH_MISMATCH: 'catalogue_hash_mismatch',
  NO_COVERAGE_MANIFEST: 'no_coverage_manifest',
});

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

// catalogueRecordIds(catalogue) -> the Set of every record id in the loaded catalogue (accepts either
// {records:[...]} or a bare array - both shapes are used across this repo).
function catalogueRecordIds(catalogue) {
  const records = catalogue.records || catalogue;
  return new Set((Array.isArray(records) ? records : []).map((r) => r && r.id));
}

// firstCatalogueProblem(catalogue, ids, findings) -> {finding, reasonCode, detail} for the first finding
// whose rule_id does not resolve, or whose catalogue_hash does not match the loaded catalogue; null when
// every finding resolves cleanly.
function firstCatalogueProblem(catalogue, ids, findings) {
  for (const f of findings) {
    if (!ids.has(f.rule_id)) {
      return { finding: f, reasonCode: REFUSAL_CODES.UNRESOLVABLE_LAW_ID, detail: 'finding ' + f.finding_id + ' cites rule_id ' + JSON.stringify(f.rule_id) + ' which is not present in the loaded catalogue' };
    }
    if (f.catalogue_hash !== catalogue.content_hash) {
      return { finding: f, reasonCode: REFUSAL_CODES.CATALOGUE_HASH_MISMATCH, detail: 'finding ' + f.finding_id + ' carries catalogue_hash ' + f.catalogue_hash + ' but the loaded catalogue is ' + catalogue.content_hash };
    }
  }
  return null;
}

// checkCatalogue(catalogue, findings) -> { ok, reasonCode?, detail? }. Every finding's law_id (rule_id)
// must resolve to a record IN the catalogue currently loaded, and its catalogue_hash must match that
// catalogue's own content_hash (a finding minted against a stale/different catalogue is refused, never
// silently re-stamped).
function checkCatalogue(catalogue, findings) {
  const problem = firstCatalogueProblem(catalogue, catalogueRecordIds(catalogue), findings);
  if (!problem) return { ok: true };
  return { ok: false, reasonCode: problem.reasonCode, detail: problem.detail };
}

// checkCoverageManifest(coverageManifest) -> { ok, reasonCode?, detail? }.
function checkCoverageManifest(coverageManifest) {
  if (!coverageManifest || !Array.isArray(coverageManifest.checks_planned)) {
    return { ok: false, reasonCode: REFUSAL_CODES.NO_COVERAGE_MANIFEST, detail: 'no coverage manifest (checks_planned) present for this run' };
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
  const sig = checkSignature(i.store, i.runId, findings);
  if (!sig.ok) return sig;
  const cat = checkCatalogue(i.catalogue, findings);
  if (!cat.ok) return cat;
  const quotes = checkQuotes(i.captureIndex, findings);
  if (!quotes.ok) return quotes;
  return { ok: true, signature: sig.signature };
}

// PERSIST_TIMEOUT_MS: the hard ceiling on the live persistFn path (Rule 8/Rule 9: any external call -
// LLM, browser, register API, or here a future Neon/R2 write - without a bounded Promise.race is a
// defect; CodeRabbit review, PR #36). Not yet reachable in v0 (STUB_PERSIST is always the default and no
// caller anywhere in this repo wires a real persistFn), but the seam exists and must fail closed the
// moment it is used, not hang the caller indefinitely on a stuck write.
const PERSIST_TIMEOUT_MS = 30000;

// withPersistTimeout(promise, ms) -> races `promise` against a plain timer that REJECTS (never silently
// resolves as if nothing happened) when the ceiling elapses first, so a hung persistFn surfaces as a
// loud, typed rejection rather than an indefinite await. Kept local and dependency-free (no import from
// evidence/'s own per-lane deadline primitives - Rule 1 does not require sharing a door across
// architecturally separate layers; this module's own header already commits to the smallest possible
// import surface, mirrored here).
function withPersistTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('mint-gate: persistFn exceeded its ' + ms + 'ms budget (Rule 8: budgets are caps, never floors)')), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// mintGate(input) -> { proceeded: true, mode, persisted? }. Throws MintRefusalError on any failed check
// (typed, explicit reason - never a bare boolean false the caller might ignore). `mode` is 'stub' unless
// input.stubPersist === false AND a real persist function is supplied - production wiring for a later
// phase; this v0 defaults to stub always unless explicitly told otherwise, and even then requires an
// explicit persistFn injection (there is no accidental path to a real Neon/R2 write from this module).
// isStubPersist(i) -> true unless the caller explicitly opted out with stubPersist:false AND supplied a
// real persistFn (there is no accidental path to a real Neon/R2 write from this module).
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
  const findingsShipped = (i.findings || []).length;
  if (isStubPersist(i)) {
    return { proceeded: true, mode: 'stub', persisted: null, signature: decision.signature, findingsShipped };
  }
  const persisted = await withPersistTimeout(i.persistFn(i.findings, i), resolvedPersistTimeoutMs(i));
  return { proceeded: true, mode: 'live', persisted, signature: decision.signature, findingsShipped };
}

module.exports = { mintGate, evaluateMintGate, checkSignature, checkQuotes, checkCatalogue, checkCoverageManifest, REFUSAL_CODES, ManifestStore };
