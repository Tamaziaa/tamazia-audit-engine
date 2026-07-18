'use strict';
// breach/adjudicator/adjudicate.test.js - node:test for the breach adjudication gate.
// Run: node --test breach/adjudicator/adjudicate.test.js
//
// Drives adjudicate() with SCRIPTED fake llmCall callers (hostile, garbage, hanging, throwing, honest).
// No real network or LLM runs here (the injected-caller contract).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { adjudicate, ctxFromBundle, verdictsFrom } = require('./adjudicate.js');

// ── fakes ─────────────────────────────────────────────────────────────────────────────────────────────
// The scripted caller serves TWO request types: the adjudication call (has a `rubric`, no `schema`) and
// the Rule-12 gate-3 NLI call (has a `schema` + allowedSourceIds - checkEntailment). For an NLI request
// it cites the one allowed premise source_id and returns the scripted label (default 'entailment', so a
// breach verdict stays a violation unless a test overrides `nli`).
function nliReply(request, nli) {
  const sid = (request && request.allowedSourceIds && request.allowedSourceIds[0]) || 'S';
  return JSON.stringify({ source_id: sid, verdict: nli || 'entailment' });
}
function gate(verdicts, nli) { return async (request) => (request && request.schema ? nliReply(request, nli) : { ok: true, out: { verdicts } }); }
function bareGate(verdicts, nli) { return async (request) => (request && request.schema ? nliReply(request, nli) : { verdicts }); }
const HANG = () => new Promise(() => {});                                                 // never settles
function textCand(over) {
  return Object.assign({ code: 'T', framework: 'FW', description: 'the obligation',
    evidence_quote: 'we defend clients accused of fraud as a practice area', artifact: { type: 'corpus_quote' },
    evidence_url: 'https://firm.test/practice' }, over || {});
}
function observedCand(over) {
  return Object.assign({ code: 'O', framework: 'FW', description: 'non-essential cookie before consent',
    artifact: { type: 'cookie_jar_entry' } }, over || {});
}
const BUNDLE = { domain: 'firm.test', sector: 'law-firms', country: 'UK' };

async function stateOf(candidate, opts) {
  const { findings } = await adjudicate([candidate], BUNDLE, opts);
  return findings[0].state;
}

// ── observed / register facts bypass the model entirely (C-084) ─────────────────────────────────────────
test('an observed browser fact ships as a violation WITHOUT any llmCall (bypass, C-084)', async () => {
  const { findings, report } = await adjudicate([observedCand()], BUNDLE, {});
  assert.equal(findings[0].state, 'violation');
  assert.equal(findings[0].adjudicated, true);
  assert.equal(findings[0].adjudication, 'observed_fact');
  assert.equal(report.observed_fact, 1);
});

test('a register-row fact bypasses to a violation too', async () => {
  assert.equal(await stateOf({ code: 'R', description: 'not on the ICO register', artifact: { type: 'register_row' } }, {}), 'violation');
});

test('CANONICAL: a real network_event observation bypasses to a violation (the C-084 mismatch is closed)', async () => {
  const cookie = { code: 'PECR', description: 'non-essential cookie before consent',
    artifact: { type: 'network_event', kind: 'cookie_pre_consent', host: 'ga.example', name: '_ga' } };
  const { findings, report } = await adjudicate([cookie], BUNDLE, {});
  assert.equal(findings[0].state, 'violation');
  assert.equal(findings[0].adjudication, 'observed_fact');
  assert.equal(report.observed_fact, 1);
});

test('CANONICAL: a register_absence is quarantined to needs_review, never a bypassed hard violation (Rule 6)', async () => {
  const absent = { code: 'SRA', description: 'firm does not appear on the SRA register',
    artifact: { type: 'register_absence', register: 'sra', lane: 'no_match' } };
  // No llmCall: a text-class candidate abstains to needs_review; it must never bypass to violation.
  assert.equal(await stateOf(absent, {}), 'needs_review');
});

test('the hostile model cannot "no_breach" away an observed fact (it never sees it)', async () => {
  // Even a caller that returns no_breach for everything cannot touch the bypassed observation.
  const state = await stateOf(observedCand(), { llmCall: gate([{ id: 0, verdict: 'no_breach', disproof: 'irrelevant span' }]) });
  assert.equal(state, 'violation');
});

