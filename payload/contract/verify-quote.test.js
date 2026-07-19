'use strict';
// payload/contract/verify-quote.test.js - proves verify_quote passes on a real (evidence, offset) triple
// and fails on a fabricated quote and on a one-byte-tampered evidence blob (Kimi WS0 PROOF standard).

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('./v1_2.js');
const { verifyQuote } = require('./verify-quote.js');

const BYTES = 'Welcome. Book your Botox today from £99. Contact us.';
const TARGET = 'Book your Botox today';
const START = BYTES.indexOf(TARGET);
const END = START + TARGET.length;

function record(bytes) {
  return v.EvidenceRecord({
    id: 'ev1', lane: 'static', url_final: 'https://clinic.example/', fetched_at: '2026-07-20T00:00:00Z',
    bytes_sha256: v.sha256Hex(bytes), content_type: 'text/html', status: v.evidenceStatusOK(),
  });
}

test('verify_quote PASSES on a real (evidence, offset) triple', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, text: TARGET });
  assert.equal(verifyQuote(store, quote), true);
});

test('verify_quote FAILS on a fabricated quote (declared text does not equal the byte slice)', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  const fabricated = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, text: 'We never store payment details' });
  assert.equal(verifyQuote(store, fabricated), false);
});

test('verify_quote FAILS on an unresolvable evidence_id and on out-of-bounds offsets', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  assert.equal(verifyQuote(store, v.Quote({ evidence_id: 'ghost', byte_start: 0, byte_end: 3 })), false);
  assert.equal(verifyQuote(store, v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: BYTES.length + 50 })), false);
});

test('verify_quote FAILS on a one-byte-tampered evidence blob (recomputed hash != recorded hash)', () => {
  // the record was hashed at fetch time over the ORIGINAL bytes; the store now holds a tampered blob.
  const tampered = BYTES.replace('£99', '£10');
  const store = new Map([['ev1', { bytes: tampered, record: record(BYTES) }]]);
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, text: TARGET });
  assert.equal(verifyQuote(store, quote), false);
});

test('verify_quote never throws on a malformed quote (unverifiable -> false, so fabrication cannot escape as an error)', () => {
  assert.equal(verifyQuote(new Map(), null), false);
  assert.equal(verifyQuote(new Map(), { evidence_id: '', byte_start: 0, byte_end: 1 }), false);
  assert.equal(verifyQuote(null, v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: 1 })), false);
});

test('verify_quote accepts a plain-object store and a bare-bytes entry, and checks the slice when no text is declared', () => {
  const store = { ev1: BYTES }; // plain object, bare bytes, no travelling record (no tamper anchor)
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END }); // no declared text
  assert.equal(verifyQuote(store, quote), true); // a non-empty in-bounds slice verifies
  assert.equal(verifyQuote(store, v.Quote({ evidence_id: 'ev1', byte_start: 3, byte_end: 3 })), false); // empty slice
});
