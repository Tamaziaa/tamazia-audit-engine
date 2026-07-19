'use strict';
// supervised/verify-quote.js - THE anti-fake choke point (Kimi K3 round-3 spec section 3; mirrors
// KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md section 2's P0-2 "mint-time quote verification").
//
//   verify_quote(artifact_store, quote) -> bool
//
// PURE. Non-LLM. No I/O, no network, no clock. Recomputes the SHA-256 of the artifact's stored bytes
// (catches tampering: a byte flipped after capture fails here, not just a missing artifact), then slices
// the byte range out of THOSE bytes and confirms it decodes to real, non-empty text. A Quote never carries
// its own words (finding.js's validateQuote refuses a `quote_text`/`text` field outright), so "confirms the
// quoted text is present" here means exactly this: the byte range, once verified to live inside a genuinely
// hashed artifact, IS the quoted text by construction - there is no second string anywhere to compare
// against, which is precisely what makes fabrication impossible rather than merely improbable. A candidate
// finding can only ever point at bytes that were really captured; it is a type/reality error, not a policy
// choice, to point anywhere else.
//
// verifyQuote() is used in exactly two places, deliberately: breach/verifiers/quote-match.js's live-corpus
// substring check runs DURING the harness's stage-5 auto-verify (candidate proposal time, against the
// live, uncaptured-yet bundle); THIS module runs a second, independent, hash-anchored check at TWO later
// points - once when a candidate finding is constructed into a typed Finding (run-harness.js), and again,
// mandatorily, at the mint gate (mint-gate.js) immediately before persistence, re-run over the FINAL signed
// payload's findings. Two independent gates on two different evidence representations (live corpus string
// match vs hashed byte-range slice) is defence in depth: an escape from one class of bug does not imply an
// escape from the other.

// sha256Hex duplicated here (rather than imported from capture-index.js) so this module has ZERO
// dependency on the rest of the harness beyond node's own `crypto` - it must be callable from replay.js and
// from a future WS-Runtime unattended lane with the smallest possible import surface (the whole point of a
// choke point is that nothing else can quietly grow between it and the bytes it checks).
const crypto = require('crypto');
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// REFUSAL_REASONS: the closed set of reasons verifyQuoteDetailed() can report. Exported so mint-gate.js and
// the packet/lint layers can render a precise, honest refusal string instead of a bare boolean.
const REFUSAL_REASONS = Object.freeze({
  NO_ARTIFACT: 'no_artifact',                 // quote.evidence_id resolves to nothing in the store
  NO_BYTES: 'no_bytes',                       // the artifact record carries no bytes to check (a hash-only, rehydrated-from-manifest record)
  HASH_MISMATCH: 'hash_mismatch',             // the artifact's current bytes do not match its recorded sha256 (tamper/corruption)
  RANGE_OUT_OF_BOUNDS: 'range_out_of_bounds', // byte_start/byte_end fall outside [0, length]
  EMPTY_SLICE: 'empty_slice',                 // the sliced range decodes to whitespace-only or unreadable text
  MISSING_SPAN_HASH: 'missing_span_hash',     // the quote carries no span_sha256 commitment (unverifiable by construction)
  SPAN_HASH_MISMATCH: 'span_hash_mismatch',   // the bytes at the offsets do not hash to the quote's own span_sha256 (drifted/fabricated span)
});

// SPAN_HASH_RE: a span_sha256 must be a 64-char lowercase-hex commitment (the crypto.digest('hex') shape).
const SPAN_HASH_RE = /^[0-9a-f]{64}$/;

// isInBounds(quote, length) -> true when the byte range is well-ordered and fully inside [0, length].
function isInBounds(quote, length) {
  return Number.isInteger(quote.byte_start) && Number.isInteger(quote.byte_end)
    && quote.byte_start >= 0 && quote.byte_end > quote.byte_start && quote.byte_end <= length;
}

// verifyQuoteDetailed(store, quote) -> { ok, reason? }. The full-detail form; verifyQuote() below is the
// bool-only convenience wrapper the spec names literally.
//
// THE span_sha256 COMMITMENT (why a valid, in-bounds byte range is not enough): a byte range that merely
// LIVES inside a genuinely-hashed artifact is real bytes, but it is not proof the finding quotes the bytes
// it CLAIMS - a hand-fabricated finding can drift the offsets to point at innocuous text on the same
// captured page and still pass a bounds+integrity check (this hole was found by the Mint Gate v0 dress
// rehearsal). So a Quote carries span_sha256, a ONE-WAY hash of the exact bytes at [byte_start, byte_end)
// committed at construction (quote-resolver.js) - never the words themselves, so the "a Quote is never a
// raw string" rule (finding.js) still holds. verify_quote re-slices the CURRENT bytes and confirms they
// hash to that same commitment; a drifted or fabricated span no longer matches, so it is refused. A quote
// with NO span_sha256 is unverifiable by construction and refused (fail closed, Rule 4).
function verifyQuoteDetailed(store, quote) {
  if (!quote || typeof quote !== 'object' || typeof quote.evidence_id !== 'string' || !quote.evidence_id) {
    return { ok: false, reason: REFUSAL_REASONS.NO_ARTIFACT };
  }
  const artifact = store && typeof store.get === 'function' ? store.get(quote.evidence_id) : null;
  if (!artifact) return { ok: false, reason: REFUSAL_REASONS.NO_ARTIFACT };
  if (!Buffer.isBuffer(artifact.bytes)) return { ok: false, reason: REFUSAL_REASONS.NO_BYTES };
  const recomputed = sha256Hex(artifact.bytes);
  if (recomputed !== artifact.sha256) return { ok: false, reason: REFUSAL_REASONS.HASH_MISMATCH };
  if (!isInBounds(quote, artifact.bytes.length)) return { ok: false, reason: REFUSAL_REASONS.RANGE_OUT_OF_BOUNDS };
  const sliceBytes = artifact.bytes.subarray(quote.byte_start, quote.byte_end);
  const slice = sliceBytes.toString('utf8');
  if (!slice.trim()) return { ok: false, reason: REFUSAL_REASONS.EMPTY_SLICE };
  if (typeof quote.span_sha256 !== 'string' || !SPAN_HASH_RE.test(quote.span_sha256)) {
    return { ok: false, reason: REFUSAL_REASONS.MISSING_SPAN_HASH };
  }
  if (sha256Hex(sliceBytes) !== quote.span_sha256) {
    return { ok: false, reason: REFUSAL_REASONS.SPAN_HASH_MISMATCH };
  }
  return { ok: true, reason: null, text: slice };
}

// verify_quote(artifact_store, quote) -> bool. The spec's own exact function name/signature, kept as a
// named export alongside the idiomatic camelCase alias so a caller quoting the spec verbatim still works.
function verifyQuote(store, quote) {
  return verifyQuoteDetailed(store, quote).ok;
}

module.exports = { verifyQuote, verify_quote: verifyQuote, verifyQuoteDetailed, REFUSAL_REASONS };
