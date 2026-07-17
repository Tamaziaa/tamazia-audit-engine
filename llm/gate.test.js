'use strict';
// llm/gate.test.js - node:test suite for the post-hoc structural gate.
// Run: node --test llm/gate.test.js
//
// Proves the fail-closed AND-chain (Constitution Rule 11/12): parse -> schema -> retrieval-gate
// (gate 1) -> verbatim quote re-match (gate 2). Every rejection returns ABSTAIN semantics
// (ok:false, value:null), never a repaired answer. Scripted good and known-bad inputs cover garbage
// JSON, out-of-set citations, drifted quotes, short quotes, missing sources and schema breaks.

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./gate.js');

// The adjudicator-shaped response schema reused across cases (finding_id + verdict required).
const SCHEMA = {
  type: 'object',
  required: ['finding_id', 'verdict'],
  additionalProperties: true,
  properties: {
    finding_id: { type: 'string', minLength: 1 },
    verdict: { type: 'string', enum: ['violation', 'needs-review', 'pass'] },
    source_id: { type: 'string', minLength: 1 },
    quote: { type: 'string', minLength: 8 },
  },
};
const SOURCES = {
  S1: 'We do not set any non-essential cookies until you have given your explicit consent.',
  S2: 'You can withdraw consent at any time from the footer link.',
};
const ALLOWED = ['S1', 'S2'];

function codes(result) {
  return (result.violations || []).map((v) => v.code);
}

// ---- positive control ----

test('accepts a clean, in-set, verbatim response', () => {
  const response = JSON.stringify({
    finding_id: 'F-1', verdict: 'violation', source_id: 'S1',
    quote: 'we do not set any non-essential cookies',
  });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
  assert.equal(r.value.verdict, 'violation');
});

test('accepts a needs-review verdict that cites nothing (abstain-by-default is structurally valid)', () => {
  const response = JSON.stringify({ finding_id: 'F-2', verdict: 'needs-review', rationale: 'insufficient evidence' });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, true);
});

// ---- step 0: parse ----

test('rejects unparseable JSON with abstain semantics', () => {
  const r = gate.validateResponse('not json at all', { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.equal(r.abstain, true);
  assert.ok(codes(r).includes('unparseable_json'));
});

test('rejects a null response and an empty string', () => {
  assert.equal(gate.validateResponse(null, {}).ok, false);
  assert.equal(gate.validateResponse('', {}).ok, false);
  assert.ok(codes(gate.validateResponse(null, {})).includes('empty_response'));
});

test('rejects a failed router response (ok:false)', () => {
  const r = gate.validateResponse({ ok: false, reason: 'all_providers_exhausted' }, { schema: SCHEMA });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('provider_unavailable'));
});

test('parses JSON embedded in prose and code fences', () => {
  const wrapped = 'Here is my verdict:\n```json\n{"finding_id":"F-3","verdict":"pass","source_id":"S2","quote":"you can withdraw consent at any time"}\n```\nDone.';
  const r = gate.validateResponse(wrapped, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, true);
});

test('accepts a pre-parsed object with no .text field', () => {
  const r = gate.validateResponse({ finding_id: 'F-4', verdict: 'needs-review' }, { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, true);
});

// ---- gate 1: retrieval-gated emission ----

test('gate 1: an out-of-set source_id in the source_id field is hard-rejected', () => {
  const response = JSON.stringify({ finding_id: 'F-5', verdict: 'violation', source_id: 'S9' });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('out_of_set_source_id'));
});

test('gate 1: with no allowedSourceIds supplied, ANY citation is refused (fail-closed)', () => {
  const response = JSON.stringify({ finding_id: 'F-6', verdict: 'violation', source_id: 'S1' });
  const r = gate.validateResponse(response, { schema: SCHEMA });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('out_of_set_source_id'));
});

