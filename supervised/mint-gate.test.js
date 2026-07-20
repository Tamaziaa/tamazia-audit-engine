'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ManifestStore } = require('./manifest-store.js');
const { recordSignature } = require('./signature-store.js');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { createFinding, withMitigation, FINDING_CLASS } = require('./finding.js');
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
    coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
  });
  assert.strictEqual(outcome.proceeded, true);
  assert.strictEqual(outcome.mode, 'stub');
  assert.strictEqual(outcome.persisted, null);
});

test('REFUSAL: no signature recorded at all', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-none', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_SIGNATURE); return true; }
  );
});

test('REFUSAL: the latest signature is HOLD, not SIGN, even though verify_quote would pass', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-hold', { overall: 'HOLD', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-hold', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
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
    () => mintGate({ store: s, runId: 'run-fab', findings: [fabricated], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
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
    () => mintGate({ store: s, runId: 'run-lawid', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'SOME_OTHER_LAW', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNRESOLVABLE_LAW_ID); return true; }
  );
});

test('REFUSAL: a catalogue-hash mismatch (finding minted against a different catalogue than the one loaded now)', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-hashmismatch', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const differentCatalogue = { content_hash: 'DIFFERENT_HASH', records: [{ id: 'UK_X', jurisdiction: 'UK' }] };
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-hashmismatch', findings: [finding], captureIndex, catalogue: differentCatalogue, coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
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

// Kimi K3 finding CRITICAL-3 (live audit 2026-07-20): checkCoverageManifest previously accepted ANY array
// for checks_planned, including an empty one, so {findings:[], checks_planned:[]} sailed a SIGN straight
// through to a "clean audit" that had run zero checks. The exact adversarial vector from the finding.
test('CRITICAL-3 (THE VACUOUS-CLEAN PROOF): a run with zero findings AND an empty checks_planned is REFUSED, never minted as "clean"', async () => {
  const s = store();
  recordSignature(s, 'run-vacuous', { overall: 'SIGN', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-vacuous', findings: [], captureIndex: null, catalogue: catalogue([]), coverageManifest: { checks_planned: [] } }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_COVERAGE_MANIFEST); return true; }
  );
});

test('CRITICAL-3: a checks_planned entry that is not a real rule id string is refused', async () => {
  const s = store();
  recordSignature(s, 'run-badplanned', { overall: 'SIGN', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-badplanned', findings: [], captureIndex: null, catalogue: catalogue([]), coverageManifest: { checks_planned: ['UK_X', ''] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_COVERAGE_MANIFEST); return true; }
  );
});

test('CRITICAL-3: a genuinely clean audit (real, non-empty coverage, zero findings) STILL mints - the fix targets the EMPTY manifest, not a clean result', async () => {
  const s = store();
  recordSignature(s, 'run-genuinely-clean', { overall: 'SIGN', findingDecisions: [] });
  const outcome = await mintGate({
    store: s, runId: 'run-genuinely-clean', findings: [], captureIndex: null, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]),
    coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
  });
  assert.strictEqual(outcome.proceeded, true);
  assert.strictEqual(outcome.findingsShipped, 0);
});

test('CRITICAL-3: a planned check that is neither run nor declared unrun (a coverage GAP) is refused', async () => {
  const s = store();
  recordSignature(s, 'run-gap', { overall: 'SIGN', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-gap', findings: [], captureIndex: null, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]),
      coverageManifest: { checks_planned: ['UK_X', 'UK_Y'], checks_run: ['UK_X'], checks_unrun: [] }, // UK_Y silently unaccounted-for
    }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_COVERAGE_MANIFEST); assert.match(err.detail, /UK_Y/); return true; }
  );
});

