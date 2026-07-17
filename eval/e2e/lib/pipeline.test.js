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
  buildStageTable,
  probeStageWiring,
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

test('runBreachLane: today\'s real wiring (propose absent) yields empty findings but a genuine verify run', async () => {
  const breach = await runBreachLane(MINI_BUNDLE, { site: { render_class: 'assessable' } }, { catalogueRecords: [] });
  assert.strictEqual(breach.propose.skipped, true);
  // breach/verifiers/index.js HAS landed (verifyAll) - it genuinely runs, just on an empty candidate list.
  assert.strictEqual(breach.verify.ran, true);
  assert.deepStrictEqual(breach.verify.output, { verified: [], rejected: [] });
  assert.deepStrictEqual(breach.findings, []);
});

test('runBreachLane: an injected full chain (propose+verify+adjudicate) produces real findings', async () => {
  const proposeLoaded = available(() => [{ rule_id: 'TEST_RULE', artifact: { type: 'quote', page_url: 'https://x/', quote: 'q', surface: 'visible_text' } }]);
  const verifyLoaded = available((candidates) => ({
    verified: candidates.map((c) => ({ candidate: c, verified: true, code: 'OK', reason: 'test' })),
    rejected: [],
  }));
  const adjudicateLoaded = available((verified) => verified.map((v) => ({
    id: v.candidate.rule_id, framework: 'TEST_FRAMEWORK', state: 'violation', quote: v.candidate.artifact.quote,
  })));
  const breach = await runBreachLane(MINI_BUNDLE, {}, { proposeLoaded, verifyLoaded, adjudicateLoaded, llmCall: scriptedLlmCall({ verdict: 'breach' }) });
  assert.strictEqual(breach.propose.ran, true);
  assert.strictEqual(breach.verify.ran, true);
  assert.strictEqual(breach.adjudicate.ran, true);
  assert.strictEqual(breach.findings.length, 1);
  assert.strictEqual(breach.findings[0].framework, 'TEST_FRAMEWORK');
});

test('buildStageTable: fixtureBundle/facts/coverage always ran; breach stages reflect their own outcome', async () => {
  const breach = await runBreachLane(MINI_BUNDLE, {}, { catalogueRecords: [] });
  const table = buildStageTable(breach);
  const byStage = Object.fromEntries(table.map((r) => [r.stage, r.status]));
  assert.strictEqual(byStage.fixtureBundle, 'ran');
  assert.strictEqual(byStage.facts, 'ran');
  assert.strictEqual(byStage.coverage, 'ran');
  assert.strictEqual(byStage.propose, 'skipped');
  assert.strictEqual(byStage.verify, 'ran');
});

test('probeStageWiring: reports a well-formed wired/not-wired row for every optional stage', () => {
  const wiring = probeStageWiring();
  const stages = wiring.map((r) => r.stage);
  assert.deepStrictEqual(stages, ['facts', 'coverage', 'propose', 'verify', 'adjudicate']);
  for (const row of wiring) assert.ok(['wired', 'not-wired'].includes(row.status));
});

test('runPipeline: end-to-end against the real repo wiring produces a tolerant payload with empty findings today', async () => {
  const result = await runPipeline('pipeline-test.example', MINI_BUNDLE);
  assert.strictEqual(result.domain, 'pipeline-test.example');
  assert.strictEqual(result.payload.meta.domain, 'pipeline-test.example');
  assert.deepStrictEqual(result.payload.findings, []);
  assert.strictEqual(result.breachLaneComplete, false, 'propose is not landed yet, so the breach lane cannot be complete');
});

test('runPipeline: breachLaneComplete is true only when propose+verify+adjudicate ALL genuinely ran', async () => {
  const proposeLoaded = available(() => []);
  const verifyLoaded = available(() => ({ verified: [], rejected: [] }));
  const adjudicateLoaded = available(() => []);
  const result = await runPipeline('complete-test.example', MINI_BUNDLE, { proposeLoaded, verifyLoaded, adjudicateLoaded });
  assert.strictEqual(result.breachLaneComplete, true);
});

test('runPipeline: a thrown breach stage keeps breachLaneComplete false and surfaces the error, never fabricates a pass', async () => {
  const proposeLoaded = available(() => { throw new Error('propose exploded'); });
  const result = await runPipeline('erroring-test.example', MINI_BUNDLE, { proposeLoaded });
  assert.strictEqual(result.breachLaneComplete, false);
  assert.match(result.breach.propose.error, /propose exploded/);
});
