#!/usr/bin/env node
'use strict';
/**
 * eval/e2e/run-pipeline.js - THE P3 exit-criteria end-to-end harness (docs/P3-ACCEPTANCE.md, P3 exit).
 *
 * Pipeline per firm: fixtureBundle (eval/reference-set/fixtures/ real crawled fixtures, plus this
 * directory's own synthetic additions) -> facts (facts/identity.js + jurisdiction.js + sector.js +
 * capabilities.js, real calls) -> coverage (evidence/crawler/coverage-contract.js against the compiled
 * catalogue) -> propose (breach/proposers/ if landed) -> verify (breach/verifiers/ if landed) ->
 * adjudicate (breach/adjudicator/ if landed, with an injected SCRIPTED llmCall - no network call is
 * ever made from this harness) -> findings[].
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
 *
 * Suggested package.json script (package.json is not owned by this task; add by hand):
 *   "e2e": "node eval/e2e/run-pipeline.js"
 *
 * Exit codes: 0 = zero contradictions AND zero red-team escapes/errors among entries that actually ran.
 *             1 = at least one contradiction, or at least one red-team escape/error.
 *             2 = usage/data error (bad argument, unreadable reference set, empty/missing fixtures dir,
 *                 a reference-set firm with no fixture on disk, or a facts/coverage door that threw).
 */

const fs = require('fs');
const path = require('path');

const { loadRefSetAndFixtures, selectFirms } = require('../reference-set/run-facts.js');
const { runPipeline, probeStageWiring } = require('./lib/pipeline.js');
const { judgeFirm } = require('./lib/judge.js');
const { loadSyntheticFixtures } = require('./lib/synthetic-fixtures.js');
const { runRedTeamLane } = require('./lib/redteam.js');
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
function pipelineOptsFrom(opts) {
  return { breachTimeoutMs: opts.breachTimeoutMs, breachInProcess: opts.breachInline, noBreach: opts.noBreach };
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

// parseArgs(argv) -> {opts} on success, or {exitCode} when an unrecognised argument is given.
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    json: false, set: DEFAULT_SET, fixtures: DEFAULT_FIXTURES, synthetic: DEFAULT_SYNTHETIC,
    redteam: DEFAULT_REDTEAM, domain: null, noSynthetic: false, noRedteam: false,
    noBreach: false, breachInline: false, breachTimeoutMs: DEFAULT_BREACH_TIMEOUT_MS,
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
  return { opts };
}

// exitCodeFor(rows, redteam) -> 2 on any ERROR row (a gate that did not fully run), else 1 on any
// contradiction or red-team escape/error, else 0. Mirrors eval/reference-set/run-facts.js's own
// severity ordering (errored/missing outranks a contradiction: an ungraded check is worse than a
// graded failure).
function exitCodeFor(rows, redteam) {
  if (rows.some((r) => r.error)) return 2;
  const contradicting = rows.some((r) => r.contradiction);
  const redRows = redteam.rows || [];
  const escapes = redRows.some((r) => r.status === 'escaped' || r.status === 'error');
  return (contradicting || escapes) ? 1 : 0;
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
  if (opts.json) {
    console.log(JSON.stringify({ stageWiring: wiring, rows: allRows, redteam, summary }, null, 2));
  } else {
    report.printHumanReport(wiring, allRows, redteam, summary);
  }
  return exitCodeFor(allRows, redteam);
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = { main, parseArgs, pipelineOptsFrom, runOneFirm, runOneSynthetic, runSyntheticFixtures, loadFixtureBundle, exitCodeFor, DEFAULT_BREACH_TIMEOUT_MS };
