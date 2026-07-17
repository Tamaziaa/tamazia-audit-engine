'use strict';
// node --test eval/reference-set/build-fixtures.test.js
// Offline unit tests for the pure helpers in build-fixtures.js. No network is
// touched here: the network layer is exercised only by running the builder itself.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeEntities,
  stripHtml,
  extractTitle,
  extractOgSiteName,
  extractJsonLd,
  discoverSecondaryLinks,
  looksLikeChallengePage,
  looksLikeSpaShell,
  trimToBudget,
  buildBundlePage,
  stripControlChars,
  logSafe,
  MAX_FIXTURE_BYTES,
} = require('./build-fixtures.js');

test('stripHtml removes script/style/head noise and keeps visible prose (C-012)', () => {
  const html = `<html><head><title>Ignore</title><style>.x{color:red}</style></head>
    <body><script>var secret = "not text";</script>
    <h1>Dermatology Clinic</h1><p>Regulated by the SRA, no. 500046</p>
    <noscript>enable js</noscript></body></html>`;
  const text = stripHtml(html);
  assert.match(text, /Dermatology Clinic/);
  assert.match(text, /Regulated by the SRA, no\. 500046/);
  assert.doesNotMatch(text, /var secret/);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /enable js/);
});

test('stripHtml decodes entities so no amp/x27 residue leaks into text (C-003 class)', () => {
  const text = stripHtml('<p>Skin &amp; Body &#x27;clinic&#39; &quot;best&quot; &pound;99</p>');
  assert.equal(text.includes('&amp;'), false);
  assert.equal(text.includes('x27'), false);
  assert.match(text, /Skin & Body 'clinic' "best" £99/);
});

test('stripHtml turns block closers into newlines so footer lines survive', () => {
  const text = stripHtml('<div>Company No. 01234567</div><div>Registered in England</div>');
  assert.match(text, /Company No\. 01234567\nRegistered in England/);
});

test('extractTitle and extractOgSiteName', () => {
  const html = `<head><title> Acme &amp; Co </title>
    <meta property="og:site_name" content="Acme &amp; Co Ltd" /></head>`;
  assert.equal(extractTitle(html), 'Acme & Co');
  assert.equal(extractOgSiteName(html), 'Acme & Co Ltd');
  assert.equal(extractOgSiteName('<head></head>'), undefined);
});

test('extractJsonLd parses valid blocks and silently skips invalid JSON', () => {
  const html = `
    <script type="application/ld+json">{"@type":"Organization","name":"Acme Ltd"}</script>
    <script type="application/ld+json">{not valid json</script>
    <script type="application/ld+json">[{"@type":"WebSite"}]</script>`;
  const out = extractJsonLd(html);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Acme Ltd');
  assert.ok(Array.isArray(out[1]));
});

test('discoverSecondaryLinks keeps same-host about/contact/legal pages, permits query strings (C-027)', () => {
  const html = `
    <a href="/about-us">About</a>
    <a href="/privacy?page_id=7">Privacy</a>
    <a href="https://evil.example.com/about">off-host</a>
    <a href="https://www.acme.co.uk/contact">contact (www variant ok)</a>
    <a href="/brochure.pdf">pdf skipped</a>
    <a href="mailto:x@acme.co.uk">mail</a>
    <a href="/blog/post-1">blog skipped</a>`;
  const links = discoverSecondaryLinks(html, 'https://acme.co.uk/', 5);
  assert.deepEqual(links, [
    'https://acme.co.uk/about-us',
    'https://acme.co.uk/privacy?page_id=7',
    'https://www.acme.co.uk/contact',
  ]);
});

test('discoverSecondaryLinks respects the cap and never returns the base page itself', () => {
  const html = '<a href="/">home</a><a href="/about">a</a><a href="/contact">c</a><a href="/legal">l</a>';
  const links = discoverSecondaryLinks(html, 'https://acme.co.uk/', 2);
  assert.equal(links.length, 2);
});

test('looksLikeChallengePage flags 403/429/503 and thin Cloudflare interstitials (C-031/C-038)', () => {
  assert.equal(looksLikeChallengePage(403, 'anything', ''), true);
  assert.equal(looksLikeChallengePage(429, '', ''), true);
  assert.equal(looksLikeChallengePage(503, '', ''), true);
  assert.equal(
    looksLikeChallengePage(200, 'Checking your browser before accessing the site.', 'Just a moment...'),
    true
  );
  // A long real page that merely mentions captcha in prose is NOT a wall.
  const realText = `We use a captcha on our contact form. ${'Real visible clinic content. '.repeat(200)}`;
  assert.equal(looksLikeChallengePage(200, realText, 'Acme Clinic'), false);
});

