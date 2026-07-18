'use strict';
// eval/e2e/lib/pipeline.test.js
//   node --test eval/e2e/lib/pipeline.test.js

const test = require('node:test');
const assert = require('node:assert');

const {
  runPipeline,
  runFactsDoors,
  runCoverageStage,
  runOptionalStage,
  runBreachLane,
  runBreachLaneInProcess,
  runBreachLaneSubprocess,
  buildStageTable,
  probeStageWiring,
  verifiedCandidatesFrom,
  adjudicatedFindings,
  perRuleCoverageArg,
} = require('./pipeline');
const { scriptedLlmCall } = require('./scripted-llm');

const MINI_BUNDLE = {
  domain: 'pipeline-test.example',
  corpus: {
    pages: [{
      url: 'https://pipeline-test.example/',
      title: 'Pipeline Test Ltd',
      text: 'Pipeline Test Ltd sells widgets online. Registered office: 1 Test Street, London, United Kingdom.',
      jsonLd: [],
    }],
    footerText: 'Pipeline Test Ltd. Company number 01234567. Registered office: 1 Test Street, London, United Kingdom.',
  },
  registers: {},
};

// Every in-process breach-lane test passes catalogueRecords: [] (an EMPTY catalogue) so the REAL
// propose/verify/adjudicate modules run for real but finish instantly - the propose ReDoS P0 only bites
// on the full 92-record catalogue against real corpora (which the subprocess path guards). These tests
// exercise the wiring, not the catalogue.

function unavailable(reason) {
  return { available: false, reason: reason || 'test: not wired' };
}
function available(run, source) {
  return { available: true, run, source: source || 'test-fake' };
}

test('runFactsDoors: calls the four real facts doors and reports hasCorpus honestly', () => {
  const facts = runFactsDoors(MINI_BUNDLE);
  assert.strictEqual(typeof facts.identity, 'object');
  assert.strictEqual(typeof facts.jurisdiction, 'object');
  assert.strictEqual(typeof facts.sector, 'object');
  assert.ok(Array.isArray(facts.jurisdiction.bound));
  assert.strictEqual(facts.hasCorpus, true);
  assert.ok(facts.capabilities, 'a bundle with real page text should let capabilities run');
});

test('runFactsDoors: an unreadable bundle never derives capabilities (never fabricates)', () => {
  const facts = runFactsDoors({ domain: 'blank.example', corpus: { pages: [] } });
  assert.strictEqual(facts.hasCorpus, false);
  assert.strictEqual(facts.capabilities, null);
});

test('runCoverageStage: site-level coverage runs for real; empty catalogue records degrade per-rule honestly', () => {
  const result = runCoverageStage(MINI_BUNDLE, 'retail', []);
  assert.ok(['assessable', 'screened'].includes(result.site.render_class));
  assert.strictEqual(result.perRule, null);
  assert.match(result.degraded, /per-rule coverage skipped/);
});

test('runCoverageStage: real catalogue records produce a real per-rule breakdown', () => {
  const { loadCatalogueRecords } = require('./catalogue-records');
  const records = loadCatalogueRecords();
  const result = runCoverageStage(MINI_BUNDLE, 'retail', records);
  assert.strictEqual(result.degraded, null);
  assert.ok(result.perRule && Array.isArray(result.perRule.rules));
});

test('perRuleCoverageArg: passes through a real perRule, else an empty-rules object (propose falls back to unknown, never crashes)', () => {
  assert.deepStrictEqual(perRuleCoverageArg({ perRule: { rules: [{ id: 'X', state: 'covered' }] } }), { rules: [{ id: 'X', state: 'covered' }] });
  assert.deepStrictEqual(perRuleCoverageArg({ perRule: null, degraded: 'x' }), { rules: [] });
  assert.deepStrictEqual(perRuleCoverageArg(undefined), { rules: [] });
});

test('verifiedCandidatesFrom: unwraps the verifier .candidate objects (Rob ledger decision 6)', () => {
  const c1 = { rule_id: 'A' };
  const c2 = { rule_id: 'B' };
  const result = { output: { verified: [{ candidate: c1, verified: true }, { candidate: c2, verified: true }], rejected: [] } };
  assert.deepStrictEqual(verifiedCandidatesFrom(result), [c1, c2]);
});

test('verifiedCandidatesFrom: a non-verifyAll shape (unwired/errored stage) yields []', () => {
  assert.deepStrictEqual(verifiedCandidatesFrom({ output: null }), []);
  assert.deepStrictEqual(verifiedCandidatesFrom({ output: [1, 2, 3] }), []);
});

