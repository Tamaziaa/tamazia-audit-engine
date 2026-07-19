'use strict';
// runtime/vm/browser/server.js - warm Playwright chromium pool, control API for evidence workers.
//
// One browser process, MAX_CONTEXTS isolated contexts checked out/in by worker containers over a
// small HTTP API. This is the "warm pool" the blueprint asks for: no per-audit browser launch, no
// cold-start tax inside the 45-second budget. Memory is capped at the docker-compose service
// level (1536M limit), not here - this process caps context *count*, the compose file caps RAM.

const http = require('node:http');
const dns = require('node:dns');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 3500);
const MAX_CONTEXTS = Number(process.env.MAX_CONTEXTS || 4);

let browser = null;
let inFlight = 0;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }
  // Every catch rethrows or records: a launch failure here propagates to the HTTP response as a
  // 503 rather than being swallowed, so the calling step function's retry/backoff (pg-boss) sees
  // a real failure and retries per policy rather than silently proceeding with no evidence.
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function withContext(handler) {
  if (inFlight >= MAX_CONTEXTS) {
    const err = new Error('pool_saturated');
    err.statusCode = 429;
    throw err;
  }
  inFlight += 1;
  const b = await getBrowser();
  const context = await b.newContext({
    recordHar: process.env.HAR_DIR ? { path: `${process.env.HAR_DIR}/${Date.now()}.har` } : undefined,
  });
  try {
    return await handler(context);
  } finally {
    await context.close();
    inFlight -= 1;
  }
}

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length });
  res.end(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ── navigation-target guard (SSRF) ──────────────────────────────────────────────────────────────
//
// /evidence/collect takes a worker-supplied `url` and used to hand it straight to Playwright's
// page.goto(); an unvalidated string there lets any caller point this warm Chromium pool at an
// internal target (a cloud metadata endpoint, a sibling container on this docker network, a
// loopback service) - a classic SSRF vector (Semgrep javascript.playwright.security.audit.
// playwright-goto-injection). resolveAllowedTarget below closes the direct cases: a disallowed
// scheme, an IP-literal in a blocked range, or a hostname that DNS currently resolves to one.
//
// This mirrors the blocked-range door the engine core already uses at tools/lib/safe-fetch.js
// (parseSafeFetchTarget / isBlockedHost) rather than inventing a different policy, but it is a
// standalone reimplementation, not a `require` of that file: this Dockerfile ships server.js as a
// single self-contained file (see its COPY list - only server.js + package.json), with no sibling
// engine-core files in the image's build context. Requiring across that boundary would resolve
// under `node --test` from the repo root and then throw MODULE_NOT_FOUND inside the actual
// container - the "looks green, breaks live" gap Rule 17 exists to catch.
//
// Residual scope: Playwright drives Chromium's own network stack for the actual navigation, which
// this Node process cannot hook the way tools/lib/safe-fetch.js hooks Node's own `dns.lookup` for
// fetch/http.request, so a DNS answer that only changes AFTER this check (a rebinding race) is not
// closed here. This endpoint is not internet-facing - compose wires it as `http://browser:3500`,
// reachable only from the `worker` containers on the private `runtime` bridge network - so the
// realistic threat this closes is a malformed or compromised job payload aiming the pool at
// internal infrastructure, not an adversary with an active DNS rebinding position.

const BLOCKED_IPV4_RANGES = [
  [0, 0, 255], [127, 0, 255], [10, 0, 255], [172, 16, 31],
  [192, 168, 168], [169, 254, 254], [100, 64, 127],
];

function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true; // malformed octet: refuse
  const [a, b] = octets;
  return BLOCKED_IPV4_RANGES.some((r) => a === r[0] && b >= r[1] && b <= r[2]);
}

const WILDCARD_LOOPBACK_LITERALS = new Set(['0.0.0.0', '::', '::1']);

function isBlockedIpv6(h) {
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 ULA
  return /^fe[89ab][0-9a-f]:/.test(h); // fe80::/10 link-local
}

function normaliseHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

// isBlockedAddress(ip) -> true for a loopback/private/link-local IP LITERAL (v4 or v6): the
// resolved-address door, checked against every DNS answer so a name resolving to an internal
// address is refused just as a literal IP in the URL would be.
function isBlockedAddress(ip) {
  const h = normaliseHost(ip);
  if (WILDCARD_LOOPBACK_LITERALS.has(h)) return true;
  if (isPrivateIPv4(h)) return true;
  return isBlockedIpv6(h);
}

function isBlockedHostname(host) {
  const h = normaliseHost(host);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isBlockedAddress(h)) return true;
  return !h.includes('.') && !h.includes(':'); // a dot-less, non-IPv6 name is not a public target
}

function isIpLiteral(host) {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

// resolveAllowedTarget(rawUrl) -> the parsed URL when it is a public http(s) target whose host,
// and every address it currently resolves to, clear the blocked-range door; else null. Never
// throws: an invalid or unsafe target is reported to the caller as a 400, the same closed-by-
// default shape as the rest of this handler.
async function resolveAllowedTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (isBlockedHostname(parsed.hostname)) return null;
  if (isIpLiteral(parsed.hostname)) return parsed; // already checked as a literal above
  let addresses;
  try {
    addresses = await dns.promises.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (e) {
    return null; // unresolvable host is not a safe navigation target either
  }
  if (addresses.some((a) => isBlockedAddress(a.address))) return null;
  return parsed;
}

// ── routing ──────────────────────────────────────────────────────────────────────────────────────

function handleHealthz(res) {
  json(res, 200, {
    ok: true,
    browserConnected: Boolean(browser && browser.isConnected()),
    inFlight,
    maxContexts: MAX_CONTEXTS,
  });
}

async function collectEvidence(target) {
  return withContext(async (context) => {
    const page = await context.newPage();
    // Placeholder collection contract: real evidence extraction (facts/ collectors) is wired
    // once WS0's payload contract lands; this staged handler proves the warm-pool round trip
    // end to end (navigate, capture title + status, close) without claiming full evidence
    // capture it does not yet perform.
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const title = await page.title();
    return { url: target.href, status: response ? response.status() : null, title };
  });
}

async function handleEvidenceCollect(req, res) {
  const { url } = await readBody(req);
  if (!url) {
    json(res, 400, { error: 'missing_url' });
    return;
  }
  const target = await resolveAllowedTarget(url);
  if (!target) {
    json(res, 400, { error: 'unsafe_or_invalid_url' });
    return;
  }
  const result = await collectEvidence(target);
  json(res, 200, result);
}

async function router(req, res) {
  if (req.method === 'GET' && req.url === '/healthz') {
    handleHealthz(res);
    return;
  }
  if (req.method === 'POST' && req.url === '/evidence/collect') {
    await handleEvidenceCollect(req, res);
    return;
  }
  json(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    const status = err.statusCode || 500;
    // Recorded (stderr, captured by docker's json-file log driver) and returned as an honest
    // error status - never a fabricated 200.
    console.error('browser_service_error', err);
    json(res, status, { error: err.message || 'internal_error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`browser service listening on :${PORT} (max ${MAX_CONTEXTS} concurrent contexts)`);
  });

  process.on('SIGTERM', async () => {
    if (browser) {
      await browser.close();
    }
    server.close(() => process.exit(0));
  });
}

module.exports = { server, resolveAllowedTarget };
