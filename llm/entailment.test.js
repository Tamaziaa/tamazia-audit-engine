'use strict';
// llm/entailment.test.js - GATE 3 (Rule 12 gate 3). Hostile, scripted-fake tests: neutral verdicts,
// contradiction, garbage, out-of-set citation, timeout and throw must ALL abstain (ok:false); only a
// clean gate-valid 'entailment' is ok:true. No network: llmCall is a scripted function.

const test = require('node:test');
const assert = require('node:assert');

const { checkEntailment, ENTAILMENT, ABSTAIN_LABEL } = require('./entailment.js');

const PREMISE = 'Authorised and regulated by the Financial Conduct Authority, firm reference 123456.';
const CLAIM = { claim: 'the firm is authorised by the FCA', premise_source_id: 'src-1', premise: PREMISE };

// scripted(reply): an injected llmCall that ignores the request and returns a fixed reply. `reply`
// may be a JSON string, an object, or a function of the request. This is the scripted-fake provider.
function scripted(reply) {
  return async () => (typeof reply === 'function' ? reply() : reply);
}

// jsonReply(verdict, sourceId): a well-formed NLI reply JSON string citing sourceId (default src-1).
function jsonReply(verdict, sourceId) {
  return JSON.stringify({ source_id: sourceId || 'src-1', verdict, rationale: 'test' });
}

test('a clean ENTAILMENT verdict is the only path to ok:true', async () => {
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted(jsonReply('entailment')) });
  assert.equal(r.verdict, ENTAILMENT);
  assert.equal(r.ok, true);
  assert.equal(r.premise_source_id, 'src-1');
});

test('a NEUTRAL verdict (fluent but unsupported) abstains -> ok:false', async () => {
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted(jsonReply('neutral')) });
  assert.equal(r.verdict, 'neutral');
  assert.equal(r.ok, false);
});

test('a CONTRADICTION verdict abstains -> ok:false', async () => {
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted(jsonReply('contradiction')) });
  assert.equal(r.verdict, 'contradiction');
  assert.equal(r.ok, false);
});

test('garbage (non-JSON) is refused by the gate -> abstain (never coerced)', async () => {
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted('the answer is definitely entailment, trust me') });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, ABSTAIN_LABEL);
});

test('an OUT-OF-SET source_id is hard-rejected by gate 1 even with an entailment label', async () => {
  // the model claims entailment but cites a source_id that was never in the retrieval set.
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted(jsonReply('entailment', 'fabricated-99')) });
  assert.equal(r.ok, false, 'a fabricated citation cannot ride an entailment label to ok:true');
  assert.match(r.reason, /gate rejected/);
});

test('a label outside the closed enum abstains (schema-invalid)', async () => {
  const [r] = await checkEntailment([CLAIM], { llmCall: scripted(JSON.stringify({ source_id: 'src-1', verdict: 'probably_yes' })) });
  assert.equal(r.ok, false);
});

test('a TIMEOUT (a caller that never settles) abstains under the hard deadline (Rule 9)', async () => {
  const neverSettles = () => new Promise(() => {});
  const [r] = await checkEntailment([CLAIM], { llmCall: neverSettles, deadlineMs: 25 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /deadline/);
});

test('a THROWING caller abstains, never throws into the mint (Rule 4)', async () => {
  const throws = () => { throw new Error('provider exploded'); };
  const [r] = await checkEntailment([CLAIM], { llmCall: throws });
  assert.equal(r.ok, false);
  assert.match(r.reason, /threw/);
});

test('a claim with no premise/source_id abstains WITHOUT calling the model', async () => {
  let called = false;
  const spy = async () => { called = true; return jsonReply('entailment'); };
  const [r] = await checkEntailment([{ claim: 'unsupported floating claim' }], { llmCall: spy });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'no premise -> nothing to entail -> the model is never consulted');
});

test('no llmCall injected -> every claim abstains (Rule 12 gate 4)', async () => {
  const [r] = await checkEntailment([CLAIM], {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no llmCall/);
});

test('filter-only: |result| === |claims|, in order, and the array is built from the INPUT', async () => {
  const claims = [
    { claim: 'a', premise_source_id: 's1', premise: 'alpha premise text' },
    { claim: 'b', premise_source_id: 's2', premise: 'beta premise text' },
    { claim: 'c', premise_source_id: 's3', premise: 'gamma premise text' },
  ];
  // a hostile caller that tries to return verdicts for ids it invents cannot add or drop a claim:
  // each call is per-claim and cites that claim's own source_id.
  const llmCall = (req) => Promise.resolve(JSON.stringify({ source_id: req.allowedSourceIds[0], verdict: 'entailment' }));
  const out = await checkEntailment(claims, { llmCall });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.premise_source_id), ['s1', 's2', 's3']);
  assert.ok(out.every((r) => r.ok === true));
});

test('a non-array claims input yields an empty result (never throws)', async () => {
  assert.deepEqual(await checkEntailment(null, { llmCall: scripted(jsonReply('entailment')) }), []);
});
