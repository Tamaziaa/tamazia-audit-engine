'use strict';
// budget-caps.test.js - the budget-floor / oversize-deadline gate (Constitution Rule 8 / Rule 9).
// Exercised here as a node:test module (not only via --calibrate) so npm test proves it still sees the
// seeded p3-crawl-floor fixture and clears legitimate caps.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('./budget-caps.js');

const FLOOR_FIXTURE = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures', 'p3-crawl-floor.js');

test('self-test is earned: the gate demonstrably sees floors and clears caps (acorn engine)', () => {
  const r = gate.selfTest();
  assert.equal(r.pass, true, r.detail);
});

test('scanContent catches every seeded floor/oversize in p3-crawl-floor.js', () => {
  const src = fs.readFileSync(FLOOR_FIXTURE, 'utf8');
  const kinds = gate.scanContent('p3-crawl-floor.js', src).violations.map((v) => v.kind);
  assert.ok(kinds.filter((k) => k === 'budget-floor').length >= 2, 'both Math.max floors are caught');
  assert.ok(kinds.includes('oversize-deadline'), 'the >120s setTimeout literal is caught');
});

test('a Math.max FLOOR on a budget-named binding is flagged; a Math.min CAP is not', () => {
  assert.equal(gate.scanContent('t.js', 'const timeoutMs = Math.max(5000, x);').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'const width = Math.min(12, concurrency);').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'const n = Math.max(0, count);').violations.length, 0, 'Math.max not bound to a budget is spared');
});

test('a Math.max floor detected via a referenced budget identifier (E-236 shape)', () => {
  const v = gate.scanContent('t.js', 'f(a, Math.max(20000, Math.floor(deadlineMs * 0.6)), b);').violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, 'budget-floor');
});

test('an oversize setTimeout/AbortSignal deadline is flagged; an in-budget one is not', () => {
  assert.equal(gate.scanContent('t.js', 'setTimeout(fn, 200000);').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'setTimeout(fn, 5000);').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'AbortSignal.timeout(12000);').violations.length, 0);
});

test('a non-time numeric ceiling (a char cap) is not mistaken for a time budget', () => {
  assert.equal(gate.scanContent('t.js', 'const CORPUS_MAX_CHARS = 500000;').violations.length, 0);
});

test('the real evidence crawler source is floor-free (pool.js deadline is a cap)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'evidence', 'crawler', 'pool.js'), 'utf8');
  assert.equal(gate.scanContent('evidence/crawler/pool.js', src).violations.length, 0);
});

test('isBudgetName recognises the *Ms / *_MS millisecond-budget suffix but not ordinary words ending in "ms"', () => {
  // the suffix spellings the word list misses (the confident-zero C-203 class):
  for (const n of ['DEFAULT_CLOSE_MS', 'DEFAULT_SETTLE_MS', 'closeMs', 'settleMs', 'linkMs', 'deadlineMs']) {
    assert.equal(gate.isBudgetName(n), true, n + ' is a ms budget');
  }
  // case-sensitive: ordinary words ending in lowercase "ms" must NOT be swept in:
  for (const n of ['forms', 'terms', 'items', 'params', 'maxItems', 'systems']) {
    assert.equal(gate.isBudgetName(n), false, n + ' is not a budget');
  }
});

test('an oversize *_MS / *Ms budget is flagged even though it carries no budget WORD (the fixed confident-zero)', () => {
  assert.equal(gate.scanContent('t.js', 'const DEFAULT_CLOSE_MS = 200000;').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'const closeMs = Math.max(3000, x);').violations.length, 1, 'a Math.max floor on a *Ms binding is a floor');
  // control: an ordinary word ending in "ms" with a large literal is NOT a time budget:
  assert.equal(gate.scanContent('t.js', 'const forms = 200000;').violations.length, 0);
});
