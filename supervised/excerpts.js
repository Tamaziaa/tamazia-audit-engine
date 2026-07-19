'use strict';
// supervised/excerpts.js - builds TARGETED excerpts for the orchestrator (spec section 2's context-hygiene
// rule: "never paste whole pages into Claude's context ... targeted excerpts. Whole-HTML context is where
// hallucinated findings come from."). For each candidate Finding this returns a small window of text
// AROUND the verified quote span - never the whole artifact, never the whole page.

const EXCERPT_PAD_BYTES = 240; // a CAP (Rule 8): the window either side of the quote, never grown by a caller.

// isReadableStore(store, quote) -> true when there is a quote to look up AND a store capable of a get().
function isReadableStore(store, quote) {
  if (!quote || !store) return false;
  return typeof store.get === 'function';
}
// isReadableArtifact(artifact) -> true when the artifact exists and carries real bytes to slice.
function isReadableArtifact(artifact) {
  if (!artifact) return false;
  return Buffer.isBuffer(artifact.bytes);
}
// artifactForExcerpt(store, quote) -> the artifact a quote's excerpt would read, or null when the quote,
// store, or the artifact's own bytes are not available (never fabricates a window from nothing).
function artifactForExcerpt(store, quote) {
  if (!isReadableStore(store, quote)) return null;
  const artifact = store.get(quote.evidence_id);
  return isReadableArtifact(artifact) ? artifact : null;
}

// sliceExcerptWindow(artifact, quote) -> { evidence_id, url, before, quote_text, after }, a bounded
// window either side of the verified byte range (never grown past EXCERPT_PAD_BYTES either way).
function sliceExcerptWindow(artifact, quote) {
  const len = artifact.bytes.length;
  const start = Math.max(0, quote.byte_start - EXCERPT_PAD_BYTES);
  const end = Math.min(len, quote.byte_end + EXCERPT_PAD_BYTES);
  return {
    evidence_id: quote.evidence_id,
    url: artifact.url,
    before: artifact.bytes.subarray(start, quote.byte_start).toString('utf8'),
    quote_text: artifact.bytes.subarray(quote.byte_start, quote.byte_end).toString('utf8'),
    after: artifact.bytes.subarray(quote.byte_end, end).toString('utf8'),
  };
}

// excerptFor(store, quote) -> { evidence_id, url, before, quote_text, after } | null. Reads the
// artifact's bytes (must be present - this is a capture-time helper, not a rehydrated-from-manifest
// one) and slices a bounded window either side of the verified byte range. Returns null when the
// artifact/bytes are absent (never fabricates a window from nothing).
function excerptFor(store, quote) {
  const artifact = artifactForExcerpt(store, quote);
  return artifact ? sliceExcerptWindow(artifact, quote) : null;
}

// buildExcerpts(store, findings) -> [{finding_id, excerpt}], one per finding whose excerpt could be built
// (a finding whose artifact cannot be re-read is skipped, never given a fabricated excerpt).
function buildExcerpts(store, findings) {
  const out = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    const excerpt = excerptFor(store, finding.quote);
    if (excerpt) out.push({ finding_id: finding.finding_id, rule_id: finding.rule_id, excerpt });
  }
  return out;
}

module.exports = { buildExcerpts, excerptFor, EXCERPT_PAD_BYTES };