// Kimi K3 finding O2 (live audit 2026-07-20): checkCatalogue previously read catalogue.records straight off
// whatever it was given, so an undefined/null catalogue threw a raw, untyped TypeError instead of a typed
// MintRefusalError - Rule 4's own doctrine ("a gate that errors must block, not pass") applies to the gate's
// own inputs too.
test('O2: a missing/undefined catalogue is a TYPED refusal, never a raw TypeError', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-nocat', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-nocat', findings: [finding], captureIndex, catalogue: undefined, coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.ok(err instanceof MintRefusalError, 'must be a MintRefusalError, not a bare TypeError'); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_CATALOGUE); return true; }
  );
});

// Kimi K3 finding O7 (live audit 2026-07-20): evaluateMintGate had no duplicate-finding-id check, so the
// same finding_id appearing twice in the findings array would double-count in findingsShipped and any
// downstream per-finding accounting.
test('O7: duplicate finding_id entries in the same mint attempt are refused', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-dup', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-dup', findings: [finding, finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.DUPLICATE_FINDING_ID); assert.match(err.detail, new RegExp(finding.finding_id)); return true; }
  );
});

// Kimi K3 finding E4 (live audit 2026-07-20): mint-gate trusted any object carrying the right FIELDS as a
// Finding; a hand-built look-alike (never passed through createFinding()'s validation/branding) previously
// sailed through every structural check.
test('E4: a field-correct look-alike Finding (never produced by createFinding()) is refused before any other check runs', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const lookalike = Object.assign({}, finding); // every field copied, but not branded
  recordSignature(s, 'run-lookalike', { overall: 'SIGN', findingDecisions: [{ finding_id: lookalike.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-lookalike', findings: [lookalike], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNBRANDED_FINDING); return true; }
  );
});

// Kimi K3 finding E1 (live audit 2026-07-20), the catalogue-level leg: checkCatalogue never checked that a
// finding's OWN jurisdiction agreed with the catalogue record's declared jurisdiction, so a jurisdiction
// flip (UK->US) on an otherwise-real finding was invisible here.
test('E1 (catalogue leg): a finding whose jurisdiction disagrees with its catalogue record\'s own jurisdiction is refused', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex(); // finding.jurisdiction === 'UK'
  recordSignature(s, 'run-jurmismatch', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-jurmismatch', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'US' }]), // the catalogue says this record is US-scoped
      coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
    }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.JURISDICTION_MISMATCH); return true; }
  );
});

// Kimi K3 finding E1 (live audit 2026-07-20), THE FABRICATION PROOF at the mint-gate level: a needs_human
// finding is signed; the SAME evidence is then rebuilt with class:'confirmed' (simulating a post-signature
// rebuild). Before the fix, deriveFindingId ignored class, so the rebuilt finding landed on the IDENTICAL
// finding_id and the old signature's 'ship' decision would silently cover it. After the fix, the id differs
// and the rebuilt finding has no recorded decision - REFUSE UNDECIDED_FINDING.
test('E1 (THE POST-SIGNATURE REBUILD PROOF): signing a needs_human finding then rebuilding it as confirmed over the SAME evidence is refused as undecided, never silently inherits the old signature', async () => {
  const s = store();
  const { captureIndex, finding: needsHuman } = (() => {
    const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'Real evidenced text on a real page for real.' }] } });
    const quote = resolveQuoteSpan(captureIndex, 'https://x/', 'evidenced text');
    const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote, jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN });
    return { captureIndex, finding };
  })();
  // The human signs off on the needs_human finding specifically.
  recordSignature(s, 'run-rebuild', { overall: 'SIGN', findingDecisions: [{ finding_id: needsHuman.finding_id, decision: 'ship' }] });

  // Rebuild the SAME quote as class:'confirmed' - a post-signature rebuild attempt.
  const rebuiltConfirmed = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote: needsHuman.quote, jurisdiction: 'UK', class: FINDING_CLASS.CONFIRMED });
  assert.notStrictEqual(rebuiltConfirmed.finding_id, needsHuman.finding_id, 'the fix must give the rebuilt finding a DIFFERENT id');

  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-rebuild', findings: [rebuiltConfirmed], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
    }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNDECIDED_FINDING); return true; }
  );
});

