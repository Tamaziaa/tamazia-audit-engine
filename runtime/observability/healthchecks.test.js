'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pingHealthcheck, withHealthcheck } = require('./healthchecks.js');

afterEach(() => {
  mock.reset();
});

test('pingHealthcheck skips (does not throw) when no pingUrl is configured', async () => {
  const result = await pingHealthcheck(null);
  assert.equal(result.skipped, true);
});

test('pingHealthcheck appends the suffix to the ping URL', async () => {
  const fetchMock = mock.fn(async () => ({ ok: true, status: 200 }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    await pingHealthcheck('https://hc-ping.com/abc', 'start');
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://hc-ping.com/abc/start');
  } finally {
    global.fetch = originalFetch;
  }
});

test('pingHealthcheck records (does not throw) on a network failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => { throw new Error('offline'); });
  try {
    const result = await pingHealthcheck('https://hc-ping.com/abc');
    assert.equal(result.ok, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('withHealthcheck pings start then success on a successful job', async () => {
  const fetchMock = mock.fn(async () => ({ ok: true, status: 200 }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const result = await withHealthcheck('https://hc-ping.com/abc', async () => 'done');
    assert.equal(result, 'done');
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://hc-ping.com/abc/start');
    assert.equal(fetchMock.mock.calls[1].arguments[0], 'https://hc-ping.com/abc');
  } finally {
    global.fetch = originalFetch;
  }
});

test('withHealthcheck pings /fail and rethrows when the job throws (known-bad fixture)', async () => {
  const fetchMock = mock.fn(async () => ({ ok: true, status: 200 }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => withHealthcheck('https://hc-ping.com/abc', async () => { throw new Error('job broke'); }),
      /job broke/,
    );
    assert.equal(fetchMock.mock.calls[1].arguments[0], 'https://hc-ping.com/abc/fail');
  } finally {
    global.fetch = originalFetch;
  }
});
