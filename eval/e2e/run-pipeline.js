#!/usr/bin/env node
'use strict';
/**
 * eval/e2e/run-pipeline.js - THE P3 exit-criteria end-to-end harness (docs/P3-ACCEPTANCE.md, P3 exit;
 * the C-236 enforcing half below is docs/P3-TAIL-ACCEPTANCE.md's U2 deliverable).
 *
 * Pipeline per firm: fixtureBundle (eval/reference-set/fixtures/ real crawled fixtures, plus this
 * directory's own synthetic additions) -> facts (facts/identity.js + jurisdiction.js + sector.js +
 * capabilities.js, real calls) -> coverage (evidence/crawler/coverage-contract.js against the compiled
 * catalogue) -> propose (breach/proposers/ if landed) -> verify (breach/verifiers/ if landed) ->
 * adjudicate (breach/adjudicator/ if landed, with an injected llmCall - SCRIPTED by default, or a
 * committed REPLAY recording set via --llm; no real network/LLM call is ever made from this harness
 * either way) -> findings[].
 *
 * Judgement against eval/reference-set/reference-set.json's hand-verified expectations reuses
 * eval/reference-set/verify.js's verifyPayload() (match-or-abstain-never-contradict) unmodified, and
 * layers the reproduced/missed/skipped and contradiction/clean distinctions docs/P3-ACCEPTANCE.md asks
 * for (eval/e2e/lib/judge.js). A skipped stage can never fabricate a pass (caution.md C-037): every
 * output here is honest about what actually ran today.
 *
 * Usage:
 *   node eval/e2e/run-pipeline.js
 *   node eval/e2e/run-pipeline.js --domain neuclinic.co.uk
 *   node eval/e2e/run-pipeline.js --json
 *   node eval/e2e/run-pipeline.js --no-synthetic --no-red-team
 *   node eval/e2e/run-pipeline.js --set <reference-set.json> --fixtures <dir> --synthetic <dir> --red-team <file>
 *   node eval/e2e/run-pipeline.js --breach-inline --llm replay:eval/e2e/fixtures/recorded
 *
 * THE CANONICAL FULL-ASSESSMENT INVOCATION (docs/P3-TAIL-ACCEPTANCE.md U2 deliverable 3) is now:
 *   node eval/e2e/run-pipeline.js --breach-inline --llm replay:eval/e2e/fixtures/recorded
 * --llm replay:<dir> plays back committed, sanitised recordings (the frozen contract, see
 * eval/e2e/lib/replay-llm.js) for the breach-lane adjudication and entailment llmCall seams ONLY;
 * red-team handlers (eval/e2e/lib/redteam-handlers.js) keep their own injected calls, untouched.
 * Scripted-decline mode (the default: no --llm given) remains available for safety-property runs
 * (e.g. red-team-only, or --no-breach facts/coverage smoke runs) but is NO LONGER a full assessment:
 * every text-derived candidate abstains by construction (eval/e2e/lib/scripted-llm.js's
 * defaultScriptedLlmCall always declines), so a scripted run over the current fixture set now HONESTLY
 * fails the vacuity clause below (see U2-B2) rather than reading as a clean pass.
 *
 * Suggested package.json script (package.json is not owned by this task; add by hand):
 *   "e2e": "node eval/e2e/run-pipeline.js"
 *
 * Exit codes:
 *   0 = zero contradictions AND zero red-team escapes/errors among entries that actually ran, AND the
 *       vacuity clause below does not fire.
 *   1 = at least one contradiction, OR at least one red-team escape/error, OR the VACUITY CLAUSE fires
 *       (caution.md C-236, the enforcing half of "zero false accusations"): among firms whose breach
 *       lane is COMPLETE (propose, verify AND adjudicate all genuinely ran for that firm - not
 *       skipped, not errored, not timed out) and which declare at least one known_breach, the total
 *       known_breach reproduced-as-violation count is 0. "Zero false accusations" on an engine that
 *       finds NOTHING is vacuously true (that is exactly the bug this clause closes: a totally inert
 *       engine could otherwise trivially pass), so the exit bar also requires a positive control to
 *       actually reproduce. A run with ZERO complete+declaring lanes (every firm's breach lane timed
 *       out or errored, or --no-breach was given) does NOT trip the vacuity clause - there is no tested
 *       population to be vacuous ABOUT (firing there would be the identical fallacy one level removed:
 *       "0 reproduced across 0 lanes" is itself a vacuous truth). That degradation is instead loudly
 *       reported via the EXISTING, unweakened "breach lane: N complete | N errored/timed-out | N
 *       skipped" counters (report.js) plus this file's own always-on `reproduced: k/n` line - never
 *       silently read as a pass. When the vacuity clause DOES fire, a `vacuous: 0 known_breach
 *       reproduced across N complete lanes` line is printed and an explicit RESULT: FAIL line follows
 *       it, so the true verdict is never left only in an earlier, now-stale-looking "RESULT: OK" line.
 *   2 = usage/data error (bad argument, unreadable reference set, empty/missing fixtures dir,
 *       a reference-set firm with no fixture on disk, or a facts/coverage door that threw).
 */

