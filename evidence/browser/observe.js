'use strict';
// evidence/browser/observe.js - the PECR pre-consent OBSERVATION lane (P3 Wave-1c).
//
// WHAT THIS SEES THAT HTML CANNOT (caution.md C-039): the PECR reg.6 breach is not in the page
// source, it is in BEHAVIOUR - non-essential cookies written, and tracker requests fired, on first
// load with NOTHING clicked. This lane loads a page in a fresh browser, touches nothing, records the
// cookies + tracker network events that appear BEFORE any consent interaction, then accepts consent
// and captures again for the pre/post diff. A non-essential cookie/tracker present pre-consent is an
// observed breach candidate carrying the captured network event as its deterministic artifact
// (Constitution Rule 3). This module only OBSERVES; the breach lane (P3 Wave 2) adjudicates.
//
// FOUR structural safeguards this file is built around:
//   1. DEADLINE (C-040 / Rule 9): ONE outer Promise.race wraps launch -> observe -> close. The 752s
//      hostage incident is structurally impossible here: observe() cannot outlast deadlineMs + a
//      bounded force-close, whatever the browser does. Proven by observe.test.js's hanging-fake test
//      and the p3-browser-deadline calibration fixture.
//   2. OPTIONAL DEPENDENCY (C-041): Playwright is NOT a package.json dependency. It is resolved
//      lazily via an injected launchBrowser factory (or the lazy adapter). When unavailable, the lane
//      records lane:{ran:false, reason:'playwright-unavailable'} LOUDLY - never a silent nothing,
//      never a throw that kills a mint.
//   3. LINK HEALTH (C-042): a found consent/cookie-policy control is health-checked via an injected
//      fetch; a broken control is itself a finding (kind:'consent_control_broken').
//   4. LICENCE-CLEAN ORACLE (C-043): classification uses evidence/browser/oracle.js, 100% own-authored
//      (no NC/AGPL/ShareAlike data); its licence provenance is recorded on lane.oracle.
//
// TESTABILITY: observe() never touches a real browser or network directly. It drives an injected
// `launchBrowser` factory that returns a browser conforming to the small contract documented in
// playwright-adapter.js. node:test drives the ENTIRE logic with a scripted FAKE browser; no real
// Chromium runs in tests or CI (the acceptance-spec rule: live-fetch paths are dependency-injected).

const { raceWithDeadline } = require('./deadline');
const { resolvePlaywrightLauncher } = require('./playwright-adapter');
const { isTrackerHost, classifyCookie, oracleMeta } = require('./oracle');
// HOST is a one-door fact (Rule 1): a hostname is read through the single parsed-host door in
// tools/lib/safe-fetch.js, never re-derived here and never substring-matched (GAPS host-substring).
// parseSafeFetchTarget is the SAME door's SSRF gate: the consent-control URL is DOM-controlled (it comes
// from page.findConsentControl), so it must clear the door before any link-health fetch touches it.
const { hostOf: safeHostOf, parseSafeFetchTarget } = require('../../tools/lib/safe-fetch');

// Every budget below is a CAP, never a floor (Rule 8): the outer race takes whichever settles first, and
// a caller may only lower a budget, never raise it past these module ceilings (see capOr).
const DEFAULT_DEADLINE_MS = 45000; // total launch->close ceiling; well under the 120s mint budget
const DEFAULT_SETTLE_MS = 3000;    // wait for on-load tags to fire and drop cookies (cap)
const DEFAULT_CLOSE_MS = 5000;     // force-close ceiling
const DEFAULT_LINK_MS = 8000;      // consent-control link-health fetch ceiling

// ── option normalisation ───────────────────────────────────────────────────────────────────────

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// capOr(v, cap): a positive finite override CLAMPED to `cap`, else `cap`. A budget is a hard ceiling
// (Rule 8): a caller may ask for a SHORTER wall time, never a longer one, so a 3600000ms deadlineMs
// cannot defeat the documented 45s ceiling and stall a mint (the 752s-hostage class stays impossible).
function capOr(v, cap) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : cap;
}

