'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { composeBundle, registerKeys } = require('./compose-bundle.js');

const HOME = '<!doctype html><html lang="en"><head><title>Acme Ltd</title></head><body><main><p>Acme Ltd sells widgets. We set cookies.</p><img src="/l.png"><a href="/about">About</a></main><footer>Acme Ltd. Company number 12345678.</footer></body></html>';
const ABOUT = '<!doctype html><html lang="en"><head><title>About</title></head><body><main><p>About Acme Ltd, a widget company registered in England.</p></main></body></html>';
const SITE = { 'https://acme.example/': HOME, 'https://acme.example/about': ABOUT };

function fetchFn(url) {
  const body = SITE[url];
  return Promise.resolve(body ? { ok: true, status: 200, body, finalUrl: url, contentType: 'text/html' } : { ok: false, status: 404, body: '', finalUrl: url });
}

function fakeBrowser() {
  let reqH = null;
  const page = {
    on(ev, h) { if (ev === 'request') reqH = h; },
    async goto() { if (reqH) reqH({ host: 'www.google-analytics.com', url: 'https://www.google-analytics.com/x.js', resourceType: 'script', ts: 1 }); },
    async settle() {}, async cookies() { return [{ name: '_ga', domain: '.acme.example', value: 'v', expires: 1900000000 }]; },
    async findConsentControl() { return { found: false }; }, async clickConsent() {},
    async evaluate() { return [{ check: 'img', selector: 'img:nth-of-type(1)', snippet: '<img src="/l.png">', hasAlt: false }]; },
  };
  return { async newPage() { return page; }, async close() {} };
}
const launchBrowser = async () => fakeBrowser();
const registersFetchFn = async (_url, options) => (options && options.requestKey === 'companies_house.search'
  ? { status: 200, json: { items: [{ title: 'Acme Ltd', company_number: '12345678', company_status: 'active' }] } } : null);

// gotoUrlsBrowser() -> a browser whose page.goto(url) RECORDS every url it was called with (into
// `calls`), never navigating for real. Used to prove composeBundle normalises a bare operator domain into
// a schemed URL ONCE, centrally, before either browser lane ever calls goto() (DEFECT-1).
function gotoUrlsBrowser(calls) {
  const page = {
    on() {}, async goto(url) { calls.push(url); }, async settle() {}, async cookies() { return []; },
    async findConsentControl() { return { found: false }; }, async clickConsent() {}, async evaluate() { return []; },
  };
  return { async newPage() { return page; }, async close() {} };
}

// rejectingGotoBrowser(message) -> a browser whose page.goto() REJECTS (the real Playwright shape of the
// bare-domain "Cannot navigate to invalid URL" throw / any genuine navigation failure). Used to prove
// neither browser lane swallows the failure: both must record a LOUD lane error (C-041/Rule 4), never the
// old false-clean "ran:true, observed:0 / nodes:1" signature the empirical audit found.
function rejectingGotoBrowser(message) {
  const page = {
    on() {}, async goto() { throw new Error(message); }, async settle() {}, async cookies() { return []; },
    async findConsentControl() { return { found: false }; }, async clickConsent() {}, async evaluate() { return []; },
  };
  return { async newPage() { return page; }, async close() {} };
}

test('composeBundle assembles the exact EvidenceBundle shape facts/ and breach/ read', async () => {
  const { bundle } = await composeBundle('acme.example', { fetchFn, launchBrowser, registersFetchFn, env: { COMPANIES_HOUSE_API_KEY: 'ci-fixture-key' }, now: () => 1 });
  assert.strictEqual(bundle.domain, 'acme.example');
  assert.ok(Array.isArray(bundle.corpus.pages) && bundle.corpus.pages.length >= 1);
  assert.ok(bundle.browser.lane.ran === true, 'observe (PECR) lane ran');
  assert.ok(bundle.browser.domLane.ran === true, 'domAssert lane ran');
  assert.ok(bundle.browser.observed.length >= 1, 'a pre-consent observation was captured');
  assert.ok(bundle.browser.domNodes.length >= 1, 'a failing DOM node was captured');
  assert.ok(bundle.registers.companiesHouse, 'the Companies House match attached');
  assert.ok(bundle.documents && bundle.telemetry, 'documents + telemetry present');
});

