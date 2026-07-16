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

function main() {
  fs.mkdirSync(SARIF, { recursive: true });

  // 0. Self-tests. In-process, synthetic input, no files: the zero must be earned before anything runs.
  step('0. self-tests (earn the zero)');
  const oneDoor = require(path.join(ROOT, 'tools', 'one-door', 'check.js'));
  const swallow = require(path.join(ROOT, 'tools', 'swallow-gate', 'check.js'));
  for (const [name, mod] of [['one-door', oneDoor], ['swallow-gate', swallow]]) {
    const st = mod.selfTest();
    console.log('  ' + name + ' self-test: ' + (st.pass ? 'PASS' : 'FAIL') + ' (' + st.detail + ')');
    if (!st.pass) {
      console.error('ABORT: ' + name + ' cannot see the class it exists to catch. Every zero below would be unearned.');
      process.exit(2);
    }
  }

  const gateFailures = [];

  // 1. Collectors. A gate exiting 1 means it FOUND things; its findings are already written to SARIF and the
  // sweep continues so the ledger shows everything. Exit 2 (broken tool) aborts.
  step('1. collect');
  const lanes = [
    ['eslint', 'tools/sweep/collect-eslint.js', []],
    ['local analysers', 'tools/sweep/collect-local.js', []],
    ['one-door', 'tools/one-door/check.js', ['--json', path.join(SARIF, 'one-door.local.json')]],
    ['swallow-gate', 'tools/swallow-gate/check.js', ['--json', path.join(SARIF, 'swallow-gate.local.json')]],
    ['fact-lineage', 'tools/fact-lineage/check.js', ['--json', path.join(SARIF, 'fact-lineage.local.json')]],
  ];
  for (const [name, script, args] of lanes) {
    const code = runNode(script, args);
    if (code === 2) { console.error('ABORT: ' + name + ' is broken (exit 2), not merely reporting findings.'); process.exit(2); }
    if (code !== 0) gateFailures.push(name);
  }

  // 1b. Calibration: the checkers must FIND the seeded bad fixtures, or the run fails.
  if (CALIBRATE) {
    step('1b. calibration against eval/calibration-known-bad/fixtures');
    for (const [name, script] of [['one-door', 'tools/one-door/check.js'], ['swallow-gate', 'tools/swallow-gate/check.js']]) {
      const code = runNode(script, ['--calibrate']);
      if (code !== 0) {
        console.error('CALIBRATION FAILED for ' + name + '. The sweep is not allowed to claim green.');
        process.exit(1);
      }
    }
  }

  // 2. Normalise: dedupe + cluster + number.
  step('2. normalise (fingerprint dedupe -> DSU clusters -> F-NNNN)');
  if (runNode('tools/sweep/normalise.js', [SARIF]) !== 0) { console.error('ABORT: normalise failed.'); process.exit(2); }

  // 3. Ledger.
  step('3. ledger');
  if (runNode('tools/sweep/ledger.js', []) !== 0) { console.error('ABORT: ledger failed.'); process.exit(2); }

  // 4. The gate.
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

main();
