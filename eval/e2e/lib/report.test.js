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

// ── B4 (R2/C-236): resultLine is vacuity-aware - a vacuous run is ALWAYS FAIL, never a stale OK ────────
test('resultLine: a vacuous run is FAIL with the C-236 reason even when the summary itself looks perfectly clean', () => {
  const perfectlyCleanSummary = { contradicting: 0, errored: 0, redTeamEscapes: 0 };
  const line = resultLine(perfectlyCleanSummary, { vacuous: true, completeLanes: 3, reproduced: 0 });
  assert.match(line, /^RESULT: FAIL/);
  assert.match(line, /C-236/);
  assert.match(line, /vacuous/i);
});

test('resultLine: omitting vacuity (or vacuity.vacuous:false) preserves the exact prior OK/FAIL behaviour', () => {
  const clean = { contradicting: 0, errored: 0, redTeamEscapes: 0 };
  assert.match(resultLine(clean), /^RESULT: OK/);
  assert.match(resultLine(clean, undefined), /^RESULT: OK/);
  assert.match(resultLine(clean, { vacuous: false, completeLanes: 0, reproduced: 0 }), /^RESULT: OK/);
});

test('resultLine: a non-vacuous but otherwise dirty run is unaffected by a vacuity object that did not fire', () => {
  const dirty = { contradicting: 1, errored: 0, redTeamEscapes: 0 };
  assert.match(resultLine(dirty, { vacuous: false }), /^RESULT: FAIL - see detail above/);
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

// ── B4 (R2/C-236): printHumanReport prints EXACTLY one RESULT line, and it is FAIL on a vacuous run,
// with no preceding contradictory RESULT: OK line above it. ──────────────────────────────────────────
test('printHumanReport: a vacuous run (extra.vacuity.vacuous:true) prints ONE result line, and it is FAIL', () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const stageTable = [{ stage: 'facts', status: 'ran' }];
    // A row set that is itself perfectly clean (no contradiction, no error, no red-team escape) - the
    // exact shape that used to make resultLine(summary) alone print a stale "RESULT: OK".
    const rows = [{ domain: 'clean.example', role: 'test', knownBreaches: [{ id: 'KB1', status: 'missed' }], knownNonBreaches: [], contradiction: false }];
    const redteam = { present: false, rows: [] };
    const summary = summarise(rows, redteam);
    const vacuity = { vacuous: true, completeLanes: 1, reproduced: 0 };
    const totals = { reproduced: 0, total: 1 };
    printHumanReport(stageTable, rows, redteam, summary, { totals, vacuity });
  } finally {
    console.log = originalLog;
  }
  const resultLines = lines.filter((l) => l.startsWith('RESULT:'));
  assert.strictEqual(resultLines.length, 1, 'exactly one RESULT: line, never a preceding OK followed by a corrective FAIL');
  assert.match(resultLines[0], /^RESULT: FAIL/);
  assert.match(resultLines[0], /C-236/);
  assert.ok(lines.some((l) => l.includes('reproduced: 0/1')), 'the always-on usefulness gauge still prints');
  assert.ok(lines.some((l) => l.includes('vacuous: 0 known_breach reproduced across 1 complete lanes')));
});

test('printHumanReport: a non-vacuous clean run still prints exactly one RESULT: OK line', () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const stageTable = [{ stage: 'facts', status: 'ran' }];
    const rows = [{ domain: 'clean.example', role: 'test', knownBreaches: [{ id: 'KB1', status: 'reproduced' }], knownNonBreaches: [], contradiction: false }];
    const redteam = { present: false, rows: [] };
    const summary = summarise(rows, redteam);
    const vacuity = { vacuous: false, completeLanes: 1, reproduced: 1 };
    const totals = { reproduced: 1, total: 1 };
    printHumanReport(stageTable, rows, redteam, summary, { totals, vacuity });
  } finally {
    console.log = originalLog;
  }
  const resultLines = lines.filter((l) => l.startsWith('RESULT:'));
  assert.strictEqual(resultLines.length, 1);
  assert.match(resultLines[0], /^RESULT: OK/);
});
