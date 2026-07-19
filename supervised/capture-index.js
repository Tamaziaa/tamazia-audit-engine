'use strict';
// supervised/capture-index.js - THE hash-chained capture index (Kimi K3 round-3 spec section 2).
//
// Wraps the EXISTING evidence bundle (mint/compose-bundle.js's output, the same EvidenceBundle
// facts/breach already consume - this file introduces no second crawler, no second evidence lane; Rule 1)
// into an ArtifactStore: every fetched artifact (page text today; documents/screenshots/headers are
// additive extension points, see buildCaptureIndex's doc) is recorded with a SHA-256 over its EXACT stored
// bytes and a stable evidence_id. A capture that failed is recorded as a typed LaneError entry on
// `errors`, never as an absent/empty artifact silently standing in for "nothing to see" (Constitution
// Rule 4's own doctrine, applied here to the harness's own capture step, not just the crawler's).
//
// BYTE-OFFSET CONVENTION (a documented judgement call - the full v1.2 finding schema this is a lite subset
// of does not yet specify one, so this module fixes it and callers of quote-resolver.js/verify-quote.js
// rely on it): each artifact's `bytes` is the UTF-8 encoding of the page's WHITESPACE-NORMALISED visible
// text (every run of whitespace collapsed to a single ASCII space - the SAME single normalisation
// breach/verifiers/quote-match.js already applies for Gate 2's verbatim re-match, chosen here for
// consistency so a quote span computed against this store lines up with what the existing verifier would
// also accept). byte_start/byte_end in a Quote are offsets into THIS normalised buffer, not into the raw
// HTML - documented here once, at the one place both quote-resolver.js (which computes offsets) and
// verify-quote.js (which re-checks them) import from.
//
// Extra-page requests ARE allowed and hashed like any other capture (spec section 2): buildCaptureIndex()
// accepts every page present on bundle.corpus.pages, however many the crawler chose to fetch - it does not
// cap or select a subset.

const crypto = require('crypto');
const { LaneError } = require('./errors.js');

// normaliseWhitespace(s) -> s with every run of whitespace collapsed to a single ASCII space. Deliberately
// the SAME rule as breach/verifiers/quote-match.js's normaliseWhitespace (kept as an independent, small,
// re-implemented copy rather than an import: this module must stay import-light enough to be usable from
// a pure replay context with no breach/ dependency, and the rule is one line, unlikely to drift silently -
// any drift would be caught by capture-index.test.js's cross-check against quote-match's own export).
function normaliseWhitespace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ');
}

// sha256Hex(bytes) -> the lowercase hex SHA-256 of a Buffer.
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// evidenceIdFor(url, lane) -> a stable, deterministic evidence_id for one captured artifact. Derived from
// the URL + lane (never a random uuid): two captures of the SAME url/lane in two different runs get the
// SAME id, which is what lets replay.js compare "the finding pointed at evidence_id X" across runs without
// needing a shared random-id namespace.
function evidenceIdFor(url, lane) {
  return crypto.createHash('sha256').update(lane + '|' + url, 'utf8').digest('hex').slice(0, 16);
}

// ArtifactStore - the read-side contract verify-quote.js and packet.js consume. Deliberately a thin class
// wrapping a plain Map so callers can do `store.get(evidence_id)`, `store.list()`, and JSON round-trip via
// toJSON()/fromJSON() for the run manifest (section 4: the manifest must carry every artifact hash).
class ArtifactStore {
  constructor(artifacts, errors) {
    this._byId = new Map((artifacts || []).map((a) => [a.evidence_id, a]));
    this.errors = errors || [];
  }
  get(evidenceId) {
    return this._byId.get(evidenceId) || null;
  }
  list() {
    return Array.from(this._byId.values());
  }
  toJSON() {
    // Bytes are NOT serialised into the manifest (they can be large, and the manifest's job is provenance,
    // not a second copy of the corpus - text/byte content stays retrievable from the bundle/replay inputs).
    // The hash IS the manifest's proof; that is the whole point of a hash-chained index.
    return {
      artifacts: this.list().map((a) => ({
        evidence_id: a.evidence_id, url: a.url, lane: a.lane, sha256: a.sha256, length: a.length, fetched_at: a.fetched_at,
      })),
      errors: this.errors.map((e) => ({ lane: e.lane, reasonCode: e.reasonCode, detail: e.detail })),
    };
  }
  // fromArtifactRecords(records) -> an ArtifactStore rehydrated with REAL bytes for replay (records must
  // each carry `bytes` - a Buffer - unlike toJSON()'s hash-only projection). Used by replay.js, which keeps
  // its own separate raw-bytes store (see replay.js doc) because the manifest JSONL never carries bytes.
  static fromArtifactRecords(records) {
    return new ArtifactStore(records, []);
  }
}

// buildCaptureIndex(bundle, opts) -> ArtifactStore. Pure over its inputs except for `opts.now` (injectable
// clock, defaults to Date.now - Rule 9 discipline: no bare clock call inside a pure module). Hashes every
// page in bundle.corpus.pages under lane 'static' (the crawler's own lane name for this surface). A page
// with no readable text is NOT silently skipped - it is recorded as a LaneError('capture', 'empty_page',
// ...) on the store's errors list, because an empty capture and a captured-empty-page are different facts
// (Constitution Rule 4: empty-arrays-flowing-as-success is exactly the disease the blueprint's `Clean`
// constructor closes at the type level; this module closes the analogous hole at the capture layer).
function buildCaptureIndex(bundle, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const fetchedAt = new Date(now()).toISOString();
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const artifacts = [];
  const errors = [];
  for (const page of pages) {
    if (!page || typeof page.url !== 'string' || !page.url) {
      errors.push(new LaneError('capture', 'malformed_page', 'a bundle page had no url; skipped rather than hashed under a guessed key'));
      continue;
    }
    const text = typeof page.text === 'string' ? page.text : '';
    const normalised = normaliseWhitespace(text);
    if (!normalised.trim()) {
      errors.push(new LaneError('capture', 'empty_page', 'page ' + JSON.stringify(page.url) + ' carried no readable visible text; not hashed as a real artifact'));
      continue;
    }
    const bytes = Buffer.from(normalised, 'utf8');
    artifacts.push({
      evidence_id: evidenceIdFor(page.url, 'static'),
      url: page.url,
      lane: 'static',
      sha256: sha256Hex(bytes),
      length: bytes.length,
      fetched_at: fetchedAt,
      bytes,
    });
  }
  // The crawl lane's own unreachable/reason verdict lives on the stageManifest entry it produced
  // (mint/compose-bundle.js's manifest.push({stage:'crawl', unreachable, reason, ...})), not on
  // bundle.corpus itself (which is always just {pages:[...]}). Pass it through when the caller has it
  // (run-harness.js always does) so an unreachable site is recorded as a real LaneError here too, not
  // just upstream - a capture index consumer must never have to go re-read the raw stageManifest.
  const crawlStage = Array.isArray(o.stageManifest) ? o.stageManifest.find((s) => s && s.stage === 'crawl') : null;
  if (crawlStage && crawlStage.unreachable) {
    errors.push(new LaneError('capture', 'site_unreachable', crawlStage.reason || 'the crawl lane recorded the domain as unreachable'));
  }
  return new ArtifactStore(artifacts, errors);
}

module.exports = { buildCaptureIndex, normaliseWhitespace, sha256Hex, evidenceIdFor, ArtifactStore };
