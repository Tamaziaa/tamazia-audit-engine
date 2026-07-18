'use strict';
// eval/e2e/lib/replay-llm.test.js - node:test coverage for the replay-side implementation of the
// frozen recorded-response contract (docs/P3-TAIL-ACCEPTANCE.md; caution.md C-211, C-236, C-222).
//
// P3-TAIL WAVE-2 REVISION: this suite was rewritten alongside replay-llm.js's own C-211/C-222 closure
// (see that file's header). The adjudicate-kind key derivation moved from a law+hash(evidence+page)
// guess parsed out of prompt text to record_id+artifactFingerprint(artifact) read off
// request.candidates (the out-of-band ref array breach/adjudicator/adjudicate.js's callGate() now
// attaches) - the same basis the recorder (eval/e2e/lib/real-llm.js via eval/e2e/run-real-proof.js)
// actually computes. Per C-211 ("hand-builds the candidate and does not require() the sibling"), every
// fixture here is still hand-built; the hermetic locks at the bottom drive the REAL, already-landed
// breach/adjudicator/adjudicate.js end to end so the composition is genuinely proven, not assumed.
//
//   node --test eval/e2e/lib/replay-llm.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  replayLlmCall, computeKey, candidateKey, adjudicateBriefKey, entailmentCandidateKey, entailmentRequestKey,
  candidateRefsFromRequest, briefsFromAdjudicatePrompt, loadRecordingsDir, CONTRACT, DECLINE,
} = require('./replay-llm.js');
const { artifactFingerprint } = require('./record-key.js');

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
// computeKey / candidateKey: the frozen contract's hash formula, exactly as documented. Both now
// delegate to eval/e2e/lib/record-key.js; these tests prove the PUBLIC behaviour is unchanged.
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

