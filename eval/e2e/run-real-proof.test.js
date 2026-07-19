'use strict';
// eval/e2e/run-real-proof.test.js - network-free tests for the reproduction-proof driver.
//   node --test eval/e2e/run-real-proof.test.js
//
// The driver's real-model path needs keys + network; these tests exercise its PURE composition,
// enrichment, attribution and recording-assembly helpers, plus a --dry (no-network) end-to-end run that
// locks the honest current reality (0 candidates reach the model on the committed fixtures).

const test = require('node:test');
const assert = require('node:assert');

const D = require('./run-real-proof.js');
const R = require('./lib/real-llm.js');
const { loadCatalogueRecords } = require('./lib/catalogue-records.js');

// ── arg parsing ──────────────────────────────────────────────────────────────────────────────────────
test('parseArgs reads the flags and rejects the unknown', () => {
  assert.deepStrictEqual(D.parseArgs(['node', 's', '--dry', '--clean', '--no-preflight', '--json']).opts,
    { json: true, clean: true, dry: true, preflight: false, domain: null, all: false });
  assert.strictEqual(D.parseArgs(['node', 's', '--all']).opts.all, true, '--all selects every reference firm (the multi-sector run)');
  assert.strictEqual(D.parseArgs(['node', 's', '--nope']).exitCode, 2);
});

// ── catalogue-faithful enrichment (Rule 2: facts from the catalogue ONLY) ─────────────────────────────
test('enrichCandidate lifts the catalogue obligation to description and the quote to evidence_quote', () => {
  const record = {
    id: 'R1', name: 'UK GDPR and Data Protection Act 2018',
    citation: { section: 'Arts 13/14', act: 'UK GDPR', url: 'https://x' },
    website_obligations: [{ duty: 'Publish an accessible privacy notice' }],
  };
  const cand = { record_id: 'R1', duty_idx: 0, artifact: { type: 'quote', text: 'we sell your data', surface: 'visible_text' }, page_url: 'https://x/p' };
  const f = D.enrichCandidate(cand, record);
  assert.strictEqual(f.description, 'Publish an accessible privacy notice', 'description is the obligation duty (briefOf adjudication prompt), not the Gate-3 hypothesis');
  assert.strictEqual(f.framework, 'UK GDPR and Data Protection Act 2018');
  assert.strictEqual(f.statutory_citation, 'Arts 13/14');
  assert.strictEqual(f.evidence_quote, 'we sell your data', 'the verified quote becomes the Gate-3 premise');
  assert.strictEqual(f.evidence_source_id, 'https://x/p');
  assert.strictEqual(f.record_id, 'R1', 'the candidate identity is preserved untouched');
  assert.strictEqual(typeof f.atomic_claim, 'string', 'a Gate-3 atomic_claim is stamped via the one door');
});
test('enrichCandidate never fabricates: a null record yields empty catalogue fields', () => {
  const f = D.enrichCandidate({ record_id: 'X', duty_idx: 0, artifact: { type: 'coverage_proof' } }, null);
  assert.strictEqual(f.framework, '');
  assert.strictEqual(f.description, '');
  assert.strictEqual(f.evidence_quote, undefined, 'a coverage_proof (absence) artifact has no quote premise');
});
test('dutyText falls back to the record name; citationText reads section/act/url in order', () => {
  assert.strictEqual(D.dutyText({ name: 'Some Law', website_obligations: [] }, 0), 'Some Law');
  assert.strictEqual(D.citationText({ citation: { act: 'Act X' } }), 'Act X');
  assert.strictEqual(D.citationText({}), '');
});
// The Gate-3 atomic-claim door (P3-tail Wave-2 FINAL UNIT): the enriched synthetic finding must carry the
// EXACT door-derived affirmative claim (the quote can entail it), distinct from the raw prohibition duty
// (which the quote contradicts - the U1 blocker). Identical to eval/e2e/lib/pipeline.js's stamp, so the
// driver and the engine path construct the SAME Gate-3 hypothesis.
test('enrichCandidate stamps the exact door-derived atomic_claim for the synthetic, distinct from the duty', async () => {
  const records = loadCatalogueRecords();
  const recIdx = D.recordIndex(records);
  const composed = await D.composeFirm(D.loadSyntheticFirm(), records, recIdx, null);
  const f = composed.enriched[0];
  assert.strictEqual(f.record_id, 'UK_MHRA_POM_AD_BAN');
  assert.strictEqual(f.atomic_claim, 'This website does advertise any prescription only medicine to the public',
    'the door inverts the prohibition duty to the affirmative breach claim the verbatim quote ENTAILS');
  assert.notStrictEqual(f.atomic_claim, f.description, 'the Gate-3 hypothesis is NOT the raw obligation duty (the U1 blocker)');
  assert.match(f.description, /^Do not advertise/, 'description stays the raw duty for the adjudication prompt');
});
// The Gate-3 SECOND premise (FINAL UNIT iteration 3, bridge-as-glossary): the enriched synthetic finding
// carries a `bridge` that is a DEFINITIONAL GLOSSARY of the rule's indirect-reference terms ("wrinkle-
// relaxing injections") so the NLI can resolve the indirect offending quote - WITHOUT the prohibition
// duty's leading "Do not ..." operator that primed the model's label inversion (U1 resume 4). Stamped from
// the full record via the same one door adjudicate.js uses (breach/adjudicator/claim.js bridgeTextFor).
test('enrichCandidate stamps the Gate-3 bridge premise carrying the indirect-reference text', async () => {
  const records = loadCatalogueRecords();
  const recIdx = D.recordIndex(records);
  const composed = await D.composeFirm(D.loadSyntheticFirm(), records, recIdx, null);
  const f = composed.enriched[0];
  assert.strictEqual(typeof f.bridge, 'string', 'a presence-breach finding carries a bridge second premise');
  assert.ok(f.bridge.includes('wrinkle-relaxing injections'), 'the bridge carries the rule\'s own indirect-reference term verbatim (the mapping the model was missing)');
  assert.notStrictEqual(f.bridge, f.description, 'iteration 3: the bridge is the GLOSSARY, not the full prohibition duty');
  assert.ok(!/do not|\bremove\b/i.test(f.bridge), 'the glossary bridge carries no deontic/removal operator (iteration 3)');
  // A non-presence (coverage_proof) candidate carries NO bridge (its hypothesis IS the duty).
  const abs = D.enrichCandidate({ record_id: 'X', duty_idx: 0, artifact: { type: 'coverage_proof' } }, { name: 'L', website_obligations: [{ duty: 'Publish X' }] });
  assert.strictEqual(abs.bridge, undefined, 'a coverage_proof (absence) candidate is not a presence-breach: no bridge');
});

