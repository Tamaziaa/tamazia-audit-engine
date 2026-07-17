'use strict';
// tools/history-regression/check.test.js
//   node --test tools/history-regression/check.test.js
//
// The ledger integrity checker must reject missing/duplicate class ids and see every violation kind
// (CR: Set/Map silently collapse duplicate keys; calibration must assert the exact seeded kind).

const test = require('node:test');
const assert = require('node:assert');

const { validate, selfTest } = require('./check');

const existsLive = (rel) => rel === 'live/gate.js';

test('validate: a duplicate class id is rejected, not silently collapsed', () => {
  const doc = {
    taxonomy: [
      { class: 'a', catching_gate: 'live/gate.js', status: 'guarded' },
      { class: 'a', catching_gate: 'live/gate.js', status: 'guarded' },
    ],
    defects: [],
  };
  const kinds = validate(doc, existsLive).violations.map((v) => v.kind);
  assert.ok(kinds.includes('duplicate-class'));
});

test('validate: a taxonomy row with no class id is rejected', () => {
  const doc = { taxonomy: [{ catching_gate: 'live/gate.js', status: 'guarded' }], defects: [] };
  const kinds = validate(doc, existsLive).violations.map((v) => v.kind);
  assert.ok(kinds.includes('no-class'));
});

test('validate: an absolute/traversal catching_gate never satisfies a guarded class', () => {
  // realGateExists rejects absolute + traversal paths, so a guarded class pointing outside the repo
  // is guarded-gate-missing. Here we simulate with a gateExists that would (wrongly) accept it, and
  // confirm the default realGateExists path is the one that hardens this - covered via check.js
  // itself pointing catching_gate at a traversal is rejected by realGateExists (unit below).
  const { realGateExists } = require('./check');
  assert.strictEqual(realGateExists('../../etc/passwd'), false);
  assert.strictEqual(realGateExists('/etc/passwd'), false);
  assert.strictEqual(realGateExists('tools/history-regression/check.js'), true);
});

test('realGateExists: a DIRECTORY path never counts as a live gate (CR round-4)', () => {
  const { realGateExists } = require('./check');
  // fs.existsSync would be true for these directories; a catching_gate must resolve to a real FILE,
  // so a guarded class pointing at a directory must be caught as missing, not accepted.
  assert.strictEqual(realGateExists('tools'), false);
  assert.strictEqual(realGateExists('tools/history-regression'), false);
  // A non-existent path is also (still) false.
  assert.strictEqual(realGateExists('tools/history-regression/no-such-gate.js'), false);
});

test('selfTest: every seeded violation kind is caught exactly', () => {
  const st = selfTest();
  assert.strictEqual(st.pass, true, st.detail);
});
