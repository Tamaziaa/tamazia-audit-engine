'use strict';
// eval/e2e/lib/record-key.test.js - node:test for the ONE shared recorded-response key derivation
// (docs/P3-TAIL-ACCEPTANCE.md; caution.md C-211, C-222, C-216).
//   node --test eval/e2e/lib/record-key.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { CONTRACT, sha256Hex, stableStringify, artifactFingerprint, recordingKey } = require('./record-key.js');

test('sha256Hex: matches Node crypto directly, coerces null/undefined without throwing', () => {
  const expected = crypto.createHash('sha256').update('hello').digest('hex');
  assert.equal(sha256Hex('hello'), expected);
  assert.doesNotThrow(() => sha256Hex(null));
  assert.doesNotThrow(() => sha256Hex(undefined));
  assert.match(sha256Hex(undefined), /^[0-9a-f]{64}$/);
});

test('stableStringify: object key order never changes the output (the property a fingerprint needs)', () => {
  const a = { type: 'quote', quote: 'x', page_url: 'https://x.test/' };
  const b = { page_url: 'https://x.test/', quote: 'x', type: 'quote' };
  assert.equal(stableStringify(a), stableStringify(b));
});

test('stableStringify: nested objects and arrays are sorted recursively', () => {
  const a = { z: 1, a: { y: 2, b: 3 }, list: [{ q: 1, p: 2 }] };
  const b = { a: { b: 3, y: 2 }, list: [{ p: 2, q: 1 }], z: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
});

test('stableStringify: a null/primitive value serialises via plain JSON.stringify', () => {
  assert.equal(stableStringify(null), 'null');
  assert.equal(stableStringify('x'), '"x"');
  assert.equal(stableStringify(42), '42');
});

test('artifactFingerprint: order-independent, deterministic, empty-safe', () => {
  const a = { type: 'quote', text: 'x', surface: 'visible_text' };
  const b = { surface: 'visible_text', text: 'x', type: 'quote' };
  assert.equal(artifactFingerprint(a), artifactFingerprint(b));
  assert.notStrictEqual(artifactFingerprint(a), artifactFingerprint({ type: 'quote', text: 'y', surface: 'visible_text' }));
  assert.match(artifactFingerprint(null), /^[0-9a-f]{64}$/);
  assert.match(artifactFingerprint(undefined), /^[0-9a-f]{64}$/);
  assert.equal(artifactFingerprint(null), artifactFingerprint(undefined), 'a missing artifact fingerprints the same stable null either way');
});

test('recordingKey: matches sha256(kind + "|" + rule_id + "|" + artifact_fingerprint) exactly, per the frozen contract', () => {
  const kind = 'adjudicate';
  const ruleId = 'UK_GDPR_ART5';
  const fp = artifactFingerprint({ type: 'quote', text: 'x' });
  const expected = crypto.createHash('sha256').update(kind + '|' + ruleId + '|' + fp).digest('hex');
  assert.equal(recordingKey(kind, ruleId, fp), expected);
});

test('recordingKey: sensitive to every field (kind, rule_id, artifact_fingerprint all participate)', () => {
  const fpA = artifactFingerprint({ type: 'quote', text: 'a' });
  const fpB = artifactFingerprint({ type: 'quote', text: 'b' });
  const k1 = recordingKey('adjudicate', 'RULE-1', fpA);
  assert.equal(k1, recordingKey('adjudicate', 'RULE-1', fpA), 'deterministic');
  assert.notStrictEqual(k1, recordingKey('adjudicate', 'RULE-2', fpA), 'rule_id participates');
  assert.notStrictEqual(k1, recordingKey('entailment', 'RULE-1', fpA), 'kind participates');
  assert.notStrictEqual(k1, recordingKey('adjudicate', 'RULE-1', fpB), 'artifact_fingerprint participates');
  assert.match(k1, /^[0-9a-f]{64}$/);
});

test('CONTRACT is the frozen contract id string', () => {
  assert.equal(CONTRACT, 'recorded-llm.v1');
});

// ---------------------------------------------------------------------------------------------------
// B-B1: the composition test. A hand-built candidate's key is derived via this shared module AS THE
// RECORDER (eval/e2e/lib/real-llm.js -> eval/e2e/run-real-proof.js) actually computes it:
// recordingKey(kind, candidate.record_id, artifactFingerprint(candidate.artifact)). A recording is
// written under that key using the real-llm.js recorder-side writer (so the composition genuinely
// crosses the recorder's own write path, not just this module's bare hash functions), then
// eval/e2e/lib/replay-llm.js (the independent consumer, imported separately below) is proven to find
// it via the SAME shared derivation - the whole point of C-211/C-222 closure: one module, two
// consumers, provably the same key for the same candidate.
// ---------------------------------------------------------------------------------------------------

test('B-B1 COMPOSITION: a key derived here as the recorder would is found by the replayer (real-llm.js writer -> replay-llm.js reader)', () => {
  const realLlm = require('./real-llm.js');
  const { replayLlmCall, DECLINE } = require('./replay-llm.js');

  // A hand-built candidate carrying the two fields the recorder's key derivation actually reads
  // (record_id, artifact) - the shape breach/proposers/propose.js emits and
  // breach/adjudicator/adjudicate.js preserves untouched onto every finding (run-real-proof.js's own
  // header comment).
  const candidate = {
    record_id: 'RECORD-KEY-COMPOSITION-TEST',
    artifact: { type: 'quote', text: 'we guarantee you will win every case', surface: 'visible_text', page_url: 'https://composition.test/claims' },
    page_url: 'https://composition.test/claims',
  };

  // Derive the key exactly as the recorder does (run-real-proof.js's entailmentEntryFor/
  // adjudicateEntriesFor): recordingKey(kind, candidate.record_id, artifactFingerprint(candidate.artifact)).
  const kind = 'adjudicate';
  const key = recordingKey(kind, candidate.record_id, artifactFingerprint(candidate.artifact));

  // Also prove real-llm.js's OWN re-exported functions (the actual recorder module, not just this
  // shared module in isolation) compute the IDENTICAL key for the same candidate - the composition
  // this test's name promises.
  const keyViaRealLlm = realLlm.recordingKey(kind, candidate.record_id, realLlm.artifactFingerprint(candidate.artifact));
  assert.equal(keyViaRealLlm, key, 'real-llm.js must derive the identical key via the shared module');

  // Write a recording under that key using real-llm.js's own recorder-side writer (buildRecordingFile +
  // writeRecordingFile), to a throwaway temp directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-key-composition-'));
  const recording = realLlm.buildRecordingFile({
    domain: 'composition.test',
    providers: ['hermetic-test'],
    responses: [{
      key,
      kind: 'adjudicate',
      raw: JSON.stringify({ id: 0, verdict: 'breach', reason: 'guarantees an outcome', disproof: null }),
      meta: { provider: 'hermetic-test', model: 'hand-built' },
    }],
  });
  realLlm.writeRecordingFile(dir, candidate.page_url.replace(/[^a-z0-9.-]/gi, '-'), recording);

  // Now prove the REPLAYER finds it, given a request that carries the out-of-band candidate ref the
  // adjudication seam attaches (breach/adjudicator/adjudicate.js callGate's request.candidates - see
  // that file's candidateRefsFor()). This is the replay side's OWN derivation, exercised independently.
  const llmCall = replayLlmCall(dir);
  return llmCall({
    prompt: 'CANDIDATES:\n[{"id":0,"obligation":"o","law":"l","kind":"k","evidence":"e","page":"p"}]\n\nReturn STRICT JSON only:',
    candidates: [{ id: 0, record_id: candidate.record_id, artifact: candidate.artifact }],
  }).then((res) => {
    assert.notDeepEqual(res, DECLINE, 'the replayer must find the recording written under the recorder-derived key');
    assert.equal(res.ok, true);
    assert.equal(res.out.verdicts.length, 1);
    assert.equal(res.out.verdicts[0].verdict, 'breach');
  });
});
