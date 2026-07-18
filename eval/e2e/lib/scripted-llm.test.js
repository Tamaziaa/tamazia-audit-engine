'use strict';
// eval/e2e/lib/scripted-llm.test.js
//   node --test eval/e2e/lib/scripted-llm.test.js

const test = require('node:test');
const assert = require('node:assert');

const { defaultScriptedLlmCall, scriptedLlmCall, allVerdicts } = require('./scripted-llm');
const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');

test('defaultScriptedLlmCall: always DECLINES (ok:false) so the adjudicator abstains, never asserts', async () => {
  const r1 = await defaultScriptedLlmCall({ any: 'request' });
  const r2 = await defaultScriptedLlmCall(undefined);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r2.ok, false);
  assert.ok(typeof r1.reason === 'string' && r1.reason.length > 0);
});

test('scriptedLlmCall: an array is consumed strictly in call order', async () => {
  const call = scriptedLlmCall([{ verdicts: [{ id: 0, verdict: 'breach' }] }, { verdicts: [{ id: 0, verdict: 'no_breach', disproof: 'x' }] }]);
  const first = await call({ i: 1 });
  const second = await call({ i: 2 });
  assert.strictEqual(first.verdicts[0].verdict, 'breach');
  assert.strictEqual(second.verdicts[0].verdict, 'no_breach');
});

test('scriptedLlmCall: an exhausted array queue DECLINES (ok:false) rather than repeating a stale entry', async () => {
  const call = scriptedLlmCall([{ verdicts: [{ id: 0, verdict: 'breach' }] }]);
  await call({});
  const exhausted = await call({});
  assert.strictEqual(exhausted.ok, false);
});

test('scriptedLlmCall: a function script is called per-request for full control', async () => {
  const call = scriptedLlmCall((request) => ({ verdicts: [{ id: 0, verdict: request.wantBreach ? 'breach' : 'no_breach' }] }));
  const a = await call({ wantBreach: true });
  const b = await call({ wantBreach: false });
  assert.strictEqual(a.verdicts[0].verdict, 'breach');
  assert.strictEqual(b.verdicts[0].verdict, 'no_breach');
});

test('scriptedLlmCall: a bare object script answers every call identically', async () => {
  const call = scriptedLlmCall({ verdicts: [], reason: 'fixed' });
  const a = await call({});
  const b = await call({});
  assert.strictEqual(a.reason, 'fixed');
  assert.strictEqual(b.reason, 'fixed');
});

test('allVerdicts: builds a well-formed verdicts response asserting the same verdict for ids 0..count-1', () => {
  const r = allVerdicts('breach', 3);
  assert.strictEqual(r.verdicts.length, 3);
  assert.deepStrictEqual(r.verdicts.map((v) => v.id), [0, 1, 2]);
  assert.ok(r.verdicts.every((v) => v.verdict === 'breach'));
});

// ── the CONTRACT check: the scripted llmCall shape is correct against the REAL adjudicator ──────────
// These drive breach/adjudicator/adjudicate.js directly (no network, no real model) to prove the
// scripted-llm.js response shape is exactly what the adjudicator consumes end to end.

// A text-derived candidate (artifact.type 'absence' - classified as the adjudicated text class by
// evidence-kind.js) with a verbatim quote the disproof can anchor in.
function textCandidate() {
  return {
    record_id: 'TEST_RULE',
    artifact: { type: 'absence' },
    description: 'a required disclosure is claimed missing',
    evidence_quote: 'we process your personal data in accordance with our privacy policy',
    // Real candidates always carry a locator; Gate 3's premise_source_id derives from it and an
    // absent locator abstain-demotes before the scripted breach can survive to violation.
    page_url: 'https://x.test/privacy',
  };
}

test('CONTRACT: the DEFAULT llmCall abstains a text candidate to needs_review through the real adjudicator', async () => {
  const { findings } = await adjudicate([textCandidate()], { domain: 'x.test' }, { llmCall: defaultScriptedLlmCall, deadlineMs: 5000 });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].state, 'needs_review', 'the decline default must abstain, never assert a violation');
});

test('CONTRACT: a scripted "breach" verdict drives the real adjudicator to a violation', async () => {
  const call = scriptedLlmCall(allVerdicts('breach', 1));
  const { findings } = await adjudicate([textCandidate()], { domain: 'x.test' }, { llmCall: call, deadlineMs: 5000 });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].state, 'violation', 'a well-formed scripted breach verdict must produce a violation');
});

test('CONTRACT: a scripted "insufficient" verdict drives the real adjudicator to needs_review', async () => {
  const call = scriptedLlmCall(allVerdicts('insufficient', 1));
  const { findings } = await adjudicate([textCandidate()], { domain: 'x.test' }, { llmCall: call, deadlineMs: 5000 });
  assert.strictEqual(findings[0].state, 'needs_review');
});

test('CONTRACT: |findings| always equals |candidates| - the adjudicator is filter-only, a verdict cannot inject a finding', async () => {
  // A scripted response with an EXTRA verdict for an id no candidate owns must not create a finding.
  const call = scriptedLlmCall({ verdicts: [{ id: 0, verdict: 'breach' }, { id: 99, verdict: 'breach' }] });
  const { findings } = await adjudicate([textCandidate()], { domain: 'x.test' }, { llmCall: call, deadlineMs: 5000 });
  assert.strictEqual(findings.length, 1, 'exactly one input candidate -> exactly one finding, never two');
});
