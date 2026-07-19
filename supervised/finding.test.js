'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createFinding, withMitigation, FINDING_CLASS, deriveFindingId, isFinding } = require('./finding.js');
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
  assert.strictEqual(f.finding_id, deriveFindingId('UK_TEST_RULE', VALID_QUOTE, FINDING_CLASS.LIKELY, 'UK'));
  assert.deepStrictEqual(f.mitigation_log, []);
  assert.ok(f.engine_version);
  assert.ok(isFinding(f));
});

// Kimi K3 finding E1 (live audit 2026-07-20): deriveFindingId's basis previously carried only
// rule_id + quote, so a finding could be re-derived with a DIFFERENT class or jurisdiction over the exact
// same evidence and land on the SAME finding_id - a signature recorded for a needs_human finding would
// silently also cover a rebuilt confirmed finding, and a jurisdiction flip (UK->US) would be invisible to
// any id-keyed check. class and jurisdiction are now part of the basis, so either change mints a different id.
test('E1: the SAME quote under a DIFFERENT class mints a DIFFERENT finding_id', () => {
  const needsHuman = createFinding(Object.assign({}, VALID, { class: FINDING_CLASS.NEEDS_HUMAN }));
  const confirmed = createFinding(Object.assign({}, VALID, { class: FINDING_CLASS.CONFIRMED }));
  assert.notStrictEqual(needsHuman.finding_id, confirmed.finding_id);
});

test('E1: the SAME quote under a DIFFERENT jurisdiction mints a DIFFERENT finding_id', () => {
  const uk = createFinding(Object.assign({}, VALID, { jurisdiction: 'UK' }));
  const us = createFinding(Object.assign({}, VALID, { jurisdiction: 'US' }));
  assert.notStrictEqual(uk.finding_id, us.finding_id);
});

test('createFinding() output is BRANDED (isFinding true); a field-correct look-alike is not', () => {
  const f = createFinding(VALID);
  assert.strictEqual(isFinding(f), true);
  const lookalike = Object.assign({}, f); // every field copied, but never went through createFinding()
  assert.strictEqual(isFinding(lookalike), false);
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

// CodeRabbit review (PR #36): Object.freeze(finding) is shallow - a caller mutating finding.quote's own
// fields AFTER finding_id was derived would silently invalidate the anti-drift guarantee this whole
// module exists for (finding_id would no longer match the mutated quote, but every consumer that trusts
// finding_id as the integrity key would not know). The quote object and the mitigation_log array must
// both be frozen too, not just the top-level Finding.
test('the quote and mitigation_log are frozen too (not just the top-level Finding) - a mutation attempt fails or is a no-op', () => {
  const f = createFinding(VALID);
  assert.ok(Object.isFrozen(f.quote));
  assert.ok(Object.isFrozen(f.mitigation_log));
  const originalByteStart = f.quote.byte_start;
  assert.throws(() => { 'use strict'; f.quote.byte_start = 99999; });
  assert.strictEqual(f.quote.byte_start, originalByteStart);
  assert.throws(() => { 'use strict'; f.mitigation_log.push({ fake: true }); });
  assert.strictEqual(f.mitigation_log.length, 0);
});

test('withMitigation appends without mutating the original frozen finding', () => {
  const f = createFinding(VALID);
  const f2 = withMitigation(f, { source: 'claude-adversarial', outcome: 'unverifiable' });
  assert.strictEqual(f.mitigation_log.length, 0);
  assert.strictEqual(f2.mitigation_log.length, 1);
  assert.ok(Object.isFrozen(f2));
  assert.ok(Object.isFrozen(f2.mitigation_log));
  assert.ok(isFinding(f2), 'the new finding returned by withMitigation must itself be branded');
});

// Kimi K3 finding E4 (live audit 2026-07-20): withMitigation() froze the mitigation_log ARRAY but not the
// entry objects inside it, so a caller holding a reference to the object it passed in could mutate a
// recorded verdict (e.g. flip `verified` or `outcome`) AFTER it was logged - the audit trail was not
// actually tamper-proof. Entries are now deep-frozen clones, severed from the caller's own reference.
test('E4: a mitigation_log entry is deep-frozen and severed from the caller\'s own object (mutation after the fact is impossible)', () => {
  const f = createFinding(VALID);
  const entry = { source: 'claude-adversarial', outcome: 'unverifiable', artifact_ref: { evidence_id: 'ev1' } };
  const f2 = withMitigation(f, entry);
  // mutating the CALLER's original object must not affect the recorded copy (structuredClone severed it).
  entry.outcome = 'TAMPERED';
  entry.artifact_ref.evidence_id = 'TAMPERED';
  assert.strictEqual(f2.mitigation_log[0].outcome, 'unverifiable');
  assert.strictEqual(f2.mitigation_log[0].artifact_ref.evidence_id, 'ev1');
  // the logged entry itself, including its nested fields, is frozen (not just the top-level array).
  assert.ok(Object.isFrozen(f2.mitigation_log[0]));
  assert.ok(Object.isFrozen(f2.mitigation_log[0].artifact_ref));
  assert.throws(() => { 'use strict'; f2.mitigation_log[0].outcome = 'nope'; });
  assert.throws(() => { 'use strict'; f2.mitigation_log[0].artifact_ref.evidence_id = 'nope'; });
});

test('E4: withMitigation refuses a field-correct look-alike that never went through createFinding()', () => {
  const real = createFinding(VALID);
  const lookalike = Object.assign({}, real); // same fields, never branded
  assert.throws(() => withMitigation(lookalike, { source: 'x', outcome: 'unverifiable' }), FindingConstructionError);
});

test('the KNOWN-BAD calibration fixture: a fabricated finding with a fake byte range is still SHAPE-valid here (construction only checks shape, not reality) but must fail verify_quote downstream', () => {
  // This is the documented boundary: createFinding() enforces STRUCTURE, not REALITY. A fabricated quote
  // pointing at an evidence_id that does not exist can still be constructed (it is well-formed), and that
  // is BY DESIGN - the reality check is verify-quote.js's job (see verify-quote.test.js's own known-bad
  // fixture for the actual anti-fake proof).
  const fake = createFinding(Object.assign({}, VALID, { quote: { evidence_id: 'never-captured-artifact', byte_start: 0, byte_end: 999999, span_sha256: FAKE_SPAN_HASH } }));
  assert.strictEqual(fake.quote.evidence_id, 'never-captured-artifact');
});
