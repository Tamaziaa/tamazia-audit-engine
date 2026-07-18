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

// The Promise executor below settles exactly once across three independent triggers (timeout, a
// synchronous throw, and the thunk's own resolution/rejection). Each settle path is its own named
// function sharing one small mutable ctx, so no single function's body holds all three (the health-gate
// Complex Method cap: CodeScene otherwise attributes a deeply-nested inline executor to the enclosing
// named function, exactly as it did here before this split).
function settleTimeout(ctx, budget) {
  if (ctx.settled) return;
  ctx.settled = true;
  ctx.resolve({ ok: false, reason: 'timeout', label: ctx.label, ms: budget });
}
// FAIL-OPEN: a caller error (synchronous throw or rejection) is captured here, never rethrown or
// logged, because turning it into the typed {ok:false, reason:'error', error:err} result IS the record
// (the caller in lib/lookup-runner.js reads it and pushes a loud notes[] entry); resolving instead of
// rethrowing is this module's entire contract (see the file header).
function settleError(ctx, err) {
  if (ctx.settled) return;
  ctx.settled = true;
  clearTimeout(ctx.timer);
  ctx.resolve({ ok: false, reason: 'error', error: err, label: ctx.label });
}
function settleValue(ctx, value) {
  if (ctx.settled) return;
  ctx.settled = true;
  clearTimeout(ctx.timer);
  ctx.resolve({ ok: true, value });
}
function startDeadlineTimer(ctx, budget) {
  const timer = setTimeout(() => settleTimeout(ctx, budget), budget);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}
// runThunk(ctx, fn) -> invoke the thunk exactly once, routing a synchronous throw or an async
// resolution/rejection to the matching settle function.
function runThunk(ctx, fn) {
  let started;
  try {
    started = fn();
  } catch (err) {
    // FAIL-OPEN: a synchronous throw from the thunk is RECORDED, not swallowed - settleError routes it
    // into the deadline context's single settle (the caller receives a typed error outcome); runThunk
    // then returns because the deadline is already settled.
    settleError(ctx, err);
    return;
  }
  Promise.resolve(started).then((value) => settleValue(ctx, value), (err) => settleError(ctx, err));
}

// withDeadline(fn, ms, label) -> Promise<{ok:true, value} | {ok:false, reason:'timeout'|'error', error?, label}>
// `fn` is a zero-argument thunk returning a Promise (or a plain value); it is invoked exactly once.
function withDeadline(fn, ms, label) {
  const budget = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_DEADLINE_MS;
  return new Promise((resolve) => {
    const ctx = { settled: false, timer: null, resolve, label: label || null };
    ctx.timer = startDeadlineTimer(ctx, budget);
    runThunk(ctx, fn);
  });
}

module.exports = { withDeadline, DEFAULT_DEADLINE_MS };
