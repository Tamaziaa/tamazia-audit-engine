'use strict';
// runtime/observability/logger.js - structured logging factory (pino), one door for the whole
// runtime layer's log output.
//
// `pino` is a second explicit exception to the zero-runtime-npm-dependency default (alongside
// pg-boss in runtime/queue/), scoped to runtime/ only. It is never imported by facts/, breach/,
// applicability/, payload/, mint/, or catalogue/, which keep using whatever plain-console logging
// they already use.

let pino;
try {
  pino = require('pino');
} catch {
  pino = null;
}

/**
 * Fallback logger used when the `pino` package is not installed (e.g. this staged worktree, or a
 * `node --test` run outside the VM's docker image). Matches the small subset of pino's API this
 * runtime layer actually calls, so callers do not need to branch on which logger they got.
 */
function createFallbackLogger(bindings = {}) {
  const base = { ...bindings };
  const emit = (level) => (obj, msg) => {
    const line = typeof obj === 'string' ? { msg: obj } : { ...base, ...obj, msg: msg || obj.msg };
    console[level === 'error' || level === 'fatal' ? 'error' : 'log'](JSON.stringify({ level, ...line, time: new Date().toISOString() }));
  };
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    debug: emit('debug'),
    child: (childBindings) => createFallbackLogger({ ...base, ...childBindings }),
  };
}

/**
 * @param {object} [bindings] - fields attached to every log line (e.g. { service: 'worker' }).
 */
function createLogger(bindings = {}) {
  if (!pino) {
    return createFallbackLogger(bindings);
  }
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: bindings,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

module.exports = { createLogger, createFallbackLogger };
