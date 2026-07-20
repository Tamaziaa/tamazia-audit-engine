'use strict';
// mint/quote-verify-gate.test.js - the mint-time gate refuses a v1.2 payload with an unverifiable quote,
// an unresolvable law, or an absent penalty, and is a proven pass-through on the v1.1 path.

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertMintablePayload } = require('./quote-verify-gate.js');
const v1_2 = require('../payload/contract/v1_2.js');
const { buildMinimalValidPayload } = require('../payload/contract/index.js');
const { sha256Hex } = require('../payload/contract/verify-quote.js');

const CAT_HASH = 'a'.repeat(64);
const CATALOGUE = {
  content_hash: CAT_HASH,
  records: [
    { id: 'REAL_LAW', penalty: { statutory_max: 500000, currency: 'GBP', basis: 'test' } },
    { id: 'LAW_NO_PENALTY', penalty: null },
  ],
};
const BYTES = 'Header. Book your Botox today from GBP 99. Footer.';
const TARGET = 'Book your Botox today';
const START = BYTES.indexOf(TARGET);
const STORE = new Map([['ev1', { bytes: BYTES, record: v1_2.EvidenceRecord({ id: 'ev1', lane: 'static', url_final: 'https://x/', fetched_at: 't', content_type: 'text/html', bytes_sha256: v1_2.sha256Hex(BYTES), status: v1_2.evidenceStatusOK() }) }]]);

function manifest() {
  return { checks_planned: ['c1'], checks_run: ['c1'], checks_unrun: [], lanes: [{ lane: 'static', status: 'OK' }], evidence_ids: ['ev1'], catalogue_hash: CAT_HASH, taxonomy_version: '1.0.0', payload_version: '1.2' };
}
function v1_2PayloadWith(verdicts) {
  // evidence declares 'ev1' by default (the id every quote()/violationVerdict() in this file references),
  // so P0-2's payload-evidence binding check (Kimi K3 R2 A14/#18: an empty array is a real declaration,
  // not an absent one, and now enforces binding) passes for the common case. Tests that need to exercise
  // the binding failure itself override p.evidence explicitly.
  const evidenceRecord = { id: 'ev1', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) };
  return { payload_version: '1.2', taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH, evidence: [evidenceRecord], verdicts, coverage: manifest() };
}
function violationVerdict(text) {
  const start = BYTES.indexOf(text);
  return {
    kind: 'Breach', breach_kind: 'violation', class: 'confirmed',
    law: { law_id: 'REAL_LAW', catalogue_hash: CAT_HASH },
    penalty: { law_id: 'REAL_LAW', penalty_id: 'primary', catalogue_hash: CAT_HASH },
    quote: { evidence_id: 'ev1', byte_start: start, byte_end: start + text.length, text, span_sha256: sha256Hex(Buffer.from(text, 'utf8')) },
  };
}
function absenceVerdict(certificate) {
  return {
    kind: 'Breach', breach_kind: 'absence', class: 'confirmed',
    law: { law_id: 'REAL_LAW', catalogue_hash: CAT_HASH },
    penalty: { law_id: 'REAL_LAW', penalty_id: 'primary', catalogue_hash: CAT_HASH },
    quote: null, certificate,
  };
}

test('a v1.1 payload passes straight through (additive: the existing mint path is untouched)', () => {
  const res = assertMintablePayload(buildMinimalValidPayload(), {});
  assert.deepEqual(res, { ok: true, version: '1.1', checkedQuotes: 0, checkedRefs: 0 });
});

test('a v1.2 payload with a real verified quote and resolvable refs is mintable', () => {
  const res = assertMintablePayload(v1_2PayloadWith([violationVerdict(TARGET)]), { catalogue: CATALOGUE, evidenceStore: STORE });
  assert.equal(res.version, '1.2');
  assert.equal(res.checkedQuotes, 1);
  assert.equal(res.checkedRefs, 2);
});

test('the mint REFUSES a v1.2 payload whose quote does not verify against the evidence (fabrication)', () => {
  const fabricated = violationVerdict(TARGET);
  fabricated.quote = { evidence_id: 'ev1', byte_start: START, byte_end: START + TARGET.length, text: 'We store nothing', span_sha256: sha256Hex(Buffer.from('We store nothing', 'utf8')) };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([fabricated]), { catalogue: CATALOGUE, evidenceStore: STORE }), /does not verify against the fetched evidence/);
});

