'use strict';
// breach/adjudicator/evidence-kind.test.js - node:test for the absence-vs-observation gate.
// Run: node --test breach/adjudicator/evidence-kind.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyEvidenceKind, artifactKindOf, declaredKindOf,
  OBSERVED_ARTIFACT_TYPES, REGISTER_ARTIFACT_TYPES, KINDS, BYPASS_KINDS,
} = require('./evidence-kind.js');

// A minimal candidate: the caller merges in the artifact/quote/declaration under test.
function cand(over) {
  return Object.assign({ code: 'RULE_X', framework: 'FW', description: 'the obligation' }, over || {});
}

test('observed-behaviour artifacts -> observation, and they BYPASS the model', () => {
  for (const type of OBSERVED_ARTIFACT_TYPES) {
    const c = classifyEvidenceKind(cand({ artifact: { type } }));
    assert.equal(c.kind, 'observation', type + ' should classify as observation');
    assert.equal(c.bypass, true, type + ' must bypass adjudication (C-084)');
    assert.equal(c.valid, true);
  }
});

test('register-row artifacts -> register, and they BYPASS the model', () => {
  for (const type of REGISTER_ARTIFACT_TYPES) {
    const c = classifyEvidenceKind(cand({ artifact: { type } }));
    assert.equal(c.kind, 'register');
    assert.equal(c.bypass, true);
    assert.equal(c.valid, true);
  }
});

// ── the CANONICAL breach/artifact-types.js enum (the one door the proposer/verifier flow emits): each
//    of the five canonical types must classify correctly, or a real candidate is misrouted (the C-084
//    disease this reconciliation closes). ─────────────────────────────────────────────────────────────
test('CANONICAL: network_event -> observation and bypasses (a real PECR observation must not be quarantined)', () => {
  const c = classifyEvidenceKind(cand({ artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'ga.example', name: '_ga' } }));
  assert.equal(c.kind, 'observation');
  assert.equal(c.bypass, true);
  assert.equal(c.valid, true);
});

test('CANONICAL: register_row -> register and bypasses', () => {
  const c = classifyEvidenceKind(cand({ artifact: { type: 'register_row', register: 'sra', row: {} } }));
  assert.equal(c.kind, 'register');
  assert.equal(c.bypass, true);
  assert.equal(c.valid, true);
});

test('CANONICAL: register_absence -> absence and NEVER bypasses (a weak no-match must be quarantined, Rule 6)', () => {
  const c = classifyEvidenceKind(cand({ artifact: { type: 'register_absence', register: 'sra', lane: 'no_match' } }));
  assert.equal(c.kind, 'absence', 'a register no-match is adjudicated/quarantined, not a bypassing register fact');
  assert.equal(c.bypass, false, 'a weak no-match must never bypass to a hard violation');
  assert.equal(c.valid, true);
});

test('CANONICAL: quote and coverage_proof are the text/absence class and never bypass', () => {
  const q = classifyEvidenceKind(cand({ artifact: { type: 'quote', text: 'we guarantee results', surface: 'visible_text' } }));
  assert.equal(q.kind, 'absence');
  assert.equal(q.bypass, false);
  const cp = classifyEvidenceKind(cand({ artifact: { type: 'coverage_proof', page_class: 'complaints', pages_checked: ['https://x/'], tier1_fetched: true, truncated: false } }));
  assert.equal(cp.kind, 'absence');
  assert.equal(cp.bypass, false);
});

test('a verbatim quote (presence) is the text class -> absence, never bypasses', () => {
  const c = classifyEvidenceKind(cand({ artifact: { type: 'corpus_quote' }, evidence_quote: 'we are the number one clinic' }));
  assert.equal(c.kind, 'absence');
  assert.equal(c.bypass, false, 'a matched quote still needs the model (practice-area false positive)');
  assert.equal(c.valid, true);
});

test('an absence claim (required disclosure missing) -> absence, never bypasses', () => {
  const c = classifyEvidenceKind(cand({ artifact: { type: 'absence_claim' }, absence_evidence: { pages_checked: 12, nearest_quote: '' } }));
  assert.equal(c.kind, 'absence');
  assert.equal(c.bypass, false);
  assert.equal(c.valid, true);
});

