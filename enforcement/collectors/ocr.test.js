'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse } = require('./ocr');
const { assertValidRow } = require('../store/schema');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'ocr');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'OCR' };
}

test('parses the synthetic OCR resolution-agreement fixture (structural test; live hhs.gov fetch is blocked this session, see ocr.js header)', () => {
  const html = readFixture('synthetic-resolution-agreement.html');
  const url = 'https://www.hhs.gov/press-room/synthetic-fixture-not-real.html';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'Example Health Group LLC');
  assert.equal(row.decision_date, '2026-07-10');
  assert.equal(row.penalty_amount, 75000);
  assert.equal(row.currency, 'USD');
  assert.ok(row.law_ids.includes('US_HIPAA_TRACKING'));
});

test('a page missing the "paid $X to OCR" sentence yields zero rows, never a guessed settlement (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>HHS OCR Settles Investigation with Some Provider</h1><p>July 10, 2026</p><p>No settlement amount sentence appears here.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://www.hhs.gov/press-room/no-amount.html'));
  assert.deepEqual(rows, []);
});
