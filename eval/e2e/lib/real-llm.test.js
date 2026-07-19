'use strict';
// eval/e2e/lib/real-llm.test.js - network-free tests for the real-model adapter.
//   node --test eval/e2e/lib/real-llm.test.js
//
// Every test here injects a FAKE provider or a FAKE fetch; NO real network call is ever made (the real
// network path is exercised only by run-real-proof.js under RUN_REAL_LLM=1). The two load-bearing
// hermetic locks (caution.md C-211) drive the REAL breach/adjudicator + REAL llm/entailment through the
// adapter's llmCall to prove the return shapes are exactly what those consumers expect.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('./real-llm.js');
const { adjudicate } = require('../../../breach/adjudicator/adjudicate.js');
const { checkEntailment } = require('../../../llm/entailment.js');

// ── a fake router provider whose .call returns canned text per request kind (no network) ──────────────
function fakeProvider(name, family, responder) {
  let calls = 0;
  const p = {
    name: name, family, tier: 'free', model: name.split('::')[1] || name,
    call: (request) => { calls++; return Promise.resolve(responder(request)); },
    get calls() { return calls; },
  };
  return p;
}
function envOn(extra) { return Object.assign({ RUN_REAL_LLM: '1' }, extra || {}); }

// caller(providers, extra): build a real caller for tests with a TEMP record dir (never the shared
// eval/e2e/record/) and zero quota spacing (tests need no rate courtesy). Keeps the gitignored proof
// log free of fake test-call noise.
const TMP_REC = fs.mkdtempSync(path.join(os.tmpdir(), 'real-llm-testrec-'));
function caller(providers, extra) {
  return R.createRealLlmCall(Object.assign({ env: envOn(), providers, recordDir: TMP_REC, spacingMs: 0 }, extra || {}));
}

// A breach/adjudicator-ready ENRICHED candidate (description + evidence_quote + locator), the shape the
// mint builds and run-real-proof.js's enrichCandidate() produces; a bare propose.js candidate (no
// description) would abstain at Gate 3 before the model is asked (that is the whole point of enrichment).
function enrichedQuoteCandidate() {
  return {
    record_id: 'TEST_GUARANTEE', duty_idx: 0, kind: 'presence-breach', evidence_type: 'absence',
    artifact: { type: 'quote', text: 'we guarantee you will win every case', surface: 'visible_text' },
    page_url: 'https://x.test/', evidence_source_id: 'https://x.test/',
    description: 'a firm must not guarantee the outcome of a legal matter',
    evidence_quote: 'we guarantee you will win every case',
  };
}

// respond as an adjudicator verdict OR an entailment label depending on the request kind.
function breachThenEntailment(request) {
  if (R.isEntailmentRequest(request)) {
    const sid = (request.allowedSourceIds && request.allowedSourceIds[0]) || '';
    return { ok: true, text: JSON.stringify({ source_id: sid, verdict: 'entailment' }) };
  }
  return { ok: true, text: JSON.stringify({ verdicts: [{ id: 0, verdict: 'breach', reason: 'guarantee of outcome', disproof: null }] }) };
}

// ── env gate (fail-closed construction) ──────────────────────────────────────────────────────────────
test('createRealLlmCall THROWS when RUN_REAL_LLM is not "1" (fail-closed opt-in)', () => {
  assert.throws(() => R.createRealLlmCall({ env: {}, providers: [fakeProvider('groq::m', 'groq', breachThenEntailment)] }), /RUN_REAL_LLM is not "1"/);
});
test('createRealLlmCall THROWS when flagged on but no providers and no keys', () => {
  assert.throws(() => R.createRealLlmCall({ env: envOn() }), /no providers could be constructed/);
});
test('createRealLlmCall constructs with the flag + injected providers', () => {
  const c = caller([fakeProvider('groq::m', 'groq', breachThenEntailment)]);
  assert.strictEqual(typeof c.llmCall, 'function');
  assert.deepStrictEqual(c.families, ['groq']);
});

// (envKeysPresent / buildProvidersFromEnv / structured-output body tests moved to
// real-llm-transport.test.js alongside the extracted transport module, C-254.)

