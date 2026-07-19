'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ManifestStore } = require('./manifest-store.js');
const { recordSignature, latestSignature, shippedFindingIds } = require('./signature-store.js');

function store() {
  return new ManifestStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-sig-')) });
}

test('recordSignature appends a signature entry and latestSignature reads it back', () => {
  const s = store();
  recordSignature(s, 'run-1', { signer: 'aman', overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'ship', reason_code: 'tp-confirmed' }] });
  const latest = latestSignature(s, 'run-1');
  assert.strictEqual(latest.overall, 'SIGN');
  assert.strictEqual(latest.signer, 'aman');
});

test('a HOLD signature is recorded and readable, and shippedFindingIds is empty for it', () => {
  const s = store();
  recordSignature(s, 'run-2', { overall: 'HOLD', findingDecisions: [] });
  const latest = latestSignature(s, 'run-2');
  assert.strictEqual(latest.overall, 'HOLD');
  assert.strictEqual(shippedFindingIds(latest).size, 0);
});

test('a re-sign overwrites which decision is "latest" (append-only history, but latestSignature reads the LAST one)', () => {
  const s = store();
  recordSignature(s, 'run-3', { overall: 'HOLD', findingDecisions: [] });
  recordSignature(s, 'run-3', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'ship' }] });
  assert.strictEqual(latestSignature(s, 'run-3').overall, 'SIGN');
  assert.strictEqual(s.entriesOfStage('run-3', 'signature').length, 2); // both are still in history
});

test('shippedFindingIds only includes decision:"ship" entries, never "drop"', () => {
  const s = store();
  recordSignature(s, 'run-4', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'ship' }, { finding_id: 'f2', decision: 'drop' }] });
  const ids = shippedFindingIds(latestSignature(s, 'run-4'));
  assert.ok(ids.has('f1'));
  assert.ok(!ids.has('f2'));
});

test('invalid overall value throws rather than silently recording a bad state', () => {
  const s = store();
  assert.throws(() => recordSignature(s, 'run-5', { overall: 'MAYBE', findingDecisions: [] }));
});

test('a finding decision missing "decision" or an invalid decision value throws', () => {
  const s = store();
  assert.throws(() => recordSignature(s, 'run-6', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1' }] }));
  assert.throws(() => recordSignature(s, 'run-6', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'maybe' }] }));
});

// CodeRabbit review (PR #36): shippedFindingIds() reads a Set, so it cannot tell "decided twice, both
// ship" from "decided twice, drop-then-ship" apart from "decided twice, ship-then-drop" - a duplicate
// finding_id within ONE findingDecisions array is ambiguous no matter which two decisions it pairs, and
// must be rejected at the write boundary rather than silently resolved by Set semantics.
test('KNOWN-BAD CALIBRATION FIXTURE: a duplicate finding_id within one findingDecisions array is rejected, even a genuine ship+ship repeat', () => {
  const s = store();
  assert.throws(
    () => recordSignature(s, 'run-7', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'drop' }, { finding_id: 'f1', decision: 'ship' }] }),
    /duplicate decision for finding f1/,
  );
  assert.throws(
    () => recordSignature(s, 'run-7', { overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'ship' }, { finding_id: 'f1', decision: 'ship' }] }),
    /duplicate decision for finding f1/,
  );
  // Nothing was ever recorded for this run_id - the rejected call must not have partially appended.
  assert.strictEqual(latestSignature(s, 'run-7'), null);
});

test('latestSignature returns null when no signature was ever recorded', () => {
  const s = store();
  assert.strictEqual(latestSignature(s, 'never-signed'), null);
});
