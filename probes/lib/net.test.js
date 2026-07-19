'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchDeadlined, fetchJson, cleanDomain } = require('./net.js');

const originalFetch = global.fetch;
function withFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}

test('cleanDomain strips scheme, path and leading www, lower-cases', () => {
  assert.strictEqual(cleanDomain('https://WWW.Example.com/path?x=1'), 'example.com');
  assert.strictEqual(cleanDomain(''), '');
  assert.strictEqual(cleanDomain(null), '');
});

test('KNOWN-BAD calibration: a synchronously-throwing fetch (network down) resolves to a typed failure, never throws (Rule 4)', async () => {
  await withFetch(() => { throw new Error('ECONNREFUSED'); }, async () => {
    const r = await fetchDeadlined('https://example.com');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 0);
    assert.match(r.error, /fetch_error/);
  });
});

test('KNOWN-BAD calibration: a rejecting fetch promise (async network failure) resolves to a typed failure, never throws', async () => {
  await withFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')), async () => {
    const r = await fetchDeadlined('https://nonexistent.invalid');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /fetch_error/);
  });
});

test('a non-JSON 200 response degrades fetchJson to ok:false, never a thrown JSON.parse error', async () => {
  await withFetch(() => Promise.resolve({ ok: true, status: 200, headers: { forEach() {} }, text: async () => '<html>not json</html>' }), async () => {
    const r = await fetchJson('https://example.com/api');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'non_json_body');
  });
});

test('a well-formed 200 JSON response parses through fetchJson', async () => {
  await withFetch(() => Promise.resolve({ ok: true, status: 200, headers: { forEach() {} }, text: async () => JSON.stringify({ hello: 'world' }) }), async () => {
    const r = await fetchJson('https://example.com/api');
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.json, { hello: 'world' });
  });
});

test('fetchDeadlined times out on a promise that never settles, without hanging the test', async () => {
  await withFetch(() => new Promise(() => {}), async () => {
    const r = await fetchDeadlined('https://example.com', { deadlineMs: 30 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'timeout');
  });
});