test('candidateKey: the ONE shared derivation - adjudicate and entailment differ ONLY by kind on the same ref', () => {
  const ref = { record_id: 'UK_GDPR_ART5', artifact: { type: 'quote', text: 'we sell your data' } };
  // candidateKey composes recordingKey(kind, record_id, artifactFingerprint(artifact)) directly.
  assert.strictEqual(candidateKey('adjudicate', ref), computeKey('adjudicate', ref.record_id, artifactFingerprint(ref.artifact)));
  assert.strictEqual(candidateKey('entailment', ref), computeKey('entailment', ref.record_id, artifactFingerprint(ref.artifact)));
  // adjudicateBriefKey / entailmentCandidateKey are the two named kinds over the SAME ref -> same key but for kind.
  assert.strictEqual(adjudicateBriefKey(ref), candidateKey('adjudicate', ref));
  assert.strictEqual(entailmentCandidateKey(ref), candidateKey('entailment', ref));
  assert.notStrictEqual(adjudicateBriefKey(ref), entailmentCandidateKey(ref), 'the two kinds must not collide on the same ref');
  // a missing/undefined ref never throws (fail-closed via a lookup miss, not a crash).
  assert.doesNotThrow(() => candidateKey('entailment', undefined));
  assert.match(candidateKey('entailment', {}), /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------------------------------
// briefsFromAdjudicatePrompt: RETAINED as a correct, standalone description of the CANDIDATES prompt
// text framing (still exactly what breach/adjudicator/adjudicate.js's buildPrompt() emits) - no longer
// this file's key-derivation path (see replay-llm.js's header), but still real and still tested.
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
// candidateRefsFromRequest: reading the out-of-band request.candidates array.
// ---------------------------------------------------------------------------------------------------

test('candidateRefsFromRequest: reads a well-formed candidates array straight through', () => {
  const refs = [{ id: 0, record_id: 'R', artifact: { type: 'quote' } }];
  assert.deepStrictEqual(candidateRefsFromRequest({ candidates: refs }), refs);
});

test('candidateRefsFromRequest: absent/malformed candidates fails closed to []', () => {
  assert.deepStrictEqual(candidateRefsFromRequest({}), []);
  assert.deepStrictEqual(candidateRefsFromRequest({ candidates: 'not-an-array' }), []);
  assert.deepStrictEqual(candidateRefsFromRequest(null), []);
  assert.deepStrictEqual(candidateRefsFromRequest(undefined), []);
});

// ---------------------------------------------------------------------------------------------------
// adjudicateBriefKey: NOW derived from {record_id, artifact} - the recorder's own basis (C-211/C-222).
// ---------------------------------------------------------------------------------------------------

test('adjudicateBriefKey: same (record_id, artifact) -> same key; either field changing -> a different key', () => {
  const artifact = { type: 'quote', text: 'we sell your data', surface: 'visible_text' };
  const base = { record_id: 'UK_GDPR_ART5', artifact };
  const k1 = adjudicateBriefKey(base);
  const k2 = adjudicateBriefKey({ record_id: 'UK_GDPR_ART5', artifact: { surface: 'visible_text', text: 'we sell your data', type: 'quote' } }); // key order differs, value identical
  const k3 = adjudicateBriefKey({ ...base, record_id: 'PECR_REG6' });
  const k4 = adjudicateBriefKey({ ...base, artifact: { type: 'quote', text: 'different quote', surface: 'visible_text' } });
  assert.strictEqual(k1, k2, 'artifact key order must not change the key (stableStringify)');
  assert.notStrictEqual(k1, k3);
  assert.notStrictEqual(k1, k4);
  assert.strictEqual(k1, computeKey('adjudicate', 'UK_GDPR_ART5', artifactFingerprint(artifact)), 'must match the shared record-key.js formula directly');
});

test('adjudicateBriefKey: tolerates a missing/undefined ref without throwing (fail-closed, not a crash)', () => {
  assert.doesNotThrow(() => adjudicateBriefKey(undefined));
  assert.doesNotThrow(() => adjudicateBriefKey({}));
  assert.match(adjudicateBriefKey({}), /^[0-9a-f]{64}$/, 'still yields a real (if unlikely-to-match) key');
});

// ---------------------------------------------------------------------------------------------------
// entailmentRequestKey: NOW reads request.candidate = { record_id, artifact } (the unified basis, the
// SAME one adjudicate and the recorder use), NOT the premise text (the closed C-211/C-222 gap).
// ---------------------------------------------------------------------------------------------------

test('entailmentRequestKey: derived from request.candidate {record_id, artifact}, deterministic, == entailmentCandidateKey', () => {
  const cand = { record_id: 'UK_GDPR_ART5', artifact: { type: 'quote', text: 'we drop cookies before consent' } };
  const k1 = entailmentRequestKey({ candidate: cand });
  const k2 = entailmentRequestKey({ candidate: { record_id: 'UK_GDPR_ART5', artifact: { text: 'we drop cookies before consent', type: 'quote' } } }); // key order differs
  const k3 = entailmentRequestKey({ candidate: { record_id: 'PECR_REG6', artifact: cand.artifact } });
  assert.strictEqual(k1, k2, 'artifact key order must not change the key (stableStringify)');
  assert.notStrictEqual(k1, k3, 'a different record_id yields a different key');
  assert.strictEqual(k1, entailmentCandidateKey(cand), 'entailmentRequestKey just extracts request.candidate and delegates');
});

test('entailmentRequestKey: the SAME candidate keyed for entailment differs from its adjudicate sibling ONLY by kind', () => {
  const cand = { record_id: 'UK_GDPR_ART5', artifact: { type: 'quote', text: 'we drop cookies before consent' } };
  assert.notStrictEqual(entailmentRequestKey({ candidate: cand }), adjudicateBriefKey(cand));
  // proof they share the (record_id, artifact) basis and differ only by the kind token:
  assert.strictEqual(entailmentRequestKey({ candidate: cand }), computeKey('entailment', cand.record_id, artifactFingerprint(cand.artifact)));
  assert.strictEqual(adjudicateBriefKey(cand), computeKey('adjudicate', cand.record_id, artifactFingerprint(cand.artifact)));
});

test('entailmentRequestKey: a request with no candidate (old-shape allowedSourceIds/sources) never throws and yields a stable key', () => {
  assert.doesNotThrow(() => entailmentRequestKey({}));
  assert.doesNotThrow(() => entailmentRequestKey(null));
  // the old allowedSourceIds/sources shape carries no request.candidate, so it derives from an empty
  // ref (fail-closed: a stable key that simply will not match a real recorder-side recording).
  assert.strictEqual(entailmentRequestKey({}), entailmentRequestKey({ allowedSourceIds: ['x'], sources: { x: 'ignored now' } }));
  assert.match(entailmentRequestKey({}), /^[0-9a-f]{64}$/);
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
// both kinds), in isolation from the real adjudicator. Adjudicate-kind requests are now built via
// request.candidates (the new out-of-band mechanism), not the prompt text.
// ---------------------------------------------------------------------------------------------------

function candRef(id, recordId, artifact) {
  return { id, record_id: recordId, artifact };
}

test('replayLlmCall: an adjudicate-kind request with NO matching candidate ref declines the whole call', async () => {
  const dir = tmpDir(); // empty: nothing recorded
  const llmCall = replayLlmCall(dir);
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([{ id: 0 }]), candidates: [candRef(0, 'UK_GDPR', { type: 'quote', text: 'quote' })] });
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: an adjudicate-kind request with a matching candidate ref returns a verdict for that id', async () => {
  const dir = tmpDir();
  const ref = candRef(0, 'UK_GDPR', { type: 'quote', text: 'quote text', page_url: 'https://x.test/p' });
  const key = adjudicateBriefKey(ref);
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key, kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'matches', disproof: null }), meta: null },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([{ id: 0 }]), candidates: [ref] });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.out.verdicts.length, 1);
  assert.strictEqual(res.out.verdicts[0].verdict, 'breach');
  assert.strictEqual(res.out.verdicts[0].id, 0, 'id is remapped to the CURRENT batch position');
});

