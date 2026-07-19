'use strict';
// evidence/browser/observe.test.js - node:test suite for the PECR pre-consent lane.
// Run: node --test evidence/browser/observe.test.js
//
// FAKE-BROWSER ARCHITECTURE: observe() drives an injected launchBrowser factory, so the ENTIRE
// logic is exercised here against a SCRIPTED FAKE browser - no real Chromium, no network, no CI
// browser install. makeFake({...}) returns a launch() conforming to observe.js's small contract
// (newPage/on('request')/goto/settle/cookies/findConsentControl/clickConsent/close) and can be
// scripted to: set cookies pre- and post-consent, fire tracker requests on load and after the
// consent click, present (or omit) a consent control, and HANG on launch or goto to prove the
// deadline. `rec` records what the fake was asked to do (closed, clicked, ...).

const test = require('node:test');
const assert = require('node:assert/strict');

const { observe, normaliseOpts, DEFAULT_DEADLINE_MS, DEFAULT_CLOSE_MS, DEFAULT_SETTLE_MS, DEFAULT_LINK_MS } = require('./observe.js');

function counter() { let t = 0; return () => (t += 1); }
function hangForever() { return new Promise(() => {}); }

// makeFake's scripted fake browser is built from small named factories (one per contract surface -
// event emission, the page, the browser, the launcher) rather than one large object literal, so each
// piece is its own reportable unit and none folds every case into "makeFake" itself (the health-gate
// Complex Method cap; this is a test file, so the split is case-driven per the fix brief).
function makeEmit(handlers) {
  return function emit(reqs) {
    for (const r of reqs || []) {
      const ev = { host: r.host, url: r.url || ('https://' + r.host + '/tag.js'), resourceType: r.resourceType || 'script', ts: Date.now() };
      for (const h of handlers) h(ev);
    }
  };
}

// gotoBehaviour: DEFECT-1 regression - a real Playwright goto() that fails (e.g. the bare-domain "Cannot
// navigate to invalid URL" throw) must REJECT here, never resolve silently - this fake proves observe.js's
// OWN catch chain (navigateUntouched has no local try/catch) turns that rejection into a recorded
// lane.reason='error', not a false-clean "ran:true, observed:0" (C-041).
function gotoBehaviour(s, rec, emit) {
  return async function goto(url) {
    rec.gotoUrl = url;
    if (s.hang === 'goto') return hangForever();
    if (s.gotoRejects) throw new Error(s.gotoRejects);
    rec.gotoCalled = true; emit(s.preRequests);
  };
}
// settleBehaviour: settleWaits is opt-in (a REAL setTimeout) so the DEFECT-8b post-consent-settle
// regression test can prove a delayed post-consent request is actually captured; every other test keeps
// the fast no-op so the suite stays instant.
function settleBehaviour(s, rec) {
  return async function settle(ms) {
    rec.settleCalls = (rec.settleCalls || 0) + 1;
    if (s.settleWaits) await new Promise((r) => setTimeout(r, ms));
  };
}
function cookiesBehaviour(s, rec) {
  return async function cookies() { return rec.consented ? (s.postCookies || s.preCookies || []) : (s.preCookies || []); };
}
// clickConsentBehaviour: postRequestsDelayMs simulates a tag that a consent-gated CMP only INJECTS on
// click and which needs a moment to actually fire its own network request (DEFECT-8b: this is a REAL
// behaviour confirmed on a live GDPR-plugin-gated site during this fix, not a hypothetical).
function clickConsentBehaviour(s, rec, emit) {
  return async function clickConsent() {
    rec.clicked = true; rec.consented = true;
    if (s.postRequestsDelayMs) setTimeout(() => emit(s.postRequests), s.postRequestsDelayMs);
    else emit(s.postRequests);
  };
}

function makeFakePage(s, rec, handlers, emit) {
  return {
    on(ev, h) { if (ev === 'request') handlers.push(h); },
    goto: gotoBehaviour(s, rec, emit),
    settle: settleBehaviour(s, rec),
    cookies: cookiesBehaviour(s, rec),
    async findConsentControl() { return s.control || null; },
    clickConsent: clickConsentBehaviour(s, rec, emit),
  };
}

function makeFakeBrowser(rec, page) {
  return {
    async newPage() { rec.newPageCalls++; return page; },
    async close() { rec.closed = true; },
  };
}

function makeFakeLauncher(s, browser) {
  return async function launch() { if (s.hang === 'launch') return hangForever(); return browser; };
}