// ── deciding-gate attribution (honest per-candidate WHY) ──────────────────────────────────────────────
test('decidingGate maps every adjudication outcome to an honest label', () => {
  assert.match(D.decidingGate({ adjudication: 'observed_fact' }), /bypass.*violation/);
  assert.match(D.decidingGate({ adjudication: 'breach' }), /entailment ok.*violation/);
  assert.match(D.decidingGate({ adjudication: 'nli_demoted', adjudication_reason: 'nli:neutral' }), /gate3.*neutral.*needs_review/);
  assert.match(D.decidingGate({ adjudication: 'unadjudicated' }), /gate4.*needs_review/);
  assert.match(D.decidingGate({ adjudication: 'insufficient' }), /insufficient.*needs_review/);
});

// ── recording assembly - keyed OUT-OF-BAND on the request's candidate refs (Builder B unification) ────
test('buildResponses keys an entailment call on request.candidate (record_id + artifact), no content-matching', () => {
  const artifact = { type: 'quote', text: 'we offer wrinkle-relaxing injections' };
  const ev = { event: 'real_llm_call', kind: 'entailment', ok: true, raw: '{"source_id":"https://x/","verdict":"entailment"}', provider: 'groq', model: 'm',
    request: { candidate: { record_id: 'UK_MHRA_POM_AD_BAN', artifact } } };
  const responses = D.buildResponses([ev]);
  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].kind, 'entailment');
  assert.strictEqual(responses[0].key, R.recordingKey('entailment', 'UK_MHRA_POM_AD_BAN', R.artifactFingerprint(artifact)),
    'the entailment key matches replay-llm.js candidateKey on the SAME (record_id, artifact) basis');
  assert.strictEqual(responses[0].meta.provider, 'groq');
});
test('buildResponses keys each adjudicate candidate on request.candidates and stores ITS OWN verdict (batch split by id)', () => {
  const a0 = { type: 'quote', text: 'q0' };
  const a1 = { type: 'coverage_proof', page_class: 'any' };
  const ev = { event: 'real_llm_call', kind: 'adjudicate', ok: true, provider: 'gemini', model: 'g',
    raw: '{"verdicts":[{"id":0,"verdict":"breach"},{"id":1,"verdict":"insufficient"}]}',
    request: { candidates: [{ id: 0, record_id: 'R0', artifact: a0 }, { id: 1, record_id: 'R1', artifact: a1 }] } };
  const responses = D.buildResponses([ev]);
  assert.strictEqual(responses.length, 2);
  const byKey = new Map(responses.map((r) => [r.key, r]));
  const k0 = R.recordingKey('adjudicate', 'R0', R.artifactFingerprint(a0));
  const k1 = R.recordingKey('adjudicate', 'R1', R.artifactFingerprint(a1));
  assert.ok(byKey.has(k0) && byKey.has(k1), 'each candidate keyed on its own (record_id, artifact)');
  assert.strictEqual(JSON.parse(byKey.get(k0).raw).verdict, 'breach', 'candidate 0 gets verdict id 0, not the batch head');
  assert.strictEqual(JSON.parse(byKey.get(k1).raw).verdict, 'insufficient', 'candidate 1 gets verdict id 1 (per-candidate split)');
});
test('buildResponses ignores failed (ok:false) calls - only real answers are recorded', () => {
  const ev = { event: 'real_llm_call', kind: 'adjudicate', ok: false, raw: null, request: { candidates: [{ id: 0, record_id: 'R', artifact: {} }] } };
  assert.deepStrictEqual(D.buildResponses([ev]), []);
});