test('adjudicatedFindings: reads .findings off the real adjudicate.js shape, and a bare array off a double', () => {
  assert.deepStrictEqual(adjudicatedFindings({ output: { findings: [{ id: 1 }], report: {} } }), [{ id: 1 }]);
  assert.deepStrictEqual(adjudicatedFindings({ output: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepStrictEqual(adjudicatedFindings({ output: null }), []);
});

test('runOptionalStage: an unavailable stage reports skipped, never invokes run', async () => {
  const r = await runOptionalStage('propose', unavailable('not landed'), () => { throw new Error('must not be called'); });
  assert.deepStrictEqual(r, { ran: false, skipped: true, error: null, reason: 'not landed', output: null, source: null });
});

test('runOptionalStage: an available stage that succeeds reports ran with its output', async () => {
  const r = await runOptionalStage('propose', available(() => ['x']), () => []);
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.skipped, false);
  assert.deepStrictEqual(r.output, ['x']);
});

test('runOptionalStage: an available stage that throws reports error, never skipped, never crashes the caller', async () => {
  const r = await runOptionalStage('adjudicate', available(() => { throw new Error('boom'); }), () => []);
  assert.strictEqual(r.ran, false);
  assert.strictEqual(r.skipped, false);
  assert.match(r.error, /boom/);
});

test('runOptionalStage: an available ASYNC stage that rejects also reports error, not a hang or a crash', async () => {
  const r = await runOptionalStage('verify', available(() => Promise.reject(new Error('async boom'))), () => []);
  assert.strictEqual(r.skipped, false);
  assert.match(r.error, /async boom/);
});

test('runBreachLaneInProcess: the real chain on an EMPTY catalogue completes cleanly with empty findings', async () => {
  const breach = await runBreachLaneInProcess(MINI_BUNDLE, { perRule: { rules: [] } }, { catalogueRecords: [] });
  assert.strictEqual(breach.propose.ran, true, 'propose (W2a) has landed and runs');
  assert.strictEqual(breach.verify.ran, true, 'verify (W2b) has landed and runs');
  assert.strictEqual(breach.adjudicate.ran, true, 'adjudicate (W2c) has landed and runs');
  assert.deepStrictEqual(breach.findings, [], 'an empty catalogue proposes nothing, so there are no findings');
});

test('runBreachLane: an injected full chain (propose+verify+adjudicate) produces real findings; adjudicate receives UNWRAPPED candidates', async () => {
  const proposeLoaded = available(() => [{ rule_id: 'TEST_RULE', artifact: { type: 'quote', page_url: 'https://x/', quote: 'q', surface: 'visible_text' } }]);
  const verifyLoaded = available((candidates) => ({
    verified: candidates.map((c) => ({ candidate: c, verified: true, code: 'OK', reason: 'test' })),
    rejected: [],
  }));
  // Rob ledger decision 6: the adjudicate stage now receives the UNWRAPPED candidates [candidate,...],
  // NOT the verifier's [{candidate,...}] envelopes.
  const adjudicateLoaded = available((candidates, bundle, opts) => ({
    findings: candidates.map((c) => ({ id: c.rule_id, framework: 'TEST_FRAMEWORK', state: 'violation', quote: c.artifact.quote })),
    report: { llmCallSeen: typeof opts.llmCall === 'function' },
  }));
  const breach = await runBreachLane(MINI_BUNDLE, {}, { proposeLoaded, verifyLoaded, adjudicateLoaded, llmCall: scriptedLlmCall({ verdicts: [] }) });
  assert.strictEqual(breach.propose.ran, true);
  assert.strictEqual(breach.verify.ran, true);
  assert.strictEqual(breach.adjudicate.ran, true);
  assert.strictEqual(breach.findings.length, 1);
  assert.strictEqual(breach.findings[0].framework, 'TEST_FRAMEWORK');
  assert.strictEqual(breach.adjudicate.output.report.llmCallSeen, true, 'the scripted llmCall must reach the adjudicate stage');
});

test('buildStageTable: fixtureBundle/facts/coverage always ran; the landed breach stages all report ran', async () => {
  const breach = await runBreachLaneInProcess(MINI_BUNDLE, { perRule: { rules: [] } }, { catalogueRecords: [] });
  const table = buildStageTable(breach);
  const byStage = Object.fromEntries(table.map((r) => [r.stage, r.status]));
  assert.strictEqual(byStage.fixtureBundle, 'ran');
  assert.strictEqual(byStage.facts, 'ran');
  assert.strictEqual(byStage.coverage, 'ran');
  assert.strictEqual(byStage.propose, 'ran');
  assert.strictEqual(byStage.verify, 'ran');
  assert.strictEqual(byStage.adjudicate, 'ran');
});

test('probeStageWiring: reports a well-formed wired/not-wired row for every optional stage', () => {
  const wiring = probeStageWiring();
  const stages = wiring.map((r) => r.stage);
  assert.deepStrictEqual(stages, ['facts', 'coverage', 'propose', 'verify', 'adjudicate']);
  for (const row of wiring) assert.ok(['wired', 'not-wired'].includes(row.status));
});

test('probeStageWiring: propose, verify and adjudicate are all WIRED against the real tree', () => {
  const wiring = probeStageWiring();
  const byStage = Object.fromEntries(wiring.map((r) => [r.stage, r.status]));
  assert.strictEqual(byStage.propose, 'wired', 'breach/proposers/propose.js should be wired - ' + JSON.stringify(wiring.find((w) => w.stage === 'propose')));
  assert.strictEqual(byStage.verify, 'wired');
  assert.strictEqual(byStage.adjudicate, 'wired', 'breach/adjudicator/adjudicate.js should be wired - ' + JSON.stringify(wiring.find((w) => w.stage === 'adjudicate')));
});

test('runPipeline: end-to-end (real modules, EMPTY catalogue) completes the breach lane with empty findings', async () => {
  const result = await runPipeline('pipeline-test.example', MINI_BUNDLE, { catalogueRecords: [] });
  assert.strictEqual(result.domain, 'pipeline-test.example');
  assert.strictEqual(result.payload.meta.domain, 'pipeline-test.example');
  assert.deepStrictEqual(result.payload.findings, []);
  assert.strictEqual(result.breachLaneComplete, true, 'all three breach stages have landed and run on an empty catalogue');
});

test('runPipeline: --no-breach skips the whole breach lane; breachLaneComplete false; every breach stage reports skipped', async () => {
  const result = await runPipeline('pipeline-test.example', MINI_BUNDLE, { noBreach: true, catalogueRecords: [] });
  assert.strictEqual(result.breachLaneComplete, false);
  const byStage = Object.fromEntries(result.stageTable.map((r) => [r.stage, r.status]));
  assert.strictEqual(byStage.propose, 'skipped');
  assert.strictEqual(byStage.verify, 'skipped');
  assert.strictEqual(byStage.adjudicate, 'skipped');
  assert.deepStrictEqual(result.payload.findings, []);
});

test('runPipeline: breachLaneComplete is true only when propose+verify+adjudicate ALL genuinely ran', async () => {
  const proposeLoaded = available(() => []);
  const verifyLoaded = available(() => ({ verified: [], rejected: [] }));
  const adjudicateLoaded = available(() => ({ findings: [], report: {} }));
  const result = await runPipeline('complete-test.example', MINI_BUNDLE, { proposeLoaded, verifyLoaded, adjudicateLoaded });
  assert.strictEqual(result.breachLaneComplete, true);
});

test('runPipeline: a thrown breach stage keeps breachLaneComplete false and surfaces the error, never fabricates a pass', async () => {
  const proposeLoaded = available(() => { throw new Error('propose exploded'); });
  const result = await runPipeline('erroring-test.example', MINI_BUNDLE, { proposeLoaded });
  assert.strictEqual(result.breachLaneComplete, false);
  assert.match(result.breach.propose.error, /propose exploded/);
});

// ── the subprocess Rule-9 guard (breach-worker.js) ────────────────────────────────────────────────
test('runBreachLaneSubprocess: an EMPTY catalogue round-trips through the child and completes with empty findings', async () => {
  const breach = await runBreachLaneSubprocess(MINI_BUNDLE, { perRule: { rules: [] } }, { catalogueRecords: [], breachTimeoutMs: 10000 });
  assert.strictEqual(breach.propose.ran, true);
  assert.strictEqual(breach.verify.ran, true);
  assert.strictEqual(breach.adjudicate.ran, true);
  assert.deepStrictEqual(breach.findings, []);
});

test('runBreachLaneSubprocess: a 1ms deadline KILLS the child and records an honest breach-lane error (Rule 9), never a hang', async () => {
  const breach = await runBreachLaneSubprocess(MINI_BUNDLE, { perRule: { rules: [] } }, { catalogueRecords: [], breachTimeoutMs: 1 });
  assert.strictEqual(breach.propose.ran, false);
  assert.match(breach.propose.error, /deadline|killed|failed/);
  assert.deepStrictEqual(breach.findings, []);
});

test('runBreachLane: dispatches to the subprocess when breachTimeoutMs is set and no loader is injected', async () => {
  // With an empty catalogue the subprocess finishes fast; this proves the dispatcher routes to it.
  const breach = await runBreachLane(MINI_BUNDLE, { perRule: { rules: [] } }, { catalogueRecords: [], breachTimeoutMs: 10000 });
  assert.strictEqual(breach.propose.ran, true);
  assert.deepStrictEqual(breach.findings, []);
});

test('runBreachLane: an injected loader forces the in-process path even when breachTimeoutMs is set', async () => {
  const proposeLoaded = available(() => []);
  const breach = await runBreachLane(MINI_BUNDLE, { perRule: { rules: [] } }, { proposeLoaded, catalogueRecords: [], breachTimeoutMs: 1 });
  // A 1ms subprocess deadline would have errored; the in-process path with an injected empty propose does not.
  assert.strictEqual(breach.propose.ran, true);
});