test('EVERY lane records ran/reason on the stageManifest - a missing lane is VISIBLE, never silent (C-037/C-041)', async () => {
  const { stageManifest } = await composeBundle('acme.example', { fetchFn, launchBrowser, registersFetchFn, env: {}, now: () => 1 });
  const stages = stageManifest.map((m) => m.stage);
  assert.deepStrictEqual(stages, ['crawl', 'observe', 'domAssert', 'registers']);
  assert.ok(stageManifest.every((m) => typeof m.ran === 'boolean'));
  const dom = stageManifest.find((m) => m.stage === 'domAssert');
  assert.strictEqual(dom.launch, 'second-bounded-launch', 'the honest second launch is recorded');
});

test('registerKeys maps the documented env vars onto the register key bag (values never on the object)', () => {
  const keys = registerKeys({ COMPANIES_HOUSE_API_KEY: 'a', SRA_API_KEY: 'b', CQC_API_KEY: 'c', CQC_PARTNER_CODE: 'd', FCA_API_EMAIL: 'e', FCA_API_KEY: 'f', ICO_MIRROR_URL: 'https://mirror' });
  assert.strictEqual(keys.companiesHouse, 'a');
  assert.strictEqual(keys.sra, 'b');
  assert.deepStrictEqual(keys.cqc, { apiKey: 'c', partnerCode: 'd' });
  assert.deepStrictEqual(keys.fca, { email: 'e', key: 'f' });
  assert.strictEqual(keys.ico, 'https://mirror');
});

test('KNOWN-BAD calibration: a launchBrowser that THROWS degrades both browser lanes honestly, never throws into the mint (C-041)', async () => {
  const throwingLaunch = async () => { throw new Error('chromium exploded'); };
  let bundle;
  await assert.doesNotThrow(async () => { ({ bundle } = await composeBundle('acme.example', { fetchFn, launchBrowser: throwingLaunch, registersFetchFn, env: {}, now: () => 1 })); });
  ({ bundle } = await composeBundle('acme.example', { fetchFn, launchBrowser: throwingLaunch, registersFetchFn, env: {}, now: () => 1 }));
  assert.strictEqual(bundle.browser.lane.ran, false, 'observe recorded its failure');
  assert.strictEqual(bundle.browser.domLane.ran, false, 'domAssert recorded its failure');
  assert.strictEqual(bundle.browser.observed.length, 0, 'no fabricated observations from a broken browser');
});

test('KNOWN-BAD: a crawl fetchFn that always fails yields an unreachable corpus recorded on the manifest, never a throw', async () => {
  const { bundle, stageManifest } = await composeBundle('acme.example', { fetchFn: () => Promise.resolve({ ok: false, status: 0, body: '' }), launchBrowser, registersFetchFn, env: {}, now: () => 1 });
  assert.strictEqual(bundle.corpus.pages.length, 0);
  const crawlStage = stageManifest.find((m) => m.stage === 'crawl');
  assert.ok(crawlStage.unreachable === true || crawlStage.pages === 0, 'the empty read is visible on the manifest');
});

// ── DEFECT-1: bare-domain scheme normalisation + no silent browser-lane degrade ─────────────────────

