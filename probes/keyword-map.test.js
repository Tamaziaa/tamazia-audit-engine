'use strict';
const test = require('node:test');
const assert = require('node:assert');
const serp = require('./serp-client.js');
const { keywordMapProbe, isAggregator, positionBand, checkKeyword } = require('./keyword-map.js');

function withSerp(impl, fn) {
  const original = serp.search;
  serp.search = impl;
  return fn().finally(() => { serp.search = original; });
}

test('keywordMapProbe abstains with reason no_operating_city when no city is supplied', async () => {
  const r = await keywordMapProbe({ domain: 'example.com', sector: 'law-firms', env: { SERPER_KEY: 'k' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_operating_city');
});

test('keywordMapProbe abstains with reason no_key when no SERP key is configured', async () => {
  const r = await keywordMapProbe({ domain: 'example.com', sector: 'law-firms', city: 'London', env: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_key');
});

test('positionBand matches the old estate\'s four bands', () => {
  assert.strictEqual(positionBand(null), 'absent');
  assert.strictEqual(positionBand(5), 'winning');
  assert.strictEqual(positionBand(15), 'striking');
  assert.strictEqual(positionBand(30), 'almost');
  assert.strictEqual(positionBand(80), 'distant');
});

test('isAggregator drops directories/social/gov hosts, keeps a real operating firm domain', () => {
  assert.strictEqual(isAggregator('yell.com'), true);
  assert.strictEqual(isAggregator('best-dentists-london.co.uk'), true, 'a "best" listicle token is dropped');
  assert.strictEqual(isAggregator('acme-dental.co.uk'), false);
});

test('checkKeyword drops (GATE) when the live SERP yields no organic results - never invents a position', async () => {
  await withSerp(async () => ({ organic: [] }), async () => {
    const r = await checkKeyword('dentist london', 'acme-dental.co.uk', 'UK', {});
    assert.strictEqual(r, null);
  });
});

test('KNOWN-BAD calibration: a SERP error response never crashes checkKeyword, drops the keyword instead', async () => {
  await withSerp(async () => ({ error: 'quota exceeded' }), async () => {
    const r = await checkKeyword('dentist london', 'acme-dental.co.uk', 'UK', {});
    assert.strictEqual(r, null);
  });
});

test('keywordMapProbe builds a real keyword row set from a live-shaped SERP: my_position + leader trace to the SERP evidence', async () => {
  // this mocks serp.search() ITSELF (already post-processed - see probes/serp-client.js), so rows carry
  // {domain, rank}, not the raw provider wire shape ({link, position}) a real fetch would answer with.
  const organicFor = (q) => {
    if (/near me/.test(q)) return { organic: [] }; // GATE: this seed yields no evidence, correctly dropped
    return { organic: [
      { title: 'Rival Dental', domain: 'rival-dental.co.uk', rank: 1 },
      { title: 'Acme Dental', domain: 'acme-dental.co.uk', rank: 4 },
    ] };
  };
  await withSerp(async (q) => organicFor(q), async () => {
    const r = await keywordMapProbe({ domain: 'acme-dental.co.uk', sector: 'dental', city: 'London', env: { SERPER_KEY: 'k' } });
    assert.strictEqual(r.ok, true);
    assert.ok(r.keywords.length > 0);
    const row = r.keywords[0];
    assert.strictEqual(row.my_position, 4);
    assert.strictEqual(row.leader, 'rival-dental.co.uk');
    assert.strictEqual(row.leader_pos, 1);
    assert.ok(['winning', 'striking', 'almost', 'distant', 'absent'].includes(row.band));
  });
});
