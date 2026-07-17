'use strict';
/**
 * safe-fetch.js - THE ONE DOOR for URL/host safety and parsed-host comparison.
 *
 * Two failure classes converge here, so there is exactly one implementation of each (Rule 1):
 *
 *  1. SSRF / DNS-rebinding: every fetch target (a homepage attempt, a redirect hop, a resolved
 *     DNS answer) is validated through parseSafeFetchTarget + makeSafeLookup. Hosts are PARSED via
 *     `new URL`, never substring-matched, so localhost, loopback, link-local and RFC1918 / CGNAT /
 *     ULA private ranges cannot be reached even via a crafted redirect or a name that resolves to a
 *     private address. This logic was promoted verbatim out of eval/reference-set/build-fixtures-lib.js
 *     (which now requires it) so the fixture builder and the P3 evidence crawler share ONE door.
 *
 *  2. host-substring comparison (GAPS.md `host-substring`, caution.md C-009): "is this URL on this
 *     site" is decided by parsing the URL and comparing the HOSTNAME, never by `url.includes(domain)`
 *     (which is TRUE for https://evil.com/linkedin.com). registrableDomain / sameRegistrableSite /
 *     isSameHost / hostOf are the parsed-host primitives every evidence-side consumer routes through;
 *     tools/domain-gates/host-parse.js fails CI on any host-substring comparison done outside here.
 *
 * Pure and offline: the dns dependency is INJECTED into makeSafeLookup (never required here) so this
 * module stays unit-testable with a stubbed lookup and never itself opens a socket.
 */

// ── SSRF door: blocked address ranges ────────────────────────────────────────────────────────────

// Blocked IPv4 ranges as [firstOctet, secondOctetLow, secondOctetHigh]: "this network", loopback,
// the three RFC1918 blocks, link-local, and CGNAT. A /8 block uses the full 0..255 second-octet span.
const BLOCKED_IPV4_RANGES = [
  [0, 0, 255], [127, 0, 255], [10, 0, 255], [172, 16, 31],
  [192, 168, 168], [169, 254, 254], [100, 64, 127],
];

// isPrivateIPv4(host) -> true for a loopback/private/link-local/CGNAT IPv4 literal or a malformed one
// (an octet > 255). A non-IPv4-literal host returns false here (the caller handles those).
function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return true; // malformed octet: refuse
  const [a, b] = o;
  return BLOCKED_IPV4_RANGES.some((r) => a === r[0] && b >= r[1] && b <= r[2]);
}

// Wildcard/loopback literals that are never a fetch target, in either IPv4 or IPv6 form.
const WILDCARD_LOOPBACK_LITERALS = new Set(['0.0.0.0', '::', '::1']);

// isBlockedIpv6(h) -> true for an IPv6 ULA (fc00::/7) or link-local (fe80::/10) literal.
function isBlockedIpv6(h) {
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 ULA
  return /^fe[89ab][0-9a-f]:/.test(h); // fe80::/10 link-local
}

// normaliseHost(host) -> lowercased host with any surrounding IPv6 brackets stripped.
function normaliseHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

