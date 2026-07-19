'use strict';
// payload/contract/v1_2/evidence.js - EvidenceRecord, its typed lane status, and Quote (Kimi WS0,
// blueprint 2.2). status is OK | LaneError(reason_code); an OK record MUST carry a real (non-empty)
// bytes_sha256, because empty bytes for a required surface is a LaneError, never a value (invariant c). A
// Quote is offsets into hashed evidence bytes, NEVER a string.

const core = require('./core.js');

const { brands, freeze, reqString, isNonNegInt, plainObjectCopy } = core;

// laneError(reason_code, detail?) -> a frozen LaneError status. reason_code is REQUIRED: an untyped lane
// failure is exactly the swallowed-error class this repo bans.
function laneError(reason_code, detail) {
  reqString(reason_code, 'reason_code', 'laneError');
  return Object.freeze({ kind: 'LaneError', reason_code, detail: detail == null ? null : String(detail) });
}
function evidenceStatusOK() { return Object.freeze({ kind: 'OK' }); }
function isLaneError(status) { return Boolean(status) && status.kind === 'LaneError'; }
function isEvidenceStatusOK(status) { return Boolean(status) && status.kind === 'OK'; }

// isEmptyBytes(bytes) -> true for null/undefined, an empty string/array, or a zero-length Buffer.
function isEmptyBytes(bytes) {
  if (bytes == null) return true;
  if (typeof bytes === 'string' || Array.isArray(bytes)) return bytes.length === 0;
  if (Buffer.isBuffer(bytes)) return bytes.length === 0;
  return false;
}
// requireBytes(bytes, reason_code) -> evidenceStatusOK() when `bytes` is non-empty, else
// laneError(reason_code). THE helper for invariant (c): a lane calls this instead of ever returning an
// empty array as if it were a value, so an empty required surface becomes a typed LaneError and every
// verdict that depends on it is unconstructible as Clean.
function requireBytes(bytes, reason_code) {
  return isEmptyBytes(bytes) ? laneError(reason_code, 'empty bytes for a required surface') : evidenceStatusOK();
}

// optOrNull(value) -> String(value) or null. The one place the record's optional string fields collapse
// their null-coalescing ternary, so EvidenceRecord's own body stays flat.
function optOrNull(value) { return value == null ? null : String(value); }
// evidenceByteRange(v) -> a frozen [start,end] pair when v is a 2-element array, else null.
function evidenceByteRange(v) { return Array.isArray(v) && v.length === 2 ? freeze([Number(v[0]), Number(v[1])]) : null; }
// evidenceStatusOf(status) -> the validated status, or THROWS.
function evidenceStatusOf(status) {
  if (!isEvidenceStatusOK(status) && !isLaneError(status)) {
    throw new Error('EvidenceRecord: status must be evidenceStatusOK() or laneError(reason_code) (got ' + JSON.stringify(status) + ')');
  }
  return status;
}
// okBytesSha256(s) -> the validated 64-hex digest for an OK record, or THROWS (an OK record cannot exist
// without a real hash of non-empty bytes - that is invariant c at the type level).
function okBytesSha256(s) {
  reqString(s.url_final, 'url_final', 'EvidenceRecord(OK)');
  reqString(s.fetched_at, 'fetched_at', 'EvidenceRecord(OK)');
  if (typeof s.bytes_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.bytes_sha256)) {
    throw new Error('EvidenceRecord(OK): bytes_sha256 must be a 64-char lowercase hex digest of NON-EMPTY bytes (empty bytes for a required surface must be a LaneError, not an OK record) - got ' + JSON.stringify(s.bytes_sha256));
  }
  return s.bytes_sha256;
}
// EvidenceRecord(spec) -> a frozen, branded evidence record. On an OK status the byte fields are mandatory
// (id, lane, url_final, fetched_at, bytes_sha256 as 64-hex, content_type). On a LaneError status only
// id/lane/status are required - there are no bytes to describe. dom_selector and byte_range are optional.
function EvidenceRecord(spec) {
  const s = spec || {};
  reqString(s.id, 'id', 'EvidenceRecord');
  if (!core.EVIDENCE_LANE_SET.has(s.lane)) throw new Error('EvidenceRecord: lane ' + JSON.stringify(s.lane) + ' must be one of ' + core.EVIDENCE_LANES.join('|'));
  const status = evidenceStatusOf(s.status);
  const rec = {
    id: s.id, lane: s.lane, status,
    url_final: optOrNull(s.url_final),
    redirect_chain: freeze(Array.isArray(s.redirect_chain) ? s.redirect_chain.map(String) : []),
    fetched_at: optOrNull(s.fetched_at),
    bytes_sha256: isEvidenceStatusOK(status) ? okBytesSha256(s) : null,
    content_type: optOrNull(s.content_type),
    headers: freeze(plainObjectCopy(s.headers)),
    dom_selector: optOrNull(s.dom_selector),
    byte_range: evidenceByteRange(s.byte_range),
  };
  return freeze(rec, brands.evidence);
}

