'use strict';
// eval/e2e/lib/judge.test.js - proves the reproduced/missed/skipped and contradiction/clean semantics
// (docs/P3-ACCEPTANCE.md point 2 and point 4) against a synthetic mini pipeline result: one planted,
// verifiable quote breach and one known_non_breach trap, exactly as specified.
//   node --test eval/e2e/lib/judge.test.js

const test = require('node:test');
const assert = require('node:assert');

const { judgeFirm } = require('./judge');

const FIRM = {
  domain: 'judge-test.example',
  role: 'test',
  expected: {
    known_breaches: [
      { id: 'JT-BREACH', framework: 'Judge Test Framework', description: 'planted verifiable quote breach', match_any: ['guarantee you will win every case'] },
    ],
    known_non_breaches: [
      { id: 'JT-TRAP', framework: 'Judge Test Trap Framework', description: 'must never be asserted', match_any: ['trap-token-should-never-match'] },
    ],
  },
};

function pipelineResult(findings, breachLaneComplete) {
  return {
    payload: { meta: { domain: FIRM.domain, sector: null }, identity: {}, jurisdiction: { bound: [] }, frameworks: [], findings },
    breachLaneComplete,
  };
}

test('judgeFirm: a matching VIOLATION finding is reproduced, not a contradiction', () => {
  const findings = [{ id: 'F1', framework: 'Judge Test Framework', state: 'violation', quote: 'we guarantee you will win every case, no exceptions' }];
  const judged = judgeFirm(FIRM, pipelineResult(findings, true));
  assert.strictEqual(judged.knownBreaches[0].status, 'reproduced');
  assert.strictEqual(judged.contradiction, false);
});

test('judgeFirm: a VIOLATION finding matching the known_non_breach trap is a CONTRADICTION', () => {
  const findings = [{ id: 'F2', framework: 'Judge Test Trap Framework', state: 'violation', quote: 'this text contains trap-token-should-never-match verbatim' }];
  const judged = judgeFirm(FIRM, pipelineResult(findings, true));
  assert.strictEqual(judged.knownNonBreaches[0].status, 'contradiction');
  assert.strictEqual(judged.contradiction, true);
});

test('judgeFirm: no findings + an INCOMPLETE breach lane -> SKIPPED, never "missed" (never fabricate a pass)', () => {
  const judged = judgeFirm(FIRM, pipelineResult([], false));
  assert.strictEqual(judged.knownBreaches[0].status, 'skipped');
  assert.strictEqual(judged.knownNonBreaches[0].status, 'clean');
  assert.strictEqual(judged.knownNonBreaches[0].trivial, true, 'a clean verdict with no breach lane run at all is trivially clean');
  assert.strictEqual(judged.contradiction, false);
});

test('judgeFirm: no findings + a COMPLETE breach lane -> MISSED (a real, non-trivial abstention)', () => {
  const judged = judgeFirm(FIRM, pipelineResult([], true));
  assert.strictEqual(judged.knownBreaches[0].status, 'missed');
  assert.strictEqual(judged.knownNonBreaches[0].status, 'clean');
  assert.strictEqual(judged.knownNonBreaches[0].trivial, false, 'the lane genuinely ran and genuinely found nothing - not a trivial clean');
});

test('judgeFirm: a needs-review finding mentioning the trap tokens is NOT a contradiction (three-state doctrine)', () => {
  const findings = [{ id: 'F3', framework: 'Judge Test Trap Framework', state: 'needs-review', quote: 'detected trap-token-should-never-match; this may implicate the trap framework' }];
  const judged = judgeFirm(FIRM, pipelineResult(findings, true));
  assert.strictEqual(judged.knownNonBreaches[0].status, 'clean');
  assert.strictEqual(judged.contradiction, false);
});

test('judgeFirm: a needs-review finding mentioning the breach tokens does not count as reproduced either (only asserted findings count)', () => {
  const findings = [{ id: 'F4', framework: 'Judge Test Framework', state: 'needs-review', quote: 'detected language resembling guarantee you will win every case' }];
  const judged = judgeFirm(FIRM, pipelineResult(findings, true));
  assert.strictEqual(judged.knownBreaches[0].status, 'missed');
});

test('judgeFirm: an unrelated contradiction (e.g. jurisdiction) still marks the firm as contradiction:true', () => {
  const result = pipelineResult([], true);
  result.payload.jurisdiction.bound = ['US'];
  const firmWithBoundExpectation = Object.assign({}, FIRM, { expected: Object.assign({}, FIRM.expected, { jurisdictions_bound: ['UK'] }) });
  const judged = judgeFirm(firmWithBoundExpectation, result);
  assert.strictEqual(judged.contradiction, true);
});

test('judgeFirm: a firm with no known_breaches/known_non_breaches at all judges cleanly with empty arrays', () => {
  const bareFirm = { domain: 'bare.example', role: 'test', expected: {} };
  const judged = judgeFirm(bareFirm, pipelineResult([], false));
  assert.deepStrictEqual(judged.knownBreaches, []);
  assert.deepStrictEqual(judged.knownNonBreaches, []);
  assert.strictEqual(judged.contradiction, false);
});
