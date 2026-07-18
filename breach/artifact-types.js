'use strict';
/**
 * breach/artifact-types.js - THE one door for the breach artifact-type vocabulary (Constitution
 * Rule 1: one door per fact; Rule 3: no artifact, no breach). Every deterministic artifact a breach
 * candidate may carry has exactly one canonical `type` string, and it is DEFINED here and NOWHERE
 * else. The proposer (breach/proposers/), the verifier dispatcher (breach/verifiers/quote-match.js)
 * and the adjudicator's evidence-kind classifier (breach/adjudicator/evidence-kind.js) all IMPORT
 * this enum rather than re-declaring the literals; before this file existed each side kept its own
 * copy and they drifted (the proposer emitted `network_event`/`coverage_proof` while the adjudicator
 * still keyed on the old-estate `network_request`/`cookie_jar_entry`/`corpus_quote` literals, so a
 * real PECR observation reaching the adjudicator was silently quarantined - the C-084 disease
 * resurrected through a name mismatch).
 *
 * The CLOSED set (Rule 3 lists a verbatim quote, a captured network event, a register row, and a
 * failing DOM node; this repo's absence lane adds a coverage proof and a register-absence proof):
 *   quote             a verbatim quote string-matched to the crawled corpus (breach/verifiers/quote-match.js)
 *   network_event     a captured browser network/observation event (breach/verifiers/network-event.js)
 *   register_row      an EXACT public-register row the candidate cites as PRESENT (breach/verifiers/register-row.js)
 *   register_absence  a definitive register NO-MATCH: the lookup RAN and returned no row (breach/verifiers/register-absence.js)
 *   coverage_proof    proof the surface behind an ABSENCE claim was actually, sufficiently crawled (breach/verifiers/coverage-proof.js)
 *
 * Pure data: no I/O, no clock, no env, no law/fine/regulator literal (Rule 2).
 */

// ARTIFACT_TYPES: the canonical string for each artifact class. Consumers reference these constants,
// never the bare literal, so a rename is a one-line change here and CI (jscpd/one-door) has one door
// to police.
const ARTIFACT_TYPES = Object.freeze({
  QUOTE: 'quote',
  NETWORK_EVENT: 'network_event',
  REGISTER_ROW: 'register_row',
  REGISTER_ABSENCE: 'register_absence',
  COVERAGE_PROOF: 'coverage_proof',
});

// The closed membership set is kept MODULE-INTERNAL, not exported: Object.freeze() does not stop a
// Set's own .add()/.delete() (they mutate an internal slot, not a property), so an exported "frozen"
// Set would be a false promise of immutability. Callers get the genuinely-frozen ARTIFACT_TYPES
// object and the isArtifactType() guard instead; neither can be used to smuggle a new type in.
const ARTIFACT_TYPE_SET = new Set(Object.values(ARTIFACT_TYPES));

// isArtifactType(t) -> true only for a canonical artifact-type string. A non-string, or any value
// outside the closed set, is false (never assumed, never guessed).
function isArtifactType(t) {
  return typeof t === 'string' && ARTIFACT_TYPE_SET.has(t);
}

module.exports = { ARTIFACT_TYPES, isArtifactType };
