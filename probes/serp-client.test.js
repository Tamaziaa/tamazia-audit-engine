'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { search, hasKey, rootDomain } = require('./serp-client.js');

const originalFetch = global.fetch;
function withFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}
function textResponse(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { forEach() {} }, text: async () => JSON.stringify(body) });
}

test('hasKey is false with no keys and true when either BRAVE_API_KEY or SERPER_KEY is present', () => {
  assert.strictEqual(hasKey({}), false);
  assert.strictEqual(hasKey({ BRAVE_API_KEY: 'x' }), true);
  assert.strictEqual(hasKey({ SERPER_KEY: 'x' }), true);
});

test('search() returns a keyless error+hint with no key configured, never a fabricated result set', async () => {
  const r = await search('best dentist london', 'UK', 10, { env: {} });
  assert.ok(r.error);
  assert.ok(r.hint);
});

test('search() parses a real-shaped Serper response into {ads, organic, provider}', async () => {
  const body = { organic: [{ title: 'Acme Dental', link: 'https://acme-dental.co.uk/', position: 1 }], ads: [] };
  await withFetch(() => textResponse(body), async () => {
    const r = await search('dentist london', 'UK', 10, { env: { SERPER_KEY: 'k' } });
    assert.strictEqual(r.provider, 'serper');
    assert.strictEqual(r.organic[0].domain, 'acme-dental.co.uk');
    assert.strictEqual(r.organic[0].rank, 1);
  });
});

test('KNOWN-BAD calibration: a non-2xx SERP response falls through every provider to the keyless error, never throws', async () => {
  await withFetch(() => textResponse({ error: 'quota' }, 403), async () => {
    const r = await search('dentist london', 'UK', 10, { env: { BRAVE_API_KEY: 'b', SERPER_KEY: 'k' } });
    assert.ok(r.error);
  });
});

test('rootDomain extracts the bare host, stripping www', () => {
  assert.strictEqual(rootDomain('https://www.example.com/page'), 'example.com');
  assert.strictEqual(rootDomain('not a url'), '');
});