// Kimi K3 finding E1 (live audit 2026-07-20): a legitimate stage-6 downgrade (Claude's suppress-only
// review appending a mitigation_log entry via withMitigation()) must still mint cleanly - the fix must not
// break the real, non-adversarial path. withMitigation() never touches finding_id/class/jurisdiction, so the
// signature recorded against the original finding_id still covers it after mitigation.
test('E1: a legitimate stage-6 mitigation-log entry (no class/jurisdiction change) still mints under the ORIGINAL signature', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const mitigated = withMitigation(finding, { source: 'claude-adversarial', outcome: 'verified', objection: 'none' });
  assert.strictEqual(mitigated.finding_id, finding.finding_id, 'a mitigation-log append must never change finding_id');
  recordSignature(s, 'run-legit-downgrade', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const outcome = await mintGate({
    store: s, runId: 'run-legit-downgrade', findings: [mitigated], captureIndex,
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
  });
  assert.strictEqual(outcome.proceeded, true);
});

// Kimi K3 finding O1 (live audit 2026-07-20): {stubPersist:false} with persistFn undefined previously fell
// through to isStubPersist()'s own opted-out branch and silently returned {proceeded:true, mode:'stub'} -
// a caller who explicitly asked for a LIVE mint had no way to tell nothing was ever persisted.
test('O1: stubPersist:false with no persistFn is refused, never silently downgraded to a "successful" stub mint', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-nopersistfn', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-nopersistfn', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      stubPersist: false, // explicitly opting OUT of stub mode
      // persistFn intentionally omitted
    }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_PERSIST_FN); return true; }
  );
});

// Kimi K3 finding O4 (live audit 2026-07-20): on timeout the Promise.race rejects the caller, but the
// losing persistFn promise was never actually cancelled and kept running - if it later resolved, a row was
// persisted while the system believed the mint had failed, with no trace of the disagreement anywhere.
test('O4: a timed-out persist actually signals cancellation (AbortSignal) to persistFn', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-o4-signal', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  let seenSignal = null;
  const persistFn = (findings, ctx) => { seenSignal = ctx.signal; return new Promise(() => {}); }; // never settles on its own
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-o4-signal', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      stubPersist: false, persistFn, persistTimeoutMs: 20,
    }),
    /exceeded its 20ms budget/
  );
  assert.ok(seenSignal instanceof AbortSignal, 'persistFn must be handed a real AbortSignal');
  assert.strictEqual(seenSignal.aborted, true, 'the signal must actually be aborted once the deadline fires');
});

test('O4: a persistFn that IGNORES the abort signal and settles AFTER the timeout has its late outcome RECORDED, never silently dropped', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-o4-late', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  // Simulates a v0-shaped persistFn that has no idea what AbortSignal is: it just keeps running past the
  // deadline and eventually "succeeds" (a background Neon/R2 write that completes after mint-gate already
  // told the caller it failed).
  const persistFn = () => new Promise((resolve) => setTimeout(() => resolve({ neonRowId: 7 }), 40));
  let caughtErr = null;
  try {
    await mintGate({
      store: s, runId: 'run-o4-late', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      stubPersist: false, persistFn, persistTimeoutMs: 15,
    });
    assert.fail('expected mintGate to reject with a timeout');
  } catch (e) {
    caughtErr = e;
  }
  assert.match(caughtErr.message, /exceeded its 15ms budget/);
  assert.ok(Array.isArray(caughtErr.ambiguousOutcomes), 'the timeout error must carry an ambiguousOutcomes array the caller can inspect');
  assert.strictEqual(caughtErr.ambiguousOutcomes.length, 0, 'nothing has settled yet at the instant of rejection');
  // Wait past the persistFn's own 40ms completion, then check the SAME error object learned the truth.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.strictEqual(caughtErr.ambiguousOutcomes.length, 1);
  assert.strictEqual(caughtErr.ambiguousOutcomes[0].outcome, 'settled_after_timeout');
  assert.strictEqual(caughtErr.ambiguousOutcomes[0].ok, true);
  assert.deepStrictEqual(caughtErr.ambiguousOutcomes[0].value, { neonRowId: 7 });
});

