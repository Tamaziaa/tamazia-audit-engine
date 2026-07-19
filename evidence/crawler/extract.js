'use strict';
/**
 * extract.js - the crawler's HTML -> evidence extractor. THE ONE producer of stripped visible text for
 * the corpus (caution.md C-012: sector/rule matching never runs on <script>/<style>/markup noise; the
 * evidence quote is cut from exactly this text, C-035). Pure and synchronous over an HTML string; no
 * network, no clock, no env. Every corpus page and the footer surface (C-034) come out of here.
 *
 * pageContentClass() is the C-031/C-032/C-038 guard: a login/challenge/error/SPA-shell response is
 * classified by its CONTENT, not its byte count, so a login or bot-wall page can never flip a site to
 * "reachable" or become an absence-finding surface.
 */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  ndash: '-', mdash: '-', hellip: '...', copy: '(c)', reg: '(R)', trade: '(TM)',
  pound: '£', euro: '€', middot: '·', bull: '•',
};

// numericEntityCode(g) -> the numeric code point a `#...`/`#x...` entity capture encodes.
function numericEntityCode(g) {
  return (g[1] === 'x' || g[1] === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
}
function isValidCodePoint(code) {
  return Number.isFinite(code) && code >= 9 && code <= 0x10ffff;
}
// decodeNumericEntity(g) -> the decoded character for a numeric entity capture, or null when the code
// point is out of range (the caller then falls back to leaving the entity unchanged).
function decodeNumericEntity(g) {
  const code = numericEntityCode(g);
  if (!isValidCodePoint(code)) return null;
  try { return String.fromCodePoint(code); }
  catch (e) { return ' '; /* FAIL-OPEN: an invalid code point in hostile source HTML degrades to a space, the honest substitute; nothing is hidden. */ }
}
// decodeOneEntity(m, g) -> the replacement for one matched entity. A NAMED top-level function (not an
// inline replacer arrow) so its branching is its own unit, not folded into decodeEntities (the
// health-gate Complex Method/Complex Conditional caps).
function decodeOneEntity(m, g) {
  const key = g.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key];
  if (g[0] === '#') {
    const decoded = decodeNumericEntity(g);
    if (decoded !== null) return decoded;
  }
  return m;
}
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, decodeOneEntity);
}

// stripHtml(html) -> visible text only. Raw-text and non-content elements are dropped whole (tolerant of
// "</script >" whitespace, caution.md html-text D-01), block closers become newlines so footer lines
// survive, remaining tags become spaces, entities are decoded, whitespace is collapsed.
function stripHtml(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // An UNCLOSED raw-text element (e.g. `<script>window.x="privacy policy absent"</body>` with NO
  // </script>) survives the paired removal above; the bare opening tag is then stripped by the generic
  // tag rule, leaving its contents in the visible corpus - invisible script text that can become a
  // quoted legal finding (Rule 3: evidence must be an observable artifact, caution.md C-035). Per HTML
  // parsing a raw-text element consumes to its close OR end-of-input, so drop from the first still-open
  // opener to EOI (fail-closed: unterminated raw text is corrupt input, never evidence).
  s = s.replace(/<(?:script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*$/i, ' ');
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|footer|header|nav|br)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\r\f\v]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

// extractHtmlLang(html) -> the raw <html lang="..."> attribute value, or '' when absent/malformed. A
// lightweight regex read (this is a fetch-only lane, no DOM parser): only the FIRST <html ...> tag is
// considered, matching how a browser resolves document.documentElement.lang. Feeds
// evidence/crawler/language.js's detectLanguage() as one of its two signals (C-022); the raw string is
// NOT trusted alone there, since a site can self-declare "en" while its prose reads as another language.
function extractHtmlLang(html) {
  const m = /<html\b[^>]*\blang\s*=\s*["']([^"']*)["']/i.exec(String(html || ''));
  return m ? m[1].trim() : '';
}

// extractOgMeta(html) -> a map of Open Graph meta values keyed by the property SUFFIX (og.site_name,
// og.title, ...). Generic on purpose: the identity-signal property name is never hardcoded here (the
// og: prefix plus a captured suffix), so extract.js surfaces the raw corpus value while identity
// RESOLUTION (legal_name/display_name from the site name) stays the one door in facts/identity.js.
function extractOgMeta(html) {
  const out = {};
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const p = /property\s*=\s*["']og:([a-z_]+)["']/i.exec(m[0]);
    if (!p) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    if (c) out[p[1].toLowerCase()] = decodeEntities(c[1]).trim();
  }
  return out;
}

