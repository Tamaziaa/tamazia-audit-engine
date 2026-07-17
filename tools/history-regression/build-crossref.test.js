'use strict';
// tools/history-regression/build-crossref.test.js
//   node --test tools/history-regression/build-crossref.test.js
//
// CR#31: a keyword is only a signal WITH semantic context (caution.md C-203). "out of scope" is not
// module-scope state, and a bare "market" must not match "marketing". CR#32: truncated/inconsistent
// sweep metadata must be rejected before a cross-reference is emitted.

const test = require('node:test');
const assert = require('node:assert');

const { classifyOther, assertSweepConsistent } = require('./build-crossref');

test('classifyOther: "out of scope" no longer classifies as module-scope-state', () => {
  assert.notStrictEqual(classifyOther('this finding is out of scope for the mint path'), 'module-scope-state');
});

test('classifyOther: genuine module-scope wording still classifies as module-scope-state', () => {
  assert.strictEqual(classifyOther('a module-scope singleton cached process-wide'), 'module-scope-state');
});

test('classifyOther: "marketing" does not match the jurisdiction-nexus rule', () => {
  assert.notStrictEqual(classifyOther('a marketing headline used as the display name'), 'jurisdiction-nexus');
});

test('classifyOther: a real market/nexus finding still classifies as jurisdiction-nexus', () => {
  assert.strictEqual(classifyOther('serves clients in that market but is not bound there'), 'jurisdiction-nexus');
  assert.strictEqual(classifyOther('detectMarkets anchored to no incorporated country'), 'jurisdiction-nexus');
});

test('assertSweepConsistent: a truncated findings array vs a larger cluster count is rejected', () => {
  assert.throws(() => assertSweepConsistent({ findings: [{}, {}], clusters: 256 }), /inconsistent/);
});

test('assertSweepConsistent: findings.length matching clusters is accepted', () => {
  assert.doesNotThrow(() => assertSweepConsistent({ findings: [{}, {}], clusters: 2 }));
});

test('assertSweepConsistent: a non-array findings field is rejected', () => {
  assert.throws(() => assertSweepConsistent({ findings: 'nope', clusters: 0 }), /not an array/);
});
