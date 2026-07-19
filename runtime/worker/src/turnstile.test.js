'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { verifyTurnstileToken } = require('./turnstile.js');

afterEach(() => {
  mock.reset();
});

test('verifyTurnstileToken abstains (fails closed) when token or secret is missing', async () => {
  const verdict = await verifyTurnstileToken(null, 'secret');
  assert.equal(verdict.success, false);
  assert.equal(verdict.reason, 'missing_token_or_secret');
});

test('verifyTurnstileToken returns success:true on a genuine Cloudflare success payload', async () => {
  const fetchMock = mock.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const verdict = await verifyTurnstileToken('good-token', 'secret-key', '1.2.3.4');
    assert.equal(verdict.success, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('verifyTurnstileToken (known-bad fixture) rejects a Cloudflare failure payload', async () => {
  const fetchMock = mock.fn(async () => ({
    ok: true,
    json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const verdict = await verifyTurnstileToken('bad-token', 'secret-key');
    assert.equal(verdict.success, false);
    assert.equal(verdict.reason, 'invalid-input-response');
  } finally {
    global.fetch = originalFetch;
  }
});

test('verifyTurnstileToken fails closed (not open) when siteverify is unreachable', async () => {
  const fetchMock = mock.fn(async () => {
    throw new Error('network down');
  });
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const verdict = await verifyTurnstileToken('token', 'secret-key');
    assert.equal(verdict.success, false);
    assert.equal(verdict.reason, 'siteverify_unreachable');
  } finally {
    global.fetch = originalFetch;
  }
});

test('verifyTurnstileToken reports a non-2xx siteverify response as failure', async () => {
  const fetchMock = mock.fn(async () => ({ ok: false, status: 503 }));
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const verdict = await verifyTurnstileToken('token', 'secret-key');
    assert.equal(verdict.success, false);
    assert.equal(verdict.reason, 'siteverify_http_503');
  } finally {
    global.fetch = originalFetch;
  }
});
