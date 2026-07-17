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

const { observe } = require('./observe.js');

function counter() { let t = 0; return () => (t += 1); }
function hangForever() { return new Promise(() => {}); }

function makeFake(script) {
  const s = script || {};
  const rec = { closed: false, newPageCalls: 0, gotoCalled: false, clicked: false, consented: false };
  const handlers = [];
  function emit(reqs) {
    for (const r of reqs || []) {
      const ev = { host: r.host, url: r.url || ('https://' + r.host + '/tag.js'), resourceType: r.resourceType || 'script', ts: Date.now() };
      for (const h of handlers) h(ev);
    }
  }
  const page = {
    on(ev, h) { if (ev === 'request') handlers.push(h); },
    async goto() { if (s.hang === 'goto') return hangForever(); rec.gotoCalled = true; emit(s.preRequests); },
    async settle() {},
    async cookies() { return rec.consented ? (s.postCookies || s.preCookies || []) : (s.preCookies || []); },
    async findConsentControl() { return s.control || null; },
    async clickConsent() { rec.clicked = true; rec.consented = true; emit(s.postRequests); },
  };
  const browser = {
    async newPage() { rec.newPageCalls++; return page; },
    async close() { rec.closed = true; },
  };
  async function launch() { if (s.hang === 'launch') return hangForever(); return browser; }
  return { launch, rec, browser, page };
}

const healthy = async () => ({ ok: true, status: 200 });

// ── C-041: optional dependency absent, recorded loudly, never a throw ─────────────────────────────

test('observe: no launchBrowser and no real driver -> lane records playwright-unavailable, never throws', async () => {
  const r = await observe('https://example.com', {}); // nothing injected; the real resolver finds no driver
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

// ── C-043: oracle provenance on every lane outcome ────────────────────────────────────────────────

test('observe: every lane outcome carries lane.oracle provenance, including refusals', async () => {
  const unavailable = await observe('https://x', {});
  assert.ok(unavailable.lane.oracle.source && unavailable.lane.oracle.licence);
  const fake = makeFake({ preCookies: [] });
  const ran = await observe('https://x', { launchBrowser: fake.launch, now: counter() });
  assert.match(ran.lane.oracle.licence, /own-authored/);
});
