'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const viaIndex = require('./index.js');
const direct = require('./quote-match.js');

test('index.js re-exports exactly the quote-match.js public API (same function references, nothing added or removed)', () => {
  assert.equal(viaIndex.verifyCandidate, direct.verifyCandidate);
  assert.equal(viaIndex.verifyAll, direct.verifyAll);
  assert.equal(viaIndex.verifyQuote, direct.verifyQuote);
  assert.equal(viaIndex.normaliseWhitespace, direct.normaliseWhitespace);
  assert.equal(viaIndex.CODES, direct.CODES);
  assert.deepEqual(Object.keys(viaIndex).sort(), Object.keys(direct).sort());
});
