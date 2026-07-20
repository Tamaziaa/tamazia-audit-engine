'use strict';
// supervised/signoff.js - THE per-finding CONFIRMED path (Kimi K3 render-debug §1b, this session's "one
// thing"). Distinct from, and additive alongside, signature-store.js's whole-run SIGN/HOLD ship/drop
// record (which stays the mint gate's own release authority, untouched here): this module is the
// FINE-GRAINED, append-only sign/reject trail a founder works through one finding at a time from
// `engine review`, so a long review session can be done incrementally without holding one giant
// findingDecisions array in a single CLI call.
//
// Append-only, same doctrine as manifest-store.js and signature-store.js: a signoff/reject event is never
// rewritten - status is always a DERIVED VIEW over the ordered event log for a finding_id (deriveStatus()
// below is the ONLY function that computes it). "Never hand-edit the payload JSON" (the task brief) means
// exactly this: nothing outside this file's event-replay may declare a finding CONFIRMED.
//
//   engine sign --run <id> --finding <rule/finding id> --by <signer> --note "..."
//     Refuses to sign a finding that: (a) does not exist in the run's candidate_findings, (b) is not
//     currently 'needs_human' (derived), or (c) carries no re-verifiable evidence anchor - a quote whose
//     span_sha256 still re-verifies against the (possibly rehydrated) artifact store, OR a coverage/
//     absence finding with a non-empty checked_urls list. Enforced HERE, at sign time, never deferred to
//     render (Kimi §1b: "enforce here, not at render").
//   engine reject --run <id> --finding <id> --reason "..." (reason mandatory)
//     -> status 'rejected'. Stays in the manifest (never deleted) so a reject-to-flatter pattern is
//     visible in the provenance footer, same as signature-store.js's own doctrine.

const { ManifestStore } = require('./manifest-store.js');
const { verifyQuoteDetailed } = require('./verify-quote.js');
const { resolveSpanText } = require('./excerpts.js');

const SIGNOFF_STAGE = 'signoff';

class SignoffError extends Error {
  constructor(findingId, code, reason) {
    super('signoff: ' + code + ' (finding ' + JSON.stringify(findingId) + '): ' + reason);
    this.name = 'SignoffError';
    this.code = code;
    this.findingId = findingId;
  }
}

function asManifestStore(store) {
  return store instanceof ManifestStore ? store : new ManifestStore();
}

// latestCandidateFindings(store, runId) -> the findings array from the MOST RECENT candidate_findings
// manifest entry for this run (the same "latest snapshot wins" rule replay.js's shippedDecisionsFor uses),
// or [] if the run has none.
function latestCandidateFindings(store, runId) {
  const entries = asManifestStore(store).entriesOfStage(runId, 'candidate_findings');
  if (!entries.length) return [];
  const latest = entries[entries.length - 1];
  return Array.isArray(latest.findings) ? latest.findings : [];
}

// findingById(store, runId, findingId) -> the candidate Finding record with this finding_id, or null.
function findingById(store, runId, findingId) {
  return latestCandidateFindings(store, runId).find((f) => f && f.finding_id === findingId) || null;
}

// signoffEvents(store, runId) -> every signoff/reject event recorded for this run, in append order.
function signoffEvents(store, runId) {
  return asManifestStore(store).entriesOfStage(runId, SIGNOFF_STAGE);
}

// deriveStatus(store, runId, findingId) -> 'confirmed' | 'rejected' | 'needs_human'. Replays the SAME
// append-only event log every reader (review/export/sign/reject) reads - the ONLY place status is
// computed. Latest event for a finding_id wins (a founder may reject-then-reconsider by signing later, or
// vice versa; both are honest, visible transitions in the log, never a silent overwrite).
function deriveStatus(store, runId, findingId) {
  let status = 'needs_human';
  for (const e of signoffEvents(store, runId)) {
    if (e.finding_id !== findingId) continue;
    if (e.type === 'signoff') status = 'confirmed';
    else if (e.type === 'reject') status = 'rejected';
  }
  return status;
}

// statusMap(store, runId) -> Map<finding_id, status> for every finding_id that has EVER had a signoff/
// reject event recorded (findings with no event are left out - a caller treats "absent" as needs_human,
// same fail-closed default deriveStatus() returns for an unknown id).
function statusMap(store, runId) {
  const map = new Map();
  for (const e of signoffEvents(store, runId)) {
    if (typeof e.finding_id !== 'string' || !e.finding_id) continue;
    if (e.type === 'signoff') map.set(e.finding_id, 'confirmed');
    else if (e.type === 'reject') map.set(e.finding_id, 'rejected');
  }
  return map;
}

