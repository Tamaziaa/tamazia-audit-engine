'use strict';
// mint/quote-verify-gate.test.js - the mint-time gate refuses a v1.2 payload with an unverifiable quote,
// an unresolvable law, or an absent penalty, and is a proven pass-through on the v1.1 path.

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertMintablePayload } = require('./quote-verify-gate.js');
const v1_2 = require('../payload/contract/v1_2.js');
const { buildMinimalValidPayload } = require('../payload/contract/index.js');

const CAT_HASH = 'a'.repeat(64);
const CATALOGUE = {
  content_hash: CAT_HASH,
  records: [
    { id: 'REAL_LAW', penalty: { statutory_max: 500000, currency: 'GBP', basis: 'test' } },
    { id: 'LAW_NO_PENALTY', penalty: null },
  ],
};
const BYTES = 'Header. Book your Botox today from GBP 99. Footer.';
const TARGET = 'Book your Botox today';
const START = BYTES.indexOf(TARGET);
const STORE = new Map([['ev1', { bytes: BYTES, record: v1_2.EvidenceRecord({ id: 'ev1', lane: 'static', url_final: 'https://x/', fetched_at: 't', content_type: 'text/html', bytes_sha256: v1_2.sha256Hex(BYTES), status: v1_2.evidenceStatusOK() }) }]]);

function manifest() {
  return { checks_planned: ['c1'], checks_run: ['c1'], checks_unrun: [], lanes: [{ lane: 'static', status: 'OK' }], evidence_ids: ['ev1'], catalogue_hash: CAT_HASH, taxonomy_version: '1.0.0', payload_version: '1.2' };
}
function v1_2PayloadWith(verdicts) {
  return { payload_version: '1.2', taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH, evidence: [], verdicts, coverage: manifest() };
}
function violationVerdict(text) {
  const start = BYTES.indexOf(text);
  return {
    kind: 'Breach', breach_kind: 'violation', class: 'confirmed',
    law: { law_id: 'REAL_LAW', catalogue_hash: CAT_HASH },
    penalty: { law_id: 'REAL_LAW', penalty_id: 'primary', catalogue_hash: CAT_HASH },
    quote: { evidence_id: 'ev1', byte_start: start, byte_end: start + text.length, text },
  };
}

test('a v1.1 payload passes straight through (additive: the existing mint path is untouched)', () => {
  const res = assertMintablePayload(buildMinimalValidPayload(), {});
  assert.deepEqual(res, { ok: true, version: '1.1', checkedQuotes: 0, checkedRefs: 0 });
});

test('a v1.2 payload with a real verified quote and resolvable refs is mintable', () => {
  const res = assertMintablePayload(v1_2PayloadWith([violationVerdict(TARGET)]), { catalogue: CATALOGUE, evidenceStore: STORE });
  assert.equal(res.version, '1.2');
  assert.equal(res.checkedQuotes, 1);
  assert.equal(res.checkedRefs, 2);
});

test('the mint REFUSES a v1.2 payload whose quote does not verify against the evidence (fabrication)', () => {
  const fabricated = violationVerdict(TARGET);
  fabricated.quote = { evidence_id: 'ev1', byte_start: START, byte_end: START + TARGET.length, text: 'We store nothing' };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([fabricated]), { catalogue: CATALOGUE, evidenceStore: STORE }), /does not verify against the fetched evidence/);
});

test('the mint REFUSES a v1.2 payload with an unresolvable law_id', () => {
  const bad = violationVerdict(TARGET);
  bad.law = { law_id: 'GHOST_LAW', catalogue_hash: CAT_HASH };
  bad.penalty = { law_id: 'GHOST_LAW', penalty_id: 'primary', catalogue_hash: CAT_HASH };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([bad]), { catalogue: CATALOGUE, evidenceStore: STORE }), /not in the compiled catalogue/);
});

test('the mint REFUSES a v1.2 payload whose penalty is absent from the catalogue', () => {
  const bad = violationVerdict(TARGET);
  bad.law = { law_id: 'LAW_NO_PENALTY', catalogue_hash: CAT_HASH };
  bad.penalty = { law_id: 'LAW_NO_PENALTY', penalty_id: 'primary', catalogue_hash: CAT_HASH };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([bad]), { catalogue: CATALOGUE, evidenceStore: STORE }), /not present in the hash-pinned catalogue/);
});

test('the mint fails closed when a v1.2 breach carries a quote but no evidence store was supplied', () => {
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([violationVerdict(TARGET)]), { catalogue: CATALOGUE }), /no evidenceStore/);
});

test('the mint REFUSES a structurally invalid v1.2 payload (a coverage gap)', () => {
  const bad = v1_2PayloadWith([]);
  bad.coverage.checks_planned = ['c1', 'c2'];
  assert.throws(() => assertMintablePayload(bad, { catalogue: CATALOGUE }), /structurally invalid/);
});

test('when the payload declares its own evidence, a quote must reference one of those records', () => {
  const p = v1_2PayloadWith([violationVerdict(TARGET)]);
  // declare an evidence record with a DIFFERENT id than the quote references (ev1).
  p.evidence = [{ id: 'other', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }];
  assert.throws(() => assertMintablePayload(p, { catalogue: CATALOGUE, evidenceStore: STORE }), /not among the payload's own evidence records/);
  // with the matching record declared, it mints.
  p.evidence = [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }];
  assert.equal(assertMintablePayload(p, { catalogue: CATALOGUE, evidenceStore: STORE }).checkedQuotes, 1);
});
