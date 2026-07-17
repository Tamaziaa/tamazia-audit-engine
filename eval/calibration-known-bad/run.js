#!/usr/bin/env node
'use strict';
// eval/calibration-known-bad/run.js - the earn-your-zero gate.
//
// Every analyser/gate in tools/ must FAIL on seeded known-bad input each run: a checker
// that reports zero findings on its own calibration fixture is broken, and its green
// tick on real code is worthless (the confident-zero disease). This runner invokes each
// relevant checker in --calibrate mode and FAILS (exit 1) if any checker reports zero
// findings on its fixture.
//
// THE --calibrate CONTRACT (coordinate with the tools/ agent; documented in README.md):
//   node tools/<checker> --calibrate
//   - the checker scans eval/calibration-known-bad/fixtures/ (this directory) only
//   - prints a single JSON object to stdout: {"checker":"<name>","findings":[{"file":"...","line":N,"rule":"...","message":"..."}]}
//   - exits 0 whether or not findings exist (--calibrate reports; this runner judges)
//
// Checker discovery: each entry lists candidate paths under tools/. While the tools/
// agent is still building (P0 runs in parallel), a missing checker is reported as
// SKIPPED with a warning and does not fail the run - pass --strict to make missing
// checkers fail (CI flips to --strict the moment tools/ lands).
//
// The payload-contract check needs no external tool: it runs payload/contract
// validatePayload() directly, so at least one earn-your-zero gate is live from commit 1.
//
// Usage: node eval/calibration-known-bad/run.js [--strict] [--json]
// Exit codes: 0 = every present checker caught its fixture; 1 = a checker reported zero
// findings on its fixture (or --strict and a checker is missing); 2 = runner error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Each calibration: the fixture file(s) the checker must flag, and where the checker
// may live under tools/ (first existing candidate wins).
const CALIBRATIONS = [
  {
    name: 'silent-swallow',
    description: 'bare/expressionless catch blocks that swallow errors',
    fixtures: ['bare-catch-swallow.js'],
    checkerCandidates: [
      'tools/swallow-gate/check.js',
      'tools/silent-swallow/index.js',
      'tools/silent-swallow.js',
      'tools/sweep/silent-swallow.js',
    ],
  },
  {
    name: 'one-door',
    description: 'a second producer of the JURISDICTION fact outside facts/jurisdiction.js',
    fixtures: ['second-door-jurisdiction.js'],
    checkerCandidates: [
      'tools/one-door/check.js',
      'tools/one-door/index.js',
      'tools/one-door.js',
      'tools/sweep/one-door.js',
    ],
  },
  {
    name: 'catalogue-regex-health',
    description: 'over-escaped dead regex in a rule JSON (the dpo[@\\\\s] class)',
    fixtures: ['rule-dead-regex.json', 'p2-regex-dead-pattern.json'],
    checkerCandidates: [
      'catalogue/linters/regex-health.js',
      'tools/catalogue-lint/regex-health.js',
      'tools/catalogue-lint.js',
    ],
  },
  {
    name: 'catalogue-polarity',
    description: 'polarity-inverted rule: prohibit-style regex that matches compliant wording',
    fixtures: ['rule-polarity-inverted.json', 'p2-polarity-inverted.json'],
    checkerCandidates: [
      'catalogue/linters/polarity.js',
      'tools/catalogue-lint/polarity.js',
      'tools/catalogue-lint.js',
    ],
  },
  {
    name: 'catalogue-citation-completeness',
    description: 'a candidate Compliance Object Model record whose citation.url is not on an official statutory/regulatory host (Constitution Rule 14 / caution.md C-104)',
    fixtures: ['p2-citation-missing-official-host.json'],
    checkerCandidates: [
      'catalogue/linters/citation-completeness.js',
      'tools/catalogue-lint/citation-completeness.js',
      'tools/catalogue-lint.js',
    ],
  },
  {
    name: 'catalogue-threshold-guard',
    description: 'a size/turnover-threshold-bearing record with no modelled excluded_when (the Modern Slavery Act-on-an-SME class, caution.md C-071)',
    fixtures: ['p2-threshold-missing-excluded.json'],
    checkerCandidates: [
      'catalogue/linters/threshold-guard.js',
      'tools/catalogue-lint/threshold-guard.js',
      'tools/catalogue-lint.js',
    ],
  },
  {
    name: 'catalogue-only-literals',
    description: 'fine amount / regulator name / law title authored as a literal in code',
    fixtures: ['fabricated-fine-literal.js'],
    checkerCandidates: [
      // one-door's fine/regulator/law-title facts ARE the catalogue-only-literals
      // enforcement: any such literal outside catalogue/ is a second door.
      'tools/one-door/check.js',
      'tools/domain-gates/catalogue-only-literals.js',
      'tools/catalogue-only-literals.js',
      'tools/sweep/domain-gates.js',
    ],
  },
  {
    name: 'p1-unreachable-bundle-abstain',
    description:
      'bot-walled and SPA-shell EvidenceBundles (C-038/C-032): any facts module emitting a non-abstain fact or any finding on them is broken',
    fixtures: ['p1-reference-fixtures-unreachable-bundle.json'],
    checkerCandidates: [
      'tools/domain-gates/unreachable-abstain.js',
      'facts/tools/abstain-calibrate.js',
      'tools/facts-abstain/check.js',
    ],
  },
  {
    name: 'identity-marketing-headline',
    description:
      'facts/identity.js must refuse a marketing headline with HTML entity residue as display_name/slug (the amp-slug class, caution C-003)',
    fixtures: ['p1-identity-marketing-headline.json'],
    checkerCandidates: [
      // the identity module IS the gate here: --calibrate replays every
      // p1-identity-*.json fixture and emits a finding per refused poison
      'facts/identity.js',
    ],
  },
  {
    name: 'payload-contract',
    description: 'payload missing REQUIRED contract fields must validate non-empty missing[]',
    fixtures: ['payload-missing-fields.json'],
    internal: true, // runs payload/contract directly; live from commit 1
  },
];

