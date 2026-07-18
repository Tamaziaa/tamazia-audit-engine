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

const {
  main, parseArgs, pipelineOptsFrom, loadFixtureBundle, runOneFirm, runOneSynthetic, exitCodeFor,
  DEFAULT_BREACH_TIMEOUT_MS, vacuityCheck, knownBreachTotals, breachLaneCompleteFor, llmReplayDirFrom,
} = require('./run-pipeline');
const { replayLlmCall, adjudicateBriefKey, entailmentRequestKey, CONTRACT } = require('./lib/replay-llm.js');

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

// =====================================================================================================
// The C-236 vacuity clause (docs/P3-TAIL-ACCEPTANCE.md U2 deliverable 1 + 4). Hand-built rows only
// (C-211): none of these need a real pipeline run, so they exercise exitCodeFor()/vacuityCheck()'s own
// logic directly and fast. The runPipeline()-driven integration proof (a REAL reproduced result through
// the real adjudicator) follows further down, alongside the --llm replay: wiring tests.
// =====================================================================================================

function rowWithBreachLane(stageStatuses, knownBreaches) {
  return {
    contradiction: false,
    knownBreaches,
    stageTable: [
      { stage: 'fixtureBundle', status: 'ran' }, { stage: 'facts', status: 'ran' }, { stage: 'coverage', status: 'ran' },
      { stage: 'propose', status: stageStatuses[0] }, { stage: 'verify', status: stageStatuses[1] }, { stage: 'adjudicate', status: stageStatuses[2] },
    ],
  };
}

test('breachLaneCompleteFor: true only when propose, verify AND adjudicate all show status "ran"', () => {
  assert.strictEqual(breachLaneCompleteFor(rowWithBreachLane(['ran', 'ran', 'ran'], [])), true);
  assert.strictEqual(breachLaneCompleteFor(rowWithBreachLane(['ran', 'ran', 'error'], [])), false);
  assert.strictEqual(breachLaneCompleteFor(rowWithBreachLane(['skipped', 'skipped', 'skipped'], [])), false);
  assert.strictEqual(breachLaneCompleteFor({}), false, 'a row with no stageTable at all is never complete (fails closed)');
  assert.strictEqual(breachLaneCompleteFor({ error: 'no fixture on disk' }), false, 'an ERROR row is never complete');
});

test('vacuityCheck (a): all-missed complete lanes -> vacuous fires', () => {
  const rows = [
    rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X1', framework: 'X', status: 'missed' }]),
    rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X2', framework: 'X', status: 'missed' }]),
  ];
  const v = vacuityCheck(rows);
  assert.strictEqual(v.vacuous, true);
  assert.strictEqual(v.completeLanes, 2);
  assert.strictEqual(v.reproduced, 0);
});

test('vacuityCheck (b): one reproduced among complete+declaring lanes -> vacuous does NOT fire', () => {
  const rows = [
    rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X1', framework: 'X', status: 'missed' }]),
    rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X2', framework: 'X', status: 'reproduced' }]),
  ];
  const v = vacuityCheck(rows);
  assert.strictEqual(v.vacuous, false);
  assert.strictEqual(v.completeLanes, 2);
  assert.strictEqual(v.reproduced, 1);
});

test('vacuityCheck (c): every lane timed out (none complete) -> vacuous does NOT fire, but the population is honestly reported as zero', () => {
  const rows = [
    rowWithBreachLane(['error', 'error', 'error'], [{ id: 'X1', framework: 'X', status: 'skipped' }]),
    rowWithBreachLane(['error', 'error', 'error'], [{ id: 'X2', framework: 'X', status: 'skipped' }]),
  ];
  const v = vacuityCheck(rows);
  assert.strictEqual(v.vacuous, false, 'an empty eligible population must not trigger the clause (the identical vacuous-truth fallacy one level removed)');
  assert.strictEqual(v.completeLanes, 0);
  assert.strictEqual(v.reproduced, 0);
});

test('vacuityCheck: a firm declaring NO known_breaches never counts towards the eligible population', () => {
  const rows = [rowWithBreachLane(['ran', 'ran', 'ran'], [])];
  const v = vacuityCheck(rows);
  assert.strictEqual(v.completeLanes, 0);
  assert.strictEqual(v.vacuous, false);
});

test('vacuityCheck: --no-breach style all-skipped run (no completed lanes at all) does not fire', () => {
  const rows = [rowWithBreachLane(['skipped', 'skipped', 'skipped'], [{ id: 'X', framework: 'X', status: 'skipped' }])];
  const v = vacuityCheck(rows);
  assert.strictEqual(v.vacuous, false);
  assert.strictEqual(v.completeLanes, 0);
});

test('knownBreachTotals: counts reproduced/total across every row regardless of lane completeness', () => {
  const rows = [
    rowWithBreachLane(['ran', 'ran', 'ran'], [{ status: 'reproduced' }, { status: 'missed' }]),
    rowWithBreachLane(['error', 'error', 'error'], [{ status: 'skipped' }]),
    { contradiction: false }, // no knownBreaches at all
  ];
  assert.deepStrictEqual(knownBreachTotals(rows), { reproduced: 1, total: 3 });
});

