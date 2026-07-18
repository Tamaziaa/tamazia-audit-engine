'use strict';
// eval/e2e/run-pipeline.test.js - unit tests for the CLI's own small pieces, PLUS a smoke test that
// executes the REAL entry point (caution.md C-148: "every eval suite includes a smoke test that
// executes the real entry point; tests that assert on source text are not counted as coverage").
//   node --test eval/e2e/run-pipeline.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { main, parseArgs, pipelineOptsFrom, loadFixtureBundle, runOneFirm, runOneSynthetic, exitCodeFor, DEFAULT_BREACH_TIMEOUT_MS } = require('./run-pipeline');

test('parseArgs: defaults point at the real reference-set + this directory\'s own fixtures/red-team paths', () => {
  const { opts } = parseArgs(['node', 'run-pipeline.js']);
  assert.ok(opts.set.endsWith(path.join('reference-set', 'reference-set.json')));
  assert.ok(opts.fixtures.endsWith(path.join('reference-set', 'fixtures')));
  assert.ok(opts.synthetic.endsWith(path.join('e2e', 'fixtures')));
  assert.ok(opts.redteam.endsWith(path.join('red-team', 'fixtures.json')));
  assert.strictEqual(opts.json, false);
});

test('parseArgs: --json, --domain, --no-synthetic, --no-red-team are parsed', () => {
  const { opts } = parseArgs(['node', 'run-pipeline.js', '--json', '--domain', 'example.com', '--no-synthetic', '--no-red-team']);
  assert.strictEqual(opts.json, true);
  assert.strictEqual(opts.domain, 'example.com');
  assert.strictEqual(opts.noSynthetic, true);
  assert.strictEqual(opts.noRedteam, true);
});

test('parseArgs: an unrecognised argument fails closed with exit code 2', () => {
  const r = parseArgs(['node', 'run-pipeline.js', '--not-a-real-flag']);
  assert.strictEqual(r.exitCode, 2);
});

test('loadFixtureBundle: a missing fixture is reported {missing:true}, never a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-'));
  const r = loadFixtureBundle(dir, 'nope.example');
  assert.strictEqual(r.missing, true);
});

test('loadFixtureBundle: an unsafe domain is rejected before touching the filesystem', () => {
  assert.throws(() => loadFixtureBundle('/tmp', '../../etc/passwd'));
});

test('loadFixtureBundle: a present fixture is parsed and returned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-'));
  fs.writeFileSync(path.join(dir, 'example.com.json'), JSON.stringify({ domain: 'example.com', corpus: { pages: [] } }));
  const r = loadFixtureBundle(dir, 'example.com');
  assert.deepStrictEqual(r.bundle, { domain: 'example.com', corpus: { pages: [] } });
});

test('runOneFirm: a firm with no fixture on disk is an ERROR row (an uncovered gap, not an abstention)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-'));
  const row = await runOneFirm({ domain: 'ghost.example', role: 'test', expected: {} }, dir);
  assert.match(row.error, /no fixture on disk/);
});

test('runOneFirm: a real bundle judges cleanly against an expectation with nothing to check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-'));
  fs.writeFileSync(path.join(dir, 'blank.example.json'), JSON.stringify({ domain: 'blank.example', corpus: { pages: [] } }));
  const row = await runOneFirm({ domain: 'blank.example', role: 'test', expected: {} }, dir, { noBreach: true });
  assert.strictEqual(row.error, undefined);
  assert.strictEqual(row.contradiction, false);
});

test('runOneSynthetic: a fixture-load error is passed through as a row error', async () => {
  const row = await runOneSynthetic({ file: 'broken.json', error: 'unreadable JSON: x' }, { noBreach: true });
  assert.strictEqual(row.error, 'unreadable JSON: x');
  assert.strictEqual(row.domain, 'broken.json');
});

test('runOneSynthetic: a well-formed synthetic bundle runs the real pipeline (--no-breach) and judges honestly', async () => {
  const fx = {
    domain: 'synthetic-cli-test.example',
    role: 'synthetic',
    bundle: { domain: 'synthetic-cli-test.example', corpus: { pages: [{ url: 'https://x/', text: 'hello world' }] } },
    expected: { known_breaches: [{ id: 'X', framework: 'X', match_any: ['should-never-appear'] }] },
  };
  const row = await runOneSynthetic(fx, { noBreach: true });
  assert.strictEqual(row.error, undefined);
  assert.strictEqual(row.knownBreaches[0].status, 'skipped', 'with --no-breach the lane did not run, so a known_breach is skipped, never missed or reproduced');
});

