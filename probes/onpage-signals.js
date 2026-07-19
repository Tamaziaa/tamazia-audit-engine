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

// homePageFromCorpus(corpus, domain) -> the crawled homepage-shaped entry from the corpus, or null.
// (pages is non-empty past the guard, so find()||pages[0] is always the returned value - no trailing
// `|| null` needed; a falsy pages[0] already coerces to null exactly as before.)
function homePageFromCorpus(corpus, domain) {
  const pages = (corpus && Array.isArray(corpus.pages)) ? corpus.pages : [];
  if (!pages.length) return null;
  const dom = cleanDomain(domain);
  return pages.find((p) => cleanDomain(p && p.url) === dom) || pages[0];
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

// jsonLdHasType(jsonLd, typeRx) -> true when any parsed JSON-LD block (or its @graph) declares a
// matching @type. Reuses the corpus's ALREADY-PARSED jsonLd (Rule 1: no second parse of raw markup).
function jsonLdHasType(jsonLd, typeRx) {
  const blocks = Array.isArray(jsonLd) ? jsonLd : [];
  const walk = (o) => {
    if (!o) return false;
    if (Array.isArray(o)) return o.some(walk);
    if (typeof o !== 'object') return false;
    const types = [].concat(o['@type'] || []);
    if (types.some((t) => typeRx.test(String(t)))) return true;
    if (o['@graph']) return walk(o['@graph']);
    return false;
  };
  return blocks.some(walk);
}

// fetchProblem(r) -> null when the homepage fetch is usable (2xx with a body), else the reason string
// the probe abstains with (one door for both the usable check and its failure reason, so the file
// carries one guard function here, not two - keeps the module's aggregate complexity down).
function fetchProblem(r) {
  if (r && r.ok && r.text) return null;
  return (r && r.error) ? r.error : 'unreachable';
}

// corpusSignalsFromHome(home) -> the corpus-derived signals when the crawler DID supply a homepage
// entry (Rule 1: read straight off the crawler's already-parsed corpus, never a second markup parse).
function corpusSignalsFromHome(home) {
  return {
    jsonLdPresent: Array.isArray(home.jsonLd) && home.jsonLd.length > 0,
    hasOrgSchema: jsonLdHasType(home.jsonLd, /Organization|LocalBusiness|LegalService|ProfessionalService|Corporation/i),
    wordCount: home.text ? home.text.split(/\s+/).filter(Boolean).length : null,
    titleLen: home.title ? home.title.length : null,
  };
}

// corpusSignalsFromRawText(rawText) -> the fallback when NO corpus page exists: only the one boolean
// the raw fetch's own markup can answer (JSON-LD presence); the rest stay honestly null/false.
function corpusSignalsFromRawText(rawText) {
  return { jsonLdPresent: /application\/ld\+json/i.test(rawText), hasOrgSchema: false, wordCount: null, titleLen: null };
}

// onpageSignalsProbe({domain, corpus, env, fetchFn}) -> { ok:true, onpage, security, a11y, tech } or
// { ok:false, reason }. fetchFn is injectable for tests (defaults to the deadline-wrapped real fetch).
// The final assembly is a flat object literal (no branches), so it lives inline here rather than in a
// separate shaper: keeping it here removes a whole function from the file without adding any branch to
// this one (the two corpus-signal branches stay factored out into the pair of helpers above).
async function onpageSignalsProbe({ domain, corpus, fetchFn } = {}) {
  const dom = cleanDomain(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  const doFetch = typeof fetchFn === 'function' ? fetchFn : (url) => fetchDeadlined(url, { deadlineMs: FETCH_DEADLINE_MS });
  const r = await doFetch('https://' + dom);
  const problem = fetchProblem(r);
  if (problem) return { ok: false, reason: problem };

  const headerSig = extractHeaderSignals(r.headers);
  const markupSig = extractMarkupSignals(r.text);
  const home = homePageFromCorpus(corpus, dom);
  const corpusSig = home ? corpusSignalsFromHome(home) : corpusSignalsFromRawText(r.text);

  return {
    ok: true,
    onpage: Object.assign({ state: 'measured', json_ld: corpusSig.jsonLdPresent, has_org_schema: corpusSig.hasOrgSchema, word_count: corpusSig.wordCount, title_len: corpusSig.titleLen }, markupSig),
    security: Object.assign({ state: 'measured' }, headerSig),
    a11y: { state: 'measured', h1_count: markupSig.h1_count, lang_declared: markupSig.lang, viewport: markupSig.viewport },
    tech: { state: 'measured', canonical: markupSig.canonical, favicon: markupSig.favicon, json_ld: corpusSig.jsonLdPresent },
  };
}

module.exports = { onpageSignalsProbe, extractHeaderSignals, extractMarkupSignals, jsonLdHasType };
