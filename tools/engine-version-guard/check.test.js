'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const guard = require('./check.js');
const { ENGINE_VERSION } = require('../../mint/version.js');

// ── selfTest() itself ───────────────────────────────────────────────────────────────────────────────
test('selfTest() passes in memory, both directions, before any git call (bump-missing/bump-present/test-only)', () => {
  const st = guard.selfTest();
  assert.strictEqual(st.pass, true, st.detail);
});

// ── isScanLogicPath: the pure classifier ────────────────────────────────────────────────────────────
test('isScanLogicPath: the five directories match at any depth', () => {
  assert.strictEqual(guard.isScanLogicPath('evidence/crawler/crawl.js'), true);
  assert.strictEqual(guard.isScanLogicPath('facts/identity.js'), true);
  assert.strictEqual(guard.isScanLogicPath('applicability/connect.js'), true);
  assert.strictEqual(guard.isScanLogicPath('breach/adjudicator/adjudicate.js'), true);
  assert.strictEqual(guard.isScanLogicPath('llm/gate.js'), true);
  assert.strictEqual(guard.isScanLogicPath('llm/providers/chain.js'), true, 'any depth inside llm/**');
  assert.strictEqual(guard.isScanLogicPath('catalogue/compile.js'), true);
  assert.strictEqual(guard.isScanLogicPath('payload/composer/sections.js'), true);
});

test('isScanLogicPath: llm/evals/run.js DOES count - a documented choice, not an oversight', () => {
  assert.strictEqual(guard.isScanLogicPath('llm/evals/run.js'), true);
});

test('isScanLogicPath: near-misses are resisted (caution.md C-019: anchor every prefix test with a delimiter)', () => {
  assert.strictEqual(guard.isScanLogicPath('evidence-old/x.js'), false);
  assert.strictEqual(guard.isScanLogicPath('facts-cache/x.js'), false);
  assert.strictEqual(guard.isScanLogicPath('breachreport/x.js'), false);
  assert.strictEqual(guard.isScanLogicPath('catalogue/compile-helpers.js'), false, 'exact filename only, not a prefix');
  assert.strictEqual(guard.isScanLogicPath('sub/catalogue/compile.js'), false, 'root-relative only, not nested under another dir');
  assert.strictEqual(guard.isScanLogicPath('payload/composer2/x.js'), false, 'composer2 is not composer/');
  assert.strictEqual(guard.isScanLogicPath('payload/contract/index.js'), false, 'only composer/** is named, not contract/**');
});

test('isScanLogicPath: only production .js counts; *.test.js and non-.js files are excluded', () => {
  assert.strictEqual(guard.isScanLogicPath('evidence/crawler/crawl.test.js'), false);
  assert.strictEqual(guard.isScanLogicPath('facts/identity.test.js'), false);
  assert.strictEqual(guard.isScanLogicPath('evidence/README.md'), false);
  assert.strictEqual(guard.isScanLogicPath('llm/prompts/adjudicate.json'), false);
});

test('isScanLogicPath: tests/docs/tools/eval/workflow paths never require a bump', () => {
  for (const p of ['docs/foo.md', 'tools/sweep/run.js', 'eval/calibration-known-bad/run.js', '.github/workflows/ci.yml', 'render-proof/truth-pack.spec.js', 'mint/version.js', 'mint/persist.js']) {
    assert.strictEqual(guard.isScanLogicPath(p), false, p);
  }
});

