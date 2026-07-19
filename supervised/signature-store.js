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
// assertValidFindingDecisions(findingDecisions) -> throws unless it is an array of valid decisions.
function assertValidFindingDecisions(findingDecisions) {
  if (!Array.isArray(findingDecisions)) throw new Error('signature-store: findingDecisions must be an array');
  for (const d of findingDecisions) assertOneDecision(d);
}

// recordSignature(store, runId, { signer, overall, findingDecisions, note }) -> the appended entry.
//   overall            'SIGN' | 'HOLD' - the whole-run verdict.
//   findingDecisions   [{ finding_id, decision: 'ship'|'drop', reason_code, note? }] - one entry required
//                       per candidate finding the packet presented; a finding with no decision is treated
//                       by mint-gate.js as NOT signed off (fail closed, never assume 'ship').
function recordSignature(store, runId, fields) {
  const s = store instanceof ManifestStore ? store : new ManifestStore();
  const f = fields || {};
  assertValidOverall(f.overall);
  assertValidFindingDecisions(f.findingDecisions);
  return s.append(runId, 'signature', {
    signer: typeof f.signer === 'string' && f.signer ? f.signer : 'unknown',
    overall: f.overall,
    finding_decisions: f.findingDecisions,
    note: typeof f.note === 'string' ? f.note : null,
  });
}

// latestSignature(store, runId) -> the most recent signature entry, or null if none exists yet. "Most
// recent" (never "first") because a founder may HOLD, request changes, and re-sign; only the latest
// verdict governs the mint gate.
function latestSignature(store, runId) {
  const s = store instanceof ManifestStore ? store : new ManifestStore();
  const entries = s.entriesOfStage(runId, 'signature');
  return entries.length ? entries[entries.length - 1] : null;
}

// shippedFindingIds(signature) -> Set<finding_id> of every finding whose latest decision is 'ship'. A
// finding never decided is NOT in this set (fail closed - see recordSignature's own doc).
function shippedFindingIds(signature) {
  const set = new Set();
  if (!signature || !Array.isArray(signature.finding_decisions)) return set;
  for (const d of signature.finding_decisions) {
    if (d && d.decision === 'ship') set.add(d.finding_id);
  }
  return set;
}

module.exports = { recordSignature, latestSignature, shippedFindingIds, REASON_CODES };
