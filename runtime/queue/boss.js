'use strict';
// runtime/queue/boss.js - pg-boss client factory (one door for creating a boss instance).
//
// `pg-boss` is the one explicitly blueprint-mandated exception to the engine's zero-runtime-npm-
// dependency rule (Kimi blueprint section D: "pg-boss (Postgres-backed job queue) + explicit typed
// step functions"). Its scope is deliberately fenced to runtime/queue/ - no file under facts/,
// breach/, applicability/, payload/, mint/, or catalogue/ may require it or anything in this
// directory.

let PgBoss;
let loadError = null;
try {
  // Lazy require: this file is imported by tests that only exercise createStepQueue's option
  // shaping, and by module.exports checks in CI where the dependency may not be installed yet
  // (package.json below lists it but it is not vendored into this worktree's node_modules in the
  // staged build). Every catch here rethrows with context rather than swallowing.
  PgBoss = require('pg-boss');
} catch (err) {
  PgBoss = null;
  // Recorded, not swallowed: createBoss() below throws a clear error if PgBoss is unavailable at
  // call time, so a missing dependency fails loudly the first time it is actually needed rather
  // than at random require-time in an unrelated code path.
  loadError = err;
}

const DEFAULT_RETRY_POLICY = Object.freeze({
  retryLimit: 5,
  retryBackoff: true,
  retryDelay: 5, // seconds, doubled by pg-boss's exponential backoff when retryBackoff is true
  expireInSeconds: 120, // hard per-job visibility timeout; a stuck worker's job is requeued
});

/**
 * Create (but do not start) a pg-boss instance bound to the given connection string.
 * Callers are responsible for `await boss.start()` and `await boss.stop()`.
 *
 * @param {string} connectionString - a Neon branch connection string. Never the production
 *   NEON_URL in staging/dev use; production wiring is a founder-approved cutover, documented in
 *   DEPLOY-RUNBOOK.md, not something this factory defaults to.
 * @param {object} [options]
 * @returns {import('pg-boss')}
 */
function createBoss(connectionString, options = {}) {
  if (!connectionString) {
    throw new Error('createBoss requires a connectionString (a Neon branch URL, not production)');
  }
  if (!PgBoss) {
    throw new Error(
      `pg-boss is not installed in this environment: ${loadError && loadError.message}`,
    );
  }
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    ...options,
  });
}

/**
 * Shape (not send) the options object for a given pipeline stage's queue registration, so tests
 * can assert on retry/backoff/timeout policy without a live database.
 *
 * @param {string} stageName - one of the eight pipeline stages.
 * @param {object} [overrides]
 */
function stageQueueOptions(stageName, overrides = {}) {
  if (!stageName || typeof stageName !== 'string') {
    throw new Error('stageQueueOptions requires a stageName');
  }
  return {
    ...DEFAULT_RETRY_POLICY,
    ...overrides,
    // queue name convention: one queue per pipeline stage, so a dying lane (e.g. a browser-lane
    // outage on the evidence stage) never blocks unrelated lanes - the bulkhead the blueprint asks
    // for, expressed as separate pg-boss queues rather than separate database instances.
    queueName: `audit-${stageName}`,
  };
}

module.exports = { createBoss, stageQueueOptions, DEFAULT_RETRY_POLICY };
