'use strict';
// mint/mint-e2e.test.js - THE centrepiece: a FULL in-process mint over an injected fake site. This is the
// PECR-in-a-minted-payload discharge at the STRUCTURAL level (the P3 charter exit deferred to P4, DORMANT.md
// "Charter-exit condition"): the whole chain runs end to end in one process over fakes - crawl, observe
// (a pre-consent tracking cookie), domAssert (a missing-alt DOM node), registers (a Companies House match),
// facts, connect (UK-only), propose (the PECR network_event AND the dom_node candidate), verify (both
// accepted), adjudicate (the PECR violation via the observed-fact bypass, C-084), compose (contract-valid),
// persist (idempotency key carrying ENGINE_VERSION) and the post-write assertions (done:false,
// minted_pending_render while the render truth-pack is absent). The LIVE-infrastructure run happens
// post-merge by the orchestrator; this proves the structure with no network and no Chromium.

const test = require('node:test');
const assert = require('node:assert');
const { mint } = require('./index.js');
const { validatePayload } = require('../payload/contract');
const { ENGINE_VERSION } = require('./version.js');
const { buildSeo, buildGeo, buildCompetitors } = require('../payload/composer/sections.js');

// fakeRunProbes: this suite drives the mint end to end with NO network anywhere (its own header says so
// explicitly); the WS-SEO-GEO probe lane (probes/index.js) makes real HTTP calls by design (PageSpeed,
// live SERP, AI-readiness robots.txt/llms.txt/Wikidata are zero-key and always attempt a real fetch), so
// it is injected here exactly like every other live surface (fetchFn/launchBrowser/registersFetchFn/
// llmCall) rather than left to hit the real internet from a unit test. The stub reuses the composer's own
// not-probed section builders (called with no input, they return the SAME honest `probe_unavailable`-
// shaped-cousin `not_probed` leaves compose() would fall back to on its own): a genuinely valid, inert
// stand-in for "SEO/GEO was not probed in this fixture", which is orthogonal to every assertion below.
const fakeRunProbes = async () => ({ seo: buildSeo({}), geo: buildGeo({}), competitors: buildCompetitors({}) });

// ── the injected fake UK law firm (fabricated: Rule 16, no real firm, no PII) ─────────────────────────
const DOMAIN = 'oakhurst-legal.example';
const HOME = '<!doctype html><html lang="en"><head><title>Oakhurst Legal LLP | Solicitors in London</title></head>'
  + '<body><main><h1>Oakhurst Legal LLP</h1><p>Oakhurst Legal LLP is a firm of solicitors based in London. Our solicitors provide legal advice on commercial litigation, conveyancing and family law. Regulated by the Solicitors Regulation Authority.</p>'
  + '<img src="/logo.png"><nav><a href="/about">About our solicitors</a> <a href="/privacy">Privacy</a></nav></main>'
  + '<footer>Oakhurst Legal LLP. Regulated by the Solicitors Regulation Authority (SRA). Company number 09999999. Registered office: 10 High Street, London EC1A 1AA.</footer></body></html>';
const ABOUT = '<!doctype html><html lang="en"><head><title>About our solicitors</title></head><body><main><p>Our solicitors and legal team advise clients across England and Wales. We are a limited liability partnership registered in England and Wales.</p></main><footer>Oakhurst Legal LLP. Company number 09999999.</footer></body></html>';
const PRIVACY = '<!doctype html><html lang="en"><head><title>Privacy Policy</title></head><body><main><p>This privacy policy explains how we process personal data under UK GDPR. We use cookies for analytics and set tracking cookies before consent.</p></main><footer>Oakhurst Legal LLP.</footer></body></html>';
const SITE = { ['https://' + DOMAIN + '/']: HOME, ['https://' + DOMAIN + '/about']: ABOUT, ['https://' + DOMAIN + '/privacy']: PRIVACY };

function fetchFn(url) {
  const body = SITE[url] || SITE[url.replace(/\/$/, '')] || SITE[url + '/'];
  return Promise.resolve(body ? { ok: true, status: 200, body, finalUrl: url, contentType: 'text/html' } : { ok: false, status: 404, body: '', finalUrl: url, contentType: 'text/html' });
}

