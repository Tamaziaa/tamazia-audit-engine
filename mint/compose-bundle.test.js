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

test('composeBundle assembles the exact EvidenceBundle shape facts/ and breach/ read', async () => {
  const { bundle, stageManifest } = await composeBundle('acme.example', { fetchFn, launchBrowser, registersFetchFn, env: { COMPANIES_HOUSE_API_KEY: 'ci-fixture-key' }, now: () => 1 });
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
