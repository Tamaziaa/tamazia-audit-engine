'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createFetchFn, followChain, contentTypeOf, failResult, capOr } = require('./fetch.js');

// A scripted fetchOnce (the injected transport): a map of url -> {status, headers, body}. No socket opens.
function scriptedOnce(routes) {
  return (url) => Promise.resolve(routes[url] || { status: 404, headers: {}, body: 'not found' });
}

test('createFetchFn returns crawl.js\'s exact shape {ok,status,body,finalUrl,contentType} on a 200', async () => {
  const fetchFn = createFetchFn({ fetchOnce: scriptedOnce({
    'https://ok.example/': { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html>hi</html>' },
  }) });
  const r = await fetchFn('https://ok.example/');
  assert.deepStrictEqual(r, { ok: true, status: 200, body: '<html>hi</html>', finalUrl: 'https://ok.example/', contentType: 'text/html' });
});

test('a non-2xx resolves ok:false with the REAL status (a wall is an honest answer, never discarded)', async () => {
  const fetchFn = createFetchFn({ fetchOnce: scriptedOnce({ 'https://wall.example/': { status: 403, headers: {}, body: 'forbidden' } }) });
  const r = await fetchFn('https://wall.example/');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 403);
});

test('redirects are followed and every hop is re-validated for host safety', async () => {
  const fetchFn = createFetchFn({ fetchOnce: scriptedOnce({
    'https://a.example/': { status: 301, headers: { location: 'https://b.example/final' }, body: '' },
    'https://b.example/final': { status: 200, headers: { 'content-type': 'text/html' }, body: 'landed' },
  }) });
  const r = await fetchFn('https://a.example/');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.finalUrl, 'https://b.example/final');
  assert.strictEqual(r.body, 'landed');
});

test('KNOWN-BAD calibration: a redirect to a private/loopback host is REFUSED, never fetched (SSRF door)', async () => {
  // The scripted once would happily "serve" the private host, but parseSafeFetchTarget inside followChain
  // must refuse the hop before it is even handed to the transport - the DNS-rebinding/SSRF class.
  let privateHit = false;
  const fetchFn = createFetchFn({ fetchOnce: (url) => {
    if (url.includes('127.0.0.1') || url.includes('169.254')) { privateHit = true; return Promise.resolve({ status: 200, headers: {}, body: 'SECRET' }); }
    return Promise.resolve({ status: 302, headers: { location: 'http://127.0.0.1/admin' }, body: '' });
  } });
  const r = await fetchFn('https://evil.example/');
  assert.strictEqual(r.ok, false, 'a redirect into a private host must not succeed');
  assert.strictEqual(privateHit, false, 'the private host must never be handed to the transport');
});

test('KNOWN-BAD: an unsafe start target is refused with a typed failure, never a throw', async () => {
  const fetchFn = createFetchFn({ fetchOnce: scriptedOnce({}) });
  const r = await fetchFn('http://localhost:8080/');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 0);
});

test('a redirect chain longer than the cap fails closed (budgets are caps, never floors)', async () => {
  const fetchFn = createFetchFn({ maxRedirects: 2, fetchOnce: () => Promise.resolve({ status: 302, headers: { location: 'https://loop.example/next' }, body: '' }) });
  const r = await fetchFn('https://loop.example/');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /redirect/);
});

test('a transport error resolves to a typed failResult (the crawl records a failed slot, never a hang)', async () => {
  const fetchFn = createFetchFn({ fetchOnce: () => Promise.resolve({ error: new Error('econnreset') }) });
  const r = await fetchFn('https://err.example/');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /econnreset/);
});

test('contentTypeOf strips params and lowercases; capOr clamps down, never up (Rule 8)', () => {
  assert.strictEqual(contentTypeOf({ 'content-type': 'Application/JSON; charset=utf-8' }), 'application/json');
  assert.strictEqual(contentTypeOf({}), null);
  assert.strictEqual(capOr(5, 10), 5);       // a lower override is honoured
  assert.strictEqual(capOr(999, 10), 10);    // an override above the cap is clamped DOWN to the cap
  assert.strictEqual(capOr('x', 10), 10);    // a bad override falls back to the cap
  assert.strictEqual(failResult(0, 'r').ok, false);
});

test('followChain never opens a real socket in tests (injected fetchOnce only)', async () => {
  const seen = [];
  const cfg = { maxRedirects: 5, fetchOnce: (u) => { seen.push(u); return Promise.resolve({ status: 200, headers: {}, body: 'x' }); } };
  await followChain('https://x.example/', cfg);
  assert.deepStrictEqual(seen, ['https://x.example/']);
});
