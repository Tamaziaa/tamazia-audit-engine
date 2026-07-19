'use strict';
// payload/contract/v1_2.test.js - the PROOF suite for the typed verdict lattice (Kimi WS0). Each test
// names the bad state and proves it is UNCONSTRUCTIBLE, not merely undesirable.

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('./v1_2.js');

// ── a self-contained synthetic compiled catalogue (no dependency on the compiled dist) ──
const CAT = {
  content_hash: 'a'.repeat(64),
  records: [
    { id: 'TEST_LAW_WITH_PENALTY', penalty: { statutory_max: 1000, currency: 'GBP', basis: 'test' } },
    { id: 'TEST_LAW_2', penalty: { statutory_max: 2000, currency: 'GBP', basis: 'test2' } },
    { id: 'TEST_LAW_NO_PENALTY', penalty: null },
    { id: 'TEST_LAW_ARRAY_PENALTY', penalty: [] },
  ],
};
const IDX = v.buildCatalogueIndex(CAT);

// helper: a real evidence record + a valid quote into it.
function realEvidenceAndQuote(text) {
  const bytes = 'Prefix. ' + text + ' Suffix.';
  const start = bytes.indexOf(text);
  const rec = v.EvidenceRecord({
    id: 'ev1', lane: 'static', url_final: 'https://x.example/', fetched_at: '2026-07-20T00:00:00Z',
    bytes_sha256: v.sha256Hex(bytes), content_type: 'text/html', status: v.evidenceStatusOK(),
  });
  const quote = v.Quote({ evidence_id: 'ev1', byte_start: start, byte_end: start + text.length, text });
  return { bytes, rec, quote };
}
function goodManifest() {
  return v.CoverageManifest({
    checks_planned: ['c1', 'c2'], checks_run: ['c1'], checks_unrun: [{ check: 'c2', reason: 'browser lane unavailable' }],
    lanes: [{ lane: 'static', status: 'OK' }], evidence_ids: ['ev1'],
    catalogue_hash: CAT.content_hash, taxonomy_version: '1.0.0', payload_version: '1.2',
  });
}

test('INVARIANT a: Clean cannot be constructed without a complete CoverageManifest', () => {
  assert.throws(() => v.Clean({}), /CoverageManifest/);
  assert.throws(() => v.Clean({ coverage: { checks_planned: [], checks_run: [], checks_unrun: [] } }), /CoverageManifest/); // a look-alike literal is refused (branding)
  const clean = v.Clean({ coverage: goodManifest() });
  assert.equal(clean.kind, 'Clean');
  assert.ok(v.isVerdict(clean));
});

test('INVARIANT a: a CoverageManifest with a planned check that is neither run nor unrun throws (no silent gap)', () => {
  assert.throws(() => v.CoverageManifest({
    checks_planned: ['c1', 'c2', 'c3'], checks_run: ['c1'], checks_unrun: [{ check: 'c2', reason: 'x' }],
    lanes: [], evidence_ids: [], catalogue_hash: CAT.content_hash, taxonomy_version: '1.0.0', payload_version: '1.2',
  }), /neither run nor declared unrun/);
});

test('R21: a checks_unrun entry with no reason throws (every unrun check names why)', () => {
  assert.throws(() => v.CoverageManifest({
    checks_planned: ['c1'], checks_run: [], checks_unrun: [{ check: 'c1' }],
    lanes: [], evidence_ids: [], catalogue_hash: CAT.content_hash, taxonomy_version: '1.0.0', payload_version: '1.2',
  }), /reason/);
});

test('INVARIANT b: an absence breach WITHOUT a threshold-met multi-method certificate yields Unknown{coverage_incomplete}', () => {
  const under = v.Breach({
    breach_kind: 'absence', class: 'confirmed',
    law: { law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash },
    penalty: { law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash },
    certificate: v.CoverageCertificate({ pages_fetched: ['/'], discovery_methods: ['sitemap'], threshold_met: false }),
  }, { catalogueIndex: IDX });
  assert.equal(under.kind, 'Unknown');
  assert.equal(under.reason_code, 'coverage_incomplete');

  // with a proper certificate (threshold_met AND >= 2 discovery methods) the absence breach is constructible.
  const ok = v.Breach({
    breach_kind: 'absence', class: 'confirmed',
    law: { law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash },
    penalty: { law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash },
    certificate: v.CoverageCertificate({ pages_fetched: ['/', '/legal'], discovery_methods: ['sitemap', 'anchor_text_lexicon'], threshold_met: true }),
  }, { catalogueIndex: IDX });
  assert.equal(ok.kind, 'Breach');
  assert.equal(ok.breach_kind, 'absence');
});

test('a Quote cannot be built from a bare string (blueprint 2.2)', () => {
  assert.throws(() => v.Quote('Book your Botox'), /NEVER a bare string/);
  assert.throws(() => v.Quote({ evidence_id: 'ev1', byte_start: 5, byte_end: 2 }), /byte_start must be <= byte_end/);
  const q = v.Quote({ evidence_id: 'ev1', byte_start: 0, byte_end: 3 });
  assert.ok(v.isQuote(q));
});

test('a violation Breach requires a REAL Quote (a look-alike offsets object is refused)', () => {
  const refs = {
    law: { law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash },
    penalty: { law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash },
  };
  assert.throws(() => v.Breach(Object.assign({ breach_kind: 'violation', class: 'confirmed', quote: { evidence_id: 'ev1', byte_start: 0, byte_end: 3 } }, refs), { catalogueIndex: IDX }), /Quote/);
  const { quote } = realEvidenceAndQuote('Book your Botox');
  const breach = v.Breach(Object.assign({ breach_kind: 'violation', class: 'confirmed', quote }, refs), { catalogueIndex: IDX });
  assert.equal(breach.kind, 'Breach');
  assert.ok(v.isLawRef(breach.law) && v.isPenaltyRef(breach.penalty));
});