function normaliseOpts(opts) {
  const o = opts || {};
  return {
    deadlineMs: capOr(o.deadlineMs, DEFAULT_DEADLINE_MS),
    settleMs: capOr(o.settleMs, DEFAULT_SETTLE_MS),
    closeMs: capOr(o.closeMs, DEFAULT_CLOSE_MS),
    linkMs: capOr(o.linkMs, DEFAULT_LINK_MS),
    now: typeof o.now === 'function' ? o.now : Date.now,
    launchBrowser: o.launchBrowser,
    fetchLink: o.fetchLink,
    oracle: o.oracle || { isTrackerHost, classifyCookie, oracleMeta },
  };
}

// ── oracle indirection (an injected oracle overrides the module's own; both are licence-clean) ───

function oracleMetaOf(cfg) {
  const o = cfg.oracle;
  return (o && typeof o.oracleMeta === 'function') ? o.oracleMeta() : oracleMeta();
}
function classify(cfg, cookie) {
  const o = cfg.oracle;
  return (o && typeof o.classifyCookie === 'function') ? o.classifyCookie(cookie) : classifyCookie(cookie);
}
function trackerHost(cfg, host) {
  const o = cfg.oracle;
  return (o && typeof o.isTrackerHost === 'function') ? o.isTrackerHost(host) : isTrackerHost(host);
}

// ── lane result builders (every non-ran outcome is RECORDED, never silent - C-041/Rule 4) ────────

function unknownControl() { return { found: false, healthy: null, url: null, status: null }; }

function lanePlaywrightUnavailable(cfg) {
  return { observed: [], consentControl: unknownControl(), lane: { ran: false, reason: 'playwright-unavailable', oracle: oracleMetaOf(cfg) } };
}
function laneDeadline(elapsed, cfg) {
  return { observed: [], consentControl: unknownControl(), lane: { ran: false, reason: 'deadline', elapsedMs: elapsed, oracle: oracleMetaOf(cfg) } };
}
function laneError(err, elapsed, cfg) {
  const message = String((err && err.message) || err).slice(0, 200);
  return { observed: [], consentControl: unknownControl(), lane: { ran: false, reason: 'error', message, elapsedMs: elapsed, oracle: oracleMetaOf(cfg) } };
}
function laneRan(observed, consentControl, diff, cfg) {
  return { observed, consentControl, lane: { ran: true, reason: null, diff, oracle: oracleMetaOf(cfg) } };
}

// ── host + cookie helpers ────────────────────────────────────────────────────────────────────────

function expiryDays(expires, nowMs) {
  const e = Number(expires);
  if (!Number.isFinite(e) || e <= 0) return null;
  return Math.round((e * 1000 - nowMs) / 86400000);
}

function nonEssentialCookies(cookies, cfg) {
  const out = [];
  for (const cookie of cookies || []) {
    const cls = classify(cfg, cookie);
    if (cls.verdict === 'non_essential') out.push({ cookie, cls });
  }
  return out;
}

function uniqueHosts(trackers) {
  const seen = new Set();
  const out = [];
  for (const ev of trackers || []) {
    if (ev && ev.host && !seen.has(ev.host)) { seen.add(ev.host); out.push(ev.host); }
  }
  return out;
}

function firstTrackerForHost(trackers, host) {
  for (const ev of trackers || []) {
    if (ev && ev.host === host) return ev;
  }
  return null;
}

function isTrackerEvent(ev, cfg) {
  return Boolean(ev && ev.host) && trackerHost(cfg, ev.host);
}

// ── network capture: register a pre-goto listener so on-load requests are never missed ────────────

function attachNetworkCapture(page, cfg) {
  const events = [];
  if (typeof page.on === 'function') {
    page.on('request', (ev) => { if (isTrackerEvent(ev, cfg)) events.push(ev); });
  }
  return { snapshot() { return events.slice(); } };
}

async function snapshotState(page, capture, cfg) {
  const cookies = typeof page.cookies === 'function' ? await page.cookies() : [];
  return { cookies: Array.isArray(cookies) ? cookies : [], trackers: capture.snapshot(), ts: cfg.now() };
}

// ── observed-breach construction (Rule 3: every entry carries a deterministic artifact) ───────────

function cookieArtifact(cookie, cls, nowMs) {
  return {
    type: 'cookie_jar_entry',
    // No cookie VALUE is ever stored (Rule 16: it may carry PII/secrets); name + domain + expiry only.
    cookie: { name: cookie.name, domain: cookie.domain, expiresDays: expiryDays(cookie.expires, nowMs) },
    category: cls.category || 'tracking',
    platform: cls.platform || null,
  };
}

