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

test('isSafeRelativePath: accepts nested relative and absolute paths with no traversal segment', () => {
  assert.equal(safePath.isSafeRelativePath('catalogue/packs'), true);
  assert.equal(safePath.isSafeRelativePath('out/catalogue.v1.json'), true);
  assert.equal(safePath.isSafeRelativePath('RELEASE_STAMP'), true);
  assert.equal(safePath.isSafeRelativePath('/tmp/some/abs/path.json'), true);
});

test('isSafeRelativePath: rejects any ".." segment, a null byte, or an empty string', () => {
  assert.equal(safePath.isSafeRelativePath('../etc/passwd'), false);
  assert.equal(safePath.isSafeRelativePath('catalogue/../../../etc/passwd'), false);
  assert.equal(safePath.isSafeRelativePath('a/b\0c'), false);
  assert.equal(safePath.isSafeRelativePath(''), false);
  assert.equal(safePath.isSafeRelativePath(null), false);
});

test('assertSafeRelativePath: throws on a traversal path and returns the value unchanged otherwise', () => {
  assert.throws(() => safePath.assertSafeRelativePath('../x', { label: '--out' }), /--out/);
  assert.equal(safePath.assertSafeRelativePath('out/x.json'), 'out/x.json');
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