test('the mint REFUSES a v1.2 payload with an unresolvable law_id', () => {
  const bad = violationVerdict(TARGET);
  bad.law = { law_id: 'GHOST_LAW', catalogue_hash: CAT_HASH };
  bad.penalty = { law_id: 'GHOST_LAW', penalty_id: 'primary', catalogue_hash: CAT_HASH };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([bad]), { catalogue: CATALOGUE, evidenceStore: STORE }), /not in the compiled catalogue/);
});

test('the mint REFUSES a v1.2 payload whose penalty is absent from the catalogue', () => {
  const bad = violationVerdict(TARGET);
  bad.law = { law_id: 'LAW_NO_PENALTY', catalogue_hash: CAT_HASH };
  bad.penalty = { law_id: 'LAW_NO_PENALTY', penalty_id: 'primary', catalogue_hash: CAT_HASH };
  assert.throws(() => assertMintablePayload(v1_2PayloadWith([bad]), { catalogue: CATALOGUE, evidenceStore: STORE }), /not present in the hash-pinned catalogue/);
});

test('the mint fails closed when a v1.2 breach carries a quote but no evidence store was supplied', () => {
  const p = v1_2PayloadWith([violationVerdict(TARGET)]);
  // declare the matching evidence record so the P0-2 binding check (evidence declared -> must resolve)
  // passes first, isolating this test to the evidenceStore-missing failure it's named for.
  p.evidence = [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }];
  assert.throws(() => assertMintablePayload(p, { catalogue: CATALOGUE }), /no evidenceStore/);
});

test('the mint REFUSES a structurally invalid v1.2 payload (a coverage gap)', () => {
  const bad = v1_2PayloadWith([]);
  bad.coverage.checks_planned = ['c1', 'c2'];
  assert.throws(() => assertMintablePayload(bad, { catalogue: CATALOGUE }), /structurally invalid/);
});

test('when the payload declares its own evidence, a quote must reference one of those records', () => {
  const p = v1_2PayloadWith([violationVerdict(TARGET)]);
  // declare an evidence record with a DIFFERENT id than the quote references (ev1).
  p.evidence = [{ id: 'other', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }];
  assert.throws(() => assertMintablePayload(p, { catalogue: CATALOGUE, evidenceStore: STORE }), /not among the payload's own evidence records/);
  // with the matching record declared, it mints.
  p.evidence = [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }];
  assert.equal(assertMintablePayload(p, { catalogue: CATALOGUE, evidenceStore: STORE }).checkedQuotes, 1);
});

// ── CRITICAL-2 repro: a self-certified "we searched everywhere and found nothing" absence breach ────────
// decode.js's structural check (threshold_met===true, >=2 distinct discovery_methods) already refuses a
// certificate with threshold_met:false or fewer than 2 methods (proven by the decode.test.js suite this
// gate depends on). What it CANNOT catch: threshold_met is a bare boolean the certificate's own producer
// sets, with no derivation from pages_fetched/planned/fetched, so a certificate claiming zero real pages
// fetched can still self-assert threshold_met:true and sail through structural validation.
test('CRITICAL-2: the mint REFUSES an absence Breach whose certificate shows ZERO genuine pages fetched, despite a self-asserted threshold_met:true', () => {
  const fabricatedCert = { pages_fetched: [], discovery_methods: ['guess', 'random'], planned: 0, fetched: 0, failed: [], threshold_met: true };
  const bad = v1_2PayloadWith([absenceVerdict(fabricatedCert)]);
  assert.throws(
    () => assertMintablePayload(bad, { catalogue: CATALOGUE }),
    /shows no genuine search/
  );
});

test('CRITICAL-2: a genuine absence Breach certificate (real pages fetched, threshold met, 3 distinct methods) mints', () => {
  // Kimi K3 R2 A4/#6: the degenerate floor now requires >=3 distinct non-empty pages_fetched URLs.
  const realCert = { pages_fetched: ['/privacy', '/terms', '/cookies'], discovery_methods: ['sitemap', 'footer_scan'], planned: 3, fetched: 3, failed: [], threshold_met: true };
  const good = v1_2PayloadWith([absenceVerdict(realCert)]);
  const res = assertMintablePayload(good, { catalogue: CATALOGUE });
  assert.equal(res.ok, true);
});

