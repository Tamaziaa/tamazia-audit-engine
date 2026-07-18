'use strict';
// eval/e2e/lib/replay-llm.test.js - node:test coverage for the replay-side implementation of the
// frozen recorded-response contract (docs/P3-TAIL-ACCEPTANCE.md; caution.md C-211, C-236).
//
// Per C-211 ("never finalise a consumer against an assumed contract of a not-yet-landed sibling; ...
// hand-builds the candidate and does not require() the sibling"): every fixture here is hand-built.
// This file does NOT require() eval/e2e/lib/real-llm.js or read anything under
// eval/e2e/fixtures/recorded/ (U1's not-yet-final files) - it locks the REAL, already-landed shape of
// breach/adjudicator/adjudicate.js, llm/entailment.js and llm/gate.js instead, driving those real
// modules directly wherever practical.
//
//   node --test eval/e2e/lib/replay-llm.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  replayLlmCall, computeKey, fingerprintOf, adjudicateBriefKey, entailmentRequestKey,
  briefsFromAdjudicatePrompt, loadRecordingsDir, CONTRACT, DECLINE,
} = require('./replay-llm.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'replay-llm-test-'));
}

function writeRecordingFile(dir, filename, doc) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(doc));
}

function recordingDoc(responses) {
  return { contract: CONTRACT, engine: { providers: ['groq'], recorded_at: '2026-07-18T00:00:00Z', prompt_versions: {} }, responses };
}

// ---------------------------------------------------------------------------------------------------
// computeKey / fingerprintOf: the frozen contract's hash formula, exactly as documented.
// ---------------------------------------------------------------------------------------------------

test('computeKey: matches sha256(kind + "|" + rule_id + "|" + artifact_fingerprint) exactly', () => {
  const kind = 'adjudicate';
  const ruleId = 'UK_GDPR_ART5';
  const fp = 'abc123';
  const expected = crypto.createHash('sha256').update(kind + '|' + ruleId + '|' + fp, 'utf8').digest('hex');
  assert.strictEqual(computeKey(kind, ruleId, fp), expected);
});

