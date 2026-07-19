'use strict';
// runtime/observability/sentry.js - Sentry free-tier hook, staged.
//
// No SENTRY_DSN is provisioned yet (not in COWORK-OS-EXECUTION/.env - this is a founder sign-up
// action, Sentry's free tier does not need a paid card but does need an account). This module is
// written so `initSentry()` is a safe no-op without a DSN, and becomes live the moment the founder
// sets SENTRY_DSN - no code change required, only an env var.

let Sentry;
try {
  Sentry = require('@sentry/node');
} catch {
  Sentry = null;
}

let initialised = false;

function initSentry({ dsn = process.env.SENTRY_DSN, environment = process.env.ENVIRONMENT || 'staging' } = {}) {
  if (!dsn) {
    console.warn('initSentry: no SENTRY_DSN configured, error reporting is local-log-only');
    return { active: false };
  }
  if (!Sentry) {
    console.warn('initSentry: SENTRY_DSN is set but @sentry/node is not installed in this image');
    return { active: false };
  }
  if (!initialised) {
    Sentry.init({ dsn, environment, tracesSampleRate: 0.1 });
    initialised = true;
  }
  return { active: true };
}

function captureException(err, context = {}) {
  if (Sentry && initialised) {
    Sentry.captureException(err, { extra: context });
  } else {
    // Recorded, not swallowed: without Sentry wired, the exception still reaches stderr with its
    // context, so nothing is silently lost pending the founder's Sentry sign-up.
    console.error('captureException (Sentry not active)', err, context);
  }
}

module.exports = { initSentry, captureException };
