'use strict';
// eval/e2e/lib/redteam.js - the red-team lane (docs/P3-ACCEPTANCE.md wave 3, caution.md C-165):
// adversarial fixtures that try to make the engine fabricate. ABSENCE of eval/red-team/fixtures.json
// is handled as an honest, whole-lane skip (never a fabricated pass on zero entries - the same C-037
// doctrine as a skipped breach stage).
//
// eval/red-team/fixtures.json landed mid-build with a richer, per-fixture-bespoke shape than a single
// generic contract can fully express (nine adversarial classes, RT-A through RT-H; see its own
// `doctrine`/`bundle_shape_ref` blocks). This module supports it in two layers:
//
//   1. BESPOKE per-id handlers (eval/e2e/lib/redteam-handlers.js) for the entries whose `input` is not
//      a plain crawl-shaped EvidenceBundle (RT-D: fetch + honest/naive bundle; RT-G: cookies +
//      browser_script; RT-H: bare corpus strings), or whose correct handling needs xfail semantics
//      (RT-F: a known, already-tracked escape). An id with a bespoke handler is dispatched there first.
//   2. A GENERIC evaluator for everything else: resolve a runnable EvidenceBundle from the entry
//      (`entry.input.bundle`, or this file's own originally-documented `entry.bundle`/`entry.fixture`/
//      `entry.domain` shapes, kept for forward compatibility), run it through the real pipeline, and
//      check every STRING value (and every string inside an array value) anywhere in `entry.must_not`
//      as a forbidden token against the pipeline's findings and its whole serialised output. Boolean
//      flags (most of this file's `must_not` clauses - e.g. RT-B1/RT-B2/RT-E are ENTIRELY boolean
//      flags describing a behavioural invariant) carry no searchable text and so contribute nothing:
//      those entries fall through to an honest 'skipped', never a fabricated 'caught' on a check that
//      never actually ran.
//
// `target_gate` in the real file is an object ({gate, status, ...}), not a bare stage name; this file's
// ORIGINAL assumed contract (a bare string naming one of this harness's own stage names) is still
// checked as a harmless, forward-compatible fallback, but the real file's own `current_status`/
// `target_gate.status === 'pending_gate'` (the gate does not exist on disk at all) is the primary,
// authoritative "skip this, it cannot be evaluated yet" signal, read directly from the fixture's own
// declared truth rather than guessed.

const fs = require('fs');
const path = require('path');

const { RT_HANDLERS } = require('./redteam-handlers.js');

function normaliseEntries(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  if (data && Array.isArray(data.fixtures)) return data.fixtures;
  return null;
}

// loadRedTeamFixtures(filePath) -> {present, entries, parseError?}. Never throws.
function loadRedTeamFixtures(filePath) {
  if (!fs.existsSync(filePath)) return { present: false, entries: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { present: true, entries: [], parseError: e.message };
  }
  const entries = normaliseEntries(data);
  if (entries === null) {
    return { present: true, entries: [], parseError: 'unrecognised top-level shape (expected an array or {entries:[...]}/{fixtures:[...]})' };
  }
  return { present: true, entries };
}

const STAGE_NAMES = new Set(['facts', 'coverage', 'propose', 'verify', 'adjudicate']);

// pendingGateReason(entry) -> a reason string when the fixture ITSELF declares its target gate is not
// on disk yet (current_status:'pending_gate', or target_gate.status:'pending_gate'), else null. This
// reads the real file's own authoritative status rather than guessing.
function pendingGateReason(entry) {
  if (entry.current_status === 'pending_gate') return 'fixture declares current_status: pending_gate';
  const tg = entry.target_gate;
  if (tg && typeof tg === 'object' && tg.status === 'pending_gate') {
    return 'fixture declares target_gate.status: pending_gate (' + (tg.gate || 'unnamed gate') + ')';
  }
  return null;
}

// targetGateUnavailable(entry, stageTable) -> the gate NAME when entry.target_gate/gate/target is a
// BARE STRING naming one of this harness's own stage names and that stage did not run (the harness's
// originally-documented, generic contract - kept as a forward-compatible fallback since the real file
// uses a richer object shape handled by pendingGateReason() above instead).
function targetGateUnavailable(entry, stageTable) {
  const gate = entry.target_gate || entry.gate || entry.target || null;
  if (typeof gate !== 'string' || !STAGE_NAMES.has(gate)) return null;
  const row = (stageTable || []).find((s) => s.stage === gate);
  if (!row || row.status !== 'ran') return gate;
  return null;
}

