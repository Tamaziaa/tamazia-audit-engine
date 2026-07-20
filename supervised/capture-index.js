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

// stableStringify(value) -> canonical JSON with recursively sorted object keys. THE one canonicaliser for
// every derived evidence artifact this module (and coverage-proof.js, quote-resolver.js, mint-gate.js)
// produces - Rule 1, one door - so two callers hashing "the same" object always land on the same bytes.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// MAX_EVIDENCE_LANE_BYTES: a separate cap on one derived evidence-lane artifact (dom/network/register/
// coverage), independent of MAX_TOTAL_BYTES which only budgets the page-text lane (Rule 8: a cap, never a
// floor). Hitting it fails the WHOLE capture closed with a typed LaneError - a truncated evidence lane
// would silently under-report DOM/network surface, which the non-quote lane must never do.
const MAX_EVIDENCE_LANE_BYTES = 32 * 1024 * 1024;

// captureEvidenceArtifact({lane, key, rows, derivedFrom, fetchedAt, origin}) -> a frozen artifact whose
// bytes are one stableStringify'd JSON object per line (a canonical "evidence log"), or null when rows is
// empty (never an empty-but-present artifact - Rule 4: no evidence captured is a fact recorded by the
// artifact's ABSENCE, not a zero-row artifact standing in for it). Throws LaneError (fail-closed) if the
// serialised bytes would exceed MAX_EVIDENCE_LANE_BYTES.
function captureEvidenceArtifact({ lane, key, rows, derivedFrom, fetchedAt, origin }) {
  if (!rows || !rows.length) return null;
  const bytes = Buffer.from(rows.map((r) => stableStringify(r)).join('\n'), 'utf8');
  if (bytes.length > MAX_EVIDENCE_LANE_BYTES) {
    throw new LaneError('capture', 'evidence_budget_exceeded', 'evidence lane ' + JSON.stringify(lane) + ' for ' + JSON.stringify(key) + ' would serialise to ' + bytes.length + ' bytes, over the ' + MAX_EVIDENCE_LANE_BYTES + '-byte cap (Rule 8: budgets are caps, never floors)');
  }
  return Object.freeze({
    evidence_id: evidenceIdFor(key, lane), url: key, lane,
    sha256: sha256Hex(bytes), length: bytes.length, fetched_at: fetchedAt, bytes,
    rawAvailable: false, rawBytes: null, rawSha256: null, rawLength: null, boundaries: [],
    origin: origin || 'derived',
    derived: origin !== 'external',
    derivedFrom: Object.freeze((derivedFrom || []).map((d) => Object.freeze({ evidence_id: d.evidence_id, sha256: d.sha256 }))),
  });
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
  // addDerived(artifact) - used by the non-quote resolution lane (quote-resolver.js's resolveEvidenceSpan)
  // to register a coverage-proof artifact it built ON DEMAND at resolve time (the ONLY caller allowed to
  // add an artifact after buildCaptureIndex's own initial capture pass). Requires a genuinely derived
  // artifact (derived:true) carrying provenance, and refuses a duplicate id (an artifact, once captured,
  // is immutable - a second add for the same evidence_id would silently make "which bytes are the real
  // ones" ambiguous).
  addDerived(artifact) {
    if (!artifact || artifact.derived !== true) {
      throw new LaneError('capture', 'derived_artifact_malformed', 'addDerived requires a derived artifact with derivedFrom provenance');
    }
    if (this._byId.has(artifact.evidence_id)) return; // idempotent: reuse the already-registered artifact
    this._byId.set(artifact.evidence_id, artifact);
  }
  toJSON() {
    // Bytes are NOT serialised into the manifest (they can be large, and the manifest's job is provenance,
    // not a second copy of the corpus - text/byte content stays retrievable from the bundle/replay inputs).
    // The hash IS the manifest's proof; that is the whole point of a hash-chained index.
    return {
      artifacts: this.list().map((a) => ({
        evidence_id: a.evidence_id, url: a.url, lane: a.lane, sha256: a.sha256, length: a.length, fetched_at: a.fetched_at,
        // Kimi K3 R2 finding A22/#27 (live audit 2026-07-20): the manifest projection dropped the raw
        // provenance fields, so a manifest-only re-audit (no live bytes) could never re-run the phantom-join
        // check verifyRawProvenanceDetailed performs - the raw sha256, its availability, and the boundary map
        // are provenance facts and belong in the manifest exactly like the normalised sha256 does.
        raw_sha256: a.rawSha256 || null, raw_available: Boolean(a.rawAvailable), boundaries: Array.isArray(a.boundaries) ? a.boundaries : [],
        // Non-quote evidence-lane provenance (Kimi K3 10Q Q1(b)): a manifest reader must be able to see
        // WHICH artifacts are derived and from what, without the bytes - same doctrine as the raw fields
        // above.
        origin: a.origin || 'external', derived: Boolean(a.derived),
        derived_from: Array.isArray(a.derivedFrom) ? a.derivedFrom.map((d) => ({ evidence_id: d.evidence_id, sha256: d.sha256 })) : [],
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
  const raw = captureRawFor(page, normalised);
  return {
    error: null,
    // Kimi K3 R2 finding #41 (live audit 2026-07-20): the artifact metadata is frozen before it leaves this
    // function (belt-and-braces: span_sha256 already anchors the bytes, but freezing the record stops any
    // consumer silently reassigning evidence_id/sha256/boundaries after capture, and lets verify-quote.js's
    // integrity cache trust the record's immutability). The Buffer contents stay mutable (freeze is shallow),
    // so a tamper-detection test that flips a byte in place still exercises the hash-mismatch path.
    artifact: Object.freeze({
      evidence_id: evidenceIdFor(page.url, 'static'), url: page.url, lane: 'static', sha256: sha256Hex(bytes), length: bytes.length, fetched_at: fetchedAt, bytes,
      // ── raw-vs-normalised durability fields (Kimi K3 HIGH-E2, see the section below) ──
      rawAvailable: Boolean(raw),
      rawBytes: raw ? raw.rawBytes : null,
      rawSha256: raw ? raw.rawSha256 : null,
      rawLength: raw ? raw.rawBytes.length : null,
      boundaries: raw ? raw.boundaries : [],
    }),
  };
}

// ── raw-vs-normalised durability (Kimi K3 HIGH-E2) ─────────────────────────────────────────────────────
// The hash chain above anchors ONLY to the NORMALISED text (this module's own bytes convention, documented
// at the top of this file). That proves the normalised buffer is untouched; it does NOT prove the
// normalised buffer corresponds to what actually shipped on the page - a future normaliser bug, or a
// phantom sentence stitched from two unrelated sibling DOM nodes (a "Free"+"VPS" pill-badge pair joined
// into "Free VPS"), would verify perfectly under the existing scheme alone. This section adds a SECOND,
// independent commitment: the RAW fetched bytes (page.rawHtml, when the crawler supplies it -
// evidence/crawler/crawl.js's contentPageFrom), plus a raw<->normalised boundary map so
// supervised/verify-quote.js's verifyRawProvenance() can tell whether a quoted span crosses a point where
// two originally separate raw text runs were stitched together with NO source separator between them. This
// is ADDITIVE ONLY: every field/behaviour above is unchanged, and a page with no rawHtml (an older bundle
// or a replay/manifest-rehydrated record) simply captures without it (rawAvailable:false, never a
// fabricated commitment for bytes that were never actually captured - Rule 4, fail closed).

const MAX_RAW_PAGE_BYTES = 4 * 1024 * 1024; // per-page cap on raw HTML captured (Rule 8: a cap, never a floor)

// decodeBasicEntities(s) -> the small set of entities that would otherwise break a raw-text-run match
// against the (already fully entity-decoded) normalised buffer built by extract.js's stripHtml. Deliberately
// a SMALL, independent list: this function only has to make run-location succeed often enough to build a
// boundary map, not reproduce extract.js's full decoder (which stays the one producer of the actual
// decoded corpus text - Rule 1; a run this cannot locate is simply skipped, see buildBoundaryMap).
function decodeBasicEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

// splitTextRuns(rawHtml) -> ordered array of trimmed, whitespace-collapsed, non-empty text runs found
// between HTML tags/comments/non-content elements, in DOM order. A small, independent, purpose-built
// re-implementation (NOT an import of extract.js's stripHtml) - it exists only to locate WHERE stripHtml's
// own separators fall in its output, never to produce the corpus text itself.
function splitTextRuns(rawHtml) {
  let s = String(rawHtml == null ? '' : rawHtml);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<(?:script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*$/i, ' ');
  const runs = [];
  const re = /<[^>]+>/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const seg = normaliseWhitespace(decodeBasicEntities(s.slice(last, m.index))).trim();
    if (seg) runs.push(seg);
    last = re.lastIndex;
  }
  const tail = normaliseWhitespace(decodeBasicEntities(s.slice(last))).trim();
  if (tail) runs.push(tail);
  return runs;
}

// boundaryPunctuated(before, after) -> false exactly when NEITHER side of a raw-run join carries a
// sentence/word-closing (before) or -opening (after) character - the phantom-join signature: two sibling
// raw text nodes concatenated with no source separator ever having existed between them.
function boundaryPunctuated(before, after) {
  const endsPunct = /[.!?:;,)\]}"'’”-]\s*$/.test(before);
  const startsPunct = /^\s*[("'‘“[-]/.test(after);
  return endsPunct || startsPunct;
}

// buildBoundaryMap(normalisedText, runs) -> ordered [{ charOffset, byteOffset, punctuated }] for every
// point where two consecutive raw text runs meet inside `normalisedText` (stripHtml's own output, read
// verbatim - this function never mutates or re-derives it). Runs are located with a MONOTONIC search
// cursor, so a run this cannot find (a whitespace-collapse edge case between the two independent stripping
// implementations) is skipped rather than mis-anchored: a missed boundary makes the map UNDER-report risk,
// it can never fabricate one.
function buildBoundaryMap(normalisedText, runs) {
  const boundaries = [];
  let searchFrom = 0;
  let prevEnd = -1;
  let prevRun = '';
  for (const run of runs) {
    const idx = normalisedText.indexOf(run, searchFrom);
    if (idx === -1) continue;
    if (prevEnd !== -1 && idx > prevEnd) {
      boundaries.push({
        charOffset: prevEnd,
        byteOffset: Buffer.byteLength(normalisedText.slice(0, prevEnd), 'utf8'),
        punctuated: boundaryPunctuated(prevRun, run),
      });
    }
    prevEnd = idx + run.length;
    searchFrom = prevEnd;
    prevRun = run;
  }
  return boundaries;
}

// captureRawFor(page, normalisedText) -> { rawBytes, rawSha256, boundaries } | null. null when the page
// carries no rawHtml (older bundle/replay input, or a single page whose raw body exceeds MAX_RAW_PAGE_BYTES)
// - the caller records rawAvailable:false rather than fabricating a raw commitment for bytes that were
// never actually captured (Rule 4: fail closed on the raw layer specifically, the normalised capture above
// is entirely unaffected either way).
function captureRawFor(page, normalisedText) {
  if (typeof page.rawHtml !== 'string' || !page.rawHtml) return null;
  const rawBytes = Buffer.from(page.rawHtml, 'utf8');
  if (rawBytes.length > MAX_RAW_PAGE_BYTES) return null;
  const runs = splitTextRuns(page.rawHtml);
  const boundaries = buildBoundaryMap(normalisedText, runs);
  return { rawBytes, rawSha256: sha256Hex(rawBytes), boundaries };
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

// ── non-quote evidence lanes (Kimi K3 10Q Q1(b)) ──────────────────────────────────────────────────────
// The dom/network/register lanes below capture the SAME bundle.browser/bundle.registers surface
// breach/proposers/propose.js already reads to build candidates (Rule 1: no second crawler, no second
// evidence source) into their own hash-chained "evidence log" artifacts, so a dom_node/network_event/
// register_absence candidate can be anchored with the SAME {evidence_id,byte_start,byte_end,span_sha256}
// a quote uses, into a real, re-derivable artifact - never a fake span into an unrelated page.
//
// contentShaFor(row) -> sha256 of the row's OWN stableStringify'd bytes (excluding the `i` index this
// module stamps on): the stable "this row is the same real observation" key quote-resolver.js's
// resolveEvidenceSpan uses to find a candidate's row in the lane artifact, independent of row order.
function contentShaFor(row) {
  const rest = Object.assign({}, row);
  delete rest.i;
  return sha256Hex(Buffer.from(stableStringify(rest), 'utf8'));
}

// domLaneKey(bundle) -> the one evidence_id key the whole run's dom-node lane captures under (the DOM
// violation lane is a SITE-WIDE observation, evidence/browser/dom-assert.js does not key per-page in the
// bundle.browser.domNodes shape) - so one dom evidence-log artifact per run, not per page.
function siteKeyOf(bundle) {
  return (bundle && bundle.domain) || (bundle && bundle.corpus && bundle.corpus.pages && bundle.corpus.pages[0] && bundle.corpus.pages[0].url) || 'unknown-site';
}

// domLaneRows(domNodes) -> [{i, contentSha, ...node}] in observed order. `contentSha` is stamped onto the
// row itself (not just used to compute the artifact hash) so a consumer can locate a row without
// re-deriving the hash from the node fields a second time.
function domLaneRows(domNodes) {
  return (Array.isArray(domNodes) ? domNodes : []).map((node, i) => {
    const row = Object.assign({ i }, node);
    return Object.assign(row, { contentSha: contentShaFor(row) });
  });
}
function networkLaneRows(observed) {
  return (Array.isArray(observed) ? observed : []).map((ev, i) => {
    const row = Object.assign({ i }, ev);
    return Object.assign(row, { contentSha: contentShaFor(row) });
  });
}
// registerLaneRows(registers) -> [{i, register, note, contentSha}] - one row per register's recorded
// `notes` entry (the register lane's own definitive-outcome record; see propose.js's evalRegister). Rows
// with no notes carry nothing to capture (an un-run/skipped lane, recorded upstream as a suppression, not
// a fabricated empty row here).
function registerLaneRows(registers) {
  const out = [];
  const notes = Array.isArray(registers && registers.notes) ? registers.notes : [];
  notes.forEach((note, i) => {
    const row = { i, register: note && note.register, note };
    out.push(Object.assign(row, { contentSha: contentShaFor(row) }));
  });
  return out;
}

// captureEvidenceLanes(bundle, artifacts, fetchedAt) -> pushes dom/network/register evidence-log
// artifacts onto `artifacts` (mutating, mirroring captureAllPages's own accumulator style) when the bundle
// carries non-empty rows for that lane; captureEvidenceArtifact's own null-on-empty rule means an
// unobserved lane simply contributes nothing (never a fabricated zero-row artifact). Throws LaneError
// (fail-closed, MAX_EVIDENCE_LANE_BYTES) if any one lane's serialised bytes are oversized - this is not
// caught here; buildCaptureIndex lets it propagate so a caller sees the SAME fail-closed contract the page
// lane's own budgets already give.
function captureEvidenceLanes(bundle, artifacts, fetchedAt) {
  const browser = bundle && bundle.browser;
  const siteKey = siteKeyOf(bundle);
  const domRows = domLaneRows(browser && browser.domNodes);
  if (domRows.length) {
    artifacts.push(captureEvidenceArtifact({ lane: 'dom', key: siteKey, rows: domRows, fetchedAt, origin: 'derived', derivedFrom: [] }));
  }
  const networkRows = networkLaneRows(browser && browser.observed);
  if (networkRows.length) {
    artifacts.push(captureEvidenceArtifact({ lane: 'network', key: siteKey, rows: networkRows, fetchedAt, origin: 'derived', derivedFrom: [] }));
  }
  const registers = (bundle && bundle.registers) || {};
  const registerKeys = Object.keys(registers).filter((k) => k !== 'notes');
  for (const regKey of registerKeys) {
    const rows = registerLaneRows({ notes: (registers.notes || []).filter((n) => n && n.register === regKey) });
    if (rows.length) {
      artifacts.push(captureEvidenceArtifact({ lane: 'register', key: regKey, rows, fetchedAt, origin: 'external', derivedFrom: [] }));
    }
  }
  // A register whose ONLY notes were captured above under their own register-keyed artifact; a bundle that
  // carries notes but no matching top-level register key still gets ONE artifact per distinct note.register
  // value, so a register key that only ever appears inside `notes` (never as its own bundle.registers[key])
  // is not silently dropped.
  const noteOnlyKeys = [...new Set((registers.notes || []).map((n) => n && n.register).filter(Boolean))].filter((k) => !registerKeys.includes(k));
  for (const regKey of noteOnlyKeys) {
    const rows = registerLaneRows({ notes: (registers.notes || []).filter((n) => n && n.register === regKey) });
    if (rows.length) {
      artifacts.push(captureEvidenceArtifact({ lane: 'register', key: regKey, rows, fetchedAt, origin: 'external', derivedFrom: [] }));
    }
  }
}

function buildCaptureIndex(bundle, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  // Kimi K3 R2 finding #46 (live audit 2026-07-20): a bad injected clock (NaN/Infinity/non-number) fed
  // straight into `new Date(t).toISOString()` throws a raw RangeError that aborts the whole capture. A
  // capture must degrade to an honest 'unknown' timestamp, never crash (Rule 4: a malformed input BLOCKS
  // the one field it affects, it does not take down the run).
  const t = now();
  const fetchedAt = Number.isFinite(t) ? new Date(t).toISOString() : 'unknown';
  const { artifacts, errors } = captureAllPages(pagesOfBundle(bundle), fetchedAt);
  if (fetchedAt === 'unknown') errors.push(new LaneError('capture', 'bad_clock', 'the injected clock returned a non-finite value; fetched_at recorded as "unknown" rather than crashing the capture'));
  const unreachable = unreachableSiteError(o.stageManifest);
  if (unreachable) errors.push(unreachable);
  try {
    captureEvidenceLanes(bundle, artifacts, fetchedAt);
  } catch (e) {
    if (e instanceof LaneError) errors.push(e); else throw e;
  }
  return new ArtifactStore(artifacts, errors);
}

module.exports = {
  buildCaptureIndex, normaliseWhitespace, sha256Hex, evidenceIdFor, ArtifactStore,
  stableStringify, captureEvidenceArtifact, MAX_EVIDENCE_LANE_BYTES, contentShaFor, siteKeyOf,
};
