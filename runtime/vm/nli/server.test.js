'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { standInEntail } = require('./server.js');

test('standInEntail marks every response modelStaged:true (never mistaken for a real verdict)', () => {
  const r = standInEntail('the site has a privacy policy', 'privacy policy present');
  assert.equal(r.modelStaged, true);
});

test('standInEntail abstains to neutral on missing input (known-bad fixture)', () => {
  const r = standInEntail('', '');
  assert.equal(r.label, 'neutral');
  assert.equal(r.score, 0);
});

test('standInEntail leans entailment on high lexical overlap', () => {
  const r = standInEntail('we use cookies for analytics and marketing', 'cookies analytics marketing');
  assert.equal(r.label, 'entailment');
});

test('standInEntail leans contradiction on near-zero overlap', () => {
  const r = standInEntail('we sell organic coffee beans', 'quantum encryption protocol');
  assert.equal(r.label, 'contradiction');
});