test('knownBreachTotals: an all-empty run reports 0/0', () => {
  assert.deepStrictEqual(knownBreachTotals([]), { reproduced: 0, total: 0 });
});

test('exitCodeFor (a): all-missed complete lanes -> exit 1 via the vacuity clause (no contradiction, no red-team escape needed)', () => {
  const rows = [rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X', framework: 'X', status: 'missed' }])];
  assert.strictEqual(exitCodeFor(rows, { rows: [] }), 1);
});

test('exitCodeFor (b): one reproduced -> exit 0', () => {
  const rows = [rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X', framework: 'X', status: 'reproduced' }])];
  assert.strictEqual(exitCodeFor(rows, { rows: [] }), 0);
});

test('exitCodeFor (c): all lanes timed out -> exit 0 (vacuity does not fire; no other failure present)', () => {
  const rows = [rowWithBreachLane(['error', 'error', 'error'], [{ id: 'X', framework: 'X', status: 'skipped' }])];
  assert.strictEqual(exitCodeFor(rows, { rows: [] }), 0);
});

test('exitCodeFor: an ERROR row still outranks vacuity (exit 2, not 1)', () => {
  const rows = [{ error: 'no fixture on disk' }, rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X', framework: 'X', status: 'missed' }])];
  assert.strictEqual(exitCodeFor(rows, { rows: [] }), 2);
});

test('exitCodeFor: a contradiction still fires even when the vacuity clause would not (reproduced exists)', () => {
  const rows = [
    Object.assign(rowWithBreachLane(['ran', 'ran', 'ran'], [{ id: 'X', framework: 'X', status: 'reproduced' }]), { contradiction: true }),
  ];
  assert.strictEqual(exitCodeFor(rows, { rows: [] }), 1);
});

// =====================================================================================================
// --llm replay:<dir> flag parsing + wiring (docs/P3-TAIL-ACCEPTANCE.md U2 deliverable 2/3/4e).
// =====================================================================================================

test('parseArgs: --llm replay:<dir> is parsed into opts.llmReplayDir', () => {
  const { opts } = parseArgs(['node', 'run-pipeline.js', '--llm', 'replay:eval/e2e/fixtures/recorded']);
  assert.strictEqual(opts.llmReplayDir, 'eval/e2e/fixtures/recorded');
});

test('parseArgs: no --llm given at all leaves llmReplayDir null (the scripted default, unchanged)', () => {
  const { opts } = parseArgs(['node', 'run-pipeline.js']);
  assert.strictEqual(opts.llmReplayDir, null);
});

test('parseArgs: an unrecognised --llm value fails closed (exit code 2), never silently treated as scripted', () => {
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--llm', 'bogus']).exitCode, 2);
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--llm', 'scripted']).exitCode, 2);
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--llm', 'replay:']).exitCode, 2, 'replay: with an empty directory suffix is a usage error');
});

test('llmReplayDirFrom: unit behaviour matches parseArgs\' use of it exactly', () => {
  assert.deepStrictEqual(llmReplayDirFrom(null), { dir: null });
  assert.deepStrictEqual(llmReplayDirFrom('replay:some/dir'), { dir: 'some/dir' });
  assert.strictEqual(llmReplayDirFrom('replay:').error, true);
  assert.strictEqual(llmReplayDirFrom('not-replay-at-all').error, true);
});

test('pipelineOptsFrom: --llm replay:<dir> attaches a working llmCall function; no --llm leaves it absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-llm-'));
  const withReplay = pipelineOptsFrom({ breachTimeoutMs: 5000, breachInline: false, noBreach: false, llmReplayDir: dir });
  assert.strictEqual(typeof withReplay.llmCall, 'function');
  const withoutReplay = pipelineOptsFrom({ breachTimeoutMs: 5000, breachInline: false, noBreach: false, llmReplayDir: null });
  assert.strictEqual('llmCall' in withoutReplay, false, 'no --llm flag -> no llmCall key at all, so runPipeline falls back to its own scripted default unchanged');
});

test('pipelineOptsFrom: the attached replay llmCall declines when the directory has no matching recording (fail-closed)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-llm-empty-'));
  const built = pipelineOptsFrom({ breachTimeoutMs: 5000, breachInline: false, noBreach: false, llmReplayDir: dir });
  const res = await built.llmCall({ prompt: 'CANDIDATES:\n[{"id":0,"law":"x","evidence":"y","page":"z"}]\n\nReturn STRICT JSON only:\n{}' });
  assert.strictEqual(res.ok, false);
});