// assertQuoteOffsets(s) -> THROWS unless byte_start/byte_end are non-negative integers with start <= end.
function assertQuoteOffsets(s) {
  if (!isNonNegInt(s.byte_start) || !isNonNegInt(s.byte_end)) {
    throw new Error('Quote: byte_start and byte_end must be non-negative integers (got ' + JSON.stringify(s.byte_start) + ', ' + JSON.stringify(s.byte_end) + ')');
  }
  if (s.byte_start > s.byte_end) throw new Error('Quote: byte_start must be <= byte_end (' + s.byte_start + ' > ' + s.byte_end + ')');
}
// SPAN_HASH_RE: span_sha256 must be a 64-char lowercase-hex commitment (the crypto.digest('hex') shape),
// mirroring supervised/finding.js's proven pattern.
const SPAN_HASH_RE = /^[0-9a-f]{64}$/;
// assertQuoteSpanHash(s) -> THROWS unless span_sha256 is a 64-char lowercase-hex commitment. Without this,
// an offset range with no declared text degenerates to "any in-bounds slice verifies" at verify-quote.js
// (the choke point this constructor exists to close): span_sha256 is a one-way hash of the EXACT bytes at
// [byte_start, byte_end), computed by the producer and re-checked by verify-quote.js, so a drifted or
// hand-assembled span is refused (blueprint 2.2 / P0-2, the same commitment supervised/finding.js already
// enforces on the other lane).
function assertQuoteSpanHash(s) {
  if (typeof s.span_sha256 !== 'string' || !SPAN_HASH_RE.test(s.span_sha256)) {
    throw new Error('Quote: span_sha256 is required and must be a 64-char lowercase-hex commitment to the exact bytes at the offsets (a hash, never the words - so an offset range with no declared text cannot verify against arbitrary in-bounds bytes)');
  }
}
// Quote(spec) -> a frozen, branded quote. NEVER a string: a fabricated quote has no resolvable triple. The
// optional `text` is the render-facing string that verify_quote re-derives from the bytes and confirms.
// span_sha256 is MANDATORY (fail-closed): the one-way commitment to the exact byte span that makes an
// unanchored offset range unrepresentable as a Quote.
function Quote(spec) {
  if (typeof spec === 'string') {
    throw new Error('Quote: a quote is offsets into fetched evidence, NEVER a bare string. Build it as { evidence_id, byte_start, byte_end, span_sha256 } so a fabricated quote has no resolvable triple (blueprint 2.2).');
  }
  const s = spec || {};
  reqString(s.evidence_id, 'evidence_id', 'Quote');
  assertQuoteOffsets(s);
  assertQuoteSpanHash(s);
  return freeze({ evidence_id: s.evidence_id, byte_start: s.byte_start, byte_end: s.byte_end, span_sha256: s.span_sha256, text: s.text == null ? null : String(s.text) }, brands.quote);
}

module.exports = {
  laneError, evidenceStatusOK, isLaneError, isEvidenceStatusOK, requireBytes,
  EvidenceRecord, Quote,
};
