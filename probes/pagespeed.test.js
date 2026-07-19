'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pagespeedProbe, parsePsi } = require('./pagespeed.js');

const originalFetch = global.fetch;
function withFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300, status,
    headers: { forEach() {} },
    text: async () => JSON.stringify(body),
  });
}

test('pagespeedProbe abstains with reason no_key when PAGESPEED_API_KEY is absent (Rule 10: never a fabricated score)', async () => {
  const r = await pagespeedProbe({ domain: 'example.com', env: {} });
  assert.deepStrictEqual(r, { ok: false, reason: 'no_key' });
});

test('pagespeedProbe abstains with reason no_domain when the domain is empty', async () => {
  const r = await pagespeedProbe({ domain: '', env: { PAGESPEED_API_KEY: 'k' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_domain');
});

test('parsePsi extracts perf/seo scores + core web vitals from a real-shaped Lighthouse result', () => {
  const lh = {
    lighthouseResult: {
      categories: { performance: { score: 0.82 }, seo: { score: 0.91 }, accessibility: { score: 0.7 }, 'best-practices': { score: 0.85 } },
      audits: {
        'largest-contentful-paint': { numericValue: 2100 },
        'cumulative-layout-shift': { numericValue: 0.04 },
        'first-contentful-paint': { numericValue: 900 },
        'total-blocking-time': { numericValue: 150, score: 0.6, scoreDisplayMode: 'numeric', title: 'Reduce blocking time' },
      },
    },
  };
  const parsed = parsePsi(lh, 'mobile');
  assert.strictEqual(parsed.strategy, 'mobile');
  assert.strictEqual(parsed.perf, 0.82);
  assert.strictEqual(parsed.seo, 0.91);
  assert.strictEqual(parsed.cwv.lcp_ms, 2100);
  assert.strictEqual(parsed.cwv.cls, 0.04);
  assert.ok(Array.isArray(parsed.audits));
});

test('parsePsi returns null on a malformed/absent lighthouseResult (fail closed, never a guessed score)', () => {
  assert.strictEqual(parsePsi({}, 'mobile'), null);
  assert.strictEqual(parsePsi(null, 'mobile'), null);
});

test('KNOWN-BAD calibration: pagespeedProbe degrades to ok:false on a non-2xx PSI response, never throws', async () => {
  await withFetch(() => jsonResponse({ error: { message: 'quota exceeded' } }, 429), async () => {
    const r = await pagespeedProbe({ domain: 'example.com', env: { PAGESPEED_API_KEY: 'k' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_data');
  });
});

test('a live-shaped 200 response with a parseable lighthouseResult yields ok:true with real numbers', async () => {
  const body = {
    lighthouseResult: {
      categories: { performance: { score: 0.5 }, seo: { score: 0.6 }, accessibility: { score: 0.7 }, 'best-practices': { score: 0.8 } },
      audits: { 'largest-contentful-paint': { numericValue: 3000 }, 'cumulative-layout-shift': { numericValue: 0.2 } },
    },
  };
  await withFetch(() => jsonResponse(body), async () => {
    const r = await pagespeedProbe({ domain: 'example.com', env: { PAGESPEED_API_KEY: 'k' } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mobile.perf, 0.5);
    assert.strictEqual(r.desktop.perf, 0.5);
  });
});
