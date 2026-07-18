'use strict';
// documents.test.js - the honest footer-document lane (caution.md C-033).
//
// The load-bearing proof is the NO-PARSER INTERLOCK: a footer-linked PDF that cannot be parsed with a
// zero-dependency route is recorded LOUDLY as {fetched:true, parsed:false, reason:'no-parser'} and its
// page-class flows into `unparsedClasses`, so the coverage contract DEMOTES any obligation that relied on
// it to needs-review (screened) instead of asserting an absence on a page nobody could read.

const test = require('node:test');
const assert = require('node:assert');

const { collectDocuments, readOneDocument, isPolicyDocLink, isPdfLike, classifyDoc } = require('./documents.js');
const { crawl } = require('../crawler/crawl.js');

// docFetch(map) -> a fetchFn serving { body, contentType?, status? } per url; 404 otherwise.
function docFetch(map) {
  return (url) => {
    const e = map[url];
    if (!e) return Promise.resolve({ ok: false, status: 404, body: '', finalUrl: url });
    return Promise.resolve({ ok: true, status: e.status || 200, body: e.body, finalUrl: url, contentType: e.contentType });
  };
}

test('a PDF policy document is recorded parsed:false reason:no-parser and logged LOUDLY (C-033)', async () => {
  const url = 'https://x.example/privacy-policy.pdf';
  const logs = [];
  const fetchFn = docFetch({ [url]: { body: '%PDF-1.4 not-plain-text', contentType: 'application/pdf' } });
  const out = await collectDocuments([url], { fetchFn, log: (kind, msg) => logs.push({ kind, msg }) });

  assert.equal(out.documents.length, 1);
  const rec = out.documents[0];
  assert.deepEqual(
    { url: rec.url, fetched: rec.fetched, parsed: rec.parsed, reason: rec.reason, pageClass: rec.pageClass },
    { url, fetched: true, parsed: false, reason: 'no-parser', pageClass: 'privacy' },
  );
  assert.ok(out.unparsed.includes(rec));
  assert.ok(out.unparsedClasses.has('privacy'), 'the PDF page-class feeds the coverage interlock');
  assert.ok(logs.some((l) => l.kind === 'document-no-parser'), 'an unparsed PDF must be recorded loudly, never silently');
});

test('an HTML policy document IS parsed (it has a zero-dependency route via the stripper)', async () => {
  const url = 'https://x.example/complaints';
  const fetchFn = docFetch({ [url]: { body: '<html><body><h1>Complaints</h1><p>Our complaints procedure explains how to raise a concern and escalate to the ombudsman if unresolved.</p></body></html>', contentType: 'text/html' } });
  const rec = await readOneDocument(url, { fetchFn, deadlineMs: 1000 });
  assert.equal(rec.parsed, true);
  assert.equal(rec.fetched, true);
  assert.ok(/complaints procedure/i.test(rec.text));
  assert.ok(!/<h1>/.test(rec.text), 'the document text is stripped, not raw HTML');
});

test('an UNREACHABLE (timed-out/errored) document is UNREAD content and DEMOTES its obligation (fail-closed, path instruction 8)', async () => {
  const url = 'https://x.example/terms.pdf';
  const fetchFn = () => Promise.reject(new Error('connect ETIMEDOUT'));
  const out = await collectDocuments([url], { fetchFn, log: () => {} });
  assert.equal(out.documents[0].fetched, false);
  assert.equal(out.documents[0].unread, true, 'a found-but-unreadable policy link is unread content');
  assert.match(out.documents[0].reason, /fetch-failed/);
  assert.ok(out.unparsedClasses.has('terms'), 'unread content must demote the absence claim, never let it stand');
});

test('a 404 policy link is a DEFINITIVELY ABSENT document (broken link): fetched:false, unread:false, demotes NOTHING', async () => {
  const url = 'https://x.example/terms.pdf';
  const fetchFn = () => Promise.resolve({ ok: false, status: 404, body: '', finalUrl: url });
  const out = await collectDocuments([url], { fetchFn, log: () => {} });
  assert.equal(out.documents[0].fetched, false, 'a 404 is not a fetched document');
  assert.equal(out.documents[0].unread, false, 'a 404 is not unread PRESENT content; there is nothing to read');
  assert.equal(out.documents[0].reason, 'not-found');
  assert.equal(out.unparsedClasses.size, 0, 'a broken footer link must not screen a legitimate absence finding');
});

test('a 5xx/403 policy link is UNREAD (a document that may exist but we could not read) and DEMOTES', async () => {
  const url = 'https://x.example/terms.pdf';
  const fetchFn = () => Promise.resolve({ ok: false, status: 503, body: '', finalUrl: url });
  const out = await collectDocuments([url], { fetchFn, log: () => {} });
  assert.equal(out.documents[0].unread, true);
  assert.equal(out.documents[0].reason, 'unreachable');
  assert.ok(out.unparsedClasses.has('terms'), 'a server error on a found policy link is unread content -> demote');
});