// ── decide(): the pure verdict ──────────────────────────────────────────────────────────────────────
test('decide: bump-missing FAILS closed (Rule 15)', () => {
  const r = guard.decide({ changedFiles: ['evidence/crawler/crawl.js'], baseVersion: 'engine-v2.0.0-p4', headVersion: 'engine-v2.0.0-p4' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.scanLogicChanged, true);
  assert.deepStrictEqual(r.matched, ['evidence/crawler/crawl.js']);
  assert.match(r.reason, /Rule 15/);
});

test('decide: bump-present PASSES', () => {
  const r = guard.decide({ changedFiles: ['evidence/crawler/crawl.js'], baseVersion: 'engine-v2.0.0-p4', headVersion: 'engine-v2.0.1-p4' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.scanLogicChanged, true);
  assert.match(r.reason, /engine-v2\.0\.1-p4/);
});

test('decide: test-only/tooling-only change PASSES with no bump', () => {
  const r = guard.decide({ changedFiles: ['evidence/crawler/crawl.test.js', 'tools/sweep/run.js'], baseVersion: 'X', headVersion: 'X' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.scanLogicChanged, false);
  assert.deepStrictEqual(r.matched, []);
});

test('decide: a mix of scan-logic and non-scan-logic changes still requires the bump', () => {
  const r = guard.decide({ changedFiles: ['docs/foo.md', 'facts/sector.js', 'facts/sector.test.js'], baseVersion: 'v1', headVersion: 'v1' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.matched, ['facts/sector.js']);
});

test('decide: an empty changed-file list PASSES trivially', () => {
  assert.strictEqual(guard.decide({ changedFiles: [], baseVersion: 'X', headVersion: 'X' }).ok, true);
});

// ── real git plumbing, on a hermetic scratch repo (never touches THIS repo's own history/branches) ────
function makeScratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evg-guard-test-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Test']);
  return { dir, git };
}
function writeAndCommit(repo, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '-m', message]);
  return repo.git(['rev-parse', 'HEAD']).trim();
}
const versionJs = (v) => "'use strict';\nconst ENGINE_VERSION = '" + v + "';\nmodule.exports = Object.freeze({ ENGINE_VERSION });\n";

test('real git plumbing: scan-logic change with NO bump -> decide() fails, end to end on a hermetic repo', () => {
  const repo = makeScratchRepo();
  try {
    const base = writeAndCommit(repo, { 'mint/version.js': versionJs('v1'), 'README.md': 'x' }, 'base');
    writeAndCommit(repo, { 'evidence/x.js': 'module.exports = 1;\n' }, 'change scan logic, no bump');
    const mergeBase = guard.gitMergeBase(base, repo.dir);
    assert.strictEqual(mergeBase, base);
    const changed = guard.gitDiffNameOnly(mergeBase, repo.dir);
    assert.deepStrictEqual(changed, ['evidence/x.js']);
    const baseVersion = guard.versionAtRef(mergeBase, repo.dir);
    const headVersion = guard.versionAtRef('HEAD', repo.dir);
    assert.strictEqual(baseVersion, 'v1');
    assert.strictEqual(headVersion, 'v1');
    assert.strictEqual(guard.decide({ changedFiles: changed, baseVersion, headVersion }).ok, false);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('real git plumbing: scan-logic change WITH a bump -> decide() passes, end to end', () => {
  const repo = makeScratchRepo();
  try {
    const base = writeAndCommit(repo, { 'mint/version.js': versionJs('v1') }, 'base');
    writeAndCommit(repo, { 'evidence/x.js': 'module.exports = 1;\n', 'mint/version.js': versionJs('v2') }, 'change scan logic WITH a bump');
    const mergeBase = guard.gitMergeBase(base, repo.dir);
    const changed = guard.gitDiffNameOnly(mergeBase, repo.dir);
    const baseVersion = guard.versionAtRef(mergeBase, repo.dir);
    const headVersion = guard.versionAtRef('HEAD', repo.dir);
    assert.strictEqual(baseVersion, 'v1');
    assert.strictEqual(headVersion, 'v2');
    assert.strictEqual(guard.decide({ changedFiles: changed, baseVersion, headVersion }).ok, true);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('real git plumbing: a test-only change PASSES end to end with no bump', () => {
  const repo = makeScratchRepo();
  try {
    const base = writeAndCommit(repo, { 'mint/version.js': versionJs('v1') }, 'base');
    writeAndCommit(repo, { 'evidence/x.test.js': 'module.exports = 1;\n' }, 'test-only change');
    const mergeBase = guard.gitMergeBase(base, repo.dir);
    const changed = guard.gitDiffNameOnly(mergeBase, repo.dir);
    assert.deepStrictEqual(changed, ['evidence/x.test.js']);
    const baseVersion = guard.versionAtRef(mergeBase, repo.dir);
    const headVersion = guard.versionAtRef('HEAD', repo.dir);
    assert.strictEqual(guard.decide({ changedFiles: changed, baseVersion, headVersion }).ok, true);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('versionAtRef against THIS repo at HEAD (no cwd override) matches the real mint/version.js module', () => {
  assert.strictEqual(guard.versionAtRef('HEAD'), ENGINE_VERSION);
});

test('KNOWN-BAD calibration: versionAtRef throws when mint/version.js carries no parseable ENGINE_VERSION literal', () => {
  const repo = makeScratchRepo();
  try {
    writeAndCommit(repo, { 'mint/version.js': 'module.exports = {};\n' }, 'no ENGINE_VERSION literal');
    assert.throws(() => guard.versionAtRef('HEAD', repo.dir), /does not carry a parseable ENGINE_VERSION/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('KNOWN-BAD calibration: gitMergeBase throws (fail closed) on an unresolvable ref, never a silent empty diff', () => {
  const repo = makeScratchRepo();
  try {
    writeAndCommit(repo, { 'mint/version.js': versionJs('v1') }, 'base');
    assert.throws(() => guard.gitMergeBase('not-a-real-ref-at-all', repo.dir));
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
