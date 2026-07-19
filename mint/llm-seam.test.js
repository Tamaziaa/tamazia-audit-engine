'use strict';
const test = require('node:test');
const assert = require('node:assert');
const seam = require('./llm-seam.js');

// A fake router provider that returns a scripted text (route() interprets a string return as { ok, text }).
function fakeProvider(text, family) {
  return { name: (family || 'fake') + '::m', family: family || 'fake', tier: 'free', call: async () => text };
}

const ENTAILMENT_SCHEMA = { type: 'object', properties: { verdict: { enum: ['entailment', 'neutral', 'contradiction'] } } };

test('request-kind detection: entailment (schema verdict enum) vs adjudication (rubric fn) vs generic', () => {
  assert.strictEqual(seam.isEntailmentRequest({ schema: ENTAILMENT_SCHEMA }), true);
  assert.strictEqual(seam.isAdjudicationRequest({ rubric: () => ({ score: 9 }) }), true);
  assert.strictEqual(seam.isEntailmentRequest({ prompt: 'x' }), false);
  assert.strictEqual(seam.isAdjudicationRequest({ prompt: 'x' }), false);
});

test('an ADJUDICATION call returns the {ok, out:{verdicts}} shape adjudicate.js consumes (rubric is the gate)', async () => {
  const llmCall = seam.buildLlmCall({ providers: [fakeProvider('{"verdicts":[{"id":0,"verdict":"breach"}]}')] });
  const out = await llmCall({ rubric: () => ({ score: 10 }), threshold: 7, prompt: 'p' });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.out.verdicts, [{ id: 0, verdict: 'breach' }]);
});

test('an ENTAILMENT call hands back the raw verbatim text for entailment.js\'s own second gate', async () => {
  const llmCall = seam.buildLlmCall({ providers: [fakeProvider('{"verdict":"entailment"}')] });
  const out = await llmCall({ schema: ENTAILMENT_SCHEMA, allowedSourceIds: [], sources: {}, prompt: 'p' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.text, '{"verdict":"entailment"}');
});

test('KNOWN-BAD calibration: an unparseable adjudication reply loses the rubric gate; the chain exhausts to ok:false', async () => {
  const llmCall = seam.buildLlmCall({ providers: [fakeProvider('sorry, I cannot produce JSON')] });
  const out = await llmCall({ rubric: () => ({ score: 10 }), threshold: 7, prompt: 'p' });
  assert.strictEqual(out.ok, false, 'a fluent-but-unparseable answer is refused, never coerced (Rule 11)');
});

test('KNOWN-BAD: an entailment reply citing an OUT-OF-SET source_id is rejected by the gate (Rule 12 gate 1)', () => {
  const validate = seam.entailmentValidator({ schema: ENTAILMENT_SCHEMA, allowedSourceIds: ['S1'], sources: { S1: 'the source text' } });
  const good = validate('{"verdict":"entailment"}');
  assert.strictEqual(good.ok, true);
  const fabricated = validate('{"verdict":"entailment","source_id":"FAKE_AUTHORITY"}');
  assert.strictEqual(fabricated.ok, false, 'a fabricated citation is unrepresentable (escape probability zero, not small)');
});

test('the rubric gate rejects a below-threshold score and a hard_fail (deterministic, never model self-confidence)', () => {
  const below = seam.rubricValidator({ rubric: () => ({ score: 3 }), threshold: 7 })('{"verdicts":[]}');
  assert.strictEqual(below.ok, false);
  const hard = seam.rubricValidator({ rubric: () => ({ score: 10, hard_fail: true }), threshold: 7 })('{"verdicts":[]}');
  assert.strictEqual(hard.ok, false);
  const pass = seam.rubricValidator({ rubric: () => ({ score: 8 }), threshold: 7 })('{"verdicts":[{"id":0}]}');
  assert.strictEqual(pass.ok, true);
});

test('the per-call deadline is a CAP, never a floor (a request may ask for shorter, never longer)', () => {
  assert.strictEqual(seam.deadlineFor({ deadline_ms: 5000 }, 20000), 5000);
  assert.strictEqual(seam.deadlineFor({ deadline_ms: 999999 }, 20000), 20000);
  assert.strictEqual(seam.clampDeadline(999999), seam.MAX_DEADLINE_MS);
  assert.strictEqual(seam.clampDeadline(0), seam.DEFAULT_DEADLINE_MS);
});

test('an empty provider chain is a fail-closed abstain, never a fabricated answer', async () => {
  const llmCall = seam.buildLlmCall({ providers: [] });
  const out = await llmCall({ rubric: () => ({ score: 10 }), prompt: 'p' });
  assert.strictEqual(out.ok, false);
});