// V4_MAPPED_RX: an IPv4-mapped IPv6 literal, compressed (::ffff:1.2.3.4) or expanded
// (0:0:0:0:0:ffff:1.2.3.4). Node's URL/dns layers can emit either spelling for the same address.
const V4_MAPPED_RX = /^(?:::|(?:0+:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

// unmapIpv4(h) -> the embedded dotted IPv4 when h is an IPv4-mapped IPv6 literal, else h unchanged.
// Without this, ::ffff:10.0.0.1 is "IPv6" to every IPv4 range check and sails through the door.
function unmapIpv4(h) {
  const m = V4_MAPPED_RX.exec(h);
  return m ? m[1] : h;
}

// isBlockedAddress(ip) -> true for a loopback/private/link-local/CGNAT IP LITERAL (v4 or v6). This is
// the resolved-IP door: a DNS answer is an IP literal, and it is validated here against the SAME
// ranges as the hostname door, so a name that resolves to a private address cannot slip through
// (DNS-rebinding SSRF). isBlockedHost delegates its literal checks here so there is one door, not two.
function isBlockedAddress(ip) {
  const h = unmapIpv4(normaliseHost(ip));
  if (WILDCARD_LOOPBACK_LITERALS.has(h)) return true;
  if (isPrivateIPv4(h)) return true;
  return isBlockedIpv6(h);
}

// isBlockedHost(host) -> true for any host this tool must never fetch: localhost, loopback, private
// or link-local literals, IPv6 ULA/link-local, and bare dot-less names (not a public DNS target).
function isBlockedHost(host) {
  const h = normaliseHost(host);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isBlockedAddress(h)) return true;
  return !h.includes('.'); // a dot-less name is an internal/unqualified host, not fetchable
}

// parseSafeFetchTarget(rawUrl) -> a parsed URL when it is a public http(s) target, else null.
function parseSafeFetchTarget(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (e) { return null; /* FAIL-OPEN: an unparseable URL cannot be a safe fetch target, so returning null makes every caller REFUSE it (the closed outcome); a malformed string is simply not a fetchable URL and nothing is hidden. */ }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

// makeLookupCallback(hostname, wantAll, cb) -> the dns.lookup callback that validates the resolved
// addresses. Every resolved address is checked against isBlockedAddress (the same door the hostname
// check uses); if ANY resolved address is private/loopback/link-local the whole lookup is refused, so
// a name that resolves (or re-resolves, mid-redirect) to an internal address never reaches a socket.
function makeLookupCallback(hostname, wantAll, cb) {
  return function onResolved(err, addresses) {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [];
    const blocked = list.find((a) => isBlockedAddress(a.address));
    if (blocked) return cb(new Error('refused: ' + hostname + ' resolved to blocked address ' + blocked.address + ' (SSRF/DNS-rebinding guard)'));
    if (wantAll) return cb(null, list);
    if (!list.length) return cb(new Error('refused: no address resolved for ' + hostname));
    return cb(null, list[0].address, list[0].family);
  };
}

// makeSafeLookup(dnsLookup) -> a Node `lookup`-option callback that resolves via the injected
// dnsLookup (dns.lookup), validates EVERY resolved address against the private/loopback/link-local
// blocklist, and only then allows the connection. Passed as the request `lookup` option so the
// approved address is re-checked on the initial hop AND on every redirect hop.
function makeSafeLookup(dnsLookup) {
  return function safeLookup(hostname, options, callback) {
    const optionsIsCallback = typeof options === 'function';
    const cb = optionsIsCallback ? options : callback;
    const opts = optionsIsCallback ? {} : (options || {});
    const wantAll = Boolean(opts.all);
    dnsLookup(hostname, Object.assign({}, opts, { all: true }), makeLookupCallback(hostname, wantAll, cb));
  };
}

// ── parsed-host comparison door: "is this URL on this site" ───────────────────────────────────────

// Whitespace, control and zero-width chars browsers ignore inside a scheme (so "java\tscript:" and
// " javascript:" are still recognised as the dangerous scheme they are). Built via RegExp() from
// escape STRINGS so the source file stays ASCII (no literal control bytes in a public repo):
// U+0000..U+0020 controls/space, NBSP, the U+2000..U+200B space run, and the BOM.
const CTRL_RX = new RegExp('[\\u0000-\\u0020\\u00a0\\u2000-\\u200b\\ufeff]', 'g');
const DANGEROUS_SCHEME_RX = /^(javascript|vbscript|data|file|blob):/i;

// isDangerousScheme(href) -> true for a scheme we must never follow or render. Case/whitespace/control
// tolerant (js/incomplete-url-scheme-check): a scheme check is a substring test on the SCHEME, which is
// legitimate; host identity is never decided this way.
function isDangerousScheme(href) {
  const flat = String(href == null ? '' : href).replace(CTRL_RX, '');
  return DANGEROUS_SCHEME_RX.test(flat);
}

// isNonCrawlable(href) -> true for an href the crawler must not follow (anchor, mail/tel/sms, or a
// dangerous scheme). A query-string href IS crawlable (caution.md C-027); only fragments are dropped.
function isNonCrawlable(href) {
  const h = String(href == null ? '' : href).trim();
  if (!h) return true;
  if (h.startsWith('#')) return true;
  if (/^(mailto|tel|sms|callto|fax):/i.test(h.replace(CTRL_RX, ''))) return true;
  return isDangerousScheme(h);
}

// hostOf(u, base) -> the lowercase, www-stripped hostname of u (resolved against base if relative), or
// '' when u is not a parseable URL. The ONLY way host identity is read; never a substring of the URL.
function hostOf(u, base) {
  try { return new URL(String(u), base || undefined).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return ''; /* FAIL-OPEN: a value that will not parse as a URL has no host, so returning '' makes the caller treat it as NOT same-site (the closed outcome); it can never produce a false same-site match. */ }
}

// The common multi-part public suffixes, so a subdomain (blog./help./uk.) and the www variant of the
// same registrable domain all count as the SAME SITE. Defaults to last-two-labels otherwise.
const MULTI_TLD = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'govt.nz', 'co.za', 'org.za',
  'com.sg', 'edu.sg', 'gov.sg', 'com.br', 'com.mx', 'co.in', 'net.in', 'org.in', 'co.jp', 'or.jp',
  'com.hk', 'com.cn', 'co.ae', 'gov.ae', 'com.tr', 'co.il', 'com.sa',
]);

