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

test('stripHtml drops an UNCLOSED raw-text element to end-of-input (no hidden script text in the corpus)', () => {
  // A missing </script> must not leak the script body into the visible corpus (it could be quoted as a
  // legal finding). Per HTML parsing the raw-text element runs to end-of-input, so nothing after it survives.
  const html = '<body><p>real content</p><script>window.claim="privacy policy absent"</body>';
  const text = ex.stripHtml(html);
  assert.match(text, /real content/, 'genuine visible text before the unclosed element survives');
  assert.ok(!/privacy policy absent/.test(text), 'the unterminated script body never enters the corpus');
  assert.ok(!/window\.claim/.test(text), 'no script source leaks as evidence');
  // an unclosed <style> is dropped the same way.
  assert.ok(!/color:red/.test(ex.stripHtml('<div>shown</div><style>.x{color:red}')));
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

// DEFECT-3 (empirical legal-US Finding 4): a raw control character inside a JSON-LD string value
// (e.g. avidlawyers.com's reviewBody) breaks strict JSON.parse and silently drops the block's own
// structured address. sanitizeJsonControlChars neutralises the illegal byte so the address is
// recovered - a positive control - while genuinely malformed JSON still yields nothing (negative
// control: the fix recovers a stray control char, it never guesses at broken structure).
test('DEFECT-3: extractJsonLd recovers a block whose ONLY defect is a raw control char in a string value', () => {
  const cc = String.fromCharCode(0x1f); // an unescaped US control character, illegal inside a JSON string
  const raw = '{"@type":"LegalService","name":"Mincone Law","address":'
    + '{"@type":"PostalAddress","addressCountry":"US","addressRegion":"FL","postalCode":"33605"},'
    + '"review":{"@type":"Review","reviewBody":"great' + cc + 'service"}}';
  assert.throws(() => JSON.parse(raw), 'strict JSON.parse rejects the raw control char (the live-site failure)');
  const ld = ex.extractJsonLd('<script type="application/ld+json">' + raw + '</script>');
  assert.equal(ld.length, 1, 'the block is recovered after control-char sanitisation, not dropped');
  assert.equal(ld[0].address.addressRegion, 'FL', "the firm's own state is preserved");
  assert.equal(ld[0].address.postalCode, '33605', "the firm's own ZIP is preserved");
});

test('DEFECT-3: sanitizeJsonControlChars is structure-preserving and does NOT rescue genuinely broken JSON', () => {
  // It leaves escaped sequences untouched (\n stays two chars) and only neutralises raw control bytes.
  assert.equal(ex.sanitizeJsonControlChars('a\\nb'), 'a\\nb', 'an escaped \\n (backslash + n) is untouched');
  const broken = '<script type="application/ld+json">{"a": ,,,}</script>';
  assert.equal(ex.extractJsonLd(broken).length, 0, 'a structurally-broken block still yields nothing (fail-open preserved, no guessing)');
});
