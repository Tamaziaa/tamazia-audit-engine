'use strict';
// tools/sweep/collect-workflows.test.js - the workflow-parser lane must fail closed.
//   node --test tools/sweep/collect-workflows.test.js
//
// Calibration (caution.md C-202): a missing .github/workflows directory or an empty workflow set is
// not "nothing to check" - it is the exact protected class (deleting workflows makes required checks
// vanish from GitHub rather than fail). Both must fail closed. The parser self-test must also refuse
// to earn a zero when python3/PyYAML never ran.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverWorkflowFiles, selfTest } = require('./collect-workflows');

test('discoverWorkflowFiles: a missing directory fails closed', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  const r = discoverWorkflowFiles(path.join(base, 'no-such-dir'));
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /missing/);
});

test('discoverWorkflowFiles: an empty workflow directory fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-empty-'));
  const r = discoverWorkflowFiles(dir);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /0 workflow files/);
});

test('discoverWorkflowFiles: a directory with a workflow file is ok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ok-'));
  fs.writeFileSync(path.join(dir, 'ci.yml'), 'name: ci\non: push\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  const r = discoverWorkflowFiles(dir);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.files, ['ci.yml']);
});

test('selfTest: rejects seeded broken YAML when a parser is present, else refuses to earn a zero', () => {
  const st = selfTest();
  // Either the parser ran and correctly rejected the broken YAML (pass), or python3/PyYAML is
  // unavailable and the self-test fails closed. It must NEVER pass by treating an absent parser as a
  // rejection.
  if (st.pass) {
    assert.match(st.detail, /correctly rejected/);
  } else {
    assert.match(st.detail, /unavailable|ACCEPTED/);
  }
});