function findChecker(candidates) {
  for (const rel of candidates || []) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// Two checker dialects are accepted:
//   a) stdout dialect: `--calibrate` prints {"checker":"...","findings":[...]} to stdout, exit 0.
//   b) gate-cli dialect (tools/lib/gate-cli.js): `--calibrate --json <path>` writes a findings
//      ARRAY to <path>, prints human text to stdout, and exits 1 when zero violations were
//      found. A non-zero exit is therefore NOT a runner error here: we still read the JSON
//      file and let this runner judge the (possibly empty) findings list.
function runExternalChecker(checkerPath) {
  const jsonOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calibrate-')), 'findings.json');
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [checkerPath, '--calibrate', '--json', jsonOut], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
  } catch (e) {
    // gate-cli exits 1 on zero calibration findings and 2 on a failed self-test. Keep the
    // stdout we got; if the checker wrote no JSON file either, the throw below reports it.
    stdout = (e.stdout || '') + '';
  }
  if (fs.existsSync(jsonOut)) {
    const parsed = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.findings)) return parsed.findings;
  }
  const parsed = (() => {
    try { return JSON.parse(stdout); }
    catch (e) { return null; /* FAIL-OPEN: non-JSON stdout just means the checker uses the file dialect; handled below. */ }
  })();
  if (parsed && Array.isArray(parsed.findings)) return parsed.findings;
  if (Array.isArray(parsed)) return parsed;
  throw new Error('checker emitted neither {findings:[]} JSON on stdout nor a findings JSON file via --json');
}

function runInternalPayloadContract(fixtureAbs) {
  const contract = require(path.join(REPO_ROOT, 'payload', 'contract'));
  const payload = JSON.parse(fs.readFileSync(fixtureAbs, 'utf8'));
  const missing = contract.validatePayload(payload);
  return missing.map((m) => ({ file: fixtureAbs, rule: 'payload-contract', message: `missing: ${m}` }));
}

// checkMissingFixtures(cal, fixtureAbs) -> {entries, failed, skipped: 0}. entries is non-empty
// only when at least one of this calibration's fixture files does not exist on disk.
function checkMissingFixtures(cal, fixtureAbs) {
  const entries = [];
  let failed = 0;
  for (const f of fixtureAbs) {
    if (!fs.existsSync(f)) {
      entries.push({ name: cal.name, status: 'FAIL', detail: `fixture missing: ${f}` });
      failed++;
    }
  }
  return { entries, failed, skipped: 0 };
}

// runInternalCalibration(cal, fixtureAbs) -> {entries, failed, skipped: 0}. The "internal": true
// calibration (payload-contract) runs payload/contract's validatePayload() directly rather than
// spawning an external checker.
function runInternalCalibration(cal, fixtureAbs) {
  const entries = [];
  let failed = 0;
  try {
    const findings = runInternalPayloadContract(fixtureAbs[0]);
    if (findings.length > 0) {
      entries.push({ name: cal.name, status: 'PASS', detail: `${findings.length} finding(s) on the fixture (e.g. ${findings[0].message})` });
    } else {
      entries.push({ name: cal.name, status: 'FAIL', detail: 'validatePayload() returned an EMPTY missing list on a deliberately incomplete payload - the contract gate is broken' });
      failed++;
    }
  } catch (e) {
    entries.push({ name: cal.name, status: 'FAIL', detail: `internal check errored: ${e.message}` });
    failed++;
  }
  return { entries, failed, skipped: 0 };
}