function addCookieBreaches(observed, pre, cfg) {
  for (const { cookie, cls } of nonEssentialCookies(pre.cookies, cfg)) {
    const host = cls.host || String(cookie.domain || '').replace(/^\./, '');
    observed.push({
      kind: 'cookie_pre_consent',
      name: cookie.name,
      host,
      essential: false,
      networkEvent: firstTrackerForHost(pre.trackers, host),
      artifact: cookieArtifact(cookie, cls, pre.ts),
      ts: pre.ts,
    });
  }
}

function addTrackerBreaches(observed, pre) {
  for (const host of uniqueHosts(pre.trackers)) {
    const ev = firstTrackerForHost(pre.trackers, host);
    observed.push({
      kind: 'tracker_request_pre_consent',
      name: host,
      host,
      essential: false,
      networkEvent: ev,
      artifact: { type: 'network_request', networkEvent: ev },
      ts: (ev && ev.ts) || pre.ts,
    });
  }
}

function addBrokenControl(observed, consentControl, cfg) {
  if (!consentControl.found || consentControl.healthy !== false) return;
  observed.push({
    kind: 'consent_control_broken',
    name: consentControl.url,
    host: safeHostOf(consentControl.url),
    essential: null,
    networkEvent: null,
    // The artifact retains the OBSERVED failing status (Rule 3): a broken-control finding exists ONLY on
    // a captured HTTP failure. A timeout or a transport error never reaches here - those abstain to
    // healthy:null in linkHealth (absence vs observation, Rule 8), so this branch cannot fire on them.
    artifact: { type: 'link_health', url: consentControl.url, healthy: false, status: consentControl.status },
    ts: cfg.now(),
  });
}

function buildObserved(pre, consentControl, cfg) {
  const observed = [];
  addCookieBreaches(observed, pre, cfg);
  addTrackerBreaches(observed, pre);
  addBrokenControl(observed, consentControl, cfg);
  return observed;
}

function diffSummary(pre, post, cfg) {
  return {
    preNonEssentialCookies: nonEssentialCookies(pre.cookies, cfg).length,
    postNonEssentialCookies: nonEssentialCookies(post.cookies, cfg).length,
    preTrackerHosts: uniqueHosts(pre.trackers).length,
    postTrackerHosts: uniqueHosts(post.trackers).length,
  };
}

// ── consent-control link health (C-042) ──────────────────────────────────────────────────────────

function runFetch(fetchLink, url) { return Promise.resolve().then(() => fetchLink(url)); }
function fetchToError(e) { return { timedOut: false, value: { ok: false, status: null, error: String((e && e.message) || e) } }; }
function statusBad(status) { const s = Number(status); return Number.isFinite(s) && s >= 400; }

async function linkHealth(url, cfg) {
  if (typeof cfg.fetchLink !== 'function') return { healthy: null, status: null };
  const raced = await raceWithDeadline(runFetch(cfg.fetchLink, url), cfg.linkMs, cfg.now).catch(fetchToError);
  if (raced.timedOut) return { healthy: false, status: null };
  const res = raced.value || {};
  return { healthy: Boolean(res.ok) && !statusBad(res.status), status: numOrNull(res.status) };
}

async function checkConsentControl(control, cfg) {
  if (!control || !control.found) return unknownControl();
  const url = control.url || null;
  if (!url) return { found: true, healthy: null, url: null };
  const health = await linkHealth(url, cfg);
  return { found: true, healthy: health.healthy, url };
}

// ── the observation pipeline (all under the outer deadline) ───────────────────────────────────────

async function navigateUntouched(page, url, cfg) {
  await page.goto(url);
  if (typeof page.settle === 'function') await page.settle(cfg.settleMs);
}

async function safeFindControl(page) {
  if (typeof page.findConsentControl !== 'function') return null;
  return page.findConsentControl();
}

async function attemptConsent(page, control) {
  if (!control || !control.found) return;
  if (typeof page.clickConsent !== 'function') return;
  await page.clickConsent(control);
}

