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

const { normaliseWhitespace, sha256Hex } = require('./capture-index.js');

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

function resolveQuoteSpan(store, pageUrl, quoteText) {
  const needle = normaliseWhitespace(quoteText);
  if (!needle.trim()) return null;
  const artifact = artifactForPage(store, pageUrl);
  if (!artifact) return null;
  const located = locateNeedle(artifact, needle);
  if (!located) return null;
  // span_sha256: the ONE-WAY commitment to the exact bytes at these offsets (verify-quote.js re-checks it,
  // so a later drift of the offsets no longer verifies - the anti-fake bind of a quote to its own bytes).
  // A hash, never the words themselves, so the "a Quote is never a raw string" rule (finding.js) holds.
  return { evidence_id: artifact.evidence_id, byte_start: located.byteStart, byte_end: located.byteEnd, span_sha256: sha256Hex(located.sliceBytes) };
}

module.exports = { resolveQuoteSpan };