// ── Kimi K3 finding HIGH-E3 (live audit 2026-07-20): the report was outside the mint gate's integrity ──
// scope. The drafted report was not an input to evaluateMintGate, so any edit AFTER the founder signed was
// undetectable, and lintNoOrphanClaims was advisory (nothing hard-failed on ok:false). The fix binds the
// report bytes into the signature (report_sha256) AND runs the orphan-lint INSIDE the gate as a hard
// refusal. sha256Hex() here mirrors what the gate itself computes over the report bytes.
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
// reportCiting(finding) -> a report whose one factual sentence cites `finding` (so the orphan-lint passes).
function reportCiting(finding) {
  return 'The site does not display a cookie banner (Finding ' + finding.finding_id + ').';
}

test('E3 (happy path): a signed, UNEDITED report whose every claim is cited still mints', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const report = reportCiting(finding);
  recordSignature(s, 'run-e3-ok', { overall: 'SIGN', report_sha256: sha256Hex(report), findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const outcome = await mintGate({
    store: s, runId: 'run-e3-ok', findings: [finding], captureIndex,
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
    report,
  });
  assert.strictEqual(outcome.proceeded, true);
});

test('E3 (a - THE POST-SIGN EDIT PROOF): sign a report, edit ONE byte, attempt mint -> refused on report_sha256 mismatch', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const signedReport = reportCiting(finding);
  recordSignature(s, 'run-e3-edit', { overall: 'SIGN', report_sha256: sha256Hex(signedReport), findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const editedReport = signedReport + ' '; // one appended byte the founder never signed
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-e3-edit', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      report: editedReport,
    }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.REPORT_TAMPERED); return true; }
  );
});

test('E3 (b - LINT IS A HARD GATE): a signed report containing an UNCITED factual sentence is refused with the orphan-claim code', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  // The founder signed THIS exact report (hash matches), but it carries an uncited accusation - the lint,
  // running INSIDE the gate now, must still refuse it (defence in depth: a signature does not license an
  // orphaned claim).
  const orphanReport = 'The site breaches the Equality Act 2010.';
  recordSignature(s, 'run-e3-orphan', { overall: 'SIGN', report_sha256: sha256Hex(orphanReport), findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-e3-orphan', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      report: orphanReport,
    }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.ORPHAN_CLAIM); return true; }
  );
});

test('E3: a signature that COMMITTED to a report but no report is supplied at mint time is refused (the signer covered a report; minting without it is a gap)', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const report = reportCiting(finding);
  recordSignature(s, 'run-e3-missing', { overall: 'SIGN', report_sha256: sha256Hex(report), findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-e3-missing', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      // report intentionally omitted
    }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.REPORT_MISSING); return true; }
  );
});

test('E3: a report supplied at mint time that the signature NEVER committed to (no report_sha256 on the signature) is refused as unsigned', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-e3-unsigned', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] }); // NO report_sha256
  await assert.rejects(
    () => mintGate({
      store: s, runId: 'run-e3-unsigned', findings: [finding], captureIndex,
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      report: reportCiting(finding), // a report the founder never signed
    }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.REPORT_UNSIGNED); return true; }
  );
});

test('E3: a findings-only mint (no report signed, none supplied) still proceeds - the binding applies only when a report is in play', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-e3-none', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const outcome = await mintGate({
    store: s, runId: 'run-e3-none', findings: [finding], captureIndex,
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
  });
  assert.strictEqual(outcome.proceeded, true);
});

test('REFUSAL: a shipped finding was never explicitly decided in the signature (fail closed, never assume ship)', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-undecided', { overall: 'SIGN', findingDecisions: [] }); // signed, but this finding was never decided
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-undecided', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNDECIDED_FINDING); return true; }
  );
});

