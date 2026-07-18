'use strict';
/* global document, window */
// evidence/browser/playwright-adapter.js - the LAZY, OPTIONAL real-browser adapter.
//
// Playwright is an OPTIONAL runtime dependency: it is deliberately NOT in this repo's
// package.json (zero-runtime-dependency rule) and must never be added by this module. This file is
// the ONLY place that names it, and it is required LAZILY inside a function - never at module load -
// so importing evidence/browser can never throw for a missing driver. When no driver resolves,
// resolvePlaywrightLauncher() logs LOUDLY and returns null; observe.js turns that into a recorded
// `lane:{ran:false, reason:'playwright-unavailable'}` (caution.md C-041: the lane's absence is
// visible, never silent).
//
// It maps a real Playwright browser onto observe.js's small injected contract, so observe.js is
// driven identically by this adapter in production and by a scripted FAKE browser in tests. The
// contract a launchBrowser() result must satisfy:
//   browser.newPage()        -> page
//     page.on('request', h)     register a listener; h({ host, url, resourceType, ts })
//     page.goto(url)            navigate, touch nothing
//     page.settle(ms)           wait ms for on-load tags to fire
//     page.cookies()            -> [{ name, domain, value, expires }]  (expires: unix seconds or -1)
//     page.findConsentControl() -> { found, url?, text?, acceptSelector? } | null
//     page.clickConsent(ctrl)   accept consent (no-op when none)
//   browser.close()

const DRIVERS = ['playwright', 'playwright-core', '@playwright/test'];

// resolveChromium() -> { chromium, driver } | null. Tries each optional driver by lazy require.
// A require() failure for an absent optional dependency is EXPECTED, not an error: it is captured to
// the "try the next driver" control flow (not swallowed in error - the loud null is returned below).
function resolveChromium() {
  for (const mod of DRIVERS) {
    const chromium = tryRequireChromium(mod);
    if (chromium) return { chromium, driver: mod };
  }
  return null;
}

// chromiumFrom(m) -> the chromium launcher off a required module, in either export shape.
function chromiumFrom(m) {
  return m.chromium || (m.default && m.default.chromium) || null;
}
function tryRequireChromium(mod) {
  try {
    return chromiumFrom(require(mod));
  } catch (e) {
    return null; // FAIL-OPEN: an absent OPTIONAL driver is a legitimate state; the caller logs the aggregate miss loudly and returns null (C-041). Not an error to surface per-driver.
  }
}

// The DOM scan that runs inside the page (browser context). Returns the first consent/cookie
// policy control found: a recognised accept button and/or a policy link. Kept side-effect free.
function scanConsentDom() {
  const pick = (sel) => document.querySelector(sel);
  const acceptSel = [
    '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '.cky-btn-accept', '#ccc-recommended-settings', 'button[aria-label*="accept" i]',
  ].find((s) => pick(s));
  const link = pick('a[href*="cookie" i], a[href*="privacy" i]');
  const found = Boolean(acceptSel || link);
  return {
    found,
    url: link ? link.href : null,
    text: link ? (link.textContent || '').trim().slice(0, 120) : null,
    acceptSelector: acceptSel || null,
    hasBanner: /cookie|consent|privacy/i.test((document.body && document.body.innerText || '').slice(0, 4000)),
  };
}

function toRequestEvent(request, now) {
  try {
    return { host: new URL(request.url()).hostname, url: request.url().slice(0, 300), resourceType: request.resourceType(), ts: now() };
  } catch (e) {
    return null; // FAIL-OPEN: a malformed request URL is not observable evidence; drop it (recorded as null, filtered by the caller). Not an error to surface.
  }
}

function wrapPage(page, ctx, now) {
  return {
    on(event, handler) {
      if (event !== 'request') return;
      page.on('request', (r) => { const ev = toRequestEvent(r, now); if (ev) handler(ev); });
    },
    async goto(url) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); },
    async settle(ms) { await page.waitForTimeout(ms); },
    async cookies() { return (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, value: c.value, expires: c.expires })); },
    async findConsentControl() { return page.evaluate(scanConsentDom).catch(() => null); },
    async clickConsent(control) {
      if (!control || !control.acceptSelector) return;
      await page.click(control.acceptSelector, { timeout: 3000 }).catch(() => {});
    },
  };
}

function wrapBrowser(browser, now) {
  return {
    async newPage() {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      return wrapPage(page, ctx, now);
    },
    async close() { await browser.close(); },
  };
}

// resolvePlaywrightLauncher(opts) -> a launchBrowser() factory conforming to observe.js's contract,
// or null when no driver resolves (logged loudly, C-041). `opts.now` is the injected clock stamped
// onto captured request events.
function resolvePlaywrightLauncher(opts) {
  const resolved = resolveChromium();
  if (!resolved) {
    console.error('[evidence/browser] no Playwright driver resolvable (tried ' + DRIVERS.join(', ')
      + '); the PECR pre-consent lane is UNAVAILABLE and will be recorded as such on the bundle. '
      + 'Install playwright in the mint runner, or inject a launchBrowser factory.');
    return null;
  }
  const now = (opts && typeof opts.now === 'function') ? opts.now : Date.now;
  return async function launchBrowser() {
    const browser = await resolved.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    return wrapBrowser(browser, now);
  };
}

module.exports = { resolvePlaywrightLauncher, scanConsentDom, DRIVERS };
