'use strict';
/**
 * documents.js - follow footer-linked policy documents and read them, HONESTLY (caution.md C-033).
 *
 * Footer-linked policy documents and external PDFs (Lomond, Dutch & Dutch privacy/MSA/fees PDFs) were
 * never read, so "missing" findings fired on obligations whose evidence was in a linked PDF. This lane
 * follows those links and reads what it CAN with a zero-dependency route:
 *
 *   - HTML policy documents ARE parseable with the crawler's stripper -> {parsed:true, text}.
 *   - PDFs are NOT: there is no reliable zero-dependency PDF text extractor, and an honest gap beats a bad
 *     parser (a mis-extracted policy is worse than a known-unread one). Every PDF is recorded LOUDLY as
 *     {url, fetched:true, parsed:false, reason:'no-parser'} on the bundle, its note pushed to the log, and
 *     its page-class returned in `unparsedClasses` so the coverage interlock (C-024/C-033) demotes any
 *     obligation that depends on it to needs-review instead of asserting an absence.
 *
 * No new dependency is introduced (Constitution: zero runtime npm deps). Effects are INJECTED: fetchFn
 * (async url -> {ok,status,body,finalUrl,contentType}) and the deadline timers, so node:test runs offline.
 */

const { withDeadline } = require('../crawler/pool.js');
const { stripHtml } = require('../crawler/extract.js');
const { classify } = require('../crawler/coverage-contract.js');
const safeFetch = require('../../tools/lib/safe-fetch.js');

