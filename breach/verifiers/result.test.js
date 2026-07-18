'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { CODES, accepted, rejected } = require('./result');

test('CODES is frozen and every value is a unique, non-empty string', () => {
  assert.ok(Object.isFrozen(CODES));
  const values = Object.values(CODES);
  assert.ok(values.length > 0);
  for (const v of values) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
  assert.equal(new Set(values).size, values.length, 'every code value must be unique');
});

test('accepted(code, reason) returns verified:true and carries the code and reason through unchanged', () => {
  const r = accepted(CODES.QUOTE_VERIFIED, 'example reason');
  assert.deepEqual(r, { verified: true, code: CODES.QUOTE_VERIFIED, reason: 'example reason' });
});

test('rejected(code, reason) returns verified:false and carries the code and reason through unchanged', () => {
  const r = rejected(CODES.QUOTE_MISMATCH, 'example reason');
  assert.deepEqual(r, { verified: false, code: CODES.QUOTE_MISMATCH, reason: 'example reason' });
});

test('CODES is genuinely frozen: a strict-mode write throws rather than silently succeeding', () => {
  assert.throws(() => { CODES.NEW_CODE = 'new_code'; }, TypeError);
  assert.equal(CODES.NEW_CODE, undefined);
});
