'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { authorityGapProbe, da100 } = require('./authority-gap.js');

const originalFetch = global.fetch;
function withFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}
function textResponse(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { forEach() {} }, text: async () => JSON.stringify(body) });
}

test('authorityGapProbe abstains with reason no_key when OPENPAGERANK_API_KEY is absent', async () => {
  const r = await authorityGapProbe({ domain: 'acme.co.uk', env: {} });
  assert.deepStrictEqual(r, { ok: false, reason: 'no_key' });
});

test('da100 scales the 0-10 OpenPageRank decimal to a /100 figure', () => {
  assert.strictEqual(da100(4.5), 45);
  assert.strictEqual(da100(0), 0);
});

test('authorityGapProbe you:null (never a fabricated figure) when OpenPageRank holds no row for the domain - Rule 10, no drFallback hash', async () => {
  await withFetch(() => textResponse({ response: [], last_updated: '2026-01-01' }), async () => {
    const r = await authorityGapProbe({ domain: 'acme.co.uk', competitors: ['rival.co.uk'], env: { OPENPAGERANK_API_KEY: 'k' } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.you, null);
  });
});

test('authorityGapProbe returns REAL DR only, ranks competitors by page_rank_decimal', async () => {
  const body = { response: [
    { domain: 'acme.co.uk', status_code: 200, page_rank_decimal: '3.20', rank: 900000 },
    { domain: 'rival.co.uk', status_code: 200, page_rank_decimal: '5.10', rank: 300000 },
  ], last_updated: '2026-07-01' };
  await withFetch(() => textResponse(body), async () => {
    const r = await authorityGapProbe({ domain: 'acme.co.uk', competitors: ['rival.co.uk'], env: { OPENPAGERANK_API_KEY: 'k' } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.you.dr, 3.2);
    assert.strictEqual(r.you.da_100, 32);
    assert.strictEqual(r.top3[0].domain, 'rival.co.uk');
    assert.strictEqual(r.top3[0].da_100, 51);
  });
});

test('KNOWN-BAD calibration: a non-200 OpenPageRank response degrades to you:null, never throws', async () => {
  await withFetch(() => textResponse({ error: 'rate limited' }, 429), async () => {
    const r = await authorityGapProbe({ domain: 'acme.co.uk', competitors: [], env: { OPENPAGERANK_API_KEY: 'k' } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.you, null);
  });
});
