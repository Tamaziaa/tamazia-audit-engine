'use strict';
// probes/onpage-signals.js - on-page SEO / security-header / accessibility-signal probe.
//
// Faithful port of the old estate's producer: cowork-os-fresh src/lib/audit/site-scan.js
// `extractSignals()` (the boolean/security signal set: meta description, Open Graph, canonical,
// viewport, HSTS/CSP/X-Frame-Options/Referrer-Policy/Permissions-Policy, h1 count, JSON-LD presence).
//
// ARCHITECTURAL NOTE (deviation, documented): the old producer read these signals off the SAME raw
// HTML + response headers its own site-scan fetch had just captured. This engine's crawl corpus
// (evidence/crawler/extract.js `buildPage`) deliberately keeps only `{url, title, text, jsonLd,
// ogSiteName}` - stripped text and parsed JSON-LD, never the raw byte string or the response header
// map (Rule 1: the crawler is the one door for the corpus; this probe does not reach into it). Response
// headers in particular are simply not retained anywhere in the bundle. So this probe makes its OWN
// single, deadline-bounded GET of the homepage (mirroring exactly what the old producer's site-scan.js
// did independently) to read the header-only and markup-only signals (HSTS/CSP/canonical/viewport/
// meta description/Open Graph/Twitter card), and falls back to the corpus's own `title`/`jsonLd`/`text`
// for the signals that ARE representable there (title length, JSON-LD presence, thin-content word
// count) when a corpus page is supplied, so it never re-derives a fact the crawler already produced
// (Rule 1) for the signals the corpus actually carries.

const { fetchDeadlined, cleanDomain } = require('./lib/net.js');

const FETCH_DEADLINE_MS = 15000;

// pagesOf(corpus) -> the corpus's page array, or [] when the corpus carries none. One guard, one
// logical operator (no compound boolean expression anywhere in this file - keeps every function flat,
// which is what CodeScene's density/Overall-Code-Complexity measure rewards).
function pagesOf(corpus) {
  if (!corpus || !Array.isArray(corpus.pages)) return [];
  return corpus.pages;
}

// matchesDomain(page, dom) -> true when a crawled page's URL is on the target domain.
function matchesDomain(page, dom) {
  return cleanDomain(page && page.url) === dom;
}

// homePageFromCorpus(corpus, domain) -> the crawled homepage-shaped entry from the corpus, or null.
// (pages is non-empty past the guard, so find()||pages[0] is always the returned value - no trailing
// `|| null` needed; a falsy pages[0] already coerces to null exactly as before.)
function homePageFromCorpus(corpus, domain) {
  const pages = pagesOf(corpus);
  if (!pages.length) return null;
  const dom = cleanDomain(domain);
  return pages.find((p) => matchesDomain(p, dom)) || pages[0];
}

// extractHeaderSignals(headers) -> the security/response-header booleans (Rule 1: read straight off the
// one fetch this probe itself made; nothing here re-derives a corpus fact).
function extractHeaderSignals(headers) {
  const h = headers || {};
  return {
    hsts: !!h['strict-transport-security'], csp: !!h['content-security-policy'],
    xcto: !!h['x-content-type-options'], xfo: !!h['x-frame-options'],
    refpol: !!h['referrer-policy'], permpol: !!h['permissions-policy'],
  };
}

