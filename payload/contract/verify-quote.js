'use strict';
// payload/contract/verify-quote.js - verify_quote (Kimi WS0, blueprint 2.2 / P0-2, the choke point).
//
// A PURE, non-LLM function that recomputes the byte hash of the fetched evidence, slices the quote's
// offsets, and confirms the quoted text exists in the fetched bytes. This is the deterministic guard that
// makes a fabricated quote unrepresentable at the byte level: a quote whose evidence_id is not in the
// store, whose offsets fall outside the fetched bytes, whose bytes have been tampered with (recomputed
// hash != stored hash), or whose declared text does not equal the byte slice, all return false. There is
// no model here and never will be.
//
// evidenceStore shapes accepted (all pure, in-memory; no network, no clock):
//   - a Map keyed by evidence id -> { bytes, record? } | bytes (string|Buffer)
//   - an object with a .get(id) method returning the same
//   - a plain object { [id]: { bytes, record? } | bytes }
// Each entry supplies the raw fetched bytes; an EvidenceRecord (with bytes_sha256) may travel alongside
// (record) so the hash can be checked against what the record CLAIMED at fetch time (the tamper guard).

const { sha256Hex } = require('./v1_2.js');

// readRaw(store, id) -> the raw value the store holds for id (Map/get-bearing object, else own property).
function readRaw(store, id) {
  if (typeof store.get === 'function') return store.get(id); // Map or a get-bearing object
  if (Object.prototype.hasOwnProperty.call(store, id)) return store[id];
  return null;
}
function isBareBytes(raw) { return typeof raw === 'string' || Buffer.isBuffer(raw); }
function isEntryObject(raw) { return typeof raw === 'object' && 'bytes' in raw; }
// resolveEntry(store, id) -> { bytes, record } or null. Normalises the three accepted store shapes.
function resolveEntry(store, id) {
  if (!store) return null;
  const raw = readRaw(store, id);
  if (raw == null) return null;
  if (isBareBytes(raw)) return { bytes: raw, record: null };
  if (isEntryObject(raw)) return { bytes: raw.bytes, record: raw.record || null };
  return null;
}

// asBuffer(bytes) -> a Buffer view of a string|Buffer, or null when the value is neither.
function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  return null;
}

// recordedHash(record) / expectedHash(entry) -> the sha256 the quote should verify against: the travelling
// EvidenceRecord's bytes_sha256 (the tamper anchor - what the lane recorded at fetch time), or null when no
// record travels with the bytes (then only the offset bounds and byte slice are checked, no tamper anchor).
function recordedHash(record) {
  if (!record || typeof record.bytes_sha256 !== 'string') return null;
  return record.bytes_sha256 || null;
}
function expectedHash(entry) { return recordedHash(entry.record); }

// hasFields(quote) -> the quote carries the three offset fields in a usable shape. Split into two
// single-concern predicates so no one boolean expression carries a chain of logical operators.
function hasEvidenceId(q) { return typeof q.evidence_id === 'string' && q.evidence_id !== ''; }
function hasValidOffsets(q) {
  if (!Number.isInteger(q.byte_start) || !Number.isInteger(q.byte_end)) return false;
  return q.byte_start >= 0 && q.byte_end >= q.byte_start;
}
function hasFields(quote) {
  if (!quote) return false;
  return hasEvidenceId(quote) && hasValidOffsets(quote);
}

/**
 * verifyQuote(evidenceStore, quote) -> boolean. True ONLY when the quote resolves to real fetched bytes,
 * the bytes are untampered (recomputed hash equals the record's stored hash when one is available), the
 * offsets fall within the bytes, and - when the quote declares a text - the byte slice equals that text.
 * Pure; never throws on a malformed input (a malformed quote or missing evidence is simply unverifiable
 * -> false), because a throw here would be a way for a fabrication to escape as an error the mint might
 * swallow. The mint-time gate (mint/quote-verify-gate.js) turns a false here into a mint refusal.
 */
