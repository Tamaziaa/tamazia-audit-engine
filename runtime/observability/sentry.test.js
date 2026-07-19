'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initSentry, captureException } = require('./sentry.js');

test('initSentry is a safe no-op without a DSN (staged default, no founder key yet)', () => {
  const result = initSentry({ dsn: undefined });
  assert.equal(result.active, false);
});

test('captureException never throws even when Sentry is not active', () => {
  assert.doesNotThrow(() => captureException(new Error('boom'), { stage: 'evidence' }));
});

test('captureException logs to console.error when Sentry is not active (known-bad fixture: never silent)', () => {
  const lines = [];
  const originalError = console.error;
  console.error = (...args) => lines.push(args);
  try {
    captureException(new Error('boom'), { stage: 'mint' });
  } finally {
    console.error = originalError;
  }
  assert.equal(lines.length, 1);
});
