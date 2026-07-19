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
  // the page cites two plural, list-form clusters ("rules 12.1 and 12.11 (...)" and "rules 1.3 (...)
  // and 4.9 (...)"): every rule number from BOTH clusters must be captured, not just the first
  // cluster or the first number of each, proving ruleNumbersOf's list/plural handling.
  assert.ok(row.law_ids.includes('UK_CAP_1212_COSMETIC'), 'rule 12.1 must map to UK_CAP_1212_COSMETIC');
  assert.ok(row.law_ids.includes('UK_MHRA_POM_AD_BAN'), 'rule 12.11 must map to UK_MHRA_POM_AD_BAN');
  assert.ok(row.law_ids.includes('UK_CAP_CODE'), 'rules 1.3 and 4.9 (no dedicated catalogue record yet) fall back to UK_CAP_CODE');
});

test('ruleNumbersOf recognises the plural "rules" list form ASA uses for multi-rule breaches (KNOWN-BAD CALIBRATION FIXTURE: the old singular-only "rule N.N" regex silently dropped every number in a "rules X and Y" citation)', () => {
  const html = readFixture('kind-patches-ltd.html');
  const rows = parse(html, ctxFor(html, 'https://www.asa.org.uk/rulings/kind-patches-ltd-a26-1333913-kind-patches-ltd.html'));
  const { law_ids: lawIds } = rows[0];
  assert.ok(lawIds.length > 1, 'a multi-rule "rules X and Y" citation must not collapse to the single generic UK_CAP_CODE fallback');
});

test('ruleNumbersOf is ReDoS-safe: an adversarial run of " ," / "   and" separators after "rules N.N" completes in linear time, never exponential backtracking (CodeQL js/redos regression, KNOWN-BAD CALIBRATION FIXTURE)', () => {
  // The pre-fix separator `(?:\s*,\s*|\s+and\s+)+` backtracked exponentially on these exact inputs
  // (measured >6s at ~26 repetitions). The fixed pattern must stay well under a generous wall-clock
  // bound even at a repetition count that would have taken the old pattern longer than the age of the
  // test run to finish.
  for (const filler of [' ,', '   and']) {
    const attack = 'rules 1.1' + filler.repeat(50000) + '!';
    const started = Date.now();
    const rows = parse(`<html><body><h1>ASA Ruling on Attack Ltd</h1><p>Ruling on\nAttack Ltd\nUpheld</p><p>1 July 2026</p><p>${attack}</p></body></html>`,
      ctxFor(attack, 'https://www.asa.org.uk/rulings/attack.html'));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `ruleNumbersOf must not backtrack exponentially (took ${elapsed}ms on a ${filler.trim()}-repetition attack)`);
    assert.equal(rows.length, 1); // still parses the real leading rule number, unaffected
  }
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