test('replayLlmCall: within one batch, a hit and a miss coexist - the miss gets no verdict entry (per-candidate fail-closed, not whole-batch)', async () => {
  const dir = tmpDir();
  const refHit = candRef(0, 'UK_GDPR', { type: 'quote', text: 'quote text' });
  const refMiss = candRef(1, 'PECR', { type: 'quote', text: 'other quote' });
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key: adjudicateBriefKey(refHit), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'matches', disproof: null }) },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([{ id: 0 }, { id: 1 }]), candidates: [refHit, refMiss] });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.out.verdicts.length, 1, 'only the recorded candidate gets a verdict entry; the missing one is simply absent, so the adjudicator abstains just that id');
  assert.strictEqual(res.out.verdicts[0].id, 0);
});

test('replayLlmCall: an adjudicate-kind request with no request.candidates at all declines (fail-closed)', async () => {
  const llmCall = replayLlmCall(tmpDir());
  const res = await llmCall({ prompt: 'nothing recognisable here' });
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: an adjudicate-kind request with an EMPTY request.candidates array declines', async () => {
  const llmCall = replayLlmCall(tmpDir());
  const res = await llmCall({ prompt: fakeAdjudicatePrompt([]), candidates: [] });
  assert.deepStrictEqual(res, DECLINE);
});

// An entailment-kind request now carries request.candidate = { record_id, artifact } (the unified
// basis), plus the schema/allowedSourceIds/sources buildEntailmentPrompt produces (which isEntailment
// Request reads to route the call). entailmentRequest(cand) builds that shape.
function entailmentRequest(cand, premiseSid) {
  const sid = premiseSid || 'https://x.test/p';
  return {
    schema: { properties: { verdict: { enum: ['entailment', 'neutral', 'contradiction'] } } },
    allowedSourceIds: [sid],
    sources: { [sid]: 'the premise text (ignored by the key now; only the model ever reads it)' },
    candidate: cand,
  };
}

test('replayLlmCall: an entailment-kind request with a matching candidate key returns the recorded verdict', async () => {
  const dir = tmpDir();
  const cand = { record_id: 'UK_GDPR_ART5', artifact: { type: 'quote', text: 'we drop cookies before consent' } };
  const request = entailmentRequest(cand);
  const key = entailmentRequestKey(request);
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key, kind: 'entailment', raw: JSON.stringify({ source_id: 'https://x.test/p', verdict: 'entailment', rationale: 'ok' }) },
  ]));
  const llmCall = replayLlmCall(dir);
  const res = await llmCall(request);
  assert.strictEqual(res.source_id, 'https://x.test/p');
  assert.strictEqual(res.verdict, 'entailment');
});

