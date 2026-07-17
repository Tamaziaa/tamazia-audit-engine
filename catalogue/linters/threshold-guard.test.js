'use strict';
// catalogue/linters/threshold-guard.test.js - node:test suite for the threshold-guard linter
// (caution.md C-071 Modern Slavery Act-on-an-SME class + C-096/C-104 statutory-cap-as-headline
// class). Run: node --test catalogue/linters/threshold-guard.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const linter = require('./threshold-guard.js');
const lib = require('./lib.js');
const { packsDirOrFail } = require('./test-helpers.js');

// ---------------------------------------------------------------------------------
// textMentionsThreshold / hasNonEmptyExcludedWhen
// ---------------------------------------------------------------------------------

test('textMentionsThreshold: detects turnover, revenue, employee-count and SME language across name/applies_when/excluded_when', () => {
  assert.equal(linter.textMentionsThreshold({ name: 'Act (applies above GBP 99 million turnover)' }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['annual revenue over USD 10 million'] }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['employer with 250 or more employees'] }), true);
  assert.equal(linter.textMentionsThreshold({ excluded_when: ['small and medium-sized enterprises are excluded'] }), true);
  assert.equal(linter.textMentionsThreshold({ name: 'A universal privacy notice duty' }), false);
});

// CR-13: the currency alternatives must fire on a bare "£36m"/"$10m" at the very START of a
// string, where there is no preceding word character to anchor a LEADING \b before the symbol.
test('textMentionsThreshold (CR-13): a currency-shaped threshold fires at the very start of the string, not only mid-sentence', () => {
  assert.equal(linter.textMentionsThreshold({ name: '£36m' }), true);
  assert.equal(linter.textMentionsThreshold({ name: '$10m' }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['£36m turnover threshold'] }), true);
  assert.equal(linter.textMentionsThreshold({ applies_when: ['annual turnover of £36m or more'] }), true);
});

test('hasNonEmptyExcludedWhen (CR-12 + CR threshold-guard.js:62): true only when an entry carries BOTH a threshold token AND a below/under/exempt sense, never merely any non-blank string and never a same-threshold restatement', () => {
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['annual turnover below GBP 99 million'] }), true);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['fewer than 250 employees'] }), true);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['turnover not exceeding GBP 99 million'] }), true);
  // CR threshold-guard.js:62: an entry that RE-STATES the same ABOVE-threshold trigger matches
  // THRESHOLD_RX but carries no below/exempt sense - it models no carve-out and must NOT satisfy.
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['organisation with annual turnover of GBP 99 million or more'] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['employer with 250 or more employees'] }), false);
  // an unrelated, non-size exclusion reason must NOT satisfy this - the "2" inside "B2B" is
  // deliberately not enough (the bare-digit heuristic this replaced false-positived on exactly this).
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['B2B-only firms are out of scope'] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['a reason'] }), false);
  // a below/exempt sense with NO threshold token (e.g. an unrelated "below" reason) is also not enough.
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['operates below the radar of press attention'] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: [] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({ excluded_when: ['   '] }), false);
  assert.equal(linter.hasNonEmptyExcludedWhen({}), false);
});

// ---------------------------------------------------------------------------------
// checkRecord: the mandatory contract
// ---------------------------------------------------------------------------------

test('checkRecord: a threshold-mentioning record with an empty excluded_when is flagged threshold-excluded-when-missing at BLOCKING "error" severity, explicitly (CR-11/CR-12; the Modern Slavery Act-on-an-SME class)', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_BAD',
    name: 'FAKE_ACT_2099 synthetic transparency duty',
    applies_when: ['annual turnover of GBP 99 million or more'],
    excluded_when: [],
    penalty: { typical_low: null, typical_high: null, statutory_max: null },
  };
  const v = linter.checkRecord(r, 'test');
  const hit = v.find((f) => f.rule === 'threshold-excluded-when-missing');
  assert.ok(hit);
  assert.equal(hit.severity, 'error', 'the blocking rule must carry an EXPLICIT "error" severity, not rely on an implicit library default');
});