// the fake browser: ONE pre-consent tracking cookie (_ga -> cookie_pre_consent) AND one missing-alt DOM node.
function fakeBrowser() {
  let reqH = null;
  const page = {
    on(ev, h) { if (ev === 'request') reqH = h; },
    async goto() { if (reqH) reqH({ host: 'www.google-analytics.com', url: 'https://www.google-analytics.com/analytics.js', resourceType: 'script', ts: 1700000000000 }); },
    async settle() {},
    async cookies() { return [{ name: '_ga', domain: '.' + DOMAIN, value: 'GA1.2.x', expires: 1900000000 }]; },
    async findConsentControl() { return { found: false }; },
    async clickConsent() {},
    async evaluate() { return [{ check: 'img', selector: 'img:nth-of-type(1)', snippet: '<img src="/logo.png">', hasAlt: false }]; },
  };
  return { async newPage() { return page; }, async close() {} };
}
const launchBrowser = async () => fakeBrowser();

// the fake registers fetchFn: a Companies House match for the domain-stem query; everything else abstains.
const registersFetchFn = async (_url, options) => (options && options.requestKey === 'companies_house.search'
  ? { status: 200, json: { items: [{ title: 'Oakhurst Legal LLP', company_number: '09999999', company_status: 'active' }] } }
  : null);

// the scripted llmCall: DECLINES (the offline default). The observed-fact PECR/dom_node breaches bypass the
// model entirely (C-084), so a declining model still ships them as violations; the text-derived absence
// candidates correctly abstain to needs_review (Rule 12 gate 4).
const scriptedDecline = async () => ({ ok: false });

// in-memory Neon + R2 doors (no network). captureSql records the INSERT so we can prove the marker + key.
// The INSERT binds the CONFORMING columns (slug=$1, hash=$2, ... payload_json=$7, ... idem_key=$10); the
// engine version now rides INSIDE the payload_json marker ($7), so the fake extracts it there (mirroring the
// live `payload_json->>'engine_version'` the read-back and the DB trigger both read) - never a column.
function makeStores() {
  const db = new Map(); const r2 = new Map(); const sqlCalls = [];
  const sqlFn = async (query, params) => {
    sqlCalls.push({ query, params });
    if (/^INSERT/.test(query)) {
      const ev = JSON.parse(params[6]).engine_version;
      const row = { slug: params[0], hash: params[1], engine_version: ev };
      db.set(params[0] + '|' + params[1], row);
      return { ok: true, rows: [row] };
    }
    if (/^SELECT/.test(query)) { const row = db.get(params[0] + '|' + params[1]); return { ok: true, rows: row ? [row] : [] }; }
    return { ok: false, rows: [] };
  };
  const putFn = async (key, body) => { r2.set(key, body); return { ok: true, status: 200 }; };
  return { db, r2, sqlCalls, sqlFn, putFn };
}

async function runMint(stores, overrides) {
  return mint(DOMAIN, Object.assign({
    fetchFn, launchBrowser, registersFetchFn, llmCall: scriptedDecline, providers: [], runProbes: fakeRunProbes,
    sqlFn: stores.sqlFn, putFn: stores.putFn, liveFetch: async () => ({ status: 200 }),
    now: () => 1700000000000, generatedAt: '2026-07-19', env: { COMPANIES_HOUSE_API_KEY: 'ci-fixture-key' },
  }, overrides || {}));
}


test('E2E: the full mint runs end to end and returns minted_pending_render (done:false) - the render leg is absent', async () => {
  const stores = makeStores();
  const res = await runMint(stores);
  assert.strictEqual(res.refusal, null, 'a served UK law firm is NOT refused');
  assert.strictEqual(res.status, 'minted_pending_render');
  assert.strictEqual(res.done, false, 'status never flips done on a missing leg (the phantom-data class, C-249)');
});

test('E2E: the stageManifest shows every one of the four evidence lanes RAN (a missing lane is visible, never silent)', async () => {
  const { stageManifest } = await runMint(makeStores());
  const byStage = Object.fromEntries(stageManifest.map((m) => [m.stage, m]));
  assert.strictEqual(byStage.crawl.ran, true);
  assert.strictEqual(byStage.observe.ran, true);
  assert.strictEqual(byStage.domAssert.ran, true);
  assert.strictEqual(byStage.domAssert.launch, 'second-bounded-launch', 'the honest second Chromium launch is recorded (C-041)');
  assert.strictEqual(byStage.registers.ran, true);
  assert.ok(byStage.registers.matched.includes('companiesHouse'), 'the Companies House match attached');
});