test('a LawRef to a non-catalogue id throws (a claim on a law that does not exist is unrepresentable)', () => {
  assert.throws(() => v.LawRef({ law_id: 'NOT_A_REAL_LAW', catalogue_hash: CAT.content_hash }, IDX), /not in the compiled catalogue/);
  // a mismatched catalogue hash is refused too (hash-pinned).
  assert.throws(() => v.LawRef({ law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: 'b'.repeat(64) }, IDX), /does not match the pinned catalogue/);
  const ref = v.LawRef({ law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash }, IDX);
  assert.equal(ref.law_id, 'TEST_LAW_WITH_PENALTY');
});

test('a PenaltyRef absent from the catalogue throws (a penalty is copied, never generated)', () => {
  // a law that has no penalty block cannot carry a PenaltyRef.
  assert.throws(() => v.PenaltyRef({ law_id: 'TEST_LAW_NO_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash }, IDX), /not present in the hash-pinned catalogue/);
  // an ARRAY-valued penalty block is NOT a catalogued penalty (typeof [] === 'object' guard).
  assert.throws(() => v.PenaltyRef({ law_id: 'TEST_LAW_ARRAY_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash }, IDX), /not present in the hash-pinned catalogue/);
  // a fabricated penalty id on a law that HAS a penalty is refused.
  assert.throws(() => v.PenaltyRef({ law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'invented', catalogue_hash: CAT.content_hash }, IDX), /not present in the hash-pinned catalogue/);
  const p = v.PenaltyRef({ law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash }, IDX);
  assert.equal(p.penalty_id, 'primary');
});

test('a Breach cannot cross-attach a penalty from a DIFFERENT law than the one breached', () => {
  const { quote } = realEvidenceAndQuote('Book your Botox');
  assert.throws(() => v.Breach({
    breach_kind: 'violation', class: 'confirmed', quote,
    law: { law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash },
    penalty: { law_id: 'TEST_LAW_2', penalty_id: 'primary', catalogue_hash: CAT.content_hash }, // wrong law
  }, { catalogueIndex: IDX }), /does not belong to the breached law/);
});

test('an absence breach needs 2 DISTINCT discovery methods (a repeated method is not two)', () => {
  const dupCert = v.CoverageCertificate({ pages_fetched: ['/', '/legal'], discovery_methods: ['sitemap', 'sitemap'], threshold_met: true });
  assert.equal(v.certificateProvesAbsence(dupCert), false);
  const under = v.Breach({
    breach_kind: 'absence', class: 'confirmed',
    law: { law_id: 'TEST_LAW_WITH_PENALTY', catalogue_hash: CAT.content_hash },
    penalty: { law_id: 'TEST_LAW_WITH_PENALTY', penalty_id: 'primary', catalogue_hash: CAT.content_hash },
    certificate: dupCert,
  }, { catalogueIndex: IDX });
  assert.equal(under.kind, 'Unknown');
});

test('INVARIANT c: empty bytes for a required surface become a LaneError, never a value (requireBytes helper)', () => {
  assert.equal(v.requireBytes('', 'empty_body').kind, 'LaneError');
  assert.equal(v.requireBytes([], 'empty_body').kind, 'LaneError');
  assert.equal(v.requireBytes(Buffer.alloc(0), 'empty_body').kind, 'LaneError');
  assert.equal(v.requireBytes('some bytes', 'empty_body').kind, 'OK');
  // an OK EvidenceRecord cannot be built without a real 64-hex hash of non-empty bytes.
  assert.throws(() => v.EvidenceRecord({ id: 'e', lane: 'static', url_final: 'https://x/', fetched_at: 't', content_type: 'text/html', bytes_sha256: '', status: v.evidenceStatusOK() }), /64-char lowercase hex/);
  // a LaneError record needs no bytes and is a valid, non-clean surface.
  const errRec = v.EvidenceRecord({ id: 'e', lane: 'browser', status: v.laneError('browser_launch_failed') });
  assert.ok(v.isEvidenceRecord(errRec) && v.isLaneError(errRec.status));
});

test('Unknown requires reason_code AND missing (R21: reason + resolution path), and a real manifest if coverage is given', () => {
  assert.throws(() => v.Unknown({ reason_code: 'x' }), /missing/);
  assert.throws(() => v.Unknown({ missing: 'x' }), /reason_code/);
  assert.throws(() => v.Unknown({ reason_code: 'x', missing: 'y', coverage: { not: 'a manifest' } }), /CoverageManifest/);
  const u = v.Unknown({ reason_code: 'lane_unavailable', missing: 'the browser lane; retry with a working browser', coverage: goodManifest() });
  assert.equal(u.kind, 'Unknown');
});

test('Fact requires a tier in A|B|C and a confidence in [0,1]', () => {
  assert.throws(() => v.Fact({ value: 'x', tier: 'Z', confidence: 0.5 }), /tier/);
  assert.throws(() => v.Fact({ value: 'x', tier: 'A', confidence: 2 }), /confidence/);
  const f = v.Fact({ value: 'UK', tier: 'A', confidence: 0.95, signals: ['register'] });
  assert.ok(v.isFact(f) && Object.isFrozen(f));
});
