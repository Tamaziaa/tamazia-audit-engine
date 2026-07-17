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

test('loadVerifyStage: verifyAll runs cleanly on an empty candidate list (propose is not landed yet)', () => {
  const r = loadVerifyStage();
  const out = r.run([], { corpus: { pages: [] } });
  assert.deepStrictEqual(out, { verified: [], rejected: [] });
});

// propose/adjudicate against the REAL repo tree are polled truthfully rather than hard-pinned: Wave 2
// lands in parallel with this harness (docs/P3-ACCEPTANCE.md), so asserting today's exact state would
// make this test brittle to a landing that is GOOD news. Instead we assert the loader always returns a
// well-formed, honest {available, reason|source} shape either way - the actual availability is
// reported by run-pipeline.js's stage-wiring line, not hard-asserted here.
test('loadProposeStage / loadAdjudicateStage: always return a well-formed {available, ...} shape against the real tree', () => {
  const propose = loadProposeStage();
  const adjudicate = loadAdjudicateStage();
  for (const r of [propose, adjudicate]) {
    assert.strictEqual(typeof r.available, 'boolean');
    if (r.available) assert.strictEqual(typeof r.run, 'function');
    else assert.strictEqual(typeof r.reason, 'string');
  }
});