// =====================================================================================================
// U2-B1 at the CLI level: a hand-built candidate injected via proposeLoaded (runOneSynthetic's own
// pipelineOpts pass straight through to eval/e2e/lib/pipeline.js's runPipeline(), which already exposes
// this exact injection point for tests - see pipeline.test.js's own precedent), approved by a hand-built
// recording under a temp dir THIS test writes, replayed via replayLlmCall - the same function
// pipelineOptsFrom() builds for --llm replay:<dir>. Proves "a replay run reproduces >= 1 and exits 0"
// through run-pipeline.js's OWN exported runOneSynthetic + exitCodeFor, complementing
// eval/e2e/lib/replay-llm.test.js's own direct proof against the bare adjudicator.
// =====================================================================================================

function replayHermeticFixture() {
  const bundle = {
    domain: 'cli-replay-hermetic.test',
    corpus: {
      pages: [{
        url: 'https://cli-replay-hermetic.test/claims',
        text: 'CliReplayCo helps clients with disputes. We guarantee you will win every case, no exceptions, or your money back.',
      }],
      footerText: 'CliReplayCo Ltd. Company number 00000002.',
    },
    registers: {},
  };
  const candidate = {
    record_id: 'CLI-REPLAY-TEST-RULE', duty_idx: 0, evidence_type: 'absence', kind: 'presence-breach',
    artifact: { type: 'quote', text: 'We guarantee you will win every case, no exceptions', surface: 'visible_text', page_url: 'https://cli-replay-hermetic.test/claims' },
    page_url: 'https://cli-replay-hermetic.test/claims', confidence_hint: 'strong', suppressed_reason: null,
    description: 'Guarantee-of-outcome claim (synthetic test obligation, harness self-test only, not a real law).',
    framework: 'synthetic cli-replay-llm test framework (harness self-test only)',
    evidence_quote: 'We guarantee you will win every case, no exceptions',
    evidence_url: 'https://cli-replay-hermetic.test/claims',
  };
  const expected = { known_breaches: [{ id: 'CLI-REPLAY-1', framework: candidate.framework, match_any: ['guarantee you will win every case'] }] };
  return { bundle, candidate, expected };
}

function writeReplayRecording(dir, filename, responses) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify({
    contract: CONTRACT, engine: { providers: ['hermetic-test'], recorded_at: '2026-07-18T00:00:00Z', prompt_versions: {} }, responses,
  }));
}

test('U2-B1 (CLI level): a hand-built recording approving the synthetic breach lets a replay run reproduce >= 1 and exit 0', async () => {
  const { bundle, candidate, expected } = replayHermeticFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-replay-hit-'));
  const brief = {
    law: candidate.framework,
    evidence: 'VERBATIM FROM THE SITE: "' + candidate.evidence_quote + '"',
    page: candidate.evidence_url,
  };
  writeReplayRecording(dir, 'cli-replay-hermetic.test.json', [
    { key: adjudicateBriefKey(brief), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'guarantees an outcome', disproof: null }) },
    {
      key: entailmentRequestKey({ allowedSourceIds: [candidate.evidence_url], sources: { [candidate.evidence_url]: candidate.evidence_quote } }),
      kind: 'entailment',
      raw: JSON.stringify({ source_id: candidate.evidence_url, verdict: 'entailment', rationale: 'the quote asserts a guaranteed outcome' }),
    },
  ]);

  const pipelineOpts = { proposeLoaded: { available: true, run: () => [candidate] }, llmCall: replayLlmCall(dir) };
  const row = await runOneSynthetic({ domain: bundle.domain, role: 'synthetic', bundle, expected }, pipelineOpts);

  assert.strictEqual(row.error, undefined);
  assert.strictEqual(row.contradiction, false);
  assert.strictEqual(row.knownBreaches[0].status, 'reproduced');

  const code = exitCodeFor([row], { rows: [] });
  assert.strictEqual(code, 0, 'a reproduced known_breach must not trip the vacuity clause');
  const v = vacuityCheck([row]);
  assert.strictEqual(v.reproduced, 1);
  assert.strictEqual(v.vacuous, false);
});

test('U2-B1 (miss direction, CLI level): the SAME hermetic setup with an EMPTY replay directory misses (lane complete, nothing recorded) and trips the vacuity clause -> exit 1', async () => {
  const { bundle, candidate, expected } = replayHermeticFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cli-replay-miss-'));
  // dir is left empty: no recordings at all -> every candidate abstains (fail-closed decline).

  const pipelineOpts = { proposeLoaded: { available: true, run: () => [candidate] }, llmCall: replayLlmCall(dir) };
  const row = await runOneSynthetic({ domain: bundle.domain, role: 'synthetic', bundle, expected }, pipelineOpts);

  assert.strictEqual(row.error, undefined);
  assert.strictEqual(row.contradiction, false, 'an unreproduced known_breach is an abstention, never a contradiction');
  assert.strictEqual(row.knownBreaches[0].status, 'missed', 'the lane genuinely completed (real verify + real adjudicate ran) and found nothing recorded to approve it');

  const code = exitCodeFor([row], { rows: [] });
  assert.strictEqual(code, 1, 'a complete lane that declares a known_breach and reproduces nothing must trip the vacuity clause');
});
