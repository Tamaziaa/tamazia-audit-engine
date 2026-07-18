'use strict';
// llm/entailment.test.js - GATE 3 (Rule 12 gate 3). Hostile, scripted-fake tests: neutral verdicts,
// contradiction, garbage, out-of-set citation, timeout and throw must ALL abstain (ok:false); only a
// clean gate-valid 'entailment' is ok:true. No network: llmCall is a scripted function.

const test = require('node:test');
const assert = require('node:assert');

const { checkEntailment, numOr, DEFAULT_DEADLINE_MS, ENTAILMENT, ABSTAIN_LABEL } = require('./entailment.js');

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

test('a claim with a premise + source_id but an EMPTY hypothesis abstains WITHOUT calling the model', async () => {
  // No proposition to entail. Without the !hypothesis guard, a bare 'entailment' reply would score
  // ok:true for nothing checked. Fail-closed: abstain and never consult the model (Rule 4).
  let called = false;
  const spy = async () => { called = true; return jsonReply('entailment'); };
  const [r] = await checkEntailment([{ claim: '', premise_source_id: 'src-1', premise: PREMISE }], { llmCall: spy });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'empty hypothesis -> nothing to entail -> the model is never consulted');
});

test('numOr clamps an over-large deadline override down to the hard cap and floors misconfig to the cap', () => {
  // A caller may ask for a SHORTER deadline, never a longer one (Rule 8/9: the cap is a ceiling).
  assert.equal(numOr(50, DEFAULT_DEADLINE_MS), 50, 'a shorter override is honoured');
  assert.equal(numOr(3600000, DEFAULT_DEADLINE_MS), DEFAULT_DEADLINE_MS, 'an hour-long override is clamped to the cap');
  assert.equal(numOr(DEFAULT_DEADLINE_MS + 1, DEFAULT_DEADLINE_MS), DEFAULT_DEADLINE_MS, 'one past the cap clamps to the cap');
  assert.equal(numOr('nonsense', DEFAULT_DEADLINE_MS), DEFAULT_DEADLINE_MS, 'a non-number falls back to the cap');
  assert.equal(numOr(0, DEFAULT_DEADLINE_MS), DEFAULT_DEADLINE_MS, 'a non-positive value falls back to the cap');
  assert.equal(numOr(-5, DEFAULT_DEADLINE_MS), DEFAULT_DEADLINE_MS, 'a negative value falls back to the cap');
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

// ── P3-tail Wave-2 resume: claim.candidate rides the llmCall request out-of-band, never the prompt ──
// breach/adjudicator/adjudicate.js's claimFor attaches candidate = { record_id, artifact } so the
// recorded-response replay adapter (eval/e2e/lib/replay-llm.js) can derive the frozen-contract
// entailment key on the (record_id, artifact) basis. It must reach the injected llmCall request and
// must NEVER appear in the model-facing prompt/system/sources (a live model must never see an internal
// id, and the recorded-response key must not depend on prompt text - C-211/C-222/C-134).
test('claim.candidate is passed onto the llmCall request as request.candidate, byte-for-byte', async () => {
  let seen = null;
  const spy = (req) => { seen = req; return Promise.resolve(jsonReply('entailment')); };
  const candidate = { record_id: 'UK_GDPR_ART5', artifact: { type: 'quote', text: 'we drop cookies before consent' } };
  const [r] = await checkEntailment([{ claim: 'the firm drops cookies before consent', premise_source_id: 'src-1', premise: PREMISE, candidate }], { llmCall: spy });
  assert.equal(r.ok, true);
  assert.ok(seen, 'the llmCall must have been invoked');
  assert.deepEqual(seen.candidate, candidate, 'request.candidate must carry the exact candidate ref');
});

test('claim.candidate NEVER leaks into the model-facing prompt/system/sources text', async () => {
  let seen = null;
  const spy = (req) => { seen = req; return Promise.resolve(jsonReply('entailment')); };
  const candidate = { record_id: 'SECRET-INTERNAL-RECORD-ID-XYZ', artifact: { type: 'quote', text: PREMISE } };
  await checkEntailment([{ claim: 'c', premise_source_id: 'src-1', premise: PREMISE, candidate }], { llmCall: spy });
  assert.ok(seen);
  assert.ok(!String(seen.prompt || '').includes('SECRET-INTERNAL-RECORD-ID-XYZ'), 'record_id must not appear in the prompt text');
  assert.ok(!String(seen.system || '').includes('SECRET-INTERNAL-RECORD-ID-XYZ'), 'record_id must not appear in the system text');
  assert.ok(!JSON.stringify(seen.sources || {}).includes('SECRET-INTERNAL-RECORD-ID-XYZ'), 'record_id must not appear in the sources map');
});

test('a claim with NO candidate leaves request.candidate unset (backward compatible; a direct caller is unaffected)', async () => {
  let seen = null;
  const spy = (req) => { seen = req; return Promise.resolve(jsonReply('entailment')); };
  await checkEntailment([CLAIM], { llmCall: spy }); // CLAIM carries no candidate
  assert.ok(seen);
  assert.equal('candidate' in seen, false, 'no candidate attached -> the field is simply absent, not undefined');
});