// ── request-kind detection ───────────────────────────────────────────────────────────────────────────
test('request-kind detection distinguishes entailment (schema.verdict.enum) from adjudication (rubric)', () => {
  assert.strictEqual(R.isEntailmentRequest({ schema: { properties: { verdict: { enum: ['entailment', 'neutral', 'contradiction'] } } } }), true);
  assert.strictEqual(R.isEntailmentRequest({ rubric: () => ({}) }), false);
  assert.strictEqual(R.isAdjudicationRequest({ rubric: () => ({}) }), true);
  assert.strictEqual(R.isAdjudicationRequest({ schema: {} }), false);
});

// ── THE HERMETIC LOCKS: the adapter's llmCall drives the REAL adjudicator + REAL entailment ───────────
test('LOCK: a real-llm adjudication verdict drives the REAL adjudicator + REAL Gate-3 to a violation', async () => {
  const rc = caller([fakeProvider('groq::m', 'groq', breachThenEntailment)]);
  const { findings } = await adjudicate([enrichedQuoteCandidate()], { domain: 'x.test' }, { llmCall: rc.llmCall, deadlineMs: 5000 });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].state, 'violation', 'breach verdict + entailment must produce a violation end to end');
  assert.strictEqual(findings[0].adjudication, 'breach');
});
test('LOCK: a real-llm entailment response drives the REAL checkEntailment to ok:true', async () => {
  const rc = caller([fakeProvider('groq::m', 'groq', breachThenEntailment)]);
  const [r] = await checkEntailment(
    [{ claim: 'the firm guarantees outcomes', premise_source_id: 'https://x.test/', premise: 'we guarantee you will win every case' }],
    { llmCall: rc.llmCall, deadlineMs: 5000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'entailment');
});
test('a "neutral" entailment demotes (ok:false) - the model cannot fluently assert its way past Gate 3', async () => {
  const neutral = (req) => R.isEntailmentRequest(req)
    ? { ok: true, text: JSON.stringify({ source_id: (req.allowedSourceIds || [])[0] || '', verdict: 'neutral' }) }
    : { ok: true, text: JSON.stringify({ verdicts: [{ id: 0, verdict: 'breach' }] }) };
  const rc = caller([fakeProvider('groq::m', 'groq', neutral)]);
  const { findings } = await adjudicate([enrichedQuoteCandidate()], { domain: 'x.test' }, { llmCall: rc.llmCall, deadlineMs: 5000 });
  assert.strictEqual(findings[0].state, 'needs_review');
  assert.strictEqual(findings[0].adjudication, 'nli_demoted');
});
test('an "insufficient" adjudication verdict abstains to needs_review', async () => {
  const insuff = () => ({ ok: true, text: JSON.stringify({ verdicts: [{ id: 0, verdict: 'insufficient', reason: 'thin' }] }) });
  const rc = caller([fakeProvider('groq::m', 'groq', insuff)]);
  const { findings } = await adjudicate([enrichedQuoteCandidate()], { domain: 'x.test' }, { llmCall: rc.llmCall, deadlineMs: 5000 });
  assert.strictEqual(findings[0].state, 'needs_review');
});

// ── no retry after the final attempt (C-175); one attempt per provider ───────────────────────────────
test('C-175: each provider is called exactly once per llmCall; an all-fail chain returns ok:false, no retry', async () => {
  const p1 = fakeProvider('groq::a', 'groq', () => ({ ok: false, error: 'HTTP 429: rate limited' }));
  const p2 = fakeProvider('gemini::b', 'gemini', () => ({ ok: false, error: 'HTTP 500: server error' }));
  const rc = caller([p1, p2]);
  const out = await rc.llmCall({ rubric: () => ({ score: 10 }), threshold: 7, system: 's', prompt: 'p' });
  assert.strictEqual(out.ok, false, 'an exhausted chain declines; the adjudicator then abstains the batch');
  assert.strictEqual(p1.calls, 1, 'provider 1 called exactly once (no retry, C-175)');
  assert.strictEqual(p2.calls, 1, 'provider 2 called exactly once (no retry, C-175)');
});

// ── deadline is a cap, never a floor (Rule 8/9) ──────────────────────────────────────────────────────
test('deadlineFor clamps a request override to the cap and never below (Rule 8: cap, not floor)', () => {
  assert.strictEqual(R.deadlineFor({ deadline_ms: 999999 }, 20000), 20000, 'a longer override is clamped to the cap');
  assert.strictEqual(R.deadlineFor({ deadline_ms: 3000 }, 20000), 3000, 'a shorter override is honoured');
  assert.strictEqual(R.deadlineFor({}, 20000), 20000, 'absent override uses the cap');
});

// ── recording contract: key derivation + schema self-validation (the earn-your-zero calibration) ─────
test('artifactFingerprint is stable across key order; recordingKey is a 64-hex sha256', () => {
  const a = { type: 'quote', text: 'x', surface: 'visible_text' };
  const b = { surface: 'visible_text', text: 'x', type: 'quote' };
  assert.strictEqual(R.artifactFingerprint(a), R.artifactFingerprint(b), 'fingerprint is order-independent');
  const key = R.recordingKey('adjudicate', 'RULE', R.artifactFingerprint(a));
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(key, R.recordingKey('entailment', 'RULE', R.artifactFingerprint(a)), 'kind participates in the key');
});
test('buildRecordingFile + validateRecordingFile accept a well-formed recording', () => {
  const rec = R.buildRecordingFile({
    domain: 'x.test', providers: ['groq'],
    responses: [{ key: R.recordingKey('adjudicate', 'R', R.artifactFingerprint({ type: 'quote' })), kind: 'adjudicate', raw: '{"verdicts":[]}', meta: { provider: 'groq', model: 'llama-3.3-70b-versatile' } }],
  });
  assert.strictEqual(rec.contract, 'recorded-llm.v1');
  const v = R.validateRecordingFile(rec);
  assert.strictEqual(v.ok, true, v.errors.join('; '));
});
test('CALIBRATION (earn-your-zero): every known-bad recording fixture is REJECTED with its expected error', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'real-llm.calibration-known-bad.json'), 'utf8'));
  assert.ok(Array.isArray(fx.cases) && fx.cases.length >= 5, 'the known-bad fixture must carry cases');
  for (const c of fx.cases) {
    const v = R.validateRecordingFile(c.recording);
    assert.strictEqual(v.ok, false, 'the validator must REJECT the known-bad case: ' + c.why);
    assert.ok(v.errors.some((e) => e.includes(c.expect_error_substr)), c.why + ': expected an error containing "' + c.expect_error_substr + '", got ' + JSON.stringify(v.errors));
  }
});
test('Rule 16: a secret-shaped raw is refused (dynamically-built token so no committed file carries one, C-253)', () => {
  const token = 'gsk' + '_' + 'AAAA1111BBBB2222';   // built at runtime; never a literal in the source
  assert.strictEqual(R.containsSecretShape('prefix ' + token + ' suffix'), true);
  const bad = R.buildRecordingFile({ domain: 'x.test', providers: ['groq'], responses: [{ key: R.recordingKey('adjudicate', 'R', 'fp'), kind: 'adjudicate', raw: 'here is ' + token, meta: { provider: 'groq', model: 'm' } }] });
  const v = R.validateRecordingFile(bad);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /secret-shaped/.test(e)), 'a secret-shaped raw must be flagged: ' + JSON.stringify(v.errors));
});