test('computeKey: deterministic and sensitive to every field', () => {
  const a = computeKey('adjudicate', 'RULE-1', 'fp-1');
  const b = computeKey('adjudicate', 'RULE-1', 'fp-1');
  const c = computeKey('adjudicate', 'RULE-2', 'fp-1');
  const d = computeKey('entailment', 'RULE-1', 'fp-1');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(a, d);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('fingerprintOf: deterministic sha256 hex of the given text, empty-safe', () => {
  assert.strictEqual(fingerprintOf('hello'), fingerprintOf('hello'));
  assert.notStrictEqual(fingerprintOf('hello'), fingerprintOf('world'));
  assert.match(fingerprintOf(''), /^[0-9a-f]{64}$/);
  assert.match(fingerprintOf(undefined), /^[0-9a-f]{64}$/); // never throws on a missing field
});

// ---------------------------------------------------------------------------------------------------
// briefsFromAdjudicatePrompt: parsing the embedded CANDIDATES: block, exactly as
// breach/adjudicator/adjudicate.js's buildPrompt() frames it (read verbatim from that file's source -
// see replay-llm.js's header). Hand-built prompt strings only; adjudicate.js is not require()'d here.
// ---------------------------------------------------------------------------------------------------

function fakeAdjudicatePrompt(briefs) {
  return [
    'FIRM: example.test | SECTOR: unknown | COUNTRY: unknown',
    'For EACH candidate below return a verdict:',
    '',
    'HARD RULES:',
    '',
    'CANDIDATES:',
    JSON.stringify(briefs),
    '',
    'Return STRICT JSON only:',
    '{"verdicts":[]}',
  ].join('\n');
}

test('briefsFromAdjudicatePrompt: extracts the embedded briefs array from a well-formed prompt', () => {
  const briefs = [{ id: 0, obligation: 'x', law: 'y', kind: 'PRESENCE', evidence: 'z', page: 'p' }];
  const prompt = fakeAdjudicatePrompt(briefs);
  assert.deepStrictEqual(briefsFromAdjudicatePrompt(prompt), briefs);
});

test('briefsFromAdjudicatePrompt: a batch of several briefs all extract in order', () => {
  const briefs = [{ id: 0, law: 'A' }, { id: 1, law: 'B' }, { id: 2, law: 'C' }];
  assert.deepStrictEqual(briefsFromAdjudicatePrompt(fakeAdjudicatePrompt(briefs)), briefs);
});

test('briefsFromAdjudicatePrompt: fails closed to [] when the CANDIDATES: marker is absent', () => {
  assert.deepStrictEqual(briefsFromAdjudicatePrompt('no candidates block here at all'), []);
});

test('briefsFromAdjudicatePrompt: fails closed to [] when the trailing marker is absent', () => {
  assert.deepStrictEqual(briefsFromAdjudicatePrompt('CANDIDATES:\n[{"id":0}]\nno trailing marker'), []);
});

test('briefsFromAdjudicatePrompt: fails closed to [] on unparseable embedded JSON', () => {
  assert.deepStrictEqual(briefsFromAdjudicatePrompt('CANDIDATES:\n{not json\n\nReturn STRICT JSON only:\n{}'), []);
});

test('briefsFromAdjudicatePrompt: fails closed to [] when the embedded value is not an array', () => {
  assert.deepStrictEqual(briefsFromAdjudicatePrompt('CANDIDATES:\n{"id":0}\n\nReturn STRICT JSON only:\n{}'), []);
});

test('briefsFromAdjudicatePrompt: null/undefined/non-string prompt never throws', () => {
  assert.deepStrictEqual(briefsFromAdjudicatePrompt(null), []);
  assert.deepStrictEqual(briefsFromAdjudicatePrompt(undefined), []);
  assert.deepStrictEqual(briefsFromAdjudicatePrompt(42), []);
});

// ---------------------------------------------------------------------------------------------------
// adjudicateBriefKey / entailmentRequestKey: deriving (rule_id, artifact_fingerprint) from what the
// adjudication path actually exposes.
// ---------------------------------------------------------------------------------------------------

test('adjudicateBriefKey: same (law, evidence, page) -> same key; any field changing -> a different key', () => {
  const base = { law: 'UK GDPR', evidence: 'VERBATIM FROM THE SITE: "we sell your data"', page: 'https://x.test/privacy' };
  const k1 = adjudicateBriefKey(base);
  const k2 = adjudicateBriefKey({ ...base });
  const k3 = adjudicateBriefKey({ ...base, law: 'PECR' });
  const k4 = adjudicateBriefKey({ ...base, evidence: 'different quote' });
  const k5 = adjudicateBriefKey({ ...base, page: 'https://x.test/other' });
  assert.strictEqual(k1, k2);
  assert.notStrictEqual(k1, k3);
  assert.notStrictEqual(k1, k4);
  assert.notStrictEqual(k1, k5);
});

test('adjudicateBriefKey: tolerates a missing/undefined brief without throwing', () => {
  assert.doesNotThrow(() => adjudicateBriefKey(undefined));
  assert.doesNotThrow(() => adjudicateBriefKey({}));
});

test('entailmentRequestKey: derived from allowedSourceIds[0] + sources[thatId], deterministic', () => {
  const req = { allowedSourceIds: ['https://x.test/p'], sources: { 'https://x.test/p': 'we drop cookies before consent' } };
  const k1 = entailmentRequestKey(req);
  const k2 = entailmentRequestKey({ allowedSourceIds: ['https://x.test/p'], sources: { 'https://x.test/p': 'we drop cookies before consent' } });
  const k3 = entailmentRequestKey({ allowedSourceIds: ['https://x.test/OTHER'], sources: { 'https://x.test/OTHER': 'we drop cookies before consent' } });
  assert.strictEqual(k1, k2);
  assert.notStrictEqual(k1, k3);
});

test('entailmentRequestKey: an empty/malformed request never throws and yields a stable key', () => {
  assert.doesNotThrow(() => entailmentRequestKey({}));
  assert.doesNotThrow(() => entailmentRequestKey(null));
  assert.strictEqual(entailmentRequestKey({}), entailmentRequestKey({ allowedSourceIds: [] }));
});

// ---------------------------------------------------------------------------------------------------
// loadRecordingsDir: reading the committed recordings directory.
// ---------------------------------------------------------------------------------------------------

test('loadRecordingsDir: a missing directory yields an empty Map, never throws', () => {
  const map = loadRecordingsDir(path.join(tmpDir(), 'does-not-exist'));
  assert.strictEqual(map.size, 0);
});

test('loadRecordingsDir: null/undefined dir yields an empty Map', () => {
  assert.strictEqual(loadRecordingsDir(null).size, 0);
  assert.strictEqual(loadRecordingsDir(undefined).size, 0);
});

test('loadRecordingsDir: loads every response across every *.json file in the directory', () => {
  const dir = tmpDir();
  writeRecordingFile(dir, 'a.test.json', recordingDoc([{ key: 'key-a', kind: 'adjudicate', raw: '{}', meta: null }]));
  writeRecordingFile(dir, 'b.test.json', recordingDoc([{ key: 'key-b', kind: 'entailment', raw: '{}', meta: null }]));
  const map = loadRecordingsDir(dir);
  assert.strictEqual(map.size, 2);
  assert.ok(map.has('key-a'));
  assert.ok(map.has('key-b'));
});

test('loadRecordingsDir: throws loudly on a file that is not valid JSON (never a silent skip, C-037)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'broken.json'), 'not json{{{');
  assert.throws(() => loadRecordingsDir(dir), /unreadable recording file/);
});

test('loadRecordingsDir: throws loudly on the wrong contract version', () => {
  const dir = tmpDir();
  writeRecordingFile(dir, 'wrong.json', { contract: 'recorded-llm.v0', responses: [] });
  assert.throws(() => loadRecordingsDir(dir), /does not declare contract/);
});

test('loadRecordingsDir: throws loudly on a response entry with no string key', () => {
  const dir = tmpDir();
  writeRecordingFile(dir, 'keyless.json', recordingDoc([{ kind: 'adjudicate', raw: '{}' }]));
  assert.throws(() => loadRecordingsDir(dir), /response entry with no string key/);
});

// ---------------------------------------------------------------------------------------------------
// replayLlmCall: the (request) => Promise<response> factory, direct unit behaviour (hit/decline for
// both kinds), in isolation from the real adjudicator.
// ---------------------------------------------------------------------------------------------------

test('replayLlmCall: an adjudicate-kind request with NO matching brief key declines the whole call', async () => {
  const dir = tmpDir(); // empty: nothing recorded
  const llmCall = replayLlmCall(dir);
  const prompt = fakeAdjudicatePrompt([{ id: 0, law: 'UK GDPR', evidence: 'quote', page: 'https://x.test/p' }]);
  const res = await llmCall({ prompt });
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: an adjudicate-kind request with a matching brief key returns a verdict for that id', async () => {
  const dir = tmpDir();
  const brief = { id: 0, law: 'UK GDPR', evidence: 'quote text', page: 'https://x.test/p' };
  const key = adjudicateBriefKey(brief);
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key, kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'matches', disproof: null }), meta: null },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([brief]) });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.out.verdicts.length, 1);
  assert.strictEqual(res.out.verdicts[0].verdict, 'breach');
  assert.strictEqual(res.out.verdicts[0].id, 0, 'id is remapped to the CURRENT batch position');
});

