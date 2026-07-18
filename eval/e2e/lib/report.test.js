'use strict';
// eval/e2e/lib/report.test.js
//   node --test eval/e2e/lib/report.test.js

const test = require('node:test');
const assert = require('node:assert');

const { summarise, stageWiringLine, knownBreachSummary, knownNonBreachSummary, resultLine, printHumanReport } = require('./report');

test('stageWiringLine: renders each stage, its status uppercased, and any reason', () => {
  const line = stageWiringLine([{ stage: 'facts', status: 'ran' }, { stage: 'propose', status: 'skipped', reason: 'not landed' }]);
  assert.match(line, /facts=RAN/);
  assert.match(line, /propose=SKIPPED \(not landed\)/);
});

test('knownBreachSummary: empty list renders "-"', () => {
  assert.strictEqual(knownBreachSummary([]), '-');
});

test('knownBreachSummary: mixed statuses are counted and listed', () => {
  const s = knownBreachSummary([{ status: 'reproduced' }, { status: 'skipped' }, { status: 'skipped' }]);
  assert.strictEqual(s, '3 (1 reproduced, 2 skipped)');
});

test('knownNonBreachSummary: a contradiction dominates the summary', () => {
  const s = knownNonBreachSummary([{ status: 'clean' }, { status: 'contradiction' }]);
  assert.strictEqual(s, '1 CONTRADICTION');
});

test('knownNonBreachSummary: all clean renders a plain count', () => {
  assert.strictEqual(knownNonBreachSummary([{ status: 'clean' }, { status: 'clean' }]), '2 clean');
});

test('summarise: counts firms, ok, contradicting, errored, breach outcomes, and red-team escapes/errors together', () => {
  const rows = [
    { contradiction: false, stageTable: [{ stage: 'propose', status: 'ran' }, { stage: 'verify', status: 'ran' }, { stage: 'adjudicate', status: 'ran' }] },
    { contradiction: true, report: { contradictions: [] }, stageTable: [{ stage: 'propose', status: 'error' }, { stage: 'verify', status: 'error' }, { stage: 'adjudicate', status: 'error' }] },
    { error: 'boom' },
  ];
  const redteam = { rows: [{ status: 'caught' }, { status: 'escaped' }, { status: 'error' }, { status: 'skipped' }] };
  const s = summarise(rows, redteam);
  assert.deepStrictEqual(s, {
    firms: 3, ok: 1, contradicting: 1, errored: 1,
    breach: { complete: 1, errored: 1, skipped: 0 },
    redTeamEntries: 4, redTeamEscapes: 2,
  });
});

test('breachOutcome: reads a firm\'s per-firm breach outcome off its stageTable', () => {
  const { breachOutcome } = require('./report');
  const complete = { stageTable: [{ stage: 'propose', status: 'ran' }, { stage: 'verify', status: 'ran' }, { stage: 'adjudicate', status: 'ran' }] };
  const errored = { stageTable: [{ stage: 'propose', status: 'error' }, { stage: 'verify', status: 'error' }, { stage: 'adjudicate', status: 'error' }] };
  const skipped = { stageTable: [{ stage: 'propose', status: 'skipped' }, { stage: 'verify', status: 'skipped' }, { stage: 'adjudicate', status: 'skipped' }] };
  assert.strictEqual(breachOutcome(complete), 'complete');
  assert.strictEqual(breachOutcome(errored), 'errored');
  assert.strictEqual(breachOutcome(skipped), 'skipped');
  assert.strictEqual(breachOutcome({ error: 'no fixture' }), 'n/a');
});

test('summarise: a red-team lane that never ran contributes zero entries and zero escapes', () => {
  const s = summarise([], { rows: [] });
  assert.strictEqual(s.redTeamEntries, 0);
  assert.strictEqual(s.redTeamEscapes, 0);
});

test('resultLine: OK only when zero contradictions, zero errors, zero red-team escapes', () => {
  const clean = { contradicting: 0, errored: 0, redTeamEscapes: 0 };
  const dirty = { contradicting: 1, errored: 0, redTeamEscapes: 0 };
  assert.match(resultLine(clean), /^RESULT: OK/);
  assert.match(resultLine(dirty), /^RESULT: FAIL/);
});

test('printHumanReport: runs without throwing on a representative result set (smoke test)', () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const stageTable = [{ stage: 'facts', status: 'ran' }, { stage: 'propose', status: 'skipped', reason: 'not landed yet' }];
    const rows = [
      { domain: 'ok.example', role: 'test', knownBreaches: [], knownNonBreaches: [], contradiction: false },
      { domain: 'bad.example', role: 'test', error: 'pipeline threw: x' },
    ];
    const redteam = { present: false, rows: [] };
    const summary = summarise(rows, redteam);
    printHumanReport(stageTable, rows, redteam, summary);
  } finally {
    console.log = originalLog;
  }
  assert.ok(lines.some((l) => l.includes('eval/e2e/run-pipeline')));
  assert.ok(lines.some((l) => l.includes('RESULT:')));
});
