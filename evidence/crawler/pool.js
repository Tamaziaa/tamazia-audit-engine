'use strict';
/**
 * pool.js - the E-236 parallel primitive and the Rule 9 hard-deadline wrapper.
 *
 * E-236 restored a 43s crawl to 6.9s with identical accuracy by removing the IDLING, not the work: I/O-
 * bound page fetches run in a bounded-concurrency pool with a wall-clock deadline that is a CAP (it stops
 * STARTING new work past the deadline), never a floor (Constitution Rule 8 - no Math.max, no minimum wait).
 * The pool width comes from the caller; nothing here widens or floors it.
 *
 * Rule 9: every external step is wrapped in a hard Promise.race deadline, so a slow dependency degrades
 * the crawl (a null slot) and never hangs it (the 752s stuck-Chromium class). Timers are INJECTABLE so
 * node:test drives this deterministically with no real wall-clock wait.
 */

// withDeadline(factory, ms, timers) -> a promise that settles with factory()'s value, or REJECTS once
// `ms` elapses, whichever is first. timers defaults to the globals; a test injects a fake pair. The
// timer is always cleared so a resolved factory never leaves a dangling handle keeping the process alive.
function withDeadline(factory, ms, timers) {
  const T = timers || { setTimeout, clearTimeout };
  let timer = null;
  const deadline = new Promise((_resolve, reject) => {
    timer = T.setTimeout(() => reject(new Error('deadline exceeded after ' + ms + 'ms')), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([Promise.resolve().then(factory), deadline])
    .finally(() => { if (timer) T.clearTimeout(timer); });
}

// runPool(items, width, deadlineMs, fn, now) -> results aligned to `items` (null where a fetch failed or
// the wall-clock deadline was reached before that item STARTED). `now` is injectable (defaults to
// Date.now) so a test can prove the deadline is a cap: advance the clock past deadlineMs and the pool
// stops starting work, leaving the un-started tail null - it never blocks and never floors.
async function runPool(items, width, deadlineMs, fn, now) {
  const clock = typeof now === 'function' ? now : Date.now;
  const out = new Array(items.length);
  let idx = 0;
  const start = clock();
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      if (clock() - start >= deadlineMs) { out[i] = null; continue; } // CAP: never START at or past the deadline (>=, Rule 8 - the budget is exhausted the instant elapsed reaches it)
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = null; /* FAIL-OPEN: one page's failure degrades to a null slot and the crawl continues (E-236 tolerance); the null is visible to the caller's telemetry, not swallowed silently. */ }
    }
  }
  const lanes = items.length === 0 ? 0 : Math.min(width, items.length);
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}

module.exports = { withDeadline, runPool };