function makeFake(script) {
  const s = script || {};
  const rec = { closed: false, newPageCalls: 0, gotoCalled: false, clicked: false, consented: false };
  const handlers = [];
  const emit = makeEmit(handlers);
  const page = makeFakePage(s, rec, handlers, emit);
  const browser = makeFakeBrowser(rec, page);
  const launch = makeFakeLauncher(s, browser);
  return { launch, rec, browser, page };
}

const healthy = async () => ({ ok: true, status: 200 });

// ── C-041: optional dependency absent, recorded loudly, never a throw ─────────────────────────────

test('observe: no launchBrowser and no real driver -> lane records playwright-unavailable, never throws', async () => {
  // resolveChromium is stubbed to "no driver" (DEFECT-6: playwright is now an optionalDependency, so a
  // real checkout may genuinely have it installed; this proves the honest-absence PATH itself, not the
  // ambient node_modules state - see playwright-adapter.js#resolvePlaywrightLauncher's test-only seam).
  const r = await observe('https://example.com', { resolveChromium: () => null });
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'playwright-unavailable');
  assert.deepEqual(r.observed, []);
  assert.ok(r.lane.oracle && r.lane.oracle.source, 'the lane must still carry oracle provenance');
});

// ── C-039 / Rule 3: pre-consent breaches with deterministic artifacts ─────────────────────────────

test('observe: a non-essential cookie + tracker request pre-consent become observed breaches with artifacts', async () => {
  const fake = makeFake({
    preCookies: [{ name: '_ga', domain: '.example.com', value: 'GA1.2.x', expires: -1 }],
    preRequests: [{ host: 'www.google-analytics.com', url: 'https://www.google-analytics.com/collect', resourceType: 'xhr' }],
    control: { found: true, url: 'https://example.com/cookies' },
  });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), deadlineMs: 5000, fetchLink: healthy });
  assert.equal(r.lane.ran, true);
  const cookie = r.observed.find((o) => o.kind === 'cookie_pre_consent');
  const tracker = r.observed.find((o) => o.kind === 'tracker_request_pre_consent');
  assert.ok(cookie, 'expected a cookie_pre_consent breach');
  assert.equal(cookie.essential, false);
  assert.equal(cookie.name, '_ga');
  assert.equal(cookie.artifact.type, 'cookie_jar_entry');
  assert.ok(tracker, 'expected a tracker_request_pre_consent breach');
  assert.equal(tracker.host, 'www.google-analytics.com');
  assert.equal(tracker.networkEvent.host, 'www.google-analytics.com');
  assert.equal(fake.rec.closed, true, 'browser must be closed on the success path');
});

test('observe: a cookie breach artifact never stores the cookie VALUE (Rule 16 no-secrets)', async () => {
  const fake = makeFake({ preCookies: [{ name: '_ga', domain: '.example.com', value: 'cookieval-xyz-123', expires: -1 }] });
  const r = await observe('https://x.example', { launchBrowser: fake.launch, now: counter() });
  const cookie = r.observed.find((o) => o.kind === 'cookie_pre_consent');
  assert.ok(cookie);
  assert.equal('value' in cookie.artifact.cookie, false);
  assert.equal(JSON.stringify(r).includes('cookieval-xyz-123'), false, 'no cookie value may appear anywhere in the bundle');
});

test('observe: an observed entry carries exactly the contract keys', async () => {
  const fake = makeFake({ preRequests: [{ host: 'www.google-analytics.com' }] });
  const r = await observe('https://x', { launchBrowser: fake.launch, now: counter() });
  const keys = Object.keys(r.observed[0]).sort();
  assert.deepEqual(keys, ['artifact', 'essential', 'host', 'kind', 'name', 'networkEvent', 'ts'].sort());
});

// ── Rule 6: abstention-first classification ───────────────────────────────────────────────────────

test('observe: an essential (session) cookie pre-consent is NOT a breach', async () => {
  const fake = makeFake({ preCookies: [{ name: 'PHPSESSID', domain: '.example.com', expires: -1 }] });
  const r = await observe('https://x', { launchBrowser: fake.launch, now: counter() });
  assert.equal(r.lane.ran, true);
  assert.equal(r.observed.length, 0);
});

test('observe: an unknown first-party cookie pre-consent is NOT flagged (abstain, not over-claim)', async () => {
  const fake = makeFake({ preCookies: [{ name: 'bespoke_state', domain: '.example.com', expires: -1 }] });
  const r = await observe('https://x', { launchBrowser: fake.launch, now: counter() });
  assert.equal(r.observed.length, 0);
});

// ── C-042: consent-control link health ────────────────────────────────────────────────────────────

