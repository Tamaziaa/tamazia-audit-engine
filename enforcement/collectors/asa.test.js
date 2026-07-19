'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parse, collect } = require('./asa');
const { assertValidRow } = require('../store/schema');
const { stripHtmlToText } = require('./lib/text');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'asa');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function ctxFor(html, url) {
  return { url, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z', source: 'ASA' };
}

test('parses the real fetched Phlo Technologies POM ruling into one valid, verbatim-quoted row', () => {
  const html = readFixture('phlo-technologies-ltd.html');
  const url = 'https://www.asa.org.uk/rulings/phlo-technologies-ltd-a26-1328311-phlo-technologies-ltd.html';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'Phlo Technologies Ltd');
  assert.equal(row.decision_date, '2026-07-15');
  assert.equal(row.jurisdiction, 'UK');
  assert.equal(row.regulator, 'Advertising Standards Authority');
  assert.ok(row.law_ids.includes('UK_MHRA_POM_AD_BAN'), 'rule 12.12 must map to the POM advertising law');
  // the offending quote must be a VERBATIM span traceable to the fetched page, never a paraphrase
  assert.ok(row.offending_quote, 'expected a verbatim offending quote to be extracted');
  assert.match(stripHtmlToText(html), new RegExp(escapeRegex(row.offending_quote)), 'quote must appear verbatim in the normalised evidence text derived from the fetched page');
  assert.equal(row.url, url);
  assert.equal(row.sha256, sha256Of(html));
});

test('parses the real fetched Kind Patches ruling (multi-rule breach) into one valid row', () => {
  const html = readFixture('kind-patches-ltd.html');
  const url = 'https://www.asa.org.uk/rulings/kind-patches-ltd-a26-1333913-kind-patches-ltd.html';
  const rows = parse(html, ctxFor(html, url));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.doesNotThrow(() => assertValidRow(row));
  assert.equal(row.entity_name, 'Kind Patches Ltd');
  assert.equal(row.decision_date, '2026-07-15');
  assert.ok(row.offending_quote);
  assert.match(stripHtmlToText(html), new RegExp(escapeRegex(row.offending_quote)));
});

test('a structurally drifted page (no "Ruling on" heading, no date) yields zero rows, not a guess (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const brokenHtml = '<html><body><h1>Something else entirely</h1><p>no ruling structure here</p></body></html>';
  const rows = parse(brokenHtml, ctxFor(brokenHtml, 'https://www.asa.org.uk/rulings/broken.html'));
  assert.deepEqual(rows, []);
});

test('collect() propagates a fetch failure as a typed non-ok result via the injected fetchImpl (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  const result = await collect({
    fetchImpl: async () => ({ ok: false, reason: 'http_status', status: 403 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'http_status');
});

test('collect() runs the real parser end to end against a fixture-backed fetchImpl', async () => {
  const html = readFixture('phlo-technologies-ltd.html');
  const url = 'https://www.asa.org.uk/rulings/phlo-technologies-ltd-a26-1328311-phlo-technologies-ltd.html';
  const result = await collect({
    fetchImpl: async () => ({ ok: true, status: 200, url, text: html, sha256: sha256Of(html), fetchedAt: '2026-07-20T00:00:00.000Z' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].entity_name, 'Phlo Technologies Ltd');
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
