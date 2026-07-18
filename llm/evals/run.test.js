'use strict';
// run.test.js - locks the LLM-eval harness under npm test: the seeded set must stay at precision 1.0
// with zero false positives and zero immunity vetoes, and the tally must actually FAIL on a false
// positive (the gate earns its zero: a harness that cannot fail is theatre, C-163).

const test = require('node:test');
const assert = require('node:assert');

const { evaluate, loadFixtures, tallyClassification } = require('./run.js');

test('the seeded set holds at least 12 fixtures across the required classes', () => {
  const fx = loadFixtures();
  assert.ok(fx.length >= 12, 'need >=12 fixtures, found ' + fx.length);
  const kinds = new Set(fx.map((f) => f.kind));
  for (const k of ['adjudication', 'entailment', 'gate', 'quorum-immunity']) {
    assert.ok(kinds.has(k), 'missing fixture kind: ' + k);
  }
  assert.ok(fx.some((f) => f.class === 'known-breach'), 'need a known-breach class');
  assert.ok(fx.some((f) => f.class === 'known-clean'), 'need a known-clean class');
});

test('the whole suite passes: precision 1.0, zero false positives, zero immunity vetoes', async () => {
  const v = await evaluate();
  assert.equal(v.ok, true, 'failed fixtures: ' + v.failedExpect.join(', '));
  assert.equal(v.precision, 1, 'precision must be a clean 1.0');
  assert.equal(v.fp, 0, 'zero false positives');
  assert.ok(v.tp >= 4, 'known-breach true positives must ship');
  assert.equal(v.immunityVetoes, 0, 'the jury must never veto a curated fact');
});

test('the harness reports a non-trivial abstain-rate (clean/gate tasks decline to accuse)', async () => {
  const v = await evaluate();
  assert.ok(v.abstainRate > 0 && v.abstainRate < 1, 'abstain-rate should be between 0 and 1, got ' + v.abstainRate);
});

test('tallyClassification earns its zero: a false positive drives precision below 1.0', () => {
  // a clean task (expectPositive:false) that SHIPPED a positive is the false accusation the harness exists to catch.
  const poisoned = [
    { expectPositive: true, shipped: true, abstained: false },   // a real TP
    { expectPositive: false, shipped: true, abstained: false },  // a FALSE POSITIVE
  ];
  const c = tallyClassification(poisoned);
  assert.equal(c.fp, 1);
  assert.ok(c.precision < 1, 'a false positive must pull precision below 1.0');
});

test('tallyClassification is vacuously precise when nothing ships (no false positive possible)', () => {
  const c = tallyClassification([{ expectPositive: false, shipped: false, abstained: true }]);
  assert.equal(c.precision, 1);
  assert.equal(c.abstainRate, 1);
});