test('checkRecord (CR-12): a threshold-mentioning record whose excluded_when carries only an UNRELATED, non-size exclusion reason is still flagged threshold-excluded-when-missing', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_UNRELATED_EXCLUDED',
    name: 'FAKE_ACT_2099 synthetic transparency duty',
    applies_when: ['annual turnover of GBP 99 million or more'],
    excluded_when: ['B2B-only firms are out of scope'],
    penalty: { typical_low: null, typical_high: null, statutory_max: null },
  };
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'threshold-excluded-when-missing'), 'an unrelated excluded_when entry must not satisfy a size-gated record');
});

test('checkRecord (CR threshold-guard.js:62): a threshold-mentioning record whose excluded_when merely RE-STATES the same above-threshold trigger (no below/exempt sense) is still flagged threshold-excluded-when-missing', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_SAME_NOT_BELOW',
    name: 'FAKE_ACT_2099 synthetic transparency duty',
    applies_when: ['annual turnover of GBP 99 million or more'],
    excluded_when: ['organisation with annual turnover of GBP 99 million or more'],
    penalty: { typical_low: null, typical_high: null, statutory_max: null },
  };
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'threshold-excluded-when-missing'), 'a same-threshold-but-not-below excluded_when models no sub-threshold carve-out and must not clear the record');
});

test('checkRecord: the same threshold-mentioning record clears once excluded_when is populated', () => {
  const r = {
    id: 'CAL_TEST_THRESHOLD_GOOD',
    name: 'FAKE_ACT_2099 synthetic transparency duty',
    applies_when: ['annual turnover of GBP 99 million or more'],
    excluded_when: ['turnover below GBP 99 million'],
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

// CR-14: assert the EXACT (file, id, rule) tuple set, never `>= N` (a `>=` assertion accepts every
// future regression silently - "a zero you did not earn is a lie" applies equally to a count that
// is never actually checked). Documents today's known real findings so drift is visible, exactly
// the pattern citation-completeness.test.js's own real-pack smoke test already uses.
test('scan: real committed packs produce EXACTLY the documented known (file, id, rule) findings', () => {
  packsDirOrFail(__dirname);
  const res = linter.scan([lib.DEFAULT_PACK_GLOB]);
  assert.ok(res.scanned > 0);

  const KNOWN = [
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_NIS_RDSP', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_DMCC_SUBS_UCP', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_INFLUENCER_AD_DISCLOSURE', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_OSA_UGC', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_ODPS_NOTIFICATION', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_CRA_UNFAIR_TERMS_FITNESS', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_GREEN_CLAIMS', 'typical-band-missing'],
    ['catalogue/packs/uk-tech-media-industrial.json', 'UK_TRUSTMARK_ACCREDITATION_CLAIMS', 'typical-band-missing'],
    ['catalogue/packs/uk-universal.json', 'UK_DUAA_2025', 'typical-band-missing'],
    // us-healthcare's US_MEDBOARD_ADV_NY record carries a statutory_max with no modelled typical
    // enforcement band yet (the exact figure and its statutory citation live in the catalogue record,
    // not here) - an honest cap-only state the WARNING exists to surface every run until a typical
    // band is gathered (caution.md C-096/C-104), not a schema defect. Documented so the exact-set stays honest.
    ['catalogue/packs/us-healthcare.json', 'US_MEDBOARD_ADV_NY', 'typical-band-missing'],
    // RESOLVED (PR #3 gate loop): US_FTC_REVIEWS_ENDORSEMENTS previously appeared here because
    // THRESHOLD_RX's bare `employee` alternative treated "endorsement by an employee" (authorship,
    // not headcount) as a size-threshold mention. Fixed via the narrower alternative this note
    // proposed: employee mentions now require count context (a count/number/threshold qualifier or
    // a leading numeral). Both directions are pinned in the selfTest positives/negatives.
  ];

  const actual = res.violations.map((v) => [v.file, v.id, v.rule]).sort();
  const expected = KNOWN.map((t) => t.slice()).sort();
  assert.deepEqual(actual, expected, 'threshold-guard findings on the real packs drifted from the documented known set: ' + JSON.stringify({ actual, expected }, null, 2));

  // Every known typical-band-missing entry must actually carry warning severity, and the one
  // blocking entry must actually carry error severity (CR-11's own explicit-severity discipline,
  // re-checked here against the real content too).
  for (const v of res.violations) {
    if (v.rule === 'typical-band-missing') assert.equal(v.severity, 'warning');
    if (v.rule === 'threshold-excluded-when-missing') assert.equal(v.severity, 'error');
  }
});
