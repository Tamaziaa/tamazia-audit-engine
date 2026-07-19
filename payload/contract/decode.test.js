'use strict';
// payload/contract/decode.test.js - the versioned decoder routes v1.1 to the render-contract validator
// and v1.2 to the lattice validator; the selftest is exercised in-process.

const test = require('node:test');
const assert = require('node:assert/strict');

const decode = require('./decode.js');
const { buildMinimalValidPayload } = require('./index.js');

test('decoder selftest passes in-process', () => {
  // re-run the module's own selftest logic by importing its pieces: a minimal v1.2 payload validates clean.
  const errs = decode.validateV1_2({
    payload_version: '1.2', taxonomy_version: '1.0.0', catalogue_hash: 'a'.repeat(64),
    evidence: [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, bytes_sha256: 'b'.repeat(64), url_final: 'https://x/', fetched_at: 't', content_type: 'text/html' }],
    verdicts: [], coverage: { checks_planned: [], checks_run: [], checks_unrun: [], lanes: [], evidence_ids: [], catalogue_hash: 'a'.repeat(64), taxonomy_version: '1.0.0', payload_version: '1.2' },
  });
  assert.deepEqual(errs, []);
});

test('a v1.1 payload (no payload_version) routes to the render-contract validator and still validates', () => {
  const v11 = buildMinimalValidPayload();
  assert.equal(decode.payloadVersionOf(v11), '1.1');
  const res = decode.decodePayload(v11);
  assert.equal(res.version, '1.1');
  assert.deepEqual(res.errors, []); // the existing v1.1 contract is byte-untouched and still green
});

test('a v1.2 payload with a coverage gap is rejected (union invariant flows through the decoder)', () => {
  const bad = {
    payload_version: '1.2', taxonomy_version: '1.0.0', catalogue_hash: 'a'.repeat(64),
    evidence: [], verdicts: [],
    coverage: { checks_planned: ['c1', 'c2'], checks_run: ['c1'], checks_unrun: [], lanes: [], evidence_ids: [], catalogue_hash: 'a'.repeat(64), taxonomy_version: '1.0.0', payload_version: '1.2' },
  };
  const res = decode.decodePayload(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /neither run nor declared unrun/.test(e)));
});

test('an empty object is not a valid v1.2 payload', () => {
  assert.ok(decode.validateV1_2({}).length > 0);
});

test('a v1.2 absence-Breach verdict with a weak certificate is rejected structurally', () => {
  const p = {
    payload_version: '1.2', taxonomy_version: '1.0.0', catalogue_hash: 'a'.repeat(64),
    evidence: [], coverage: { checks_planned: [], checks_run: [], checks_unrun: [], lanes: [], evidence_ids: [], catalogue_hash: 'a'.repeat(64), taxonomy_version: '1.0.0', payload_version: '1.2' },
    verdicts: [{
      kind: 'Breach', breach_kind: 'absence', class: 'confirmed',
      law: { law_id: 'X', catalogue_hash: 'a'.repeat(64) },
      penalty: { law_id: 'X', penalty_id: 'primary', catalogue_hash: 'a'.repeat(64) },
      certificate: { pages_fetched: ['/'], discovery_methods: ['sitemap'], threshold_met: false },
    }],
  };
  assert.ok(decode.validateV1_2(p).some((e) => /absence Breach requires a CoverageCertificate/.test(e)));
});
