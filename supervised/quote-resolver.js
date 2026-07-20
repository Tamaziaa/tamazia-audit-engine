'use strict';
// supervised/quote-resolver.js - turns a breach/proposers/propose.js candidate's LIVE quote (a page_url +
// a quote string, matched against the live bundle by breach/verifiers/quote-match.js's substring check)
// into a Quote{evidence_id, byte_start, byte_end} pointing into a supervised/capture-index.js
// ArtifactStore. This is the ONLY place a candidate's quote text is converted into a byte range; nothing
// else in supervised/ re-derives an offset (Rule 1 discipline extended to this harness).
//
// Uses capture-index.js's OWN normaliseWhitespace so the offsets it computes land on exactly the buffer
// verify-quote.js will later re-slice (both modules apply the identical single whitespace-collapse rule -
// see capture-index.js's header for why that rule was chosen).

const { normaliseWhitespace, sha256Hex, contentShaFor, evidenceIdFor } = require('./capture-index.js');
const { buildCoverageArtifact } = require('./coverage-proof.js');
const { ARTIFACT_TYPES } = require('../breach/artifact-types.js');

// resolveQuoteSpan(store, pageUrl, quoteText) -> Quote|null. Finds the artifact captured for pageUrl,
// locates quoteText (whitespace-normalised) as a substring of the artifact's own normalised bytes, and
// returns the byte offsets of the FIRST match. Returns null (never throws) when the page was not captured
// or the text is not present - an unresolvable candidate is dropped by the caller, never forced through
// (Constitution Rule 4: fail closed on the caller's side, not a fabricated span here).
// artifactForPage(store, pageUrl) -> the captured artifact for pageUrl, or null when the page was never
// captured (an unresolvable page is the caller's fail-closed signal, never a fabricated span).
function artifactForPage(store, pageUrl) {
  if (!store || typeof store.list !== 'function') return null;
  return store.list().find((a) => a.url === pageUrl) || null;
}

// locateNeedle(artifact, needle) -> { byteStart, byteEnd, sliceBytes } | null. Finds the FIRST
// occurrence of `needle` in the artifact's own bytes, then a sanity round-trip (the slice must decode
// back to `needle` exactly) guards against a multi-byte-UTF8 boundary landing mid-character, which
// Buffer.indexOf on raw bytes cannot itself see.
function locateNeedle(artifact, needle) {
  if (!Buffer.isBuffer(artifact.bytes)) return null;
  const needleBytes = Buffer.from(needle, 'utf8');
  const byteStart = artifact.bytes.indexOf(needleBytes);
  if (byteStart === -1) return null;
  const byteEnd = byteStart + needleBytes.length;
  if (byteEnd > artifact.bytes.length) return null;
  const sliceBytes = artifact.bytes.subarray(byteStart, byteEnd);
  if (sliceBytes.toString('utf8') !== needle) return null;
  return { byteStart, byteEnd, sliceBytes };
}

// spanCrossesPhantomJoin(artifact, byteStart, byteEnd) -> true when any raw-text-run boundary recorded on
// the artifact lies STRICTLY inside [byteStart, byteEnd) and is unpunctuated - i.e. the located span was
// stitched together across two originally separate raw text nodes with no source separator between them (a
// "Free"+"VPS" pill-badge pair concatenated into a phantom "Free VPS" no human could find on the page).
function spanCrossesPhantomJoin(artifact, byteStart, byteEnd) {
  const boundaries = Array.isArray(artifact.boundaries) ? artifact.boundaries : [];
  return boundaries.some((b) => b && b.byteOffset > byteStart && b.byteOffset < byteEnd && !b.punctuated);
}