// ── HIGH-4 repro: version-confusion downgrade ─────────────────────────────────────────────────────────
// Before the fix: assertMintablePayload routed purely on the DECLARED payload_version. A payload carrying
// a v1.2-shaped verdicts[] array (Breach/Clean/Unknown `kind` fields, fabricated law/quote inside) but
// omitting payload_version (or declaring a stale '1.1') fell through as a silent v1.1 pass-through
// (checkedQuotes:0, checkedRefs:0): the mint never re-verified a single quote, law or penalty in it.
test('HIGH-4: a v1.2-shaped verdicts[] payload with NO declared payload_version is NOT silently passed through as v1.1', () => {
  const shaped = {
    // payload_version deliberately omitted
    taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH, evidence: [],
    verdicts: [violationVerdict(TARGET)],
    coverage: manifest(),
  };
  // shape-sniffed into the v1.2 lattice path (not the old silent 0/0 v1.1 pass-through): the lattice
  // validator then correctly refuses it for lacking the required payload_version field - "shape-sniff, or
  // refuse as malformed" (HIGH-4's fix), never mint under the weaker v1.1 contract that never checks a
  // fabricated law/quote inside lattice-shaped verdicts at all.
  assert.throws(
    () => assertMintablePayload(shaped, { catalogue: CATALOGUE, evidenceStore: STORE }),
    /structurally invalid.*payload_version must be/
  );
});

test('HIGH-4: a v1.2-shaped verdicts[] payload that DOES declare payload_version "1.2" and is otherwise complete mints and is fully checked', () => {
  const shaped = {
    payload_version: '1.2',
    taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH,
    evidence: [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, url_final: 'https://x/', fetched_at: 't', bytes_sha256: v1_2.sha256Hex(BYTES) }],
    verdicts: [violationVerdict(TARGET)],
    coverage: manifest(),
  };
  const res = assertMintablePayload(shaped, { catalogue: CATALOGUE, evidenceStore: STORE });
  assert.equal(res.version, '1.2');
  assert.equal(res.checkedQuotes, 1);
  assert.equal(res.checkedRefs, 2);
});

test('HIGH-4: a v1.2-shaped verdicts[] payload declaring a stale payload_version "1.1" is refused, not passed through', () => {
  const shaped = {
    payload_version: '1.1',
    taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH, evidence: [],
    verdicts: [violationVerdict(TARGET)],
    coverage: manifest(),
  };
  assert.throws(
    () => assertMintablePayload(shaped, { catalogue: CATALOGUE, evidenceStore: STORE }),
    /structurally invalid|payload_version must be/
  );
});

test('HIGH-4: a genuinely v1.1 payload (no lattice-shaped verdicts) still passes straight through', () => {
  const res = assertMintablePayload(buildMinimalValidPayload(), {});
  assert.deepEqual(res, { ok: true, version: '1.1', checkedQuotes: 0, checkedRefs: 0 });
});

// ── Kimi K3 R2 #9: a lattice verdict that carries a `quote` object but NO `kind` field must not slip past
// the shape-sniff. Before this fix, looksLikeV1_2Verdicts matched only on `kind`, so a hand-assembled or
// buggy-producer verdict shaped like { quote: {...} } with no `kind` fell through to the v1.1 pass-through
// and its quote was never re-verified (checkedQuotes:0).
test('#9: a v1.2-shaped verdicts[] payload with a `quote` object but no `kind` field is NOT silently passed through as v1.1', () => {
  const shaped = {
    // payload_version omitted; verdict carries `quote` but deliberately no `kind`
    taxonomy_version: '1.0.0', catalogue_hash: CAT_HASH, evidence: [],
    verdicts: [{ quote: { evidence_id: 'ev1', byte_start: 0, byte_end: 4, text: 'oops', span_sha256: sha256Hex(Buffer.from('oops', 'utf8')) } }],
    coverage: manifest(),
  };
  assert.throws(
    () => assertMintablePayload(shaped, { catalogue: CATALOGUE, evidenceStore: STORE }),
    /structurally invalid.*payload_version must be/
  );
});

// ── Kimi K3 R2 #32: the verdict-count budget must gate BEFORE the structural decoder walks the payload, so
// an oversized payload is refused by the cheap length check rather than by an unbounded validator pass.
test('#32: an oversized v1.2 verdicts[] array is refused by the budget cap even when otherwise structurally invalid', () => {
  const tooMany = new Array(5001).fill(0).map(() => ({ kind: 'Breach' }));
  const bad = v1_2PayloadWith(tooMany);
  assert.throws(
    () => assertMintablePayload(bad, { catalogue: CATALOGUE }),
    /over the MAX_VERDICTS cap/
  );
});
