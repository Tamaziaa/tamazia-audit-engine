'use strict';
// safe-fetch.test.js - THE ONE DOOR for host safety. Two failure classes converge here: SSRF/DNS-rebinding
// (private/loopback ranges) and host-substring comparison (url.includes(domain) is TRUE for evil.com paths).
// Both consumers (eval/reference-set/build-fixtures-lib.js and evidence/browser/observe.js) route through it.

const test = require('node:test');
const assert = require('node:assert');

const sf = require('./safe-fetch.js');

test('hostOf parses the host, lowercases, strips www; returns "" for a non-URL', () => {
  assert.equal(sf.hostOf('https://www.Example.com/path?a=1'), 'example.com');
  assert.equal(sf.hostOf('https://BLOG.example.co.uk/x'), 'blog.example.co.uk');
  assert.equal(sf.hostOf('not a url'), '');
});

test('registrableDomain returns the eTLD+1, including multi-part public suffixes', () => {
  assert.equal(sf.registrableDomain('blog.example.com'), 'example.com');
  assert.equal(sf.registrableDomain('help.example.co.uk'), 'example.co.uk');
  assert.equal(sf.registrableDomain('example.com'), 'example.com');
});

test('HOST-SUBSTRING CLASS: identity is by parsed host, never url.includes (the evil.com/linkedin.com trap)', () => {
  assert.equal(sf.isSameHost('https://evil.com/linkedin.com', 'linkedin.com'), false, 'a name in the PATH is not the host');
  assert.equal(sf.isSameHost('https://www.linkedin.com/in/x', 'linkedin.com'), true);
  assert.equal(sf.isSameHost('https://sub.linkedin.com/x', 'linkedin.com'), true, 'a subdomain is same-host');
  assert.equal(sf.isSameHost('https://notreed.co.uk/x', 'reed.co.uk'), false, 'endsWith would wrongly say true; parsed host does not');
});

test('sameRegistrableSite folds subdomains in and rejects a look-alike path', () => {
  const accepted = new Set(['example.com']);
  assert.equal(sf.sameRegistrableSite('https://blog.example.com/x', accepted), true);
  assert.equal(sf.sameRegistrableSite('https://evil.com/example.com', accepted), false);
});

test('isNonCrawlable: fragments, mailto/tel and dangerous schemes are dropped; a query URL is kept', () => {
  assert.equal(sf.isNonCrawlable('#section'), true);
  assert.equal(sf.isNonCrawlable('mailto:a@b.c'), true);
  assert.equal(sf.isNonCrawlable('tel:+44'), true);
  assert.equal(sf.isNonCrawlable('javascript:alert(1)'), true);
  assert.equal(sf.isNonCrawlable('/privacy?page_id=42'), false, 'a query-string page IS crawlable (C-027)');
});

test('isDangerousScheme is whitespace/control tolerant (java\\tscript: is still dangerous)', () => {
  assert.equal(sf.isDangerousScheme('javascript:x'), true);
  assert.equal(sf.isDangerousScheme(' java\tscript:x'), true);
  assert.equal(sf.isDangerousScheme('data:text/html,x'), true);
  assert.equal(sf.isDangerousScheme('https://ok'), false);
});

test('isBlockedHost blocks localhost, private/loopback/link-local/CGNAT, IPv6 ULA and dot-less names', () => {
  for (const h of ['localhost', 'x.localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1', 'internalhost']) {
    assert.equal(sf.isBlockedHost(h), true, h + ' must be blocked');
  }
  assert.equal(sf.isBlockedHost('example.com'), false);
  assert.equal(sf.isBlockedHost('93.184.216.34'), false);
});

test('isBlockedAddress catches IPv4-mapped IPv6 (::ffff:10.0.0.1) so a private answer cannot slip through', () => {
  assert.equal(sf.isBlockedAddress('::ffff:10.0.0.1'), true);
  assert.equal(sf.isBlockedAddress('10.0.0.1'), true);
  assert.equal(sf.isBlockedAddress('93.184.216.34'), false);
});

test('isBlockedAddress catches the HEX spelling of an IPv4-mapped IPv6 private/loopback address', () => {
  // ::ffff:7f00:1 == 127.0.0.1, ::ffff:a00:1 == 10.0.0.1. WHATWG `new URL` canonicalises the dotted
  // form to this hex spelling, so without unwrapping it a loopback/private target sails through the door.
  assert.equal(sf.isBlockedAddress('::ffff:7f00:1'), true, '::ffff:7f00:1 is 127.0.0.1');
  assert.equal(sf.isBlockedAddress('::ffff:a00:1'), true, '::ffff:a00:1 is 10.0.0.1');
  assert.equal(sf.isBlockedAddress('::ffff:c0a8:1'), true, '::ffff:c0a8:1 is 192.168.0.1');
  // control: a PUBLIC address in hex-mapped form must NOT be blocked (8.8.8.8).
  assert.equal(sf.isBlockedAddress('::ffff:808:808'), false, '::ffff:808:808 is public 8.8.8.8');
});

test('parseSafeFetchTarget refuses a loopback target written as a mapped IPv6 URL (URL canonicalises to hex)', () => {
  assert.equal(sf.parseSafeFetchTarget('http://[::ffff:127.0.0.1]/'), null);
  assert.equal(sf.parseSafeFetchTarget('http://[::ffff:7f00:1]/'), null);
  assert.equal(sf.parseSafeFetchTarget('http://[::ffff:a00:1]/'), null);
});

