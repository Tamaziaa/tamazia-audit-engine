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

const safePath = require('../../tools/lib/safe-path.js');

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
    description: 'polarity-inverted rule: prohibit-style regex that matches compliant wording; and a required disclosure ("Attorney Advertising" label class) mistyped evidence_type "absence", which false-accuses the compliant firm that shows the disclosure (caution.md C-046/C-048, CATALOGUE-VERIFICATION-2026-07-19.md)',
    fixtures: ['rule-polarity-inverted.json', 'p2-polarity-inverted.json', 'p2-required-disclosure-as-absence.json'],
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

  // ---- P3 Wave additions (evidence/registers, evidence/browser, tools/domain-gates) ----
  {
    name: 'register-nonmatch-rejected',
    description: 'a non-empty HTTP-200 register response that is not a real name match must yield no row (C-004)',
    fixtures: ['p3-register-http200-nonmatch.json', 'p3-register-multi-register-nonmatch.json'],
    checkerCandidates: ['evidence/registers/registers.js'],
  },
  {
    name: 'p3-browser-deadline',
    description:
      'a hanging browser goto must be refused by the ONE outer Promise.race deadline, never hang the mint (the 752s stuck-Chromium class, C-040 / Rule 9); self-driving fixture races evidence/browser/observe.js against a wall-clock guard',
    fixtures: ['p3-browser-deadline.js'],
    checkerCandidates: ['eval/calibration-known-bad/fixtures/p3-browser-deadline.js'],
  },
  {
    name: 'p3-browser-preconsent-breach',
    description:
      'a pre-consent tracker cookie and GA request must be flagged with artifacts; the essential session cookie must never be flagged (PECR reg.6 behavioural evidence, C-039 / Rule 3 / Rule 10); self-driving fixture drives evidence/browser/observe.js against a scripted browser',
    fixtures: ['p3-browser-preconsent-breach.js'],
    checkerCandidates: ['eval/calibration-known-bad/fixtures/p3-browser-preconsent-breach.js'],
  },
  {
    name: 'p3-adjudicator-invented-finding',
    description:
      'the adjudicator is filter-only (Rule 11 / C-083): a hostile llmCall that tries to inject a fabricated finding and clear a real one with an unproven no_breach must be structurally incapable of doing either; self-driving fixture drives breach/adjudicator/adjudicate.js against a scripted hostile llmCall',
    fixtures: ['p3-adjudicator-invented-finding.js'],
    checkerCandidates: ['eval/calibration-known-bad/fixtures/p3-adjudicator-invented-finding.js'],
  },
  {
    name: 'required-disclosure-breach',
    description:
      'a required disclosure retyped presence (the New York "Attorney Advertising" label): propose.js must NOT breach a compliant page that SHOWS the disclosure (the false accusation is gone) and MUST breach a page that omits it (the real violation is caught); the old "absence" typing false-accuses the compliant page (caution.md C-046/C-048, CATALOGUE-VERIFICATION-2026-07-19.md, Rule 3); self-driving fixture drives breach/proposers/propose.js against the shipped NY_RPC_7_1 record',
    fixtures: ['p3-required-disclosure-breach.js'],
    checkerCandidates: ['eval/calibration-known-bad/fixtures/p3-required-disclosure-breach.js'],
  },
  {
    name: 'host-substring',
    description:
      'a URL/host compared by substring or token instead of a parsed host (GAPS.md host-substring; the Mills & Reeve nexus class, caution.md C-009)',
    fixtures: ['p3-crawl-host-substring.js'],
    checkerCandidates: ['tools/domain-gates/host-parse.js'],
  },
  {
    name: 'budget-floor',
    description:
      'a Math.max FLOOR on a time/budget value, or a deadline literal above the 120s hard cap (GAPS.md budget-floor; the E-236 SPA-render-tail class, Constitution Rule 8, caution.md C-185)',
    fixtures: ['p3-crawl-floor.js'],
    checkerCandidates: ['tools/domain-gates/budget-caps.js'],
  },
  {
    name: 'llm-gate',
    description:
      'the LLM structural gate must HARD-REJECT an out-of-set citation (Rule 12 gate 1) and a drifted verbatim quote (Rule 12 gate 2); GAPS.md llm-unverified. The module IS the checker (like facts/identity.js): llm/gate.js --calibrate replays every p3-llm-*.json fixture and a wrongly-accepted poison emits no finding',
    fixtures: ['p3-llm-outofset-citation.json', 'p3-llm-quote-drift.json'],
    checkerCandidates: ['llm/gate.js'],
  },
  {
    name: 'breach-artifact-rejected',
    description:
      'Constitution Rule 3 (no artifact, no breach): a candidate finding whose cited artifact does not actually support it (a drifted quote, a network event never observed, a mismatched register row, or coverage that is truncated) must be refused, never adjudicated. GAPS.md breach-artifact. The module IS the checker (like facts/identity.js / evidence/registers/registers.js): breach/verifiers/quote-match.js --calibrate replays every p3-verifier-*.json fixture (caution.md C-024/C-080/C-089)',
    fixtures: [
      'p3-verifier-drifted-quote.json',
      'p3-verifier-fabricated-network-event.json',
      'p3-verifier-register-row-mismatch.json',
      'p3-verifier-coverage-proof-missing.json',
      'p3-verifier-register-absence-unproven.json',
    ],
    checkerCandidates: ['breach/verifiers/quote-match.js'],
  },
  {
    name: 'deadline-hang',
    description:
      'Constitution Rule 9 (every external step has a hard deadline): an injected external call (fetchFn / launchBrowser / llmCall / a provider .call) awaited with no raceWithDeadline/withDeadline wrapper and no deadline arg, or a spawn shelling out to http, must be flagged - the 752s stuck-Chromium / exhausted-free-tier hang class (GAPS.md deadline-hang, caution.md C-040/C-138). The module IS the checker: tools/domain-gates/deadline-audit.js --calibrate replays the seeded undeadlined awaits',
    fixtures: ['p3-gate-deadline-audit.js'],
    checkerCandidates: ['tools/domain-gates/deadline-audit.js'],
  },
  {
    name: 'module-scope-state',
    description:
      'caution.md C-153 (no mutable module-scope state in the mint path): a module-scope binding mutated per audit from a function (the _WARN/_SWARN counter/accumulator that was never reset between builds, so warning counts were wrong for every audit after the first) must be flagged; guarded write-once memoisation and module-init IIFEs are spared. GAPS.md module-scope-state. The module IS the checker: tools/no-module-state/check.js --calibrate replays the seeded accumulator',
    fixtures: ['p3-gate-module-state.js'],
    checkerCandidates: ['tools/no-module-state/check.js'],
  },

  // ---- P4 T0 addition (applicability/connect.js, the one applicability door) ----
  {
    name: 'p4-applicability-leak',
    description:
      'the applicability-leak class (Constitution Rule 13; caution.md C-051/C-053/C-054/C-061..C-064): us-legal records firing on a UK firm. applicability/connect.js must attach ZERO US records to a UK-bound firm, EXCLUDE the US record with a jurisdiction reason (the gate visibly fired), still attach a UK universal record (usefulness control, C-236 - the filter is not vacuously safe), and attach nothing on an abstained envelope. Self-driving fixture drives applicability/connect.js against a synthetic UK-bound-that-also-serves-US firm; its MANDATORY embedded two-record catalogue runs even with NO compiled dist artifact (this calibration runs before `npm run catalogue` in ci.yml), the real compiled catalogue is an optional supplementary leg',
    fixtures: ['p4-applicability-leak.js'],
    checkerCandidates: ['eval/calibration-known-bad/fixtures/p4-applicability-leak.js'],
  },
];

