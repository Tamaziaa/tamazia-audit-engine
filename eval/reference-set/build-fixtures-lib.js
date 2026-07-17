'use strict';
// eval/reference-set/build-fixtures-lib.js - the PURE, offline, unit-tested helpers behind
// eval/reference-set/build-fixtures.js (HTML/text extraction, entity/control-char handling,
// bot-wall/SPA-shell classification, byte-budget trimming). Zero I/O, zero network, zero
// dependency on the network layer or the CLI in build-fixtures.js.
//
// Split out of build-fixtures.js purely to keep that file under the health-gate file-length cap
// (tools/health-gate/check.js): this is exactly the "pure helpers (unit-tested in
// build-fixtures.test.js)" section the original file already grouped and commented as one
// cohesive unit, so it earns its own module rather than padding out build-fixtures.js further.
// Every export here is required straight back into build-fixtures.js and re-exported unchanged
// under the exact same names, so build-fixtures.test.js's `require('./build-fixtures.js')`
// contract is untouched.

const MAX_TEXT_CHARS = 20000;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', hellip: '...', copy: '(c)', reg: '(R)', trade: '(TM)',
  pound: '£', euro: '€', dollar: '$', middot: '·', bull: '•',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase())
        ? NAMED_ENTITIES[name.toLowerCase()]
        : m
    );
}

function safeFromCodePoint(cp) {
  try {
    if (!Number.isFinite(cp) || cp < 9 || cp > 0x10ffff) return ' ';
    return String.fromCodePoint(cp);
  } catch (e) {
    return ' '; // invalid code point in source HTML; a space is the honest substitute
  }
}

// Strip Unicode bidi control characters (LRE/RLE/PDF/LRO/RLO U+202A-U+202E, LRI/RLI/FSI/PDI
// U+2066-U+2069, LRM/RLM U+200E/U+200F - used live on abspartners.ae to wrap a phone number
// and on knightsbridge.ae) plus C0/C1 control bytes, EXCEPT \n and \t. Scraped HTML can carry
// these from copy-pasted rich text; they are never printable content and must never reach a
// fixture, a log line or a rendered page. Printable text (letters, punctuation, currency signs,
// curly quotes) is never touched.
const BIDI_CONTROL_RX = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
const C0_C1_CONTROL_RX = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;
function stripControlChars(s) {
  return String(s == null ? '' : s)
    .replace(BIDI_CONTROL_RX, '')
    .replace(C0_C1_CONTROL_RX, '');
}

// Wrap a possibly remote-derived value (a fetched title, a redirect URL, an error message
// carrying response text) before it reaches console output: collapse newlines/carriage
// returns/spaces/hyphens to a single space and cap the length, so a hostile title or redirect
// target can never forge extra log lines or flood the terminal (CodeQL log-injection class).
function logSafe(s) {
  return String(s).replace(/[\r\n -]/g, ' ').slice(0, 300);
}

// Visible text only (caution.md C-012: never classify on <script>/<style> noise).
function stripHtml(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // Block-level closers become newlines so footer lines survive as lines.
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|footer|header|nav|br)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\r\f\v]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = stripControlChars(s);
  return s.trim();
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html));
  return m ? stripControlChars(decodeEntities(m[1]).replace(/\s+/g, ' ').trim()) : '';
}

function extractOgSiteName(html) {
  const s = String(html);
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tag = m[0];
    if (!/property\s*=\s*["']og:site_name["']/i.test(tag)) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (c) return stripControlChars(decodeEntities(c[1]).trim());
  }
  return undefined;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch (e) {
      // Invalid JSON-LD on the live site is a fact about the site; record nothing,
      // fabricate nothing. (Fail-closed: no partial parse guesses.)
    }
  }
  return out;
}

// Discover cheap secondary pages: about / contact / legal / privacy / terms on the
// same registrable host. Query-string URLs are permitted (caution.md C-027).
const SECONDARY_PATH_RE = /(about|contact|who-we-are|our-(team|firm|practice|clinic|company)|legal|imprint|privacy|terms)/i;

function discoverSecondaryLinks(html, baseUrl, max) {
  const cap = typeof max === 'number' ? max : 2;
  const found = [];
  const seen = new Set();
  let base;
  try { base = new URL(baseUrl); } catch (e) { return found; }
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null && found.length < cap) {
    const href = decodeEntities(m[1]).trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (stripWww(u.hostname) !== stripWww(base.hostname)) continue;
    if (!SECONDARY_PATH_RE.test(u.pathname + u.search)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|doc|docx|mp4)$/i.test(u.pathname)) continue;
    const key = u.origin + u.pathname + u.search;
    if (seen.has(key)) continue;
    if (key === base.origin + base.pathname + base.search) continue;
    seen.add(key);
    found.push(u.href);
  }
  return found;
}

function stripWww(host) {
  return String(host).toLowerCase().replace(/^www\./, '');
}

// Honest bot-wall / challenge detection. A 200 that is a Cloudflare interstitial is
// NOT content (caution.md C-031: reachable is guarded by classification, not bytes).
const CHALLENGE_MARKERS = [
  'just a moment', 'attention required', 'checking your browser',
  'verify you are human', 'access denied', 'ddos protection', 'cf-challenge',
  'enable javascript and cookies to continue', 'captcha', 'request unsuccessful',
  'incapsula', 'perimeterx', 'are you a robot',
];

