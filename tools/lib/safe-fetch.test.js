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