function resolveQuoteSpan(store, pageUrl, quoteText) {
  const needle = normaliseWhitespace(quoteText);
  if (!needle.trim()) return null;
  const artifact = artifactForPage(store, pageUrl);
  if (!artifact) return null;
  const located = locateNeedle(artifact, needle);
  if (!located) return null;
  // Kimi K3 R2 finding A1/#1 (live audit 2026-07-20): E2 (phantom-join refusal) was enforced NOWHERE. A
  // span that resolves to a real byte range can still straddle an unpunctuated raw-run join - refuse it
  // here, at the ONE door that mints a span, rather than let a phantom sentence reach verify/sign/mint
  // (Constitution Rule 4/Rule 6: fail closed, ambiguity withholds the accusation).
  if (spanCrossesPhantomJoin(artifact, located.byteStart, located.byteEnd)) return null;
  // span_sha256: the ONE-WAY commitment to the exact bytes at these offsets (verify-quote.js re-checks it,
  // so a later drift of the offsets no longer verifies - the anti-fake bind of a quote to its own bytes).
  // A hash, never the words themselves, so the "a Quote is never a raw string" rule (finding.js) holds.
  return { evidence_id: artifact.evidence_id, byte_start: located.byteStart, byte_end: located.byteEnd, span_sha256: sha256Hex(located.sliceBytes) };
}

// ── non-quote evidence resolution (Kimi K3 10Q Q1(b)) ────────────────────────────────────────────────
// lineSpanFor(artifact, matchFn, candidate) -> { span, parsed, rejection } - locates the ONE line of an
// evidence-log artifact (capture-index.js's own canonical-JSONL-per-line convention) matching `matchFn`,
// and returns the SAME four-field span shape resolveQuoteSpan returns for a text quote. A line that fails
// to parse as JSON is a typed rejection (the artifact's own byte-integrity, never silently skipped).
function lineSpanFor(artifact, matchFn, candidate) {
  const text = artifact.bytes.toString('utf8');
  const lines = text.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineByteLen = Buffer.byteLength(lines[i], 'utf8');
    const end = start + lineByteLen;
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (e) {
      return { span: null, rejection: { record_id: candidate.record_id, code: 'artifact_line_malformed', reason: 'evidence line ' + i + ' of ' + artifact.evidence_id + ' is not parseable canonical JSON' } };
    }
    if (matchFn(parsed, i)) {
      return {
        span: { evidence_id: artifact.evidence_id, byte_start: start, byte_end: end, span_sha256: sha256Hex(Buffer.from(lines[i], 'utf8')) },
        parsed, rejection: null,
      };
    }
    start = end + 1; // '\n' separator
  }
  return { span: null, rejection: { record_id: candidate.record_id, code: 'locator_not_found', reason: 'the candidate\'s evidence locator was not present in the captured ' + artifact.lane + ' artifact' } };
}

// findArtifact(store, lane, key) -> the lane-typed artifact for a given key, or null.
function findArtifact(store, lane, key) {
  if (!store || typeof store.list !== 'function') return null;
  return store.list().find((a) => a.lane === lane && a.url === key) || null;
}

// resolveObservedLane(candidate, ctx, lane) -> {span, rejection} for a dom_node/network_event candidate:
// finds the site-wide dom/network evidence-log artifact and locates the row whose contentSha matches the
// candidate's OWN observation (computed the same way capture-index.js stamped it at capture time) - the
// row-identity key is CONTENT, not array position, so it is robust to lane-capture reordering.
function resolveObservedLane(candidate, ctx, lane) {
  const { siteKeyOf } = require('./capture-index.js');
  const key = siteKeyOf(ctx.bundle);
  const artifact = findArtifact(ctx.captureIndex, lane, key);
  if (!artifact) {
    return { span: null, rejection: { record_id: candidate.record_id, code: 'evidence_lane_missing', reason: 'no captured ' + lane + ' evidence-log artifact exists for this run; the candidate cannot be anchored' } };
  }
  const rest = Object.assign({}, candidate.artifact);
  delete rest.type;
  const targetSha = contentShaFor(Object.assign({ i: -1 }, rest));
  const result = lineSpanFor(artifact, (row) => row.contentSha === targetSha, candidate);
  return result;
}

