'use strict';
// eval/e2e/lib/redteam.js - the red-team lane (docs/P3-ACCEPTANCE.md wave 3, caution.md C-165):
// adversarial fixtures that try to make the engine fabricate. eval/red-team/fixtures.json is expected
// to land in parallel with this harness; ABSENCE is handled as an honest, whole-lane skip (never a
// fabricated pass on zero entries - the same C-037 doctrine as a skipped breach stage).
//
// ASSUMED FIXTURE CONTRACT (no eval/red-team/fixtures.json exists in the repo at the time this harness
// was written; align this file the moment it lands for real if the shape differs):
//
//   { "entries": [ { "id", "description"?, "target_gate"?, "domain"?, "fixture"?, "bundle"?,
//                    "must_not": { "match_any": [...] } } ] }
//   - or a bare top-level array of the same entry shape.
//   - target_gate names a pipeline stage ('facts'|'coverage'|'propose'|'verify'|'adjudicate'); when it
//     names a stage that is not currently wired (or unrecognised), the entry is honestly SKIPPED -
//     running it would trivially "catch" for a reason that proves nothing (a skipped stage can never
//     fabricate a pass, the same doctrine applied to red-team as to a known_breach expectation).
//   - the entry's bundle is resolved from entry.bundle (inline EvidenceBundle), else entry.fixture (a
//     path, resolved against the red-team file's own directory, or absolute), else entry.domain
//     (looked up against the SAME fixturesDir the reference-set run used).
//   - must_not.match_any is checked against the pipeline's asserted findings AND a serialised blob of
//     the whole pipeline output (defence in depth: a fabrication escaping through facts/coverage, not
//     only findings[], must still be caught by this assumed contract).

const fs = require('fs');
const path = require('path');

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

// targetGateUnavailable(entry, stageTable) -> the gate name when the entry names one that this run did
// NOT actually run (or the gate is unrecognised, or stageTable carries no information about it at all -
// fail closed: unknown is treated as unavailable, never assumed available), else null (run for real).
function targetGateUnavailable(entry, stageTable) {
  const gate = entry.target_gate || entry.gate || entry.target || null;
  if (!gate || !STAGE_NAMES.has(gate)) return null;
  const row = (stageTable || []).find((s) => s.stage === gate);
  if (!row || row.status !== 'ran') return gate;
  return null;
}

// resolveBundle(entry, fixturesDir) -> an EvidenceBundle, or null when the entry carries none this
// harness knows how to resolve.
function resolveBundle(entry, fixturesDir) {
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

// findingsText(pipelineResult) -> a lowercased text blob of the pipeline's own findings[].
function findingsText(pipelineResult) {
  return (pipelineResult.breach.findings || []).map((f) => JSON.stringify(f)).join(' \n ').toLowerCase();
}

// wholeOutputText(pipelineResult) -> a lowercased text blob of the WHOLE pipeline output (payload +
// coverage), so a fabrication escaping through any stage - not only findings[] - is still caught by a
// match_any token check (defence in depth for an assumed contract this harness cannot yet verify
// against a real fixture file).
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
  const terms = (entry.must_not && Array.isArray(entry.must_not.match_any)) ? entry.must_not.match_any : [];
  if (terms.length === 0) {
    return { status: 'skipped', reason: 'entry carries no must_not.match_any clause this harness can evaluate' };
  }
  const corpus = findingsText(pipelineResult) + ' \n ' + wholeOutputText(pipelineResult);
  const hit = terms.find((t) => corpus.includes(String(t).toLowerCase()));
  return hit ? { status: 'escaped', reason: 'matched forbidden token: ' + JSON.stringify(hit) } : { status: 'caught' };
}

/**
 * runRedTeamEntry(entry, ctx) -> {id, status:'caught'|'escaped'|'skipped'|'error', reason?}
 * ctx = { stageTable, fixturesDir, runPipelineForBundle: async (domain, bundle) => pipelineResult }
 */
async function runRedTeamEntry(entry, ctx) {
  const id = (entry && entry.id) ? entry.id : '(no id)';
  const gateReason = targetGateUnavailable(entry, ctx.stageTable);
  if (gateReason) return { id, status: 'skipped', reason: 'target gate "' + gateReason + '" is not available in this run' };

  const bundle = resolveBundle(entry, ctx.fixturesDir);
  if (!bundle) return { id, status: 'skipped', reason: 'no runnable bundle (entry carries no usable bundle/fixture/domain)' };

  let pipelineResult;
  try {
    pipelineResult = await ctx.runPipelineForBundle(entry.domain || id, bundle);
  } catch (e) {
    // FAIL-OPEN: a red-team fixture that makes the PIPELINE ITSELF throw is a distinct failure mode
    // from a fabrication escaping - it is recorded loudly as 'error' (not 'skipped', not 'caught') so
    // a crash on adversarial input is never mistaken for the gate having held.
    return { id, status: 'error', reason: 'pipeline threw on this fixture: ' + e.message };
  }
  return { id, ...evaluateMustNot(entry, pipelineResult) };
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
  resolveBundle,
  evaluateMustNot,
  runRedTeamEntry,
  runRedTeamLane,
};
