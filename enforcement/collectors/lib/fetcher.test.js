'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchWithDeadline, sha256Of } = require('./fetcher');

function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = original;
    });
}

test('fetchWithDeadline returns ok:true with a matching sha256 on a 200 response', async () => {
  await withMockedFetch(
    async () => ({ status: 200, url: 'https://example.test/page', text: async () => 'hello world' }),
    async () => {
      const result = await fetchWithDeadline('https://example.test/page');
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.text, 'hello world');
      assert.equal(result.sha256, sha256Of('hello world'));
      assert.ok(result.fetchedAt);
    },
  );
});

test('fetchWithDeadline returns a typed http_status failure on a non-2xx response, never a fake success (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  await withMockedFetch(
    async () => ({ status: 403, url: 'https://example.test/blocked', text: async () => 'forbidden' }),
    async () => {
      const result = await fetchWithDeadline('https://example.test/blocked');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'http_status');
      assert.equal(result.status, 403);
    },
  );
});

test('fetchWithDeadline returns a typed error failure when the fetch implementation throws (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  await withMockedFetch(
    async () => {
      throw new Error('DNS resolution failed');
    },
    async () => {
      const result = await fetchWithDeadline('https://example.test/dead-dns');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'error');
      assert.match(String(result.error && result.error.message), /DNS resolution failed/);
    },
  );
});

test('fetchWithDeadline returns a typed timeout failure when the source hangs past the deadline (KNOWN-BAD CALIBRATION FIXTURE)', async () => {
  await withMockedFetch(
    () => new Promise(() => {}), // never resolves: simulates a hung source
    async () => {
      const result = await fetchWithDeadline('https://example.test/hangs', { deadlineMs: 30 });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'timeout');
    },
  );
});

test('fetchWithDeadline aborts the underlying request once the deadline elapses, not merely abandoning it running in the background', async () => {
  let observedSignal;
  await withMockedFetch(
    (_url, opts) => {
      observedSignal = opts.signal;
      return new Promise(() => {}); // never resolves: only the AbortSignal ever settles this fetch
    },
    async () => {
      const result = await fetchWithDeadline('https://example.test/hangs-and-aborts', { deadlineMs: 30 });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'timeout');
      assert.ok(observedSignal, 'the mocked fetch must have been called with a signal in its options');
      // AbortSignal.timeout(30) is a separate clock from withDeadline's own 30ms timer; give it a
      // moment to fire so this assertion is not a race against the first one above.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(observedSignal.aborted, true, 'the fetch signal must abort at the deadline, proving the in-flight request is actually cancelled, not just abandoned');
    },
  );
});

test('sha256Of is deterministic and matches the digest fetchWithDeadline computes', () => {
  assert.equal(sha256Of('abc'), sha256Of('abc'));
  assert.equal(sha256Of('abc').length, 64);
  assert.notEqual(sha256Of('abc'), sha256Of('abd'));
});
