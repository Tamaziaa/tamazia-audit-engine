'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { verifyQuote, verify_quote, verifyQuoteDetailed, REFUSAL_REASONS } = require('./verify-quote.js');

function storeWithOnePage(text) {
  return buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/', text }] } });
}

// A real Quote is built the ONE way this repo allows (quote-resolver.js's resolveQuoteSpan - see its own
// header: "the ONLY place a candidate's quote text is converted into a byte range"), so it carries a
// genuine span_sha256 alongside the byte range, exactly as every Quote produced by createFinding() must
// (finding.js's validateQuote makes span_sha256 mandatory, not optional).
test('verify_quote PASSES for a real byte range sliced out of a genuinely hashed artifact', () => {
  const store = storeWithOnePage('The quick brown fox jumps over the lazy dog.');
  const quote = resolveQuoteSpan(store, 'https://x.example/', 'brown fox');
  assert.strictEqual(verifyQuote(store, quote), true);
  assert.strictEqual(verify_quote(store, quote), true);
  const detail = verifyQuoteDetailed(store, quote);
  assert.strictEqual(detail.text, 'brown fox');
});

test('KNOWN-BAD CALIBRATION FIXTURE 1: a hand-fabricated finding pointing at an evidence_id that was NEVER captured must be REJECTED', () => {
  const store = storeWithOnePage('real captured text on a real page');
  const fabricated = { evidence_id: 'this-evidence-id-does-not-exist', byte_start: 0, byte_end: 5 };
  const result = verifyQuoteDetailed(store, fabricated);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REFUSAL_REASONS.NO_ARTIFACT);
  assert.strictEqual(verifyQuote(store, fabricated), false);
});

test('KNOWN-BAD CALIBRATION FIXTURE 2: a fake byte range far outside the real artifact length must be REJECTED', () => {
  const store = storeWithOnePage('short text');
  const artifact = store.list()[0];
  const fabricated = { evidence_id: artifact.evidence_id, byte_start: 0, byte_end: 999999 };
  const result = verifyQuoteDetailed(store, fabricated);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REFUSAL_REASONS.RANGE_OUT_OF_BOUNDS);
});

test('KNOWN-BAD CALIBRATION FIXTURE 3: a tampered artifact (byte flipped after capture) fails hash re-verification even with a valid-looking range', () => {
  const store = storeWithOnePage('a sentence that will be tampered with after capture');
  const artifact = store.list()[0];
  artifact.bytes[0] = artifact.bytes[0] ^ 0xff; // simulate corruption/tamper in-place
  const quote = { evidence_id: artifact.evidence_id, byte_start: 2, byte_end: 10 };
  const result = verifyQuoteDetailed(store, quote);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REFUSAL_REASONS.HASH_MISMATCH);
});

test('an inverted or zero-width range is rejected even against a real artifact', () => {
  const store = storeWithOnePage('some real text');
  const artifact = store.list()[0];
  assert.strictEqual(verifyQuote(store, { evidence_id: artifact.evidence_id, byte_start: 5, byte_end: 5 }), false);
  assert.strictEqual(verifyQuote(store, { evidence_id: artifact.evidence_id, byte_start: 8, byte_end: 3 }), false);
});

test('an artifact rehydrated with no bytes (hash-only manifest projection) fails closed, never assumed verified', () => {
  const store = { get: () => ({ evidence_id: 'e', sha256: 'deadbeef', length: 10 }) }; // no `bytes`
  const result = verifyQuoteDetailed(store, { evidence_id: 'e', byte_start: 0, byte_end: 5 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, REFUSAL_REASONS.NO_BYTES);
});

test('a malformed quote object (missing evidence_id) is rejected without throwing', () => {
  const store = storeWithOnePage('text');
  assert.strictEqual(verifyQuote(store, {}), false);
  assert.strictEqual(verifyQuote(store, null), false);
});