// ── the abstain floor: a text candidate becomes a violation ONLY on an explicit breach verdict ──────────
test('no llmCall injected -> every text candidate abstains to needs_review (Rule 12 gate 4)', async () => {
  const { findings, report } = await adjudicate([textCand()], BUNDLE, {});
  assert.equal(findings[0].state, 'needs_review');
  assert.equal(findings[0].adjudicated, false);
  assert.equal(report.llm_available, false);
});

test('a valid breach verdict -> violation', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'breach', reason: 'prohibited claim present' }]) }), 'violation');
});

// ── Rule 12 GATE 3 (NLI entailment): a breach only ships if the verified quote entails the claim ────────
test('GATE 3: a breach whose verified quote does NOT entail the claim is DEMOTED to needs_review (nli:neutral)', async () => {
  const { findings } = await adjudicate([textCand()], BUNDLE, { llmCall: gate([{ id: 0, verdict: 'breach' }], 'neutral') });
  assert.equal(findings[0].state, 'needs_review', 'a neutral NLI verdict must never ship as a violation (Rule 12 gate 3)');
  assert.equal(findings[0].adjudication, 'nli_demoted');
  assert.match(findings[0].adjudication_reason, /^nli:neutral/);
});

test('GATE 3: a contradiction NLI verdict also demotes to needs_review', async () => {
  const state = await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'breach' }], 'contradiction') });
  assert.equal(state, 'needs_review');
});

test('GATE 3: a breach whose verified quote ENTAILS the claim stays a violation', async () => {
  const { findings } = await adjudicate([textCand()], BUNDLE, { llmCall: gate([{ id: 0, verdict: 'breach' }], 'entailment') });
  assert.equal(findings[0].state, 'violation');
  assert.equal(findings[0].adjudicated, true);
  assert.equal(findings[0].adjudication, 'breach');
});

test('GATE 3: the default scripted gate answers NLI with entailment, so a breach ships as a violation', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'breach' }]) }), 'violation');
});

test('a valid no_breach WITH a verbatim disproof -> pass', async () => {
  const state = await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'no_breach', disproof: 'practice area' }]) });
  assert.equal(state, 'pass');
});

test('a no_breach WITHOUT a disproof -> needs_review, never pass', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'no_breach' }]) }), 'needs_review');
});

test('an insufficient verdict -> needs_review', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'insufficient' }]) }), 'needs_review');
});

test('a caller that THROWS -> the batch abstains, adjudicate never throws (Rule 4/9)', async () => {
  const { findings, report } = await adjudicate([textCand()], BUNDLE, { llmCall: async () => { throw new Error('provider down'); } });
  assert.equal(findings[0].state, 'needs_review');
  assert.equal(report.batches[0].ranOk, false);
});

test('a caller that HANGS -> abstains in bounded wall time (deadline, Rule 9 / C-040)', async () => {
  const started = Date.now();
  const state = await stateOf(textCand(), { llmCall: HANG, deadlineMs: 40 });
  assert.equal(state, 'needs_review');
  assert.ok(Date.now() - started < 2000, 'a hanging caller was not bounded by the deadline');
});

test('a caller returning ok:false, or no verdicts array, -> abstain', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: async () => ({ ok: false, out: null }) }), 'needs_review');
  assert.equal(await stateOf(textCand(), { llmCall: async () => ({ ok: true, out: {} }) }), 'needs_review');
  assert.equal(await stateOf(textCand(), { llmCall: async () => 'garbage' }), 'needs_review');
});

// ── FILTER-ONLY: the structural safety property ─────────────────────────────────────────────────────────
test('FILTER-ONLY: an invented verdict id cannot inject a finding (|output|==|input|)', async () => {
  const input = [textCand({ code: 'REAL' })];
  const { findings } = await adjudicate(input, BUNDLE, {
    llmCall: gate([
      { id: 0, verdict: 'insufficient' },
      { id: 42, verdict: 'breach', code: 'INJECTED', reason: 'fabricated' },
    ]),
  });
  assert.equal(findings.length, 1, 'the invented id:42 finding must not appear');
  assert.equal(findings[0].code, 'REAL');
  assert.ok(!/INJECTED|fabricated/.test(JSON.stringify(findings)));
});

test('FILTER-ONLY: a valid in-range id that maps to a real candidate is applied (adjudication, not invention)', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'breach' }]) }), 'violation');
});

