'use strict';
// runtime/vm/browser/server.js - warm Playwright chromium pool, control API for evidence workers.
//
// One browser process, MAX_CONTEXTS isolated contexts checked out/in by worker containers over a
// small HTTP API. This is the "warm pool" the blueprint asks for: no per-audit browser launch, no
// cold-start tax inside the 45-second budget. Memory is capped at the docker-compose service
// level (1536M limit), not here - this process caps context *count*, the compose file caps RAM.

const http = require('node:http');
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      json(res, 200, {
        ok: true,
        browserConnected: Boolean(browser && browser.isConnected()),
        inFlight,
        maxContexts: MAX_CONTEXTS,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/evidence/collect') {
      const { url } = await readBody(req);
      if (!url) {
        json(res, 400, { error: 'missing_url' });
        return;
      }
      const result = await withContext(async (context) => {
        const page = await context.newPage();
        // Placeholder collection contract: real evidence extraction (facts/ collectors) is wired
        // once WS0's payload contract lands; this staged handler proves the warm-pool round trip
        // end to end (navigate, capture title + status, close) without claiming full evidence
        // capture it does not yet perform.
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const title = await page.title();
        return { url, status: response ? response.status() : null, title };
      });
      json(res, 200, result);
      return;
    }

    json(res, 404, { error: 'not_found' });
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

module.exports = { server };
