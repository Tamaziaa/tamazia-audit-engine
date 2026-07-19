'use strict';
const test = require('node:test');
const assert = require('node:assert');
const serp = require('./serp-client.js');
const { organicCompetitorsProbe } = require('./competitor-overlap.js');

function withSerp(impl, fn) {
  const original = serp.search;
  serp.search = impl;
  return fn().finally(() => { serp.search = original; });
}

test('organicCompetitorsProbe returns [] with no keywords, never throws', async () => {
  const r = await organicCompetitorsProbe({ keywords: [], domain: 'acme.co.uk', env: {} });
  assert.deepStrictEqual(r, []);
});

test('organicCompetitorsProbe drops the firm\'s own domain and aggregator hosts, keeps a real co-ranking rival', async () => {
  await withSerp(async () => ({ organic: [
    { domain: 'acme.co.uk' }, { domain: 'yell.com' }, { domain: 'rival-firm.co.uk' }, { domain: 'rival-firm.co.uk' },
  ] }), async () => {
    const r = await organicCompetitorsProbe({ keywords: ['acme service london'], domain: 'acme.co.uk', env: {} });
    assert.deepStrictEqual(r, ['rival-firm.co.uk']);
  });
});

test('KNOWN-BAD calibration: a SERP error never crashes the probe, yields an empty set', async () => {
  await withSerp(async () => ({ error: 'no key' }), async () => {
    const r = await organicCompetitorsProbe({ keywords: ['acme service london'], domain: 'acme.co.uk', env: {} });
    assert.deepStrictEqual(r, []);
  });
});
