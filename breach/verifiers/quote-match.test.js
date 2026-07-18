'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const qm = require('./quote-match');
const { verifyCandidate, verifyAll, verifyQuote, normaliseWhitespace, CODES, runCalibration } = qm;

function pageBundle(pages) {
  return { corpus: { pages } };
}

const SRA_PAGE = {
  url: 'https://example-law-firm.example/about',
  title: 'About us',
  text: 'About our firm.\nWe are regulated by the Solicitors Regulation Authority,\nSRA number 500046. Contact us for more information.',
  jsonLd: [],
};

// ── normaliseWhitespace ──────────────────────────────────────────────────────────────────────────

test('normaliseWhitespace collapses any run of whitespace (spaces, tabs, newlines) to a single space, nothing else', () => {
  assert.equal(normaliseWhitespace('a  b'), 'a b');
  assert.equal(normaliseWhitespace('a\nb'), 'a b');
  assert.equal(normaliseWhitespace('a\t\n  b'), 'a b');
  assert.equal(normaliseWhitespace('ABC def'), 'ABC def', 'no case folding');
  assert.equal(normaliseWhitespace(null), '');
  assert.equal(normaliseWhitespace(undefined), '');
});

// ── verifyQuote: the required test list ──────────────────────────────────────────────────────────

test('exact-match passes: a verbatim quote on its declared visible_text surface is verified', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const r = verifyQuote({
    type: 'quote',
    page_url: SRA_PAGE.url,
    surface: 'visible_text',
    quote: 'We are regulated by the Solicitors Regulation Authority, SRA number 500046.',
  }, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.QUOTE_VERIFIED);
});

test('single-character drift REJECTED: one changed digit in the quote must not verify', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const r = verifyQuote({
    type: 'quote',
    page_url: SRA_PAGE.url,
    surface: 'visible_text',
    quote: 'We are regulated by the Solicitors Regulation Authority, SRA number 500047.',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_MISMATCH);
});

test('whitespace-run normalisation accepted: a quote authored with plain single spaces still matches text whose whitespace runs came out as mixed tabs/multiple-newlines from HTML block-boundary stripping', () => {
  const messyPage = {
    url: 'https://example.com/complaints',
    title: 'Complaints',
    // extract.js turns </p>, </li>, <br> etc. into newlines and collapses tag gaps to spaces, so real
    // stripped text routinely carries runs like "\n\n\t " between words that a proposer's clean,
    // single-line quote never reproduces literally.
    text: 'If you are unhappy with our service,\n\n\t  you may complain in writing   to the Legal Ombudsman.',
    jsonLd: [],
  };
  const bundle = pageBundle([messyPage]);
  const r = verifyQuote({
    type: 'quote',
    page_url: messyPage.url,
    surface: 'visible_text',
    quote: 'you may complain in writing to the Legal Ombudsman.',
  }, bundle);
  assert.equal(r.verified, true, 'differing only in whitespace-run shape, the one documented normalisation must accept this');
  assert.equal(r.code, CODES.QUOTE_VERIFIED);
});