async function runObservation(url, cfg, launcher, holder) {
  const browser = await launcher();
  holder.browser = browser;
  const page = await browser.newPage();
  const capture = attachNetworkCapture(page, cfg);
  await navigateUntouched(page, url, cfg);
  const pre = await snapshotState(page, capture, cfg);   // BEFORE any consent interaction
  const control = await safeFindControl(page);
  const consentControl = await checkConsentControl(control, cfg);
  await attemptConsent(page, control);                    // injected clicker (accept)
  const post = await snapshotState(page, capture, cfg);   // AFTER consent, for the diff
  const observed = buildObserved(pre, consentControl, cfg);
  await browser.close();
  holder.browser = null;
  return laneRan(observed, consentControl, diffSummary(pre, post, cfg), cfg);
}

// ── force-close: bounded on EVERY exit path, so a stuck browser cannot reintroduce the 752s hang ──

async function forceClose(holder, cfg) {
  const browser = holder.browser;
  holder.browser = null;
  if (!browser || typeof browser.close !== 'function') return;
  try {
    await raceWithDeadline(Promise.resolve().then(() => browser.close()), cfg.closeMs, cfg.now);
  } catch (e) {
    // FAIL-OPEN JUSTIFICATION (Rule 4): a browser that will not close cannot be allowed to block the
    // mint; the CI/mint runner is ephemeral and reaps the process. Recorded to stderr (observable),
    // never silently swallowed, and never rethrown into the mint path.
    console.error('[evidence/browser] force-close failed (non-fatal, runner is ephemeral): ' + String((e && e.message) || e).slice(0, 160));
  }
}

async function resolveLauncher(cfg) {
  if (typeof cfg.launchBrowser === 'function') return cfg.launchBrowser;
  return resolvePlaywrightLauncher({ now: cfg.now });
}

async function observeWithLauncher(url, cfg, launcher) {
  const holder = { browser: null };
  const started = cfg.now();
  try {
    const raced = await raceWithDeadline(runObservation(url, cfg, launcher, holder), cfg.deadlineMs, cfg.now);
    if (raced.timedOut) return laneDeadline(raced.elapsed, cfg);
    return raced.value;
  } catch (e) {
    // FAIL-OPEN: a launch/observe failure is RECORDED into lane.reason='error' (laneError captures
    // e.message) and returned; a broken browser must degrade the mint, never throw into it (Rule 4).
    return laneError(e, cfg.now() - started, cfg);
  } finally {
    await forceClose(holder, cfg);
  }
}

/**
 * observe(url, opts) -> Promise<bundle.browser>. Never throws, never hangs a mint.
 *
 * opts (all optional; live-fetch paths are dependency-injected):
 *   launchBrowser  async () => browser        the browser factory (see playwright-adapter.js contract).
 *                                             Absent -> the lazy real Playwright adapter is tried; if no
 *                                             driver resolves, lane:{ran:false, reason:'playwright-unavailable'}.
 *   fetchLink      async (url) => {ok,status} injected consent-control link-health fetch (C-042).
 *   deadlineMs     number   total launch->close ceiling (default 45000; a CAP, never a floor).
 *   settleMs       number   post-navigation settle (default 3000).
 *   closeMs        number   force-close ceiling (default 5000).
 *   linkMs         number   link-health fetch ceiling (default 8000).
 *   now            () => ms injected clock (default Date.now) for deterministic elapsed/ts in tests.
 *   oracle         { isTrackerHost, classifyCookie, oracleMeta }  override (default: the licence-clean module oracle).
 *
 * Returns { observed, consentControl, lane } where:
 *   observed[]      { kind, name, host, essential, networkEvent, artifact, ts }
 *                   kind in { cookie_pre_consent, tracker_request_pre_consent, consent_control_broken }.
 *   consentControl  { found, healthy, url }.
 *   lane            { ran, reason, oracle:{source,licence}, ... } - the lane's outcome, always recorded.
 */
async function observe(url, opts) {
  const cfg = normaliseOpts(opts);
  const launcher = await resolveLauncher(cfg);
  if (typeof launcher !== 'function') return lanePlaywrightUnavailable(cfg);
  return observeWithLauncher(url, cfg, launcher);
}

module.exports = {
  observe,
  // exported for unit tests and the calibration fixture (never re-derives a fact; helpers only):
  normaliseOpts,
  buildObserved,
  diffSummary,
  checkConsentControl,
  laneDeadline,
  lanePlaywrightUnavailable,
  DEFAULT_DEADLINE_MS,
  DEFAULT_SETTLE_MS,
  DEFAULT_CLOSE_MS,
  DEFAULT_LINK_MS,
};
