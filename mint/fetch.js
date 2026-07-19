'use strict';
// mint/fetch.js - THE production fetchFn for the live mint (Constitution Rule 9, Rule 8, C-040).
//
// It productionises the safe http/https primitive proven in eval/reference-set/build-fixtures.js: Node's
// built-in http/https with makeSafeLookup(dns.lookup) pinning every DNS answer through the SSRF /
// DNS-rebinding blocklist, parseSafeFetchTarget re-validating every hop (initial AND every redirect), a
// hard per-request deadline (the request `timeout` option destroys the socket, and an outer Promise.race
// bounds the whole hop chain - a slow site DEGRADES the mint, never HANGS it), a body-size cap and a
// redirect cap. Budgets are CAPS, never floors (Rule 8): a caller may lower them, never raise them past
// the module ceilings, and none imposes a minimum wait.
//
// SHAPE CONTRACT (exactly what evidence/crawler/crawl.js's fetchFn expects):
//   fetchFn(url) -> Promise<{ ok, status, body, finalUrl, contentType }>
// `ok` is a 2xx status; a non-2xx (a wall, a 404) resolves with ok:false and the real status so the
// crawler can classify it honestly (C-031/C-038), never throws it away. A refused-unsafe target, an
// exhausted redirect chain or a deadline all resolve to a typed { ok:false, status:0, reason } rather
// than throwing into the crawl (the crawler's fetchPage already tolerates a null/failed slot).
//
// NETWORK-FREE BY INJECTION (the no-network-test doctrine): the transport is dependency-injected via
// opts.fetchOnce; every test passes a fake, so no real socket ever opens in CI. The default production
// transport (httpFetchOnce) is the only code that names http/https/dns, and it is reached only when no
// fake is injected.

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const dns = require('dns');
const { parseSafeFetchTarget, makeSafeLookup } = require('../tools/lib/safe-fetch.js');

// Every budget below is a hard CAP (Rule 8). A caller override is clamped down to the ceiling, never up.
const FETCH_DEADLINE_MS = 10000;          // per-request wall-clock ceiling (never a floor)
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT =
  'TamaziaAuditBot/2.0 (compliance audit; +https://tamazia.co.uk; contact: hello@tamazia.co.uk)';

// The single resolved-address guard, built once from the real resolver and passed as the request
// `lookup` option so every DNS answer - the initial hop AND every redirect hop - is re-validated against
// the private/loopback/link-local blocklist before a socket opens (DNS-rebinding SSRF). The hostname
// string is checked by parseSafeFetchTarget; the resolved IP is checked here; one door decides both.
const safeLookup = makeSafeLookup(dns.lookup);

// capOr(v, cap) -> a positive finite override CLAMPED to `cap`, else `cap` (Rule 8: a cap, never a floor).
function capOr(v, cap) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : cap;
}

// decodeStream(res) -> the response stream, transparently gunzipped/inflated per content-encoding. A
// mislabelled encoding surfaces as a stream error the caller records, never a silent empty body.
function decodeStream(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  if (enc.includes('gzip')) return res.pipe(zlib.createGunzip());
  if (enc.includes('deflate')) return res.pipe(zlib.createInflate());
  if (enc.includes('br')) return res.pipe(zlib.createBrotliDecompress());
  return res;
}

// collectBody(req, res, maxBytes, resolve) -> stream the body under the size cap. On overflow the request
// is destroyed and whatever was read so far resolves with truncatedBody:true (a cap, never a floor).
function collectBody(req, res, maxBytes, resolve) {
  const chunks = [];
  let bytes = 0;
  const stream = decodeStream(res);
  stream.on('data', (c) => {
    bytes += c.length;
    if (bytes > maxBytes) {
      req.destroy();
      resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncatedBody: true });
      return;
    }
    chunks.push(c);
  });
  stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  stream.on('error', (e) => resolve({ error: e }));
}

// httpFetchOnce(url, cfg) -> Promise<{status, headers, body, truncatedBody} | {error}>. ONE hop. Every hop
// re-parses and re-validates its target through the single SSRF door before a socket opens; an unsafe or
// malformed target resolves to a typed { error } (never throws). The socket `timeout` is the primitive's
// own hard bound; the caller's outer race is the belt around the whole chain (Rule 9, defence in depth).
function httpFetchOnce(url, cfg) {
  return new Promise((resolve) => {
    const u = parseSafeFetchTarget(url);
    if (!u) { resolve({ error: new Error('refused unsafe or malformed fetch target') }); return; }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'GET',
      headers: {
        'User-Agent': cfg.userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-GB,en;q=0.9', 'Accept-Encoding': 'gzip, deflate',
      },
      timeout: cfg.deadlineMs,
      lookup: safeLookup,
    }, (res) => collectBody(req, res, cfg.maxBodyBytes, resolve));
    req.on('timeout', () => req.destroy(new Error('socket timeout after ' + cfg.deadlineMs + 'ms')));
    req.on('error', (e) => resolve({ error: e }));
    req.end();
  });
}

