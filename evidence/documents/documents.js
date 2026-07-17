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

// readOneDocument(url, opts) -> the honest record for one document. HTML is parsed to text; a PDF/binary
// is recorded {parsed:false, reason:'no-parser'} and logged loudly; an unreachable doc is {fetched:false}.
async function readOneDocument(url, opts) {
  const pageClass = classifyDoc(url);
  let res;
  try { res = await withDeadline(() => opts.fetchFn(url), opts.deadlineMs, opts.timers); }
  catch (e) { opts.log('document-unreachable', url + ': ' + e.message); return { url, fetched: false, parsed: false, reason: 'fetch-failed: ' + e.message, pageClass }; }
  if (!res || !res.ok || !res.body) return { url, fetched: Boolean(res && res.status), parsed: false, reason: 'unreachable-or-empty', pageClass };
  if (isPdfLike(url, res.contentType)) {
    opts.log('document-no-parser', url + ': fetched a PDF/binary policy document but there is no zero-dependency parser; recorded parsed:false (C-033 - obligations relying on this page-class demote to needs-review)');
    return { url, fetched: true, parsed: false, reason: 'no-parser', contentType: res.contentType || null, pageClass };
  }
  const text = stripHtml(res.body);
  if (text.length < 40) return { url, fetched: true, parsed: false, reason: 'empty-after-strip', pageClass };
  return { url, fetched: true, parsed: true, text, pageClass };
}

// collectDocuments(footerLinks, opts) -> { documents, unparsed, unparsedClasses, notes }. Every fetched-
// but-unparsed document contributes its page-class to `unparsedClasses`, the set the coverage contract
// consumes for the absence-demotion interlock. Pure over its injected effects; never throws.
async function collectDocuments(footerLinks, opts = {}) {
  const notes = [];
  const log = typeof opts.log === 'function' ? opts.log : (kind, msg) => notes.push({ kind, msg });
  const fetchFn = opts.fetchFn;
  if (typeof fetchFn !== 'function') return { documents: [], unparsed: [], unparsedClasses: new Set(), notes };
  const inner = { fetchFn, deadlineMs: opts.deadlineMs || 15000, timers: opts.timers, log };
  const seen = new Set();
  const targets = [];
  for (const link of footerLinks || []) {
    if (!isPolicyDocLink(link)) continue;
    const key = String(link).split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(key);
    if (targets.length >= (opts.maxDocs || DEFAULT_MAX_DOCS)) break;
  }
  const documents = await Promise.all(targets.map((u) => readOneDocument(u, inner)));
  const unparsed = documents.filter((d) => d.fetched && !d.parsed);
  const unparsedClasses = new Set(unparsed.map((d) => d.pageClass).filter((c) => c && c !== 'other'));
  return { documents, unparsed, unparsedClasses, notes };
}

module.exports = { collectDocuments, isPolicyDocLink, isPdfLike, classifyDoc, readOneDocument };