test('gate 1: nested and plural source_ids are all collected and gated', () => {
  const value = { finding_id: 'F-7', verdict: 'needs-review', extra: { source_ids: ['S1', 'S9'] } };
  const r = gate.validateResponse(value, { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  const outOfSet = (r.violations || []).filter((v) => v.code === 'out_of_set_source_id');
  assert.equal(outOfSet.length, 1);
  assert.equal(outOfSet[0].id, 'S9');
});

// ---- gate 2: verbatim quote re-match ----

test('gate 2: a paraphrased (drifted) quote is hard-rejected', () => {
  const response = JSON.stringify({ finding_id: 'F-8', verdict: 'violation', source_id: 'S1', quote: 'we never use tracking cookies without consent' });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('quote_drift'));
});

test('gate 2: a quote shorter than the floor is rejected', () => {
  const response = JSON.stringify({ finding_id: 'F-9', verdict: 'violation', source_id: 'S1', quote: 'cookies' });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: SOURCES });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('quote_too_short'));
});

test('gate 2: a quote whose source text was not supplied cannot be verified and is rejected', () => {
  const response = JSON.stringify({ finding_id: 'F-10', verdict: 'violation', source_id: 'S2', quote: 'you can withdraw consent at any time' });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ALLOWED, sources: { S1: SOURCES.S1 } });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('quote_source_missing'));
});

test('gate 2: normalisation folds case, whitespace and curly quotes so a real verbatim quote still matches', () => {
  const sources = { S1: 'We  don’t  sell your   data to anyone.' };
  const response = JSON.stringify({ finding_id: 'F-11', verdict: 'violation', source_id: 'S1', quote: "we don't sell your data" });
  const r = gate.validateResponse(response, { schema: SCHEMA, allowedSourceIds: ['S1'], sources });
  assert.equal(r.ok, true);
});

// ---- step 1: schema ----

test('schema: a missing required field is a violation', () => {
  const r = gate.validateResponse(JSON.stringify({ verdict: 'pass' }), { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('schema'));
});

test('schema: a verdict outside the closed enum is a violation', () => {
  const r = gate.validateResponse(JSON.stringify({ finding_id: 'F-12', verdict: 'MAYBE' }), { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('schema'));
});

test('schema: a type mismatch is a violation', () => {
  const r = gate.validateResponse(JSON.stringify({ finding_id: 7, verdict: 'pass' }), { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('schema'));
});

test('schema: additionalProperties:false rejects an unexpected key', () => {
  const strict = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'string' } } };
  const r = gate.validateResponse(JSON.stringify({ a: 'x', b: 'y' }), { schema: strict, allowedSourceIds: [] });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('schema'));
});

// ---- adversarial / robustness ----

test('a deeply nested adversarial value does not crash and its out-of-set id is still caught within depth', () => {
  let node = { source_id: 'S9' };
  for (let i = 0; i < 6; i += 1) node = { nested: node };
  const r = gate.validateResponse({ finding_id: 'F-13', verdict: 'needs-review', deep: node }, { schema: SCHEMA, allowedSourceIds: ALLOWED });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('out_of_set_source_id'));
});

test('collectCitations gathers both source_id fields and quote pairs', () => {
  const cites = gate.collectCitations({ verdict: 'violation', source_id: 'S1', quote: 'hello world quote', items: [{ source_ids: ['S2'] }] });
  const ids = cites.sourceIds.map((s) => s.id).sort();
  assert.deepEqual(ids, ['S1', 'S2']);
  assert.equal(cites.quotes.length, 1);
  assert.equal(cites.quotes[0].sourceId, 'S1');
});

// ---- calibration self-check ----

test('runCalibration emits a finding for each of the two known-bad p3-llm fixtures', () => {
  const findings = gate.runCalibration();
  assert.ok(findings.length >= 2, 'expected the two p3-llm fixtures to be caught');
  const files = findings.map((f) => f.file);
  assert.ok(files.some((f) => f.includes('p3-llm-outofset-citation.json')));
  assert.ok(files.some((f) => f.includes('p3-llm-quote-drift.json')));
});
