'use strict';
// tools/lib/safe-path.test.js - node:test suite for the shared path-traversal allowlist gate
// (SCAN-1..6,8,9: compile.js, catalogue/linters/lib.js and tools/facts-abstain/check.js all route
// their dynamic path.join/path.resolve components through this module).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const safePath = require('./safe-path.js');

// ---------------------------------------------------------------------------------
// isSafePathComponent / assertSafePathComponent
// ---------------------------------------------------------------------------------

test('isSafePathComponent: accepts real pack/sidecar filenames', () => {
  assert.equal(safePath.isSafePathComponent('uk-legal.json'), true);
  assert.equal(safePath.isSafePathComponent('uk-legal.QA.md'), true);
  assert.equal(safePath.isSafePathComponent('p2-schema-violation.json'), true);
});

test('isSafePathComponent: rejects traversal, separators, dot-only, empty and non-strings', () => {
  assert.equal(safePath.isSafePathComponent('..'), false);
  assert.equal(safePath.isSafePathComponent('.'), false);
  assert.equal(safePath.isSafePathComponent('../etc/passwd'), false);
  assert.equal(safePath.isSafePathComponent('a/b'), false);
  assert.equal(safePath.isSafePathComponent('a\\b'), false);
  assert.equal(safePath.isSafePathComponent(''), false);
  assert.equal(safePath.isSafePathComponent('a\0b'), false);
  assert.equal(safePath.isSafePathComponent(null), false);
  assert.equal(safePath.isSafePathComponent(undefined), false);
  assert.equal(safePath.isSafePathComponent(42), false);
});

test('assertSafePathComponent: throws Error by default, and a caller-supplied ErrorClass otherwise', () => {
  assert.throws(() => safePath.assertSafePathComponent('..'), Error);
  class MyError extends Error {}
  assert.throws(() => safePath.assertSafePathComponent('../x', { ErrorClass: MyError }), MyError);
  assert.doesNotThrow(() => safePath.assertSafePathComponent('uk-legal.json'));
});

// ---------------------------------------------------------------------------------
// isSafeRelativePath / assertSafeRelativePath
// ---------------------------------------------------------------------------------

test('isSafeRelativePath: accepts nested relative paths with no traversal segment', () => {
  assert.equal(safePath.isSafeRelativePath('catalogue/packs'), true);
  assert.equal(safePath.isSafeRelativePath('out/catalogue.v1.json'), true);
  assert.equal(safePath.isSafeRelativePath('RELEASE_STAMP'), true);
});

test('isSafeRelativePath: rejects an ABSOLUTE path (it escapes the base under path.resolve even with no ".." segment) (CR safe-path.js:43)', () => {
  assert.equal(safePath.isSafeRelativePath('/tmp/some/abs/path.json'), false);
  assert.equal(safePath.isSafeRelativePath('/etc/passwd'), false);
});

test('isSafeRelativePath: rejects any ".." segment, a null byte, or an empty string', () => {
  assert.equal(safePath.isSafeRelativePath('../etc/passwd'), false);
  assert.equal(safePath.isSafeRelativePath('catalogue/../../../etc/passwd'), false);
  assert.equal(safePath.isSafeRelativePath('a/b\0c'), false);
  assert.equal(safePath.isSafeRelativePath(''), false);
  assert.equal(safePath.isSafeRelativePath(null), false);
});

test('assertSafeRelativePath: throws on an absolute path (CR safe-path.js:43)', () => {
  assert.throws(() => safePath.assertSafeRelativePath('/etc/passwd', { label: '--out' }), /--out/);
});

test('assertSafeRelativePath: throws on a traversal path and returns the value unchanged otherwise', () => {
  assert.throws(() => safePath.assertSafeRelativePath('../x', { label: '--out' }), /--out/);
  assert.equal(safePath.assertSafeRelativePath('out/x.json'), 'out/x.json');
});

// ---------------------------------------------------------------------------------
// isSafeScanPath / assertSafeScanPath (CR safe-path.js:43 consumer audit): a READ-scan target
// accepts an ABSOLUTE path (used directly, no base to escape) OR a genuinely-relative one with no
// ".." segment - the read-side counterpart to the strictly-relative WRITE/config-arg contract.
// ---------------------------------------------------------------------------------

test('isSafeScanPath: accepts an ABSOLUTE read target (unlike isSafeRelativePath) and a clean relative one', () => {
  assert.equal(safePath.isSafeScanPath('/tmp/some/bundle.json'), true);
  assert.equal(safePath.isSafeScanPath(path.resolve('/var/folders/xyz')), true);
  assert.equal(safePath.isSafeScanPath('catalogue/packs'), true);
  assert.equal(safePath.isSafeScanPath('eval/calibration-known-bad/fixtures'), true);
  // and, unlike isSafeRelativePath, the absolute case is exactly the difference:
  assert.equal(safePath.isSafeRelativePath('/tmp/some/bundle.json'), false);
});

