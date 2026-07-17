'use strict';
// evidence/registers/lib/deadline.js — the ONE hard-deadline primitive every register module in
// this directory calls its fetchFn through (Constitution Rule 9: every register lookup is wrapped
// in a hard Promise.race deadline; a slow dependency degrades the mint, it never hangs it).
//
// withDeadline NEVER rejects and never throws synchronously for a caller: it always resolves to a
// discriminated result, so a caller can treat "timed out", "threw" and "resolved" uniformly without
// its own try/catch. The caller (evidence/registers/lib/lookup-runner.js) is the one place that
// turns each of these outcomes into a row-absent + loud note (C-041 doctrine).

const DEFAULT_DEADLINE_MS = 6000;

// withDeadline(fn, ms, label) -> Promise<{ok:true, value} | {ok:false, reason:'timeout'|'error', error?, label}>
// `fn` is a zero-argument thunk returning a Promise (or a plain value); it is invoked exactly once.
function withDeadline(fn, ms, label) {
  const budget = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_DEADLINE_MS;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: 'timeout', label: label || null, ms: budget });
    }, budget);
    if (timer && typeof timer.unref === 'function') timer.unref();

    let started;
    try {
      started = fn();
    } catch (err) {
      // FAIL-OPEN: a synchronously-thrown thunk is captured here, never rethrown or logged, because
      // turning it into the typed {ok:false, reason:'error', error:err} result IS the record (the
      // caller in lib/lookup-runner.js reads it and pushes a loud notes[] entry); resolving instead
      // of rethrowing is this module's entire contract (see the file header).
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: 'error', error: err, label: label || null });
      }
      return;
    }
    Promise.resolve(started).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: 'error', error: err, label: label || null });
      }
    );
  });
}

module.exports = { withDeadline, DEFAULT_DEADLINE_MS };