test('runOneSynthetic: with the breach lane RUN on an EMPTY catalogue, a known_breach is MISSED (lane complete, found nothing), never fabricated', async () => {
  const fx = {
    domain: 'synthetic-cli-run.example',
    role: 'synthetic',
    bundle: { domain: 'synthetic-cli-run.example', corpus: { pages: [{ url: 'https://x/', text: 'hello world' }] } },
    expected: { known_breaches: [{ id: 'X', framework: 'X', match_any: ['should-never-appear'] }] },
  };
  const row = await runOneSynthetic(fx, { catalogueRecords: [], breachInProcess: true });
  assert.strictEqual(row.error, undefined);
  assert.strictEqual(row.knownBreaches[0].status, 'missed', 'the lane genuinely ran (empty catalogue) and found nothing -> missed, an honest abstention');
});

test('exitCodeFor: an ERROR row outranks everything else (exit 2)', () => {
  assert.strictEqual(exitCodeFor([{ error: 'x' }, { contradiction: true }], { rows: [] }), 2);
});

test('exitCodeFor: a contradiction with no errors is exit 1', () => {
  assert.strictEqual(exitCodeFor([{ contradiction: true }], { rows: [] }), 1);
});

test('exitCodeFor: a red-team escape with no errors or contradictions is exit 1', () => {
  assert.strictEqual(exitCodeFor([{ contradiction: false }], { rows: [{ status: 'escaped' }] }), 1);
});

test('exitCodeFor: a red-team error (pipeline crash on adversarial input) is also exit 1', () => {
  assert.strictEqual(exitCodeFor([{ contradiction: false }], { rows: [{ status: 'error' }] }), 1);
});

test('exitCodeFor: clean rows and a fully-caught red-team lane is exit 0', () => {
  assert.strictEqual(exitCodeFor([{ contradiction: false }], { rows: [{ status: 'caught' }, { status: 'skipped' }] }), 0);
});

test('parseArgs: the new breach flags parse (--no-breach, --breach-inline, --breach-timeout <ms>)', () => {
  const a = parseArgs(['node', 'run-pipeline.js', '--no-breach']).opts;
  assert.strictEqual(a.noBreach, true);
  const b = parseArgs(['node', 'run-pipeline.js', '--breach-inline']).opts;
  assert.strictEqual(b.breachInline, true);
  const c = parseArgs(['node', 'run-pipeline.js', '--breach-timeout', '5000']).opts;
  assert.strictEqual(c.breachTimeoutMs, 5000);
  const d = parseArgs(['node', 'run-pipeline.js']).opts;
  assert.strictEqual(d.breachTimeoutMs, DEFAULT_BREACH_TIMEOUT_MS, 'the default is a Rule-9 hard per-firm breach deadline');
});

test('parseArgs: a negative or non-numeric --breach-timeout fails closed (exit 2)', () => {
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--breach-timeout', '-1']).exitCode, 2);
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--breach-timeout', 'abc']).exitCode, 2);
});

test('pipelineOptsFrom: maps CLI flags to the runPipeline breach opts', () => {
  const opts = { breachTimeoutMs: 9000, breachInline: true, noBreach: false };
  assert.deepStrictEqual(pipelineOptsFrom(opts), { breachTimeoutMs: 9000, breachInProcess: true, noBreach: false });
});

