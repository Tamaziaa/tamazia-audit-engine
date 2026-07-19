'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse } = require('./cnil');
const { assertValidRow } = require('../store/schema');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'cnil');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'CNIL' };
}

test('parses the real fetched IQVIA single-entity fine (Article 14 / Article 25)', () => {
  const html = readFixture('iqvia.html');
  const url = 'https://www.cnil.fr/en/health-data-fine-5-million-euros-against-iqvia';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'IQVIA OPERATIONS FRANCE');
  assert.equal(row.decision_date, '2026-05-26');
  assert.equal(row.penalty_amount, 5_000_000);
  assert.equal(row.currency, 'EUR');
  assert.ok(row.law_ids.includes('EU_GDPR_ART_14'));
  assert.ok(row.law_ids.includes('EU_GDPR_ART_25'));
});

test('parses the real fetched FREE MOBILE / FREE combined sanction into one row with the summed penalty', () => {
  const html = readFixture('free-mobile-en.html');
  const url = 'https://www.cnil.fr/en/sanction-free-2026';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.match(row.entity_name, /FREE MOBILE/);
  assert.equal(row.decision_date, '2026-01-13');
  assert.equal(row.penalty_amount, 42_000_000);
  assert.equal(row.currency, 'EUR');
  assert.ok(row.law_ids.includes('EU_GDPR_ART_32'));
});

test('a page matching neither the single- nor combined-entity sentence shape yields zero rows (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>Some other CNIL news item</h1><p>No fine sentence of the expected shape here.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://www.cnil.fr/en/some-other-item'));
  assert.deepEqual(rows, []);
});
