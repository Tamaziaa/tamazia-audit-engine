'use strict';
// catalogue/valid-date.test.js
//   node --test catalogue/valid-date.test.js

const test = require('node:test');
const assert = require('node:assert');

const { isRealDate, isRealTimestamp } = require('./valid-date');

test('isRealDate: accepts real dates including leap days, rejects impossible ones', () => {
  assert.equal(isRealDate('2026-07-16'), true);
  assert.equal(isRealDate('2028-02-29'), true);  // 2028 is a leap year
  assert.equal(isRealDate('2027-02-29'), false); // 2027 is not
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('2026-00-10'), false);
  assert.equal(isRealDate('2026-07-32'), false);
  assert.equal(isRealDate('16-07-2026'), false);
  assert.equal(isRealDate(''), false);
  assert.equal(isRealDate(null), false);
});

test('isRealTimestamp: accepts real UTC instants, rejects impossible dates/times', () => {
  assert.equal(isRealTimestamp('2026-07-16T00:00:00Z'), true);
  assert.equal(isRealTimestamp('2026-07-16T23:59:59.999Z'), true);
  assert.equal(isRealTimestamp('2026-02-30T00:00:00Z'), false);
  assert.equal(isRealTimestamp('2026-13-01T00:00:00Z'), false);
  assert.equal(isRealTimestamp('2026-07-16T24:00:00Z'), false);
  assert.equal(isRealTimestamp('2026-07-16T00:60:00Z'), false);
  assert.equal(isRealTimestamp('2026-07-16T00:00:60Z'), false);
  assert.equal(isRealTimestamp('2026-07-16'), false); // date only, not an instant
});
