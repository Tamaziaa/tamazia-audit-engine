'use strict';
// catalogue/linters/threshold-guard.test.js - node:test suite for the threshold-guard linter
// (caution.md C-071 Modern Slavery Act-on-an-SME class + C-096/C-104 statutory-cap-as-headline
// class). Run: node --test catalogue/linters/threshold-guard.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const linter = require('./threshold-guard.js');
const lib = require('./lib.js');
const { packsDirExistsOrSkip } = require('./test-helpers.js');

// ---------------------------------------------------------------------------------
// textMentionsThreshold / hasNonEmptyExcludedWhen
// ---------------------------------------------------------------------------------

test('textMentionsThreshold: detects turnover, revenue, employee-count and SME language across name/applies_when/excluded_when', () => {
  assert.equal(linter.textMentionsThreshold({ name: 'Act (applies above GBP 36 million turnover)' }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['annual revenue over USD 10 million'] }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['employer with 250 or more employees'] }), true);
  assert.equal(linter.textMentionsThreshold({ excluded_when: ['small and medium-sized enterprises are excluded'] }), true);
  assert.equal(linter.textMentionsThreshold({ name: 'A universal privacy notice duty' }), false);
});

test('hasNonEmptyExcludedWhen: true only when at least one non-blank string entry is present', () => {
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['a reason'] }), true);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: [] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['   '] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({}), false);
});

// ---------------------------------------------------------------------------------
// checkRecord: the mandatory contract
// ---------------------------------------------------------------------------------

test('checkRecord: a threshold-mentioning record with an empty excluded_when is flagged threshold-excluded-when-missing (the Modern Slavery Act-on-an-SME class)', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_BAD',
    name: 'Modern Slavery Act 2015 transparency statement',
    applies_when: ['annual turnover of GBP 36 million or more'],
    excluded_when: [],
    penalty: { typical_low: null, typical_high: null, statutory_max: null },
  };
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'threshold-excluded-when-missing'));
});

test('checkRecord: the same threshold-mentioning record clears once excluded_when is populated', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_GOOD',
    name: 'Modern Slavery Act 2015 transparency statement',
    applies_when: ['annual turnover of GBP 36 million or more'],
    excluded_when: ['turnover below GBP 36 million'],
    penalty: { typical_low: null, typical_high: null, statutory_max: null },
  };
  assert.deepEqual(linter.checkRecord(r, 'test'), []);
});

test('checkRecord: a record with no threshold language at all is never flagged threshold-excluded-when-missing even with an empty excluded_when', () => {
  const r = {
    id: 'CAL_TEST_NO_THRESHOLD',
    name: 'A universal privacy notice duty',
    applies_when: ['processes personal data'],
    excluded_when: [],
    penalty: { typical_low: 1000, typical_high: 2000, statutory_max: 3000 },
  };
  assert.deepEqual(linter.checkRecord(r, 'test'), []);
});

test('checkRecord: statutory_max set with both typical bounds null is flagged typical-band-missing as a warning', () => {
  const r = {
    id: 'CAL_TEST_BAND',
    name: 'Some statutory regime',
    penalty: { typical_low: null, typical_high: null, statutory_max: 17500000 },
  };
  const v = linter.checkRecord(r, 'test');
  const hit = v.find((f) => f.rule === 'typical-band-missing');
  assert.ok(hit);
  assert.equal(hit.severity, 'warning');
});

test('checkRecord: statutory_max with either typical bound populated is NOT flagged typical-band-missing', () => {
  const r1 = { id: 'CAL_TEST_BAND_OK1', penalty: { typical_low: 1000, typical_high: null, statutory_max: 17500000 } };
  const r2 = { id: 'CAL_TEST_BAND_OK2', penalty: { typical_low: null, typical_high: 2000, statutory_max: 17500000 } };
  assert.deepEqual(linter.checkRecord(r1, 'test').filter((f) => f.rule === 'typical-band-missing'), []);
  assert.deepEqual(linter.checkRecord(r2, 'test').filter((f) => f.rule === 'typical-band-missing'), []);
});

test('checkRecord: statutory_max null is never flagged typical-band-missing regardless of typical bounds (a non-monetary regime is not a defect)', () => {
  const r = { id: 'CAL_TEST_NONMONETARY', penalty: { typical_low: null, typical_high: null, statutory_max: null } };
  assert.deepEqual(linter.checkRecord(r, 'test'), []);
});

test('checkRecord: never throws on a record with no penalty object at all', () => {
  assert.doesNotThrow(() => linter.checkRecord({ id: 'CAL_TEST_NOPENALTY' }, 'test'));
});

// ---------------------------------------------------------------------------------
// selfTest + --calibrate
// ---------------------------------------------------------------------------------

test('selfTest passes', () => {
  const st = linter.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('scan against eval/calibration-known-bad/fixtures catches the seeded p2-threshold-missing-excluded.json violation', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('p2-threshold-missing-excluded.json') && v.rule === 'threshold-excluded-when-missing');
  assert.ok(hit, 'expected a threshold-excluded-when-missing finding on the seeded p2 fixture; got: ' + JSON.stringify(res.violations));
});

// ---------------------------------------------------------------------------------
// Real-pack smoke test (C-148 doctrine)
// ---------------------------------------------------------------------------------

test('scan: real committed packs produce only the documented typical-band-missing warnings and zero threshold-excluded-when-missing findings', (t) => {
  if (!packsDirExistsOrSkip(t, __dirname)) return;
  const res = linter.scan([lib.DEFAULT_PACK_GLOB]);
  assert.ok(res.scanned > 0);

  assert.deepEqual(res.violations.filter((v) => v.rule === 'threshold-excluded-when-missing'), []);

  const bandMissing = res.violations.filter((v) => v.rule === 'typical-band-missing');
  assert.ok(bandMissing.length >= 5, 'expected several typical-band-missing warnings across the real packs; got ' + bandMissing.length);

  const unexpected = res.violations.filter((v) => v.rule !== 'typical-band-missing');
  assert.deepEqual(unexpected, [], 'unexpected non-typical-band-missing findings on real packs: ' + JSON.stringify(unexpected));
});