test('DEFECT-6 E2E: a broken browser lane (goto REJECTS, the real DEFECT-1 shape) surfaces as a LOUD payload.coverageCaveats entry, never a silent clean payload', async () => {
  // The page.goto() REJECTS here (DEFECT-1's real Playwright shape: a navigation failure that must never
  // be silently swallowed); this proves, end to end through the REAL mint(), that a failed browser lane
  // surfaces as a payload.coverageCaveats entry (DEFECT-6), not just as a stageManifest note no client sees.
  const brokenBrowser = { async newPage() { return { async goto() { throw new Error('Protocol error (Page.navigate): Cannot navigate to invalid URL'); } }; }, async close() {} };
  const { payload, stageManifest } = await runMint(makeStores(), { launchBrowser: async () => brokenBrowser });
  const byStage = Object.fromEntries(stageManifest.map((m) => [m.stage, m]));
  assert.strictEqual(byStage.observe.ran, false, 'the stageManifest itself records the failure');
  assert.strictEqual(byStage.observe.reason, 'error', 'a TYPED failure state, not just ran:false (an unrelated skip/launcher-failure must not pass this assertion)');
  assert.strictEqual(byStage.domAssert.ran, false);
  assert.strictEqual(byStage.domAssert.reason, 'error');
  assert.ok(Array.isArray(payload.coverageCaveats), 'coverageCaveats is present on the CLIENT-FACING payload, not just the engine manifest');
  assert.strictEqual(payload.coverageCaveats.length, 2, 'both browser lanes failed, so both are projected');
  const lanes = payload.coverageCaveats.map((c) => c.lane).sort();
  assert.deepStrictEqual(lanes, ['domAssert', 'observe']);
  assert.ok(payload.coverageCaveats.every((c) => /did not run/.test(c.message)), 'a human-readable caveat, not a raw error code');
  // The OBSERVED-FACT PECR violation this fake normally produces via the network_event bypass (C-084) must
  // NOT appear when the browser genuinely never navigated - no fabricated confident finding rides on a
  // swallowed failure. A DIFFERENT, text-based absence-breach candidate for the same record MAY still
  // exist (a separate detection path, unaffected by the browser lane) and correctly stays needs_review.
  const pecr = payload.findings.find((f) => f.record_id === 'UK_PECR_COOKIES_MARKETING');
  if (pecr) {
    assert.notStrictEqual(pecr.artifact.type, 'network_event', 'no observed-fact PECR bypass from a browser that never navigated');
    assert.notStrictEqual(pecr.voice_tier, 'confident', 'never confident voice on a finding the browser lane could not evidence');
  }
});

test('E2E: facts resolve and connect() filters the catalogue to UK-only (Rule 13, the applicability-leak class)', async () => {
  const { payload } = await runMint(makeStores());
  assert.strictEqual(payload.meta.country, 'UK');
  assert.strictEqual(payload.meta.sector, 'law-firms');
  const jurisdictions = new Set(payload.frameworks.map((f) => f.jurisdiction).filter(Boolean));
  assert.deepStrictEqual([...jurisdictions], ['UK'], 'every bound framework is UK; serving a market is never being bound by its law');
  assert.ok(payload.frameworksBinding > 0, 'connect() counts thread through verbatim');
});

test('E2E: propose emits the PECR network_event AND the dom_node, verify accepts both, adjudicate ships them as observed-fact violations (C-084)', async () => {
  const { payload } = await runMint(makeStores());
  const pecr = payload.findings.find((f) => f.record_id === 'UK_PECR_COOKIES_MARKETING');
  assert.ok(pecr, 'the PECR pre-consent finding exists');
  assert.strictEqual(pecr.state, 'violation');
  assert.strictEqual(pecr.artifact.type, 'network_event', 'the deterministic artifact is the captured pre-consent event (Rule 3)');
  assert.strictEqual(pecr.voice_tier, 'confident', 'an observed network_event violation EARNS confident voice (Rule 10)');
  const dom = payload.findings.find((f) => f.record_id === 'UK_EQUALITY_ACCESSIBILITY');
  assert.ok(dom, 'the accessibility DOM finding exists');
  assert.strictEqual(dom.state, 'violation');
  assert.strictEqual(dom.artifact.type, 'dom_node', 'the deterministic artifact is the failing DOM node (Rule 3)');
});

test('E2E: the PECR violation was reached via the observed-fact BYPASS, not text adjudication (the C-084 disease closed)', async () => {
  const { report } = await runMint(makeStores());
  assert.ok(report.observed_fact >= 1, 'at least one observed fact bypassed the model');
  // the declining model produced zero text violations; every violation is an observed/register bypass.
  assert.strictEqual(report.violation, report.observed_fact + report.register_fact, 'no text-derived violation shipped under a declining model (Rule 12 gate 4)');
});

