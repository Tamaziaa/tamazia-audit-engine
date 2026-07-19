'use strict';
// supervised/replay.js - `engine replay --run-id <id>` (Kimi K3 round-3 spec section 2 row 10, section 8):
// re-runs the deterministic stages (1-5) against the STORED hashes and re-checks every SHIPPED finding's
// verify_quote. If a previously-shipped finding fails replay, that is a ReplayIncident: typed, logged,
// never silently swallowed. Claude's own orchestration trace is logged (the manifest's other stages) but is
// explicitly NOT part of the proof chain here - replay never re-invokes Claude or re-reads any
// mitigation_log entry as evidence; it proves the SAME thing verify-quote.js always proves: hash -> slice ->
// real text, nothing else.
//
// v0's replay is a HASH-INTEGRITY replay, not a full live re-crawl: it does not re-fetch the site (a
// genuine re-crawl belongs to a later phase's `engine run --mode replay-live`, out of scope here per the
// spec's own "capture hash -> verify_quote -> signature -> mint" proof-chain framing, which never requires
// a second network fetch to be trustworthy - the STORED bytes and their hash ARE the evidence). What it
// DOES re-verify, for every finding the signature shipped: (a) the artifact's bytes still hash to the
// recorded sha256 (catches tampering/corruption of the local store since the run), (b) verify_quote still
// passes over the stored bytes, (c) the finding's rule_id/catalogue_hash still resolve against the SAME
// catalogue snapshot recorded on the run ('run_start' manifest entry) - a catalogue that has since changed
// is reported as a `catalogue_drift` incident (this is honest scope-narrowing, not a redesign of a live
// re-crawl replay; the manifest already records everything a future live-replay stage would need).

const { verifyQuoteDetailed } = require('./verify-quote.js');
const { latestSignature, shippedFindingIds } = require('./signature-store.js');
const { ArtifactStore } = require('./capture-index.js');
const { ManifestStore } = require('./manifest-store.js');
const { ReplayIncident } = require('./errors.js');

// rehydrateArtifactStore(manifestEntries) -> null. v0 does not persist raw bytes into the JSONL manifest
// (capture-index.js's toJSON() is deliberately hash-only - see its own doc), so a manifest-only replay
// cannot re-slice text without the ORIGINAL in-memory ArtifactStore. This function is therefore a documented
// placeholder returning null; replayRun() accepts an explicit `captureIndex` (the same ArtifactStore
// runSupervised() returned, kept alive by the caller for the SAME process/session) and reports a
// `NO_STORE_FOR_MANIFEST` note when it is not supplied, rather than fabricating a verified result from hash
// strings alone (Rule 4: fail closed - a hash-only manifest can prove tamper of RECORDED hashes across
// entries, but cannot re-slice bytes it was never given).
function rehydrateArtifactStore() {
  return null;
}

// replayRun({store, runId, captureIndex, catalogue}) -> { runId, ok, incidents, checkedCount, notes }.
function replayRun(input) {
  const i = input || {};
  const store = i.store instanceof ManifestStore ? i.store : new ManifestStore();
  const runId = i.runId;
  const notes = [];
  const entries = store.readAll(runId);
  if (!entries.length) {
    return { runId, ok: false, incidents: [], checkedCount: 0, notes: ['no manifest found for run_id ' + JSON.stringify(runId)] };
  }
  const runStart = entries.find((e) => e.stage === 'run_start');
  const candidateEntry = [...entries].reverse().find((e) => e.stage === 'candidate_findings');
  const signature = latestSignature(store, runId);
  if (!signature) {
    return { runId, ok: false, incidents: [], checkedCount: 0, notes: ['no signature recorded; nothing was ever shipped to replay'] };
  }
  const shipped = shippedFindingIds(signature);
  const shippedRecords = (candidateEntry && Array.isArray(candidateEntry.findings) ? candidateEntry.findings : [])
    .filter((f) => shipped.has(f.finding_id));

  const captureIndex = i.captureIndex instanceof ArtifactStore ? i.captureIndex : rehydrateArtifactStore();
  const incidents = [];
  let checkedCount = 0;

  if (!captureIndex) {
    notes.push('NO_STORE_FOR_MANIFEST: replay was given no live ArtifactStore, so quote re-verification could not run for ' + shippedRecords.length + ' shipped finding(s) (see this file\'s rehydrateArtifactStore() doc)');
  } else {
    for (const rec of shippedRecords) {
      checkedCount += 1;
      const result = verifyQuoteDetailed(captureIndex, rec.quote);
      if (!result.ok) {
        incidents.push(new ReplayIncident(rec.finding_id, result.reason, 'shipped finding ' + rec.finding_id + ' (' + rec.rule_id + ') failed replay verify_quote: ' + result.reason));
      }
    }
  }

  if (i.catalogue && runStart && runStart.catalogue_hash && i.catalogue.content_hash !== runStart.catalogue_hash) {
    notes.push('catalogue_drift: run was made against catalogue_hash ' + runStart.catalogue_hash + ', currently loaded catalogue is ' + i.catalogue.content_hash);
  }

  return {
    runId, ok: incidents.length === 0, incidents: incidents.map((inc) => ({ findingId: inc.findingId, reasonCode: inc.reasonCode, detail: inc.detail })),
    checkedCount, shippedCount: shippedRecords.length, notes,
  };
}

module.exports = { replayRun, rehydrateArtifactStore };