const fs = require('fs');
const path = require('path');

const { loadRefSetAndFixtures, selectFirms } = require('../reference-set/run-facts.js');
const { runPipeline, probeStageWiring } = require('./lib/pipeline.js');
const { judgeFirm } = require('./lib/judge.js');
const { loadSyntheticFixtures } = require('./lib/synthetic-fixtures.js');
const { runRedTeamLane } = require('./lib/redteam.js');
const { replayLlmCall } = require('./lib/replay-llm.js');
const report = require('./lib/report.js');

const DEFAULT_SET = path.join(__dirname, '..', 'reference-set', 'reference-set.json');
const DEFAULT_FIXTURES = path.join(__dirname, '..', 'reference-set', 'fixtures');
const DEFAULT_SYNTHETIC = path.join(__dirname, 'fixtures');
const DEFAULT_REDTEAM = path.join(__dirname, '..', 'red-team', 'fixtures.json');

// assertSafeDomain(domain) -> throws on an unsafe path component before path.join (traversal guard;
// mirrors eval/reference-set/run-facts.js's own private guard, which is not exported).
function assertSafeDomain(domain) {
  if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(domain)) {
    throw new Error('unsafe path component: ' + JSON.stringify(domain));
  }
}

// loadFixtureBundle(fixturesDir, domain) -> {bundle} or {missing:true}. Never throws on a missing file;
// a malformed JSON file is left to throw (surfaced by the caller as an ERROR row, not silently skipped).
function loadFixtureBundle(fixturesDir, domain) {
  assertSafeDomain(domain);
  const p = path.join(fixturesDir, domain + '.json');
  if (!fs.existsSync(p)) return { missing: true };
  return { bundle: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

// judgedRow(firm, pipelineResult) -> the report row: the judged fields plus this firm's own stageTable
// (so --json carries full per-firm detail even though the human report's header line uses the probed
// wiring once, up front).
function judgedRow(firm, pipelineResult) {
  const judged = judgeFirm(firm, pipelineResult);
  return Object.assign({ stageTable: pipelineResult.stageTable }, judged);
}

// pipelineOptsFrom(opts) -> the breach-lane control opts threaded into every runPipeline call. By
// default the real breach lane runs in a subprocess bounded by a hard deadline (Rule 9) because
// breach/proposers/propose.js can hang synchronously on the real catalogue (a ReDoS P0, owner R3/W2a).
// --breach-inline forces the fast in-process lane (use once the ReDoS is fixed); --no-breach skips it.
// llmCall is attached ONLY when --llm replay:<dir> was given; runPipeline()/adjudicate() otherwise fall
// back to their own scripted default (eval/e2e/lib/scripted-llm.js's defaultScriptedLlmCall) exactly as
// before - this key is simply absent, never set to undefined, so existing callers see no shape change.
function pipelineOptsFrom(opts) {
  const base = { breachTimeoutMs: opts.breachTimeoutMs, breachInProcess: opts.breachInline, noBreach: opts.noBreach };
  if (opts.llmReplayDir) base.llmCall = replayLlmCall(opts.llmReplayDir);
  return base;
}

async function runOneFirm(firm, fixturesDir, pipelineOpts) {
  const loaded = loadFixtureBundle(fixturesDir, firm.domain);
  if (loaded.missing) {
    return { domain: firm.domain, role: firm.role, error: 'no fixture on disk (uncovered gap - a verified firm with no captured artefact)' };
  }
  let pipelineResult;
  try {
    pipelineResult = await runPipeline(firm.domain, loaded.bundle, pipelineOpts);
  } catch (e) {
    return { domain: firm.domain, role: firm.role, error: 'pipeline threw: ' + e.message };
  }
  return judgedRow(firm, pipelineResult);
}

async function runOneSynthetic(fx, pipelineOpts) {
  if (fx.error) return { domain: fx.file, role: 'synthetic', error: fx.error };
  const firm = { domain: fx.domain, role: fx.role, expected: fx.expected };
  let pipelineResult;
  try {
    pipelineResult = await runPipeline(fx.domain, fx.bundle, pipelineOpts);
  } catch (e) {
    return { domain: fx.domain, role: fx.role, error: 'pipeline threw: ' + e.message };
  }
  return judgedRow(firm, pipelineResult);
}

async function runSyntheticFixtures(dir, pipelineOpts) {
  const fixtures = loadSyntheticFixtures(dir);
  const rows = [];
  for (const fx of fixtures) rows.push(await runOneSynthetic(fx, pipelineOpts));
  return rows;
}

const FLAGS_WITH_VALUE = {
  '--set': 'set', '--fixtures': 'fixtures', '--synthetic': 'synthetic', '--red-team': 'redteam', '--domain': 'domain',
  '--llm': 'llmRaw',
};

function parseOneArg(args, i, opts) {
  const a = args[i];
  if (a === '--json') { opts.json = true; return 1; }
  if (a === '--no-synthetic') { opts.noSynthetic = true; return 1; }
  if (a === '--no-red-team') { opts.noRedteam = true; return 1; }
  if (a === '--no-breach') { opts.noBreach = true; return 1; }
  if (a === '--breach-inline') { opts.breachInline = true; return 1; }
  if (a === '--breach-timeout') { opts.breachTimeoutMs = Number(args[i + 1]); return 2; }
  const key = FLAGS_WITH_VALUE[a];
  if (key) { opts[key] = args[i + 1]; return 2; }
  return 0;
}

const DEFAULT_BREACH_TIMEOUT_MS = 15000; // Rule 9 hard per-firm breach-lane deadline (a CAP, never a floor)

// --llm's only recognised value today is "replay:<dir>" (eval/e2e/lib/replay-llm.js's frozen
// recorded-response contract); scripted is simply the default with no flag needed at all
// (docs/P3-TAIL-ACCEPTANCE.md U2 deliverable 3).
const LLM_REPLAY_RX = /^replay:(.+)$/;

// llmReplayDirFrom(raw) -> {dir} when raw is null (no --llm given) or a well-formed "replay:<dir>",
// or {error:true} for anything else (an unrecognised --llm value fails closed, Rule 4 - it is a usage
// error, never silently ignored or treated as scripted).
function llmReplayDirFrom(raw) {
  if (raw == null) return { dir: null };
  const m = LLM_REPLAY_RX.exec(raw);
  if (!m || !m[1]) return { error: true };
  return { dir: m[1] };
}

// parseArgs(argv) -> {opts} on success, or {exitCode} when an unrecognised argument is given.
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    json: false, set: DEFAULT_SET, fixtures: DEFAULT_FIXTURES, synthetic: DEFAULT_SYNTHETIC,
    redteam: DEFAULT_REDTEAM, domain: null, noSynthetic: false, noRedteam: false,
    noBreach: false, breachInline: false, breachTimeoutMs: DEFAULT_BREACH_TIMEOUT_MS, llmRaw: null,
  };
  for (let i = 0; i < args.length;) {
    const consumed = parseOneArg(args, i, opts);
    if (consumed === 0) { console.error('Unknown argument: ' + args[i]); return { exitCode: 2 }; }
    i += consumed;
  }
  if (!Number.isFinite(opts.breachTimeoutMs) || opts.breachTimeoutMs < 0) {
    console.error('--breach-timeout must be a non-negative number of milliseconds');
    return { exitCode: 2 };
  }
  const llm = llmReplayDirFrom(opts.llmRaw);
  if (llm.error) {
    console.error('--llm must be "replay:<dir>" (got ' + JSON.stringify(opts.llmRaw) + ')');
    return { exitCode: 2 };
  }
  opts.llmReplayDir = llm.dir;
  return { opts };
}