test('DEFECT-1: a BARE domain (the engine\'s own documented mint(url, opts) calling convention) reaches BOTH browser lanes as an absolute https:// URL, never the raw unschemed string', async () => {
  const calls = [];
  const { bundle } = await composeBundle('acme.example', { fetchFn, launchBrowser: async () => gotoUrlsBrowser(calls), registersFetchFn, env: {}, now: () => 1 });
  assert.strictEqual(calls.length, 2, 'both the observe lane and the domAssert second launch call goto() once');
  for (const url of calls) {
    assert.match(url, /^https:\/\//, 'goto() must never be called with a scheme-less string (Playwright throws on it)');
    assert.strictEqual(url, 'https://acme.example/', 'the normalised target, not the raw operator input');
  }
  // A goto() that never throws still must not fabricate anything from this fake beyond what it emits.
  assert.ok(Array.isArray(bundle.browser.domNodes));
});

test('DEFECT-1: an operator input that ALREADY carries an explicit scheme is preserved, never re-forced to https', async () => {
  const calls = [];
  await composeBundle('http://acme.example/', { fetchFn, launchBrowser: async () => gotoUrlsBrowser(calls), registersFetchFn, env: {}, now: () => 1 });
  assert.ok(calls.every((u) => u === 'http://acme.example/'), 'an explicit http:// input is honoured as given: ' + JSON.stringify(calls));
});

test('DEFECT-1: a goto() REJECTION on the observe lane is a LOUD recorded lane error, never the old false-clean "ran:true, observed:0" pass', async () => {
  const { bundle, stageManifest } = await composeBundle('acme.example', {
    fetchFn, launchBrowser: async () => rejectingGotoBrowser('Protocol error (Page.navigate): Cannot navigate to invalid URL'), registersFetchFn, env: {}, now: () => 1,
  });
  assert.strictEqual(bundle.browser.lane.ran, false, 'observe must not report ran:true on a swallowed navigation failure');
  assert.strictEqual(bundle.browser.lane.reason, 'error');
  assert.match(bundle.browser.lane.message, /Cannot navigate to invalid URL/);
  assert.deepStrictEqual(bundle.browser.observed, []);
  const observeStage = stageManifest.find((m) => m.stage === 'observe');
  assert.strictEqual(observeStage.ran, false, 'the manifest itself is loud, not just the bundle');
});

test('DEFECT-1: a goto() REJECTION on the domAssert second launch is a LOUD recorded lane error, never the old "nodes:1 on a blank page" false-clean', async () => {
  const { bundle, stageManifest } = await composeBundle('acme.example', {
    fetchFn, launchBrowser: async () => rejectingGotoBrowser('net::ERR_NAME_NOT_RESOLVED'), registersFetchFn, env: {}, now: () => 1,
  });
  assert.strictEqual(bundle.browser.domLane.ran, false);
  assert.strictEqual(bundle.browser.domLane.reason, 'error');
  assert.match(bundle.browser.domLane.message, /ERR_NAME_NOT_RESOLVED/);
  assert.deepStrictEqual(bundle.browser.domNodes, [], 'no fabricated html-has-lang node from a page that never actually navigated');
  const domStage = stageManifest.find((m) => m.stage === 'domAssert');
  assert.strictEqual(domStage.ran, false, 'the manifest itself is loud, not just the bundle');
});

test('CodeRabbit PR #25: opts.resolveChromium threads through to BOTH browser lanes\' own driver resolution, not just observe()', async () => {
  const { bundle, stageManifest } = await composeBundle('acme.example', {
    fetchFn, registersFetchFn, env: {}, now: () => 1, resolveChromium: () => null, // no launchBrowser injected: forces the real resolvePlaywrightLauncher() path on both lanes
  });
  assert.strictEqual(bundle.browser.lane.reason, 'playwright-unavailable', 'observe honoured the injected resolver');
  assert.strictEqual(bundle.browser.lane.ran, false);
  assert.strictEqual(bundle.browser.domLane.reason, 'playwright-unavailable', 'domAssert honoured the SAME injected resolver');
  assert.strictEqual(bundle.browser.domLane.ran, false);
  assert.deepStrictEqual(stageManifest.map((m) => [m.stage, m.ran, m.reason]).filter(([s]) => s === 'observe' || s === 'domAssert'),
    [['observe', false, 'playwright-unavailable'], ['domAssert', false, 'playwright-unavailable']]);
});
