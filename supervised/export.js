'use strict';
// supervised/export.js - `engine export --run <id>` (Kimi K3 render-debug §1b step 3 + §2's assembly
// point + the exporter this session's brief asks for). PURE: reads the run's manifest + the (rehydrated)
// artifact store, and builds the payload the website bridge consumes - manifest + artifacts -> payload,
// nothing invented, nothing paraphrased.
//
// Per pointer this emits:
//   state          'CONFIRMED' | 'needs_review' | 'rejected' - mapped from supervised/signoff.js's
//                  deriveStatus() (confirmed/needs_human/rejected), NEVER a hand-set field (Kimi §1b's
//                  "status is a derived view" rule, carried through to export).
//   evidence_quote / evidence_sha256 / evidence_truncated - via supervised/excerpts.js's resolveSpanText,
//                  the ONE place a quote is assembled (§2's "never reconstructed or paraphrased in the
//                  bridge/adapter" - this exporter IS the engine-side assembly point named there).
//   checked_urls   the full searched-page list for absence findings; the observed page for text/network/
//                  dom findings (resolveSpanText's own per-kind rule).
//   applicable / jurisdiction - read straight from the engine's OWN applicability stage (Kimi R6: "the
//                  website adapter filters on ENGINE truth, not its own heuristics") - never re-derived by
//                  a downstream string heuristic.
// payload.rules = { assessed, applicable } - the applicability ledger's own totals (the "62 assessed / 18
// applicable" credibility backbone Kimi's §3 table names).

const { ManifestStore } = require('./manifest-store.js');
const { resolveSpanText } = require('./excerpts.js');
const { deriveStatus, latestCandidateFindings } = require('./signoff.js');

function asManifestStore(store) {
  return store instanceof ManifestStore ? store : new ManifestStore();
}

function latestEntry(store, runId, stage) {
  const entries = asManifestStore(store).entriesOfStage(runId, stage);
  return entries.length ? entries[entries.length - 1] : null;
}

// STATUS_TO_STATE: the single source of truth mapping this engine's derived status onto the state label
// the website bridge's ENGINE_STATE_MAP (Kimi §1a) expects on the wire. Fail-closed default is
// 'needs_review' (an unknown/undecided finding is never CONFIRMED by omission).
const STATUS_TO_STATE = Object.freeze({ confirmed: 'CONFIRMED', rejected: 'rejected', needs_human: 'needs_review' });

function stateFor(status) {
  return STATUS_TO_STATE[status] || 'needs_review';
}

// ruleRecordFor(catalogue, ruleId) -> the catalogue record for a rule_id, or null. Read-only lookup,
// never a second catalogue.
function ruleRecordFor(catalogue, ruleId) {
  const records = (catalogue && (catalogue.records || catalogue)) || [];
  return (Array.isArray(records) ? records : []).find((r) => r && r.id === ruleId) || null;
}

// applicabilityInfo(store, runId) -> { assessed, applicableIds: Set } from the run's OWN 'applicability'
// manifest stage (applicability-ledger.js's projection of applicability/connect.js's real decision) -
// never re-derived here by a second heuristic (Kimi R6).
function applicabilityInfo(store, runId) {
  const entry = latestEntry(store, runId, 'applicability');
  const applicableIds = new Set(entry && Array.isArray(entry.applicable) ? entry.applicable : []);
  const excludedCount = entry && Number.isInteger(entry.excludedCount) ? entry.excludedCount : 0;
  const assessed = applicableIds.size + excludedCount;
  return { assessed, applicable: applicableIds.size, applicableIds };
}

// pointerFor(finding, { store, runId, captureIndex, catalogue, applicability }) -> one exported pointer.
function pointerFor(finding, ctx) {
  const status = deriveStatus(ctx.store, ctx.runId, finding.finding_id);
  const resolved = resolveSpanText(ctx.captureIndex, finding, {});
  const record = ruleRecordFor(ctx.catalogue, finding.rule_id);
  return {
    finding_id: finding.finding_id,
    rule_id: finding.rule_id,
    jurisdiction: finding.jurisdiction || (record && record.jurisdiction) || null,
    applicable: ctx.applicability.applicableIds.has(finding.rule_id),
    state: stateFor(status),
    evidence_quote: resolved.quote,
    evidence_sha256: resolved.sha256,
    evidence_truncated: resolved.truncated || undefined,
    checked_urls: resolved.checkedUrls,
  };
}

// exportRun(store, runId, { captureIndex, catalogue }) -> the payload object. `captureIndex` is the SAME
// live ArtifactStore the run was made with (or an equivalent re-hydrated store) - without one, every
// pointer's evidence_quote/checked_urls resolves to empty (fail closed, never fabricated), matching
// resolveSpanText's own contract.
function exportRun(store, runId, opts) {
  const o = opts || {};
  const s = asManifestStore(store);
  const runStart = latestEntry(s, runId, 'run_start');
  const findings = latestCandidateFindings(s, runId);
  const applicability = applicabilityInfo(s, runId);
  const ctx = { store: s, runId, captureIndex: o.captureIndex || null, catalogue: o.catalogue || null, applicability };
  const pointers = findings.map((f) => pointerFor(f, ctx));
  return {
    kind: 'audit-payload',
    engine_run: {
      run_id: runId,
      engine_version: runStart && runStart.engine_version,
      catalogue_hash: runStart && runStart.catalogue_hash,
      site: runStart && runStart.site,
    },
    rules: { assessed: applicability.assessed, applicable: applicability.applicable },
    pointers,
  };
}

module.exports = { exportRun, stateFor, STATUS_TO_STATE };