// raceDeadline(promise, ms) -> resolves { timedOut:false, value } when promise settles first, or
// { timedOut:true } when ms elapses first. The abandoned promise gets a no-op catch so a late rejection
// never surfaces unhandled. A hard CAP around the whole redirect chain (Rule 9); no floor, no min wait.
function raceDeadline(promise, ms) {
  let timer = null;
  const settled = promise.then((value) => ({ timedOut: false, value })).catch((error) => ({ timedOut: false, value: { error } }));
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([settled, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

// contentTypeOf(headers) -> the response content-type (lowercased, param-stripped) or null.
function contentTypeOf(headers) {
  const raw = headers && (headers['content-type'] || headers['Content-Type']);
  if (typeof raw !== 'string' || !raw) return null;
  return raw.split(';')[0].trim().toLowerCase() || null;
}

// failResult(status, reason) -> the typed non-throwing failure the crawl tolerates.
function failResult(status, reason) {
  return { ok: false, status: status || 0, body: '', finalUrl: null, contentType: null, reason };
}

// isRedirect(res) -> the response is a 30x with a Location header (a hop to follow).
function isRedirect(res) {
  return REDIRECT_STATUSES.has(res.status) && Boolean(res.headers) && Boolean(res.headers.location);
}
// resolveRedirect(res, current) -> the absolute next-hop URL, or null when the Location is unparseable.
function resolveRedirect(res, current) {
  try { return new URL(res.headers.location, current).href; }
  catch (_e) { return null; /* FAIL-OPEN: a malformed Location cannot be followed safely; the caller turns null into a typed failResult so the crawl continues, never a throw or a silent success. */ }
}
// hopOutcome(res, current) -> { redirectTo } (a hop to follow) OR { result } (the final/failure result).
// The per-hop branching lives here so followChain stays a flat loop (the health-gate decision-point cap).
function hopOutcome(res, current) {
  if (!res || res.error) return { result: failResult(0, res && res.error ? String(res.error.message || res.error).slice(0, 160) : 'no response') };
  if (isRedirect(res)) {
    const next = resolveRedirect(res, current);
    return next ? { redirectTo: next } : { result: failResult(res.status, 'unparseable redirect target') };
  }
  const status = Number(res.status) || 0;
  return { result: { ok: status >= 200 && status < 300, status, body: String(res.body || ''), finalUrl: current, contentType: contentTypeOf(res.headers) } };
}

// followChain(startUrl, cfg) -> the final {ok, status, body, finalUrl, contentType} after following up to
// cfg.maxRedirects hops, each re-validated for host safety. A hop error / an exhausted redirect budget
// resolves to a typed failResult (never throws): the crawl records a failed slot and continues (Rule 9).
async function followChain(startUrl, cfg) {
  let current = startUrl;
  for (let i = 0; i <= cfg.maxRedirects; i++) {
    // Per-hop SSRF door in the ORCHESTRATOR (not only in the real transport): the initial target AND every
    // redirect hop is re-validated here before the transport is even called, so a redirect into a
    // localhost/loopback/private/link-local host is refused whatever the transport is (the DNS-rebinding /
    // SSRF class). httpFetchOnce re-checks too (defence in depth); an injected fake transport is guarded by
    // this check alone, so the safety cannot be defeated by swapping the transport.
    if (!parseSafeFetchTarget(current)) return failResult(0, 'refused unsafe or malformed fetch target: ' + String(current).slice(0, 120));
    const outcome = hopOutcome(await cfg.fetchOnce(current, cfg), current);
    if (outcome.result) return outcome.result;
    current = outcome.redirectTo;
  }
  return failResult(0, 'more than ' + cfg.maxRedirects + ' redirects');
}

/**
 * createFetchFn(opts) -> fetchFn(url) : Promise<{ok, status, body, finalUrl, contentType}>. The single
 * argument the crawler passes is the url; every knob is bound here at construction.
 *
 * opts.deadlineMs   per-request wall-clock CAP (default 10000; clamped, never a floor).
 * opts.maxBodyBytes body-size CAP (default 3MB).
 * opts.maxRedirects redirect CAP (default 5).
 * opts.userAgent    the request UA (default the Tamazia audit bot string).
 * opts.fetchOnce    injected transport (tests: a fake; production: omit for the real http/https primitive).
 */
function createFetchFn(opts = {}) {
  const cfg = {
    deadlineMs: capOr(opts.deadlineMs, FETCH_DEADLINE_MS),
    maxBodyBytes: capOr(opts.maxBodyBytes, MAX_BODY_BYTES),
    maxRedirects: capOr(opts.maxRedirects, MAX_REDIRECTS),
    userAgent: typeof opts.userAgent === 'string' && opts.userAgent ? opts.userAgent : USER_AGENT,
    fetchOnce: typeof opts.fetchOnce === 'function' ? opts.fetchOnce : httpFetchOnce,
  };
  return async function fetchFn(url) {
    // The outer race is the belt around the whole redirect chain (the socket timeout is the braces on each
    // hop): even a redirect loop that keeps returning fast 30x hops cannot outlast this ceiling (Rule 9).
    const outerMs = cfg.deadlineMs * (cfg.maxRedirects + 1) + 500;
    const raced = await raceDeadline(followChain(url, cfg), outerMs);
    if (raced.timedOut) return failResult(0, 'fetch exceeded the ' + outerMs + 'ms chain deadline (Rule 9)');
    return raced.value;
  };
}

module.exports = {
  createFetchFn,
  // exported for the node:test suite (helpers over injected inputs; never a fact producer):
  followChain,
  contentTypeOf,
  raceDeadline,
  failResult,
  capOr,
  FETCH_DEADLINE_MS,
  MAX_REDIRECTS,
  MAX_BODY_BYTES,
};
