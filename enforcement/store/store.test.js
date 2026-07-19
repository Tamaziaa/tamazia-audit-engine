'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadStore, appendRow, writeStore, DEFAULT_STORE_PATH } = require('./store');
const { assertValidRow, isValidRow } = require('./schema');

const GOOD_ROW = Object.freeze({
  id: 'ICO-2026-TEST-0001',
  source: 'ICO',
  regulator: 'Information Commissioner\'s Office',
  jurisdiction: 'UK',
  law_ids: ['UK_PECR_EMARKETING'],
  entity_name: 'Test Co Ltd',
  offending_quote: null,
  decision_date: '2026-02-03',
  penalty_amount: 100000,
  currency: 'GBP',
  url: 'https://ico.org.uk/action-weve-taken/enforcement/test-co-ltd/',
  sha256: 'a'.repeat(64),
  summary: 'Test fixture row: fixed test data, not a real enforcement action.',
});

// tmpStorePath() -> a store path inside a freshly-created, exclusively-owned temp directory.
// CodeQL js/insecure-temporary-file: fs.mkdtempSync is the platform-safe primitive (atomic,
// cryptographically-random suffix) for a private scratch directory; a fixed filename written inside
// a directory nothing else could have pre-created carries none of the symlink/guessable-name risk a
// hand-built `${os.tmpdir()}/name-${pid}-${Date.now()}` path does.
function tmpStorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforcement-store-test-'));
  return path.join(dir, 'store.ndjson');
}

test('the committed seed store loads and every row validates', () => {
  const rows = loadStore(DEFAULT_STORE_PATH);
  assert.ok(rows.length >= 10, `expected at least 10 seeded rows, got ${rows.length}`);
  for (const row of rows) assertValidRow(row);
});

test('the committed seed store has no duplicate ids', () => {
  const rows = loadStore(DEFAULT_STORE_PATH);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, rows.length);
});

test('the committed seed store spans multiple sources', () => {
  const rows = loadStore(DEFAULT_STORE_PATH);
  const sources = new Set(rows.map((r) => r.source));
  assert.ok(sources.size >= 3, `expected rows from at least 3 sources, got ${[...sources].join(', ')}`);
});

test('loadStore on a missing file returns an empty array, not a throw', () => {
  const missing = tmpStorePath();
  assert.deepEqual(loadStore(missing), []);
});

test('appendRow then loadStore round-trips a valid row', () => {
  const storePath = tmpStorePath();
  fs.writeFileSync(storePath, '');
  appendRow(GOOD_ROW, storePath);
  const rows = loadStore(storePath);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], GOOD_ROW);
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

test('appendRow rejects a duplicate id', () => {
  const storePath = tmpStorePath();
  fs.writeFileSync(storePath, '');
  appendRow(GOOD_ROW, storePath);
  assert.throws(() => appendRow(GOOD_ROW, storePath), /already exists/);
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

test('writeStore rejects an array containing a malformed row (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const storePath = tmpStorePath();
  const badRow = { ...GOOD_ROW, id: 'BAD-ROW', penalty_amount: 'not-a-number' };
  assert.throws(() => writeStore([GOOD_ROW, badRow], storePath), TypeError);
  assert.ok(!fs.existsSync(storePath), 'a rejected write must not create a partial file');
});

test('loadStore throws on a store file containing an invalid row (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const storePath = tmpStorePath();
  fs.writeFileSync(storePath, `${JSON.stringify(GOOD_ROW)}\n{"id":"broken","source":"ICO"}\n`);
  assert.throws(() => loadStore(storePath), /invalid EnforcementAction row/);
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

test('isValidRow is a non-throwing boolean form of assertValidRow', () => {
  assert.equal(isValidRow(GOOD_ROW), true);
  assert.equal(isValidRow({ id: 'x' }), false);
  assert.equal(isValidRow(null), false);
  assert.equal(isValidRow('not an object'), false);
});
