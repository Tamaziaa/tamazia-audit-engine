'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { arr, isObject, str, numOrNull, num, recordIdOf, normaliseKey } = require('./util.js');

test('arr: array passes through, everything else becomes []', () => {
  assert.deepEqual(arr([1, 2]), [1, 2]);
  for (const x of [null, undefined, 'x', 3, {}, { length: 2 }]) assert.deepEqual(arr(x), []);
});

test('isObject: plain non-null non-array objects only', () => {
  assert.equal(isObject({}), true);
  for (const x of [null, undefined, [], 'x', 3, true]) assert.equal(isObject(x), false);
});

test('str: trims strings, stringifies finite numbers, else empty string (never null)', () => {
  assert.equal(str('  hi  '), 'hi');
  assert.equal(str(42), '42');
  for (const x of [null, undefined, {}, [], NaN, Infinity]) assert.equal(str(x), '');
});

test('numOrNull: finite number or null (never a silent 0)', () => {
  assert.equal(numOrNull(0), 0);
  assert.equal(numOrNull('5'), 5);
  for (const x of [null, undefined, 'x', NaN, Infinity, {}]) assert.equal(numOrNull(x), null);
});

test('num: finite number or the default', () => {
  assert.equal(num(3, 9), 3);
  assert.equal(num('x', 9), 9);
  assert.equal(num(undefined, 0), 0);
});

test('recordIdOf: reads record_id (findings/connect) OR id (raw catalogue records)', () => {
  assert.equal(recordIdOf({ record_id: 'A' }), 'A');
  assert.equal(recordIdOf({ id: 'B' }), 'B');
  assert.equal(recordIdOf({ record_id: 'A', id: 'B' }), 'A'); // record_id wins
  assert.equal(recordIdOf({ id: 7 }), '7');
});

test('normaliseKey: lowercase alphanumeric-token key for family grouping', () => {
  assert.equal(normaliseKey('UK GDPR, Article 13'), 'uk gdpr article 13');
  assert.equal(normaliseKey('  Foo--Bar  '), 'foo bar');
});

// KNOWN-BAD calibration: garbage or missing identifiers must yield '' (never throw, never guess an id),
// so a finding that carries no record id simply fails to join rather than crashing the mint.
test('KNOWN-BAD recordIdOf: non-object / no id yields empty string, never throws', () => {
  for (const x of [null, undefined, 'x', 3, {}, []]) assert.equal(recordIdOf(x), '');
});
