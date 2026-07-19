'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ManifestStore } = require('./manifest-store.js');
const { recordSignature } = require('./signature-store.js');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');
const { mintGate, evaluateMintGate, REFUSAL_CODES } = require('./mint-gate.js');
const { MintRefusalError } = require('./errors.js');

// A syntactically-valid 64-char lowercase-hex span_sha256 for the FABRICATED-finding fixture below.
// createFinding() only checks SHAPE (finding.test.js's own documented boundary), and this fabricated quote
// is refused downstream on evidence_id resolution (NO_ARTIFACT) long before its span_sha256 is ever
// inspected, so this value need not be a real hash of anything.
const FAKE_SPAN_HASH = 'f'.repeat(64);

function store() {
  return new ManifestStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-gate-')) });
}
function catalogue(records) {
  return { content_hash: 'HASH1', records };
}
// realFindingAndIndex() builds a quote the ONE way this repo allows (quote-resolver.js's resolveQuoteSpan
// - see its own header: "the ONLY place a candidate's quote text is converted into a byte range"), so the
// resulting Finding carries a genuine span_sha256 and genuinely PASSES verify_quote, exactly like a Finding
// run-harness.js's classifyCandidates() would construct.
function realFindingAndIndex() {
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'Real evidenced text on a real page for real.' }] } });
  const quote = resolveQuoteSpan(captureIndex, 'https://x/', 'evidenced text');
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  return { captureIndex, finding };
}

test('mint gate PROCEEDS (in stub mode) when signature=SIGN, all quotes verify, catalogue resolves, coverage manifest present', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-ok', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const outcome = await mintGate({
    store: s, runId: 'run-ok', findings: [finding], captureIndex,
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]),
    coverageManifest: { checks_planned: ['UK_X'] },
  });
  assert.strictEqual(outcome.proceeded, true);
  assert.strictEqual(outcome.mode, 'stub');
  assert.strictEqual(outcome.persisted, null);
});

test('REFUSAL: no signature recorded at all', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-none', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: [] } }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_SIGNATURE); return true; }
  );
});

test('REFUSAL: the latest signature is HOLD, not SIGN, even though verify_quote would pass', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-hold', { overall: 'HOLD', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-hold', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.SIGNATURE_HOLD); return true; }
  );
});

test('REFUSAL (THE FABRICATION PROOF): mint gate refuses a FABRICATED finding even with overall SIGN, because verify_quote fails', async () => {
  const s = store();
  const { captureIndex } = realFindingAndIndex();
  // A hand-fabricated finding: well-formed shape (createFinding succeeds - construction only checks shape),
  // but the byte range points nowhere real that was ever captured.
  const fabricated = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote: { evidence_id: 'never-captured', byte_start: 0, byte_end: 40, span_sha256: FAKE_SPAN_HASH }, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  recordSignature(s, 'run-fab', { overall: 'SIGN', findingDecisions: [{ finding_id: fabricated.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-fab', findings: [fabricated], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'] } }),
    (err) => {
      assert.ok(err instanceof MintRefusalError);
      assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNVERIFIABLE_QUOTE);
      assert.match(err.detail, /no_artifact/);
      return true;
    }
  );
});

test('REFUSAL: an unresolvable law_id (not in the loaded catalogue) is refused', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-lawid', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-lawid', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'SOME_OTHER_LAW', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNRESOLVABLE_LAW_ID); return true; }
  );
});

test('REFUSAL: a catalogue-hash mismatch (finding minted against a different catalogue than the one loaded now)', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-hashmismatch', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const differentCatalogue = { content_hash: 'DIFFERENT_HASH', records: [{ id: 'UK_X', jurisdiction: 'UK' }] };
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-hashmismatch', findings: [finding], captureIndex, catalogue: differentCatalogue, coverageManifest: { checks_planned: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.CATALOGUE_HASH_MISMATCH); return true; }
  );
});

test('REFUSAL: no coverage manifest present', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-nocov', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-nocov', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: null }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_COVERAGE_MANIFEST); return true; }
  );
});

test('REFUSAL: a shipped finding was never explicitly decided in the signature (fail closed, never assume ship)', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-undecided', { overall: 'SIGN', findingDecisions: [] }); // signed, but this finding was never decided
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-undecided', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNDECIDED_FINDING); return true; }
  );
});

test('evaluateMintGate is a pure, non-throwing form usable for a preview check', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const decision = evaluateMintGate({ store: s, runId: 'never-signed', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: [] } });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.reasonCode, REFUSAL_CODES.NO_SIGNATURE);
});

// CodeRabbit review (PR #36): the live persistFn path had no bounded timeout, so a hung external write
// could block mintGate() forever. It is stub-only in v0 (no caller anywhere wires a real persistFn), but
// the seam and its safety property are tested now, before it is ever used for real.
test('mintGate LIVE mode calls persistFn and returns its result when it resolves within budget', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-live', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const persistFn = async () => ({ neonRowId: 42 });
  const outcome = await mintGate({
    store: s, runId: 'run-live', findings: [finding], captureIndex,
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'] },
    stubPersist: false, persistFn,
  });
  assert.strictEqual(outcome.mode, 'live');
  assert.deepStrictEqual(outcome.persisted, { neonRowId: 42 });
});

test('REFUSAL (via rejection): a persistFn that never resolves is bounded by a timeout, never hangs the caller', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-hang', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const hungPersistFn = () => new Promise(() => {}); // never settles
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-hang', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'] },
      stubPersist: false, persistFn: hungPersistFn, persistTimeoutMs: 25,
    }),
    /exceeded its 25ms budget/
  );
});