test('replayLlmCall: an entailment-kind request whose candidate has NO matching recording declines', async () => {
  const llmCall = replayLlmCall(tmpDir());
  const res = await llmCall(entailmentRequest({ record_id: 'UNRECORDED', artifact: { type: 'quote', text: 'x' } }));
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: an entailment recording keyed for a DIFFERENT candidate does not match (the key is not vacuously permissive)', async () => {
  const dir = tmpDir();
  const recorded = { record_id: 'RULE-A', artifact: { type: 'quote', text: 'quote A' } };
  const asked = { record_id: 'RULE-B', artifact: { type: 'quote', text: 'quote B' } };
  writeRecordingFile(dir, 'rec.json', recordingDoc([
    { key: entailmentCandidateKey(recorded), kind: 'entailment', raw: JSON.stringify({ source_id: 's', verdict: 'entailment' }) },
  ]));
  const res = await replayLlmCall(dir)(entailmentRequest(asked));
  assert.deepStrictEqual(res, DECLINE);
});

test('replayLlmCall: recordings are loaded once per factory call (a second, unrelated dir does not leak in)', async () => {
  const dirA = tmpDir();
  const ref = candRef(0, 'UK_GDPR', { type: 'quote', text: 'quote text' });
  writeRecordingFile(dirA, 'rec.json', recordingDoc([
    { key: adjudicateBriefKey(ref), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'x', disproof: null }) },
  ]));
  const dirB = tmpDir(); // empty
  const llmCallA = replayLlmCall(dirA);
  const llmCallB = replayLlmCall(dirB);
  const req = { prompt: fakeAdjudicatePrompt([{ id: 0 }]), candidates: [ref] };
  assert.strictEqual((await llmCallA(req)).ok, true);
  assert.deepStrictEqual(await llmCallB(req), DECLINE);
});

// ---------------------------------------------------------------------------------------------------
// U2-B1 / B-B2: end-to-end against the REAL, unmodified breach/adjudicator/adjudicate.js (and, as a
// sanity check, breach/verifiers/ too) - a hand-built candidate approved by a hand-built recording
// reproduces as a genuine 'violation', through the real adjudicator, the real Rule-12-gate-3
// entailment call, and the real llm/gate.js structural gate. This is the hermetic proof
// docs/P3-TAIL-ACCEPTANCE.md's Wave-2 amendment B-B2 asks for: with a hand-built recording approving a
// synthetic-shaped candidate, the canonical replay path reproduces >= 1 THROUGH the real pipeline
// pieces (here: directly through adjudicate.js; eval/e2e/run-pipeline.test.js separately proves the
// same thing at the CLI/pipeline.js level).
//
// Because the key is now record_id+artifact (read off request.candidates, which
// breach/adjudicator/adjudicate.js's own callGate() attaches), this test no longer needs to hand-mirror
// briefOf()'s exact prompt-text construction (law/evidence/page derivation) to compute a matching key -
// it only needs the candidate's own record_id and artifact, which are already directly on the
// hand-built candidate. This is a direct, intended consequence of the C-211/C-222 unification.
test('U2-B1/B-B2: a hand-built recording approving a hand-built candidate reproduces as violation through the REAL adjudicator', async (t) => {
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
    // fields adjudicate.js's briefOf()/evidenceText()/claimFor() read (the catalogue-enrichment join,
    // eval/e2e/lib/pipeline.js's B2 addition, or eval/e2e/run-real-proof.js's own enrichCandidate):
    description: 'Guarantee-of-outcome claim for legal services (synthetic test obligation, harness self-test only, not a real law).',
    framework: 'synthetic replay-llm test framework (harness self-test only)',
    evidence_quote: 'We guarantee you will win every case, no exceptions',
    evidence_url: 'https://replay-hermetic.test/claims',
  };

  // Sanity check: this candidate is also genuinely verify-passing (Rule 3/Gate 2), not only
  // something adjudicate.js happens to accept.
  const verified = verifyCandidate(candidate, bundle);
  assert.strictEqual(verified.verified, true, 'the hand-built candidate must genuinely verify: ' + verified.reason);

  // BOTH kinds now key on the SAME (record_id, artifact) basis - the C-211/C-222 unification. The
  // recorder computes recordingKey(kind, candidate.record_id, artifactFingerprint(candidate.artifact));
  // the replay side reads the identical record_id + artifact off request.candidates (adjudicate) and
  // request.candidate (entailment, attached by adjudicate.js's claimFor -> entailment.js's callModel).
  // So the two recording keys differ ONLY by kind - the whole point of this resume task.
  const adjudicateKey = adjudicateBriefKey({ record_id: candidate.record_id, artifact: candidate.artifact });
  const entailmentKey = entailmentCandidateKey({ record_id: candidate.record_id, artifact: candidate.artifact });
  assert.notStrictEqual(adjudicateKey, entailmentKey, 'same candidate, both kinds - the keys differ only by kind');

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

  await t.test('the finding reproduces as a genuine violation (BOTH kinds - adjudicate verdict + entailment - replayed on the unified basis)', () => {
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].state, 'violation', 'adjudication_reason: ' + findings[0].adjudication_reason);
    assert.strictEqual(findings[0].adjudicated, true);
    assert.strictEqual(findings[0].adjudication, 'breach', 'a violation, not an nli_demote - so the entailment recording WAS consumed');
  });
  await t.test('the adjudicator report shows the LLM was available and the batch ran', () => {
    assert.strictEqual(report.llm_available, true);
    assert.strictEqual(report.violation, 1);
  });
});

