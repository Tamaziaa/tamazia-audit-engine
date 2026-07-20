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
  CORRUPT_SLICE: 'corrupt_slice',             // the sliced range decodes with a U+FFFD replacement char (a span split mid-multibyte-character - a mojibake "quote")
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
// resolveArtifact(store, quote) -> {ok, reason, artifact}. Steps 1-2 of the choke point: the quote must
// name a real evidence_id, and that id must resolve to an actual captured record in the store.
function resolveArtifact(store, quote) {
  const hasEvidenceId = quote && typeof quote === 'object' && typeof quote.evidence_id === 'string' && quote.evidence_id;
  if (!hasEvidenceId) return { ok: false, reason: REFUSAL_REASONS.NO_ARTIFACT, artifact: null };
  const artifact = store && typeof store.get === 'function' ? store.get(quote.evidence_id) : null;
  if (!artifact) return { ok: false, reason: REFUSAL_REASONS.NO_ARTIFACT, artifact: null };
  return { ok: true, reason: null, artifact };
}

// verifyArtifactIntegrity(artifact) -> {ok, reason}. Step 3: the artifact must carry real bytes, and
// those bytes must still hash to the sha256 recorded at capture time (catches tamper/corruption).
//
// Kimi K3 R2 finding #40 (live audit 2026-07-20): the mint gate re-runs verify_quote over every finding,
// and multiple findings often cite the SAME artifact, so the full-bytes sha256 was recomputed N times per
// artifact per run. A module-level WeakMap memoises the integrity RESULT keyed on the artifact object
// itself; captured artifacts are frozen (capture-index.js), so the (bytes, sha256) pair a key commits to
// cannot drift under the cache. The WeakMap never keeps an artifact alive past its own lifetime.
const INTEGRITY_CACHE = new WeakMap();
function verifyArtifactIntegrity(artifact) {
  if (artifact && typeof artifact === 'object' && INTEGRITY_CACHE.has(artifact)) return INTEGRITY_CACHE.get(artifact);
  let result;
  if (!Buffer.isBuffer(artifact.bytes)) result = { ok: false, reason: REFUSAL_REASONS.NO_BYTES };
  else if (sha256Hex(artifact.bytes) !== artifact.sha256) result = { ok: false, reason: REFUSAL_REASONS.HASH_MISMATCH };
  else result = { ok: true, reason: null };
  if (artifact && typeof artifact === 'object') INTEGRITY_CACHE.set(artifact, result);
  return result;
}

// sliceInBounds(artifact, quote) -> {ok, reason, sliceBytes, slice}. Step 4: the byte range must be
// well-ordered and inside the artifact, and the resulting slice must decode to real, non-blank text.
function sliceInBounds(artifact, quote) {
  if (!isInBounds(quote, artifact.bytes.length)) return { ok: false, reason: REFUSAL_REASONS.RANGE_OUT_OF_BOUNDS, sliceBytes: null, slice: null };
  const sliceBytes = artifact.bytes.subarray(quote.byte_start, quote.byte_end);
  const slice = sliceBytes.toString('utf8');
  if (!slice.trim()) return { ok: false, reason: REFUSAL_REASONS.EMPTY_SLICE, sliceBytes: null, slice: null };
  // Kimi K3 R2 finding A24/#23 (live audit 2026-07-20): a hand-computed span whose offsets fall mid-way
  // through a multi-byte UTF-8 character decodes with a U+FFFD replacement char - a mojibake "quote" no
  // human wrote. Refuse it (Rule 4: fail closed on a corrupt decode, never mint a garbled accusation).
  if (slice.indexOf('�') !== -1) return { ok: false, reason: REFUSAL_REASONS.CORRUPT_SLICE, sliceBytes: null, slice: null };
  return { ok: true, reason: null, sliceBytes, slice };
}

// verifySpanHash(quote, sliceBytes) -> {ok, reason}. Step 5, the anti-drift commitment: quote.span_sha256
// must be shape-valid AND must equal the hash of the bytes actually sliced (a drifted/fabricated span,
// even one that lands in-bounds on real text, does not match and is refused).
function verifySpanHash(quote, sliceBytes) {
  if (typeof quote.span_sha256 !== 'string' || !SPAN_HASH_RE.test(quote.span_sha256)) {
    return { ok: false, reason: REFUSAL_REASONS.MISSING_SPAN_HASH };
  }
  if (sha256Hex(sliceBytes) !== quote.span_sha256) return { ok: false, reason: REFUSAL_REASONS.SPAN_HASH_MISMATCH };
  return { ok: true, reason: null };
}