test('wrong-page quote REJECTED: the quote text is real but cited against a page that does not contain it', () => {
  const otherPage = { url: 'https://example-law-firm.example/contact', title: 'Contact', text: 'Call us on 0123 456789.', jsonLd: [] };
  const bundle = pageBundle([SRA_PAGE, otherPage]);
  const r = verifyQuote({
    type: 'quote',
    page_url: otherPage.url,
    surface: 'visible_text',
    quote: 'We are regulated by the Solicitors Regulation Authority, SRA number 500046.',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_MISMATCH);
});

test('a page_url absent from the bundle entirely is rejected as page-not-found (distinct from wrong-page mismatch)', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const r = verifyQuote({
    type: 'quote',
    page_url: 'https://example-law-firm.example/does-not-exist',
    surface: 'visible_text',
    quote: 'anything',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_PAGE_NOT_FOUND);
});

test('wrong-surface quote REJECTED: the quote sits in raw HTML (e.g. inside a script) but is declared against visible_text, where stripping removed it', () => {
  const page = {
    url: 'https://example.com/',
    title: 'Home',
    // The stripped visible text never mentions the tracking id: it lived only inside a <script> tag
    // that extract.js's stripHtml() (evidence/crawler/extract.js) removes before this text is built.
    text: 'Welcome to our site. Contact us for a quote.',
    rawHtml: '<html><body><p>Welcome to our site.</p><script>var trackingId = "UA-DRIFT-SURFACE-1";</script></body></html>',
    jsonLd: [],
  };
  const bundle = pageBundle([page]);
  const r = verifyQuote({
    type: 'quote',
    page_url: page.url,
    surface: 'visible_text',
    quote: 'var trackingId = "UA-DRIFT-SURFACE-1";',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_MISMATCH, 'the quote is real on raw_html but the DECLARED surface (visible_text) genuinely lacks it (C-035)');

  // The same quote against the SAME page, declared on the correct surface, verifies.
  const correctSurface = verifyQuote({
    type: 'quote',
    page_url: page.url,
    surface: 'raw_html',
    quote: 'var trackingId = "UA-DRIFT-SURFACE-1";',
  }, bundle);
  assert.equal(correctSurface.verified, true);
  assert.equal(correctSurface.code, CODES.QUOTE_VERIFIED);
});

test('raw_html declared but the bundle page carries no rawHtml field: honestly unverifiable, never falls back to visible_text', () => {
  const bundle = pageBundle([SRA_PAGE]); // SRA_PAGE has no rawHtml field
  const r = verifyQuote({
    type: 'quote',
    page_url: SRA_PAGE.url,
    surface: 'raw_html',
    quote: 'SRA number 500046',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_SURFACE_UNAVAILABLE);
});

test('missing fields and an invalid surface value are all rejected before any bundle lookup', () => {
  const bundle = pageBundle([SRA_PAGE]);
  assert.equal(verifyQuote({ type: 'quote', surface: 'visible_text', quote: 'x' }, bundle).code, CODES.QUOTE_MISSING_FIELDS);
  assert.equal(verifyQuote({ type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text' }, bundle).code, CODES.QUOTE_MISSING_FIELDS);
  assert.equal(
    verifyQuote({ type: 'quote', page_url: SRA_PAGE.url, surface: 'rendered_dom', quote: 'x' }, bundle).code,
    CODES.QUOTE_INVALID_SURFACE
  );
});

test('a whitespace-only quote is rejected rather than trivially matching almost any page', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const r = verifyQuote({ type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text', quote: '   \n\t  ' }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_MISSING_FIELDS);
});

// ── verifyCandidate: the fail-closed dispatcher ──────────────────────────────────────────────────

test('verifyCandidate dispatches a quote artifact to verifyQuote', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const candidate = {
    rule_id: 'SRA_AUTHORISATION_DISCLOSURE',
    artifact: { type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text', quote: 'SRA number 500046' },
  };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.QUOTE_VERIFIED);
});

test('an unknown artifact type is REJECTED, never passed through (fail closed on the unrecognised)', () => {
  const candidate = { rule_id: 'X', artifact: { type: 'dom_node', selector: '.some-broken-thing' } };
  const r = verifyCandidate(candidate, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.UNKNOWN_ARTIFACT_TYPE);
});

test('a candidate with no artifact at all is rejected (Rule 3: no artifact, no breach)', () => {
  const r = verifyCandidate({ rule_id: 'X' }, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.MISSING_ARTIFACT);
});

test('a non-object candidate (null, a string, a number) is rejected rather than throwing', () => {
  for (const bad of [null, undefined, 'not-an-object', 42]) {
    const r = verifyCandidate(bad, {});
    assert.equal(r.verified, false);
    assert.equal(r.code, CODES.INVALID_CANDIDATE);
  }
});

test('fabricated network event REJECTED via the full verifyCandidate dispatch path', () => {
  const bundle = { browser: { observed: [], consentControl: { found: false, healthy: null, url: null }, lane: { ran: true, reason: null } } };
  const candidate = {
    rule_id: 'PECR_PRE_CONSENT_TRACKING',
    artifact: { type: 'network_event', kind: 'tracker_request_pre_consent', host: 'never-observed.example', name: 'never-observed.example' },
  };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.NETWORK_EVENT_NOT_FOUND);
});

test('absence claim without coverage_proof pages REJECTED via the full verifyCandidate dispatch path', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const candidate = { rule_id: 'COMPLAINTS_PROCEDURE_DISCLOSURE', artifact: { type: 'coverage_proof', page_class: 'complaints' } };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.COVERAGE_PROOF_NO_PAGES);
});

test('register_absence dispatches to verifyRegisterAbsence: a definitive no_match verifies via the full path', () => {
  const note = { register: 'sra', kind: 'no_match', reason: 'no name match', detail: null };
  const bundle = { registers: { notes: [note] } };
  const candidate = { rule_id: 'SRA_AUTHORISATION', artifact: { type: 'register_absence', register: 'sra', lane: 'no_match', note } };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_VERIFIED);
});

test('register_absence behind a degraded (non-run) lane is REJECTED via the full dispatch path (C-004)', () => {
  const note = { register: 'sra', kind: 'degraded', reason: 'missing api key', detail: null };
  const bundle = { registers: { notes: [note] } };
  const candidate = { rule_id: 'SRA_AUTHORISATION', artifact: { type: 'register_absence', register: 'sra', lane: 'no_match', note } };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

// ── real-proposer shape compatibility (breach/proposers/propose.js, confirmed by direct integration
//    probing against the landed module): propose.js's evalPresenceBreach emits a quote artifact as
//    {type:'quote', text, surface} with page_url on the CANDIDATE, not the artifact. This fixture is
//    a hermetic, hand-built copy of that exact shape (it does not require breach/proposers/, so this
//    test cannot break if that module's internals change; it locks the CONTRACT, not the dependency).
const REAL_PROPOSER_SHAPED_CANDIDATE = {
  record_id: 'TEST_PROHIBITED_CLAIM',
  duty_idx: 0,
  evidence_type: 'absence',
  kind: 'presence-breach',
  artifact: { type: 'quote', text: 'We offer guaranteed results for all treatments, every time.', surface: 'visible_text' },
  page_url: 'https://example.com/results',
  confidence_hint: 'strong',
  suppressed_reason: null,
};

test('verifyCandidate accepts the real breach/proposers/propose.js quote shape: page_url on the candidate, quote text under artifact.text', () => {
  const bundle = pageBundle([{
    url: 'https://example.com/results',
    title: 'Results',
    text: 'Our patients love us. We offer guaranteed results for all treatments, every time.',
    jsonLd: [],
  }]);
  const r = verifyCandidate(REAL_PROPOSER_SHAPED_CANDIDATE, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.QUOTE_VERIFIED);
});

test('the real-proposer-shape fallback still rejects a drifted quote under artifact.text, exactly as it would under artifact.quote', () => {
  const bundle = pageBundle([{
    url: 'https://example.com/results',
    title: 'Results',
    text: 'Our patients love us. We offer guaranteed results for all treatments, every time.',
    jsonLd: [],
  }]);
  const drifted = {
    ...REAL_PROPOSER_SHAPED_CANDIDATE,
    artifact: { type: 'quote', text: 'We offer guaranteed results for all treatments, every day.', surface: 'visible_text' },
  };
  const r = verifyCandidate(drifted, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.QUOTE_MISMATCH);
});

test('an artifact-level page_url or quote, when present, always wins over the candidate/text fallback (the originally-specified shape still works unchanged)', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const candidate = {
    page_url: 'https://example.com/some-other-page', // a decoy the resolver must NOT use
    artifact: {
      type: 'quote',
      page_url: SRA_PAGE.url,          // artifact-level page_url present -> must win
      quote: 'SRA number 500046',       // artifact-level quote present -> must win
      text: 'IGNORE ME - this is the fallback field and must not be read when quote is present',
      surface: 'visible_text',
    },
  };
  const r = verifyCandidate(candidate, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.QUOTE_VERIFIED);
});

test('resolveQuoteArtifact leaves non-quote artifacts completely untouched', () => {
  const untouched = { type: 'register_row', register: 'sra', row: { a: 1 } };
  assert.equal(qm.resolveQuoteArtifact({ page_url: 'x' }, untouched), untouched);
});

// ── verifyAll: the pure-filter aggregation ───────────────────────────────────────────────────────

test('verifyAll splits candidates into verified[] and rejected[], each entry carrying the original candidate, code and reason', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const good = { rule_id: 'A', artifact: { type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text', quote: 'SRA number 500046' } };
  const bad = { rule_id: 'B', artifact: { type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text', quote: 'SRA number 999999' } };
  const unknown = { rule_id: 'C', artifact: { type: 'dom_node' } };
  const { verified, rejected } = verifyAll([good, bad, unknown], bundle);
  assert.equal(verified.length, 1);
  assert.equal(rejected.length, 2);
  assert.equal(verified[0].candidate, good, 'the ORIGINAL candidate reference is carried, not a copy');
  assert.equal(verified[0].code, CODES.QUOTE_VERIFIED);
  assert.ok(rejected.some((r) => r.candidate === bad && r.code === CODES.QUOTE_MISMATCH));
  assert.ok(rejected.some((r) => r.candidate === unknown && r.code === CODES.UNKNOWN_ARTIFACT_TYPE));
});

test('verifyAll never creates, upgrades or edits a candidate: a frozen candidate survives verifyAll untouched', () => {
  const bundle = pageBundle([SRA_PAGE]);
  const candidate = Object.freeze({
    rule_id: 'A',
    artifact: Object.freeze({ type: 'quote', page_url: SRA_PAGE.url, surface: 'visible_text', quote: 'SRA number 500046' }),
  });
  assert.doesNotThrow(() => verifyAll([candidate], bundle), 'a pure filter never attempts to write to the candidate it is judging');
  const { verified } = verifyAll([candidate], bundle);
  assert.equal(verified[0].candidate, candidate);
});

test('verifyAll on a non-array input behaves as an empty candidate set rather than throwing', () => {
  const { verified, rejected } = verifyAll(null, {});
  assert.deepEqual(verified, []);
  assert.deepEqual(rejected, []);
});

// ── the earn-your-zero calibration wiring ────────────────────────────────────────────────────────

test('calibration fixtures: every p3-verifier-*.json fixture is caught and produces exactly one finding', () => {
  const fixturesDir = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
  const files = fs.readdirSync(fixturesDir).filter((f) => /^p3-verifier-.*\.json$/.test(f));
  assert.ok(files.length >= 1, 'at least the required p3-verifier-drifted-quote.json fixture must be present');
  assert.ok(files.includes('p3-verifier-drifted-quote.json'), 'the task-required drifted-quote fixture must exist');
  const findings = runCalibration(fixturesDir);
  assert.equal(findings.length, files.length, 'one refusal finding per fixture; zero findings means Gate 2 has not earned its zero');
});

test('the drifted-quote fixture specifically: verifyCandidate rejects it with code quote_mismatch', () => {
  const fixturesDir = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'p3-verifier-drifted-quote.json'), 'utf8'));
  const result = verifyCandidate(fixture.candidate, fixture.bundle);
  assert.equal(result.verified, false);
  assert.equal(result.code, CODES.QUOTE_MISMATCH);
});