// resolveAbsenceLane(candidate, ctx) -> {span, rejection, coverage} for a coverage_proof/register_absence
// candidate: builds (or reuses, addDerived is idempotent) the coverage-proof artifact committing to this
// candidate's exact absence claim, registers it on the capture index, and anchors the span over its single
// line - returning the `coverage` object (subjects/pattern_sha256/claimed_count) the caller passes straight
// into createFinding().
function resolveAbsenceLane(candidate, ctx) {
  const artifact = buildCoverageArtifact({ candidateArtifact: candidate.artifact, captureIndex: ctx.captureIndex, fetchedAt: ctx.fetchedAt || new Date().toISOString() });
  if (!artifact) {
    return { span: null, rejection: { record_id: candidate.record_id, code: 'coverage_unresolvable', reason: 'no real captured subject could be resolved for this absence candidate; it cannot be honestly anchored' } };
  }
  ctx.captureIndex.addDerived(artifact);
  const line = JSON.parse(artifact.bytes.toString('utf8'));
  return {
    span: { evidence_id: artifact.evidence_id, byte_start: 0, byte_end: artifact.length, span_sha256: artifact.sha256 },
    rejection: null,
    coverage: { subjects: line.subjects, pattern_sha256: line.pattern_sha256, claimed_count: line.claimed_count },
  };
}

// EVIDENCE_KIND_OF_TYPE: candidate.artifact.type (breach/artifact-types.js's ARTIFACT_TYPES) -> the
// supervised/finding.js EVIDENCE_KIND string this candidate's finding must be constructed with.
const EVIDENCE_KIND_OF_TYPE = Object.freeze({
  [ARTIFACT_TYPES.QUOTE]: 'quote',
  [ARTIFACT_TYPES.DOM_NODE]: 'dom_node',
  [ARTIFACT_TYPES.NETWORK_EVENT]: 'network_event',
  [ARTIFACT_TYPES.REGISTER_ROW]: 'register_row',
  [ARTIFACT_TYPES.REGISTER_ABSENCE]: 'register_absence',
  [ARTIFACT_TYPES.COVERAGE_PROOF]: 'coverage_proof',
});

// resolveEvidenceSpan(candidate, ctx) -> { span, rejection, coverage?, evidenceKind }. THE single dispatch
// point for anchoring ANY verified candidate (quote or non-quote) into a real captured artifact. `ctx` is
// {captureIndex, bundle, fetchedAt} (run-harness.js's classifyOneCandidate bundles this once, same
// discipline as classifyCandidates' own ctx object).
function resolveEvidenceSpan(candidate, ctx) {
  const type = candidate && candidate.artifact && candidate.artifact.type;
  const evidenceKind = EVIDENCE_KIND_OF_TYPE[type];
  if (!evidenceKind) {
    return { span: null, rejection: { record_id: candidate && candidate.record_id, code: 'artifact_missing', reason: 'candidate carried no usable/known artifact type' }, evidenceKind: null };
  }
  if (type === ARTIFACT_TYPES.DOM_NODE) {
    const r = resolveObservedLane(candidate, ctx, 'dom');
    return Object.assign({ evidenceKind }, r);
  }
  if (type === ARTIFACT_TYPES.NETWORK_EVENT) {
    const r = resolveObservedLane(candidate, ctx, 'network');
    return Object.assign({ evidenceKind }, r);
  }
  if (type === ARTIFACT_TYPES.COVERAGE_PROOF || type === ARTIFACT_TYPES.REGISTER_ABSENCE) {
    const r = resolveAbsenceLane(candidate, ctx);
    return Object.assign({ evidenceKind }, r);
  }
  // REGISTER_ROW: no proposer in this repo currently emits a "present row" candidate (evalRegister only
  // ever emits register_absence or a suppression - a matched row is a clean pass, never a candidate), so
  // this branch is a documented, honest gap: reached only if a future proposer starts emitting one.
  return { span: null, rejection: { record_id: candidate.record_id, code: 'evidence_kind_unsupported', reason: 'evidence_kind ' + JSON.stringify(evidenceKind) + ' has no resolver wired yet' }, evidenceKind };
}

module.exports = { resolveQuoteSpan, resolveEvidenceSpan, lineSpanFor };