test('observe: a broken consent-control link is its own finding (consent_control_broken), healthy:false', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookie-policy' } });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: async () => ({ ok: false, status: 404 }) });
  assert.equal(r.consentControl.found, true);
  assert.equal(r.consentControl.healthy, false);
  const broken = r.observed.find((o) => o.kind === 'consent_control_broken');
  assert.ok(broken, 'expected a consent_control_broken finding');
  assert.equal(broken.artifact.type, 'link_health');
});

test('observe: a healthy consent-control link produces no broken finding', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookies' } });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: healthy });
  assert.equal(r.consentControl.healthy, true);
  assert.equal(r.observed.some((o) => o.kind === 'consent_control_broken'), false);
});

test('observe: with no injected fetch, a control health cannot be asserted (healthy:null), no broken finding', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookies' } });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter() });
  assert.equal(r.consentControl.healthy, null);
  assert.equal(r.observed.some((o) => o.kind === 'consent_control_broken'), false);
});

test('observe: an OBSERVED 404 control retains its status on the artifact (proof of a real broken control)', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookie-policy' } });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: async () => ({ ok: false, status: 404 }) });
  const broken = r.observed.find((o) => o.kind === 'consent_control_broken');
  assert.ok(broken);
  assert.equal(broken.artifact.status, 404, 'the captured failing status rides the artifact (Rule 3)');
});

test('observe: a control-link TIMEOUT abstains (healthy:null) and emits NO broken finding (unobserved, not proof)', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookie-policy' } });
  const neverSettles = () => new Promise(() => {});
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: neverSettles, linkMs: 20 });
  assert.equal(r.consentControl.healthy, null, 'a timeout is an unobserved failure -> abstain, not healthy:false');
  assert.equal(r.observed.some((o) => o.kind === 'consent_control_broken'), false, 'no artifact-free broken finding on a timeout');
});

test('observe: a control-link TRANSPORT ERROR (rejected fetch) abstains (healthy:null), no broken finding', async () => {
  const fake = makeFake({ control: { found: true, url: 'https://example.com/cookie-policy' } });
  const rejects = async () => { throw new Error('ECONNRESET'); };
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: rejects });
  assert.equal(r.consentControl.healthy, null, 'a network error is unobserved -> abstain');
  assert.equal(r.observed.some((o) => o.kind === 'consent_control_broken'), false);
});

test('observe: a DOM-controlled consent URL pointing at a private host is NOT fetched (SSRF door), abstains', async () => {
  let fetched = false;
  const fake = makeFake({ control: { found: true, url: 'http://127.0.0.1/cookie-policy' } });
  const spyFetch = async () => { fetched = true; return { ok: false, status: 500 }; };
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: spyFetch });
  assert.equal(fetched, false, 'an unsafe (loopback) control URL must never reach the fetch');
  assert.equal(r.consentControl.healthy, null);
  assert.equal(r.observed.some((o) => o.kind === 'consent_control_broken'), false);
});

test('observe: budgets are hard caps - an oversized deadlineMs/closeMs/settleMs/linkMs clamps to the ceiling (Rule 8)', () => {
  const capped = normaliseOpts({ deadlineMs: 3600000, closeMs: 999999, settleMs: 999999, linkMs: 999999 });
  assert.equal(capped.deadlineMs, DEFAULT_DEADLINE_MS, 'an hour-long deadline clamps to the 45s ceiling');
  assert.equal(capped.closeMs, DEFAULT_CLOSE_MS);
  assert.equal(capped.settleMs, DEFAULT_SETTLE_MS);
  assert.equal(capped.linkMs, DEFAULT_LINK_MS);
  // a SHORTER budget is still honoured (a cap, never a floor).
  assert.equal(normaliseOpts({ deadlineMs: 20 }).deadlineMs, 20);
  assert.equal(normaliseOpts({ closeMs: 0 }).closeMs, DEFAULT_CLOSE_MS, 'a non-positive value falls back to the ceiling');
});

// ── C-040 / Rule 9: the outer deadline. The 752s class made structurally impossible ───────────────

test('observe: a hanging goto cannot hold the mint - the lane returns deadline-refusal and force-closes', async () => {
  const fake = makeFake({ hang: 'goto' });
  const started = Date.now();
  const r = await observe('https://slow.example', { launchBrowser: fake.launch, deadlineMs: 30, closeMs: 100 });
  const wall = Date.now() - started;
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'deadline');
  assert.equal(typeof r.lane.elapsedMs, 'number');
  assert.ok(wall < 2000, 'observe ran ' + wall + 'ms past a 30ms deadline - the 752s class is NOT bounded');
  assert.equal(fake.rec.closed, true, 'a timed-out browser must be force-closed');
});