// ── the C-236 vacuity clause (docs/P3-TAIL-ACCEPTANCE.md U2 deliverable 1) ─────────────────────────
//
// "Zero false accusations" is vacuously true on an engine that finds nothing at all (caution.md C-236:
// this exact bug shipped once already - the breach lane timed out/degraded on every firm, findings[]
// was empty everywhere, and "zero contradictions across 31 firms" read as a clean pass). The fix: the
// exit bar also requires a POSITIVE CONTROL to actually reproduce, among the population that genuinely
// had a chance to - a firm whose breach lane never completed proves nothing either way and must not
// count.

const BREACH_LANE_STAGES = ['propose', 'verify', 'adjudicate'];

// breachLaneCompleteFor(row) -> true when propose, verify AND adjudicate all show status 'ran' on this
// row's own stageTable (added by judgedRow() below from pipelineResult.stageTable - see
// eval/e2e/lib/pipeline.js's buildStageTable()/breachLaneComplete, which this mirrors by reading the
// table the CLI already carries, rather than re-importing pipeline.js's internals). An ERROR row (no
// fixture on disk, a facts/coverage door that threw) carries no stageTable at all and is therefore
// never complete - fails closed (Rule 4): an absent table is not evidence of completion.
function breachLaneCompleteFor(row) {
  const table = Array.isArray(row && row.stageTable) ? row.stageTable : null;
  if (!table) return false;
  return BREACH_LANE_STAGES.every((name) => {
    const entry = table.find((s) => s.stage === name);
    return Boolean(entry) && entry.status === 'ran';
  });
}