// resolveBundle(entry, fixturesDir) -> an EvidenceBundle, or null when the entry carries none this
// harness knows how to resolve. entry.input.bundle (the real landed file's shape) is tried first.
function resolveBundle(entry, fixturesDir) {
  if (entry.input && entry.input.bundle && typeof entry.input.bundle === 'object') return entry.input.bundle;
  if (entry.bundle && typeof entry.bundle === 'object') return entry.bundle;
  if (entry.fixture) {
    const p = path.isAbsolute(entry.fixture) ? entry.fixture : path.join(fixturesDir, entry.fixture);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  if (entry.domain) {
    const p = path.join(fixturesDir, entry.domain + '.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

// mustNotTerms(entry) -> every forbidden token this generic harness can search for: any STRING value
// anywhere in entry.must_not, and every STRING found inside an ARRAY value. Boolean flags (the
// majority of this fixture file's must_not clauses) describe a behavioural invariant no generic token
// search can check; they contribute nothing, and an entry with only boolean flags falls through to an
// honest 'skipped' rather than a false 'caught' on a check that never ran.
function mustNotTerms(entry) {
  const mn = (entry && entry.must_not) || {};
  const terms = [];
  for (const value of Object.values(mn)) {
    if (typeof value === 'string') terms.push(value);
    else if (Array.isArray(value)) { for (const v of value) if (typeof v === 'string') terms.push(v); }
  }
  return terms;
}

// findingsText(pipelineResult) -> a lowercased text blob of the pipeline's own findings[].
function findingsText(pipelineResult) {
  return (pipelineResult.breach.findings || []).map((f) => JSON.stringify(f)).join(' \n ').toLowerCase();
}

// wholeOutputText(pipelineResult) -> a lowercased text blob of the WHOLE pipeline output (payload +
// coverage), so a fabrication escaping through any stage - not only findings[] - is still caught
// (defence in depth).
function wholeOutputText(pipelineResult) {
  try {
    return JSON.stringify({ payload: pipelineResult.payload, coverage: pipelineResult.coverage }).toLowerCase();
  } catch (e) {
    // FAIL-OPEN: a circular or unserialisable pipeline result must not crash the red-team lane; an
    // empty corpus here simply means this defence-in-depth check can never hit on its own - the
    // entry's own findings-text check (findingsText) still runs independently regardless.
    return '';
  }
}

// evaluateMustNot(entry, pipelineResult) -> {status:'caught'|'escaped'|'skipped', reason?}.
function evaluateMustNot(entry, pipelineResult) {
  const terms = mustNotTerms(entry);
  if (terms.length === 0) {
    return {
      status: 'skipped',
      reason: 'entry carries no must_not value this generic harness can search for as a forbidden token (only boolean flags) - it may need bespoke wiring, see its own "wiring" field',
    };
  }
  const corpus = findingsText(pipelineResult) + ' \n ' + wholeOutputText(pipelineResult);
  const hit = terms.find((t) => corpus.includes(String(t).toLowerCase()));
  return hit ? { status: 'escaped', reason: 'matched forbidden token: ' + JSON.stringify(hit) } : { status: 'caught' };
}

// runGenericEntry(entry, ctx) -> {status, reason?} via the generic bundle + must_not-token path.
async function runGenericEntry(entry, ctx, id) {
  const pending = pendingGateReason(entry);
  if (pending) return { status: 'skipped', reason: pending };

  const gateReason = targetGateUnavailable(entry, ctx.stageTable);
  if (gateReason) return { status: 'skipped', reason: 'target gate "' + gateReason + '" is not available in this run' };

  const bundle = resolveBundle(entry, ctx.fixturesDir);
  if (!bundle) {
    return { status: 'skipped', reason: 'no runnable bundle (entry carries no usable input.bundle/bundle/fixture/domain) - this fixture may need bespoke wiring, see its own "wiring" field' };
  }

  let pipelineResult;
  try {
    pipelineResult = await ctx.runPipelineForBundle(entry.domain || id, bundle);
  } catch (e) {
    // FAIL-OPEN: a red-team fixture that makes the PIPELINE ITSELF throw is a distinct failure mode
    // from a fabrication escaping - it is recorded loudly as 'error' (not 'skipped', not 'caught') so
    // a crash on adversarial input is never mistaken for the gate having held.
    return { status: 'error', reason: 'pipeline threw on this fixture: ' + e.message };
  }
  return evaluateMustNot(entry, pipelineResult);
}

/**
 * runRedTeamEntry(entry, ctx) -> {id, status:'caught'|'escaped'|'skipped'|'error'|'xfail', reason?}
 * ctx = { stageTable, fixturesDir, runPipelineForBundle: async (domain, bundle) => pipelineResult }
 */
async function runRedTeamEntry(entry, ctx) {
  const id = (entry && entry.id) ? entry.id : '(no id)';
  const handler = RT_HANDLERS[id];
  if (handler) {
    try {
      return { id, ...(await handler(entry)) };
    } catch (e) {
      // FAIL-OPEN: a bespoke handler throwing is a bug in THIS harness's own wiring, not a red-team
      // finding about the engine - recorded loudly as 'error', never mistaken for the gate holding.
      return { id, status: 'error', reason: 'bespoke handler threw: ' + e.message };
    }
  }
  return { id, ...(await runGenericEntry(entry, ctx, id)) };
}

// runRedTeamLane(filePath, ctx) -> {present, rows, parseError?}. Iterates every entry sequentially
// (adversarial fixtures are expected to be few; sequential keeps error attribution unambiguous).
async function runRedTeamLane(filePath, ctx) {
  const loaded = loadRedTeamFixtures(filePath);
  if (!loaded.present) return { present: false, rows: [] };
  if (loaded.parseError) return { present: true, rows: [], parseError: loaded.parseError };
  const rows = [];
  for (const entry of loaded.entries) rows.push(await runRedTeamEntry(entry, ctx));
  return { present: true, rows };
}

module.exports = {
  loadRedTeamFixtures,
  targetGateUnavailable,
  pendingGateReason,
  resolveBundle,
  mustNotTerms,
  evaluateMustNot,
  runRedTeamEntry,
  runRedTeamLane,
};
