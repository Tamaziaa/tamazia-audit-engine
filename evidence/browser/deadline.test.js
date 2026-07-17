'use strict';
// evidence/browser/deadline.test.js - node:test suite for the hard deadline primitive (Rule 9 / C-040).
// Run: node --test evidence/browser/deadline.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { raceWithDeadline, runWithDeadline } = require('./deadline.js');

const hang = () => new Promise(() => {}); // never settles - no timer, so it never keeps the loop alive

test('raceWithDeadline: a promise that fulfils before the deadline returns its value', async () => {
  const r = await raceWithDeadline(Promise.resolve('ok'), 1000);
  assert.equal(r.timedOut, false);
  assert.equal(r.value, 'ok');
  assert.equal(typeof r.elapsed, 'number');
});

test('raceWithDeadline: a hanging promise cannot hold past the deadline - it times out', async () => {
  const r = await raceWithDeadline(hang(), 20);
  assert.equal(r.timedOut, true);
  assert.equal(typeof r.elapsed, 'number');
});

test('raceWithDeadline: STRUCTURAL PROOF - a never-resolving promise resolves the race in bounded wall time', async () => {
  const started = Date.now();
  const r = await raceWithDeadline(hang(), 30);
  const wall = Date.now() - started;
  assert.equal(r.timedOut, true);
  // The whole point of C-040: the hang cannot extend the wall clock arbitrarily. 30ms cap, generous
  // slack for a loaded CI runner, but nowhere near the 752s class this primitive exists to forbid.
  assert.ok(wall < 2000, 'raced far past the deadline (' + wall + 'ms) - the hang was NOT bounded');
});

test('raceWithDeadline: a rejecting promise rejects the race (the caller records it, never a swallow)', async () => {
  await assert.rejects(() => raceWithDeadline(Promise.reject(new Error('boom')), 1000), /boom/);
});

test('raceWithDeadline: the deadline timer is cleared on the fast path (no lingering handle)', async () => {
  // If the timer were not cleared, an active setTimeout would keep the event loop alive. We assert the
  // race settles promptly; a lingering timer would not fail this directly, but the primitive clears it
  // in finally, and the fast resolution below exercises that path.
  const r = await raceWithDeadline(Promise.resolve(42), 5000);
  assert.equal(r.value, 42);
});

test('runWithDeadline: a factory that throws synchronously rejects (not treated as a timeout)', async () => {
  await assert.rejects(() => runWithDeadline(() => { throw new Error('factory-threw'); }, 1000), /factory-threw/);
});

test('runWithDeadline: a factory returning a hanging promise times out', async () => {
  const r = await runWithDeadline(() => hang(), 20);
  assert.equal(r.timedOut, true);
});

test('raceWithDeadline: an injected clock drives elapsed deterministically', async () => {
  let t = 100;
  const now = () => t;
  const p = Promise.resolve('x').then((v) => { t = 175; return v; });
  const r = await raceWithDeadline(p, 1000, now);
  assert.equal(r.timedOut, false);
  assert.equal(r.elapsed, 75);
});