test('isSafeScanPath: still rejects a relative ".." traversal, a null byte, and empty/non-string', () => {
  assert.equal(safePath.isSafeScanPath('../../../etc/passwd'), false);
  assert.equal(safePath.isSafeScanPath('catalogue/../../etc'), false);
  assert.equal(safePath.isSafeScanPath('a/b\0c'), false);
  assert.equal(safePath.isSafeScanPath(''), false);
  assert.equal(safePath.isSafeScanPath(null), false);
});

test('assertSafeScanPath: returns an absolute path unchanged, but throws on relative traversal', () => {
  assert.equal(safePath.assertSafeScanPath('/tmp/x/bundle.json'), '/tmp/x/bundle.json');
  assert.equal(safePath.assertSafeScanPath('catalogue/packs'), 'catalogue/packs');
  assert.throws(() => safePath.assertSafeScanPath('../x', { label: 'scan dir' }), /scan dir/);
});

// ---------------------------------------------------------------------------------
// safeJoin
// ---------------------------------------------------------------------------------

test('safeJoin: joins safe components under the base directory', () => {
  const base = path.resolve('/tmp/base');
  assert.equal(safePath.safeJoin(base, ['uk-legal.json']), path.join(base, 'uk-legal.json'));
  assert.equal(safePath.safeJoin(base, ['uk-legal', '.QA.md'].join('')), path.join(base, 'uk-legal.QA.md'));
});

test('safeJoin: accepts a single component passed as a bare string (not wrapped in an array)', () => {
  const base = path.resolve('/tmp/base');
  assert.equal(safeJoinSingle(base, 'uk-legal.json'), path.join(base, 'uk-legal.json'));
  function safeJoinSingle(b, c) { return safePath.safeJoin(b, c); }
});

test('safeJoin: throws on a traversal component before ever calling path.join', () => {
  const base = path.resolve('/tmp/base');
  assert.throws(() => safePath.safeJoin(base, ['..']));
  assert.throws(() => safePath.safeJoin(base, ['a/../../etc/passwd']));
});

test('safeJoin: throws with the caller-supplied ErrorClass and label', () => {
  class CompileError extends Error {}
  const base = path.resolve('/tmp/base');
  assert.throws(
    () => safePath.safeJoin(base, ['..'], { label: 'pack filename', ErrorClass: CompileError }),
    CompileError
  );
});

// ---------------------------------------------------------------------------------
// resolveSafeRelativePath / resolveSafeScanPath / resolveRepoRelative (FIX-A: the multi-segment
// and require-specifier resolve helpers that move the actual path.resolve call behind this door,
// so external call sites no longer write path.join/path.resolve with a non-literal argument
// themselves - see the file-level FIX-A NOTE).
// ---------------------------------------------------------------------------------

test('resolveSafeRelativePath: resolves a clean nested relative path against baseDir', () => {
  const base = path.resolve('/tmp/base');
  assert.equal(safePath.resolveSafeRelativePath(base, 'out/catalogue.v1.json'), path.resolve(base, 'out/catalogue.v1.json'));
});

test('resolveSafeRelativePath: throws on an absolute path or a traversal segment (never reaches path.resolve)', () => {
  const base = path.resolve('/tmp/base');
  assert.throws(() => safePath.resolveSafeRelativePath(base, '/etc/passwd', { label: '--out' }), /--out/);
  assert.throws(() => safePath.resolveSafeRelativePath(base, '../../etc/passwd', { label: '--out' }), /--out/);
});

test('resolveSafeScanPath: resolves a relative path against baseDir and passes an absolute one through unchanged', () => {
  const base = path.resolve('/tmp/base');
  assert.equal(safePath.resolveSafeScanPath(base, 'catalogue/packs'), path.resolve(base, 'catalogue/packs'));
  const abs = path.resolve('/tmp/elsewhere/bundle.json');
  assert.equal(safePath.resolveSafeScanPath(base, abs), path.resolve(base, abs));
  assert.equal(safePath.resolveSafeScanPath(base, abs), abs);
});

test('resolveSafeScanPath: throws on a relative traversal segment', () => {
  const base = path.resolve('/tmp/base');
  assert.throws(() => safePath.resolveSafeScanPath(base, '../../etc/passwd', { label: 'scan dir' }), /scan dir/);
});

test('resolveRepoRelative: resolves an ordinary relative require() specifier, including one that climbs directories', () => {
  const root = path.resolve('/tmp/repo');
  const fromFile = path.join(root, 'tools', 'sweep', 'collect-local.js');
  assert.equal(
    safePath.resolveRepoRelative(root, fromFile, '../lib/fswalk'),
    path.resolve(path.dirname(fromFile), '../lib/fswalk')
  );
});

test('resolveRepoRelative: throws when the specifier would resolve outside rootDir', () => {
  const root = path.resolve('/tmp/repo');
  const fromFile = path.join(root, 'tools', 'sweep', 'collect-local.js');
  assert.throws(() => safePath.resolveRepoRelative(root, fromFile, '../../../../../../etc/passwd', { label: 'require spec' }), /require spec/);
});
