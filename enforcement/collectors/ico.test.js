'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse } = require('./ico');
const { assertValidRow } = require('../store/schema');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'ico');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'ICO' };
}

test('parses the real fetched Reddit Inc monetary penalty into one valid row with the exact fine', () => {
  const html = readFixture('reddit-inc.html');
  const url = 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/reddit-inc/';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'Reddit, Inc.');
  assert.equal(row.decision_date, '2026-02-23');
  assert.equal(row.penalty_amount, 14472500);
  assert.equal(row.currency, 'GBP');
  assert.ok(row.law_ids.includes('UK_GDPR_ART_8'));
  assert.ok(row.law_ids.includes('UK_GDPR_ART_35'));
});

test('parses the real fetched TMAC Ltd PECR penalty (no "Article", regulation-only citation)', () => {
  const html = readFixture('tmac-ltd.html');
  const url = 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/tmac-ltd-en/';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'TMAC Ltd');
  assert.equal(row.decision_date, '2026-02-03');
  assert.equal(row.penalty_amount, 100000);
  assert.equal(row.currency, 'GBP');
  assert.ok(row.law_ids.includes('UK_PECR_EMARKETING'));
});

test('parses the real fetched South Staffordshire security-failure penalty', () => {
  const html = readFixture('south-staffordshire.html');
  const url = 'https://ico.org.uk/action-weve-taken/enforcement/2026/05/south-staffordshire-plc-and-south-staffordshire-water-plc/';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.decision_date, '2026-05-07');
  assert.equal(row.penalty_amount, 963900);
  assert.ok(row.law_ids.includes('UK_GDPR_ART_5'));
  assert.ok(row.law_ids.includes('UK_GDPR_ART_32'));
});

test('parses the real fetched MediaLab.AI penalty (reduced-from-proposed narrative does not confuse the fine extractor)', () => {
  const html = readFixture('medialab-ai-inc.html');
  const url = 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/medialabai-inc/';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  // the page states £247,590 (final) BEFORE it later mentions the £393,000 originally proposed figure;
  // the extractor takes the FIRST figure, which on this page's structure is the final penalty.
  assert.equal(row.penalty_amount, 247590);
});

test('parses the real fetched KRA Consultancy penalty citing MULTIPLE PECR regulations in one sentence ("regulations 22 and 23 of PECR")', () => {
  const html = readFixture('kra-consultancy-ltd.html');
  const url = 'https://ico.org.uk/action-weve-taken/enforcement/2026/05/kra-consultancy-ltd-mpn/';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'KRA Consultancy Ltd');
  assert.equal(row.decision_date, '2026-05-20');
  assert.equal(row.penalty_amount, 300000);
  assert.ok(row.law_ids.includes('UK_PECR_EMARKETING'));
});

test('a structurally drifted page (no Date/Type block) yields zero rows, not a guessed penalty (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const brokenHtml = '<html><body><h1>Enforcement action</h1><p>Some Org</p><p>no structured fields here</p></body></html>';
  const rows = parse(brokenHtml, ctxFor(brokenHtml, 'https://ico.org.uk/action-weve-taken/enforcement/broken/'));
  assert.deepEqual(rows, []);
});

test('a page with a narrative fine mention but no Date block still yields zero rows, never half a row (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const html = '<html><body><h1>Enforcement action</h1><p>Some Org Ltd</p><p>Some Org Ltd</p><p>We imposed a £999 penalty.</p></body></html>';
  const rows = parse(html, ctxFor(html, 'https://ico.org.uk/action-weve-taken/enforcement/broken2/'));
  assert.deepEqual(rows, []);
});
