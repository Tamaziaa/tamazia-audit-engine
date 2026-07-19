'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse } = require('./ftc');
const { assertValidRow } = require('../store/schema');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'ftc');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'FTC' };
}

test('parses the real fetched Hopper travel-app settlement into one valid row', () => {
  const html = readFixture('hopper.html');
  const url = 'https://www.ftc.gov/news-events/news/press-releases/2026/07/travel-app-hopper-pay-35-million-settle-ftc-allegations-it-charged-fees-without-consent-deceived';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.match(row.entity_name, /Hopper/);
  assert.equal(row.decision_date, '2026-07-02');
  assert.equal(row.penalty_amount, 35_000_000);
  assert.equal(row.currency, 'USD');
  assert.ok(row.law_ids.includes('US_FTC_ACT_S5_UDAP'));
});

test('a page with no dollar settlement figure yields zero rows, never a guessed amount (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>FTC news item</h1><p>July 2, 2026</p><p>Tags:</p><p>Consumer Protection</p><p>No dollar figure appears anywhere in this article.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://www.ftc.gov/news-events/news/press-releases/no-amount'));
  assert.deepEqual(rows, []);
});

test('a page with an amount but no recognisable Tags-anchored date yields zero rows (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>Some company to pay $9 million</h1><p>No date/Tags structure on this page.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://www.ftc.gov/news-events/news/press-releases/no-date'));
  assert.deepEqual(rows, []);
});
