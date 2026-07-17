'use strict';
/**
 * crawl.js - the P3 evidence crawler entry. Produces the EvidenceBundle.corpus the pure facts layer
 * consumes ({pages:[{url,title,text,jsonLd,ogSiteName?}], footerText?}) plus a coverage report.
 *
 * ALL network + clock effects are INJECTED so node:test runs offline and deterministically:
 *   crawl(domain, { fetchFn, deadlineMs, maxPages, width, now, timers, fetchXml, log, sector, rules,
 *                   followDocuments }) -> { domain, corpus, unreachable, reason, documents, coverage,
 *                   telemetry, notes }
 *   fetchFn(url) -> Promise<{ ok, status, body, finalUrl?, contentType? }>   (the ONLY way bytes arrive)
 *
 * Doctrine preserved:
 *   - E-236 parallelism: parallel page fetches (width from opts, NO floor), parallel sitemap discovery,
 *     TIER-1-first ordering applied BEFORE the page cap (discover.js).
 *   - Rule 9: every fetch is wrapped in a hard Promise.race deadline (pool.withDeadline); the pool's
 *     wall-clock deadline is a CAP, never a floor (Rule 8).
 *   - C-024/C-025: the corpus char cap is generous and env-guarded - a sub-floor env value THROWS.
 *   - C-031/C-032/C-038: a login/challenge/error/SPA-shell response never enters the corpus or flips
 *     reachability; an unreadable site yields an unreachable bundle (nothing asserted).
 *   - C-033/C-034: the homepage footer is a mandatory surface, and footer-linked documents are followed
 *     (evidence/documents), with unparsed PDFs demoting dependent obligations in the coverage report.
 */

const crypto = require('crypto');
const safeFetch = require('../../tools/lib/safe-fetch.js');
const { withDeadline, runPool } = require('./pool.js');
const extract = require('./extract.js');
const discover = require('./discover.js');
const coverage = require('./coverage-contract.js');
const { collectDocuments, isPdfLike } = require('../documents/documents.js');

const CORPUS_CAP_FLOOR = 50000;      // below this, footer disclosures fall past the cut (russell-cooke, C-024)
const CORPUS_CAP_DEFAULT = 500000;
const PAGES_FLOOR = 5;
const PAGES_DEFAULT = 120;
const WIDTH_DEFAULT = 8;
const DEADLINE_DEFAULT = 45000;

// resolveCap(envName, def, floor) -> the effective cap. An env value below the safety floor THROWS
// (caution.md C-025: a budget must never be silently zeroed to nothing via env).
function resolveCap(envName, def, floor) {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < floor) {
    throw new Error(envName + '=' + JSON.stringify(raw) + ' is below the safety floor of ' + floor + '; a corpus budget is a cap, never a silent zeroing (caution.md C-025)');
  }
  return n;
}

// normaliseDomain(domain) -> the canonical host for a raw operator-supplied domain, produced through the
// ONE host door (safe-fetch.inputHost): scheme/path/port/www are parsed off via `new URL`, never string-
// stripped here (the second-door class, Rule 1). Returns '' when no host can be parsed.
function normaliseDomain(domain) {
  return safeFetch.inputHost(domain);
}

// fetchPage(fetchFn, url, perPageMs, timers) -> the fetch result, or null on failure/timeout (Rule 9:
// a slow page degrades to null and the crawl continues; it never hangs).
async function fetchPage(fetchFn, url, perPageMs, timers) {
  try { return await withDeadline(() => fetchFn(url), perPageMs, timers); }
  catch (e) { return null; /* FAIL-OPEN: a per-page deadline/exception yields a null slot handled by the caller's telemetry, never a hang or a swallowed hard error. */ }
}

// makeFetchXml(fetchFn, perPageMs, timers) -> the injected XML/robots fetcher discover.js needs: returns
// the body text on a 200, '' otherwise (never throws), each read behind the same hard deadline.
function makeFetchXml(fetchFn, perPageMs, timers) {
  return (url) => fetchPage(fetchFn, url, perPageMs, timers).then((r) => (r && r.ok && r.body) ? String(r.body) : '');
}

// contentPageFrom(url, res, cap) -> a corpus page ({url,title,text,jsonLd,ogSiteName?}) when res is real,
// readable CONTENT (not a login/challenge/error/shell, C-031/C-038); else null with the reason class. A
// document asset (PDF/doc, by extension or content-type) is NOT an HTML corpus page: its binary bytes
// would strip into pseudo-"content" and falsely cover a page-class, defeating the C-033 no-parser
// interlock. It is deferred to the documents lane and marked 'document' here (never asserted from).
function contentPageFrom(url, res, cap) {
  if (!res || !res.body) return { page: null, klass: res && res.status ? 'error' : 'unreachable' };
  if (isPdfLike(url, res.contentType)) return { page: null, klass: 'document' };
  const klass = extract.pageContentClass(res.status, res.body);
  if (klass !== 'content') return { page: null, klass };
  const page = extract.buildPage(res.finalUrl || url, res.body);
  let truncated = false;
  if (page.text.length > cap) { truncated = true; page.text = page.text.slice(0, cap); }
  return { page, klass: 'content', truncated, bodyHash: crypto.createHash('sha1').update(String(res.body)).digest('hex') };
}