// sanitizeJsonControlChars(raw) -> raw with every unescaped control character (U+0000..U+001F) that sits
// INSIDE a JSON string literal replaced by a space. JSON forbids a raw control char inside a string, yet
// real sites emit one (a raw newline/tab in a review body), breaking strict JSON.parse and silently
// dropping the block's OWN structured address (empirical legal-US Finding 4: avidlawyers.com's
// LegalService JSON-LD carried addressRegion FL / postalCode 33605 but a control char in an unrelated
// reviewBody failed the parse). Only string-interior control chars are touched, so this can REPAIR a
// malformed string value but can NEVER rescue broken STRUCTURE (a control char between a key and its
// colon is left alone, so that block still fails the reparse and yields nothing). An escaped sequence
// ("\n" = backslash + n, two ordinary chars) is untouched. Recovers the site's own data, never fabricates.
function sanitizeJsonControlChars(raw) {
  // Walk the text tracking string/escape state and neutralise a raw control char ONLY when it sits
  // INSIDE a JSON string literal (where JSON forbids it). A control char OUTSIDE a string is left
  // untouched, so this can only ever repair a malformed string VALUE, never rescue broken STRUCTURE
  // (e.g. a control char between a key and its colon stays, so the block still fails the reparse and
  // yields nothing). Escaped characters are respected so an escaped quote never mis-ends a string.
  const input = String(raw);
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (!inString) { out += ch; if (ch === '"') inString = true; continue; }
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { out += ch; inString = false; continue; }
    out += ch <= '\u001F' ? ' ' : ch;
  }
  return out;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); }
    catch (e) {
      // First parse failed. A raw control char inside a string is the single most common real-site cause
      // (see sanitizeJsonControlChars); retry ONCE on the neutralised copy so a live firm's structured
      // address is not lost to one broken review snippet.
      try { out.push(JSON.parse(sanitizeJsonControlChars(raw))); }
      catch (e2) { /* FAIL-OPEN: genuinely invalid JSON-LD (not just a stray control char) is a fact about the site; record nothing, fabricate nothing (no partial-parse guesses). */ }
    }
  }
  return out;
}

// extractFooterText(html) -> the statutory-disclosure surface (C-034): the concatenated visible text of
// every <footer> region, else '' (the crawl caller may fall back to the page tail). Company number,
// registered office and SRA/authorisation strings live here; it is a MANDATORY detection surface.
function extractFooterText(html) {
  const out = [];
  const re = /<footer\b[^>]*>([\s\S]*?)<\/footer\s*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) { const t = stripHtml(m[1]); if (t) out.push(t); }
  return out.join('\n').trim();
}

// extractHrefs(html) -> every raw href value in the document (query strings kept, C-027). Resolution and
// same-site filtering are the crawl layer's job (via the tools/lib/safe-fetch.js parsed-host door).
function extractHrefs(html) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html))) !== null && out.length < 2000) out.push(decodeEntities(m[1]).trim());
  return out;
}

function buildPage(url, html) {
  const page = { url, title: extractTitle(html), text: stripHtml(html), jsonLd: extractJsonLd(html) };
  const og = extractOgMeta(html);
  if (og.site_name !== undefined) page.ogSiteName = og.site_name;
  return page;
}

// ── content classification (C-031 / C-032 / C-038): never let a wall/login/error/shell flip reachable ──
const CHALLENGE_MARKERS = [
  'just a moment', 'attention required', 'checking your browser', 'verify you are human',
  'access denied', 'ddos protection', 'cf-challenge', 'enable javascript and cookies to continue',
  'captcha', 'request unsuccessful', 'incapsula', 'perimeterx', 'are you a robot',
];
const WALL_STATUSES = new Set([401, 403, 429, 503]);
const LOGIN_MARKERS = /(sign in|signin|log in|login|log ?into|please (?:sign|log) in|enter your (?:password|username)|forgot your password)/i;

function looksChallenge(status, text, title) {
  if (WALL_STATUSES.has(status)) return true;
  const hay = ((title || '') + '\n' + String(text || '').slice(0, 2500)).toLowerCase();
  if (!hay.trim()) return false;
  return CHALLENGE_MARKERS.some((mk) => hay.includes(mk)) && String(text || '').length < 4000;
}

// looksLogin: the WHOLE page is a sign-in gate, not a content page that merely links to a client login.
// Guarded by content dominance (thin visible text OR a password field on a short page), never byte count
// alone (caution.md C-031).
function looksLogin(html, text) {
  const t = String(text || '');
  if (!LOGIN_MARKERS.test((t + ' ' + extractTitle(html)))) return false;
  const hasPasswordField = /<input\b[^>]*type\s*=\s*["']password["']/i.test(String(html));
  if (t.length < 600) return true;
  return hasPasswordField && t.length < 1500;
}

// looksSpaShell: HTTP 200, an HTML document, but near-zero visible text (C-032, royalparkpartners.com).
function looksSpaShell(html, text) {
  if (String(text || '').length >= 200) return false;
  const body = String(html || '');
  if (!/<html[\s>]/i.test(body) && !/<div/i.test(body)) return false;
  return /<div[^>]*id\s*=\s*["'](root|app|__next|___gatsby)["']/i.test(body) || /<script/i.test(body);
}

// isErrorStatus(status) -> true for a hard server/not-found/gone status. Named so the 2-operator
// disjunction is not its own "Complex Conditional" inline in pageContentClass.
function isErrorStatus(status) {
  return status >= 500 || status === 404 || status === 410;
}
// pageContentClass(status, html) -> 'content' | 'challenge' | 'login' | 'error' | 'empty'. Only 'content'
// enters the corpus and counts toward reachability; every other class is honestly withheld.
function pageContentClass(status, html) {
  const st = Number(status) || 0;
  if (isErrorStatus(st)) return 'error';
  const text = stripHtml(html);
  if (looksChallenge(st, text, extractTitle(html))) return 'challenge';
  if (looksLogin(html, text)) return 'login';
  if (looksSpaShell(html, text)) return 'empty';
  if (text.length < 20) return 'empty';
  return 'content';
}

module.exports = {
  decodeEntities, stripHtml, extractTitle, extractHtmlLang, extractOgMeta, extractJsonLd,
  sanitizeJsonControlChars, extractFooterText, extractHrefs, buildPage, pageContentClass,
};
