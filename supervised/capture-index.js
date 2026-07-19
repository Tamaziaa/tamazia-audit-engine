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
// SELECT A SUBSET of what the crawler already decided to fetch. That is not the same claim as "unbounded":
// this repo's own doctrine is "budgets are caps, never floors" (Constitution Rule 8), and the crawler's own
// page cap (evidence/crawler/discover.js's maxPages) is a SEPARATE module this one must not blindly trust
// forever - a defence-in-depth outer ceiling belongs here too (CodeRabbit review, PR #36). MAX_PAGES/
// MAX_TOTAL_BYTES below are that ceiling: hit either one and the capture FAILS CLOSED with a typed
// LaneError, rather than either hashing an unbounded corpus or silently truncating a "clean" partial one.

const crypto = require('crypto');
const { LaneError } = require('./errors.js');

// MAX_PAGES / MAX_TOTAL_BYTES: hard ceilings on one capture run (Rule 8: caps, never floors, and never
// silently raised). Generous relative to any real single-site audit (the crawler's own default maxPages
// is far lower in practice) so this never fires on a normal run; its only job is to turn a compromised or
// misbehaving upstream bundle into a typed, visible refusal instead of an unbounded hash/allocate loop.
const MAX_PAGES = 200;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB of normalised text, summed across the whole capture.

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
// hasReadableUrl(page) -> true when page carries a non-empty string url (a page with none cannot be
// hashed under any real key, so it is a malformed page, not a same-url duplicate or empty capture).
function hasReadableUrl(page) {
  if (!page) return false;
  return typeof page.url === 'string' && page.url !== '';
}

// captureOnePage(page, fetchedAt) -> {artifact, error}. Exactly one of the two is non-null: a malformed
// page (no url) or an unreadable one (no visible text after whitespace-normalisation) yields a typed
// LaneError and no artifact; a readable page yields a real, hashed artifact and no error.
function captureOnePage(page, fetchedAt) {
  if (!hasReadableUrl(page)) {
    return { artifact: null, error: new LaneError('capture', 'malformed_page', 'a bundle page had no url; skipped rather than hashed under a guessed key') };
  }
  const text = typeof page.text === 'string' ? page.text : '';
  const normalised = normaliseWhitespace(text);
  if (!normalised.trim()) {
    return { artifact: null, error: new LaneError('capture', 'empty_page', 'page ' + JSON.stringify(page.url) + ' carried no readable visible text; not hashed as a real artifact') };
  }
  const bytes = Buffer.from(normalised, 'utf8');
  return {
    error: null,
    artifact: { evidence_id: evidenceIdFor(page.url, 'static'), url: page.url, lane: 'static', sha256: sha256Hex(bytes), length: bytes.length, fetched_at: fetchedAt, bytes },
  };
}

// unreachableSiteError(stageManifest) -> a LaneError when the crawl lane recorded the domain as
// unreachable, else null. The crawl lane's own unreachable/reason verdict lives on the stageManifest
// entry it produced (mint/compose-bundle.js's manifest.push({stage:'crawl', unreachable, reason, ...})),
// not on bundle.corpus itself (which is always just {pages:[...]}) - pulled through here so an
// unreachable site is recorded as a real LaneError on the capture index too, not just upstream (a
// consumer must never have to go re-read the raw stageManifest).
function unreachableSiteError(stageManifest) {
  const crawlStage = Array.isArray(stageManifest) ? stageManifest.find((s) => s && s.stage === 'crawl') : null;
  if (!crawlStage || !crawlStage.unreachable) return null;
  return new LaneError('capture', 'site_unreachable', crawlStage.reason || 'the crawl lane recorded the domain as unreachable');
}

// pagesOfBundle(bundle) -> bundle.corpus.pages when present, else [] (a bundle with no readable corpus
// yet is not an error here - it simply captures nothing, honestly).
function pagesOfBundle(bundle) {
  const corpus = bundle && bundle.corpus;
  return corpus && Array.isArray(corpus.pages) ? corpus.pages : [];
}

// processOnePage(page, fetchedAt, state) -> { action: 'accept'|'skip'|'stop', artifact?, error? }. One
// page's full fate against the running MAX_PAGES/MAX_TOTAL_BYTES budgets and the already-seen evidence_id
// set, so captureAllPages()'s own loop is a plain three-way dispatch, never a chain of independent ifs.
// 'stop' means the whole capture halts here (a budget was hit - Rule 8, never silently truncate past a
// cap and call the result clean); 'skip' means only THIS page is refused (malformed/empty/duplicate) and
// capture continues with the next one.
function processOnePage(page, fetchedAt, state) {
  if (state.count >= MAX_PAGES) {
    return { action: 'stop', error: new LaneError('capture', 'page_budget_exceeded', 'capture stopped: more than ' + MAX_PAGES + ' readable pages in this bundle (Rule 8: budgets are caps, never floors)') };
  }
  const captured = captureOnePage(page, fetchedAt);
  if (captured.error) return { action: 'skip', error: captured.error };
  const artifact = captured.artifact;
  if (state.seenIds.has(artifact.evidence_id)) {
    return { action: 'skip', error: new LaneError('capture', 'duplicate_evidence_id', 'duplicate URL/lane capture for ' + JSON.stringify(artifact.url) + ' (evidence_id ' + artifact.evidence_id + ' already captured this run; the earlier bytes are kept, never silently overwritten)') };
  }
  if (state.totalBytes + artifact.length > MAX_TOTAL_BYTES) {
    return { action: 'stop', error: new LaneError('capture', 'byte_budget_exceeded', 'capture stopped: total captured text would exceed ' + MAX_TOTAL_BYTES + ' bytes (Rule 8: budgets are caps, never floors)') };
  }
  return { action: 'accept', artifact };
}

// recordAccepted(state, artifacts, artifact) -> pushes artifact into both the running state (so later
// pages are checked against it) and the accepted-artifacts list.
function recordAccepted(state, artifacts, artifact) {
  artifacts.push(artifact);
  state.seenIds.add(artifact.evidence_id);
  state.totalBytes += artifact.length;
  state.count += 1;
}

// captureAllPages(pages, fetchedAt) -> { artifacts, errors }. Walks pages in order, dispatching each to
// processOnePage(); 'stop' ends the walk immediately (a hit budget), 'skip' records the error and moves
// on, 'accept' records the artifact and updates the running budget/duplicate state.
function captureAllPages(pages, fetchedAt) {
  const artifacts = [];
  const errors = [];
  const state = { seenIds: new Set(), totalBytes: 0, count: 0 };
  for (const page of pages) {
    const outcome = processOnePage(page, fetchedAt, state);
    if (outcome.action === 'stop') { errors.push(outcome.error); break; }
    if (outcome.action === 'skip') { errors.push(outcome.error); continue; }
    recordAccepted(state, artifacts, outcome.artifact);
  }
  return { artifacts, errors };
}

function buildCaptureIndex(bundle, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const fetchedAt = new Date(now()).toISOString();
  const { artifacts, errors } = captureAllPages(pagesOfBundle(bundle), fetchedAt);
  const unreachable = unreachableSiteError(o.stageManifest);
  if (unreachable) errors.push(unreachable);
  return new ArtifactStore(artifacts, errors);
}

module.exports = { buildCaptureIndex, normaliseWhitespace, sha256Hex, evidenceIdFor, ArtifactStore };
