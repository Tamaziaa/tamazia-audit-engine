'use strict';
// probes/lib/net.js - the ONE deadline-wrapped HTTP primitive every probe module uses (Constitution
// Rule 9: every external step has a hard deadline; Rule 8: a budget is a cap, never a floor).
//
// Ported behaviour, not ported code: the old estate (cowork-os-fresh src/lib/audit/site-scan.js
// `timed()`) wrapped fetch in an AbortController with a per-call timeout. This file is the SAME idea,
// built once, reused by every probe (pagespeed.js, serp-client.js, authority-gap.js, ai-readiness.js,
// geo-probe.js) instead of six copies of the same AbortController dance (the jscpd/one-door lesson).
// It reuses evidence/browser/deadline.js's raceWithDeadline - that primitive is transport-agnostic
// (it races any promise against a ceiling); requiring it here is the SAME door, not a second one.
//
// Never throws: a network failure, a timeout, or a non-JSON body all resolve to a typed failure object
// so a calling probe can degrade to `probe_unavailable` rather than crash the mint (Rule 4).

const { raceWithDeadline } = require('../../evidence/browser/deadline.js');

const DEFAULT_DEADLINE_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; TamaziaAuditEngine/1.0; +https://tamazia.co.uk)';

// cleanDomain(d) -> the bare registrable-ish host: no scheme, no path, no leading www. Shared by every
// probe so "example.com" vs "https://www.example.com/" never diverges between two producers.
function cleanDomain(d) {
  return String(d || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
}

// abortableFetch(url, init, ms) -> a fetch bound to an AbortController that fires when the deadline
// races it out (raceWithDeadline abandons the original promise but never cancels it on its own; wiring
// the controller here means a timed-out request is ALSO cancelled at the socket, not just ignored).
function abortableFetch(url, init, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return fetch(url, Object.assign({}, init, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

function buildFetchInit(opts) {
  return {
    method: opts.method || 'GET',
    headers: Object.assign({ 'user-agent': UA }, opts.headers || {}),
    body: opts.body,
    redirect: 'follow',
  };
}

// racedFetch(url, init, ms) -> { ok:true, raced } | { ok:false, error }. Isolates the try/catch: a
// network throw (DNS failure, ECONNREFUSED, an aborted signal) never escapes past this point.
async function racedFetch(url, init, ms) {
  // raceWithDeadline REJECTS (not resolves-to-an-error-value) when the raced promise itself rejects (its
  // own header comment: "the caller's try/catch records it as a typed failure"), so the whole race - not
  // just the value-unwrap - must be inside this try/catch (Rule 4's never-throws contract).
  try { return { ok: true, raced: await raceWithDeadline(abortableFetch(url, init, ms), ms) }; }
  catch (e) { return { ok: false, error: 'fetch_error: ' + String((e && e.message) || e).slice(0, 160) }; }
}

// readResponseBody(res) -> { text, headers, json }. json stays null for a non-JSON body (not every
// endpoint answers JSON) rather than throwing a parse error.
async function readResponseBody(res) {
  const text = await res.text().catch(() => '');
  const headers = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch (_e) { json = null; } }
  return { text, headers, json };
}

// fetchDeadlined(url, {method, headers, body, deadlineMs}) -> { ok, status, headers, text, json, error }.
// Exactly one attempt (Rule 9's C-138 no-retry-storm doctrine: retry/backoff, if ever wanted, belongs
// inside a caller's own bounded loop, never baked into the shared primitive). Never throws.
async function fetchDeadlined(url, opts = {}) {
  const ms = Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0 ? opts.deadlineMs : DEFAULT_DEADLINE_MS;
  const init = buildFetchInit(opts);
  const outcome = await racedFetch(url, init, ms);
  if (!outcome.ok) return { ok: false, status: 0, error: outcome.error };
  if (outcome.raced.timedOut) return { ok: false, status: 0, error: 'timeout' };
  const res = outcome.raced.value;
  const { text, headers, json } = await readResponseBody(res);
  return { ok: res.ok, status: res.status, headers, text, json, error: res.ok ? null : 'http_' + res.status };
}

// fetchJson(url, opts) -> fetchDeadlined() plus a convenience: ok is downgraded to false when the
// endpoint answered but the body did not parse as JSON (a caller that only wants JSON never has to
// re-check `.json !== null` itself).
async function fetchJson(url, opts) {
  const r = await fetchDeadlined(url, opts);
  if (r.ok && r.json === null) return Object.assign({}, r, { ok: false, error: 'non_json_body' });
  return r;
}

module.exports = { fetchDeadlined, fetchJson, cleanDomain, UA, DEFAULT_DEADLINE_MS };
