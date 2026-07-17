'use strict';
// evidence/browser/deadline.js - the ONE hard deadline primitive for the browser lane
// (Constitution Rule 9 / caution.md C-040).
//
// WHY THIS FILE EXISTS: a stuck Chromium once held a mint hostage for 752 seconds because the
// browser's own internal goto timeout did not bound launch + networkidle. The lesson: a slow
// external dependency must DEGRADE the mint, never HANG it. Every browser step in observe.js is
// routed through this primitive, so no code path can await a promise that may never settle without
// a wall-clock ceiling on it. The primitive itself uses a real timer (setTimeout) that is always
// cleared on the winning path, so it leaves nothing pending in the event loop.
//
// This is a CAP, never a floor (Rule 8): it races an existing promise against a ceiling and takes
// whichever settles first. It never delays a fast promise and never imposes a minimum wait.

// raceWithDeadline(promise, ms, now) -> Promise<{ timedOut, value?, elapsed }>.
//   - resolves { timedOut:false, value, elapsed } if `promise` settles (fulfils) within `ms`;
//   - resolves { timedOut:true, elapsed } if `ms` elapses first (the original promise is abandoned
//     in the background - the caller is responsible for force-closing whatever it holds);
//   - if `promise` REJECTS before the deadline, this rejects with that reason (the caller's
//     try/catch records it as a typed failure, Rule 4).
// `now` is an injected clock (default Date.now) so elapsed timing is testable without real waits.
function raceWithDeadline(promise, ms, now) {
  const clock = typeof now === 'function' ? now : Date.now;
  const start = clock();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, elapsed: clock() - start }), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  const work = Promise.resolve(promise).then((value) => ({ timedOut: false, value, elapsed: clock() - start }));
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// runWithDeadline(factory, ms, now) -> the same contract, but takes a promise FACTORY so the timed
// work is only started here. Convenience for call sites that build the promise inline.
function runWithDeadline(factory, ms, now) {
  let started;
  try {
    started = factory();
  } catch (e) {
    // FAIL-OPEN: a synchronous factory failure is a real error, not a timeout; it is re-raised as a
    // rejected promise so the caller's catch records it (Rule 4). Never silently swallowed.
    return Promise.reject(e);
  }
  return raceWithDeadline(started, ms, now);
}

module.exports = { raceWithDeadline, runWithDeadline };