test('MASQUERADE (the fabrication vector): a text claim declaring itself an observation is REJECTED', () => {
  // This is the exact bypass an absence claim would use to skip the model and ship as a hard violation.
  const c = classifyEvidenceKind(cand({ evidence_kind: 'observation', artifact: { type: 'corpus_quote' }, evidence_quote: 'sex discrimination' }));
  assert.equal(c.valid, false, 'a declared observation with a text artifact must be rejected');
  assert.equal(c.bypass, false, 'a masquerade must NEVER bypass the model');
  assert.equal(c.kind, 'absence', 'the artifact governs the resolved kind');
  assert.match(c.reason, /mismatch/i);
});

test('MASQUERADE the other way (C-085): a real observation mislabelled absence is REJECTED, never silently dropped', () => {
  const c = classifyEvidenceKind(cand({ evidence_kind: 'absence', artifact: { type: 'network_request' } }));
  assert.equal(c.valid, false);
  assert.equal(c.bypass, false);
  assert.equal(c.kind, 'observation');
});

test('a declared kind that AGREES with the artifact is valid and routes normally', () => {
  const obs = classifyEvidenceKind(cand({ evidence_kind: 'observed-behaviour', artifact: { type: 'cookie_jar_entry' } }));
  assert.equal(obs.valid, true);
  assert.equal(obs.bypass, true);
  const abs = classifyEvidenceKind(cand({ evidence_kind: 'document-absence', artifact: { type: 'absence' } }));
  assert.equal(abs.valid, true);
  assert.equal(abs.bypass, false);
});

test('no deterministic artifact at all -> rejected (Rule 3: no artifact, no breach)', () => {
  const c = classifyEvidenceKind(cand({}));
  assert.equal(c.valid, false);
  assert.equal(c.bypass, false);
  assert.match(c.reason, /no deterministic artifact/i);
});

test('a bypass kind declared with NO artifact to back it is rejected (not trusted on the label)', () => {
  const c = classifyEvidenceKind(cand({ evidence_kind: 'register' }));
  assert.equal(c.valid, false);
  assert.equal(c.bypass, false);
  assert.match(c.reason, /no deterministic artifact/i);
});

test('port-compat legacy shape: absence_evidence.state carries the observed/register bypass signal', () => {
  const browser = classifyEvidenceKind(cand({ absence_evidence: { state: 'observed_in_browser' } }));
  assert.equal(browser.kind, 'observation');
  assert.equal(browser.bypass, true);
  const register = classifyEvidenceKind(cand({ absence_evidence: { state: 'public_register_checked' } }));
  assert.equal(register.kind, 'register');
  assert.equal(register.bypass, true);
});

test('every resolved kind is a member of the closed KINDS enum; only observation/register bypass', () => {
  const samples = [
    cand({ artifact: { type: 'network_request' } }),
    cand({ artifact: { type: 'register_row' } }),
    cand({ artifact: { type: 'corpus_quote' }, evidence_quote: 'x' }),
    cand({}),
  ];
  for (const s of samples) {
    const c = classifyEvidenceKind(s);
    assert.ok(KINDS.has(c.kind), 'kind ' + c.kind + ' must be in the closed enum');
    assert.equal(c.bypass, c.valid && BYPASS_KINDS.has(c.kind));
  }
});

test('artifactKindOf / declaredKindOf are pure helpers with the documented return domain', () => {
  assert.equal(artifactKindOf(cand({ artifact: { type: 'network_request' } })), 'observation');
  assert.equal(artifactKindOf(cand({})), null, 'no artifact -> null (a Rule-3 reject upstream)');
  assert.equal(declaredKindOf(cand({ evidence_kind: 'PRESENCE' })), 'absence', 'presence canonicalises to the text class');
  assert.equal(declaredKindOf(cand({})), null);
  assert.equal(declaredKindOf(cand({ evidence_kind: 42 })), null, 'a non-string declaration is no declaration');
});

test('the classifier never throws on malformed input', () => {
  for (const bad of [undefined, null, 0, '', [], { artifact: 'not-an-object' }, { artifact: { type: 5 } }]) {
    assert.doesNotThrow(() => classifyEvidenceKind(bad));
    const c = classifyEvidenceKind(bad);
    assert.equal(c.valid, false, 'malformed input can never be a valid bypass');
  }
});