const POLICY_DOC_RX = /privacy|cookie|terms|conditions|legal|complaint|fees|pricing|returns|refund|data[-_ ]protection|gdpr|modern[-_ ]slavery|disclosure|imprint/i;
const DOC_ASSET_RX = /\.(pdf|doc|docx|rtf)(\?|#|$)/i;
const DEFAULT_MAX_DOCS = 12;

// isPolicyDocLink(url) -> true when a footer href is worth following as a policy document: a policy-named
// page OR any document-asset download (pdf/doc). Query strings are kept (C-027); host safety is the
// caller's (the crawl passes same-site footer links).
function isPolicyDocLink(url) {
  const u = String(url || '');
  if (safeFetch.isNonCrawlable(u)) return false;
  return POLICY_DOC_RX.test(u) || DOC_ASSET_RX.test(u);
}

// isPdfLike(url, contentType) -> true for a PDF (or other binary doc) by extension or content-type.
function isPdfLike(url, contentType) {
  if (/(application\/pdf|application\/msword|officedocument)/i.test(String(contentType || ''))) return true;
  return DOC_ASSET_RX.test(String(url || ''));
}

// classifyDoc(url) -> the coverage page-class this document would satisfy (reuses the crawl classifier so
// there is one page-class door). A generic legal doc maps to its class; anything else is 'other'.
function classifyDoc(url) {
  return classify({ url });
}

// readOneDocument(url, opts) -> the honest record for one document. Three distinct outcomes drive the
// coverage interlock, and they are NOT the same (path instruction 8 - absence vs observation):
//   - PARSED (HTML read to text): the obligation is assessed on real content.
//   - UNREAD (fetched:true but unparseable PDF/binary/empty, OR a fetch that timed out / errored / hit a
//     5xx/403/429): we FOUND a policy document but could not read it, so it may hold the very disclosure
//     under test. An absence claim on its obligation MUST be demoted, never asserted (C-024/C-033). These
//     carry unread:true (or fetched&&!parsed) and their page-class flows into the interlock.
//   - GONE (a 404/410): the referenced document is DEFINITIVELY ABSENT (a broken link). There is no
//     unread content to hide a disclosure, so it demotes NOTHING - treating a broken link as an
//     "unreadable present document" would suppress a legitimate absence finding on every dead footer link.
// fetchDocument(url, opts) -> {res} on a settled fetch, or {err} on throw/timeout. Split out so the
// try/catch is its own unit and readOneDocument's own body is a flat dispatch.
async function fetchDocument(url, opts) {
  try { return { res: await withDeadline(() => opts.fetchFn(url), opts.deadlineMs, opts.timers) }; }
  catch (e) { return { err: e }; }
}
// Each distinct outcome readOneDocument can produce is its own named builder (FAIL-CLOSED: a fetch
// failure/timeout on a FOUND policy link is UNREAD content, logged AND returned unread:true; the lane
// continues, but the obligation whose evidence could sit in this unread document is demoted, never
// asserted absent). Splitting these out keeps readOneDocument itself under the health-gate Complex
// Method cap despite five distinct terminal shapes.
function fetchFailedResult(url, pageClass, err, opts) {
  opts.log('document-unreachable', url + ': ' + err.message);
  return { url, fetched: false, parsed: false, unread: true, reason: 'fetch-failed: ' + err.message, pageClass };
}
function unreachableResult(url, pageClass, res) {
  const status = Number(res && res.status) || 0;
  const gone = status === 404 || status === 410; // definitively absent -> demotes nothing
  return { url, fetched: false, parsed: false, unread: !gone, reason: gone ? 'not-found' : 'unreachable', status: status || null, pageClass };
}
function noParserResult(url, pageClass, res, opts) {
  opts.log('document-no-parser', url + ': fetched a PDF/binary policy document but there is no zero-dependency parser; recorded parsed:false (C-033 - obligations relying on this page-class demote to needs-review)');
  return { url, fetched: true, parsed: false, reason: 'no-parser', contentType: res.contentType || null, pageClass };
}
function parsedOrEmptyResult(url, pageClass, res) {
  const text = stripHtml(res.body);
  if (text.length < 40) return { url, fetched: true, parsed: false, reason: 'empty-after-strip', pageClass };
  return { url, fetched: true, parsed: true, text, pageClass };
}
async function readOneDocument(url, opts) {
  const pageClass = classifyDoc(url);
  const { res, err } = await fetchDocument(url, opts);
  if (err) return fetchFailedResult(url, pageClass, err, opts);
  if (!res || !res.ok) return unreachableResult(url, pageClass, res);
  if (!res.body) return { url, fetched: true, parsed: false, unread: true, reason: 'empty-body', pageClass };
  if (isPdfLike(url, res.contentType)) return noParserResult(url, pageClass, res, opts);
  return parsedOrEmptyResult(url, pageClass, res);
}

// collectDocuments(footerLinks, opts) -> { documents, unparsed, unparsedClasses, notes }. Every fetched-
// but-unparsed document contributes its page-class to `unparsedClasses`, the set the coverage contract
// consumes for the absence-demotion interlock. Pure over its injected effects; never throws.
// boundedBudget(value, floor, def) -> value when it is finite and at/above floor, else def. Budgets are
// CAPS honoured EXACTLY (Rule 8): an explicit 0 means "do nothing", never coalesced by `||` into a
// default; nullish/negative/NaN falls back. Shared by collectDocuments' two budget fields.
function boundedBudget(value, floor, def) {
  return Number.isFinite(value) && value >= floor ? value : def;
}
// collectDocumentTargets(footerLinks, maxDocs) -> deduped, capped policy-doc URLs in link order. Split
// out of collectDocuments so the accumulation loop is its own single-purpose unit.
function collectDocumentTargets(footerLinks, maxDocs) {
  const seen = new Set();
  const targets = [];
  for (const link of footerLinks || []) {
    if (targets.length >= maxDocs) break; // checked BEFORE adding so maxDocs:0 follows zero documents
    if (!isPolicyDocLink(link)) continue;
    const key = String(link).split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(key);
  }
  return targets;
}
// isUnreadOrUnparsed(d) -> the demotion set: every document FOUND but not readably parsed (PDF/empty) OR
// unread (timeout/transport error/5xx/403/empty-body). A 404/410 (unread:false, fetched:false) is a
// broken link that demotes nothing. Named so the compound test is not inline in the filter callback.
function isUnreadOrUnparsed(d) {
  return (d.fetched && !d.parsed) || d.unread === true;
}
async function collectDocuments(footerLinks, opts = {}) {
  const notes = [];
  const log = typeof opts.log === 'function' ? opts.log : (kind, msg) => notes.push({ kind, msg });
  const fetchFn = opts.fetchFn;
  if (typeof fetchFn !== 'function') return { documents: [], unparsed: [], unparsedClasses: new Set(), notes };
  const deadlineMs = boundedBudget(opts.deadlineMs, 0, 15000);
  const maxDocs = boundedBudget(opts.maxDocs, 0, DEFAULT_MAX_DOCS);
  const inner = { fetchFn, deadlineMs, timers: opts.timers, log };
  const targets = collectDocumentTargets(footerLinks, maxDocs);
  const documents = await Promise.all(targets.map((u) => readOneDocument(u, inner)));
  // 'other'-class pages carry no obligation, so they never demote.
  const unparsed = documents.filter(isUnreadOrUnparsed);
  const unparsedClasses = new Set(unparsed.map((d) => d.pageClass).filter((c) => c && c !== 'other'));
  return { documents, unparsed, unparsedClasses, notes };
}

module.exports = { collectDocuments, isPolicyDocLink, isPdfLike, classifyDoc, readOneDocument };
