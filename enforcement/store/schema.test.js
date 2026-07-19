'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertValidRow, isValidRow, SOURCES } = require('./schema');

const GOOD_ROW = Object.freeze({
  id: 'ASA-2026-TEST-0001',
  source: 'ASA',
  regulator: 'Advertising Standards Authority',
  jurisdiction: 'UK',
  law_ids: ['UK_MHRA_POM_AD_BAN'],
  entity_name: 'Test Advertiser Ltd',
  offending_quote: 'Book your Botox today',
  decision_date: '2026-07-15',
  penalty_amount: null,
  currency: null,
  url: 'https://www.asa.org.uk/rulings/test-advertiser-ltd.html',
  sha256: 'b'.repeat(64),
  summary: 'Fixture: an upheld ruling for illustration only.',
});

test('a well-formed row validates cleanly', () => {
  assert.doesNotThrow(() => assertValidRow(GOOD_ROW));
});

test('every declared source is a non-empty string list', () => {
  assert.ok(SOURCES.length >= 6);
  for (const s of SOURCES) assert.equal(typeof s, 'string');
});

// KNOWN-BAD CALIBRATION FIXTURES (Constitution Rule 4): each must be rejected, never pass silently.
const BAD_FIXTURES = [
  ['not an object', 'a bare string'],
  [null, 'null'],
  [['array', 'not', 'object'], 'an array'],
  [{ ...GOOD_ROW, source: 'MADE_UP_REGULATOR' }, 'an unknown source'],
  [{ ...GOOD_ROW, decision_date: '15-07-2026' }, 'a non-ISO date'],
  [{ ...GOOD_ROW, sha256: 'not-a-hash' }, 'a malformed sha256'],
  [{ ...GOOD_ROW, sha256: 'B'.repeat(64) }, 'an uppercase sha256'],
  [{ ...GOOD_ROW, url: 'not a url' }, 'a malformed url'],
  [{ ...GOOD_ROW, url: 'ftp://example.com/x' }, 'a non-http(s) url'],
  [{ ...GOOD_ROW, law_ids: [] }, 'an empty law_ids array'],
  [{ ...GOOD_ROW, law_ids: 'UK_MHRA_POM_AD_BAN' }, 'a law_ids that is a string, not an array'],
  [{ ...GOOD_ROW, law_ids: [''] }, 'a law_ids entry that is an empty string'],
  [{ ...GOOD_ROW, entity_name: '' }, 'an empty entity_name'],
  [{ ...GOOD_ROW, entity_name: '   ' }, 'a whitespace-only entity_name'],
  [{ ...GOOD_ROW, penalty_amount: 'a lot' }, 'a non-numeric penalty_amount'],
  [{ ...GOOD_ROW, penalty_amount: -500 }, 'a negative penalty_amount'],
  [{ ...GOOD_ROW, penalty_amount: 100000, currency: null }, 'a penalty_amount without a currency'],
  [{ ...GOOD_ROW, penalty_amount: 100000, currency: 'pounds' }, 'a non-ISO currency code'],
  [{ ...GOOD_ROW, currency: 'GBP' }, 'a currency set without a penalty_amount'],
  [{ id: 'x' }, 'a row missing almost every required field'],
];

for (const [bad, label] of BAD_FIXTURES) {
  test(`rejects: ${label}`, () => {
    assert.throws(() => assertValidRow(bad), TypeError, `expected assertValidRow to throw for: ${label}`);
    assert.equal(isValidRow(bad), false, `expected isValidRow to return false for: ${label}`);
  });
}

test('offending_quote is optional but must be non-empty when present', () => {
  assert.doesNotThrow(() => assertValidRow({ ...GOOD_ROW, offending_quote: null }));
  assert.throws(() => assertValidRow({ ...GOOD_ROW, offending_quote: '' }), TypeError);
});
