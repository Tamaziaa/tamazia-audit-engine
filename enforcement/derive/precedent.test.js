'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPrecedentRanges, writePrecedentRanges, run, LOW_CONFIDENCE_THRESHOLD } = require('./precedent');
const { DEFAULT_STORE_PATH } = require('../store/store');

function penaltyRow(overrides) {
  return {
    id: `TEST-${Math.random().toString(36).slice(2)}`,
    source: 'ICO', regulator: "Information Commissioner's Office", jurisdiction: 'UK',
    law_ids: ['UK_PECR_EMARKETING'], entity_name: 'Test Org Ltd', offending_quote: null,
    decision_date: '2026-05-01', penalty_amount: 100000, currency: 'GBP',
    url: 'https://ico.org.uk/action-weve-taken/enforcement/test-org/', sha256: 'a'.repeat(64), summary: 'fixture',
    ...overrides,
  };
}

test('buildPrecedentRanges computes min/median/max over penalised rows for one law_id', () => {
  const rows = [
    penaltyRow({ penalty_amount: 100000, decision_date: '2026-01-01' }),
    penaltyRow({ penalty_amount: 300000, decision_date: '2026-03-01' }),
    penaltyRow({ penalty_amount: 200000, decision_date: '2026-02-01' }),
  ];
  const ranges = buildPrecedentRanges(rows, '2026-07-20T00:00:00.000Z');
  const range = ranges.get('UK_PECR_EMARKETING::GBP');
  assert.equal(range.n, 3);
  assert.equal(range.min, 100000);
  assert.equal(range.median, 200000);
  assert.equal(range.max, 300000);
  assert.equal(range.date_range.from, '2026-01-01');
  assert.equal(range.date_range.to, '2026-03-01');
  assert.equal(range.low_confidence, false);
});

test('a law_id with fewer than the low-confidence threshold of rows is flagged low_confidence, never presented as settled', () => {
  const rows = [penaltyRow({}), penaltyRow({ penalty_amount: 50000 })];
  assert.ok(rows.length < LOW_CONFIDENCE_THRESHOLD);
  const ranges = buildPrecedentRanges(rows, '2026-07-20T00:00:00.000Z');
  const range = ranges.get('UK_PECR_EMARKETING::GBP');
  assert.equal(range.low_confidence, true);
});

test('rows with no monetary penalty (e.g. an upheld-but-unfined ASA ruling) are excluded, never counted as a zero (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const rows = [
    penaltyRow({ penalty_amount: 100000 }),
    { ...penaltyRow({}), penalty_amount: null, currency: null },
  ];
  const ranges = buildPrecedentRanges(rows, '2026-07-20T00:00:00.000Z');
  const range = ranges.get('UK_PECR_EMARKETING::GBP');
  assert.equal(range.n, 1, 'the unfined row must not be counted, and must never drag the range toward zero');
  assert.equal(range.min, 100000);
});

test('mixed-currency rows under the same law_id produce SEPARATE ranges per currency, never a silently summed/converted figure', () => {
  const rows = [
    penaltyRow({ law_ids: ['EU_GDPR_ART_32'], currency: 'GBP', penalty_amount: 100000 }),
    penaltyRow({ law_ids: ['EU_GDPR_ART_32'], currency: 'EUR', penalty_amount: 5000000 }),
  ];
  const ranges = buildPrecedentRanges(rows, '2026-07-20T00:00:00.000Z');
  assert.ok(ranges.has('EU_GDPR_ART_32::GBP'));
  assert.ok(ranges.has('EU_GDPR_ART_32::EUR'));
  assert.notEqual(ranges.get('EU_GDPR_ART_32::GBP').max, ranges.get('EU_GDPR_ART_32::EUR').max);
});

test('every range carries its sources[] back to the contributing rows (url + sha256 + amount) for traceability', () => {
  const row = penaltyRow({ penalty_amount: 250000 });
  const ranges = buildPrecedentRanges([row], '2026-07-20T00:00:00.000Z');
  const range = ranges.get('UK_PECR_EMARKETING::GBP');
  assert.equal(range.sources.length, 1);
  assert.equal(range.sources[0].url, row.url);
  assert.equal(range.sources[0].sha256, row.sha256);
  assert.equal(range.sources[0].penalty_amount, 250000);
});

test('writePrecedentRanges writes a valid JSON file', () => {
  const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'precedent-')), 'ranges.json');
  const ranges = buildPrecedentRanges([penaltyRow({})], '2026-07-20T00:00:00.000Z');
  writePrecedentRanges(ranges, outPath);
  const content = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(Array.isArray(content.ranges));
  assert.equal(content.ranges.length, 1);
});

test('run() against the real committed seed store yields at least one GDPR/PECR penalty-precedent range with real source urls', () => {
  const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'precedent-real-')), 'ranges.json');
  const { ranges } = run({ storePath: DEFAULT_STORE_PATH, outPath, generatedAt: '2026-07-20T00:00:00.000Z' });
  const pecrRange = ranges.get('UK_PECR_EMARKETING::GBP');
  assert.ok(pecrRange, 'expected a UK_PECR_EMARKETING::GBP precedent range from the seeded ICO rows');
  assert.ok(pecrRange.n >= 2);
  assert.ok(pecrRange.min > 0);
  for (const source of pecrRange.sources) {
    assert.match(source.url, /^https:\/\/ico\.org\.uk\//);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
  }
});
