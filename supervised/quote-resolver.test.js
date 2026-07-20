'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { verifyQuote } = require('./verify-quote.js');

function store() {
  return buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/privacy', text: 'We use cookies before you consent to them, which some visitors will find intrusive.' }] } });
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

// Kimi K3 R2 finding A1/#1 (live audit 2026-07-20): a candidate quote whose normalised span straddles an
// unpunctuated raw-text-run join is a PHANTOM sentence (two sibling DOM nodes concatenated with no source
// separator). resolveQuoteSpan is the one door that mints a span, so it must refuse the phantom here.
function phantomStore() {
  return buildCaptureIndex({ domain: 'x', corpus: { pages: [{
    url: 'https://x.example/pricing',
    text: 'Free VPS',
    rawHtml: '<span class="pill">Free</span><span class="pill">VPS</span>',
  }] } });
}

test('A1/#1 (THE PHANTOM-JOIN PROOF): a span crossing an unpunctuated raw-run join resolves to null, never a mintable span', () => {
  const s = phantomStore();
  // sanity: the artifact really did record an unpunctuated boundary inside "Free VPS".
  const artifact = s.list().find((a) => a.url === 'https://x.example/pricing');
  assert.ok(artifact.boundaries.some((b) => !b.punctuated && b.byteOffset > 0 && b.byteOffset < 8), 'fixture must carry an interior unpunctuated boundary');
  assert.strictEqual(resolveQuoteSpan(s, 'https://x.example/pricing', 'Free VPS'), null);
});

test('A1/#1: a span that does NOT cross the join (one side only) still resolves', () => {
  const s = phantomStore();
  const span = resolveQuoteSpan(s, 'https://x.example/pricing', 'Free');
  assert.ok(span);
  assert.strictEqual(verifyQuote(s, span), true);
});
