'use strict';
// enforcement/collectors/lib/fetcher.js - THE one deadline-wrapped fetch primitive every
// enforcement collector calls through (Constitution Rule 9: every external fetch is wrapped in a
// hard Promise.race deadline; a slow or dead source degrades the collector run, it never hangs it).
//
// Reuses evidence/registers/lib/deadline.js's withDeadline (Rule 1: one door for the deadline
// primitive itself) rather than re-implementing a second Promise.race wrapper in this directory.
//
// fetchWithDeadline NEVER throws for a caller: every outcome is a typed, discriminated result, so a
// collector can branch on `.ok` without its own try/catch (the same "no lane error path returns an
// empty array" discipline the swallow-gate enforces elsewhere in this repo).

const crypto = require('crypto');
const { withDeadline, DEFAULT_DEADLINE_MS } = require('../../../evidence/registers/lib/deadline');

const DEFAULT_UA = 'Mozilla/5.0 (compatible; TamaziaEnforcementCollector/1.0; +https://tamazia.co.uk)';

// resolveDeadlineMs(opts) -> a positive finite deadline, falling back to DEFAULT_DEADLINE_MS for
// anything else (missing, zero, negative, NaN, non-number).
function resolveDeadlineMs(opts) {
  if (Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0) return opts.deadlineMs;
  return DEFAULT_DEADLINE_MS;
}

// buildRequestHeaders(opts) -> the default collector User-Agent, overridable/extendable by
// opts.headers (a caller-supplied header of the same name wins, per plain object spread order).
function buildRequestHeaders(opts) {
  return { 'User-Agent': DEFAULT_UA, ...(opts.headers || {}) };
}

// hasHttpStatusCode(response) -> boolean. True only when `response` is present and its `status`
// field is genuinely a number (guards the two shapes withDeadline's `.value` could ever hand back:
// a real Response, or - defensively - something malformed).
function hasHttpStatusCode(response) {
  if (!response) return false;
  return typeof response.status === 'number';
}

// isSuccessStatus(status) -> boolean. The 2xx range, matching `fetch`'s own notion of a non-error
// HTTP response (redirects are already followed by the time this runs, per `redirect: 'follow'`).
function isSuccessStatus(status) {
  if (status < 200) return false;
  return status < 300;
}

// isSuccessResponse(response) -> boolean. Combines the two checks above into the one guard
// fetchWithDeadline needs (CodeQL js/... / CodeScene Complex Conditional: kept as two single-term
// checks rather than one chained boolean expression).
function isSuccessResponse(response) {
  if (!hasHttpStatusCode(response)) return false;
  return isSuccessStatus(response.status);
}

// digestOf(bytes) -> hex sha256. Shared by the success-path digest below and sha256Of() so the two
// never drift (Rule 1: one door for the hash primitive itself).
function digestOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// readSuccessResult(response, requestedUrl) -> the ok:true result shape. Split out so
// fetchWithDeadline's own body stays a flat sequence of guard clauses (CodeScene Complex Method).
async function readSuccessResult(response, requestedUrl) {
  const text = await response.text();
  const bytes = Buffer.from(text, 'utf8');
  return {
    ok: true,
    status: response.status,
    url: response.url || requestedUrl,
    text,
    bytes,
    sha256: digestOf(bytes),
    fetchedAt: new Date().toISOString(),
  };
}

// fetchWithDeadline(url, { deadlineMs, headers, label } = {})
//   -> Promise<{ ok:true, status, url, text, bytes, sha256, fetchedAt }
//            | { ok:false, reason:'timeout'|'error'|'http_status', status?, label?, error? }>
async function fetchWithDeadline(url, opts = {}) {
  const deadlineMs = resolveDeadlineMs(opts);
  const label = opts.label || url;
  const headers = buildRequestHeaders(opts);

  const outcome = await withDeadline(() => fetch(url, { headers, redirect: 'follow' }), deadlineMs, label);

  if (!outcome.ok) {
    // outcome.reason is 'timeout' or 'error' (withDeadline's own discriminants); passed through
    // verbatim so the collector's caller sees the real cause, never a synthesised empty success.
    return { ok: false, reason: outcome.reason, label, error: outcome.error || null };
  }

  const response = outcome.value;
  if (!isSuccessResponse(response)) {
    return { ok: false, reason: 'http_status', status: response ? response.status : null, label };
  }

  return readSuccessResult(response, url);
}

// sha256Of(text) -> hex digest. Exposed so fixture-based tests and the seed-authoring script can
// hash a saved fixture the SAME way a live fetch would, proving the seeded rows' sha256 fields are
// re-derivable from the committed fixture bytes, not hand-typed.
function sha256Of(text) {
  return digestOf(Buffer.from(text, 'utf8'));
}

module.exports = { fetchWithDeadline, sha256Of, DEFAULT_UA };