test('observe: a hanging browser LAUNCH also times out cleanly (nothing to close, no hang)', async () => {
  const fake = makeFake({ hang: 'launch' });
  const started = Date.now();
  const r = await observe('https://x', { launchBrowser: fake.launch, deadlineMs: 30 });
  assert.equal(r.lane.reason, 'deadline');
  assert.ok(Date.now() - started < 2000);
  assert.equal(fake.rec.closed, false);
});

test('observe: a launcher that rejects is RECORDED as a lane error, never thrown into the mint (Rule 4)', async () => {
  const launch = async () => { throw new Error('launch-failed'); };
  const r = await observe('https://x', { launchBrowser: launch, deadlineMs: 1000 });
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'error');
  assert.match(r.lane.message, /launch-failed/);
});

// ── DEFECT-1 regression: a goto() failure is a LOUD lane error, never a silent about:blank pass ────

test('DEFECT-1: a goto() that REJECTS (the real Playwright bare-domain throw) is RECORDED as a lane error, never a false-clean "ran:true, observed:0" pass', async () => {
  const fake = makeFake({ gotoRejects: 'Protocol error (Page.navigate): Cannot navigate to invalid URL', preCookies: [{ name: '_ga', domain: '.example.com', expires: -1 }] });
  const r = await observe('lomond.co.uk', { launchBrowser: fake.launch, deadlineMs: 5000 });
  assert.equal(r.lane.ran, false, 'a swallowed navigation error must not report ran:true');
  assert.equal(r.lane.reason, 'error');
  assert.match(r.lane.message, /Cannot navigate to invalid URL/);
  assert.deepEqual(r.observed, [], 'no fabricated observation from a page that never actually navigated');
  assert.equal(fake.rec.closed, true, 'the browser is still force-closed on the error path');
});

// ── pre/post-consent diff is first-class ──────────────────────────────────────────────────────────

test('observe: pre/post diff - a cookie that appears only AFTER consent is not a pre-consent breach', async () => {
  const fake = makeFake({
    preCookies: [{ name: '_ga', domain: '.example.com', expires: -1 }],
    postCookies: [{ name: '_ga', domain: '.example.com', expires: -1 }, { name: '_fbp', domain: '.example.com', expires: -1 }],
    preRequests: [{ host: 'www.google-analytics.com' }],
    postRequests: [{ host: 'connect.facebook.net' }],
    control: { found: true, url: 'https://example.com/cookies' },
  });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: healthy });
  const names = r.observed.filter((o) => o.kind === 'cookie_pre_consent').map((o) => o.name);
  assert.deepEqual(names, ['_ga'], '_fbp appeared only post-consent, so it is not a pre-consent breach');
  assert.ok(r.lane.diff.postNonEssentialCookies > r.lane.diff.preNonEssentialCookies);
  assert.equal(r.lane.diff.preTrackerHosts, 1);
});

test('DEFECT-8b: a tag that only fires after the consent click gets a settle window before the POST snapshot (previously taken with none)', async () => {
  const fake = makeFake({
    preRequests: [],
    // a consent-gated tag's own request lands a few ms after the click resolves - real behaviour
    // confirmed on a live GDPR-plugin-gated site during this investigation, not a hypothetical.
    postRequestsDelayMs: 5,
    postRequests: [{ host: 'www.googletagmanager.com' }],
    control: { found: true, url: 'https://example.com/cookies' },
    settleWaits: true,
  });
  const r = await observe('https://example.com', { launchBrowser: fake.launch, now: counter(), fetchLink: healthy, settleMs: 50 });
  assert.equal(r.lane.diff.postTrackerHosts, 1, 'the post-consent settle window let the delayed tag request land before the post snapshot');
  assert.ok(fake.rec.settleCalls >= 2, 'settle() is called both pre-navigation AND post-consent');
});

// ── C-043: oracle provenance on every lane outcome ────────────────────────────────────────────────

test('observe: every lane outcome carries lane.oracle provenance, including refusals', async () => {
  const unavailable = await observe('https://x', {});
  assert.ok(unavailable.lane.oracle.source && unavailable.lane.oracle.licence);
  const fake = makeFake({ preCookies: [] });
  const ran = await observe('https://x', { launchBrowser: fake.launch, now: counter() });
  assert.match(ran.lane.oracle.licence, /own-authored/);
});
