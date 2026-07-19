'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildPacketHtml } = require('./packet.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');
const { lintNoOrphanClaims } = require('./orphan-lint.js');

// A syntactically-valid 64-char lowercase-hex span_sha256 (shape-valid per finding.js's SPAN_HASH_RE). The
// packet renders findings from their typed fields (finding_id/rule_id/class/quote) and never re-runs
// verify_quote itself, so a fixture value need not be a real hash of anything - it only needs to satisfy
// createFinding()'s mandatory-field shape check.
const FAKE_SPAN_HASH = 'b'.repeat(64);

function sampleRun() {
  const finding = createFinding({ rule_id: 'UK_PECR_CONSENT', catalogue_hash: 'HASH1', quote: { evidence_id: 'ev1', byte_start: 0, byte_end: 10, span_sha256: FAKE_SPAN_HASH }, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY });
  return {
    runId: 'run-abc123', site: 'https://example.com', refusal: null, engineVersion: 'engine-v2.1.6-p4', catalogueHash: 'HASH1',
    entityCard: { domain: 'example.com', identity: {}, jurisdiction: {}, sector: {} },
    applicabilityLedger: { entries: [{ law_id: 'UK_PECR_CONSENT', decision: 'applies', reason: null }] },
    candidateFindings: [finding],
    excerpts: [{ finding_id: finding.finding_id, rule_id: finding.rule_id, excerpt: { evidence_id: 'ev1', url: 'https://example.com/', before: 'before text ', quote_text: 'THE QUOTE', after: ' after text' } }],
    coverageManifest: { checks_planned: ['UK_PECR_CONSENT'], checks_run: ['UK_PECR_CONSENT'], checks_unrun: [] },
    lintResult: lintNoOrphanClaims('We detected a cookie consent issue (Finding ' + finding.finding_id + ').', [finding]),
  };
}

test('buildPacketHtml produces a single self-contained HTML document (no external fetch/link/script src)', () => {
  const html = buildPacketHtml(sampleRun());
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<link\s/i);
  assert.doesNotMatch(html, /src=["']https?:/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
});

test('the packet renders every candidate finding with its highlighted quote', () => {
  const html = buildPacketHtml(sampleRun());
  assert.match(html, /<mark>THE QUOTE<\/mark>/);
  assert.match(html, /UK_PECR_CONSENT/);
});

test('the packet renders the applicability ledger and coverage manifest', () => {
  const html = buildPacketHtml(sampleRun());
  assert.match(html, /Applicability ledger/);
  assert.match(html, /checks_planned/);
});

test('the packet renders a ship/drop control per finding and one SIGN/HOLD control for the run', () => {
  const html = buildPacketHtml(sampleRun());
  assert.match(html, /value="ship"/);
  assert.match(html, /value="drop"/);
  assert.match(html, /value="SIGN"/);
  assert.match(html, /value="HOLD"/);
});

test('the packet reports the no-orphan lint result', () => {
  const html = buildPacketHtml(sampleRun());
  assert.match(html, /no-orphan lint: PASS/);
});

test('a run with zero candidate findings still produces a valid, honest packet', () => {
  const run = Object.assign({}, sampleRun(), { candidateFindings: [], excerpts: [] });
  const html = buildPacketHtml(run);
  assert.match(html, /no candidate findings survived stage 5/);
});

test('user-controlled text is HTML-escaped (no raw injection from a hostile rule_id/site)', () => {
  const run = sampleRun();
  run.site = '<img src=x onerror=alert(1)>';
  const html = buildPacketHtml(run);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img/);
});

// CodeRabbit review (PR #36): plain JSON.stringify never escapes '<', so a run.runId (CLI-supplied via
// --run-id) containing a literal "</script>" would close the packet's own inline <script> block early and
// let arbitrary markup run when a reviewer opens the packet - the same class of hole esc() already closes
// for the rest of the document, just inside a <script> context where HTML-escaping is the wrong tool
// (safeJson's < escape is the right one there).
test('a hostile run_id containing "</script>" cannot close the inline script tag early', () => {
  const run = sampleRun();
  run.runId = 'run-</script><script>alert(1)</script>';
  const html = buildPacketHtml(run);
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
  assert.match(html, /run_id: "run-\\u003c\/script>/);
});
