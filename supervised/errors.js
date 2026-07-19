'use strict';
// supervised/errors.js - THE typed error vocabulary for Mint Gate v0 (Kimi round-3 spec section 2/5).
//
// Every stage of the supervised-run harness that can fail must fail with a TYPED, named error, never a
// silent empty result (Constitution Rule 4: a gate that errors must block, not pass; caution.md's
// "empty-array-flowing-as-success" disease). This file is the one door for that vocabulary: a capture
// failure is a LaneError, a mint refusal is a MintRefusalError, a replay disagreement is a ReplayIncident.
// Nothing downstream re-invents its own error shape for these three classes.

// LaneError: a capture attempt that FAILED (not "captured nothing" - those are different states). Carries
// the lane name, a machine reason code, and the human detail. Never thrown silently swallowed; every
// capture caller records it on the capture index's `errors` list rather than dropping it.
class LaneError extends Error {
  constructor(lane, reasonCode, detail) {
    super('LaneError[' + lane + '/' + reasonCode + ']: ' + detail);
    this.name = 'LaneError';
    this.lane = lane;
    this.reasonCode = reasonCode;
    this.detail = detail;
  }
}

// MintRefusalError: the mint gate's typed, explicit refusal (section 7). Carries a reasonCode from a
// closed set (see mint-gate.js REFUSAL_CODES) so a caller can branch on it, and a human-readable detail.
class MintRefusalError extends Error {
  constructor(reasonCode, detail, meta) {
    super('MintRefusalError[' + reasonCode + ']: ' + detail);
    this.name = 'MintRefusalError';
    this.reasonCode = reasonCode;
    this.detail = detail;
    this.meta = meta || null;
  }
}

// ReplayIncident: a shipped finding that failed replay (section 8). Logged, never silently swallowed - a
// replay run collects these into its report rather than throwing on the first one, so one incident does
// not hide a second.
class ReplayIncident extends Error {
  constructor(findingId, reasonCode, detail) {
    super('ReplayIncident[' + findingId + '/' + reasonCode + ']: ' + detail);
    this.name = 'ReplayIncident';
    this.findingId = findingId;
    this.reasonCode = reasonCode;
    this.detail = detail;
  }
}

// FindingConstructionError: createFinding()'s own thrown error when a finding is unconstructible (a
// missing/malformed quote, an unresolvable law_id shape, a bad class value). Named separately from a bare
// TypeError so callers can distinguish "the factory refused" from an unrelated bug.
class FindingConstructionError extends Error {
  constructor(field, detail) {
    super('FindingConstructionError[' + field + ']: ' + detail);
    this.name = 'FindingConstructionError';
    this.field = field;
    this.detail = detail;
  }
}

module.exports = { LaneError, MintRefusalError, ReplayIncident, FindingConstructionError };
