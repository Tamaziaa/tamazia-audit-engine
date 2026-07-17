'use strict';
// extract.test.js - the ONE producer of stripped visible text and the content classifier.

const test = require('node:test');
const assert = require('node:assert');

const ex = require('./extract.js');

test('stripHtml keeps visible text only: script/style/noscript dropped, entities decoded, whitespace collapsed', () => {
  const html = '<html><head><style>.x{color:red}</style><script>var a=1<2;</script></head>'
    + '<body><h1>Hello&nbsp;&amp; welcome</h1><p>Line one</p><p>Line two</p><noscript>enable js</noscript></body></html>';
  const text = ex.stripHtml(html);
  assert.ok(!/color:red|var a/.test(text), 'script/style contents never enter the corpus (C-012)');
  assert.ok(!/enable js/.test(text), 'noscript is dropped');
  assert.match(text, /Hello & welcome/);
  assert.match(text, /Line one\nLine two/, 'block closers become newlines so footer lines survive');
});

test('stripHtml tolerates whitespace in closing tags (</script >)', () => {
  assert.ok(!/secret/.test(ex.stripHtml('<script >var s="secret"</script >visible')));
});

test('decodeEntities: named, numeric decimal, numeric hex, and malformed references', () => {
  assert.equal(ex.decodeEntities('a&amp;b'), 'a&b');
  assert.equal(ex.decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(ex.decodeEntities('&pound;10'), '£10');
  assert.equal(ex.decodeEntities('&notareal;'), '&notareal;', 'an unknown entity is left intact, never guessed');
});

test('extractTitle and extractFooterText (the mandatory disclosure surface, C-034)', () => {
  const html = '<html><head><title>  Acme &amp; Co  </title></head><body>x<footer>Acme Ltd, company number 01234567.<br>Registered in England.</footer></body></html>';
  assert.equal(ex.extractTitle(html), 'Acme & Co');
  const footer = ex.extractFooterText(html);
  assert.match(footer, /company number 01234567/);
  assert.match(footer, /Registered in England/);
});

test('extractHrefs keeps query strings (C-027) and is bounded', () => {
  const hrefs = ex.extractHrefs('<a href="/privacy?page_id=42">p</a><a href="/x#frag">x</a><a href="mailto:a@b.c">m</a>');
  assert.ok(hrefs.includes('/privacy?page_id=42'), 'a query string is never dropped');
  assert.ok(hrefs.includes('/x#frag'));
});

test('extractOgMeta surfaces og:site_name as a corpus value; buildPage sets page.ogSiteName', () => {
  const html = '<html><head><meta property="og:site_name" content="Acme &amp; Co"><meta property="og:title" content="Home"></head><body><p>Some visible body text for the corpus here.</p></body></html>';
  const og = ex.extractOgMeta(html);
  assert.equal(og.site_name, 'Acme & Co');
  assert.equal(og.title, 'Home');
  const page = ex.buildPage('https://x.example/', html);
  assert.equal(page.ogSiteName, 'Acme & Co');
});

test('buildPage omits ogSiteName when there is no og:site_name meta', () => {
  const page = ex.buildPage('https://x.example/', '<html><body><p>Body text with enough length to be content here.</p></body></html>');
  assert.equal('ogSiteName' in page, false);
});

test('extractJsonLd parses valid blocks and silently skips invalid JSON (never guesses)', () => {
  const html = '<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>'
    + '<script type="application/ld+json">{bad json}</script>';
  const ld = ex.extractJsonLd(html);
  assert.equal(ld.length, 1);
  assert.equal(ld[0].name, 'Acme');
});

test('pageContentClass: real content is content', () => {
  assert.equal(ex.pageContentClass(200, '<html><body><h1>About us</h1><p>We are a firm providing services to clients across the country.</p></body></html>'), 'content');
});

test('pageContentClass: a login-dominant page is login, not content (C-031)', () => {
  const login = '<html><head><title>Sign in</title></head><body><form><input type="password" name="p"></form>Please log in.</body></html>';
  assert.equal(ex.pageContentClass(200, login), 'login');
});

test('pageContentClass: wall statuses and server errors never become content', () => {
  assert.equal(ex.pageContentClass(403, '<html><body>Access denied, please verify you are human.</body></html>'), 'challenge');
  assert.equal(ex.pageContentClass(500, '<html><body>error</body></html>'), 'error');
  assert.equal(ex.pageContentClass(404, '<html><body>not found</body></html>'), 'error');
});

test('pageContentClass: an empty SPA shell is empty, not content (C-032)', () => {
  assert.equal(ex.pageContentClass(200, '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'), 'empty');
  assert.equal(ex.pageContentClass(200, '<html><body>   </body></html>'), 'empty');
});