function findChecker(candidates) {
  for (const rel of candidates || []) {
    // rel is always a literal repo-relative path from the CALIBRATIONS table above
    // ('tools/one-door/check.js', ...): resolveSafeRelativePath makes that validation visible at
    // the site (Rule 1) instead of trusting the literal-table shape silently.
    let abs;
    try {
      abs = safePath.resolveSafeRelativePath(REPO_ROOT, rel, { label: 'calibration checker candidate' });
    } catch (e) {
      continue; // FAIL-OPEN: a malformed checkerCandidates entry is not a valid path to probe; try the next candidate rather than crash the whole calibration run.
    }
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
// runCalibrateProcess(checkerPath, jsonOut) -> stdout from spawning the checker's --calibrate
// contract, having already validated its exit status against the two runner-judged states.
// The --calibrate contract has exactly two runner-judged statuses: 0 (checker found violations) and
// 1 (checker found ZERO on its fixtures - the caller then FAILs that calibration from the empty
// findings list). Exit 2 means the checker's OWN self-test failed: it is a broken tool and can
// NEVER earn a PASS, no matter what findings it managed to write. A broken self-test masked by
// parsed findings is the unearned-zero disease (Constitution Rule 4), so reject it unconditionally.
function runCalibrateProcess(checkerPath, jsonOut) {
  let stdout = '';
  let status = 0;
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
    status = (typeof e.status === 'number') ? e.status : 2;
  }
  if (status === 2) {
    throw new Error('checker self-test FAILED (exit 2): it cannot see the class it exists to catch, so its calibration result is void and cannot be masked by any parsed findings');
  }
  if (status !== 0 && status !== 1) {
    throw new Error('checker exited with undocumented --calibrate status ' + status + ' (expected 0 = findings, 1 = zero-findings, 2 = broken self-test)');
  }
  return stdout;
}

// safeJsonParse(text) -> the parsed JSON value, or null when `text` is not valid JSON. Used for
// the stdout dialect: a non-JSON stdout just means the checker uses the file dialect instead.
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null; // FAIL-OPEN: non-JSON stdout just means the checker uses the file dialect; handled by the caller.
  }
}

