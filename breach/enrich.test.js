'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { enrichVerifiedCandidates, joinCatalogueFacts, catalogueRecordIndex, quoteFromArtifact } = require('./enrich.js');

// A minimal compiled-record shape (the fields the join reads; Rule 2: the join only READS these).
const RECORD = {
  id: 'UK_TEST_RULE',
  name: 'Test Framework 2024',
  citation: { act: 'Test Act 2024', section: 's.7' },
  website_obligations: [{ duty: 'Publish a cookie consent banner before setting non-essential cookies.', evidence_type: 'behavioural' }],
};

test('the join stamps catalogue-only fields (description/framework/statutory_citation) from the record (Rule 2)', () => {
  const candidate = { record_id: 'UK_TEST_RULE', duty_idx: 0, kind: 'behavioural', artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'x', name: '_ga' }, page_url: 'https://x.example/' };
  const [f] = enrichVerifiedCandidates([candidate], [RECORD]);
  assert.strictEqual(f.description, 'Publish a cookie consent banner before setting non-essential cookies.');
  assert.strictEqual(f.framework, 'Test Framework 2024');
  assert.strictEqual(f.statutory_citation, 's.7');
  assert.strictEqual(typeof f.atomic_claim, 'string');
  assert.ok(f.atomic_claim.length > 0, 'the Gate-3 atomic claim is computed from the full record');
});

test('every candidate field passes through UNTOUCHED (the join never mutates the input)', () => {
  const candidate = { record_id: 'UK_TEST_RULE', duty_idx: 0, kind: 'behavioural', artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'x', name: '_ga' }, page_url: 'https://x.example/', confidence_hint: 'strong' };
  const before = JSON.stringify(candidate);
  const [f] = enrichVerifiedCandidates([candidate], [RECORD]);
  assert.strictEqual(f.record_id, 'UK_TEST_RULE');
  assert.strictEqual(f.kind, 'behavioural');
  assert.strictEqual(f.confidence_hint, 'strong');
  assert.deepStrictEqual(f.artifact, candidate.artifact);
  assert.strictEqual(JSON.stringify(candidate), before, 'the input candidate object is not mutated');
});

test('a QUOTE artifact lifts its verbatim span to evidence_quote; a non-quote artifact lifts nothing', () => {
  const quoteCand = { record_id: 'UK_TEST_RULE', duty_idx: 0, artifact: { type: 'quote', text: 'we guarantee to win your case' } };
  const [q] = enrichVerifiedCandidates([quoteCand], [RECORD]);
  assert.strictEqual(q.evidence_quote, 'we guarantee to win your case');
  const netCand = { record_id: 'UK_TEST_RULE', duty_idx: 0, artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'x', name: '_ga' } };
  const [n] = enrichVerifiedCandidates([netCand], [RECORD]);
  assert.strictEqual(n.evidence_quote, undefined);
  assert.strictEqual(quoteFromArtifact(quoteCand), 'we guarantee to win your case');
});

test('KNOWN-BAD calibration: a candidate whose record_id resolves to NO record degrades honestly, never fabricates or throws', () => {
  const orphan = { record_id: 'DOES_NOT_EXIST', duty_idx: 0, kind: 'behavioural', artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'x', name: '_ga' } };
  let out;
  assert.doesNotThrow(() => { out = enrichVerifiedCandidates([orphan], [RECORD]); });
  const [f] = out;
  assert.strictEqual(f.framework, '', 'no record -> no invented framework name (Rule 2)');
  assert.strictEqual(f.statutory_citation, '', 'no record -> no invented citation');
  assert.strictEqual(f.record_id, 'DOES_NOT_EXIST', 'the candidate still passes through, never dropped');
});

test('catalogueRecordIndex skips records with no id and tolerates a non-array input', () => {
  const idx = catalogueRecordIndex([RECORD, { name: 'no id' }, null]);
  assert.strictEqual(idx.size, 1);
  assert.ok(idx.has('UK_TEST_RULE'));
  assert.strictEqual(catalogueRecordIndex(null).size, 0);
});

test('joinCatalogueFacts on a null record yields empty catalogue fields but keeps the candidate', () => {
  const f = joinCatalogueFacts({ record_id: 'X', duty_idx: 0, artifact: { type: 'coverage_proof' } }, null);
  assert.strictEqual(f.framework, '');
  assert.strictEqual(f.record_id, 'X');
});