// ---------------------------------------------------------------------------------------------------
// SMOKE TEST: executes the REAL entry point (caution.md C-148) end-to-end against the real, committed
// eval/reference-set/ fixtures + this directory's own synthetic fixture + the real red-team lane, --json
// so the assertions are on structure. Uses --no-breach so the full run stays fast and deterministic (the
// real 92-record catalogue triggers the propose ReDoS P0 in breach/proposers/, owner R3/W2a; the breach
// path itself is smoke-tested separately below with a bounded subprocess timeout). This is the test that
// would have caught a ReferenceError/TDZ crash inside main() that a purely-mocked unit test could not.
// ---------------------------------------------------------------------------------------------------
test('SMOKE: node eval/e2e/run-pipeline.js --no-breach runs end-to-end against the real fixtures + red-team', async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  let code;
  try {
    code = await main(['node', 'eval/e2e/run-pipeline.js', '--no-breach', '--json']);
  } finally {
    console.log = originalLog;
  }
  assert.ok(code === 0 || code === 1, 'expected a graded result (0 clean or 1 contradiction/escape), not a usage/data error: got ' + code);
  assert.strictEqual(lines.length, 1, 'expected exactly one JSON blob on stdout in --json mode');
  const parsed = JSON.parse(lines[0]);
  assert.ok(Array.isArray(parsed.stageWiring) && parsed.stageWiring.length === 5);
  const wiring = Object.fromEntries(parsed.stageWiring.map((w) => [w.stage, w.status]));
  assert.strictEqual(wiring.propose, 'wired', 'propose (W2a) must be wired');
  assert.strictEqual(wiring.adjudicate, 'wired', 'adjudicate (W2c) must be wired');
  assert.ok(Array.isArray(parsed.rows) && parsed.rows.length >= 27, 'expected the full reference set plus synthetic additions');
  assert.ok(parsed.rows.some((r) => r.domain === 'example-synthetic-breach.test'), 'the synthetic fixture should have run alongside the reference-set firms');
  assert.strictEqual(typeof parsed.redteam.present, 'boolean');
  assert.strictEqual(parsed.summary.errored, 0, 'no firm should ERROR on the real, committed fixtures');
  assert.strictEqual(parsed.summary.contradicting, 0, 'the P3 exit bar: zero false accusations (zero contradictions)');
  assert.strictEqual(parsed.summary.redTeamEscapes, 0, 'the P3 exit bar: every red-team entry caught (zero escapes)');
  // --no-breach -> every firm's breach lane is skipped, never fabricated as complete.
  assert.strictEqual(parsed.summary.breach.complete, 0);
  assert.strictEqual(parsed.summary.breach.errored, 0);
});

test('SMOKE: node eval/e2e/run-pipeline.js --domain <one firm> --no-breach restricts the run and still executes cleanly', async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  let code;
  try {
    code = await main(['node', 'eval/e2e/run-pipeline.js', '--domain', 'neuclinic.co.uk', '--no-synthetic', '--no-red-team', '--no-breach', '--json']);
  } finally {
    console.log = originalLog;
  }
  assert.ok(code === 0 || code === 1);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].domain, 'neuclinic.co.uk');
});

// SMOKE: the REAL breach lane via the subprocess Rule-9 guard. neuclinic triggers the propose ReDoS, so
// the breach lane is expected to TIME OUT and be recorded as an honest breach error - the firm still
// judges as OK (no contradiction) and the harness completes, never hangs. A short timeout keeps it fast.
test('SMOKE: the real breach lane via the subprocess guard completes (times out honestly) and never hangs', async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  let code;
  try {
    code = await main(['node', 'eval/e2e/run-pipeline.js', '--domain', 'neuclinic.co.uk', '--no-synthetic', '--no-red-team', '--breach-timeout', '4000', '--json']);
  } finally {
    console.log = originalLog;
  }
  assert.ok(code === 0 || code === 1, 'the harness must COMPLETE (never hang) even when propose hangs; got ' + code);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].contradiction, false, 'a breach-lane timeout is never a false accusation');
  const breachStages = ['propose', 'verify', 'adjudicate'].map((s) => (parsed.rows[0].stageTable.find((x) => x.stage === s) || {}).status);
  // Either the lane errored (timed out - the current ReDoS) or, once propose is fixed, completed. Both honest.
  assert.ok(breachStages.every((s) => s === 'error') || breachStages.every((s) => s === 'ran'),
    'the breach lane is uniformly errored (timeout) or uniformly ran, never a fabricated partial pass: ' + JSON.stringify(breachStages));
});

test('SMOKE: an actual child-process invocation of the file exits with a stable code (proves the file itself is directly runnable, not only its exported main)', async () => {
  const { execFileSync } = require('child_process');
  const repoRoot = path.join(__dirname, '..', '..');
  let status = 0;
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'run-pipeline.js'), '--domain', 'neuclinic.co.uk', '--no-synthetic', '--no-red-team', '--no-breach', '--json'], { cwd: repoRoot, stdio: 'pipe' });
  } catch (e) {
    status = e.status;
  }
  assert.ok(status === 0 || status === 1, 'expected a graded exit code from the real child process, got ' + status);
});
