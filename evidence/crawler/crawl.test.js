'use strict';
// crawl.test.js - the crawler orchestrator, driven entirely offline (every fetch is injected).
//
// The load-bearing proof is TIER-1-BEFORE-CAP (caution.md C-026): Tier-1 legal pages are ordered ahead of
// commercial pages BEFORE the page cap is applied, so a legal page discovered LAST still survives a cap
// smaller than the candidate count, and a commercial page discovered FIRST is shed. The two seeded C-027
// (query-string) and C-031 (login-wall) fixtures are replayed here too.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { crawl, normaliseDomain } = require('./crawl.js');
const discover = require('./discover.js');
const { classify } = require('./coverage-contract.js');

const FIX = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
function loadFixture(name) { return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')); }

// fetchFnFromPages(pages) -> { fetchFn, calls }. Serves 200 HTML for a known URL, 404 otherwise; `calls`
// records every fetched URL in order, so a test can inspect the crawl's real fetch sequence.
function fetchFnFromPages(pages) {
  const calls = [];
  const fetchFn = (url) => {
    calls.push(url);
    if (Object.prototype.hasOwnProperty.call(pages, url)) {
      return Promise.resolve({ ok: true, status: 200, body: pages[url], finalUrl: url, contentType: 'text/html' });
    }
    return Promise.resolve({ ok: false, status: 404, body: '', finalUrl: url });
  };
  return { fetchFn, calls };
}

// Deterministic, fast crawl opts: a constant clock so the wall-clock cap never trips, width 1 so the fetch
// order equals the ordered fetch list (the ordering proof reads that order directly).
function crawlOpts(fetchFn, extra = {}) {
  return { fetchFn, now: () => 0, width: 1, deadlineMs: 5000, perPageMs: 5000, ...extra };
}

const isInfra = (u) => /\/robots\.txt$/.test(u) || /sitemap/i.test(u);

test('TIER-1-BEFORE-CAP: a legal page discovered LAST beats commercial pages discovered first, before the cap', async () => {
  const home = [
    '<html><head><title>Order Test Ltd</title></head><body>',
    '<h1>Order Test</h1><p>We provide professional services to businesses across the United Kingdom.</p>',
    '<nav>',
    '<a href="/services">Services</a>',
    '<a href="/about">About</a>',
    '<a href="/pricing">Pricing</a>',
    '<a href="/team">Our team</a>',
    '<a href="/modern-slavery-statement">Modern slavery statement</a>', // TIER-1, listed LAST in the DOM
    '</nav>',
    '<footer>Order Test Ltd, company number 01234567.</footer>',
    '</body></html>',
  ].join('');
  const commercial = ['services', 'about', 'pricing', 'team'];
  const pages = { 'https://ordertest.example/': home };
  for (const c of commercial) {
    pages['https://ordertest.example/' + c] = '<html><title>' + c + '</title><body><h1>' + c + '</h1><p>Our ' + c + ' information for clients and customers across the country.</p></body></html>';
  }
  pages['https://ordertest.example/modern-slavery-statement'] = '<html><title>Modern slavery statement</title><body><h1>Modern slavery statement</h1><p>Our statement under the Modern Slavery Act describing the steps we take to prevent slavery in our supply chains.</p></body></html>';

  const { fetchFn, calls } = fetchFnFromPages(pages);
  // cap 13 = homepage + 11 Tier-1 (10 guessed policy paths + the discovered modern-slavery page) + exactly
  // ONE Tier-2 slot. Because Tier ranking happens before the cap slice, the single surviving Tier-2 is the
  // FIRST commercial in discovery order (/services); the rest are shed even though they were discovered
  // before the Tier-1 modern-slavery page.
  const bundle = await crawl('ordertest.example', crawlOpts(fetchFn, { maxPages: 13 }));

  assert.equal(bundle.unreachable, false);
  const fetched = calls.filter((u) => !isInfra(u));
  const idx = (u) => fetched.indexOf(u);

  // 1. The Tier-1 page discovered LAST survived the cap and was fetched.
  assert.ok(idx('https://ordertest.example/modern-slavery-statement') !== -1,
    'the Tier-1 legal page discovered last must survive the cap (ordering precedes accounting)');
  // 2. Three of the four commercial pages, discovered BEFORE the legal page, were shed by the cap.
  for (const c of ['about', 'pricing', 'team']) {
    assert.equal(idx('https://ordertest.example/' + c), -1,
      '/' + c + ' (Tier-2) must be dropped by the cap while the DOM-later Tier-1 page survives');
  }
  // 3. The one surviving commercial page (/services) is fetched AFTER the legal page - Tier-1 before
  //    commercial - even though /services was discovered first.
  assert.ok(idx('https://ordertest.example/services') !== -1, '/services is the one surviving Tier-2 at cap 13');
  assert.ok(idx('https://ordertest.example/modern-slavery-statement') < idx('https://ordertest.example/services'),
    'the Tier-1 legal page is fetched before the commercial page, though discovered later');
  // 4. Generalised: in the fetch order, every Tier-1 page precedes every Tier-2 page.
  const nonHome = fetched.filter((u) => u !== 'https://ordertest.example/');
  const lastTier1 = nonHome.map(discover.classifyTier).lastIndexOf('tier1');
  const firstTier2 = nonHome.map(discover.classifyTier).indexOf('tier2');
  assert.ok(firstTier2 === -1 || firstTier2 > lastTier1, 'no Tier-2 page is fetched before any Tier-1 page');
});

test('C-027: a query-string policy page is crawled and covers the privacy class (p3-crawl-querystring)', async () => {
  const fx = loadFixture('p3-crawl-querystring.json');
  const { fetchFn } = fetchFnFromPages(fx.pages);
  const bundle = await crawl(fx.domain, crawlOpts(fetchFn, { maxPages: fx.maxPages, sector: 'law-firms' }));

  assert.equal(bundle.unreachable, !fx.expect.reachable);
  for (const u of fx.expect.crawledIncludes) {
    assert.ok(bundle.corpus.pages.some((p) => p.url === u), 'a query-string URL must be crawled, not dropped: ' + u);
  }
  if (fx.expect.privacyClassCovered) {
    assert.ok(bundle.corpus.pages.some((p) => classify(p) === 'privacy'), 'the query-string privacy page must count toward privacy coverage');
    assert.ok(bundle.coverage.site.fetched_classes.includes('privacy'));
  }
});

test('C-031: a login-walled homepage stays UNREACHABLE, nothing asserted (p3-crawl-login-reachable)', async () => {
  const fx = loadFixture('p3-crawl-login-reachable.json');
  const { fetchFn } = fetchFnFromPages(fx.pages);
  const bundle = await crawl(fx.domain, crawlOpts(fetchFn));

  assert.equal(bundle.unreachable, fx.expect.unreachable);
  assert.equal(bundle.reason, fx.expect.reason);
  assert.equal(bundle.corpus.pages.length, fx.expect.contentPages);
  assert.equal(bundle.telemetry.content, 0, 'a login wall is never content');
});

test('a fully 404 site is unreachable with an honest reason, and asserts nothing', async () => {
  const { fetchFn } = fetchFnFromPages({});
  const bundle = await crawl('gone.example', crawlOpts(fetchFn));
  assert.equal(bundle.unreachable, true);
  assert.equal(bundle.reason, 'http_404');
  assert.deepEqual(bundle.corpus.pages, []);
});

test('a reachable site returns a corpus with stripped text, the footer surface, and telemetry', async () => {
  const pages = {
    'https://good.example/': '<html><head><title>Good Ltd</title></head><body><h1>Welcome</h1><p>We help clients with professional services every day of the week.</p><footer>Good Ltd, company number 07654321, registered in England.</footer></body></html>',
    'https://good.example/privacy': '<html><head><title>Privacy</title></head><body><h1>Privacy policy</h1><p>This policy explains how Good Ltd processes personal data under the UK GDPR and Data Protection Act 2018.</p></body></html>',
  };
  const { fetchFn } = fetchFnFromPages(pages);
  const bundle = await crawl('good.example', crawlOpts(fetchFn));
  assert.equal(bundle.unreachable, false);
  assert.ok(bundle.corpus.pages.length >= 2);
  assert.ok(/registered in England/.test(bundle.corpus.footerText), 'the footer disclosure surface is captured (C-034)');
  const home = bundle.corpus.pages.find((p) => p.url === 'https://good.example/');
  assert.ok(!/<script|<h1>/i.test(home.text), 'corpus text is stripped visible text only (C-012)');
  assert.ok(bundle.telemetry.content >= 2 && bundle.telemetry.pages_captured >= 2);
});

// ── corpus.language wired end-to-end at crawl.js's ONE producing door (C-022, hidden-defects.md RANK 6) ─
// A synthetic French homepage (hand-written, not copied from any real site) with enough prose across a
// couple of pages to clear language.js's sufficiency floor. POSITIVE CONTROL: the wiring itself (not
// just the pure detectLanguage() unit already covered in language.test.js) produces a real non-English
// corpus.language AND a loud telemetry note - proving the fact actually reaches the bundle
// propose.js's isNonEnglishGated already reads, closing the "wired but never assigned" defect.
test('POSITIVE CONTROL: a French site crawl resolves corpus.language to a non-English tag and records a loud note (C-022)', async () => {
  const frenchProse = 'Nous nous engageons a proteger votre vie privee et vos donnees personnelles. Cette notice explique comment nous recueillons, utilisons et conservons les informations que vous nous fournissez, ainsi que les choix dont vous disposez quant a la maniere dont vos donnees sont traitees. Si vous avez des questions au sujet de cette notice, veuillez nous contacter en utilisant les coordonnees ci-dessous.';
  const pages = {
    'https://exemple-francais.example/': '<html lang="fr-FR"><head><title>Exemple</title></head><body><h1>Bienvenue</h1><p>' + frenchProse + '</p><footer>Exemple SARL.</footer></body></html>',
    'https://exemple-francais.example/confidentialite': '<html lang="fr-FR"><head><title>Confidentialite</title></head><body><h1>Confidentialite</h1><p>' + frenchProse + '</p></body></html>',
  };
  const { fetchFn } = fetchFnFromPages(pages);
  const bundle = await crawl('exemple-francais.example', crawlOpts(fetchFn));
  assert.equal(bundle.unreachable, false);
  assert.equal(bundle.corpus.language, 'fr', 'the wired producer must set corpus.language, not leave it undefined');
  assert.ok(bundle.notes.some((n) => n.kind === 'non-english-corpus'), 'a confident non-English classification is a LOUD telemetry note, not a silent field (C-041 doctrine)');
});

// NEGATIVE CONTROL: an ordinary English site crawl resolves corpus.language to 'en' and records NO
// non-english-corpus note - the wiring must not over-gate a normal English audit.
test('NEGATIVE CONTROL: an English site crawl resolves corpus.language to "en" with no non-english note', async () => {
  const englishProse = 'We are committed to protecting your privacy and your personal data. This notice explains how we collect, use and store the information you provide to us, and the choices you have about how your data is handled. If you have any questions about this notice, please contact us using the details below and we will respond to you as soon as we are able.';
  const pages = {
    'https://good.example/': '<html lang="en-GB"><head><title>Good Ltd</title></head><body><h1>Welcome</h1><p>' + englishProse + '</p><footer>Good Ltd, company number 07654321.</footer></body></html>',
    'https://good.example/privacy': '<html lang="en-GB"><head><title>Privacy</title></head><body><h1>Privacy</h1><p>' + englishProse + '</p></body></html>',
  };
  const { fetchFn } = fetchFnFromPages(pages);
  const bundle = await crawl('good.example', crawlOpts(fetchFn));
  assert.equal(bundle.corpus.language, 'en');
  assert.ok(!bundle.notes.some((n) => n.kind === 'non-english-corpus'), 'an English crawl must never be flagged as non-English');
});

test('crawl rejects an unfetchable domain and a missing fetchFn (fail loud, never a silent empty crawl)', async () => {
  const { fetchFn } = fetchFnFromPages({});
  await assert.rejects(crawl('not-a-domain', crawlOpts(fetchFn)), /fetchable domain/);
  await assert.rejects(crawl('good.example', { now: () => 0 }), /fetchFn is required/);
});

test('normaliseDomain routes through the safe-fetch host door (scheme/path/port/www parsed off)', () => {
  assert.equal(normaliseDomain('https://www.Example.co.uk/some/path?x=1'), 'example.co.uk');
  assert.equal(normaliseDomain('EXAMPLE.com:8443'), 'example.com');
  assert.equal(normaliseDomain(''), '');
});
