'use strict';
// supervised/nonquote-lane.test.js - Kimi K3 10Q Q1/Q2/Q7 step 5: proves classifyOneCandidate resolves
// dom_node/network_event/coverage_proof/register_absence candidates into REAL, hash-anchored needs_human
// findings (never a fake span into an unrelated artifact), and that mint-gate's checkEvidence re-verifies
// them against the live capture index.

const test = require('node:test');
const assert = require('node:assert');
const { buildCaptureIndex } = require('./capture-index.js');
const { classifyOneCandidate } = require('./run-harness.js');
const { checkEvidence } = require('./mint-gate.js');
const { ARTIFACT_TYPES } = require('../breach/artifact-types.js');

function fakeBundle() {
  return {
    domain: 'example.test',
    corpus: { pages: [{ url: 'https://example.test/', text: 'Welcome to Example. We sell things.' }] },
    browser: {
      domNodes: [{ rule_id: 'image-alt', state: 'violation', selector: 'img.hero', snippet: '<img>', wcag_sc: '1.1.1', page_url: 'https://example.test/' }],
      observed: [{ kind: 'cookie_pre_consent', host: 'example.test', name: '_ga' }],
    },
    registers: { companies_house: {}, notes: [{ register: 'companies_house', kind: 'no_match', query: 'Example Ltd' }] },
  };
}

function ctxFor(bundle) {
  const captureIndex = buildCaptureIndex(bundle, { now: () => 0 });
  return { catalogue: { content_hash: 'testhash' }, captureIndex, facts: {}, catalogueHash: 'testhash', bundle, fetchedAt: '1970-01-01T00:00:00.000Z' };
}

test('classifyOneCandidate resolves a dom_node candidate into a real needs_human finding anchored in the dom evidence-log', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = { record_id: 'TEST_ACCESSIBILITY', artifact: Object.assign({ type: ARTIFACT_TYPES.DOM_NODE }, bundle.browser.domNodes[0]) };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'finding');
  assert.strictEqual(outcome.value.class, 'needs_human');
  assert.strictEqual(outcome.value.evidence_kind, 'dom_node');
  const check = checkEvidence(ctx.captureIndex, [outcome.value]);
  assert.strictEqual(check.ok, true, JSON.stringify(check));
});

test('classifyOneCandidate resolves a network_event candidate into a real needs_human finding anchored in the network evidence-log', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = { record_id: 'TEST_PECR', artifact: Object.assign({ type: ARTIFACT_TYPES.NETWORK_EVENT }, bundle.browser.observed[0]) };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'finding');
  assert.strictEqual(outcome.value.class, 'needs_human');
  assert.strictEqual(outcome.value.evidence_kind, 'network_event');
  const check = checkEvidence(ctx.captureIndex, [outcome.value]);
  assert.strictEqual(check.ok, true, JSON.stringify(check));
});

test('classifyOneCandidate resolves a register_absence candidate into a real needs_human finding carrying a coverage proof', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = { record_id: 'TEST_REGISTER', artifact: { type: ARTIFACT_TYPES.REGISTER_ABSENCE, register: 'companies_house', query: 'Example Ltd', lane: 'no_match', note: { register: 'companies_house', kind: 'no_match' } } };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'finding');
  assert.strictEqual(outcome.value.class, 'needs_human');
  assert.strictEqual(outcome.value.evidence_kind, 'register_absence');
  assert.ok(outcome.value.coverage);
  assert.strictEqual(outcome.value.coverage.subjects.length, 1);
  const check = checkEvidence(ctx.captureIndex, [outcome.value]);
  assert.strictEqual(check.ok, true, JSON.stringify(check));
});

test('classifyOneCandidate resolves a coverage_proof (absence-breach) candidate into a real needs_human finding', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = {
    record_id: 'TEST_ABSENCE', artifact: {
      type: ARTIFACT_TYPES.COVERAGE_PROOF, page_class: 'any', surface: 'body',
      pages_checked: ['https://example.test/'], searched_patterns: ['privacy policy'],
      tier1_fetched: true, truncated: false,
    },
  };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'finding');
  assert.strictEqual(outcome.value.class, 'needs_human');
  assert.strictEqual(outcome.value.evidence_kind, 'coverage_proof');
  const check = checkEvidence(ctx.captureIndex, [outcome.value]);
  assert.strictEqual(check.ok, true, JSON.stringify(check));
});

test('KNOWN-BAD CALIBRATION: checkEvidence refuses an absence finding whose coverage subject artifact was mutated after capture', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = { record_id: 'TEST_REGISTER', artifact: { type: ARTIFACT_TYPES.REGISTER_ABSENCE, register: 'companies_house', query: 'Example Ltd', lane: 'no_match', note: { register: 'companies_house', kind: 'no_match' } } };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'finding');
  // Tamper: flip a byte on the live register artifact the coverage proof committed to.
  const subjectId = outcome.value.coverage.subjects[0].evidence_id;
  const art = ctx.captureIndex.get(subjectId);
  art.bytes[0] = art.bytes[0] ^ 0xff;
  const check = checkEvidence(ctx.captureIndex, [outcome.value]);
  assert.strictEqual(check.ok, false);
  assert.strictEqual(check.reasonCode, 'absence_recompute_mismatch');
});

test('a candidate with an unrecognised/missing artifact type still lands on nonQuote, never crashes or fabricates a finding', () => {
  const bundle = fakeBundle();
  const ctx = ctxFor(bundle);
  const candidate = { record_id: 'TEST_UNKNOWN', artifact: null };
  const outcome = classifyOneCandidate({ candidate }, ctx);
  assert.strictEqual(outcome.kind, 'nonQuote');
});
