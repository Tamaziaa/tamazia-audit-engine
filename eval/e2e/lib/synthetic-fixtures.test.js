'use strict';
// eval/e2e/lib/synthetic-fixtures.test.js
//   node --test eval/e2e/lib/synthetic-fixtures.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadSyntheticFixtures, loadOneSyntheticFixture } = require('./synthetic-fixtures');

const REAL_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

test('loadSyntheticFixtures: an absent directory yields [] (no synthetic additions is a valid state)', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
  assert.deepStrictEqual(loadSyntheticFixtures(missing), []);
});

test('loadSyntheticFixtures: the real eval/e2e/fixtures/ directory loads at least one well-formed fixture', () => {
  const fixtures = loadSyntheticFixtures(REAL_FIXTURES_DIR);
  const good = fixtures.filter((f) => !f.error);
  assert.ok(good.length >= 1, 'expected at least one synthetic fixture under eval/e2e/fixtures/');
  for (const f of good) {
    assert.ok(f.domain);
    assert.ok(f.bundle);
    assert.ok(f.expected);
  }
});

test('loadOneSyntheticFixture: malformed JSON is reported as an error row, not a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-synthetic-'));
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ not valid json');
  const row = loadOneSyntheticFixture(dir, 'bad.json');
  assert.match(row.error, /unreadable JSON/);
});

test('loadOneSyntheticFixture: valid JSON missing bundle/expected is reported as an error row, not a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-synthetic-'));
  fs.writeFileSync(path.join(dir, 'incomplete.json'), JSON.stringify({ domain: 'x' }));
  const row = loadOneSyntheticFixture(dir, 'incomplete.json');
  assert.match(row.error, /missing required/);
});

test('loadOneSyntheticFixture: a well-formed fixture defaults domain to the filename and role to "synthetic"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-synthetic-'));
  fs.writeFileSync(path.join(dir, 'no-domain.json'), JSON.stringify({ bundle: {}, expected: {} }));
  const row = loadOneSyntheticFixture(dir, 'no-domain.json');
  assert.strictEqual(row.domain, 'no-domain');
  assert.strictEqual(row.role, 'synthetic');
});

test('loadOneSyntheticFixture: an unsafe filename is rejected before any read (path traversal guard)', () => {
  assert.throws(() => loadOneSyntheticFixture('/tmp', '../etc/passwd'));
});
