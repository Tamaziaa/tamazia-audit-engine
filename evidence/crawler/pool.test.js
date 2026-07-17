'use strict';
// pool.test.js - the E-236 parallel primitive and the Rule 8 / Rule 9 proofs.
//
// The load-bearing proof here is DEADLINE-AS-CAP (Constitution Rule 8): the pool's wall-clock deadline
// STOPS it starting new work, it never imposes a minimum wait. The clock is injected so the proof is
// deterministic and instant - a floor would reveal itself as work that runs (or a wait that elapses)
// after the deadline has already passed, and these tests assert neither happens.

const test = require('node:test');
const assert = require('node:assert');

const { withDeadline, runPool } = require('./pool.js');

// timers that never fire the deadline (records that the timer is cleared on settle, so no dangling handle).
function noFireTimers() {
  const state = { cleared: false };
  const timers = { setTimeout: () => ({ unref() {} }), clearTimeout: () => { state.cleared = true; } };
  return { timers, state };
}

// timers whose setTimeout fires its callback synchronously (the deadline wins the race immediately).
function immediateTimers() {
  return { setTimeout: (cb) => { cb(); return { unref() {} }; }, clearTimeout: () => {} };
}

// steppingClock(seq) -> a now() returning seq[0], seq[1], ... then the last value forever. Lets a test
// place the pool's clock reads exactly: read #1 is `start`, then one read per worker iteration.
function steppingClock(seq) {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

test('withDeadline: a factory that resolves in time yields its value and CLEARS the timer', async () => {
  const { timers, state } = noFireTimers();
  const v = await withDeadline(() => Promise.resolve(7), 100, timers);
  assert.equal(v, 7);
  assert.equal(state.cleared, true, 'the deadline timer must be cleared so no handle keeps the process alive');
});

test('withDeadline: the deadline REJECTS a factory that never settles (Promise.race, Rule 9)', async () => {
  await assert.rejects(
    withDeadline(() => new Promise(() => {}), 100, immediateTimers()),
    /deadline exceeded after 100ms/,
  );
});

test('withDeadline: a synchronously-throwing factory rejects with ITS error, not a timeout', async () => {
  const { timers } = noFireTimers();
  await assert.rejects(withDeadline(() => { throw new Error('boom'); }, 100, timers), /boom/);
});

test('runPool: within the deadline, every item runs and results align to the input order', async () => {
  const items = ['a', 'b', 'c', 'd'];
  const out = await runPool(items, 2, 1000, (u, i) => Promise.resolve(u + i), () => 0);
  assert.deepEqual(out, ['a0', 'b1', 'c2', 'd3']);
});

test('DEADLINE-AS-CAP: once the clock passes the deadline the pool STOPS starting work (no floor)', async () => {
  // width 1 -> one worker -> clock reads are: #1 start, then one per item. The clock is at 50ms for the
  // first item (runs) and jumps to 200ms (past the 100ms deadline) for the rest, so items b, c, d are
  // never STARTED - they degrade to null immediately, they do not wait out any minimum (Rule 8).
  const started = [];
  const now = steppingClock([0, 50, 200, 200, 200]);
  const out = await runPool(['a', 'b', 'c', 'd'], 1, 100,
    (u) => { started.push(u); return Promise.resolve(u.toUpperCase()); }, now);
  assert.deepEqual(started, ['a'], 'only the item started before the deadline ran; the tail was never started');
  assert.deepEqual(out, ['A', null, null, null], 'past-deadline items are null, not delayed to a floor');
});

test('DEADLINE-AS-CAP: a deadline already exceeded at start runs NOTHING (no minimum-work floor)', async () => {
  const started = [];
  // start reads 0; every item check reads 500 (> the 100ms deadline) -> all null, fn never called.
  const now = steppingClock([0, 500, 500, 500]);
  const out = await runPool(['a', 'b', 'c'], 1, 100, (u) => { started.push(u); return Promise.resolve(u); }, now);
  assert.deepEqual(started, [], 'no item is started once the deadline is already past - the pool never floors up to N');
  assert.deepEqual(out, [null, null, null]);
});

test('runPool: one item throwing degrades to a null slot; the pool continues (FAIL-OPEN tolerance)', async () => {
  const out = await runPool(['a', 'b', 'c'], 3, 1000,
    (u) => (u === 'b' ? Promise.reject(new Error('flaky')) : Promise.resolve(u)), () => 0);
  assert.deepEqual(out, ['a', null, 'c']);
});

test('runPool: concurrency never exceeds width', async () => {
  let inFlight = 0;
  let peak = 0;
  const fn = async (u) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await Promise.resolve(); await Promise.resolve();
    inFlight--;
    return u;
  };
  const out = await runPool(['a', 'b', 'c', 'd', 'e', 'f'], 2, 1000, fn, () => 0);
  assert.equal(out.length, 6);
  assert.ok(peak <= 2, 'at most `width` fetches in flight at once, got peak ' + peak);
});

test('runPool: an empty item list opens no lanes and returns []', async () => {
  let called = false;
  const out = await runPool([], 8, 1000, () => { called = true; return Promise.resolve(1); }, () => 0);
  assert.deepEqual(out, []);
  assert.equal(called, false);
});