test('replayLlmCall: within one batch, a hit and a miss coexist - the miss gets no verdict entry (per-candidate fail-closed, not whole-batch)', async () => {
  const dir = tmpDir();
  const briefHit = { id: 0, law: 'UK GDPR', evidence: 'quote text', page: 'https://x.test/p' };
  const briefMiss = { id: 1, law: 'PECR', evidence: 'other quote', page: 'https://x.test/q' };
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key: adjudicateBriefKey(briefHit), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'matches', disproof: null }) },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([briefHit, briefMiss]) });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.out.verdicts.length, 1, 'only the recorded candidate gets a verdict entry; the missing one is simply absent, so the adjudicator abstains just that id');
  assert.strictEqual(res.out.verdicts[0].id, 0);
});

test('replayLlmCall: an adjudicate-kind request whose prompt has no parseable CANDIDATES block declines', async () => {
  const llmCall = replayLlmCall(tmpDir());
  const res = await llmCall({ prompt: 'nothing recognisable here' });
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: an entailment-kind request with a matching key returns the recorded verdict', async () => {
  const dir = tmpDir();
  const request = {
    schema: { properties: { verdict: { enum: ['entailment', 'neutral', 'contradiction'] } } },
    allowedSourceIds: ['https://x.test/p'],
    sources: { 'https://x.test/p': 'the premise text' },
  };
  const key = entailmentRequestKey(request);
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key, kind: 'entailment', raw: JSON.stringify({ source_id: 'https://x.test/p', verdict: 'entailment', rationale: 'ok' }) },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall(request);
  assert.strictEqual(res.source_id, 'https://x.test/p');
  assert.strictEqual(res.verdict, 'entailment');
});