// ── writeRecordingFile: validates, refuses bad, writes good (to a temp dir, never the real recorded/) ─
test('writeRecordingFile writes a valid recording and REFUSES an invalid one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-llm-rec-'));
  const good = R.buildRecordingFile({ domain: 'x.test', providers: ['groq'], responses: [] });
  const abs = R.writeRecordingFile(dir, 'x.test', good);
  assert.ok(fs.existsSync(abs));
  const reread = JSON.parse(fs.readFileSync(abs, 'utf8'));
  assert.strictEqual(reread.contract, 'recorded-llm.v1');
  assert.throws(() => R.writeRecordingFile(dir, 'x.test', { contract: 'wrong', engine: {}, responses: [] }), /refusing to write an invalid recording/);
  assert.throws(() => R.writeRecordingFile(dir, '../escape', good), /unsafe recording domain/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── quota spacing clamp ──────────────────────────────────────────────────────────────────────────────
test('clampSpacing and clampDeadline clamp to their caps and reject junk (Rule 8: caps, never floors)', () => {
  assert.strictEqual(R.clampSpacing(999999), 5000, 'spacing clamps to MAX_SPACING_MS');
  assert.strictEqual(R.clampSpacing(0), 0, 'zero spacing is allowed (no floor)');
  assert.strictEqual(R.clampSpacing(-5), R.DEFAULT_SPACING_MS, 'a negative override falls back to the default');
  assert.strictEqual(R.clampDeadline(999999), R.MAX_DEADLINE_MS, 'deadline clamps to MAX_DEADLINE_MS');
  assert.strictEqual(R.clampDeadline('junk'), R.DEFAULT_DEADLINE_MS);
});
