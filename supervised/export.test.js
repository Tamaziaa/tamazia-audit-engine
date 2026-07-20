'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { ManifestStore } = require('./manifest-store.js');
const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');
const { signFinding, rejectFinding } = require('./signoff.js');
const { exportRun, stateFor } = require('./export.js');

function tmpStore() {
  return new ManifestStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-')) });
}

test('stateFor maps derived status to the wire label', () => {
  assert.strictEqual(stateFor('confirmed'), 'CONFIRMED');
  assert.strictEqual(stateFor('rejected'), 'rejected');
  assert.strictEqual(stateFor('needs_human'), 'needs_review');
  assert.strictEqual(stateFor('bogus'), 'needs_review'); // fail closed
});

test('exportRun: confirmed finding carries a Ctrl-F-able evidence_quote and CONFIRMED state', () => {
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'THE VERBATIM TEXT is here' }] } });
  const span = resolveQuoteSpan(captureIndex, 'https://x/', 'THE VERBATIM TEXT');
  const finding = createFinding({ rule_id: 'UK_PECR_COOKIES_MARKETING', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN });
  const manifest = tmpStore();
  const runId = 'run-export-a';
  manifest.append(runId, 'run_start', { site: 'https://x/', engine_version: 'engine-v2.12.0-sign', catalogue_hash: 'h' });
  manifest.append(runId, 'applicability', { counts: {}, applicable: [finding.rule_id], excludedCount: 5 });
  manifest.append(runId, 'candidate_findings', { findingCount: 1, findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, jurisdiction: finding.jurisdiction, evidence_kind: finding.evidence_kind, quote: finding.quote, coverage: null }] });
  signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', note: 'checked live', captureIndex });

  const payload = exportRun(manifest, runId, { captureIndex, catalogue: { records: [{ id: finding.rule_id, jurisdiction: 'UK', title: 'PECR cookies' }] } });
  assert.strictEqual(payload.kind, 'audit-payload');
  assert.strictEqual(payload.rules.assessed, 6);
  assert.strictEqual(payload.rules.applicable, 1);
  assert.strictEqual(payload.pointers.length, 1);
  const p = payload.pointers[0];
  assert.strictEqual(p.state, 'CONFIRMED');
  assert.strictEqual(p.applicable, true);
  assert.strictEqual(p.jurisdiction, 'UK');
  assert.ok(p.evidence_quote.includes('THE VERBATIM TEXT'));
  assert.strictEqual(p.evidence_sha256, span.span_sha256);
});

test('exportRun: rejected finding stays in export with state "rejected" (never dropped, never CONFIRMED)', () => {
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'turnover related SOME MATCH text' }] } });
  const span = resolveQuoteSpan(captureIndex, 'https://x/', 'SOME MATCH');
  const finding = createFinding({ rule_id: 'UK_MODERN_SLAVERY_S54', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN });
  const manifest = tmpStore();
  const runId = 'run-export-b';
  manifest.append(runId, 'run_start', { site: 'https://x/', engine_version: 'test', catalogue_hash: 'h' });
  manifest.append(runId, 'applicability', { counts: {}, applicable: [], excludedCount: 1 });
  manifest.append(runId, 'candidate_findings', { findingCount: 1, findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, jurisdiction: finding.jurisdiction, evidence_kind: finding.evidence_kind, quote: finding.quote, coverage: null }] });
  rejectFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', reason: 's54 turnover threshold not met' });

  const payload = exportRun(manifest, runId, { captureIndex, catalogue: { records: [] } });
  assert.strictEqual(payload.pointers.length, 1);
  assert.strictEqual(payload.pointers[0].state, 'rejected');
  assert.strictEqual(payload.pointers[0].applicable, false);
});

test('exportRun: unsigned needs_human finding exports as needs_review, never CONFIRMED', () => {
  const captureIndex = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'privacy text ANOTHER MATCH here' }] } });
  const span = resolveQuoteSpan(captureIndex, 'https://x/', 'ANOTHER MATCH');
  const finding = createFinding({ rule_id: 'UK_X', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN });
  const manifest = tmpStore();
  const runId = 'run-export-c';
  manifest.append(runId, 'run_start', { site: 'https://x/', engine_version: 'test', catalogue_hash: 'h' });
  manifest.append(runId, 'applicability', { counts: {}, applicable: [finding.rule_id], excludedCount: 0 });
  manifest.append(runId, 'candidate_findings', { findingCount: 1, findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, jurisdiction: finding.jurisdiction, evidence_kind: finding.evidence_kind, quote: finding.quote, coverage: null }] });
  const payload = exportRun(manifest, runId, { captureIndex, catalogue: { records: [] } });
  assert.strictEqual(payload.pointers[0].state, 'needs_review');
});
