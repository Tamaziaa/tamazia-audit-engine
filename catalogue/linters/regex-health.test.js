'use strict';
// catalogue/linters/regex-health.test.js - node:test suite for the earn-your-zero regex gate
// (caution.md C-050). Run: node --test catalogue/linters/regex-health.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const linter = require('./regex-health.js');
const lib = require('./lib.js');
const { packsDirOrFail } = require('./test-helpers.js');

// ---------------------------------------------------------------------------------
// walkForPatternFields
// ---------------------------------------------------------------------------------

test('walkForPatternFields: finds a nested pattern field and reports its direct parent object', () => {
  const record = { id: 'X', detection: { pattern: 'a', positive_example: 'a' } };
  const found = linter.walkForPatternFields(record, 'record', []);
  assert.equal(found.length, 1);
  assert.equal(found[0].pattern, 'a');
  assert.equal(found[0].parent, record.detection);
});

test('walkForPatternFields: recognises pattern/regex/regex_pattern/detect/detection/check_spec (case-insensitively) and ignores unrelated fields', () => {
  const record = { pattern: 'p1', Regex: 'p2', regex_pattern: 'p3', detect: 'p4', check_spec: 'p5', name: 'not a pattern field' };
  const found = linter.walkForPatternFields(record, 'record', []);
  assert.equal(found.length, 5);
});

test('walkForPatternFields: walks arrays', () => {
  const record = { rules: [{ pattern: 'a' }, { pattern: 'b' }] };
  const found = linter.walkForPatternFields(record, 'record', []);
  assert.equal(found.length, 2);
});

test('walkForPatternFields: never throws on null/primitive nodes', () => {
  assert.doesNotThrow(() => linter.walkForPatternFields(null, 'record', []));
  assert.doesNotThrow(() => linter.walkForPatternFields(42, 'record', []));
  assert.doesNotThrow(() => linter.walkForPatternFields('a string', 'record', []));
});

// ---------------------------------------------------------------------------------
// checkRecord: earn-your-zero contract
// ---------------------------------------------------------------------------------

test('checkRecord: a record with zero regex-bearing fields reports patternCount 0 and zero findings (the honest-zero doctrine)', () => {
  const r = { id: 'CAL_TEST_ZERO', name: 'no patterns here at all' };
  const res = linter.checkRecord(r, 'test');
  assert.equal(res.patternCount, 0);
  assert.deepEqual(res.findings, []);
});

test('checkRecord: an uncompilable pattern is flagged regex-health/pattern-does-not-compile', () => {
  const r = { id: 'CAL_TEST_BAD_COMPILE', detection: { pattern: '(unclosed', positive_example: 'x' } };
  const res = linter.checkRecord(r, 'test');
  assert.ok(res.findings.some((f) => f.rule === 'regex-health/pattern-does-not-compile'));
});

test('checkRecord: a pattern with no positive_example is flagged regex-no-positive-example', () => {
  const r = { id: 'CAL_TEST_NO_EXAMPLE', regex_pattern: 'dpo@' };
  const res = linter.checkRecord(r, 'test');
  assert.ok(res.findings.some((f) => f.rule === 'regex-no-positive-example'));
});

test('checkRecord: a pattern that compiles and has a positive_example but does not match it is flagged regex-dead-pattern (the over-escaped C-050 class)', () => {
  const r = { id: 'CAL_TEST_DEAD', detection: { pattern: 'dpo[@\\\\s]', positive_example: 'please contact our dpo team directly' } };
  const res = linter.checkRecord(r, 'test');
  assert.ok(res.findings.some((f) => f.rule === 'regex-dead-pattern'));
});

test('checkRecord: a genuinely matching pattern clears with zero findings and patternCount 1', () => {
  const r = { id: 'CAL_TEST_GOOD', detection: { pattern: 'dpo\\s*@', positive_example: 'email dpo@example.com for data requests' } };
  const res = linter.checkRecord(r, 'test');
  assert.equal(res.patternCount, 1);
  assert.deepEqual(res.findings, []);
});

test('checkRecord: positive_example may live on the record itself (legacy flat-rule shape) rather than nested beside the pattern', () => {
  const r = { id: 'CAL_TEST_TOPLEVEL_EXAMPLE', regex_pattern: 'dpo\\s*@', positive_example: 'email dpo@example.com' };
  const res = linter.checkRecord(r, 'test');
  assert.deepEqual(res.findings, []);
});

test('checkRecord (SCAN-7): a pattern longer than MAX_PATTERN_LENGTH is flagged regex-health/pattern-too-long and is never handed to new RegExp() at all', () => {
  const r = { id: 'CAL_TEST_TOOLONG', detection: { pattern: 'a'.repeat(linter.MAX_PATTERN_LENGTH + 1), positive_example: 'aaa' } };
  const res = linter.checkRecord(r, 'test');
  assert.ok(res.findings.some((f) => f.rule === 'regex-health/pattern-too-long'));
  assert.ok(!res.findings.some((f) => f.rule === 'regex-health/pattern-does-not-compile'), 'an over-long pattern must be refused BEFORE compilation is attempted');
});

test('checkRecord: a pattern at exactly MAX_PATTERN_LENGTH is not flagged pattern-too-long', () => {
  const r = { id: 'CAL_TEST_ATLIMIT', detection: { pattern: 'a'.repeat(linter.MAX_PATTERN_LENGTH), positive_example: 'aaa' } };
  const res = linter.checkRecord(r, 'test');
  assert.deepEqual(res.findings.filter((f) => f.rule === 'regex-health/pattern-too-long'), []);
});

test('checkRecord: never throws on a record whose "pattern"-named field is not a regex-shaped string container (e.g. an object rather than a string is walked into, not treated as a pattern)', () => {
  const r = { id: 'CAL_TEST_CONTAINER', pattern: { nested: 'not a pattern string itself' } };
  assert.doesNotThrow(() => linter.checkRecord(r, 'test'));
  const res = linter.checkRecord(r, 'test');
  assert.equal(res.patternCount, 0);
});

// ---------------------------------------------------------------------------------
// selfTest + --calibrate
// ---------------------------------------------------------------------------------

test('selfTest passes', () => {
  const st = linter.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('scan against eval/calibration-known-bad/fixtures catches the seeded p2-regex-dead-pattern.json violation as regex-dead-pattern (not regex-no-positive-example)', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('p2-regex-dead-pattern.json'));
  assert.ok(hit, 'expected a finding on the seeded p2 fixture; got: ' + JSON.stringify(res.violations));
  assert.equal(hit.rule, 'regex-dead-pattern');
});

test('scan against eval/calibration-known-bad/fixtures also still catches the pre-existing legacy rule-dead-regex.json fixture', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('rule-dead-regex.json'));
  assert.ok(hit);
});

// ---------------------------------------------------------------------------------
// Real-pack smoke test (C-148 doctrine)
// ---------------------------------------------------------------------------------

test('scan: real committed packs carry zero regex-bearing fields today (detection is a future migration step) and this is reported as an honest zero, not a false pass', () => {
  packsDirOrFail(__dirname);
  const res = linter.scan([lib.DEFAULT_PACK_GLOB]);
  assert.ok(res.scanned > 0);
  assert.equal(res.patternCount, 0, 'expected zero regex-bearing fields in the current COM packs; got ' + res.patternCount + ' - update this test if a migration has landed regex detection fields');
  assert.deepEqual(res.violations, []);
});
