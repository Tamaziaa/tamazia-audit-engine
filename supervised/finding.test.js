'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createFinding, withMitigation, FINDING_CLASS, deriveFindingId } = require('./finding.js');
const { FindingConstructionError } = require('./errors.js');

// A syntactically-valid 64-char lowercase-hex span_sha256 (shape-valid per SPAN_HASH_RE). createFinding()
// only checks SHAPE (see the "KNOWN-BAD calibration fixture" test below for the reality-check boundary),
// so this fixture value need not be a real hash of anything for these construction-level tests.
const FAKE_SPAN_HASH = 'a'.repeat(64);
const VALID_QUOTE = { evidence_id: 'ev1', byte_start: 10, byte_end: 20, span_sha256: FAKE_SPAN_HASH };
const VALID = { rule_id: 'UK_TEST_RULE', catalogue_hash: 'abc123', quote: VALID_QUOTE, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY };

test('createFinding builds a frozen finding with a derived, deterministic finding_id', () => {
  const f = createFinding(VALID);
  assert.ok(Object.isFrozen(f));
  assert.strictEqual(f.rule_id, 'UK_TEST_RULE');
  assert.strictEqual(f.finding_id, deriveFindingId('UK_TEST_RULE', VALID_QUOTE));
  assert.deepStrictEqual(f.mitigation_log, []);
  assert.ok(f.engine_version);
});

test('a finding is UNCONSTRUCTIBLE without a quote (Kimi spec: no raw-string quote, ever)', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: undefined })), FindingConstructionError);
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: 'a raw string quote' })), FindingConstructionError);
});

test('a quote carrying a raw text field is rejected even when the byte range looks fine', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 1, byte_end: 5, span_sha256: FAKE_SPAN_HASH, quote_text: 'sneaky' } })), FindingConstructionError);
});

test('malformed byte ranges are rejected: negative, non-integer, end<=start', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: -1, byte_end: 5, span_sha256: FAKE_SPAN_HASH } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 1.5, byte_end: 5, span_sha256: FAKE_SPAN_HASH } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 5, byte_end: 5, span_sha256: FAKE_SPAN_HASH } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 5, byte_end: 3, span_sha256: FAKE_SPAN_HASH } })));
});

test('an empty or missing evidence_id is rejected', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: '', byte_start: 1, byte_end: 5, span_sha256: FAKE_SPAN_HASH } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { byte_start: 1, byte_end: 5, span_sha256: FAKE_SPAN_HASH } })));
});

test('a missing or malformed span_sha256 is rejected (the anti-drift commitment is mandatory, not optional)', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 1, byte_end: 5 } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 1, byte_end: 5, span_sha256: 'not-a-hash' } })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'ev1', byte_start: 1, byte_end: 5, span_sha256: 'ABCDEF' + 'a'.repeat(58) } }))); // uppercase not accepted
});

test('missing rule_id / catalogue_hash / jurisdiction / class all throw', () => {
  assert.throws(() => createFinding(Object.assign({}, VALID, { rule_id: '' })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { catalogue_hash: '' })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { jurisdiction: '' })));
  assert.throws(() => createFinding(Object.assign({}, VALID, { class: 'super-confident' })));
});

test('withMitigation appends without mutating the original frozen finding', () => {
  const f = createFinding(VALID);
  const f2 = withMitigation(f, { source: 'claude-adversarial', outcome: 'unverifiable' });
  assert.strictEqual(f.mitigation_log.length, 0);
  assert.strictEqual(f2.mitigation_log.length, 1);
  assert.ok(Object.isFrozen(f2));
});

test('the KNOWN-BAD calibration fixture: a fabricated finding with a fake byte range is still SHAPE-valid here (construction only checks shape, not reality) but must fail verify_quote downstream', () => {
  // This is the documented boundary: createFinding() enforces STRUCTURE, not REALITY. A fabricated quote
  // pointing at an evidence_id that does not exist can still be constructed (it is well-formed), and that
  // is BY DESIGN - the reality check is verify-quote.js's job (see verify-quote.test.js's own known-bad
  // fixture for the actual anti-fake proof).
  const fake = createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'never-captured-artifact', byte_start: 0, byte_end: 999999, span_sha256: FAKE_SPAN_HASH } }));
  assert.strictEqual(fake.quote.evidence_id, 'never-captured-artifact');
});
