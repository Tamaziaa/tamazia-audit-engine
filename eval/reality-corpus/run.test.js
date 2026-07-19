'use strict';
// eval/reality-corpus/run.test.js - direct unit coverage for run.js's own pure/small-I/O functions
// (lintSite, evaluateBudgets, loadBudgets). Before this file, lintSite()'s rules were only exercised
// indirectly by running `--lint` against the real corpus (which can only prove "the current 13 files
// pass", never "a bad file is rejected") - CodeRabbit PR #32 asked for the actual failing-gate proof,
// not just the real corpus's happy path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { lintSite, evaluateBudgets, loadBudgets } = require('./run.js');

function validSite(overrides) {
  return Object.assign({
    slug: 'test-site',
    domain: 'test-site.example',
    sector_paths: ['legal.solicitors'],
    source: 'test',
    snapshot_source: 'synthetic',
    establishment: [{ jurisdiction: 'UK', tier: 'A', basis: 'test' }],
    labelled_breaches: [],
    applicable_law_ids: [],
    known_clean_laws: [],
  }, overrides);
}

test('lintSite: a fully valid site has no errors', () => {
  assert.deepEqual(lintSite(validSite()), []);
});

test('lintSite: a labelled_breaches entry with no quote_substring is REJECTED ("no artifact, no breach")', () => {
  const site = validSite({ labelled_breaches: [{ law_id: 'UK_SRA_TRANSPARENCY', quote_substring: null, url: 'https://x/' }] });
  const errors = lintSite(site);
  assert.ok(errors.some((e) => e.includes('UK_SRA_TRANSPARENCY') && e.includes('quote_substring')));
});

test('lintSite: a labelled_breaches entry with an empty-string quote_substring is also REJECTED', () => {
  const site = validSite({ labelled_breaches: [{ law_id: 'UK_SRA_TRANSPARENCY', quote_substring: '', url: 'https://x/' }] });
  const errors = lintSite(site);
  assert.ok(errors.some((e) => e.includes('quote_substring')));
});

test('lintSite: a labelled_breaches entry WITH a quote_substring is accepted', () => {
  const site = validSite({ labelled_breaches: [{ law_id: 'UK_SRA_TRANSPARENCY', quote_substring: 'no pricing', url: 'https://x/' }] });
  assert.deepEqual(lintSite(site), []);
});

test('lintSite: role negative-near-clean with an empty known_clean_laws is REJECTED (vacuous false-accusation control)', () => {
  const site = validSite({ role: 'negative-near-clean', known_clean_laws: [] });
  const errors = lintSite(site);
  assert.ok(errors.some((e) => e.includes('negative-near-clean') && e.includes('known_clean_laws')));
});

test('lintSite: role negative-out-of-scope with an empty known_clean_laws is REJECTED', () => {
  const site = validSite({ role: 'negative-out-of-scope', known_clean_laws: [] });
  const errors = lintSite(site);
  assert.ok(errors.some((e) => e.includes('negative-out-of-scope')));
});

test('lintSite: role negative-near-clean WITH a non-empty known_clean_laws is accepted', () => {
  const site = validSite({ role: 'negative-near-clean', known_clean_laws: ['UK_PECR_COOKIES_MARKETING'] });
  assert.deepEqual(lintSite(site), []);
});

test('lintSite: a train-role site with an empty known_clean_laws is accepted (the negative-role rule does not apply)', () => {
  const site = validSite({ role: 'train', known_clean_laws: [] });
  assert.deepEqual(lintSite(site), []);
});

function minimalSummary(overrides) {
  return Object.assign({
    sites_total: 1, sites_ran: 1, sites_skipped_no_snapshot: 0, sites_errored: 0,
    sector: { correct: 1, abstain: 0, wrong: 0, labelled: 1, refusal_rate: 0, accuracy: 1 },
    jurisdiction: { establishment_recall_avg: 1, wrong_attach_total: 0 },
    applicability: { recall_avg: 1, catalogue_gaps_total: 0 },
    breach: { labelled_total: 0, assessable_total: 0, reproduced_total: 0, coverage_adjusted_recall: null },
    false_accusations_total: 0,
  }, overrides);
}

const PERMISSIVE_BUDGETS = { false_accusations_max: 0, sector_refusal_rate_max: 0, coverage_adjusted_recall_min: 0, jurisdiction_wrong_attach_max: 0 };

test('evaluateBudgets: a clean summary within every budget passes', () => {
  const verdict = evaluateBudgets(minimalSummary(), PERMISSIVE_BUDGETS);
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.failures, []);
});

test('evaluateBudgets: zero sites_ran is a hard fail, not a vacuous pass (CodeRabbit PR #32)', () => {
  const summary = minimalSummary({
    sites_ran: 0,
    sector: { correct: 0, abstain: 0, wrong: 0, labelled: 0, refusal_rate: null, accuracy: null },
    jurisdiction: { establishment_recall_avg: null, wrong_attach_total: 0 },
    applicability: { recall_avg: null, catalogue_gaps_total: 0 },
  });
  const verdict = evaluateBudgets(summary, PERMISSIVE_BUDGETS);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.includes('sites_ran is 0')));
});

test('evaluateBudgets: any errored site is a hard fail, never silently excluded (CodeRabbit PR #32)', () => {
  const summary = minimalSummary({ sites_errored: 1 });
  const verdict = evaluateBudgets(summary, PERMISSIVE_BUDGETS);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.includes('sites_errored')));
});

test('loadBudgets: the real committed budgets.json passes its own schema validation', () => {
  // Not a fixture - the actual file the CI gate reads. If this throws, the gate cannot run at all.
  const budgets = loadBudgets();
  assert.equal(typeof budgets.false_accusations_max, 'number');
  assert.equal(typeof budgets.sector_refusal_rate_max, 'number');
  assert.equal(typeof budgets.coverage_adjusted_recall_min, 'number');
  assert.equal(typeof budgets.jurisdiction_wrong_attach_max, 'number');
});

test('loadBudgets: a budgets.json missing a required key throws (fails closed, CodeRabbit PR #32)', () => {
  const tmp = path.join(os.tmpdir(), 'reality-corpus-budgets-known-bad-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ false_accusations_max: 0, sector_refusal_rate_max: 0, coverage_adjusted_recall_min: 0 }));
  try {
    assert.throws(() => loadBudgets(tmp), /jurisdiction_wrong_attach_max/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('loadBudgets: a budgets.json with a non-finite value throws', () => {
  const tmp = path.join(os.tmpdir(), 'reality-corpus-budgets-known-bad-nan-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({
    false_accusations_max: 0, sector_refusal_rate_max: 0, coverage_adjusted_recall_min: 'not-a-number', jurisdiction_wrong_attach_max: 0,
  }));
  try {
    assert.throws(() => loadBudgets(tmp), /coverage_adjusted_recall_min/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
