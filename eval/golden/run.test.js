'use strict';
// eval/golden/run.test.js - the golden harness must fail closed.
//   node --test eval/golden/run.test.js
//
// Calibration: the P0-era "empty goldens => WARNING, exit 0" behaviour is over. An empty goldens set
// is a broken gate (Constitution Rule 4), an unpinned fresh cell is unreviewed truth, and both are
// exit-1 failures. --accept remains the only path that may proceed with an empty goldens set.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('./run');
const safePath = require('../../tools/lib/safe-path');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'golden-test-'));
}

function writePayload(dir, cell, obj) {
  fs.mkdirSync(dir, { recursive: true });
  // cell is always a literal test-supplied name ('uk-legal', 'us-legal', ...) at every call site
  // below: a door-routed join makes that a checked PATH COMPONENT rather than an inline path.join.
  fs.writeFileSync(safePath.safeJoin(dir, [`${cell}.payload.json`], { label: 'golden test fixture' }), `${JSON.stringify(obj, null, 2)}\n`);
}

function runMain(goldens, fresh, extra) {
  const argv = ['node', 'run.js', '--goldens', goldens, '--fresh', fresh, ...(extra || [])];
  return main(argv);
}

test('golden: empty goldens directory fails closed (exit 1), never a confident zero', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  // both dirs empty
  assert.strictEqual(runMain(goldens, fresh), 1);
});

test('golden: missing goldens directory fails closed (exit 1)', () => {
  const base = tmpDir();
  const goldens = path.join(base, 'does-not-exist');
  const fresh = tmpDir();
  assert.strictEqual(runMain(goldens, fresh), 1);
});

test('golden: a fresh cell with no pinned golden fails until accepted', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  writePayload(goldens, 'uk-legal', { a: 1 });
  writePayload(fresh, 'uk-legal', { a: 1 });
  // an extra fresh cell that was never pinned
  writePayload(fresh, 'us-legal', { a: 1 });
  assert.strictEqual(runMain(goldens, fresh), 1);
});

test('golden: identical goldens and fresh with matching filename sets pass (exit 0)', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  writePayload(goldens, 'uk-legal', { a: 1, b: [1, 2] });
  writePayload(fresh, 'uk-legal', { a: 1, b: [1, 2] });
  assert.strictEqual(runMain(goldens, fresh), 0);
});

test('golden: a divergent fresh cell fails (exit 1)', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  writePayload(goldens, 'uk-legal', { a: 1 });
  writePayload(fresh, 'uk-legal', { a: 2 });
  assert.strictEqual(runMain(goldens, fresh), 1);
});

test('golden: a pinned golden with no fresh counterpart is a coverage regression (exit 1)', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  writePayload(goldens, 'uk-legal', { a: 1 });
  // no fresh output at all
  assert.strictEqual(runMain(goldens, fresh), 1);
});

test('golden: --accept bootstraps the first goldens from fresh (exit 0) and then they compare clean', () => {
  const goldens = tmpDir();
  const fresh = tmpDir();
  writePayload(fresh, 'uk-legal', { a: 1 });
  // empty goldens + --accept is the only allowed empty-goldens path
  assert.strictEqual(runMain(goldens, fresh, ['--accept']), 0);
  assert.ok(fs.existsSync(path.join(goldens, 'uk-legal.payload.json')));
  // now a plain run compares clean
  assert.strictEqual(runMain(goldens, fresh), 0);
});
