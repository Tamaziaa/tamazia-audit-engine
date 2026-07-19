'use strict';
// mint/quote-verify-checks.js - the per-verdict quote checks for the mint-time quote-verification gate
// (Kimi WS0, blueprint 2.2 / P0-2). Catalogue-ref resolution lives in ./quote-verify-refs.js; this file
// verifies each breach's quote against the fetched evidence bytes and, when the payload declares its own
// evidence, against that record set.
//
// verifyBreachVerdicts(verdicts, opts, payload) -> { checkedQuotes, checkedRefs }, throwing on the first
// failure so the mint refuses to persist an unverifiable v1.2 payload.

const { verifyQuote } = require('../payload/contract/verify-quote.js');
const { resolveIndex, assertRefsResolvable } = require('./quote-verify-refs.js');

// certificateIsDegenerate(cert) -> true when the certificate's OWN counts prove no real search happened,
// regardless of what it self-asserts via threshold_met (CRITICAL-2). decode.js's structural check (run
// earlier, in assertMintablePayload, before this file executes) already requires threshold_met===true and
// >=2 distinct discovery_methods - but threshold_met is a bare boolean the certificate's producer sets
// directly (v1_2/coverage.js's CoverageCertificate does not derive it), so a certificate claiming
// pages_fetched:[] / fetched:0 / planned:0 with threshold_met:true passes that structural check untouched:
// a fabricated "we searched everywhere and found nothing" with zero actual pages read. This is the same
// "recompute, don't trust the label" defence CRITICAL-1 applies to quote.text: pages_fetched and fetched
// must show genuine, non-zero search activity before an absence claim may mint.
function certificateIsDegenerate(cert) {
  if (!cert || !Array.isArray(cert.pages_fetched) || cert.pages_fetched.length === 0) return true;
  return !(Number(cert.fetched) > 0);
}

// assertQuoteBoundToPayload(vd, i, evidenceIds): when the payload declares its own evidence records, a
// breach quote MUST reference one of them, so the persisted legal claim is evidence-resolvable from the
// payload alone (CodeRabbit PR #33). When the payload carries no evidence records (the WS0 seam / an
// injected-store test), this is skipped and the store is the sole evidence source.
function assertQuoteBoundToPayload(vd, i, evidenceIds) {
  if (!evidenceIds || evidenceIds.size === 0) return;
  if (!evidenceIds.has(vd.quote.evidence_id)) {
    throw new Error('quote-verify-gate: verdicts[' + i + '] quote references evidence_id ' + JSON.stringify(vd.quote.evidence_id) + ' which is not among the payload\'s own evidence records - a persisted claim must be resolvable from the payload\'s evidence (P0-2)');
  }
}
// assertQuoteVerifiable(vd, i, store, evidenceIds): a violation/behavioural breach must carry a quote that
// verify_quote confirms against the fetched evidence bytes AND (when the payload declares evidence) whose
// evidence_id is one of the payload's own records. Absence breaches carry a certificate instead, so they
// are skipped. Returns 1 when a quote was checked.
function assertQuoteVerifiable(vd, i, store, evidenceIds) {
  if (vd.breach_kind === 'absence') {
    // decode.js's structural check (run earlier in assertMintablePayload) already required threshold_met
    // and >=2 discovery methods; this gate-level check closes the degenerate case that structural shape
    // checking cannot see: a self-asserted threshold_met:true with zero pages actually fetched (P0-2).
    if (certificateIsDegenerate(vd.certificate)) {
      throw new Error('quote-verify-gate: verdicts[' + i + '] is an absence Breach whose certificate shows no genuine search (pages_fetched is empty or fetched is not greater than zero) - the mint refuses a fabricated absence claim regardless of a self-asserted threshold_met (P0-2)');
    }
    return 0;
  }
  assertQuoteBoundToPayload(vd, i, evidenceIds);
  if (!store) throw new Error('quote-verify-gate: verdicts[' + i + '] carries a quote but no evidenceStore was supplied to verify it against fetched bytes (fail closed)');
  if (!verifyQuote(store, vd.quote)) {
    throw new Error('quote-verify-gate: verdicts[' + i + '] quote does not verify against the fetched evidence bytes (unresolvable evidence, out-of-bounds offsets, a tampered blob, or a text that is not on the page) - the mint refuses an unverifiable quote (P0-2)');
  }
  return 1;
}

// payloadEvidenceIds(payload) -> a Set of the evidence ids the payload declares (empty Set when none).
function payloadEvidenceIds(payload) {
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const ids = new Set();
  for (const rec of evidence) { if (rec && typeof rec.id === 'string') ids.add(rec.id); }
  return ids;
}

// verifyBreachVerdicts(verdicts, opts, payload) -> { checkedQuotes, checkedRefs }. Resolves law/penalty
// and verifies the quote for every Breach verdict; throws on the first failure.
function verifyBreachVerdicts(verdicts, opts, payload) {
  const idx = resolveIndex(opts);
  const store = opts && opts.evidenceStore;
  const evidenceIds = payloadEvidenceIds(payload);
  let checkedQuotes = 0;
  let checkedRefs = 0;
  verdicts.forEach((vd, i) => {
    if (!vd || vd.kind !== 'Breach') return;
    checkedRefs += assertRefsResolvable(vd, i, idx);
    checkedQuotes += assertQuoteVerifiable(vd, i, store, evidenceIds);
  });
  return { checkedQuotes, checkedRefs };
}

module.exports = { verifyBreachVerdicts };