// findingsFromParsed(parsed) -> a findings array if `parsed` looks like a --calibrate findings
// payload (a bare array, or {findings:[...]}), else null.
function findingsFromParsed(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.findings)) return parsed.findings;
  return null;
}

function runExternalChecker(checkerPath) {
  const jsonOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calibrate-')), 'findings.json');
  const stdout = runCalibrateProcess(checkerPath, jsonOut);
  if (fs.existsSync(jsonOut)) {
    const fromFile = findingsFromParsed(JSON.parse(fs.readFileSync(jsonOut, 'utf8')));
    if (fromFile) return fromFile;
  }
  const fromStdout = findingsFromParsed(safeJsonParse(stdout));
  if (fromStdout) return fromStdout;
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

// missingCheckerResult(cal, strict) -> the {entries,failed,skipped} result when no checker under
// tools/ was found for this calibration: FAIL in --strict mode (a fixture without a live checker
// is an unearned zero), SKIPPED otherwise (tools/ agent has not landed this gate yet).
function missingCheckerResult(cal, strict) {
  const detail = `no checker found (looked at: ${cal.checkerCandidates.join(', ')})`;
  if (strict) {
    return { entries: [{ name: cal.name, status: 'FAIL', detail: `${detail} - strict mode: a fixture without a live checker is an unearned zero` }], failed: 1, skipped: 0 };
  }
  return { entries: [{ name: cal.name, status: 'SKIPPED', detail: `${detail} - tools/ agent has not landed this gate yet; CI must flip to --strict when it does` }], failed: 0, skipped: 1 };
}

// judgeCheckerFindings(cal, checker) -> {entries, failed} from running the checker and confirming
// EVERY fixture listed for this calibration was caught (CR-38: a multi-fixture calibration
// previously passed as long as ONE fixture produced a finding, so a checker could keep catching an
// old fixture while missing a new one).
function judgeCheckerFindings(cal, checker) {
  const findings = runExternalChecker(checker);
  const missingFixtures = cal.fixtures.filter((fx) => !findings.some((fd) => String(fd.file || '').includes(fx)));
  const fixtureHits = findings.filter((fd) => cal.fixtures.some((fx) => String(fd.file || '').includes(fx)));
  if (missingFixtures.length === 0) {
    return { entries: [{ name: cal.name, status: 'PASS', detail: `${fixtureHits.length} finding(s) across all ${cal.fixtures.length} fixture(s) via ${path.relative(REPO_ROOT, checker)}` }], failed: 0 };
  }
  return { entries: [{ name: cal.name, status: 'FAIL', detail: `${path.relative(REPO_ROOT, checker)} reported ZERO findings on: ${missingFixtures.join(', ')} - it has not earned its zero on every seeded fixture (${cal.description})` }], failed: 1 };
}

// runExternalCalibration(cal, strict) -> {entries, failed, skipped}. Locates the checker under
// tools/ via findChecker(), reports SKIPPED (or FAIL in --strict mode) if none is found yet, and
// otherwise runs its --calibrate contract via runExternalChecker() and checks every listed
// fixture was caught. Behaviour is unchanged from the original inline version: failed/skipped are
// still exactly 0 or 1 per call (missingCheckerResult and judgeCheckerFindings each push exactly
// one entry and increment their own counter by at most 1).
function runExternalCalibration(cal, strict) {
  const checker = findChecker(cal.checkerCandidates);
  if (!checker) return missingCheckerResult(cal, strict);
  try {
    const { entries, failed } = judgeCheckerFindings(cal, checker);
    return { entries, failed, skipped: 0 };
  } catch (e) {
    return { entries: [{ name: cal.name, status: 'FAIL', detail: `checker errored or broke the --calibrate contract: ${e.message}` }], failed: 1, skipped: 0 };
  }
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
  // f is always a literal fixture filename from the CALIBRATIONS table above.
  const fixtureAbs = cal.fixtures.map((f) => safePath.safeJoin(FIXTURES_DIR, [f], { label: 'calibration fixture' }));
  const missing = checkMissingFixtures(cal, fixtureAbs);
  if (missing.entries.length > 0) return missing;
  if (cal.internal) return runInternalCalibration(cal, fixtureAbs);
  return runExternalCalibration(cal, strict);
}

// report({strict, results, failed, skipped, asJson}) -> prints the run's summary in --json or
// human form, unchanged from the original inline block in main() (params bundled into one object;
// not exported, so the call site below is the only caller to update).
function report({ strict, results, failed, skipped, asJson }) {
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

  report({ strict, results, failed, skipped, asJson });
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { CALIBRATIONS, runExternalChecker };
