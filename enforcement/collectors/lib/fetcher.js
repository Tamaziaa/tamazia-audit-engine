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

// fetchWithDeadline(url, { deadlineMs, headers, label } = {})
//   -> Promise<{ ok:true, status, url, text, bytes, sha256, fetchedAt }
//            | { ok:false, reason:'timeout'|'error'|'http_status', status?, label?, error? }>
async function fetchWithDeadline(url, opts = {}) {
  const deadlineMs = Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0 ? opts.deadlineMs : DEFAULT_DEADLINE_MS;
  const label = opts.label || url;
  const headers = { 'User-Agent': DEFAULT_UA, ...(opts.headers || {}) };

  const outcome = await withDeadline(() => fetch(url, { headers, redirect: 'follow' }), deadlineMs, label);

  if (!outcome.ok) {
    // outcome.reason is 'timeout' or 'error' (withDeadline's own discriminants); passed through
    // verbatim so the collector's caller sees the real cause, never a synthesised empty success.
    return { ok: false, reason: outcome.reason, label, error: outcome.error || null };
  }

  const response = outcome.value;
  if (!response || typeof response.status !== 'number' || response.status < 200 || response.status >= 300) {
    return { ok: false, reason: 'http_status', status: response ? response.status : null, label };
  }

  const text = await response.text();
  const bytes = Buffer.from(text, 'utf8');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    ok: true,
    status: response.status,
    url: response.url || url,
    text,
    bytes,
    sha256,
    fetchedAt: new Date().toISOString(),
  };
}

// sha256Of(text) -> hex digest. Exposed so fixture-based tests and the seed-authoring script can
// hash a saved fixture the SAME way a live fetch would, proving the seeded rows' sha256 fields are
// re-derivable from the committed fixture bytes, not hand-typed.
function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

module.exports = { fetchWithDeadline, sha256Of, DEFAULT_UA };