// Kimi K3 R2 finding A1/#2 (live audit 2026-07-20): verifyRawProvenanceDetailed existed but nothing in the
// mint path called it, so a phantom-join span (two sibling raw nodes concatenated, e.g. "Free"+"VPS" pill
// badges) that hashes cleanly on the NORMALISED side minted unchallenged. The gate now runs raw-provenance
// alongside verify_quote. resolveQuoteSpan refuses the phantom, so this hand-builds the finding to prove the
// gate itself is the second, independent line of defence.
test('A1/#2 (THE GATE-LEVEL PHANTOM PROOF): a finding whose span crosses an unpunctuated raw-run join is refused at the mint gate on raw-provenance', async () => {
  const s = store();
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{
    url: 'https://x/pricing', text: 'Free VPS', rawHtml: '<span>Free</span><span>VPS</span>',
  }] } });
  const artifact = captureIndex.list()[0];
  const spanBytes = Buffer.from('Free VPS', 'utf8');
  const spanHash = crypto.createHash('sha256').update(spanBytes).digest('hex');
  const phantom = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote: { evidence_id: artifact.evidence_id, byte_start: 0, byte_end: spanBytes.length, span_sha256: spanHash }, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  recordSignature(s, 'run-phantom', { overall: 'SIGN', findingDecisions: [{ finding_id: phantom.finding_id, decision: 'ship' }] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-phantom', findings: [phantom], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.UNVERIFIABLE_QUOTE); assert.match(err.detail, /raw-provenance: phantom_join_risk/); return true; }
  );
});

test('A1/#2: raw_unavailable (an older bundle with no rawHtml) is NOT a hard refusal - the normalised gate still governs', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-rawunavail', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const outcome = await mintGate({ store: s, runId: 'run-rawunavail', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } });
  assert.strictEqual(outcome.proceeded, true);
});

// Kimi K3 R2 finding A3/#5 (live audit 2026-07-20): a manifest carrying ONLY checks_planned (both run/unrun
// arrays absent) alongside findings:[] minted a vacuous "clean" audit that recorded zero terminal states.
test('A3/#5 (THE STATELESS-MANIFEST PROOF): checks_planned present but both run/unrun arrays absent is refused, never minted clean', async () => {
  const s = store();
  recordSignature(s, 'run-stateless', { overall: 'SIGN', findingDecisions: [] });
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-stateless', findings: [], captureIndex: null, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'] } }),
    (err) => { assert.ok(err instanceof MintRefusalError); assert.strictEqual(err.reasonCode, REFUSAL_CODES.NO_COVERAGE_MANIFEST); assert.match(err.detail, /no recorded terminal state/); return true; }
  );
});

// Kimi K3 R2 finding A21/#25 (live audit 2026-07-20): the supervised gate had no findings-count budget.
test('A21/#25: a mint attempt over the MAX_FINDINGS cap is refused', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  recordSignature(s, 'run-toomany', { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  const many = new Array(10001).fill(finding);
  await assert.rejects(
    () => mintGate({ store: s, runId: 'run-toomany', findings: many, captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } }),
    (err) => { assert.strictEqual(err.reasonCode, REFUSAL_CODES.TOO_MANY_FINDINGS); return true; }
  );
});

test('evaluateMintGate is a pure, non-throwing form usable for a preview check', async () => {
  const s = store();
  const { captureIndex, finding } = realFindingAndIndex();
  const decision = evaluateMintGate({ store: s, runId: 'never-signed', findings: [finding], captureIndex, catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] } });
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
    catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
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
      catalogue: catalogue([{ id: 'UK_X', jurisdiction: 'UK' }]), coverageManifest: { checks_planned: ['UK_X'], checks_run: ['UK_X'], checks_unrun: [] },
      stubPersist: false, persistFn: hungPersistFn, persistTimeoutMs: 25,
    }),
    /exceeded its 25ms budget/
  );
});
