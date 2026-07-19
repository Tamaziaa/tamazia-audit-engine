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
// excluded reason as `unknown` when it names an evidence gap ('abstain', 'unresolved', 'no evidence',
// 'unknown') and `not_applicable` otherwise - documented here as the one, explicit heuristic, not hidden
// inside a bigger function.

const UNKNOWN_REASON_HINTS = ['abstain', 'unresolved', 'no evidence', 'unknown', 'insufficient'];

function classifyExcludedReason(reason) {
  const r = String(reason || '').toLowerCase();
  return UNKNOWN_REASON_HINTS.some((hint) => r.includes(hint)) ? 'unknown' : 'not_applicable';
}

// buildApplicabilityLedger(connectResult) -> { entries: [{law_id, decision, reason}], counts }. `decision`
// is one of 'applies' | 'not_applicable' | 'unknown' - the total-function trivalent the blueprint names.
function buildApplicabilityLedger(connectResult) {
  const cr = connectResult || { applicable: [], excluded: [], counts: {} };
  const entries = [];
  for (const record of Array.isArray(cr.applicable) ? cr.applicable : []) {
    entries.push({ law_id: record && record.id, decision: 'applies', reason: null });
  }
  for (const ex of Array.isArray(cr.excluded) ? cr.excluded : []) {
    entries.push({ law_id: ex && ex.record_id, decision: classifyExcludedReason(ex && ex.reason), reason: ex && ex.reason });
  }
  return { entries, counts: cr.counts || {} };
}

module.exports = { buildApplicabilityLedger, classifyExcludedReason };