test('parseSafeFetchTarget: public http(s) only; null on non-http, blocked host or malformed', () => {
  assert.ok(sf.parseSafeFetchTarget('https://example.com/x'));
  assert.equal(sf.parseSafeFetchTarget('ftp://example.com'), null);
  assert.equal(sf.parseSafeFetchTarget('http://127.0.0.1/'), null);
  assert.equal(sf.parseSafeFetchTarget('http://localhost/'), null);
  assert.equal(sf.parseSafeFetchTarget('::::not a url'), null);
});

test('inputHost: a raw operator domain becomes a canonical host through the parsed door', () => {
  assert.equal(sf.inputHost('example.com'), 'example.com');
  assert.equal(sf.inputHost('https://www.Example.co.uk/some/path?x=1'), 'example.co.uk');
  assert.equal(sf.inputHost('EXAMPLE.com:8443'), 'example.com', 'the port is parsed off, never string-kept');
  assert.equal(sf.inputHost(''), '');
  assert.equal(sf.inputHost('has a space'), '', 'an unparseable input yields no host');
});

test('DEFECT-1: resolveNavigableUrl prepends https:// to a BARE domain (the engine\'s own mint(url,opts) calling convention)', () => {
  assert.equal(sf.resolveNavigableUrl('lomond.co.uk'), 'https://lomond.co.uk/');
  assert.equal(sf.resolveNavigableUrl('EXAMPLE.com:8443'), 'https://example.com:8443/');
});

test('resolveNavigableUrl preserves an explicit scheme exactly (never re-forces https, never silently downgrades)', () => {
  assert.equal(sf.resolveNavigableUrl('http://lomond.co.uk'), 'http://lomond.co.uk/');
  assert.equal(sf.resolveNavigableUrl('https://lomond.co.uk/some/path?x=1'), 'https://lomond.co.uk/some/path?x=1');
});

test('resolveNavigableUrl returns "" for genuinely unparseable input (the caller\'s own goto/deadline/catch chain then records the loud lane failure)', () => {
  assert.equal(sf.resolveNavigableUrl(''), '');
  assert.equal(sf.resolveNavigableUrl('has a space'), '');
  assert.equal(sf.resolveNavigableUrl(null), '');
});

test('CodeRabbit PR #25 (round 3): resolveNavigableUrl refuses any non-http(s) scheme, never handing a real browser a local-file/script/data target', () => {
  assert.equal(sf.resolveNavigableUrl('file:///etc/passwd'), '', 'a file: target must never reach page.goto()');
  assert.equal(sf.resolveNavigableUrl('javascript:alert(1)'), '');
  assert.equal(sf.resolveNavigableUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sf.resolveNavigableUrl('blob:https://lomond.co.uk/x'), '');
  // an http(s) target is unaffected by the scheme floor (the common, safe path stays exactly as before).
  assert.equal(sf.resolveNavigableUrl('https://lomond.co.uk'), 'https://lomond.co.uk/');
});

test('CodeRabbit PR #25 (round 4): a single-slash pseudo-scheme (no "://") never becomes a dangerous URL either - it is swallowed by the bare-domain branch, never the scheme-preserving one', () => {
  // The scheme-preservation test (line ~252) requires a literal "://"; "file:/etc/passwd" (ONE slash) does
  // NOT match it, so this door treats it exactly like a bare domain: "https://" is prepended and the whole
  // string parses as an (odd, DNS-doomed) https:// URL whose HOST happens to be "file" - it can never
  // become an actual file:/javascript:/data: navigation, because only an input that already carries "://"
  // ever has its scheme preserved, and that path is the one the scheme floor above gates. This locks the
  // real behaviour in (not the literal "" CodeRabbit's suggested diff proposed, which does not hold: these
  // inputs resolve to a benign https: URL, never a dangerous one, so asserting them to "" would be
  // asserting something false about this door and silently mask what actually happens on this input class).
  assert.equal(sf.resolveNavigableUrl('file:/etc/passwd'), 'https://file/etc/passwd');
  assert.equal(new URL(sf.resolveNavigableUrl('file:/etc/passwd')).protocol, 'https:', 'never file:');
  assert.equal(sf.resolveNavigableUrl('data:/text/html,hi'), 'https://data/text/html,hi');
  assert.equal(new URL(sf.resolveNavigableUrl('data:/text/html,hi')).protocol, 'https:', 'never data:');
  assert.equal(sf.resolveNavigableUrl('javascript:/alert(1)'), 'https://javascript/alert(1)');
  assert.equal(new URL(sf.resolveNavigableUrl('javascript:/alert(1)')).protocol, 'https:', 'never javascript:');
});

test('acceptedSiteSet: the set of registrable domains that count as this site', () => {
  assert.deepEqual([...sf.acceptedSiteSet('www.example.com')], ['example.com']);
  assert.deepEqual([...sf.acceptedSiteSet('https://blog.example.co.uk/x')], ['example.co.uk']);
  assert.deepEqual([...sf.acceptedSiteSet('has a space')], [], 'garbage input yields an empty accepted set, never a bogus host');
});

test('makeSafeLookup: a name resolving to a public address is allowed; a private answer is REFUSED (DNS-rebinding)', async () => {
  const publicLookup = (host, opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  const privateLookup = (host, opts, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]);

  const okAddr = await new Promise((res, rej) => sf.makeSafeLookup(publicLookup)('example.com', {}, (e, a) => (e ? rej(e) : res(a))));
  assert.equal(okAddr, '93.184.216.34');

  await assert.rejects(
    new Promise((res, rej) => sf.makeSafeLookup(privateLookup)('rebind.example', {}, (e, a) => (e ? rej(e) : res(a)))),
    /blocked address 10\.0\.0\.5/,
  );
});