// knownBreachRows(row) -> row.knownBreaches[] (eval/e2e/lib/judge.js's judgeKnownBreaches output), or
// [] for a row that carries none (an ERROR row, or a firm that declares no known_breaches at all).
function knownBreachRows(row) {
  return Array.isArray(row && row.knownBreaches) ? row.knownBreaches : [];
}

/**
 * vacuityCheck(rows) -> { vacuous, completeLanes, reproduced }
 *
 * `eligible` is every row whose breach lane is COMPLETE (not skipped, not errored, not timed out) AND
 * which declares at least one known_breach. `completeLanes` is that population's size; `reproduced` is
 * how many of ITS known_breach entries actually carry status 'reproduced'.
 *
 * `vacuous` fires ONLY when completeLanes > 0 AND reproduced === 0. An EMPTY eligible population
 * (completeLanes === 0 - e.g. every firm's breach lane timed out, or the whole run used --no-breach)
 * deliberately does NOT fire: there is no tested population to be vacuous about, and treating "0
 * reproduced across 0 lanes" as a trigger would be the identical vacuous-truth fallacy C-236 names,
 * one level removed. That degradation is a DIFFERENT, already-loudly-reported failure mode (the
 * existing "breach lane: N complete | N errored/timed-out | N skipped" counters in report.js, which
 * this file does not touch or weaken).
 */
function vacuityCheck(rows) {
  const eligible = rows.filter((r) => breachLaneCompleteFor(r) && knownBreachRows(r).length > 0);
  const completeLanes = eligible.length;
  const reproduced = eligible.reduce((sum, r) => sum + knownBreachRows(r).filter((kb) => kb.status === 'reproduced').length, 0);
  return { vacuous: completeLanes > 0 && reproduced === 0, completeLanes, reproduced };
}

// knownBreachTotals(rows) -> {reproduced, total} across EVERY row's declared known_breaches,
// regardless of lane completeness - the always-on usefulness gauge (docs/P3-TAIL-ACCEPTANCE.md U2
// deliverable 1's "reproduced: k/n" line), distinct from vacuityCheck's own eligibility-scoped count.
function knownBreachTotals(rows) {
  let total = 0;
  let reproduced = 0;
  for (const r of rows) {
    const kbs = knownBreachRows(r);
    total += kbs.length;
    reproduced += kbs.filter((kb) => kb.status === 'reproduced').length;
  }
  return { reproduced, total };
}

