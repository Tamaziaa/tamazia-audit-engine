'use strict';
// eval/e2e/lib/catalogue-records.test.js
//   node --test eval/e2e/lib/catalogue-records.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCatalogueRecords, DEFAULT_CATALOGUE_PATH } = require('./catalogue-records');

test('loadCatalogueRecords: the real compiled catalogue on disk loads a non-empty records array', () => {
  const records = loadCatalogueRecords();
  assert.ok(Array.isArray(records));
  assert.ok(records.length > 0, 'expected the committed catalogue/dist/catalogue.v1.json to carry records');
  assert.ok(records[0].id, 'a compiled record must carry an id');
});

test('loadCatalogueRecords: DEFAULT_CATALOGUE_PATH points at catalogue/dist/catalogue.v1.json', () => {
  assert.ok(DEFAULT_CATALOGUE_PATH.endsWith(path.join('catalogue', 'dist', 'catalogue.v1.json')));
  assert.ok(fs.existsSync(DEFAULT_CATALOGUE_PATH));
});

test('loadCatalogueRecords: a missing file degrades to [] rather than throwing', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json');
  const records = loadCatalogueRecords(missing);
  assert.deepStrictEqual(records, []);
});

test('loadCatalogueRecords: malformed JSON degrades to [] rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-catalogue-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not valid json');
  const records = loadCatalogueRecords(bad);
  assert.deepStrictEqual(records, []);
});

test('loadCatalogueRecords: valid JSON with no records field degrades to [] rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-catalogue-'));
  const noRecords = path.join(dir, 'no-records.json');
  fs.writeFileSync(noRecords, JSON.stringify({ catalogue_version: 'x' }));
  const records = loadCatalogueRecords(noRecords);
  assert.deepStrictEqual(records, []);
});
