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

// ── resolveSpanText - Kimi K3 render-debug §2's evidence resolver ────────────────────────────────────
// Resolves the EXACT bytes a Finding's quote span anchors, SHA-256 re-verified (via verify-quote.js's own
// choke point - never a second, independent hash check that could drift from it) against span_sha256, and
// returns null (never a fabricated/paraphrased string) on ANY mismatch. This is the ONE place a rendered
// evidence_quote is assembled from a Finding; the exporter (supervised/export.js) is the only caller.
//
// maxLen defaults to 400 (a render-sized excerpt, not a re-dump of the whole artifact); truncation is
// always flagged explicitly, never silent.

const { verifyQuoteDetailed } = require('./verify-quote.js');

const RESOLVE_MAX_LEN_DEFAULT = 400;

function truncateForRender(text, maxLen) {
  if (typeof text !== 'string') return { text: null, truncated: false };
  if (text.length <= maxLen) return { text, truncated: false };
  return { text: text.slice(0, maxLen), truncated: true };
}

// urlForEvidenceId(store, evidenceId) -> the real captured URL an evidence_id resolves to, or null. Used
// to turn a coverage proof's `subjects` (evidence_id + sha256 only, per coverage-proof.js) back into the
// real page/register URLs that were actually searched - never a blanket "[site]" placeholder.
function urlForEvidenceId(store, evidenceId) {
  const artifact = store && typeof store.get === 'function' ? store.get(evidenceId) : null;
  return artifact && typeof artifact.url === 'string' ? artifact.url : null;
}

// checkedUrlsForCoverage(store, coverage) -> the full list of real, resolvable subject URLs a coverage/
// absence finding was actually checked against (Kimi §2: "the FULL searched-page list, NOT [site]").
function checkedUrlsForCoverage(store, coverage) {
  const subjects = Array.isArray(coverage && coverage.subjects) ? coverage.subjects : [];
  const urls = [];
  for (const s of subjects) {
    const url = s && urlForEvidenceId(store, s.evidence_id);
    if (url) urls.push(url);
  }
  return urls;
}

// parseEvidenceRow(text) -> the JSON-parsed evidence-log row a resolved span's bytes decode to, or null
// on any parse failure (dom_node/network_event rows are one stableStringify'd JSON object per line, per
// capture-index.js's captureEvidenceArtifact). Never throws.
function parseEvidenceRow(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// resolveSpanText(store, finding, opts) -> { quote, sha256, truncated, checkedUrls }.
//   store    an ArtifactStore (or object with .get/.list) capable of re-reading the SAME bytes captured
//            at run time.
//   finding  a real supervised/finding.js Finding (quote + evidence_kind [+ coverage]).
//   opts     { maxLen = 400 }.
//
// Per evidence kind (Kimi §2's table):
//   text/dom_text ('quote')        -> the resolved, sha-verified span text.
//   network_event                  -> the request URL, verbatim (never the raw JSON row).
//   dom_node                       -> the node's own text if text-anchored, else none.
//   absence/coverage_proof         -> NEVER a quote; checkedUrls = the full searched-page list.
// On ANY verification failure (missing store, unresolved artifact, hash mismatch, drifted span) this
// returns quote:null - it never emits unverified or paraphrased text (the one invariant this function
// exists to enforce).
function resolveSpanText(store, finding, opts) {
  const o = opts || {};
  const maxLen = Number.isInteger(o.maxLen) && o.maxLen > 0 ? o.maxLen : RESOLVE_MAX_LEN_DEFAULT;
  const result = { quote: null, sha256: null, truncated: false, checkedUrls: [] };
  const quote = finding && finding.quote;
  const kind = finding && finding.evidence_kind;

  if (kind === 'coverage_proof' || kind === 'register_absence') {
    // Absence claims never carry a "quote" - there is no text to show for a thing that was not found.
    result.checkedUrls = checkedUrlsForCoverage(store, finding && finding.coverage);
    return result;
  }
  if (!quote) return result;

  const verified = verifyQuoteDetailed(store, quote); // THE re-verification: hash -> slice -> real text, or null.
  if (!verified.ok) return result; // fail closed on hash_mismatch/range_out_of_bounds/etc - never fabricate.

  if (kind === 'network_event') {
    const row = parseEvidenceRow(verified.text);
    const url = row && typeof row.url === 'string' ? row.url : null;
    if (!url) return result; // no verbatim URL to show - refuse rather than paraphrase the raw row.
    const t = truncateForRender(url, maxLen);
    result.quote = t.text; result.truncated = t.truncated; result.sha256 = quote.span_sha256;
    result.checkedUrls = [url];
    return result;
  }
  if (kind === 'dom_node') {
    const row = parseEvidenceRow(verified.text);
    const text = row && typeof row.text === 'string' && row.text.trim() ? row.text : null;
    if (text) {
      const t = truncateForRender(text, maxLen);
      result.quote = t.text; result.truncated = t.truncated; result.sha256 = quote.span_sha256;
    } // else: not text-anchored -> none, per Kimi §2's table (never fabricate a description of the node).
    if (row && typeof row.url === 'string') result.checkedUrls = [row.url];
    return result;
  }
  // 'quote' / 'register_row' / default: the resolved span text itself, sha-verified.
  const t = truncateForRender(verified.text, maxLen);
  result.quote = t.text; result.truncated = t.truncated; result.sha256 = quote.span_sha256;
  return result;
}

module.exports = { buildExcerpts, excerptFor, EXCERPT_PAD_BYTES, resolveSpanText };
