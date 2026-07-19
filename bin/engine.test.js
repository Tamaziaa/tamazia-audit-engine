'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main, parseArgs, cmdSign } = require('./engine.js');
const { ManifestStore } = require('../supervised/manifest-store.js');

test('parseArgs handles --flag value, --bool-flag (no value), and positional args', () => {
  const args = parseArgs(['run', '--site', 'https://x.com', '--stub-persist', 'false', '--verbose']);
  assert.deepStrictEqual(args._, ['run']); // main() slices the command off argv before calling parseArgs
  assert.strictEqual(args.site, 'https://x.com');
  assert.strictEqual(args['stub-persist'], 'false');
  assert.strictEqual(args.verbose, true);
  const args2 = parseArgs(['--site', 'https://x.com', '--verbose']);
  assert.strictEqual(args2.site, 'https://x.com');
  assert.strictEqual(args2.verbose, true);
});

test('parseArgs accumulates a REPEATED flag into an array, in order (the --fixture-html multi-page seam)', () => {
  const args = parseArgs(['run', '--fixture-html', 'https://x/=a.html', '--fixture-html', 'https://x/privacy=b.html']);
  assert.deepStrictEqual(args['fixture-html'], ['https://x/=a.html', 'https://x/privacy=b.html']);
  // A flag given only ONCE stays a plain scalar, never a 1-element array (no existing single-occurrence
  // caller - args.site, args['run-id'], etc. - should ever see its value's shape change).
  const single = parseArgs(['run', '--fixture-html', 'https://x/=a.html']);
  assert.strictEqual(single['fixture-html'], 'https://x/=a.html');
});

test('an unknown command returns exit code 2 and does not throw', async () => {
  const code = await main(['nonsense-command']);
  assert.strictEqual(code, 2);
});

test('engine run without --site rejects with a clear error rather than attempting a network call', async () => {
  await assert.rejects(() => main(['run']), /--site <url> is required/);
});

test('engine packet without --run-id rejects with a clear error', async () => {
  await assert.rejects(() => main(['packet']), /--run-id <id> is required/);
});

test('engine sign writes a real signature entry to the manifest store', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-cli-sign-'));
  const decisionsPath = path.join(baseDir, 'decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify({ overall: 'SIGN', findingDecisions: [{ finding_id: 'f1', decision: 'ship', reason_code: 'tp-confirmed' }], signer: 'aman' }));
  const exitCode = cmdSign({ 'run-id': 'cli-run-1', decisions: decisionsPath, 'manifest-dir': baseDir });
  assert.strictEqual(exitCode, 0);
  const store = new ManifestStore({ baseDir });
  const entries = store.entriesOfStage('cli-run-1', 'signature');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].overall, 'SIGN');
});

test('engine sign without --decisions rejects', () => {
  assert.throws(() => cmdSign({ 'run-id': 'x' }), /--decisions <path.json> is required/);
});

test('engine replay without --run-id rejects with a clear error', async () => {
  await assert.rejects(() => main(['replay']), /--run-id <id> is required/);
});

test('engine mint without --site rejects with a clear error', async () => {
  await assert.rejects(() => main(['mint', '--run-id', 'x']), /--site <url> is required/);
});
