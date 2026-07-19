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
//     page.goto(url)            navigate, touch nothing. NEVER silently swallows a navigation failure
//                               (DEFECT-1/C-041): on an https:// url it retries ONCE over http:// (some
//                               real sites are genuinely http-only), and if both attempts fail it REJECTS
//                               with a combined error - the caller's own deadline+catch chain (observe.js,
//                               mint/compose-bundle.js) turns that into a recorded, VISIBLE lane failure,
//                               never a silent about:blank pass. The url itself should already carry an
//                               explicit scheme by the time it reaches here (tools/lib/safe-fetch.js's
//                               resolveNavigableUrl is the one door that normalises a bare operator domain).
//     page.settle(ms)           wait ms for on-load tags to fire
//     page.cookies()            -> [{ name, domain, value, expires }]  (expires: unix seconds or -1)
//     page.findConsentControl() -> { found, url?, text?, acceptSelector? } | null
//     page.clickConsent(ctrl)   accept consent (no-op when none)
//     page.evaluate(fn, arg?)   run a self-contained function in the page context, returning its
//                               serialisable result (used by evidence/browser/dom-assert.js's axe-style
//                               DOM extraction; ADDITIVE, no existing method touched)
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

// httpFallbackOf(url) -> the http:// retry candidate for a failed https:// navigation, or null when `url`
// does not carry an explicit https: scheme. Pure and exported so the RETRY DECISION is unit-testable
// without a real browser (this file's actual goto() orchestration stays untested by design - Playwright is
// lazily required and never launched in node:test/CI, see the file header). Only an https:// attempt is
// ever downgraded to http:// (one bounded extra attempt, Rule 9 - never a loop): an operator's own explicit
// http:// or non-http(s) input is honoured as given, never "upgraded" behind their back.
function httpFallbackOf(url) {
  return /^https:\/\//i.test(String(url || '')) ? String(url).replace(/^https:\/\//i, 'http://') : null;
}

const GOTO_OPTS = Object.freeze({ waitUntil: 'domcontentloaded', timeout: 15000 });

// attemptGoto(page, url) -> { ok: true } | { ok: false, error }. NEVER throws (the one try/catch this file
// needs for a single navigation attempt lives here, once); gotoUrl below composes two attempts with plain,
// flat if-returns instead of nested try/catch, which is what CodeScene's Bumpy-Road/Complex-Method
// biomarkers were flagging on the previous nested-try shape.
async function attemptGoto(page, url) {
  try { await page.goto(url, GOTO_OPTS); return { ok: true }; }
  catch (error) {
    // FAIL-OPEN: this is a captured, not a swallowed, failure - the error is RETURNED (never dropped) so
    // gotoUrl's caller can decide whether to try the http:// fallback or rethrow it loudly (C-041). Neither
    // branch of gotoUrl below ever discards this value: it is always either rethrown as-is or folded into
    // combinedGotoError() and rethrown.
    return { ok: false, error };
  }
}

// combinedGotoError(primaryErr, fallbackErr) -> one informative Error naming both failed attempts.
function combinedGotoError(primaryErr, fallbackErr) {
  return new Error('navigation failed on both https and http: '
    + String((primaryErr && primaryErr.message) || primaryErr).slice(0, 150) + ' | '
    + String((fallbackErr && fallbackErr.message) || fallbackErr).slice(0, 150));
}

// gotoUrl(page, url) -> navigates, or throws LOUDLY (C-041/Rule 4): this is the "records" leg of a
// FAIL-OPEN catch, not a swallow. On an https:// failure it makes ONE bounded http:// fallback attempt
// (Rule 9: a single extra try, never a loop); on a genuine double failure it throws a combined,
// informative error so observe.js / mint/compose-bundle.js's own outer deadline+catch records a visible
// lane failure (lane.reason='error') instead of silently leaving the page at about:blank. Exported
// (CodeRabbit PR #25 comment 3610860881): `page` is an INJECTED contract (only `.goto(url)` is called), so
// this orchestration is directly testable over a fake page with no real browser - unlike the rest of this
// file, which stays untested by design because it touches the real, lazily-required Playwright driver.
async function gotoUrl(page, url) {
  const primary = await attemptGoto(page, url);
  if (primary.ok) return;
  const fallback = httpFallbackOf(url);
  if (!fallback) throw primary.error; // no fallback to try; propagate so the caller records it.
  const secondary = await attemptGoto(page, fallback);
  if (secondary.ok) return;
  throw combinedGotoError(primary.error, secondary.error);
}

function wrapPage(page, ctx, now) {
  return {
    on(event, handler) {
      if (event !== 'request') return;
      page.on('request', (r) => { const ev = toRequestEvent(r, now); if (ev) handler(ev); });
    },
    async goto(url) { await gotoUrl(page, url); },
    async settle(ms) { await page.waitForTimeout(ms); },
    async cookies() { return (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, value: c.value, expires: c.expires })); },
    async findConsentControl() { return page.evaluate(scanConsentDom).catch(() => null); },
    async clickConsent(control) {
      if (!control || !control.acceptSelector) return;
      await page.click(control.acceptSelector, { timeout: 3000 }).catch(() => {});
    },
    // ADDITIVE (T2a): delegate to the real page.evaluate so evidence/browser/dom-assert.js can run its
    // one self-contained DOM-extraction pass in the browser context. Unlike goto/findConsentControl this
    // does NOT swallow a rejection: dom-assert.js wraps the call in the ONE outer deadline race and turns
    // any throw into a recorded lane.reason='error' (C-041 - the lane's failure is visible, never silent).
    async evaluate(fn, arg) { return page.evaluate(fn, arg); },
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
// onto captured request events. `opts.resolveChromium` is a TEST-ONLY seam (defaults to the real
// resolveChromium above): DEFECT-6 declares playwright as an optionalDependency, so a real checkout may
// genuinely have it installed; a test that must prove the "driver genuinely absent" path stays honest
// injects a stub here instead of depending on the ambient node_modules state (production never sets this).
function resolvePlaywrightLauncher(opts) {
  const o = opts || {};
  const resolve = typeof o.resolveChromium === 'function' ? o.resolveChromium : resolveChromium;
  const resolved = resolve();
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

module.exports = { resolvePlaywrightLauncher, scanConsentDom, DRIVERS, httpFallbackOf, gotoUrl };