function verifyQuoteDetailed(store, quote) {
  const resolved = resolveArtifact(store, quote);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const integrity = verifyArtifactIntegrity(resolved.artifact);
  if (!integrity.ok) return { ok: false, reason: integrity.reason };
  const sliced = sliceInBounds(resolved.artifact, quote);
  if (!sliced.ok) return { ok: false, reason: sliced.reason };
  const spanHash = verifySpanHash(quote, sliced.sliceBytes);
  if (!spanHash.ok) return { ok: false, reason: spanHash.reason };
  return { ok: true, reason: null, text: sliced.slice };
}

// verify_quote(artifact_store, quote) -> bool. The spec's own exact function name/signature, kept as a
// named export alongside the idiomatic camelCase alias so a caller quoting the spec verbatim still works.
function verifyQuote(store, quote) {
  return verifyQuoteDetailed(store, quote).ok;
}

// ── raw-provenance durability (Kimi K3 HIGH-E2) - ADDITIVE, ALONGSIDE the span_sha256 gate above ─────────
// verifyRawProvenance()/verifyRawProvenanceDetailed() do NOT replace or weaken verifyQuote/
// verifyQuoteDetailed above; the existing gate stays the SOLE determinant of "is this Quote real bytes
// genuinely captured and undrifted". This is a SECOND, independent check answering a different question:
// does the normalised span this Quote points at correspond to text that actually existed as a continuous
// run on the raw fetched page, or does it straddle a point where two originally separate raw text nodes
// were stitched together with no source separator between them (a phantom sentence no human could find
// rendered on the page, e.g. two unrelated "Free"/"VPS" pill badges concatenated into "Free VPS")? Call
// this ALONGSIDE verifyQuoteDetailed(), never instead of it - a caller wanting the full durability posture
// checks BOTH and treats either refusal as needs-review (Constitution Rule 6: ambiguity defaults to
// withholding).
const RAW_REFUSAL_REASONS = Object.freeze({
  RAW_UNAVAILABLE: 'raw_unavailable',       // the artifact carries no raw bytes (older bundle/replay input; honestly unresolvable, not a pass)
  RAW_HASH_MISMATCH: 'raw_hash_mismatch',   // the artifact's raw bytes no longer hash to their recorded rawSha256 (tamper/corruption of the raw record)
  PHANTOM_JOIN_RISK: 'phantom_join_risk',   // the span crosses a raw-text-run boundary with no source punctuation on either side (capture-index.js's boundary map)
});

// verifyRawProvenanceDetailed(store, quote) -> { ok, reason? }. Steps: (1) the quote's evidence_id must
// resolve to a real artifact (reuses resolveArtifact, the SAME resolution step verifyQuoteDetailed uses -
// one door for "find the artifact"); (2) the artifact must actually carry raw bytes (rawAvailable); (3) the
// raw bytes must still hash to their recorded rawSha256 (tamper/corruption on the raw record, mirroring
// verifyArtifactIntegrity's normalised-side check); (4) no boundary strictly inside [byte_start, byte_end)
// may be an unpunctuated raw-text-run join (the phantom-join refusal).
function verifyRawProvenanceDetailed(store, quote) {
  const resolved = resolveArtifact(store, quote);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const artifact = resolved.artifact;
  if (!artifact.rawAvailable || !Buffer.isBuffer(artifact.rawBytes)) {
    return { ok: false, reason: RAW_REFUSAL_REASONS.RAW_UNAVAILABLE };
  }
  if (sha256Hex(artifact.rawBytes) !== artifact.rawSha256) {
    return { ok: false, reason: RAW_REFUSAL_REASONS.RAW_HASH_MISMATCH };
  }
  const boundaries = Array.isArray(artifact.boundaries) ? artifact.boundaries : [];
  const start = Number(quote && quote.byte_start);
  const end = Number(quote && quote.byte_end);
  const crossing = boundaries.find((b) => b.byteOffset > start && b.byteOffset < end && !b.punctuated);
  if (crossing) return { ok: false, reason: RAW_REFUSAL_REASONS.PHANTOM_JOIN_RISK };
  return { ok: true, reason: null };
}

// verifyRawProvenance(store, quote) -> bool. The bool-only convenience wrapper, mirroring verifyQuote().
function verifyRawProvenance(store, quote) {
  return verifyRawProvenanceDetailed(store, quote).ok;
}

module.exports = {
  verifyQuote, verify_quote: verifyQuote, verifyQuoteDetailed, REFUSAL_REASONS,
  verifyRawProvenance, verifyRawProvenanceDetailed, RAW_REFUSAL_REASONS,
};