// runExternalCalibration(cal, strict) -> {entries, failed, skipped}. Locates the checker under
// tools/ via findChecker(), reports SKIPPED (or FAIL in --strict mode) if none is found yet, and
// otherwise runs its --calibrate contract via runExternalChecker() and checks every listed
// fixture was caught (CR-38: EVERY fixture listed for this calibration must be caught, not just
// ANY one of them - a multi-fixture calibration previously passed as long as ONE fixture produced
// a finding, so a checker could keep catching an old fixture while missing a new one).
function runExternalCalibration(cal, strict) {
  const entries = [];
  let failed = 0;
  let skipped = 0;

  const checker = findChecker(cal.checkerCandidates);
  if (!checker) {
    const detail = `no checker found (looked at: ${cal.checkerCandidates.join(', ')})`;
    if (strict) {
      entries.push({ name: cal.name, status: 'FAIL', detail: `${detail} - strict mode: a fixture without a live checker is an unearned zero` });
      failed++;
    } else {
      entries.push({ name: cal.name, status: 'SKIPPED', detail: `${detail} - tools/ agent has not landed this gate yet; CI must flip to --strict when it does` });
      skipped++;
    }
    return { entries, failed, skipped };
  }

  try {
    const findings = runExternalChecker(checker);
    const missingFixtures = cal.fixtures.filter((fx) => !findings.some((fd) => String(fd.file || '').includes(fx)));
    const fixtureHits = findings.filter((fd) => cal.fixtures.some((fx) => String(fd.file || '').includes(fx)));
    if (missingFixtures.length === 0) {
      entries.push({ name: cal.name, status: 'PASS', detail: `${fixtureHits.length} finding(s) across all ${cal.fixtures.length} fixture(s) via ${path.relative(REPO_ROOT, checker)}` });
    } else {
      entries.push({ name: cal.name, status: 'FAIL', detail: `${path.relative(REPO_ROOT, checker)} reported ZERO findings on: ${missingFixtures.join(', ')} - it has not earned its zero on every seeded fixture (${cal.description})` });
      failed++;
    }
  } catch (e) {
    entries.push({ name: cal.name, status: 'FAIL', detail: `checker errored or broke the --calibrate contract: ${e.message}` });
    failed++;
  }
  return { entries, failed, skipped };
}

// runOneCalibration(cal, strict) -> {entries: [...], failed: N, skipped: N} for one CALIBRATIONS
// entry. Semantics are UNCHANGED from the original inline loop body (do not change the
// CALIBRATIONS registry semantics or --strict behaviour): missing fixture files short-circuit
// straight to a FAIL entry per file; otherwise an "internal" calibration runs payload/contract
// directly and everything else runs its checker's --calibrate contract. The original loop tested
// `results.some((r) => r.name === cal.name && r.status === 'FAIL')` against the GLOBAL results
// list; since every entry pushed for earlier calibrations carries a DIFFERENT cal.name, that was
// already equivalent to testing only the entries just pushed for THIS calibration, which is what
// checkMissingFixtures's own (per-calibration) entries list does directly.
function runOneCalibration(cal, strict) {
  const fixtureAbs = cal.fixtures.map((f) => path.join(FIXTURES_DIR, f));
  const missing = checkMissingFixtures(cal, fixtureAbs);
  if (missing.entries.length > 0) return missing;
  if (cal.internal) return runInternalCalibration(cal, fixtureAbs);
  return runExternalCalibration(cal, strict);
}

// report(strict, results, failed, skipped, asJson) -> prints the run's summary in --json or
// human form, unchanged from the original inline block in main().
function report(strict, results, failed, skipped, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ strict, results, failed, skipped }, null, 2));
    return;
  }
  console.log('calibration-known-bad: the earn-your-zero gate');
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.name}: ${r.detail}`);
  if (failed > 0) {
    console.log(`RESULT: FAIL - ${failed} gate(s) did not catch their seeded known-bad fixture. A gate that misses planted disease is reporting worthless greens.`);
  } else if (skipped > 0) {
    console.log(`RESULT: OK with ${skipped} SKIPPED - external checkers not landed yet. Flip CI to --strict once tools/ lands.`);
  } else {
    console.log('RESULT: OK - every gate caught its fixture.');
  }
}

function main(argv) {
  const args = argv.slice(2);
  const strict = args.includes('--strict');
  const asJson = args.includes('--json');
  const unknown = args.filter((a) => !['--strict', '--json'].includes(a));
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    return 2;
  }

  const results = [];
  let failed = 0;
  let skipped = 0;

  for (const cal of CALIBRATIONS) {
    const r = runOneCalibration(cal, strict);
    results.push(...r.entries);
    failed += r.failed;
    skipped += r.skipped;
  }

  report(strict, results, failed, skipped, asJson);
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { CALIBRATIONS };
