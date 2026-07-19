'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectFromSource } = require('./framework');

const GOOD_ROW_TEMPLATE = {
  id: 'ASA-2026-TEST-0001',
  source: 'ASA',
  regulator: 'Advertising Standards Authority',
  jurisdiction: 'UK',
  law_ids: ['UK_MHRA_POM_AD_BAN'],
  entity_name: 'Test Advertiser Ltd',
  offending_quote: 'Book your Botox today',
  decision_date: '2026-07-15',
  penalty_amount: null,
  currency: null,
  url: 'https://www.asa.org.uk/rulings/test-advertiser-ltd.html',
  sha256: 'c'.repeat(64),
  summary: 'Fixture row for framework tests.',
};

function fakeFetchOk(text) {
  return async () => ({ ok: true, status: 200, url: 'https://source.test/page', text, sha256: 'd'.repeat(64), fetchedAt: '2026-07-20T00:00:00.000Z' });
}
function fakeFetchFail(reason) {
  return async () => ({ ok: false, reason, error: new Error(`simulated ${reason}`) });
}

test('collectFromSource returns valid parsed rows on a successful fetch', async () => {
  const result = await collectFromSource({
    source: 'ASA',
    url: 'https://www.asa.org.uk/rulings/',
    fetchImpl: fakeFetchOk('<html>one ruling</html>'),
    parse: () => [GOOD_ROW_TEMPLATE],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.meta.candidateCount, 1);
});

test('collectFromSource propagates a fetch failure as a typed result, never an empty success (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  const result = await collectFromSource({
    source: 'ASA',
    url: 'https://www.asa.org.uk/rulings/',
    fetchImpl: fakeFetchFail('timeout'),
    parse: () => {
      throw new Error('parse must not run when fetch failed');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
});

test('collectFromSource reports a parser exception as parse_error, not a silent empty array (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  const result = await collectFromSource({
    source: 'ASA',
    url: 'https://www.asa.org.uk/rulings/',
    fetchImpl: fakeFetchOk('<html>broken markup that trips the parser</html>'),
    parse: () => {
      throw new Error('page structure has drifted');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse_error');
  assert.match(result.detail, /page structure has drifted/);
});

test('collectFromSource rejects a malformed candidate row instead of admitting it into rows[] (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  const badRow = { ...GOOD_ROW_TEMPLATE, sha256: 'not-a-valid-hash' };
  const result = await collectFromSource({
    source: 'ASA',
    url: 'https://www.asa.org.uk/rulings/',
    fetchImpl: fakeFetchOk('<html>one bad ruling</html>'),
    parse: () => [badRow],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].error, /sha256/);
});

test('collectFromSource treats a non-array parse return as a parse_error', async () => {
  const result = await collectFromSource({
    source: 'ASA',
    url: 'https://www.asa.org.uk/rulings/',
    fetchImpl: fakeFetchOk('<html></html>'),
    parse: () => ({ not: 'an array' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse_error');
});