// tamperedOrOutOfBounds(entry, buf, quote) -> true when the bytes no longer hash to the recorded digest
// (tamper) or the quote's offsets fall outside the fetched bytes.
function tamperedOrOutOfBounds(entry, buf, quote) {
  const want = expectedHash(entry);
  if (want != null && sha256Hex(buf) !== want) return true;
  return quote.byte_end > buf.length;
}
// SPAN_HASH_RE: span_sha256 must be a 64-char lowercase-hex commitment (mirrors v1_2/evidence.js's Quote
// constructor and supervised/verify-quote.js's proven pattern).
const SPAN_HASH_RE = /^[0-9a-f]{64}$/;
// hasSpanCommitment(quote) -> the quote carries a well-formed span_sha256. Without this a bare offset range
// with no declared text would degenerate to "any non-empty in-bounds slice verifies" (CRITICAL-1): the span
// commitment is the mandatory tamper anchor that makes a hand-assembled quote unrepresentable regardless of
// whether `text` is supplied.
function hasSpanCommitment(quote) {
  return typeof quote.span_sha256 === 'string' && SPAN_HASH_RE.test(quote.span_sha256);
}
// UNICODE_REPLACEMENT: U+FFFD, the character UTF-8 decoding substitutes for a byte sequence that is not
// valid UTF-8 (including a multi-byte codepoint split by an offset boundary). A slice or a declared text
// containing it signals a byte-level split/corruption; comparing DECODED strings that both contain U+FFFD
// can make two different byte sequences read as "equal" (O6). The fix below compares raw BYTES, never
// decoded strings, so this constant remains only for the reject-on-replacement-char defence in depth.
const UNICODE_REPLACEMENT = '�';
// declaredTextIsCorrupt(quote) -> true when a non-empty declared text carries the Unicode replacement
// character. A corrupted/lossy decode can never be an honest declaration, so it is REJECTED outright
// (never silently treated as "no text declared" - that would let the byte-only fallback below wave through
// client-facing prose nobody ever verified, C-035's detection/evidence-surface disagreement in a new guise).
function declaredTextIsCorrupt(quote) {
  return typeof quote.text === 'string' && quote.text !== '' && quote.text.indexOf(UNICODE_REPLACEMENT) !== -1;
}
// declaredTextBuffer(quote) -> a UTF-8 Buffer of the declared text, or null when none is declared.
function declaredTextBuffer(quote) {
  if (quote.text == null || quote.text === '') return null;
  return Buffer.from(quote.text, 'utf8');
}
// sliceMatches(buf, quote) -> the declared text (encoded back to UTF-8 bytes) must BYTE-EQUAL the byte
// slice; with no declared text a non-empty in-bounds slice is the verified quote. Comparing BYTES (never
// decoded strings) closes O6: a slice that splits a multi-byte character decodes to U+FFFD, and a decoded
// string comparison would let a declared text also containing U+FFFD "match" bytes that are not that text.
// A corrupted declared text is rejected outright, never silently ignored.
function sliceMatches(buf, quote) {
  if (declaredTextIsCorrupt(quote)) return false;
  const slice = buf.slice(quote.byte_start, quote.byte_end);
  const declared = declaredTextBuffer(quote);
  if (declared) return slice.equals(declared);
  return slice.length > 0;
}
// spanCommitmentMatches(buf, quote) -> the quote's span_sha256 recomputed over the ACTUAL byte slice. This
// is the mandatory tamper anchor (CRITICAL-1): even when no `text` is declared, a hand-assembled offset
// range cannot verify unless its span_sha256 was genuinely computed over these exact bytes.
function spanCommitmentMatches(buf, quote) {
  if (!hasSpanCommitment(quote)) return false;
  const slice = buf.slice(quote.byte_start, quote.byte_end);
  return sha256Hex(slice) === quote.span_sha256;
}
function verifyQuote(evidenceStore, quote) {
  if (!hasFields(quote)) return false;
  const entry = resolveEntry(evidenceStore, quote.evidence_id);
  if (!entry) return false; // no such evidence: an unresolvable quote (the fabrication case)
  const buf = asBuffer(entry.bytes);
  if (!buf) return false;
  if (tamperedOrOutOfBounds(entry, buf, quote)) return false;
  if (!spanCommitmentMatches(buf, quote)) return false;
  return sliceMatches(buf, quote);
}

module.exports = { verifyQuote, sha256Hex };