function looksLikeChallengePage(status, text, title) {
  if (status === 403 || status === 429 || status === 503 || status === 401) return true;
  const hay = `${title || ''}\n${(text || '').slice(0, 2500)}`.toLowerCase();
  if (!hay.trim()) return false;
  const marked = CHALLENGE_MARKERS.some((mk) => hay.includes(mk));
  // A real page can mention 'captcha' in prose; only call it a wall when the visible
  // text is also very thin.
  return marked && (text || '').length < 4000;
}

// Unrendered SPA shell: HTTP 200, an HTML document, but near-zero visible text.
// The old estate fabricated 22 cookie findings on exactly this shape (caution.md
// C-032, royalparkpartners.com); the fixture must record it honestly instead.
function looksLikeSpaShell(bodyHtml, visibleText) {
  const body = String(bodyHtml || '');
  if ((visibleText || '').length >= 200) return false;
  if (!/<html[\s>]/i.test(body)) return false;
  return (
    /<div[^>]*id\s*=\s*["'](root|app|__next|___gatsby)["']/i.test(body) ||
    /data-vite-theme|src="\/assets\/index-|type="module"/i.test(body) ||
    /<script/i.test(body)
  );
}

// ---------------------------------------------------------------------------
// URL-safety single door: every fetch target (the homepage attempts AND every redirect hop) is
// parsed through here. Hosts are PARSED via new URL, never substring-matched, so localhost,
// loopback, link-local and RFC1918 / CGNAT / ULA private ranges cannot be reached even via a
// crafted redirect (an offline dev tool must not become an SSRF pivot). This is the ONE place host
// safety is decided; both isFetchableDomain and the network layer route through it.
// ---------------------------------------------------------------------------

// Blocked IPv4 ranges as [firstOctet, secondOctetLow, secondOctetHigh]: "this network", loopback,
// the three RFC1918 blocks, link-local, and CGNAT. A /8 block uses the full 0..255 second-octet span.
const BLOCKED_IPV4_RANGES = [
  [0, 0, 255], [127, 0, 255], [10, 0, 255], [172, 16, 31],
  [192, 168, 168], [169, 254, 254], [100, 64, 127],
];

// isPrivateIPv4(host) -> true for a loopback/private/link-local/CGNAT IPv4 literal or a malformed
// one (an octet > 255). A non-IPv4-literal host returns false here (the caller handles those).
function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return true; // malformed octet: refuse
  const [a, b] = o;
  return BLOCKED_IPV4_RANGES.some((r) => a === r[0] && b >= r[1] && b <= r[2]);
}

// isBlockedHost(host) -> true for any host this tool must never fetch: localhost, loopback, private
// or link-local literals, IPv6 ULA/link-local, and bare dot-less names (not a public DNS target).
function isBlockedHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
  if (isPrivateIPv4(h)) return true;
  return !h.includes('.'); // a dot-less name is an internal/unqualified host, not fetchable
}

// parseSafeFetchTarget(rawUrl) -> a parsed URL when it is a public http(s) target, else null.
function parseSafeFetchTarget(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (e) { return null; /* malformed URL: refuse (return null; caller rejects) */ }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

// Trim a fixture object under the byte budget without fabricating anything.
function trimToBudget(fixture, maxBytes) {
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  if (size(fixture) <= maxBytes) return fixture;
  const f = JSON.parse(JSON.stringify(fixture));
  const steps = [
    () => { for (const p of pagesOf(f)) if (p.jsonLd && size(p.jsonLd) > 20000) p.jsonLd = []; },
    () => { for (const p of pagesOf(f)) p.text = (p.text || '').slice(0, 12000); },
    () => { for (const p of pagesOf(f)) p.jsonLd = []; },
    () => { const pp = pagesOf(f); if (pp.length > 2) pp.length = 2; },
    () => { for (const p of pagesOf(f)) p.text = (p.text || '').slice(0, 6000); },
    () => { const pp = pagesOf(f); if (pp.length > 1) pp.length = 1; },
  ];
  for (const step of steps) {
    step();
    if (size(f) <= maxBytes) { f.trimmed = true; return f; }
  }
  // Fail closed: after exhausting every deterministic trim step the fixture is STILL over budget
  // (an unusually large title or other untrimmed field). Never return an oversized fixture marked
  // "trimmed" - that would be a budget behaving as anything but a hard cap (Constitution Rule 8).
  throw new Error('fixture exceeds byte budget after trimming: ' + size(f) + ' > ' + maxBytes + ' bytes');
}

function pagesOf(f) {
  return (f.corpus && Array.isArray(f.corpus.pages)) ? f.corpus.pages : [];
}

function buildBundlePage(url, html) {
  return {
    url,
    title: extractTitle(html),
    text: stripHtml(html).slice(0, MAX_TEXT_CHARS),
    jsonLd: extractJsonLd(html),
    ogSiteName: extractOgSiteName(html),
  };
}

module.exports = {
  MAX_TEXT_CHARS,
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
  isBlockedHost,
  parseSafeFetchTarget,
};
