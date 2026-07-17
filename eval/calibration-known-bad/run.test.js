'use strict';
// eval/calibration-known-bad/run.test.js - the earn-your-zero runner must not let a broken checker
// self-test (exit 2) be masked by parsed findings.
//   node --test eval/calibration-known-bad/run.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runExternalChecker } = require('./run');

// Write a throwaway checker script that mimics one --calibrate dialect and returns a chosen exit code.
function writeChecker(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-checker-'));
  const p = path.join(dir, 'checker.js');
  fs.writeFileSync(p, body);
  return p;
}

test('runExternalChecker: exit 2 (broken self-test) throws even when findings were written', () => {
  // The checker writes a NON-EMPTY findings file and THEN exits 2 (self-test failed). The findings
  // must never mask the broken self-test.
  const checker = writeChecker([
    'const fs = require("fs");',
    'const i = process.argv.indexOf("--json");',
    'fs.writeFileSync(process.argv[i + 1], JSON.stringify([{ file: "x", rule: "r", message: "m" }]));',
    'process.exit(2);',
  ].join('\n'));
  assert.throws(() => runExternalChecker(checker), /self-test FAILED \(exit 2\)/);
});

test('runExternalChecker: exit 1 (zero findings) is judged by the runner, not thrown', () => {
  const checker = writeChecker([
    'const fs = require("fs");',
    'const i = process.argv.indexOf("--json");',
    'fs.writeFileSync(process.argv[i + 1], JSON.stringify([]));',
    'process.exit(1);',
  ].join('\n'));
  const findings = runExternalChecker(checker);
  assert.deepStrictEqual(findings, []);
});

test('runExternalChecker: exit 0 with findings returns them', () => {
  const checker = writeChecker([
    'const fs = require("fs");',
    'const i = process.argv.indexOf("--json");',
    'fs.writeFileSync(process.argv[i + 1], JSON.stringify([{ file: "fixture.js", rule: "r", message: "m" }]));',
    'process.exit(0);',
  ].join('\n'));
  const findings = runExternalChecker(checker);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'fixture.js');
});

test('runExternalChecker: an undocumented exit code (3) throws', () => {
  const checker = writeChecker('process.exit(3);');
  assert.throws(() => runExternalChecker(checker), /undocumented --calibrate status 3/);
});