// accumulateCorpus(fetchList, results, home, homeUrl, cap) -> { pages, truncated, telemetry }. Content
// pages are deduped by body hash (soft-404s collapse); every non-content class is counted, never asserted.
function accumulateCorpus(fetchList, results, cap) {
  const pages = [];
  const seenBody = new Set();
  const telemetry = { pages_tried: fetchList.length, content: 0, login: 0, challenge: 0, error: 0, empty: 0, unreachable: 0 };
  let truncated = false;
  for (let i = 0; i < fetchList.length; i++) {
    const { page, klass, truncated: t, bodyHash } = contentPageFrom(fetchList[i], results[i], cap);
    telemetry[klass] = (telemetry[klass] || 0) + 1;
    if (!page) continue;
    if (seenBody.has(bodyHash)) continue;
    seenBody.add(bodyHash);
    truncated = truncated || Boolean(t);
    pages.push(page);
  }
  return { pages, truncated, telemetry };
}

// footerLinks(homeHtml, base, accepted) -> same-site hrefs found inside the homepage <footer> (where the
// policy/PDF links live, C-034); empty when there is no footer region.
function footerLinks(homeHtml, base, accepted) {
  const m = /<footer\b[^>]*>([\s\S]*?)<\/footer\s*>/i.exec(String(homeHtml || ''));
  if (!m) return [];
  return discover.discoverLinks(m[1], base, accepted);
}

// blockReason(homeRes, homeKlass, pageCount) -> an honest reason string when the crawl read no content.
function blockReason(homeRes, homeKlass, pageCount) {
  if (pageCount > 0) return null;
  if (homeKlass === 'challenge') return 'anti_bot_challenge';
  if (homeKlass === 'login') return 'login_wall';
  if (homeRes && homeRes.status >= 400) return 'http_' + homeRes.status;
  if (homeKlass === 'empty') return 'js_rendered_empty_shell';
  return 'no_readable_pages';
}

// buildCoverage(pages, opts, truncated, unparsedClasses) -> the coverage report: the site-level render
// class always, plus the per-rule covered|screened contract when catalogue rules were supplied.
function buildCoverage(pages, opts, truncated, unparsedClasses) {
  const site = coverage.computeCoverage(pages, opts.sector);
  const out = { site };
  if (Array.isArray(opts.rules)) out.perRule = coverage.coverageFor(opts.rules, pages, { truncated, unparsedClasses });
  return out;
}

// makeRecorder(opts) -> { notes, record }. record(kind,msg) appends a typed note AND forwards to the
// injected log, so a degraded lane is always recorded and never silent (Rule 4).
function makeRecorder(opts) {
  const notes = [];
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const record = (kind, msg) => { notes.push({ kind, msg }); log(kind, msg); };
  return { notes, record };
}

// resolveBudgets(opts) -> the effective crawl budgets, each an upper bound (Rule 8): the corpus char cap,
// the page cap, the pool width, the wall-clock deadline and the per-page deadline. Env caps below their
// safety floor THROW via resolveCap (C-025); nothing here floors a budget.
function resolveBudgets(opts) {
  const cap = typeof opts.corpusMaxChars === 'number' ? opts.corpusMaxChars : resolveCap('CORPUS_MAX_CHARS', CORPUS_CAP_DEFAULT, CORPUS_CAP_FLOOR);
  const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : resolveCap('MAX_CRAWL_PAGES', PAGES_DEFAULT, PAGES_FLOOR);
  const width = typeof opts.width === 'number' && opts.width > 0 ? opts.width : WIDTH_DEFAULT;
  const deadlineMs = typeof opts.deadlineMs === 'number' ? opts.deadlineMs : DEADLINE_DEFAULT;
  const perPageMs = Math.min(deadlineMs, opts.perPageMs || 20000);
  return { cap, maxPages, width, deadlineMs, perPageMs };
}

