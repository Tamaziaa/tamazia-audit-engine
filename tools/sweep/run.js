#!/usr/bin/env node
'use strict';
/**
 * THE SWEEP ORCHESTRATOR. One command, the whole local fleet, one ledger.
 *
 *   node tools/sweep/run.js               full sweep -> tools/sweep/out/{ledger.json, LEDGER.md}
 *   node tools/sweep/run.js --calibrate   additionally run one-door + swallow-gate against
 *                                         eval/calibration-known-bad/fixtures/ and FAIL unless the
 *                                         seeded violations are found. A zero you did not earn is a lie.
 *
 * Order of battle:
 *   0. SELF-TESTS: one-door and swallow-gate must first prove, in memory, that they can see the class they
 *      exist to catch. If they cannot, the sweep aborts: every zero after a failed self-test is unearned.
 *   1. COLLECT: eslint lane, local analysers (reachability, jscpd, dep-cruiser), one-door, swallow-gate,
 *      fact-lineage. Each writes findings JSON into tools/sweep/out/sarif/. External SARIF (CodeQL, Semgrep)
 *      dropped into that directory by CI is ingested automatically.
 *   2. NORMALISE: fingerprint dedupe (SHA256 of path + rule + normalised snippet, NEVER line numbers),
 *      DSU cross-tool clustering, deterministic F-NNNN numbering.
 *   3. LEDGER: ledger.json -> LEDGER.md.
 *
 * Exit code: 0 when green. 1 when any ACT finding (>=2 tools corroborate) is open, when any gate found
 * violations, or when calibration failed. 2 when a self-test failed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'sweep', 'out');
const SARIF = path.join(OUT, 'sarif');
const CALIBRATE = process.argv.includes('--calibrate');

function step(title) { console.log('\n== ' + title + ' =='); }

function runNode(script, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...(args || [])], { cwd: ROOT, stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}

// LANES: the collector lane list runCollectorLanes() below walks (the "lane-runner loop", split
// out of main() to keep it under the health-gate caps). Built at module scope since it depends
// only on SARIF, already a module-level constant by the time this file finishes loading.
const LANES = [
  ['workflow-parse', 'tools/sweep/collect-workflows.js', []],
  ['eslint', 'tools/sweep/collect-eslint.js', []],
  ['local analysers', 'tools/sweep/collect-local.js', []],
  ['one-door', 'tools/one-door/check.js', ['--json', path.join(SARIF, 'one-door.local.json')]],
  ['swallow-gate', 'tools/swallow-gate/check.js', ['--json', path.join(SARIF, 'swallow-gate.local.json')]],
  ['fact-lineage', 'tools/fact-lineage/check.js', ['--json', path.join(SARIF, 'fact-lineage.local.json')]],
  // P3 domain gates (self-testing acorn gates; exit 2 aborts the sweep, exit 1 is collected):
  ['deadline-audit', 'tools/domain-gates/deadline-audit.js', ['--json', path.join(SARIF, 'deadline-audit.local.json')]],
  ['no-module-state', 'tools/no-module-state/check.js', ['--json', path.join(SARIF, 'no-module-state.local.json')]],
];

// runSelfTestsOrAbort() -> step 0. In-process, synthetic input, no files: one-door and
// swallow-gate must first prove they can see the class they exist to catch, or the sweep aborts
// (exit 2) - every zero after a failed self-test is unearned.
function runSelfTestsOrAbort() {
  step('0. self-tests (earn the zero)');
  // STRING-LITERAL REQUIRES ONLY (per .coderabbit path instructions): a computed require(path.join(...))
  // is invisible to the static reachability gate (madge/dependency-cruiser), so these dependency edges
  // must be literal relative paths, not built at runtime. Behaviour is identical; the graph is now visible.
  const oneDoor = require('../one-door/check.js');
  const swallow = require('../swallow-gate/check.js');
  // The workflow parser is mandatory BEFORE collection (caution.md C-202): a broken or missing
  // workflow makes required checks vanish, and its self-test also fails closed when python3/PyYAML
  // never ran, so it cannot silently be skipped here.
  const workflows = require('./collect-workflows.js');
  for (const [name, mod] of [['one-door', oneDoor], ['swallow-gate', swallow], ['workflow-parse', workflows]]) {
    const st = mod.selfTest();
    console.log('  ' + name + ' self-test: ' + (st.pass ? 'PASS' : 'FAIL') + ' (' + st.detail + ')');
    if (!st.pass) {
      console.error('ABORT: ' + name + ' cannot see the class it exists to catch. Every zero below would be unearned.');
      process.exit(2);
    }
  }
}

// cleanSarif() -> wipe any SARIF artefacts a previous (possibly interrupted, or since-removed or
// renamed) sweep left in the sweep's private out/sarif dir, then recreate it empty. mkdirSync alone
// preserves stale files, and the normaliser reads the directory wholesale, so a removed collector's
// old findings would leak into the current ledger. The GATE LOOP reruns every tool from a clean
// state; this is that clean state for the collectors' outputs.
function cleanSarif() {
  fs.rmSync(SARIF, { recursive: true, force: true });
  fs.mkdirSync(SARIF, { recursive: true });
}

// runCollectorLanes() -> step 1, the lane-runner loop. A gate exiting 1 means it FOUND things;
// its findings are already written to SARIF and the sweep continues so the ledger shows
// everything (its name is collected for the final gate). Exit 2 (a genuinely broken tool) aborts
// the whole sweep immediately.
function runCollectorLanes() {
  step('1. collect');
  const gateFailures = [];
  for (const [name, script, args] of LANES) {
    const code = runNode(script, args);
    if (code === 2) { console.error('ABORT: ' + name + ' is broken (exit 2), not merely reporting findings.'); process.exit(2); }
    if (code !== 0) gateFailures.push(name);
  }
  return gateFailures;
}

// runCalibrationOrAbort() -> step 1b, only under --calibrate: one-door and swallow-gate must FIND
// the seeded bad fixtures, or the run fails (exit 1) - the sweep is not allowed to claim green on
// an unearned zero.
function runCalibrationOrAbort() {
  if (!CALIBRATE) return;
  step('1b. calibration against eval/calibration-known-bad/fixtures');
  for (const [name, script] of [['one-door', 'tools/one-door/check.js'], ['swallow-gate', 'tools/swallow-gate/check.js']]) {
    const code = runNode(script, ['--calibrate']);
    if (code !== 0) {
      console.error('CALIBRATION FAILED for ' + name + '. The sweep is not allowed to claim green.');
      process.exit(1);
    }
  }
}

// runNormaliseAndLedger() -> steps 2 and 3: fingerprint dedupe -> DSU clusters -> F-NNNN
// numbering, then ledger.json -> LEDGER.md. Aborts (exit 2) if either step fails.
function runNormaliseAndLedger() {
  step('2. normalise (fingerprint dedupe -> DSU clusters -> F-NNNN)');
  if (runNode('tools/sweep/normalise.js', [SARIF]) !== 0) { console.error('ABORT: normalise failed.'); process.exit(2); }

  step('3. ledger');
  if (runNode('tools/sweep/ledger.js', []) !== 0) { console.error('ABORT: ledger failed.'); process.exit(2); }
}

// evaluateGate(gateFailures) -> step 4, the final gate. Reads ledger.json, prints the summary
// line, and exits 0 (green) or 1 (red) accordingly; never returns.
function evaluateGate(gateFailures) {
  step('4. the gate');
  const d = JSON.parse(fs.readFileSync(path.join(OUT, 'ledger.json'), 'utf8'));
  console.log('  raw ' + d.raw_findings + ' | deduped ' + d.after_dedupe + ' | clusters ' + d.clusters +
    ' | ACT ' + d.act + ' | REVIEW ' + d.review);
  if (gateFailures.length > 0) {
    console.error('  RED: gates with open violations: ' + gateFailures.join(', ') + ' (see LEDGER.md)');
    process.exit(1);
  }
  if (d.act > 0) {
    console.error('  RED: ' + d.act + ' ACT finding(s) corroborated by >=2 tools. Work stops until they are closed.');
    process.exit(1);
  }
  console.log('  GREEN: no ACT findings, no open gate violations. ' + d.review + ' single-tool lead(s) for triage.');
  process.exit(0);
}

function main() {
  runSelfTestsOrAbort();
  cleanSarif();
  const gateFailures = runCollectorLanes();
  runCalibrationOrAbort();
  runNormaliseAndLedger();
  evaluateGate(gateFailures);
}

main();
