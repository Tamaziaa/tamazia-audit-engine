'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildApplicabilityLedger, classifyExcludedReason } = require('./applicability-ledger.js');

test('buildApplicabilityLedger marks every applicable record as "applies" with no reason', () => {
  const ledger = buildApplicabilityLedger({ applicable: [{ id: 'UK_A' }, { id: 'UK_B' }], excluded: [], counts: { frameworksBinding: 2 } });
  assert.strictEqual(ledger.entries.length, 2);
  assert.ok(ledger.entries.every((e) => e.decision === 'applies' && e.reason === null));
});

test('an excluded record with an evidence-gap reason is classified unknown, not not_applicable', () => {
  const ledger = buildApplicabilityLedger({ applicable: [], excluded: [{ record_id: 'US_X', reason: 'sector abstain: insufficient evidence' }], counts: {} });
  assert.strictEqual(ledger.entries[0].decision, 'unknown');
});

test('an excluded record with a definite gate-failure reason is classified not_applicable', () => {
  const ledger = buildApplicabilityLedger({ applicable: [], excluded: [{ record_id: 'US_Y', reason: 'jurisdiction gate: firm not established in or serving US' }], counts: {} });
  assert.strictEqual(ledger.entries[0].decision, 'not_applicable');
});

test('classifyExcludedReason is a pure, directly-testable function', () => {
  assert.strictEqual(classifyExcludedReason('unresolved sector'), 'unknown');
  assert.strictEqual(classifyExcludedReason('sub_sector mismatch'), 'not_applicable');
  assert.strictEqual(classifyExcludedReason(null), 'not_applicable');
});

// CodeRabbit review (PR #36): a real connect() gate-6 exclusion ("none of [...] is satisfied for
// jurisdiction ...", an unproven-nexus evidence gap, not a confirmed negative) must classify unknown, not
// the worse mislabel not_applicable - see applicability-ledger.js's own HINT COVERAGE doc.
test('a gate-6 required-nexus exclusion (evidence never proven, not a confirmed negative) is unknown', () => {
  assert.strictEqual(classifyExcludedReason('gate-6 required-nexus: none of [serves_customers_in] is satisfied for jurisdiction US'), 'unknown');
  assert.strictEqual(classifyExcludedReason('no matching evidence for required_nexus'), 'unknown');
});

test('the total function property: every applicable+excluded record appears exactly once in entries', () => {
  const connectResult = { applicable: [{ id: 'A' }], excluded: [{ record_id: 'B', reason: 'x' }, { record_id: 'C', reason: 'unknown fact' }], counts: {} };
  const ledger = buildApplicabilityLedger(connectResult);
  assert.deepStrictEqual(ledger.entries.map((e) => e.law_id).sort(), ['A', 'B', 'C']);
});