// registrableDomain(host) -> the registrable domain (eTLD+1) of a host string, www-stripped and
// port-stripped. Parsed from labels, never a substring of a URL.
function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/:.*$/, '');
  const p = h.split('.');
  if (p.length <= 2) return h;
  return MULTI_TLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

// isSameHost(u, domain) -> true when u's HOST is `domain` or a subdomain of it. Never a substring test
// (isSameHost('https://evil.com/linkedin.com', 'linkedin.com') is FALSE; the old .includes() said TRUE).
function isSameHost(u, domain) {
  const h = hostOf(u);
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!h || !d) return false;
  return h === d || h.endsWith('.' + d);
}

// sameRegistrableSite(u, accepted) -> true when u's registrable domain is in the `accepted` Set (the
// input domain plus any canonical-alternate host). Subdomains fold in via registrableDomain.
function sameRegistrableSite(u, accepted) {
  const host = hostOf(u);
  if (!host) return false;
  const set = accepted instanceof Set ? accepted : new Set(accepted || []);
  return set.has(registrableDomain(host));
}

// inputHost(raw) -> the canonical host of an operator-supplied domain, read through the parsed-host door.
// The input may arrive bare ("example.com"), schemed ("https://example.com/path"), www-prefixed, cased or
// ported ("EXAMPLE.com:443"); a scheme is prepended when absent so `new URL` can parse it, and hostOf then
// lowercases, strips www and drops the port. This is the ONE place a raw domain becomes a host - a consumer
// never string-strips a URL of its own (the second-door class). Returns '' when no host can be parsed.
function inputHost(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s;
  return hostOf(withScheme);
}

// acceptedSiteSet(raw) -> the Set of registrable domains that count as "this site" for a crawl seeded from
// `raw`. The crawl passes this Set to sameRegistrableSite for every candidate URL, so host identity is
// produced once, here, behind the door - the caller holds a Set, never a host primitive of its own.
function acceptedSiteSet(raw) {
  const host = inputHost(raw);
  return new Set(host ? [registrableDomain(host)] : []);
}

module.exports = {
  // SSRF door (promoted from build-fixtures-lib.js; re-exported there unchanged)
  isBlockedHost,
  isBlockedAddress,
  parseSafeFetchTarget,
  makeSafeLookup,
  // parsed-host comparison door (the host-substring class)
  isDangerousScheme,
  isNonCrawlable,
  hostOf,
  registrableDomain,
  isSameHost,
  sameRegistrableSite,
  inputHost,
  acceptedSiteSet,
};
