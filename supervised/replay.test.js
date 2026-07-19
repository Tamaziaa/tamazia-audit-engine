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
const { replayRun } = require('./replay.js');

function store() {
  return new ManifestStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-replay-')) });
}

// seedRun() builds a quote the ONE way this repo allows (quote-resolver.js's resolveQuoteSpan - see its own
// header: "the ONLY place a candidate's quote text is converted into a byte range"), so the resulting
// Finding carries a genuine span_sha256 and genuinely PASSES verify_quote when the stored bytes are intact
// - exactly what the "ok:true, zero incidents" replay test below needs to prove for real.
function seedRun(s, runId, text) {
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text } ] } });
  const quote = resolveQuoteSpan(captureIndex, 'https://x/', 'EVIDENCED');
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'HASH1', quote, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  s.append(runId, 'run_start', { site: 'https://x/', catalogue_hash: 'HASH1' });
  s.append(runId, 'candidate_findings', { findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, quote: finding.quote }] });
  recordSignature(s, runId, { overall: 'SIGN', findingDecisions: [{ finding_id: finding.finding_id, decision: 'ship' }] });
  return { captureIndex, finding };
}

test('replayRun reports ok:true and zero incidents when the shipped finding still verifies against the stored bytes', () => {
  const s = store();
  const { captureIndex } = seedRun(s, 'run-replay-ok', 'this text contains an EVIDENCED phrase for real');
  const report = replayRun({ store: s, runId: 'run-replay-ok', captureIndex, catalogue: { content_hash: 'HASH1' } });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.incidents.length, 0);
  assert.strictEqual(report.checkedCount, 1);
});

test('REPLAY INCIDENT: a shipped finding that no longer verifies (artifact bytes changed) is flagged, not silently passed', () => {
  const s = store();
  const { captureIndex } = seedRun(s, 'run-replay-bad', 'this text contains an EVIDENCED phrase for real');
  captureIndex.list()[0].bytes[0] ^= 0xff; // simulate a post-ship tamper/corruption
  const report = replayRun({ store: s, runId: 'run-replay-bad', captureIndex, catalogue: { content_hash: 'HASH1' } });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.incidents.length, 1);
  assert.strictEqual(report.incidents[0].reasonCode, 'hash_mismatch');
});

test('replayRun with no captureIndex reports NO_STORE_FOR_MANIFEST honestly rather than a false pass', () => {
  const s = store();
  seedRun(s, 'run-replay-nostore', 'text with EVIDENCED phrase');
  const report = replayRun({ store: s, runId: 'run-replay-nostore', catalogue: { content_hash: 'HASH1' } });
  assert.ok(report.notes.some((n) => n.startsWith('NO_STORE_FOR_MANIFEST')));
});

test('replayRun on a run with no manifest at all reports ok:false with an explanatory note', () => {
  const s = store();
  const report = replayRun({ store: s, runId: 'never-ran' });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.checkedCount, 0);
});

test('replayRun on a run with no signature reports ok:false (nothing was ever shipped)', () => {
  const s = store();
  s.append('run-nosig', 'run_start', { site: 'https://x/' });
  s.append('run-nosig', 'candidate_findings', { findings: [] });
  const report = replayRun({ store: s, runId: 'run-nosig' });
  assert.strictEqual(report.ok, false);
  assert.match(report.notes[0], /no signature/);
});

// CodeRabbit review (PR #36): a shipped finding_id with NO matching record in the run's latest
// candidate_findings snapshot (e.g. a later rerun produced a different candidate set) must never be
// silently excluded from checkedCount/incidents - that is a vacuous ok:true (caution.md C-236). It is now
// its own typed incident (reasonCode 'missing_finding_record'), so replay can never report success while
// some shipped finding was never actually re-verified.
test('REPLAY INCIDENT: a shipped finding_id absent from the latest candidate_findings snapshot is flagged, never silently excluded', () => {
  const s = store();
  const { captureIndex, finding } = seedRun(s, 'run-replay-missing', 'this text contains an EVIDENCED phrase for real');
  // The LATEST signature ships BOTH the real seeded finding (present on candidate_findings, genuinely
  // verifiable) AND a second finding_id that was never recorded there at all (re-signing overwrites which
  // decisions are "latest" - signature-store.js's own doc).
  recordSignature(s, 'run-replay-missing', {
    overall: 'SIGN',
    findingDecisions: [
      { finding_id: finding.finding_id, decision: 'ship' },
      { finding_id: 'never-recorded-finding-id', decision: 'ship' },
    ],
  });
  const report = replayRun({ store: s, runId: 'run-replay-missing', captureIndex, catalogue: { content_hash: 'HASH1' } });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.shippedCount, 2);
  assert.strictEqual(report.checkedCount, 1); // only the real, found record was actually quote-checked
  assert.ok(report.incidents.some((inc) => inc.findingId === 'never-recorded-finding-id' && inc.reasonCode === 'missing_finding_record'));
});

test('catalogue_drift is noted when the currently-loaded catalogue hash differs from the run-time one', () => {
  const s = store();
  const { captureIndex } = seedRun(s, 'run-drift', 'this text contains an EVIDENCED phrase for real');
  const report = replayRun({ store: s, runId: 'run-drift', captureIndex, catalogue: { content_hash: 'A_DIFFERENT_HASH' } });
  assert.ok(report.notes.some((n) => n.startsWith('catalogue_drift')));
});
