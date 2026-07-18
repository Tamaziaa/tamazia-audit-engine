'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { withDeadline, DEFAULT_DEADLINE_MS } = require('./deadline');

test('withDeadline: resolves ok:true with the settled value', async () => {
  const r = await withDeadline(() => Promise.resolve({ status: 200, json: { ok: 1 } }), 100, 'unit');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { status: 200, json: { ok: 1 } });
});

test('withDeadline: a synchronous plain value (not a promise) also resolves ok:true', async () => {
  const r = await withDeadline(() => 42, 100, 'unit');
  assert.equal(r.ok, true);
  assert.equal(r.value, 42);
});

test('withDeadline: a promise that never settles times out at the given budget, never hangs', async () => {
  const start = Date.now();
  const r = await withDeadline(() => new Promise(() => {}), 30, 'slow-dep');
  const elapsed = Date.now() - start;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
  assert.equal(r.label, 'slow-dep');
  assert.ok(elapsed < 500, 'must not wait far beyond the deadline budget');
});

test('withDeadline: a rejecting promise resolves ok:false reason:error, never rejects the caller', async () => {
  const r = await withDeadline(() => Promise.reject(new Error('boom')), 100, 'unit');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.equal(r.error.message, 'boom');
});

test('withDeadline: a thunk that throws synchronously is captured, never propagated', async () => {
  const r = await withDeadline(() => { throw new Error('sync-throw'); }, 100, 'unit');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.equal(r.error.message, 'sync-throw');
});

test('withDeadline: a non-finite or non-positive ms falls back to DEFAULT_DEADLINE_MS (does not throw)', async () => {
  const r = await withDeadline(() => Promise.resolve('fine'), 0, 'unit');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'fine');
  assert.ok(DEFAULT_DEADLINE_MS > 0);
});

test('withDeadline: a value that settles well inside a generous deadline wins over the timer', async () => {
  const r = await withDeadline(() => new Promise((resolve) => setTimeout(() => resolve('value-wins'), 5)), 2000, 'race');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'value-wins');
});
