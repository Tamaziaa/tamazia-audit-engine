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
    { json: true, clean: true, dry: true, preflight: false, domain: null });
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
  assert.strictEqual(f.description, 'Publish an accessible privacy notice', 'the Gate-3 hypothesis comes from the catalogue duty');
  assert.strictEqual(f.framework, 'UK GDPR and Data Protection Act 2018');
  assert.strictEqual(f.statutory_citation, 'Arts 13/14');
  assert.strictEqual(f.evidence_quote, 'we sell your data', 'the verified quote becomes the Gate-3 premise');
  assert.strictEqual(f.evidence_source_id, 'https://x/p');
  assert.strictEqual(f.record_id, 'R1', 'the candidate identity is preserved untouched');
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

// ── deciding-gate attribution (honest per-candidate WHY) ──────────────────────────────────────────────
test('decidingGate maps every adjudication outcome to an honest label', () => {
  assert.match(D.decidingGate({ adjudication: 'observed_fact' }), /bypass.*violation/);
  assert.match(D.decidingGate({ adjudication: 'breach' }), /entailment ok.*violation/);
  assert.match(D.decidingGate({ adjudication: 'nli_demoted', adjudication_reason: 'nli:neutral' }), /gate3.*neutral.*needs_review/);
  assert.match(D.decidingGate({ adjudication: 'unadjudicated' }), /gate4.*needs_review/);
  assert.match(D.decidingGate({ adjudication: 'insufficient' }), /insufficient.*needs_review/);
});

// ── recording assembly (correlate a real call to the candidate(s) it covered) ─────────────────────────
function candFor() {
  return {
    record_id: 'R1', artifact: { type: 'quote', text: 'we guarantee you will win every case' },
    page_url: 'https://x/', evidence_source_id: 'https://x/',
    evidence_quote: 'we guarantee you will win every case', description: 'must not guarantee outcomes',
  };
}
test('buildResponses correlates an entailment call to its candidate by premise + source_id', () => {
  const ev = { event: 'real_llm_call', kind: 'entailment', ok: true, raw: '{"source_id":"https://x/","verdict":"entailment"}', provider: 'groq', model: 'm',
    request: { allowedSourceIds: ['https://x/'], sources: { 'https://x/': 'we guarantee you will win every case' } } };
  const responses = D.buildResponses([ev], [candFor()]);
  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].kind, 'entailment');
  assert.strictEqual(responses[0].key, R.recordingKey('entailment', 'R1', R.artifactFingerprint(candFor().artifact)));
  assert.strictEqual(responses[0].meta.provider, 'groq');
});
test('buildResponses correlates an adjudicate call to every candidate whose quote appears in the prompt', () => {
  const ev = { event: 'real_llm_call', kind: 'adjudicate', ok: true, raw: '{"verdicts":[{"id":0,"verdict":"breach"}]}', provider: 'gemini', model: 'g',
    request: { prompt: 'CANDIDATES: [{"id":0,"evidence":"we guarantee you will win every case"}]' } };
  const responses = D.buildResponses([ev], [candFor()]);
  assert.strictEqual(responses.length, 1);
  assert.strictEqual(responses[0].kind, 'adjudicate');
  assert.strictEqual(responses[0].key, R.recordingKey('adjudicate', 'R1', R.artifactFingerprint(candFor().artifact)));
});
test('buildResponses ignores failed (ok:false) calls - only real answers are recorded', () => {
  const ev = { event: 'real_llm_call', kind: 'adjudicate', ok: false, raw: null, request: { prompt: 'we guarantee you will win every case' } };
  assert.deepStrictEqual(D.buildResponses([ev], [candFor()]), []);
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

// ── composeFirm on the synthetic fixture, DRY (no model): locks the honest current reality ────────────
test('composeFirm on the synthetic fixture proposes candidates but 0 survive to a real artifact (the blocker)', async () => {
  const records = loadCatalogueRecords();
  assert.ok(records.length > 0, 'the compiled catalogue must be present (npm run catalogue)');
  const recIdx = D.recordIndex(records);
  const firm = D.loadSyntheticFirm();
  const composed = await D.composeFirm(firm, records, recIdx, null); // null llmCall = structural dry run
  assert.ok(composed.proposedTotal > 0, 'propose does emit candidates');
  assert.strictEqual(composed.real.length, 0, 'but 0 carry a real artifact on the committed fixture (all suppressed upstream)');
  assert.strictEqual(composed.findings.length, 0, 'so the adjudicator (and the model) is never reached');
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