test('buildBundlePage caps text at 20000 chars and carries url/title/jsonLd', () => {
  const big = `<title>Big</title><body>${'word '.repeat(10000)}</body>`;
  const p = buildBundlePage('https://acme.co.uk/', big);
  assert.equal(p.url, 'https://acme.co.uk/');
  assert.equal(p.title, 'Big');
  assert.ok(p.text.length <= 20000);
  assert.ok(Array.isArray(p.jsonLd));
});

test('trimToBudget brings an oversized fixture under 150KB without inventing fields', () => {
  const bigPage = () => ({
    url: 'https://acme.co.uk/',
    title: 'x',
    text: 'y'.repeat(20000),
    jsonLd: [{ blob: 'z'.repeat(60000) }],
  });
  const fixture = {
    domain: 'acme.co.uk',
    corpus: { pages: [bigPage(), bigPage(), bigPage()], footerText: 'f'.repeat(3000) },
    registers: {},
  };
  const trimmed = trimToBudget(fixture, MAX_FIXTURE_BYTES);
  const bytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
  assert.ok(bytes <= MAX_FIXTURE_BYTES, `still ${bytes} bytes`);
  assert.equal(trimmed.trimmed, true);
  assert.equal(trimmed.domain, 'acme.co.uk');
  // An already-small fixture passes through untouched (no spurious trimmed flag).
  const small = { domain: 'a', corpus: { pages: [], footerText: '' }, registers: {} };
  assert.equal(trimToBudget(small, MAX_FIXTURE_BYTES).trimmed, undefined);
});

test('looksLikeSpaShell flags a 200 HTML shell with near-zero visible text (C-032)', () => {
  const shell = '<html lang="en"><head><style data-vite-theme="">:root{}</style></head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>';
  assert.equal(looksLikeSpaShell(shell, ''), true);
  const realPage = '<html><body><h1>Clinic</h1></body></html>';
  assert.equal(looksLikeSpaShell(realPage, 'Real visible clinic content. '.repeat(20)), false);
  assert.equal(looksLikeSpaShell('plain text, not html', ''), false);
});

test('decodeEntities never throws on malformed numeric references', () => {
  assert.equal(typeof decodeEntities('&#xFFFFFFFF; &#0; &unknown;'), 'string');
});

// ---------------------------------------------------------------------------------------------
// stripControlChars / logSafe (Semgrep bidi-control-char + log-injection fixes). Built from
// String.fromCodePoint/fromCharCode rather than embedding literal bidi/control bytes in this
// source file, for the same reason the fix exists: those code points are invisible and easy to
// mis-transcribe.
// ---------------------------------------------------------------------------------------------

test('stripControlChars removes bidi control characters, keeping the wrapped text (abspartners.ae live class)', () => {
  const LRE = String.fromCodePoint(0x202A);
  const PDF = String.fromCodePoint(0x202C);
  const RLO = String.fromCodePoint(0x202E);
  const LRI = String.fromCodePoint(0x2066);
  const PDI = String.fromCodePoint(0x2069);
  const LRM = String.fromCodePoint(0x200E);
  const RLM = String.fromCodePoint(0x200F);
  const wrapped = LRE + '+971504517950' + PDF + ' ' + LRI + 'text' + PDI + ' ' + LRM + RLM + RLO;
  assert.equal(stripControlChars(wrapped), '+971504517950 text ');
});

test('stripControlChars removes C0/C1 controls but keeps \\n and \\t', () => {
  let all = '';
  for (let cp = 0x00; cp <= 0x1f; cp++) all += String.fromCharCode(cp);
  all += String.fromCharCode(0x7f);
  for (let cp = 0x80; cp <= 0x9f; cp++) all += String.fromCharCode(cp);
  assert.equal(stripControlChars(all), '\t\n');
});

test('stripControlChars never touches printable text (letters, currency, curly quotes, em-dash)', () => {
  const text = 'Café £99 "quoted" - plain visible prose';
  assert.equal(stripControlChars(text), text);
});

test('logSafe strips newlines/carriage-returns so a remote title cannot forge extra log lines, and caps length', () => {
  const injected = 'Acme Ltd\nFAKE LOG LINE: audit approved\r' + 'x'.repeat(400);
  const safe = logSafe(injected);
  assert.equal(safe.includes('\n'), false);
  assert.equal(safe.includes('\r'), false);
  assert.ok(safe.length <= 300, 'logSafe must cap length at 300 chars, got ' + safe.length);
});