test('B-B2 (entailment genuinely required): the adjudicate recording ALONE (no entailment recording) demotes to needs_review - proving the entailment key is consumed by the real Gate-3', async () => {
  const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');
  const bundle = {
    domain: 'replay-nli-required.test',
    corpus: { pages: [{ url: 'https://replay-nli-required.test/claims', text: 'ReplayCo helps clients. We guarantee you will win every case, no exceptions, or your money back.' }] },
  };
  const candidate = {
    record_id: 'REPLAY-NLI-REQUIRED-RULE', duty_idx: 0, kind: 'presence-breach', evidence_type: 'absence',
    artifact: { type: 'quote', text: 'We guarantee you will win every case, no exceptions', surface: 'visible_text', page_url: 'https://replay-nli-required.test/claims' },
    page_url: 'https://replay-nli-required.test/claims',
    description: 'Guarantee-of-outcome claim (harness self-test only).', framework: 'synthetic replay-llm test framework (harness self-test only)',
    evidence_quote: 'We guarantee you will win every case, no exceptions', evidence_url: 'https://replay-nli-required.test/claims',
  };
  // ONLY the adjudicate recording is written; the entailment recording is deliberately absent, so the
  // breach verdict is approved but Gate-3 (checkEntailment -> replay entailment lookup) DECLINEs.
  const dir = tmpDir();
  writeRecordingFile(dir, 'replay-nli-required.test.json', recordingDoc([
    { key: adjudicateBriefKey({ record_id: candidate.record_id, artifact: candidate.artifact }), kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'guarantees an outcome', disproof: null }) },
  ]));
  const { findings } = await adjudicate([candidate], bundle, { llmCall: replayLlmCall(dir) });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].state, 'needs_review', 'no entailment recording -> Gate-3 declines -> nli_demote, never a fabricated violation');
  assert.strictEqual(findings[0].adjudication, 'nli_demoted', 'proves the entailment recording is genuinely consumed, not decorative');
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

test('B-B1/B-B2 companion: a DIFFERENT record_id or artifact on the SAME candidate is a genuine miss (the key is not vacuously permissive)', async () => {
  const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');
  const bundle = {
    domain: 'replay-hermetic-wrongkey.test',
    corpus: { pages: [{ url: 'https://replay-hermetic-wrongkey.test/claims', text: 'We guarantee you will win every case, no exceptions.' }] },
  };
  const candidate = {
    record_id: 'REPLAY-TEST-RULE', artifact: { type: 'quote', text: 'We guarantee you will win every case, no exceptions', surface: 'visible_text' },
    page_url: 'https://replay-hermetic-wrongkey.test/claims',
    description: 'Guarantee-of-outcome claim.', framework: 'fw',
    evidence_quote: 'We guarantee you will win every case, no exceptions', evidence_url: 'https://replay-hermetic-wrongkey.test/claims',
  };
  // A recording keyed under a DIFFERENT record_id must not accidentally match.
  const wrongKey = adjudicateBriefKey({ record_id: 'SOME-OTHER-RULE', artifact: candidate.artifact });
  const dir = tmpDir();
  writeRecordingFile(dir, 'x.json', recordingDoc([{ key: wrongKey, kind: 'adjudicate', raw: JSON.stringify({ id: 0, verdict: 'breach' }) }]));
  const { findings } = await adjudicate([candidate], bundle, { llmCall: replayLlmCall(dir) });
  assert.strictEqual(findings[0].state, 'needs_review', 'a recording keyed under a different record_id must not match');
});