// ── summarise ─────────────────────────────────────────────────────────────────────────────────────────
test('summarise counts reproduced known_breaches and contradictions across firms', () => {
  const firmResults = [
    { callCount: 2, responses: [{}, {}], judged: { contradiction: false, knownBreaches: [{ status: 'reproduced' }] } },
    { callCount: 0, responses: [], judged: { contradiction: true, knownBreaches: [{ status: 'missed' }] } },
  ];
  const s = D.summarise(firmResults);
  assert.strictEqual(s.reproduced, 1);
  assert.strictEqual(s.contradictions, 1);
  assert.strictEqual(s.totalCalls, 2);
  assert.strictEqual(s.recordedResponses, 2);
});

// ── composeFirm on the synthetic fixture: locks the NEW honest reality (Builder A's A3 fix) ────────────
// The control was replanted on the compiled prohibition spec UK_MHRA_POM_AD_BAN ("wrinkle-relaxing
// injections"), so EXACTLY ONE presence-breach quote candidate now survives propose+verify. A future
// regression to 0 (a suppressor eats the presence quote again) or 2+ (a stray candidate) fails loudly.
test('composeFirm on the synthetic fixture yields EXACTLY 1 real-artifact candidate: UK_MHRA_POM_AD_BAN (quote)', async () => {
  const records = loadCatalogueRecords();
  assert.ok(records.length > 0, 'the compiled catalogue must be present (npm run catalogue)');
  const recIdx = D.recordIndex(records);
  const firm = D.loadSyntheticFirm();
  const composed = await D.composeFirm(firm, records, recIdx, null); // null llmCall = structural dry run
  assert.strictEqual(composed.real.length, 1, 'exactly one presence-breach survives on the synthetic control');
  const cand = composed.real[0];
  assert.strictEqual(cand.record_id, 'UK_MHRA_POM_AD_BAN', 'the surviving candidate is the MHRA POM-advertising prohibition');
  assert.strictEqual(cand.artifact && cand.artifact.type, 'quote', 'it carries a verbatim quote artifact (presence-breach), not a coverage_proof');
  assert.strictEqual(composed.verified.length, 1, 'and it passes gate-2 verify (verbatim quote re-match)');
  // Under a null (dry) llmCall the model is never asked, so the one finding abstains to needs_review
  // (the fixture's own reproduced/missed doctrine); a real-model breach verdict flips it to violation.
  assert.strictEqual(composed.findings[0].state, 'needs_review', 'dry (no model) demotes to needs_review, never a fabricated violation');
});

// ── main --dry: end to end, no network, exits 1 (NOT PROVEN), writes no recordings ────────────────────
test('main --dry runs end to end, makes no network call, and exits 1 (honest NOT PROVEN)', async () => {
  const origLog = console.log; const origErr = console.error;
  console.log = () => {}; console.error = () => {};
  let code;
  try { code = await D.main(['node', 'run-real-proof.js', '--dry', '--no-preflight']); }
  finally { console.log = origLog; console.error = origErr; }
  assert.strictEqual(code, 1, '0 reproduced on the committed fixtures -> exit 1 (U1-B5 honest signal)');
});