test('document budgets are hard caps: an explicit maxDocs:0 follows ZERO documents (0 is not coalesced to the default)', async () => {
  const links = ['https://x.example/privacy-policy.pdf', 'https://x.example/terms.pdf'];
  const fetchFn = docFetch({});
  const out = await collectDocuments(links, { fetchFn, log: () => {}, maxDocs: 0 });
  assert.equal(out.documents.length, 0, 'maxDocs:0 means follow nothing, never fall back to the 12 default');
});

test('collectDocuments follows only policy/document links, dedupes, and honours maxDocs', async () => {
  const links = [
    'https://x.example/privacy-policy.pdf',
    'https://x.example/privacy-policy.pdf#frag', // same doc, deduped
    'https://x.example/about',                    // not a policy/doc link -> ignored
    'https://x.example/cookies',                  // policy-named -> followed
    'https://x.example/terms.pdf',
  ];
  const fetchFn = docFetch({
    'https://x.example/privacy-policy.pdf': { body: '%PDF-1.4', contentType: 'application/pdf' },
    'https://x.example/cookies': { body: '<html><body><p>Cookie policy text long enough to parse into real content here.</p></body></html>', contentType: 'text/html' },
    'https://x.example/terms.pdf': { body: '%PDF-1.4', contentType: 'application/pdf' },
  });
  const out = await collectDocuments(links, { fetchFn, log: () => {}, maxDocs: 2 });
  assert.equal(out.documents.length, 2, 'maxDocs caps the number of documents followed');
  assert.ok(!out.documents.some((d) => d.url.includes('/about')), 'a non-policy link is never followed');
});

test('classifier + predicates: policy links and PDF detection', () => {
  assert.equal(isPolicyDocLink('https://x.example/privacy.pdf'), true);
  assert.equal(isPolicyDocLink('https://x.example/menu.pdf'), true, 'any document asset is worth reading');
  assert.equal(isPolicyDocLink('https://x.example/about'), false);
  assert.equal(isPolicyDocLink('mailto:hi@x.example'), false);
  assert.equal(isPdfLike('https://x.example/x.pdf', ''), true);
  assert.equal(isPdfLike('https://x.example/x', 'application/pdf'), true);
  assert.equal(isPdfLike('https://x.example/x', 'text/html'), false);
  assert.equal(classifyDoc('https://x.example/complaints-procedure'), 'complaints');
});

test('NO-PARSER INTERLOCK end to end: an unread footer PDF demotes the privacy obligation to needs-review', async () => {
  const home = [
    '<html><head><title>Doc Site Ltd</title></head><body>',
    '<h1>Doc Site</h1><p>We provide professional services to clients across the country every single day.</p>',
    '<footer>Doc Site Ltd, company number 09090909. <a href="/privacy-policy.pdf">Privacy policy</a></footer>',
    '</body></html>',
  ].join('');
  const fetchFn = docFetch({
    'https://docsite.example/': { body: home, contentType: 'text/html' },
    'https://docsite.example/privacy-policy.pdf': { body: '%PDF-1.4 binary policy bytes', contentType: 'application/pdf' },
  });
  const privacyRule = {
    id: 'PRIV-ABSENCE-1',
    website_obligations: [{ evidence_type: 'absence', duty: 'publish a privacy policy', elements: ['privacy policy'] }],
  };
  const bundle = await crawl('docsite.example', { fetchFn, now: () => 0, width: 1, deadlineMs: 5000, perPageMs: 5000, rules: [privacyRule] });

  // 0. The PDF is NOT crawled into the corpus as a pseudo-content page (its bytes must not cover a class).
  assert.ok(!bundle.corpus.pages.some((p) => p.url.endsWith('.pdf')), 'a document asset is never an HTML corpus page');

  // 1. The PDF is on the bundle, LOUD: fetched but unparsed with the no-parser reason.
  const pdf = bundle.documents.unparsed.find((d) => d.url.endsWith('/privacy-policy.pdf'));
  assert.ok(pdf, 'the footer PDF is recorded on the bundle');
  assert.equal(pdf.parsed, false);
  assert.equal(pdf.reason, 'no-parser');
  assert.ok(bundle.notes.some((n) => n.kind === 'document-no-parser'), 'the unread PDF is recorded loudly in the crawl notes');

  // 2. The privacy obligation is DEMOTED to needs-review (screened), not asserted as an absence breach.
  const rule = bundle.coverage.perRule.rules.find((r) => r.id === 'PRIV-ABSENCE-1');
  assert.equal(rule.state, 'screened', 'the obligation whose evidence sat in the unread PDF must be screened, never a breach');
  assert.match(rule.reason, /unparsed document|C-033/i);
});