// fetchHomepage(ctx) -> { home, homeHtml, homeKlass }. The homepage is the one mandatory surface (footer
// disclosures live here, C-034); a non-content homepage (login/challenge/error/SPA shell) is recorded and
// never asserted from (C-031/C-038). ctx carries the shared crawl context (opts, base, perPageMs, record).
async function fetchHomepage(ctx) {
  const { opts, base, perPageMs, record } = ctx;
  const home = await fetchPage(opts.fetchFn, base + '/', perPageMs, opts.timers);
  const homeHtml = home && home.body ? String(home.body) : '';
  const homeKlass = extract.pageContentClass(home ? home.status : 0, homeHtml);
  if (homeKlass !== 'content') record('homepage-not-content', base + '/ classified as "' + homeKlass + '"; no content asserted from it (C-031/C-038)');
  return { home, homeHtml, homeKlass };
}

// discoverFetchList(ctx, homeHtml, fetchXml, maxPages) -> the deduped, same-site, Tier-1-FIRST-then-capped
// fetch list (C-026). Links (homepage) and sitemap are discovered in PARALLEL (E-236); orderCandidates
// ranks by tier BEFORE the cap slice, so a Tier-1 legal page survives a cap smaller than the candidate
// count even when it was discovered last.
async function discoverFetchList(ctx, homeHtml, fetchXml, maxPages) {
  const { dom, base, accepted } = ctx;
  const [links, sitemap] = await Promise.all([
    Promise.resolve(homeHtml ? discover.discoverLinks(homeHtml, base, accepted) : []),
    discover.discoverSitemap(dom, accepted, fetchXml).catch(() => []),
  ]);
  return discover.orderCandidates(base + '/', [...links, ...sitemap], accepted, maxPages);
}

// followFooterDocuments(ctx, homeHtml, pages) -> the documents-lane result. Skipped (empty) when
// document-following is disabled or nothing readable was crawled; otherwise footer-linked policy documents
// are followed and read honestly (C-033, evidence/documents).
async function followFooterDocuments(ctx, homeHtml, pages) {
  const { opts, base, accepted, perPageMs, record } = ctx;
  const empty = { documents: [], unparsed: [], unparsedClasses: new Set(), notes: [] };
  if (opts.followDocuments === false || !pages.length) return empty;
  return collectDocuments(footerLinks(homeHtml, base, accepted),
    { fetchFn: opts.fetchFn, deadlineMs: perPageMs, timers: opts.timers, log: record });
}

// crawl(domain, opts) -> the evidence bundle. Thin orchestrator: resolve budgets, fetch the homepage,
// discover links + sitemap in parallel, order Tier-1-first then cap, fetch the corpus in parallel, follow
// footer documents, and assemble the corpus + coverage report.
async function crawl(domain, opts = {}) {
  const dom = normaliseDomain(domain);
  if (!dom || !dom.includes('.')) throw new Error('crawl: a fetchable domain (with a public suffix) is required, got ' + JSON.stringify(domain));
  if (typeof opts.fetchFn !== 'function') throw new Error('crawl: opts.fetchFn is required (all network is dependency-injected)');
  const { notes, record } = makeRecorder(opts);
  const { cap, maxPages, width, deadlineMs, perPageMs } = resolveBudgets(opts);
  const base = 'https://' + dom;
  const homeUrl = base + '/';
  const accepted = safeFetch.acceptedSiteSet(dom);
  const fetchXml = typeof opts.fetchXml === 'function' ? opts.fetchXml : makeFetchXml(opts.fetchFn, perPageMs, opts.timers);
  const ctx = { opts, dom, base, accepted, perPageMs, record };

  const { home, homeHtml, homeKlass } = await fetchHomepage(ctx);
  const fetchList = await discoverFetchList(ctx, homeHtml, fetchXml, maxPages);

  const results = await runPool(fetchList, width, deadlineMs,
    (u) => (u === homeUrl ? Promise.resolve(home) : fetchPage(opts.fetchFn, u, perPageMs, opts.timers)), opts.now);
  const { pages, truncated, telemetry } = accumulateCorpus(fetchList, results, cap);
  if (truncated) record('corpus-truncated', 'a page exceeded the ' + cap + '-char corpus cap; absence claims on it demote to needs-review (C-024)');

  const footerText = extract.extractFooterText(homeHtml);
  const docResult = await followFooterDocuments(ctx, homeHtml, pages);

  const unreachable = pages.length === 0;
  const corpus = { pages, footerText: footerText || undefined };
  return {
    domain: dom,
    corpus,
    unreachable,
    reason: blockReason(home, homeKlass, pages.length),
    documents: { records: docResult.documents, unparsed: docResult.unparsed },
    coverage: buildCoverage(pages, opts, truncated, docResult.unparsedClasses),
    telemetry: { ...telemetry, pages_captured: pages.length, truncated, via: unreachable ? 'none' : 'direct' },
    notes,
  };
}

module.exports = {
  crawl, resolveCap, normaliseDomain, accumulateCorpus, contentPageFrom, footerLinks, blockReason,
  resolveBudgets, makeRecorder, fetchHomepage, discoverFetchList, followFooterDocuments,
};
