'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse } = require('./gdprhub');
const { assertValidRow } = require('../store/schema');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'gdprhub');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'GDPRHUB' };
}

test('parses the synthetic GDPRhub decision-infobox fixture (structural test; live gdprhub.eu fetch is Anubis-blocked this session, see gdprhub.js header)', () => {
  const html = readFixture('synthetic-decision.html');
  const url = 'https://gdprhub.eu/index.php?title=Synthetic_Fixture_Not_Real';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'Example Widgets GmbH');
  assert.equal(row.jurisdiction, 'Fictionland');
  assert.equal(row.decision_date, '2026-03-15');
  assert.equal(row.penalty_amount, 120000);
  assert.equal(row.currency, 'EUR');
  assert.ok(row.law_ids.includes('EU_GDPR_ART_5'));
  assert.ok(row.law_ids.includes('EU_GDPR_ART_32'));
});

test('a page missing the decision infobox fields yields zero rows, never a guessed fine (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>Some other GDPRhub page</h1><p>No decision infobox on this page.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://gdprhub.eu/index.php?title=No_Infobox'));
  assert.deepEqual(rows, []);
});
