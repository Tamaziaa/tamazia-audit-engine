'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stageQueueOptions, DEFAULT_RETRY_POLICY, createBoss } = require('./boss.js');

test('stageQueueOptions returns the default retry policy plus a namespaced queue name', () => {
  const opts = stageQueueOptions('evidence');
  assert.equal(opts.queueName, 'audit-evidence');
  assert.equal(opts.retryLimit, DEFAULT_RETRY_POLICY.retryLimit);
  assert.equal(opts.expireInSeconds, DEFAULT_RETRY_POLICY.expireInSeconds);
});

test('stageQueueOptions allows per-stage overrides without mutating the shared default', () => {
  const opts = stageQueueOptions('mint', { retryLimit: 1 });
  assert.equal(opts.retryLimit, 1);
  assert.equal(DEFAULT_RETRY_POLICY.retryLimit, 5, 'shared default must stay frozen');
});

test('stageQueueOptions abstains (throws) on a missing stage name (known-bad fixture)', () => {
  assert.throws(() => stageQueueOptions(), /requires a stageName/);
  assert.throws(() => stageQueueOptions(''), /requires a stageName/);
});

test('DEFAULT_RETRY_POLICY is frozen (cannot be mutated by a careless caller)', () => {
  assert.throws(() => {
    DEFAULT_RETRY_POLICY.retryLimit = 99;
  }, TypeError);
});

test('createBoss refuses to run with no connection string (fails closed, never defaults to production)', () => {
  assert.throws(() => createBoss(), /requires a connectionString/);
  assert.throws(() => createBoss(''), /requires a connectionString/);
});