// exitCodeFor(rows, redteam) -> 2 on any ERROR row (a gate that did not fully run), else 1 on any
// contradiction, red-team escape/error, OR the vacuity clause firing (above), else 0. Mirrors
// eval/reference-set/run-facts.js's own severity ordering (errored/missing outranks a contradiction:
// an ungraded check is worse than a graded failure).
function exitCodeFor(rows, redteam) {
  if (rows.some((r) => r.error)) return 2;
  const contradicting = rows.some((r) => r.contradiction);
  const redRows = redteam.rows || [];
  const escapes = redRows.some((r) => r.status === 'escaped' || r.status === 'error');
  const vacuity = vacuityCheck(rows);
  return (contradicting || escapes || vacuity.vacuous) ? 1 : 0;
}

async function runReferenceSetFirms(opts, pipelineOpts) {
  const loaded = loadRefSetAndFixtures({ set: opts.set, fixtures: opts.fixtures });
  if (loaded.exitCode) return { exitCode: loaded.exitCode };
  const selected = selectFirms(loaded.refSet, { domain: opts.domain });
  if (selected.exitCode) return { exitCode: selected.exitCode };
  const rows = [];
  for (const firm of selected.firms) rows.push(await runOneFirm(firm, opts.fixtures, pipelineOpts));
  return { rows };
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.exitCode) return parsed.exitCode;
  const { opts } = parsed;
  const pipelineOpts = pipelineOptsFrom(opts);

  const referenceRun = await runReferenceSetFirms(opts, pipelineOpts);
  if (referenceRun.exitCode) return referenceRun.exitCode;

  const syntheticRows = opts.noSynthetic ? [] : await runSyntheticFixtures(opts.synthetic, pipelineOpts);
  const allRows = referenceRun.rows.concat(syntheticRows);

  const wiring = probeStageWiring();
  const redteam = opts.noRedteam ? { present: false, rows: [] } : await runRedTeamLane(opts.redteam, {
    stageTable: wiring.map((w) => ({ stage: w.stage, status: w.status === 'wired' ? 'ran' : 'skipped' })),
    fixturesDir: opts.fixtures,
    runPipelineForBundle: (domain, bundle) => runPipeline(domain, bundle, pipelineOpts),
  });

  const summary = report.summarise(allRows, redteam);
  const vacuity = vacuityCheck(allRows);
  const totals = knownBreachTotals(allRows);
  if (opts.json) {
    console.log(JSON.stringify({ stageWiring: wiring, rows: allRows, redteam, summary, vacuity, knownBreachTotals: totals }, null, 2));
  } else {
    // P3-tail Wave-2 Builder B (R2/B4, caution.md C-236): report.js's printHumanReport()/resultLine()
    // are now vacuity-aware and print the reproduced/vacuous detail lines PLUS the single terminal
    // RESULT line themselves (the true home of resultLine) - passing { totals, vacuity } through is the
    // whole fix. This file used to print its OWN extra "reproduced"/"vacuous"/"RESULT: FAIL" lines
    // AFTER calling printHumanReport(), which had already printed a stale "RESULT: OK" from
    // resultLine(summary) with no vacuity awareness: a vacuous run showed a contradictory OK line
    // immediately followed by the real FAIL line. That second, corrective block is removed; there is
    // now exactly one RESULT line, printed by report.js, and it is FAIL on a vacuous run.
    report.printHumanReport(wiring, allRows, redteam, summary, { totals, vacuity });
  }
  return exitCodeFor(allRows, redteam);
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = {
  main, parseArgs, pipelineOptsFrom, runOneFirm, runOneSynthetic, runSyntheticFixtures, loadFixtureBundle,
  exitCodeFor, DEFAULT_BREACH_TIMEOUT_MS, vacuityCheck, knownBreachTotals, breachLaneCompleteFor, llmReplayDirFrom,
};
