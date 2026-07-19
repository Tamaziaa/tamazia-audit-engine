'use strict';
// supervised/signature-store.js - THE human-signature record (Kimi K3 round-3 spec section 2 row 8, and
// the rule that governs this entire build: "Claude conducts, the engine testifies, the founder signs...
// The human signature is not a courtesy; it is the legal release authority."). Every entry is appended to
// the SAME run manifest (supervised/manifest-store.js) under stage 'signature' - one more typed, logged,
// append-only fact, never a separate mutable file a later step could quietly overwrite.
//
// A signature record carries per-finding ship/drop decisions with a reason code, and ONE overall verdict
// (SIGN or HOLD) for the whole run. mint-gate.js reads this back and refuses to mint unless the LATEST
// signature entry for a run_id is SIGN.

const { ManifestStore } = require('./manifest-store.js');

// REASON_CODES: the controlled vocabulary the spec names (section 3's table) for per-finding decisions -
// kept open-ended (any string is accepted) but these are the documented canonical values so precision
// tallies (Wilson-interval per-detector precision, per the spec) aggregate cleanly across runs.
const REASON_CODES = Object.freeze([
  'tp-confirmed', 'fp-disclaimer-present', 'fp-wrong-jurisdiction', 'fp-puffery', 'fp-stale-catalogue',
  'fp-other', 'needs-more-evidence',
]);

function isValidDecision(d) {
  return d === 'ship' || d === 'drop';
}

// assertValidOverall(overall) -> throws unless overall is exactly 'SIGN' or 'HOLD'.
function assertValidOverall(overall) {
  if (overall !== 'SIGN' && overall !== 'HOLD') {
    throw new Error('signature-store: overall must be "SIGN" or "HOLD", got ' + JSON.stringify(overall));
  }
}
// hasFindingId(d) -> true when d is an object carrying a non-empty string finding_id.
function hasFindingId(d) {
  if (!d) return false;
  return typeof d.finding_id === 'string' && d.finding_id !== '';
}
// assertOneDecision(d) -> throws unless d carries a real finding_id and a valid ship/drop decision.
function assertOneDecision(d) {
  if (!hasFindingId(d)) throw new Error('signature-store: every finding decision needs a finding_id');
  if (!isValidDecision(d.decision)) {
    throw new Error('signature-store: finding ' + d.finding_id + ' decision must be "ship" or "drop", got ' + JSON.stringify(d.decision));
  }
}
// assertNoDuplicateFindingId(seen, d) -> throws if d.finding_id was already decided earlier in the SAME
// findingDecisions array (regardless of whether the two decisions agree - CodeRabbit review, PR #36:
// shippedFindingIds() reads a Set, so ordering/duplicates are invisible to it once the signature is
// recorded; a ['drop','ship'] pair for the same finding_id would silently resolve to shipped no matter
// which the signer actually meant last. Rejected here, at the write boundary, so an ambiguous signature
// can never be recorded at all - fail closed, matching this file's own doctrine that a finding never
// decided is NOT shipped; a finding decided TWICE, differently, is exactly as untrustworthy).
function assertNoDuplicateFindingId(seen, d) {
  if (seen.has(d.finding_id)) {
    throw new Error('signature-store: duplicate decision for finding ' + d.finding_id + ' in the same signature call (ambiguous ship/drop is rejected, never last-write-wins)');
  }
  seen.add(d.finding_id);
}
// assertValidFindingDecisions(findingDecisions) -> throws unless it is an array of valid decisions, each
// naming a DIFFERENT finding_id (see assertNoDuplicateFindingId's own doc for why a duplicate is fatal).
function assertValidFindingDecisions(findingDecisions) {
  if (!Array.isArray(findingDecisions)) throw new Error('signature-store: findingDecisions must be an array');
  const seen = new Set();
  for (const d of findingDecisions) {
    assertOneDecision(d);
    assertNoDuplicateFindingId(seen, d);
  }
}

// asManifestStore(store) -> store when it is already a real ManifestStore, else a fresh default one (the
// one small coercion every reader/writer in this file needs, factored out rather than repeated).
function asManifestStore(store) {
  return store instanceof ManifestStore ? store : new ManifestStore();
}
// resolvedSigner(f) -> f.signer when it is a non-empty string, else the honest 'unknown' floor.
function resolvedSigner(f) {
  return typeof f.signer === 'string' && f.signer ? f.signer : 'unknown';
}
// resolvedNote(f) -> f.note when it is a string, else null (never undefined - a stable manifest shape).
function resolvedNote(f) {
  return typeof f.note === 'string' ? f.note : null;
}

// recordSignature(store, runId, { signer, overall, findingDecisions, note }) -> the appended entry.
//   overall            'SIGN' | 'HOLD' - the whole-run verdict.
//   findingDecisions   [{ finding_id, decision: 'ship'|'drop', reason_code, note? }] - one entry required
//                       per candidate finding the packet presented; a finding with no decision is treated
//                       by mint-gate.js as NOT signed off (fail closed, never assume 'ship').
function recordSignature(store, runId, fields) {
  const f = fields || {};
  assertValidOverall(f.overall);
  assertValidFindingDecisions(f.findingDecisions);
  return asManifestStore(store).append(runId, 'signature', {
    signer: resolvedSigner(f), overall: f.overall, finding_decisions: f.findingDecisions, note: resolvedNote(f),
  });
}

// latestSignature(store, runId) -> the most recent signature entry, or null if none exists yet. "Most
// recent" (never "first") because a founder may HOLD, request changes, and re-sign; only the latest
// verdict governs the mint gate.
function latestSignature(store, runId) {
  const entries = asManifestStore(store).entriesOfStage(runId, 'signature');
  return entries.length ? entries[entries.length - 1] : null;
}

// decisionsOf(signature) -> signature.finding_decisions when it is a real array, else [].
function decisionsOf(signature) {
  const decisions = signature && signature.finding_decisions;
  return Array.isArray(decisions) ? decisions : [];
}
// isShipDecision(d) -> true only for a real decision entry whose decision is 'ship'.
function isShipDecision(d) {
  return Boolean(d) && d.decision === 'ship';
}
// shippedFindingIds(signature) -> Set<finding_id> of every finding whose latest decision is 'ship'. A
// finding never decided is NOT in this set (fail closed - see recordSignature's own doc).
function shippedFindingIds(signature) {
  return new Set(decisionsOf(signature).filter(isShipDecision).map((d) => d.finding_id));
}

module.exports = { recordSignature, latestSignature, shippedFindingIds, REASON_CODES };
