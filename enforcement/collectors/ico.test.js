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

// parseSingleValidRow(fixtureName, url) -> the one EnforcementAction row a well-formed ICO fixture
// must parse into. Shared by every "parses the real fetched ..." test below (CodeScene Code
// Duplication: these five tests differed only in their fixture, url and field-specific assertions -
// the fetch/parse/rows.length/assertValidRow boilerplate is now written once).
function parseSingleValidRow(fixtureName, url) {
  const html = readFixture(fixtureName);
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1, `expected exactly one row from ${fixtureName}`);
  const [row] = rows;
  assert.doesNotThrow(() => assertValidRow(row));
  return row;
}

test('parses the real fetched Reddit Inc monetary penalty into one valid row with the exact fine', () => {
  const row = parseSingleValidRow('reddit-inc.html', 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/reddit-inc/');
  assert.equal(row.entity_name, 'Reddit, Inc.');
  assert.equal(row.decision_date, '2026-02-23');
  assert.equal(row.penalty_amount, 14472500);
  assert.equal(row.currency, 'GBP');
  assert.ok(row.law_ids.includes('UK_GDPR_ART_8'));
  assert.ok(row.law_ids.includes('UK_GDPR_ART_35'));
});

test('parses the real fetched TMAC Ltd PECR penalty (no "Article", regulation-only citation)', () => {
  const row = parseSingleValidRow('tmac-ltd.html', 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/tmac-ltd-en/');
  assert.equal(row.entity_name, 'TMAC Ltd');
  assert.equal(row.decision_date, '2026-02-03');
  assert.equal(row.penalty_amount, 100000);
  assert.equal(row.currency, 'GBP');
  assert.ok(row.law_ids.includes('UK_PECR_EMARKETING'));
});

test('parses the real fetched South Staffordshire security-failure penalty', () => {
  const row = parseSingleValidRow(
    'south-staffordshire.html',
    'https://ico.org.uk/action-weve-taken/enforcement/2026/05/south-staffordshire-plc-and-south-staffordshire-water-plc/',
  );
  assert.equal(row.decision_date, '2026-05-07');
  assert.equal(row.penalty_amount, 963900);
  assert.ok(row.law_ids.includes('UK_GDPR_ART_5'));
  assert.ok(row.law_ids.includes('UK_GDPR_ART_32'));
});

test('parses the real fetched MediaLab.AI penalty (reduced-from-proposed narrative does not confuse the fine extractor)', () => {
  const row = parseSingleValidRow('medialab-ai-inc.html', 'https://ico.org.uk/action-weve-taken/enforcement/2026/02/medialabai-inc/');
  // the page states £247,590 (final) BEFORE it later mentions the £393,000 originally proposed figure;
  // the extractor takes the FIRST figure, which on this page's structure is the final penalty.
  assert.equal(row.penalty_amount, 247590);
});

test('parses the real fetched KRA Consultancy penalty citing MULTIPLE PECR regulations in one sentence ("regulations 22 and 23 of PECR")', () => {
  const row = parseSingleValidRow('kra-consultancy-ltd.html', 'https://ico.org.uk/action-weve-taken/enforcement/2026/05/kra-consultancy-ltd-mpn/');
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