// extractMarkupSignals(body) -> the markup-only booleans the corpus does not carry (raw HTML was
// stripped by the crawler by design). A bounded set of anchored regexes, same detection intent as the
// old producer's extractSignals().
function extractMarkupSignals(body) {
  const b = String(body || '');
  const descMatch = b.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  return {
    meta_description: !!descMatch,
    meta_description_len: descMatch ? descMatch[1].trim().length : 0,
    open_graph: /property=["']og:/i.test(b),
    twitter_card: /name=["']twitter:card["']/i.test(b),
    canonical: /rel=["']canonical["']/i.test(b),
    viewport: /name=["']viewport["']/i.test(b),
    lang: /<html[^>]+lang=/i.test(b),
    h1_count: (b.match(/<h1[\s>]/gi) || []).length,
    favicon: /rel=["'][^"']*icon/i.test(b),
  };
}

// nodeTypeMatches(node, typeRx) -> true when a JSON-LD node's @type (one value or an array) matches.
function nodeTypeMatches(node, typeRx) {
  return [].concat(node['@type'] || []).some((t) => typeRx.test(String(t)));
}

// jsonLdHasType(jsonLd, typeRx) -> true when any parsed JSON-LD block (or its @graph) declares a
// matching @type. Reuses the corpus's ALREADY-PARSED jsonLd (Rule 1: no second parse of raw markup).
// walk() leans on its own array/non-object base cases: `walk(o['@graph'])` on a missing @graph recurses
// into undefined, which the guards immediately resolve to false - so the @graph step needs no extra if.
function jsonLdHasType(jsonLd, typeRx) {
  const blocks = Array.isArray(jsonLd) ? jsonLd : [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.some(walk);
    if (!o || typeof o !== 'object') return false;
    if (nodeTypeMatches(o, typeRx)) return true;
    return walk(o['@graph']);
  };
  return blocks.some(walk);
}

// fetchProblem(r) -> null when the homepage fetch is usable (2xx with a body), else the reason string
// the probe abstains with. Early returns keep every check to at most one logical operator, so no line
// is a compound boolean (a `r && r.ok && r.text` expression is exactly what CodeScene flags as a
// Complex Conditional).
function fetchProblem(r) {
  if (!r) return 'unreachable';
  if (r.ok && r.text) return null;
  return r.error || 'unreachable';
}

// jsonLdArray(jsonLd) -> the parsed JSON-LD as an array (or [] when absent), so a caller reads its
// length and passes it on without repeating the Array.isArray guard.
function jsonLdArray(jsonLd) {
  return Array.isArray(jsonLd) ? jsonLd : [];
}

// wordCountOf(home) / titleLenOf(home) -> the two thin-content signals the corpus carries, or null.
function wordCountOf(home) {
  return home.text ? home.text.split(/\s+/).filter(Boolean).length : null;
}
function titleLenOf(home) {
  return home.title ? home.title.length : null;
}

// corpusSignalsFromHome(home) -> the corpus-derived signals when the crawler DID supply a homepage
// entry (Rule 1: read straight off the crawler's already-parsed corpus, never a second markup parse).
function corpusSignalsFromHome(home) {
  const jsonLd = jsonLdArray(home.jsonLd);
  return {
    jsonLdPresent: jsonLd.length > 0,
    hasOrgSchema: jsonLdHasType(jsonLd, /Organization|LocalBusiness|LegalService|ProfessionalService|Corporation/i),
    wordCount: wordCountOf(home),
    titleLen: titleLenOf(home),
  };
}

// corpusSignalsFromRawText(rawText) -> the fallback when NO corpus page exists: only the one boolean
// the raw fetch's own markup can answer (JSON-LD presence); the rest stay honestly null/false.
function corpusSignalsFromRawText(rawText) {
  return { jsonLdPresent: /application\/ld\+json/i.test(rawText), hasOrgSchema: false, wordCount: null, titleLen: null };
}

// corpusDerivedSignals(home, rawText) -> the corpus-representable signals, or the raw-text fallback
// when the crawler supplied no page. One branch on `home`; each branch is its own flat helper.
function corpusDerivedSignals(home, rawText) {
  return home ? corpusSignalsFromHome(home) : corpusSignalsFromRawText(rawText);
}

// assembleOnpage(markupSig, headerSig, corpusSig) -> the four measured sections in payload shape. A
// flat object literal (zero branches); factored out so onpageSignalsProbe stays short.
function assembleOnpage(markupSig, headerSig, corpusSig) {
  return {
    ok: true,
    onpage: Object.assign({ state: 'measured', json_ld: corpusSig.jsonLdPresent, has_org_schema: corpusSig.hasOrgSchema, word_count: corpusSig.wordCount, title_len: corpusSig.titleLen }, markupSig),
    security: Object.assign({ state: 'measured' }, headerSig),
    a11y: { state: 'measured', h1_count: markupSig.h1_count, lang_declared: markupSig.lang, viewport: markupSig.viewport },
    tech: { state: 'measured', canonical: markupSig.canonical, favicon: markupSig.favicon, json_ld: corpusSig.jsonLdPresent },
  };
}

// onpageSignalsProbe({domain, corpus, env, fetchFn}) -> { ok:true, onpage, security, a11y, tech } or
// { ok:false, reason }. fetchFn is injectable for tests (defaults to the deadline-wrapped real fetch).
async function onpageSignalsProbe({ domain, corpus, fetchFn } = {}) {
  const dom = cleanDomain(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  const doFetch = typeof fetchFn === 'function' ? fetchFn : (url) => fetchDeadlined(url, { deadlineMs: FETCH_DEADLINE_MS });
  const r = await doFetch('https://' + dom);
  const problem = fetchProblem(r);
  if (problem) return { ok: false, reason: problem };

  const markupSig = extractMarkupSignals(r.text);
  const headerSig = extractHeaderSignals(r.headers);
  const corpusSig = corpusDerivedSignals(homePageFromCorpus(corpus, dom), r.text);
  return assembleOnpage(markupSig, headerSig, corpusSig);
}

module.exports = { onpageSignalsProbe, extractHeaderSignals, extractMarkupSignals, jsonLdHasType };
