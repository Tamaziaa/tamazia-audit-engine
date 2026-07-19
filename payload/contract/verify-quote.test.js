'use strict';
// payload/contract/verify-quote.test.js - proves verify_quote passes on a real (evidence, offset, span)
// triple and fails on a fabricated quote, a one-byte-tampered evidence blob, a missing/wrong span
// commitment, and a lossy-UTF-8 decode collision (Kimi WS0 PROOF standard; CRITICAL-1 / O6 repro).

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('./v1_2.js');
const { verifyQuote, sha256Hex } = require('./verify-quote.js');

const BYTES = 'Welcome. Book your Botox today from £99. Contact us.';
const TARGET = 'Book your Botox today';
const START = BYTES.indexOf(TARGET);
const END = START + TARGET.length;
const SPAN_SHA = sha256Hex(Buffer.from(TARGET, 'utf8'));

function record(bytes) {
  return v.EvidenceRecord({
    id: 'ev1', lane: 'static', url_final: 'https://clinic.example/', fetched_at: '2026-07-20T00:00:00Z',
    bytes_sha256: v.sha256Hex(bytes), content_type: 'text/html', status: v.evidenceStatusOK(),
  });
}

test('verify_quote PASSES on a real (evidence, offset, span) triple', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, text: TARGET, span_sha256: SPAN_SHA });
  assert.equal(verifyQuote(store, quote), true);
});

test('verify_quote FAILS on a fabricated quote (declared text does not equal the byte slice)', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  // the Quote constructor itself refuses a span_sha256 that does not match the declared text's own bytes,
  // so a fabrication attempt is expressed as a plain object bypassing the constructor (the "hand-assembled
  // payload" the mint-time gate exists to catch).
  const fabricated = { evidence_id: 'ev1', byte_start: START, byte_end: END, text: 'We never store payment details', span_sha256: SPAN_SHA };
  assert.equal(verifyQuote(store, fabricated), false);
});

test('verify_quote FAILS on an unresolvable evidence_id and on out-of-bounds offsets', () => {
  const store = new Map([['ev1', { bytes: BYTES, record: record(BYTES) }]]);
  assert.equal(verifyQuote(store, v.Quote({ evidence_id: 'ghost', byte_start: 0, byte_end: 3, span_sha256: sha256Hex(BYTES.slice(0, 3)) })), false);
  assert.equal(verifyQuote(store, { evidence_id: 'ev1', byte_start: 0, byte_end: BYTES.length + 50, span_sha256: SPAN_SHA }), false);
});

test('verify_quote FAILS on a one-byte-tampered evidence blob (recomputed hash != recorded hash)', () => {
  // the record was hashed at fetch time over the ORIGINAL bytes; the store now holds a tampered blob.
  const tampered = BYTES.replace('£99', '£10');
  const store = new Map([['ev1', { bytes: tampered, record: record(BYTES) }]]);
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, text: TARGET, span_sha256: SPAN_SHA });
  assert.equal(verifyQuote(store, quote), false);
});

test('verify_quote never throws on a malformed quote (unverifiable -> false, so fabrication cannot escape as an error)', () => {
  assert.equal(verifyQuote(new Map(), null), false);
  assert.equal(verifyQuote(new Map(), { evidence_id: '', byte_start: 0, byte_end: 1, span_sha256: 'a'.repeat(64) }), false);
  assert.equal(verifyQuote(null, v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: 1, span_sha256: sha256Hex(BYTES.slice(0, 1)) })), false);
});

test('verify_quote accepts a plain-object store and a bare-bytes entry, checking span_sha256 when no text is declared', () => {
  const store = { ev1: BYTES }; // plain object, bare bytes, no travelling record (no tamper anchor)
  const slice = BYTES.slice(START, END);
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: START, byte_end: END, span_sha256: sha256Hex(slice) }); // no declared text
  assert.equal(verifyQuote(store, quote), true); // a span-committed, non-empty in-bounds slice verifies
  assert.equal(verifyQuote(store, v.Quote({ evidence_id: 'ev1', byte_start: 3, byte_end: 3, span_sha256: sha256Hex('') })), false); // empty slice
});

// ── CRITICAL-1 repro: a bare-bytes store, no declared text, no span commitment ─────────────────────────
// Before the fix: sliceMatches() degenerated to `slice.length > 0` when text was absent, so ANY in-bounds
// byte range over ANY real artifact verified as evidence for ANY claim. This is the exact trigger Kimi
// named: a hand-assembled Quote{evidence_id, byte_start, byte_end} with no span_sha256 verifying against a
// bare-bytes store.
test('CRITICAL-1: a hand-assembled quote with NO span_sha256 and NO declared text does not verify (was: any in-bounds slice verified)', () => {
  const store = new Map();
  store.set('ev1', '© 2024 Acme Ltd. We offer guaranteed returns on all investments, no risk ever.');
  const handAssembled = { evidence_id: 'ev1', byte_start: 0, byte_end: 14 }; // no text, no span_sha256
  assert.equal(verifyQuote(store, handAssembled), false);
});

test('CRITICAL-1: a quote with a WRONG span_sha256 (not computed over the actual slice) does not verify', () => {
  const store = new Map();
  store.set('ev1', '© 2024 Acme Ltd. We offer guaranteed returns on all investments, no risk ever.');
  const wrongSpan = { evidence_id: 'ev1', byte_start: 0, byte_end: 14, span_sha256: 'f'.repeat(64) };
  assert.equal(verifyQuote(store, wrongSpan), false);
});

test('the v1_2 Quote constructor itself refuses to build without a real span_sha256 (fail-closed)', () => {
  assert.throws(() => v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: 3 }), /span_sha256 is required/);
  assert.throws(() => v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: 3, span_sha256: 'not-hex' }), /span_sha256 is required/);
});

// ── O6 repro: lossy UTF-8 decode comparison ─────────────────────────────────────────────────────────────
// Before the fix: sliceMatches() decoded the byte slice with .toString('utf8') and string-compared it to
// quote.text. A slice that splits a multi-byte codepoint decodes to U+FFFD; a declared text ALSO containing
// U+FFFD then string-"equals" bytes that are not that text at all.
test('O6: a slice that splits a multi-byte UTF-8 character does not "match" a declared text via lossy U+FFFD decode', () => {
  const full = Buffer.from('Price: £100 guaranteed', 'utf8'); // £ is 2 bytes (0xC2 0xA3)
  const poundIdx = full.indexOf(Buffer.from('£', 'utf8'));
  const splitEnd = poundIdx + 1; // cuts the multi-byte £ in half -> decodes with U+FFFD
  const corruptSlice = full.slice(0, splitEnd).toString('utf8');
  assert.ok(corruptSlice.includes('�'), 'the corrupted slice must contain U+FFFD for this repro to be meaningful');

  const store = new Map();
  store.set('ev1', full);
  // an attacker declares text equal to how the corrupted slice DECODES (both contain U+FFFD)
  const quote = { evidence_id: 'ev1', byte_start: 0, byte_end: splitEnd, text: corruptSlice, span_sha256: sha256Hex(full.slice(0, splitEnd)) };
  assert.equal(verifyQuote(store, quote), false);
});

test('O6: a declared text containing the Unicode replacement character is never accepted as a match', () => {
  const store = new Map();
  store.set('ev1', Buffer.from('clean prose with no corruption', 'utf8'));
  const quote = { evidence_id: 'ev1', byte_start: 0, byte_end: 5, text: '�����', span_sha256: sha256Hex(Buffer.from('clean', 'utf8')) };
  assert.equal(verifyQuote(store, quote), false);
});
