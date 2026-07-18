'use strict';
// eval/e2e/lib/breach-stages.test.js
//   node --test eval/e2e/lib/breach-stages.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  loadOptionalModule,
  loadProposeStage,
  loadVerifyStage,
  loadAdjudicateStage,
  STAGE_CONTRACT,
} = require('./breach-stages');

const FAKE_MODULES_DIR = path.join(__dirname, '..', 'fixtures', 'fake-modules');

test('loadOptionalModule: a path that does not exist is reported unavailable, never throws', () => {
  const r = loadOptionalModule(FAKE_MODULES_DIR, 'nope-not-here.js', 'propose');
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /not landed yet/);
});

test('loadOptionalModule: a present module exporting the expected function is available and callable', () => {
  const r = loadOptionalModule(FAKE_MODULES_DIR, 'good-stage.js', 'propose');
  assert.strictEqual(r.available, true);
  assert.strictEqual(typeof r.run, 'function');
  assert.strictEqual(r.source, 'good-stage.js');
  assert.deepStrictEqual(r.run(), []);
});

test('loadOptionalModule: a present module missing the expected export is unavailable, not a crash', () => {
  const r = loadOptionalModule(FAKE_MODULES_DIR, 'bad-export.js', 'propose');
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /exports no propose\(\)/);
});

test('loadOptionalModule: a module that throws at require() time is reported unavailable with its message', () => {
  const r = loadOptionalModule(FAKE_MODULES_DIR, 'throws-on-require.js', 'propose');
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /failed to load/);
  assert.match(r.reason, /synthetic require-time failure/);
});

test('loadOptionalModule: different export names are checked independently on the same module', () => {
  const verifyAll = loadOptionalModule(FAKE_MODULES_DIR, 'good-stage.js', 'verifyAll');
  const missing = loadOptionalModule(FAKE_MODULES_DIR, 'good-stage.js', 'notAFunctionHere');
  assert.strictEqual(verifyAll.available, true);
  assert.strictEqual(missing.available, false);
});

test('STAGE_CONTRACT: names one canonical path and export per stage', () => {
  for (const stage of ['propose', 'verify', 'adjudicate']) {
    assert.ok(STAGE_CONTRACT[stage].relPath, stage + ' must declare a relPath');
    assert.ok(STAGE_CONTRACT[stage].exportName, stage + ' must declare an exportName');
  }
});

test('loadVerifyStage: against the real repo tree, breach/verifiers/index.js is wired (verifyAll landed)', () => {
  const r = loadVerifyStage();
  assert.strictEqual(r.available, true, 'expected breach/verifiers/index.js to export verifyAll - ' + (r.reason || ''));
  assert.strictEqual(typeof r.run, 'function');
});

test('loadVerifyStage: verifyAll runs cleanly on an empty candidate list', () => {
  const r = loadVerifyStage();
  const out = r.run([], { corpus: { pages: [] } });
  assert.deepStrictEqual(out, { verified: [], rejected: [] });
});

// propose (W2a) and adjudicate (W2c) have BOTH landed and are wired for real per Rob's ledger decision
// 6. STAGE_CONTRACT points at breach/proposers/propose.js and breach/adjudicator/adjudicate.js directly.
test('loadProposeStage: breach/proposers/propose.js exports propose() and is wired', () => {
  const r = loadProposeStage();
  assert.strictEqual(r.available, true, 'expected breach/proposers/propose.js to export propose - ' + (r.reason || ''));
  assert.strictEqual(typeof r.run, 'function');
  assert.strictEqual(r.source, 'breach/proposers/propose.js');
});

test('loadAdjudicateStage: breach/adjudicator/adjudicate.js exports adjudicate() and is wired (no index.js barrel)', () => {
  const r = loadAdjudicateStage();
  assert.strictEqual(r.available, true, 'expected breach/adjudicator/adjudicate.js to export adjudicate - ' + (r.reason || ''));
  assert.strictEqual(typeof r.run, 'function');
  assert.strictEqual(r.source, 'breach/adjudicator/adjudicate.js');
});

test('STAGE_CONTRACT: adjudicate points at adjudicate.js DIRECTLY, never an index.js barrel (ledger decision 6)', () => {
  assert.strictEqual(STAGE_CONTRACT.adjudicate.relPath, 'breach/adjudicator/adjudicate.js');
  assert.strictEqual(STAGE_CONTRACT.propose.relPath, 'breach/proposers/propose.js');
});