// ── evidence-kind routing: a masquerade is quarantined, never bypassed ──────────────────────────────────
test('a masqueraded candidate (declared observation, text artifact) -> needs_review, never bypassed', async () => {
  const c = textCand({ evidence_kind: 'observation' }); // claims to be an observed fact but carries a text quote
  const { findings, report } = await adjudicate([c], BUNDLE, { llmCall: gate([{ id: 0, verdict: 'breach' }]) });
  assert.equal(findings[0].state, 'needs_review');
  assert.equal(findings[0].adjudication, 'kind_rejected');
  assert.equal(report.rejected, 1);
});

test('a candidate with no artifact at all -> needs_review (Rule 3)', async () => {
  assert.equal(await stateOf({ code: 'X', description: 'no artifact' }, { llmCall: gate([{ id: 0, verdict: 'breach' }]) }), 'needs_review');
});

// ── contract: fields, purity, batching, both caller shapes ──────────────────────────────────────────────
test('every finding carries the adjudication fields; a pass carries its disproof', async () => {
  const { findings } = await adjudicate([textCand()], BUNDLE, { llmCall: gate([{ id: 0, verdict: 'no_breach', disproof: 'practice area' }]) });
  const f = findings[0];
  for (const k of ['state', 'adjudicated', 'adjudication', 'adjudication_reason']) assert.ok(k in f, 'missing field ' + k);
  assert.ok(typeof f.adjudication_disproof === 'string' && f.adjudication_disproof.length > 0);
});

test('adjudicate never mutates the input candidates', async () => {
  const input = [textCand()];
  const snapshot = JSON.stringify(input);
  await adjudicate(input, BUNDLE, { llmCall: gate([{ id: 0, verdict: 'breach' }]) });
  assert.equal(JSON.stringify(input), snapshot, 'the input array/objects must be untouched');
});

test('empty input -> empty findings, total 0', async () => {
  const { findings, report } = await adjudicate([], BUNDLE, {});
  assert.deepEqual(findings, []);
  assert.equal(report.total, 0);
});

test('batching: more than one batch of text candidates all get adjudicated', async () => {
  const input = Array.from({ length: 23 }, (_, i) => textCand({ code: 'T' + i }));
  // Return a breach for every batch-local id 0..9. The short final batch (3 candidates) receives ids
  // 3..9 that map to nothing - harmlessly ignored, which is itself the filter-only property. NLI
  // requests (Rule 12 gate 3) are answered with entailment so every breach survives to a violation.
  const llmCall = async (request) => (request && request.schema
    ? JSON.stringify({ source_id: (request.allowedSourceIds || ['S'])[0], verdict: 'entailment' })
    : { ok: true, out: { verdicts: Array.from({ length: 10 }, (_, i) => ({ id: i, verdict: 'breach' })) } });
  const { findings, report } = await adjudicate(input, BUNDLE, { llmCall });
  assert.equal(findings.length, 23);
  assert.equal(report.violation, 23);
  assert.ok(report.batches.length >= 3, 'expected >=3 batches of 10');
});

test('both caller return shapes are accepted (gate.js {ok,out:{verdicts}} and bare {verdicts})', async () => {
  assert.equal(await stateOf(textCand(), { llmCall: gate([{ id: 0, verdict: 'breach' }]) }), 'violation');
  assert.equal(await stateOf(textCand(), { llmCall: bareGate([{ id: 0, verdict: 'breach' }]) }), 'violation');
  assert.equal(verdictsFrom({ ok: false }), null);
  assert.deepEqual(verdictsFrom({ verdicts: [] }), []);
});

test('ctxFromBundle READS facts off the bundle without re-deriving them (Rule 1)', () => {
  assert.deepEqual(ctxFromBundle({ domain: 'a.test', sector: 'legal', country: 'UK' }), { domain: 'a.test', sector: 'legal', country: 'UK' });
  assert.deepEqual(ctxFromBundle({ facts: { domain: 'b.test' } }), { domain: 'b.test', sector: 'unknown', country: 'unknown' });
  assert.deepEqual(ctxFromBundle(null), { domain: 'unknown', sector: 'unknown', country: 'unknown' });
});

// ── the committed calibration fixture, exercised here so CI (npm test) runs it every time ───────────────
test('CALIBRATION p3-adjudicator-invented-finding: the hostile-caller trap is caught', async () => {
  const fixture = require(path.resolve(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures', 'p3-adjudicator-invented-finding.js'));
  const findings = await fixture.calibrate();
  assert.ok(findings.length > 0, 'the invented-finding trap MISSED: adjudicate is not structurally filter-only');
  assert.equal(findings[0].rule, 'p3-adjudicator-invented-finding');
});
