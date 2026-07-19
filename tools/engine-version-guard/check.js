#!/usr/bin/env node
'use strict';
/**
 * ENGINE-VERSION-GUARD: no scan cache; the engine version is load-bearing (Constitution Rule 15,
 * GAPS.md `cache-version`, caution.md C-166/C-167/C-177).
 *
 * A legal-evidence engine keeps NO scan cache: a day-old scan dated today is not evidence. Any change
 * to scan logic rides ENGINE_VERSION through the mint idempotency key (mint/persist.js's ON CONFLICT
 * (url, engine_version) target) and the DB-level required_engine_version trigger every minter must pass
 * (mint/post-write-assertions.js). A PR that changes scan logic without bumping mint/version.js's
 * ENGINE_VERSION string would silently replay pre-fix behaviour exactly the way scanner_cache did for
 * four rounds running, and the way a rogue pre-gate worker once minted on a stale version for days
 * (caution.md C-166/C-167/C-177).
 *
 * WHAT FAILS THE BUILD (exit 1): a pull request that touches any SCAN-LOGIC path (see isScanLogicPath
 * below) while mint/version.js's ENGINE_VERSION is byte-identical between the merge base and HEAD.
 *
 * SCAN-LOGIC SURFACE (the version-bearing paths; everything else may change freely without a bump):
 *   evidence/**, facts/**, applicability/**, breach/**, llm/**   production .js only, EXCLUDING
 *                                                                 *.test.js - the WHOLE subtree, any
 *                                                                 depth, INCLUDING llm/evals/run.js: a
 *                                                                 deliberate, documented choice (see
 *                                                                 isScanLogicPath), not an oversight.
 *   catalogue/compile.js                                         the ONE compiler entry point.
 *   payload/composer/**                                          the payload transform.
 * Changes confined to tests (*.test.js anywhere), docs/, tools/, eval/ or .github/workflows/ never
 * require a bump: none of those paths sit inside the five directories or two extra entries above, so
 * they never match isScanLogicPath regardless of this note - the note documents the effect, it is not
 * a second exclusion mechanism.
 *
 * DESIGN: the git-facing calls (gitMergeBase / gitDiffNameOnly / versionAtRef) are the ONLY impure
 * functions in this file, each `cwd`-injectable so node:test can point them at a hermetic scratch repo
 * instead of THIS one (a shallow CI checkout of this repo may have too little history for a real
 * merge-base against an old ancestor - the C-201 "tree the tests see" class, generalised to git depth).
 * decide() is pure over {changedFiles, baseVersion, headVersion} and carries its own selfTest() that
 * proves both directions IN MEMORY before any git command ever runs (the tools/history-regression/
 * check.js self-test-first doctrine, mirrored here).
 *
 * Modes:
 *   node tools/engine-version-guard/check.js <base-ref>   the real check. <base-ref> is any ref/SHA git
 *                                                          can resolve (CI passes the PR's base SHA); the
 *                                                          guard computes the merge-base itself. Exit 0
 *                                                          pass, 1 a real Rule-15 violation, 2 the guard
 *                                                          itself could not run (fail closed, Rule 4 -
 *                                                          never a silent pass).
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GIT_TIMEOUT_MS = 30000; // a CAP on every git subprocess call (Rule 8/9 spirit), never a floor.

// ── the pure scan-logic classifier (Rule 15's surface) ───────────────────────────────────────────────
const SCAN_LOGIC_DIRS = ['evidence/', 'facts/', 'applicability/', 'breach/', 'llm/'];
const SCAN_LOGIC_FILES = new Set(['catalogue/compile.js']);
const SCAN_LOGIC_COMPOSER_PREFIX = 'payload/composer/';
const TEST_FILE_RX = /\.test\.js$/;

// normalisePath(p) -> a forward-slash, leading-'./'-stripped repo-relative path. git diff --name-only
// already emits forward-slash paths on every platform CI runs on; this is a defensive normalisation.
function normalisePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

// isScanLogicPath(rawPath) -> true when a changed file sits on the version-bearing surface (Rule 15).
// Every directory test carries its OWN trailing slash so a near-miss like "evidence-old/x.js" or
// "facts-cache/x.js" can never match on a bare string prefix (caution.md C-019: anchor every prefix
// test with a delimiter, both-direction fixtures). Only *.js files count; *.test.js is excluded even
// inside these directories (a test asserting new behaviour is not itself the behaviour it asserts on).
function isScanLogicPath(rawPath) {
  const p = normalisePath(rawPath);
  if (!p.endsWith('.js') || TEST_FILE_RX.test(p)) return false;
  if (SCAN_LOGIC_FILES.has(p)) return true;
  if (p.startsWith(SCAN_LOGIC_COMPOSER_PREFIX)) return true;
  return SCAN_LOGIC_DIRS.some((d) => p.startsWith(d));
}

// classifyChangedFiles(changedFiles) -> the subset that are scan-logic paths, in input order.
function classifyChangedFiles(changedFiles) {
  return (Array.isArray(changedFiles) ? changedFiles : []).filter(isScanLogicPath);
}

// decide({changedFiles, baseVersion, headVersion}) -> {ok, scanLogicChanged, matched, reason}. PURE: no
// I/O, no git, no clock, no env. The whole Rule-15 verdict lives in one place so selfTest can prove it
// in memory before any real git command runs.
function decide({ changedFiles, baseVersion, headVersion }) {
  const matched = classifyChangedFiles(changedFiles);
  if (matched.length === 0) {
    return { ok: true, scanLogicChanged: false, matched, reason: 'no scan-logic path changed; ENGINE_VERSION bump not required.' };
  }
  if (baseVersion !== headVersion) {
    return {
      ok: true, scanLogicChanged: true, matched,
      reason: 'scan-logic changed and ENGINE_VERSION moved ' + JSON.stringify(baseVersion) + ' -> ' + JSON.stringify(headVersion) + '.',
    };
  }
  return {
    ok: false, scanLogicChanged: true, matched,
    reason: 'Rule 15 (No scan cache; the engine version is load-bearing): scan-logic file(s) changed ['
      + matched.join(', ') + '] but mint/version.js ENGINE_VERSION is still ' + JSON.stringify(headVersion)
      + ' at both the merge base and HEAD. Any change to scan logic bumps ENGINE_VERSION so it rides the '
      + 'mint idempotency key and the required_engine_version trigger (caution.md C-166/C-167/C-177): '
      + 'bump the string in mint/version.js.',
  };
}

// ── in-memory self-test: both directions, before any git command ever runs ─────────────────────────
const SELF_TEST_CASES = [
  { name: 'bump-missing FAILS (scan-logic changed, version unchanged)', input: { changedFiles: ['evidence/crawler/crawl.js'], baseVersion: 'engine-v2.0.0-p4', headVersion: 'engine-v2.0.0-p4' }, wantOk: false },
  { name: 'bump-present PASSES (scan-logic changed, version moved)', input: { changedFiles: ['evidence/crawler/crawl.js'], baseVersion: 'engine-v2.0.0-p4', headVersion: 'engine-v2.0.1-p4' }, wantOk: true },
  { name: 'test-only change PASSES (no scan-logic path, version unchanged)', input: { changedFiles: ['evidence/crawler/crawl.test.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'docs/tools/eval/workflow-only change PASSES with no bump', input: { changedFiles: ['docs/foo.md', 'tools/sweep/run.js', 'eval/calibration-known-bad/run.js', '.github/workflows/ci.yml'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'catalogue/compile.js counts as scan-logic (bump-missing FAILS)', input: { changedFiles: ['catalogue/compile.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: false },
  { name: 'payload/composer/** counts as scan-logic (bump-missing FAILS)', input: { changedFiles: ['payload/composer/sections.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: false },
  { name: 'payload/contract/** does NOT count (only composer/** is named)', input: { changedFiles: ['payload/contract/index.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'near-miss directory name resisted (evidence-old/ is not evidence/, C-019)', input: { changedFiles: ['evidence-old/x.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'near-miss file name resisted (compile-helpers.js is not compile.js)', input: { changedFiles: ['catalogue/compile-helpers.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'llm/evals/run.js DOES count (documented choice: the whole llm/** tree, only *.test.js excluded)', input: { changedFiles: ['llm/evals/run.js'], baseVersion: 'X', headVersion: 'X' }, wantOk: false },
  { name: 'a non-.js file inside a scan-logic dir does not count', input: { changedFiles: ['evidence/README.md'], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
  { name: 'an empty changed-file list PASSES trivially', input: { changedFiles: [], baseVersion: 'X', headVersion: 'X' }, wantOk: true },
];

// selfTest() -> {pass, detail}. Proves, in memory and with zero I/O, that decide() sees the class this
// guard exists to catch: a checker that cannot see its own disease reports every clean run unearned
// (caution.md C-149).
function selfTest() {
  const fails = [];
  for (const c of SELF_TEST_CASES) {
    const got = decide(c.input).ok;
    if (got !== c.wantOk) fails.push(c.name + ': want ok=' + c.wantOk + ' got ok=' + got);
  }
  return {
    pass: fails.length === 0,
    detail: fails.join('; ') || 'all ' + SELF_TEST_CASES.length + ' cases correct (bump-missing fails, bump-present passes, test-only/docs/tools/eval/workflow-only passes)',
  };
}

// ── git-facing calls: the ONLY impure functions here, each cwd-injectable (default: this repo) ────────
function runGit(args, cwd) {
  return execFileSync('git', args, { cwd: cwd || ROOT, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

// gitMergeBase(baseRef, cwd) -> the merge-base commit SHA between baseRef and HEAD (trimmed). Throws
// (fail closed) if either ref cannot be resolved or history is too shallow to find a common ancestor.
function gitMergeBase(baseRef, cwd) {
  return runGit(['merge-base', baseRef, 'HEAD'], cwd).trim();
}

// gitDiffNameOnly(fromRef, cwd) -> the repo-relative paths changed between fromRef and HEAD.
function gitDiffNameOnly(fromRef, cwd) {
  return runGit(['diff', '--name-only', fromRef, 'HEAD'], cwd).split('\n').map((l) => l.trim()).filter(Boolean);
}

const ENGINE_VERSION_RX = /ENGINE_VERSION\s*=\s*['"]([^'"]+)['"]/;
// versionAtRef(ref, cwd) -> the ENGINE_VERSION string literal mint/version.js carries AT that ref, via
// `git show` (never `require()`: executing an arbitrary historical commit's code is not a string read -
// a regex extraction of the frozen literal is the safer and sufficient primitive here). Throws (fail
// closed) if the file is absent at that ref or does not carry a parseable literal.
function versionAtRef(ref, cwd) {
  const src = runGit(['show', ref + ':mint/version.js'], cwd);
  const m = ENGINE_VERSION_RX.exec(src);
  if (!m) throw new Error('mint/version.js at ' + ref + ' does not carry a parseable ENGINE_VERSION string literal');
  return m[1];
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
function usageAndExit() {
  console.error('usage: node tools/engine-version-guard/check.js <base-ref>');
  process.exit(2);
}

// abortIfSelfTestFails() -> run the in-memory self-test and exit 2 (a broken tool) if the guard cannot
// see the class it exists to catch. Runs before ANY git command (self-test-first doctrine).
function abortIfSelfTestFails() {
  const st = selfTest();
  if (st.pass) return;
  console.error('engine-version-guard SELF-TEST FAILED: ' + st.detail);
  console.error('The guard cannot see the class it exists to catch. Every zero it reports would be unearned.');
  process.exit(2);
}

// runReal(baseRef) -> the real check against THIS repo's git history. Never returns (always exits).
function runReal(baseRef) {
  let mergeBase, changedFiles, baseVersion, headVersion;
  try {
    mergeBase = gitMergeBase(baseRef);
    changedFiles = gitDiffNameOnly(mergeBase);
    baseVersion = versionAtRef(mergeBase);
    headVersion = versionAtRef('HEAD');
  } catch (e) {
    // FAIL-OPEN: a git/version-read failure is captured HERE as a REFUSAL (exit 2), never silently
    // treated as "no scan-logic changed" (Rule 4: an analyser that errors must BLOCK, not pass).
    console.error('engine-version-guard REFUSES: could not compute the diff or read ENGINE_VERSION (fail closed, Rule 4): ' + String((e && e.message) || e));
    process.exit(2);
    return;
  }
  const res = decide({ changedFiles, baseVersion, headVersion });
  console.log('  engine-version-guard: merge-base ' + mergeBase.slice(0, 12) + ', ' + changedFiles.length
    + ' file(s) changed, ' + res.matched.length + ' on the scan-logic surface (self-test: earned)');
  if (res.matched.length) console.log('    scan-logic file(s): ' + res.matched.join(', '));
  if (res.ok) console.log('  PASS: ' + res.reason);
  else console.error('  VIOLATION: ' + res.reason);
  process.exit(res.ok ? 0 : 1);
}

function main() {
  abortIfSelfTestFails();
  const baseRef = process.argv[2];
  if (!baseRef) { usageAndExit(); return; }
  runReal(baseRef);
}

if (require.main === module) main();

module.exports = {
  isScanLogicPath,
  classifyChangedFiles,
  decide,
  selfTest,
  gitMergeBase,
  gitDiffNameOnly,
  versionAtRef,
  SCAN_LOGIC_DIRS,
  SCAN_LOGIC_FILES,
  SCAN_LOGIC_COMPOSER_PREFIX,
};
