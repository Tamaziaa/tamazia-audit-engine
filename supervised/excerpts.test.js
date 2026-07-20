'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { buildExcerpts, excerptFor } = require('./excerpts.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');

function storeAndSpan() {
  const longText = 'A'.repeat(500) + ' THE QUOTED PART ' + 'B'.repeat(500);
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: longText }] } });
  const span = resolveQuoteSpan(store, 'https://x/', 'THE QUOTED PART');
  return { store, span };
}

test('excerptFor returns a bounded window, never the whole artifact', () => {
  const { store, span } = storeAndSpan();
  const excerpt = excerptFor(store, span);
  assert.ok(excerpt.quote_text.includes('THE QUOTED PART'));
  assert.ok(excerpt.before.length <= 240);
  assert.ok(excerpt.after.length <= 240);
  assert.ok(excerpt.before.length < 500); // strictly smaller than the full 500-char padding either side
});

test('excerptFor returns null for an unresolvable evidence_id (never fabricates a window)', () => {
  const { store } = storeAndSpan();
  assert.strictEqual(excerptFor(store, { evidence_id: 'missing', byte_start: 0, byte_end: 5 }), null);
});

test('buildExcerpts builds one excerpt per finding whose artifact is available, keyed by finding_id', () => {
  const { store, span } = storeAndSpan();
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const excerpts = buildExcerpts(store, [finding]);
  assert.strictEqual(excerpts.length, 1);
  assert.strictEqual(excerpts[0].finding_id, finding.finding_id);
});

// ── resolveSpanText (Kimi K3 render-debug §2) ──────────────────────────────────────────────────────
const { resolveSpanText } = require('./excerpts.js');

test('resolveSpanText: verified quote-kind finding returns sha-checked, non-truncated text', () => {
  const { store, span } = storeAndSpan();
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const r = resolveSpanText(store, finding, {});
  assert.ok(r.quote.includes('THE QUOTED PART'));
  assert.strictEqual(r.sha256, span.span_sha256);
  assert.strictEqual(r.truncated, false);
});

test('resolveSpanText: truncates at maxLen and flags it explicitly', () => {
  const longText = 'Q'.repeat(1000);
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: longText }] } });
  const span = resolveQuoteSpan(store, 'https://x/', 'Q'.repeat(600));
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const r = resolveSpanText(store, finding, { maxLen: 50 });
  assert.strictEqual(r.quote.length, 50);
  assert.strictEqual(r.truncated, true);
});

test('resolveSpanText: returns no quote on a drifted/mismatched span (never fabricates)', () => {
  const { store, span } = storeAndSpan();
  const drifted = Object.assign({}, span, { span_sha256: '0'.repeat(64) });
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: drifted, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const r = resolveSpanText(store, finding, {});
  assert.strictEqual(r.quote, null);
});

test('resolveSpanText: absence finding never carries a quote and lists real checked_urls', () => {
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/privacy', text: 'no statement here' }] } });
  const { buildCoverageArtifact } = require('./coverage-proof.js');
  const candidateArtifact = { type: 'coverage_proof', page_class: 'privacy', surface: 'text', searched_patterns: ['modern slavery'], pages_checked: ['https://x/privacy'] };
  const artifact = buildCoverageArtifact({ candidateArtifact, captureIndex: store, fetchedAt: '2026-01-01T00:00:00.000Z' });
  store.addDerived(artifact);
  const line = JSON.parse(artifact.bytes.toString('utf8'));
  const finding = createFinding({
    rule_id: 'UK_MSA', catalogue_hash: 'h', jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN,
    evidence_kind: 'coverage_proof',
    quote: { evidence_id: artifact.evidence_id, byte_start: 0, byte_end: artifact.length, span_sha256: artifact.sha256 },
    coverage: line,
  });
  const r = resolveSpanText(store, finding, {});
  assert.strictEqual(r.quote, null);
  assert.deepStrictEqual(r.checkedUrls, ['https://x/privacy']);
});

// ── run-time persistence (Kimi §2 invariant #1): resolveSpanText populates checked_urls for a presence
// quote (page found on), and readEvidence prefers persisted fields over a live store ──────────────────
const { evidenceFieldsFor, readEvidence } = require('./excerpts.js');

test('resolveSpanText: a presence quote carries checked_urls = the page it was found on', () => {
  const { store, span } = storeAndSpan();
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const r = resolveSpanText(store, finding, {});
  assert.deepStrictEqual(r.checkedUrls, ['https://x/']);
});

test('evidenceFieldsFor: shapes the persist-at-run-time projection', () => {
  const { store, span } = storeAndSpan();
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  const fields = evidenceFieldsFor(store, finding);
  assert.ok(fields.evidence_quote.includes('THE QUOTED PART'));
  assert.strictEqual(fields.evidence_sha256, span.span_sha256);
  assert.deepStrictEqual(fields.checked_urls, ['https://x/']);
});

test('readEvidence: prefers PERSISTED evidence and needs NO live store (the separate-process gap)', () => {
  // A manifest record shape (persisted at run time) - note NO artifact store available in this process.
  const record = { finding_id: 'f1', evidence_kind: 'quote', evidence_quote: 'PERSISTED VERBATIM TEXT', evidence_sha256: 'a'.repeat(64), checked_urls: ['https://x/pricing'] };
  const r = readEvidence(null, record, {});
  assert.strictEqual(r.quote, 'PERSISTED VERBATIM TEXT');
  assert.deepStrictEqual(r.checkedUrls, ['https://x/pricing']);
});

test('readEvidence: an absence record persists null quote but real checked_urls (never empty)', () => {
  const record = { finding_id: 'f2', evidence_kind: 'coverage_proof', evidence_quote: null, evidence_sha256: null, checked_urls: ['https://x/privacy', 'https://x/terms'] };
  const r = readEvidence(null, record, {});
  assert.strictEqual(r.quote, null);
  assert.deepStrictEqual(r.checkedUrls, ['https://x/privacy', 'https://x/terms']);
});
