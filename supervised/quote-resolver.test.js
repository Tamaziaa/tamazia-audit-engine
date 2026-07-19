'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { verifyQuote } = require('./verify-quote.js');

function store() {
  return buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/privacy', text: 'We use cookies before you consent to them, which is a PECR problem.' }] } });
}

test('resolveQuoteSpan finds a real substring and the resulting span PASSES verify_quote', () => {
  const s = store();
  const span = resolveQuoteSpan(s, 'https://x.example/privacy', 'cookies before you consent');
  assert.ok(span);
  assert.strictEqual(verifyQuote(s, span), true);
});

test('resolveQuoteSpan returns null for a page that was never captured', () => {
  const s = store();
  assert.strictEqual(resolveQuoteSpan(s, 'https://x.example/nope', 'cookies'), null);
});

test('resolveQuoteSpan returns null when the text is not actually present (no fabricated span)', () => {
  const s = store();
  assert.strictEqual(resolveQuoteSpan(s, 'https://x.example/privacy', 'this sentence is not on the page at all'), null);
});

test('resolveQuoteSpan tolerates whitespace-run differences (same normalisation as capture-index.js)', () => {
  const s = store();
  const span = resolveQuoteSpan(s, 'https://x.example/privacy', 'cookies   before\nyou consent');
  assert.ok(span);
  assert.strictEqual(verifyQuote(s, span), true);
});
