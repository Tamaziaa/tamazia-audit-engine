'use strict';
// supervised/applicability-ledger.js - projects applicability/connect.js's own output ({applicable,
// excluded, counts} - the ONE door for applicability, Rule 1) into the per-law decision ledger the spec
// asks the harness to expose (section 2 row 2: "applicability ledger per law: applicable / not / unknown +
// reasons"; blueprint section 2.3's APPLIES | NOT_APPLICABLE | UNKNOWN total function). This module makes
// NO applicability decision of its own - connect() already decided; this is a read-only re-shaping into a
// flat, orchestrator-friendly list.
//
// connect()'s `excluded` entries carry a free-text `reason` string, not yet a typed UNKNOWN-vs-NOT_APPLICABLE
// distinction (that lives in the full WS0 taxonomy this repo has not merged - see the blueprint's
// gateBound()/evaluateRemainingGates() three-valued design). Until that lands, this module classifies an
// excluded reason as `unknown` when it names an evidence gap and `not_applicable` otherwise - documented
// here as the one, explicit heuristic, not hidden inside a bigger function.
//
// HINT COVERAGE (CodeRabbit review, PR #36): a reason phrased outside this hint list would be reported as
// a CONFIRMED not_applicable even when it is really an unresolved evidence gap - the worse of the two
// mislabels (a genuine "we don't know" rendered as a false "definitely does not apply"). 'nexus' and 'no
// matching evidence' were added because applicability/connect.js's own gate-6 exclusion message ("gate-6
// required-nexus: none of [...] is satisfied for jurisdiction ...") is exactly this shape: the record's
// required_nexus was never PROVEN satisfied, which is an evidence gap, not a proven negative - unlike
// gate-2/3/4/5's exclusions, which are genuine definite mismatches (a firm's sub-sector/sector/activity
// tags provably do not intersect the record's own restriction) and correctly stay not_applicable. The
// default itself stays not_applicable, not flipped to unknown wholesale (applicability-ledger.test.js's
// own "definite gate-failure reason" fixture already pins that a real negative determination must render
// as not_applicable, not unknown - flipping the default would make every genuine non-applicability
// determination look like an unresolved abstention, the opposite failure mode).
const UNKNOWN_REASON_HINTS = ['abstain', 'unresolved', 'no evidence', 'no matching evidence', 'unknown', 'insufficient', 'nexus'];

function classifyExcludedReason(reason) {
  const r = String(reason || '').toLowerCase();
  return UNKNOWN_REASON_HINTS.some((hint) => r.includes(hint)) ? 'unknown' : 'not_applicable';
}

// asArray(v) -> v when it is an array, else []; the one small helper every list field below reads
// through, so the ternary is written once rather than repeated at every call site.
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
// applicableEntry(record) -> the ledger row for a record connect() bound as applicable.
function applicableEntry(record) {
  return { law_id: record && record.id, decision: 'applies', reason: null };
}
// excludedEntry(ex) -> the ledger row for a record connect() excluded, classified unknown/not_applicable.
function excludedEntry(ex) {
  return { law_id: ex && ex.record_id, decision: classifyExcludedReason(ex && ex.reason), reason: ex && ex.reason };
}

// buildApplicabilityLedger(connectResult) -> { entries: [{law_id, decision, reason}], counts }. `decision`
// is one of 'applies' | 'not_applicable' | 'unknown' - the total-function trivalent the blueprint names.
function buildApplicabilityLedger(connectResult) {
  const cr = connectResult || { applicable: [], excluded: [], counts: {} };
  const entries = asArray(cr.applicable).map(applicableEntry).concat(asArray(cr.excluded).map(excludedEntry));
  return { entries, counts: cr.counts || {} };
}

module.exports = { buildApplicabilityLedger, classifyExcludedReason };
