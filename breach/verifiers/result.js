'use strict';
/**
 * breach/verifiers/result.js - the shared result envelope and rejection-reason taxonomy every
 * verifier in this directory returns (Constitution Rule 3 / Rule 12 Gate 2).
 *
 * Every verify function in breach/verifiers/ returns exactly {verified, code, reason}:
 *   verified   boolean. true only when a deterministic artifact check passed.
 *   code       a closed, machine-readable taxonomy value (below). Stable across releases; the
 *              adjudicator and any future dashboard may switch on it.
 *   reason     a human-readable string explaining the code (never null, always present).
 *
 * CODES is deliberately flat and exhaustive: every rejection this directory can produce has exactly
 * one code, so "why was this candidate rejected" is always answerable without reading prose.
 */

const CODES = Object.freeze({
  // dispatch-level (breach/verifiers/quote-match.js's verifyCandidate)
  INVALID_CANDIDATE: 'invalid_candidate',
  MISSING_ARTIFACT: 'missing_artifact',
  UNKNOWN_ARTIFACT_TYPE: 'unknown_artifact_type',

  // quote artifacts (breach/verifiers/quote-match.js)
  QUOTE_VERIFIED: 'quote_verified',
  QUOTE_MISSING_FIELDS: 'quote_missing_fields',
  QUOTE_INVALID_SURFACE: 'quote_invalid_surface',
  QUOTE_PAGE_NOT_FOUND: 'quote_page_not_found',
  QUOTE_SURFACE_UNAVAILABLE: 'quote_surface_unavailable',
  QUOTE_MISMATCH: 'quote_mismatch',

  // network_event artifacts (breach/verifiers/network-event.js)
  NETWORK_EVENT_VERIFIED: 'network_event_verified',
  NETWORK_EVENT_MISSING_FIELDS: 'network_event_missing_fields',
  NETWORK_EVENT_LANE_NOT_RUN: 'network_event_lane_not_run',
  NETWORK_EVENT_NOT_FOUND: 'network_event_not_found',

  // register_row artifacts (breach/verifiers/register-row.js) - a row claimed PRESENT
  REGISTER_ROW_VERIFIED: 'register_row_verified',
  REGISTER_ROW_MISSING_FIELDS: 'register_row_missing_fields',
  REGISTER_ROW_ABSENT: 'register_row_absent',
  REGISTER_ROW_MISMATCH: 'register_row_mismatch',

  // register_absence artifacts (breach/verifiers/register-absence.js) - a definitive register NO-MATCH
  REGISTER_ABSENCE_VERIFIED: 'register_absence_verified',
  REGISTER_ABSENCE_MISSING_FIELDS: 'register_absence_missing_fields',
  REGISTER_ABSENCE_ROW_PRESENT: 'register_absence_row_present',
  REGISTER_ABSENCE_NOT_PROVEN: 'register_absence_not_proven',

  // coverage_proof artifacts (breach/verifiers/coverage-proof.js)
  COVERAGE_PROOF_VERIFIED: 'coverage_proof_verified',
  COVERAGE_PROOF_NO_PAGES: 'coverage_proof_no_pages',
  COVERAGE_PROOF_PAGES_NOT_IN_BUNDLE: 'coverage_proof_pages_not_in_bundle',
  COVERAGE_PROOF_TIER1_NOT_FETCHED: 'coverage_proof_tier1_not_fetched',
  COVERAGE_PROOF_TRUNCATED: 'coverage_proof_truncated',
});

// accepted(code, reason) -> {verified:true, code, reason}. A verifier calls this ONLY when a
// deterministic artifact check has actually passed against the bundle (never on trust).
function accepted(code, reason) {
  return { verified: true, code, reason };
}

// rejected(code, reason) -> {verified:false, code, reason}. Every rejection carries a code from
// CODES above and a human-readable reason; there is no "silently drop" path in this directory.
function rejected(code, reason) {
  return { verified: false, code, reason };
}

module.exports = { CODES, accepted, rejected };