test('E2E: compose produced a CONTRACT-VALID payload (validatePayload is empty; compose would have thrown otherwise)', async () => {
  const { payload } = await runMint(makeStores());
  assert.deepStrictEqual(validatePayload(payload), []);
  assert.ok(payload.notLegalAdvice && payload.notLegalAdvice.length > 0, 'the standing not-legal-advice line ships (C-200)');
});

test('E2E: persist wrote the R2 object AND the Neon row on the REAL (slug, hash) constraint, the version riding the marker (Rule 15)', async () => {
  const stores = makeStores();
  const res = await runMint(stores);
  const insert = stores.sqlCalls.find((c) => /^INSERT/.test(c.query));
  assert.ok(insert, 'an INSERT was issued');
  assert.match(insert.query, /INSERT INTO audit_pages \(slug, hash, domain, sector, country, framework_version, payload_json, generated_at, status, idem_key\)/, 'only the ten conforming columns');
  assert.match(insert.query, /ON CONFLICT \(slug, hash\) DO UPDATE/, 'the real unique constraint is (slug, hash), never (url, engine_version)');
  assert.doesNotMatch(insert.query, /\b(url|score|grade)\b/, 'no phantom column reaches the SQL');
  // the version + realness markers ride INSIDE payload_json ($7), the exact blob the live trigger inspects.
  const marker = JSON.parse(insert.params[6]);
  assert.strictEqual(marker.r2, true, 'the row stores the {r2:true} marker, not the full payload');
  assert.ok('binding' in marker, 'binding key present (trigger guard 1)');
  assert.ok(marker.binding > 0, 'binding carries connect()\'s frameworksBinding count');
  assert.strictEqual(marker.engine_version, ENGINE_VERSION, 'the engine version rides the marker the trigger gates on (guard 2)');
  assert.strictEqual(typeof marker.llm_verify, 'boolean', 'llm_verify present as a boolean');
  assert.strictEqual(insert.params[9], res.payload.meta.domain + '|' + ENGINE_VERSION, 'idem_key carries domain + ENGINE_VERSION (Rule 15)');
  assert.ok(stores.r2.has('audits/' + res.slug + '/' + res.hash + '.json'), 'the full payload landed in R2 at the website read key');
  assert.ok(stores.db.has(res.slug + '|' + res.hash), 'the compact row landed in Neon');
});

test('E2E: the post-write assertions confirm row + live-200 but withhold done while the render truth-pack is absent (Rule 7)', async () => {
  const res = await runMint(makeStores());
  assert.strictEqual(res.postWrite.rowReadBack.ok, true, 'the row read back real (never a phantom row, C-103)');
  assert.strictEqual(res.postWrite.live200.ok, true, 'the live URL answered 200 (C-102)');
  assert.strictEqual(res.postWrite.truthPack.ran, false);
  assert.match(res.postWrite.truthPack.reason, /render-proof not landed/);
  assert.ok(res.payload && res.row, 'the payload and row are real, not phantom');
});

test('E2E: opts.truthPackDeadlineMs threads through mint() -> assertMinted (Rule 8/9 caller-override seam, PR #20 comment 3610487213)', async () => {
  const stores = makeStores();
  const t0 = Date.now();
  const res = await mint(DOMAIN, {
    fetchFn, launchBrowser, registersFetchFn, llmCall: scriptedDecline, providers: [], runProbes: fakeRunProbes,
    sqlFn: stores.sqlFn, putFn: stores.putFn, liveFetch: async () => ({ status: 200 }),
    now: () => 1700000000000, generatedAt: '2026-07-19', env: { COMPANIES_HOUSE_API_KEY: 'ci-fixture-key' },
    truthPackFn: () => new Promise(() => {}), // a hanging render truth-pass (e.g. a stuck browser); never settles
    truthPackDeadlineMs: 25,
  });
  const elapsed = Date.now() - t0;
  assert.strictEqual(res.refusal, null, 'a served UK law firm is NOT refused');
  assert.strictEqual(res.done, false, 'a hanging truth-pass never flips done (Rule 7)');
  assert.strictEqual(res.status, 'render_mismatch');
  assert.strictEqual(res.postWrite.truthPack.ran, true, 'a hanging leg is ran-but-FAILED, never an honest not-run');
  assert.match(res.postWrite.truthPack.reason, /timed out after 25ms/, 'the tiny override, not the 20s module default, bounded THIS mint');
  assert.ok(elapsed < 5000, 'mint() itself returned promptly under the override, never held hostage on the hanging truthPackFn (' + elapsed + 'ms elapsed)');
});
