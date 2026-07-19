'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { onpageSignalsProbe, extractHeaderSignals, extractMarkupSignals, jsonLdHasType } = require('./onpage-signals.js');

const HOME_HTML = '<!doctype html><html lang="en"><head><title>Oakhurst Legal</title>'
  + '<meta name="description" content="Solicitors in London providing legal advice.">'
  + '<meta property="og:title" content="Oakhurst Legal"><meta name="twitter:card" content="summary">'
  + '<link rel="canonical" href="https://oakhurst-legal.example/"><meta name="viewport" content="width=device-width">'
  + '<link rel="icon" href="/favicon.ico"></head><body><h1>Oakhurst Legal</h1></body></html>';

function fakeFetchOk(headers) {
  return async () => ({ ok: true, status: 200, headers: headers || {}, text: HOME_HTML });
}

test('onpageSignalsProbe abstains with reason no_domain on an empty domain', async () => {
  const r = await onpageSignalsProbe({ domain: '' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_domain');
});

test('KNOWN-BAD calibration: an unreachable site degrades to ok:false, never throws', async () => {
  const r = await onpageSignalsProbe({ domain: 'example.com', fetchFn: async () => ({ ok: false, status: 0, error: 'timeout' }) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'timeout');
});

test('a real-shaped fetch yields measured onpage/security/a11y/tech leaves with real header + markup signals', async () => {
  const headers = { 'strict-transport-security': 'max-age=63072000', 'x-frame-options': 'DENY' };
  const r = await onpageSignalsProbe({ domain: 'oakhurst-legal.example', fetchFn: fakeFetchOk(headers) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.onpage.state, 'measured');
  assert.strictEqual(r.onpage.meta_description, true);
  assert.strictEqual(r.security.hsts, true);
  assert.strictEqual(r.security.csp, false, 'a header genuinely absent from the fixture must read false, never fabricated true');
  assert.strictEqual(r.tech.canonical, true);
  assert.strictEqual(r.a11y.h1_count, 1);
});

test('extractHeaderSignals reads only the six named security headers, case-insensitively lower-cased by the caller', () => {
  const sig = extractHeaderSignals({ 'content-security-policy': "default-src 'self'" });
  assert.strictEqual(sig.csp, true);
  assert.strictEqual(sig.hsts, false);
});

test('extractMarkupSignals counts h1 elements and reads meta description length', () => {
  const sig = extractMarkupSignals('<h1>A</h1><h1>B</h1><meta name="description" content="short">');
  assert.strictEqual(sig.h1_count, 2);
  assert.strictEqual(sig.meta_description, true);
  assert.strictEqual(sig.meta_description_len, 5);
});

test('jsonLdHasType walks @graph blocks and matches @type by regex', () => {
  const jsonLd = [{ '@graph': [{ '@type': 'LocalBusiness' }] }];
  assert.strictEqual(jsonLdHasType(jsonLd, /LocalBusiness/), true);
  assert.strictEqual(jsonLdHasType(jsonLd, /FAQPage/), false);
  assert.strictEqual(jsonLdHasType(null, /Organization/), false);
});
