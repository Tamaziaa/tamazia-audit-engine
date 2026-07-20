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
const { signFinding, rejectFinding, deriveStatus, SignoffError } = require('./signoff.js');

function tmpStore() {
  return new ManifestStore({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-test-')) });
}

function seedRun(store, runId, finding) {
  store.append(runId, 'run_start', { site: 'https://x/', engine_version: 'test', catalogue_hash: 'h' });
  store.append(runId, 'candidate_findings', {
    findingCount: 1,
    findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, jurisdiction: finding.jurisdiction, evidence_kind: finding.evidence_kind, quote: finding.quote, coverage: finding.coverage || null }],
  });
}

function quoteFinding() {
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x/', text: 'we do not have a modern slavery statement THE MATCH here' }] } });
  const span = resolveQuoteSpan(store, 'https://x/', 'THE MATCH');
  const finding = createFinding({ rule_id: 'UK_TEST', catalogue_hash: 'h', quote: span, jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN });
  return { store, finding };
}

test('signFinding: refuses to sign an unevidenced finding (no captureIndex to re-verify against)', () => {
  const { finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-a';
  seedRun(manifest, runId, finding);
  assert.throws(() => signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', captureIndex: null }), (e) => e instanceof SignoffError && e.code === 'unevidenced_finding');
  assert.strictEqual(deriveStatus(manifest, runId, finding.finding_id), 'needs_human');
});

test('signFinding: signs a re-verified finding and flips status to confirmed', () => {
  const { store, finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-b';
  seedRun(manifest, runId, finding);
  const entry = signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', note: 'verified on site', captureIndex: store });
  assert.strictEqual(entry.type, 'signoff');
  assert.strictEqual(entry.evidence_sha256, finding.quote.span_sha256);
  assert.strictEqual(deriveStatus(manifest, runId, finding.finding_id), 'confirmed');
});

test('signFinding: refuses to re-sign a finding that is not needs_human', () => {
  const { store, finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-c';
  seedRun(manifest, runId, finding);
  signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', captureIndex: store });
  assert.throws(() => signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', captureIndex: store }), (e) => e instanceof SignoffError && e.code === 'not_needs_human');
});

test('rejectFinding: requires a mandatory reason', () => {
  const { finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-d';
  seedRun(manifest, runId, finding);
  assert.throws(() => rejectFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder' }), (e) => e instanceof SignoffError && e.code === 'reason_required');
});

test('rejectFinding: with a reason, flips status to rejected and the finding stays in the manifest', () => {
  const { finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-e';
  seedRun(manifest, runId, finding);
  rejectFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', reason: 's54 turnover threshold not met' });
  assert.strictEqual(deriveStatus(manifest, runId, finding.finding_id), 'rejected');
  // append-only: the candidate_findings entry (and thus the finding record) is still present.
  const entries = manifest.entriesOfStage(runId, 'candidate_findings');
  assert.strictEqual(entries[0].findings.length, 1);
});

test('signFinding: refuses on a drifted/mismatched span even with a captureIndex supplied', () => {
  const { store, finding } = quoteFinding();
  const drifted = createFinding({ rule_id: finding.rule_id, catalogue_hash: 'h', jurisdiction: 'UK', class: FINDING_CLASS.NEEDS_HUMAN, quote: Object.assign({}, finding.quote, { span_sha256: '0'.repeat(64) }) });
  const manifest = tmpStore();
  const runId = 'run-f';
  seedRun(manifest, runId, drifted);
  assert.throws(() => signFinding(manifest, runId, { findingId: drifted.finding_id, signer: 'founder', captureIndex: store }), (e) => e instanceof SignoffError && e.code === 'unevidenced_finding');
});

test('signFinding: a finding with PERSISTED evidence is signable with NO live store (the fix)', () => {
  const { finding } = quoteFinding();
  const manifest = tmpStore();
  const runId = 'run-persisted';
  manifest.append(runId, 'run_start', { site: 'https://x/', engine_version: 'test', catalogue_hash: 'h' });
  // Persist the evidence onto the candidate_findings record, exactly as run-harness.js now does at run time.
  manifest.append(runId, 'candidate_findings', {
    findingCount: 1,
    findings: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, class: finding.class, jurisdiction: finding.jurisdiction, evidence_kind: finding.evidence_kind, quote: finding.quote, coverage: null, evidence_quote: 'we do not have a modern slavery statement THE MATCH', evidence_sha256: finding.quote.span_sha256, checked_urls: ['https://x/'] }],
  });
  // No captureIndex passed - a separate `engine sign` process with no live crawl.
  const entry = signFinding(manifest, runId, { findingId: finding.finding_id, signer: 'founder', note: 'verified on live site', captureIndex: null });
  assert.strictEqual(entry.type, 'signoff');
  assert.strictEqual(deriveStatus(manifest, runId, finding.finding_id), 'confirmed');
});
