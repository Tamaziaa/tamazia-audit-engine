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