test('replayLlmCall: an entailment-kind request with NO matching key declines', async () => {
  const llmCall = replayLlmCall(tmpDir());
  const request = {
    schema: { properties: { verdict: { enum: ['entailment', 'neutral', 'contradiction'] } } },
    allowedSourceIds: ['https://x.test/nope'],
    sources: { 'https://x.test/nope': 'unrecorded premise' },
  };
  const res = await llmCall(request);
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: recordings are loaded once per factory call (a second, unrelated dir does not leak in)', async () => {
  const dirA = tmpDir();
  const brief = { id: 0, law: 'UK GDPR', evidence: 'quote text', page: 'https://x.test/p' };
  writeRecordingFile(dirA, 'rec.json', recordingDoc([
    { key: adjudicateBriefKey(brief), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'x', disproof: null }) },
  ]));
  const dirB = tmpDir(); // empty
  const llmCallA = replayLlmCall(dirA);
  const llmCallB = replayLlmCall(dirB);
  const req = { prompt: fakeAdjudicatePrompt([brief]) };
  assert.strictEqual((await llmCallA(req)).ok, true);
  assert.deepStrictEqual(await llmCallB(req), DECLINE);
});

// ---------------------------------------------------------------------------------------------------
// U2-B1: end-to-end against the REAL, unmodified breach/adjudicator/adjudicate.js (and, as a sanity
// check, breach/verifiers/ too) - a hand-built candidate approved by a hand-built recording reproduces
// as a genuine 'violation', through the real adjudicator, the real Rule-12-gate-3 entailment call, and
// the real llm/gate.js structural gate. This is the hermetic proof docs/P3-TAIL-ACCEPTANCE.md U2-B1
// asks for: "a hand-built recording approving the synthetic breach lets a replay run reproduce >= 1".
//
// The candidate below carries BOTH breach/proposers/propose.js's real candidate() fields (record_id,
// duty_idx, evidence_type, kind, artifact, page_url, confidence_hint, suppressed_reason) AND the
// fields breach/adjudicator/adjudicate.js's briefOf()/evidenceText()/claimFor() actually read
// (description, framework, evidence_quote, evidence_url) - the latter group is NOT produced by the
// real, landed propose.js today (grep-verified: statutory_citation/evidence_quote/checked_urls appear
// nowhere in breach/ or evidence/ except this adjudicate.js reader and one calibration fixture), so a
// REAL end-to-end run would hand the model a constant, near-empty brief regardless of which rule
// fired. That gap is documented in replay-llm.js's own header and routed to Rob (C-214); it is not
// this unit's file to fix (propose.js/adjudicate.js are engine modules). Hand-adding those fields here
// is exactly the C-211 discipline: this test does not require() propose.js's wiring, it locks the
// REAL shape adjudicate.js's prompt-builder already reads.
test('U2-B1: a hand-built recording approving a hand-built candidate reproduces as violation through the REAL adjudicator', async (t) => {
  const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');
  const { verifyCandidate } = require('../../../breach/verifiers/index.js');

  const bundle = {
    domain: 'replay-hermetic.test',
    corpus: {
      pages: [{
        url: 'https://replay-hermetic.test/claims',
        text: 'ReplayCo helps clients with disputes. We guarantee you will win every case, no exceptions, or your money back.',
      }],
      footerText: 'ReplayCo Ltd. Company number 00000001.',
    },
    registers: {},
  };

  const candidate = {
    // breach/proposers/propose.js's real candidate() shape:
    record_id: 'REPLAY-TEST-RULE',
    duty_idx: 0,
    evidence_type: 'absence',
    kind: 'presence-breach',
    artifact: { type: 'quote', text: 'We guarantee you will win every case, no exceptions', surface: 'visible_text', page_url: 'https://replay-hermetic.test/claims' },
    page_url: 'https://replay-hermetic.test/claims',
    confidence_hint: 'strong',
    suppressed_reason: null,
    // fields adjudicate.js's briefOf()/evidenceText()/claimFor() read (see this test's header comment):
    description: 'Guarantee-of-outcome claim for legal services (synthetic test obligation, harness self-test only, not a real law).',
    framework: 'synthetic replay-llm test framework (harness self-test only)',
    evidence_quote: 'We guarantee you will win every case, no exceptions',
    evidence_url: 'https://replay-hermetic.test/claims',
  };

  // Sanity check: this candidate is also genuinely verify-passing (Rule 3/Gate 2), not only
  // something adjudicate.js happens to accept.
  const verified = verifyCandidate(candidate, bundle);
  assert.strictEqual(verified.verified, true, 'the hand-built candidate must genuinely verify: ' + verified.reason);

  // What breach/adjudicator/adjudicate.js's OWN briefOf()/briefLaw() will derive from this candidate
  // (hand-computed here per C-211, matching that file's read-only source exactly - see replay-llm.js's
  // header): law = framework (statutory_citation is unset); evidence = the verbatim-quote framing;
  // page = evidence_url.
  const expectedBrief = {
    law: 'synthetic replay-llm test framework (harness self-test only)',
    evidence: 'VERBATIM FROM THE SITE: "We guarantee you will win every case, no exceptions"',
    page: 'https://replay-hermetic.test/claims',
  };
  const adjudicateKey = adjudicateBriefKey(expectedBrief);

  // What llm/entailment.js's callModel() will build for the gate-3 NLI call after a 'breach' verdict:
  // allowedSourceIds[0] = evidence_url (claimFor's premiseSourceId reads evidence_url before
  // artifact.page_url); sources[thatId] = evidence_quote (claimFor's premiseQuote reads it directly).
  const entailmentKey = entailmentRequestKey({
    allowedSourceIds: ['https://replay-hermetic.test/claims'],
    sources: { 'https://replay-hermetic.test/claims': 'We guarantee you will win every case, no exceptions' },
  });

  const dir = tmpDir();
  writeRecordingFile(dir, 'replay-hermetic.test.json', recordingDoc([
    {
      key: adjudicateKey,
      kind: 'adjudicate',
      raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'guarantees a case outcome', disproof: null }),
      meta: { provider: 'hermetic-test', model: 'hand-built' },
    },
    {
      key: entailmentKey,
      kind: 'entailment',
      raw: JSON.stringify({ source_id: 'https://replay-hermetic.test/claims', verdict: 'entailment', rationale: 'the quoted text asserts a guaranteed outcome' }),
      meta: { provider: 'hermetic-test', model: 'hand-built' },
    },
  ]));

  const llmCall = replayLlmCall(dir);
  const { findings, report } = await adjudicate([candidate], bundle, { llmCall });

  await t.test('the finding reproduces as a genuine violation', () => {
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].state, 'violation', 'adjudication_reason: ' + findings[0].adjudication_reason);
    assert.strictEqual(findings[0].adjudicated, true);
  });
  await t.test('the adjudicator report shows the LLM was available and the batch ran', () => {
    assert.strictEqual(report.llm_available, true);
    assert.strictEqual(report.violation, 1);
  });
});

test('U2-B1 (decline direction): the SAME candidate with NO recording present abstains to needs_review, never a fabricated violation', async () => {
  const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');
  const bundle = {
    domain: 'replay-hermetic-miss.test',
    corpus: { pages: [{ url: 'https://replay-hermetic-miss.test/claims', text: 'We guarantee you will win every case, no exceptions.' }] },
  };
  const candidate = {
    record_id: 'REPLAY-TEST-RULE', evidence_type: 'absence', kind: 'presence-breach',
    artifact: { type: 'quote', text: 'We guarantee you will win every case, no exceptions', surface: 'visible_text', page_url: 'https://replay-hermetic-miss.test/claims' },
    page_url: 'https://replay-hermetic-miss.test/claims',
    description: 'Guarantee-of-outcome claim.', framework: 'synthetic replay-llm test framework (harness self-test only)',
    evidence_quote: 'We guarantee you will win every case, no exceptions', evidence_url: 'https://replay-hermetic-miss.test/claims',
  };
  const llmCall = replayLlmCall(tmpDir()); // empty: nothing recorded
  const { findings } = await adjudicate([candidate], bundle, { llmCall });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].state, 'needs_review');
  assert.notStrictEqual(findings[0].state, 'violation');
});
