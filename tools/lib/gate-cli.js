'use strict';
/**
 * The one CLI runner for blocking gates (one-door, swallow-gate). Both gates share the same contract:
 *
 *   0. SELF-TEST first: prove, in memory, that the gate can see the class it exists to catch. A gate that
 *      fails its self-test exits 2 and every zero it ever printed is suspect.
 *   1. normal mode: scan the declared directories; violations exit 1, clean exits 0.
 *   2. --calibrate: scan eval/calibration-known-bad/fixtures/ instead and REQUIRE that the seeded
 *      violations are found. Missing dir or zero findings = exit 1. A zero you did not earn is a lie.
 *   3. --json <path>: additionally write findings JSON for the sweep normaliser.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CALIBRATE_DIR = path.join('eval', 'calibration-known-bad', 'fixtures');

// Shared flag parsing for every gate: --calibrate, --json <path>. writeJson is a no-op without --json.
function parseGateArgs(argv) {
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  return {
    calibrate: args.includes('--calibrate'),
    jsonPath,
    writeJson: (findings) => {
      if (!jsonPath) return;
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
    },
  };
}

/**
 * opts = {
 *   name           gate name for messages, e.g. 'one-door'
 *   selfTest       () -> {pass, detail}
 *   scan           (dirs) -> {violations: [...], ...counters}
 *   toFindings     (violations) -> normaliser-shaped findings
 *   scanDirs       directories for the normal scan
 *   summary        (result) -> one summary line for the normal scan
 *   calibrateSummary (result) -> one summary line for the calibrate scan
 *   violationLine  (v) -> one line per violation
 * }
 */
function runGateCli(opts) {
  const { calibrate, writeJson } = parseGateArgs(process.argv);

  const st = opts.selfTest();
  if (!st.pass) {
    console.error(opts.name + ' SELF-TEST FAILED: ' + st.detail);
    console.error('The gate cannot see the class it exists to catch. Every zero it reports is unearned.');
    process.exit(2);
  }

  if (calibrate) {
    if (!fs.existsSync(path.join(ROOT, CALIBRATE_DIR))) {
      console.error(opts.name + ' CALIBRATION FAILED: ' + CALIBRATE_DIR + ' does not exist. There is nothing to earn a zero against.');
      process.exit(1);
    }
    const res = opts.scan([CALIBRATE_DIR]);
    writeJson(opts.toFindings(res.violations));
    console.log('  ' + opts.name + ' calibration: ' + opts.calibrateSummary(res));
    for (const v of res.violations) console.log('    CAUGHT ' + opts.violationLine(v));
    if (res.violations.length === 0) {
      console.error(opts.name + ' CALIBRATION FAILED: fixtures exist but zero violations found. The seeded bad input escaped.');
      process.exit(1);
    }
    process.exit(0);
  }

  const res = opts.scan(opts.scanDirs);
  writeJson(opts.toFindings(res.violations));
  console.log('  ' + opts.name + ': ' + opts.summary(res) + ' (self-test: earned)');
  for (const v of res.violations) console.error('  ' + opts.violationLine(v));
  process.exit(res.violations.length > 0 ? 1 : 0);
}

module.exports = { runGateCli, parseGateArgs, ROOT, CALIBRATE_DIR };