// hasEvidenceAnchor(store, finding) -> true when the finding carries at least one RE-VERIFIED evidence
// anchor: a quote whose span_sha256 still checks out against the (re-hydrated) artifact store, OR a
// coverage/absence finding with a non-empty checked_urls resolution. This is the sign-time gate Kimi §1b
// names explicitly ("REFUSES to sign an unevidenced finding; enforce here, not at render").
function hasEvidenceAnchor(store, finding) {
  if (!finding) return false;
  const kind = finding.evidence_kind;
  if (kind === 'coverage_proof' || kind === 'register_absence') {
    const resolved = resolveSpanText(store, finding, {});
    return resolved.checkedUrls.length > 0;
  }
  if (!finding.quote) return false;
  if (!store) return false; // no store to re-verify against - never sign on trust alone.
  return verifyQuoteDetailed(store, finding.quote).ok;
}

// evidenceCommitment(store, finding) -> the sha256 the signoff event commits to as its evidence anchor:
// the quote's own span_sha256 for a text/dom/network anchor, or a sha256 of the resolved checked_urls list
// for an absence finding (so a signoff event always carries SOME re-derivable evidence commitment).
function evidenceCommitment(store, finding) {
  if (finding.quote && typeof finding.quote.span_sha256 === 'string') return finding.quote.span_sha256;
  const crypto = require('crypto');
  const resolved = resolveSpanText(store, finding, {});
  return crypto.createHash('sha256').update(JSON.stringify(resolved.checkedUrls || []), 'utf8').digest('hex');
}

// signFinding(store, runId, { findingId, signer, note, captureIndex }) -> the appended signoff event.
// Throws SignoffError (never a silent no-op) if the finding does not exist, is not needs_human, or has no
// re-verifiable evidence anchor.
function signFinding(store, runId, opts) {
  const o = opts || {};
  const s = asManifestStore(store);
  const finding = findingById(s, runId, o.findingId);
  if (!finding) throw new SignoffError(o.findingId, 'finding_not_found', 'no candidate finding with this id in run ' + JSON.stringify(runId));
  const status = deriveStatus(s, runId, o.findingId);
  if (status !== 'needs_human') throw new SignoffError(o.findingId, 'not_needs_human', 'current status is ' + JSON.stringify(status) + ', not needs_human');
  const captureIndex = o.captureIndex || null;
  if (!hasEvidenceAnchor(captureIndex, finding)) {
    throw new SignoffError(o.findingId, 'unevidenced_finding', 'refusing to sign - no re-verified evidence anchor (quote span re-check failed, or no checked_urls for an absence finding)');
  }
  if (typeof o.signer !== 'string' || !o.signer.trim()) {
    throw new SignoffError(o.findingId, 'signer_required', 'a signer name is required to sign a finding');
  }
  return s.append(runId, SIGNOFF_STAGE, {
    type: 'signoff',
    finding_id: o.findingId,
    signer: o.signer,
    note: typeof o.note === 'string' ? o.note : null,
    evidence_sha256: evidenceCommitment(captureIndex, finding),
  });
}

// rejectFinding(store, runId, { findingId, signer, reason }) -> the appended reject event. `reason` is
// MANDATORY (Kimi §1b) - an unreasoned reject is refused, same fail-closed discipline as an unevidenced
// sign.
function rejectFinding(store, runId, opts) {
  const o = opts || {};
  const s = asManifestStore(store);
  const finding = findingById(s, runId, o.findingId);
  if (!finding) throw new SignoffError(o.findingId, 'finding_not_found', 'no candidate finding with this id in run ' + JSON.stringify(runId));
  if (typeof o.reason !== 'string' || !o.reason.trim()) {
    throw new SignoffError(o.findingId, 'reason_required', 'a reject reason is mandatory');
  }
  return s.append(runId, SIGNOFF_STAGE, {
    type: 'reject',
    finding_id: o.findingId,
    signer: typeof o.signer === 'string' && o.signer.trim() ? o.signer : 'unknown',
    reason: o.reason,
  });
}

module.exports = {
  SignoffError, deriveStatus, statusMap, hasEvidenceAnchor, signFinding, rejectFinding,
  latestCandidateFindings, findingById, signoffEvents,
};
