'use strict';
// supervised/excerpts.js - builds TARGETED excerpts for the orchestrator (spec section 2's context-hygiene
// rule: "never paste whole pages into Claude's context ... targeted excerpts. Whole-HTML context is where
// hallucinated findings come from."). For each candidate Finding this returns a small window of text
// AROUND the verified quote span - never the whole artifact, never the whole page.

const EXCERPT_PAD_BYTES = 240; // a CAP (Rule 8): the window either side of the quote, never grown by a caller.

// excerptFor(store, quote) -> { evidence_id, url, before, quote_text, after } | null. Reads the artifact's
// bytes (must be present - this is a capture-time helper, not a rehydrated-from-manifest one) and slices a
// bounded window either side of the verified byte range. Returns null when the artifact/bytes are absent
// (never fabricates a window from nothing).
function excerptFor(store, quote) {
  if (!quote || !store || typeof store.get !== 'function') return null;
  const artifact = store.get(quote.evidence_id);
  if (!artifact || !Buffer.isBuffer(artifact.bytes)) return null;
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
