'use strict';
// payload/contract/decode.js - the VERSIONED decoder (Kimi WS0, deliverable 5). One door that reads a
// payload's version and routes it to the right validator, so both the old render-contract payload and the
// new typed verdict lattice can flow through the same seam without either learning about the other.
//
//   payloadVersionOf(payload)        -> '1.2' (the typed lattice) or '1.1' (everything else / legacy).
//   validatePayloadVersioned(payload)-> string[] of contract errors for the DETECTED version (empty = ok).
//   validateV1_2(payload)            -> string[] of structural errors for a v1.2 lattice payload.
//   decodePayload(payload)           -> { version, errors, ok }.
//
// v1.1 still validates through payload/contract/index.js (byte-untouched); v1.2 is the new target. A
// payload with no `payload_version` is treated as v1.1 (that is exactly what the current mint emits), so
// the existing path is unaffected. The runtime constructors in v1_2.js remain the real enforcement for a
// live-constructed lattice; validateV1_2 is the structural check for a payload that arrived as plain JSON
// (e.g. read back from Neon for replay), reusing v1_2.js's own CoverageManifest rule so the coverage
// union invariant has exactly one definition (Rule 1).

const { validatePayload } = require('./index.js');
const v1_2 = require('./v1_2.js');
const schema = require('../schema/payload.v1_2.schema.json');

const V1_2 = v1_2.PAYLOAD_V1_2_VERSION; // '1.2'
const EVIDENCE_LANE_SET = new Set(v1_2.EVIDENCE_LANES);
const BREACH_KIND_SET = new Set(v1_2.BREACH_KINDS);
const BREACH_CLASS_SET = new Set(v1_2.BREACH_CLASSES);
const HEX64 = /^[0-9a-f]{64}$/;

// payloadVersionOf(payload) -> '1.2' only when the payload explicitly carries payload_version '1.2';
// anything else (absent, '1.1', legacy) is the v1.1 render-contract payload.
function payloadVersionOf(payload) {
  return payload && payload.payload_version === V1_2 ? V1_2 : '1.1';
}

// ── v1.2 structural validation (pure, zero-dep) ─────────────────────────────────────────────────────────
function reqNonEmptyString(obj, key, ctx, errors) {
  if (typeof obj[key] !== 'string' || obj[key] === '') errors.push(ctx + '.' + key + ' must be a non-empty string');
}
function checkEnvelopeTop(p, errors) {
  if (p.payload_version !== V1_2) errors.push('payload_version must be "' + V1_2 + '"');
  reqNonEmptyString(p, 'taxonomy_version', 'payload', errors);
  if (typeof p.catalogue_hash !== 'string' || !HEX64.test(p.catalogue_hash)) errors.push('catalogue_hash must be a 64-char lowercase hex string');
  if (!Array.isArray(p.evidence)) errors.push('evidence must be an array');
  if (!Array.isArray(p.verdicts)) errors.push('verdicts must be an array');
  if (p.coverage == null || typeof p.coverage !== 'object') errors.push('coverage must be a CoverageManifest object');
}
function notObject(x) { return !x || typeof x !== 'object'; }
function badStatus(st) { return !st || (st.kind !== 'OK' && st.kind !== 'LaneError'); }
function badHex64(v) { return typeof v !== 'string' || !HEX64.test(v); }
// checkEvidenceStatus(rec, ctx, errors): the OK|LaneError branch. An OK record must carry the SAME fields
// the EvidenceRecord constructor demands (url_final, fetched_at, a 64-hex bytes_sha256), so a replayed JSON
// record cannot pass validateV1_2 in a shape the constructor would never mint (CodeRabbit PR #33).
function checkEvidenceStatus(rec, ctx, errors) {
  const st = rec.status;
  if (badStatus(st)) { errors.push(ctx + '.status must be OK or LaneError'); return; }
  if (st.kind === 'LaneError') { reqNonEmptyString(st, 'reason_code', ctx + '.status', errors); return; }
  reqNonEmptyString(rec, 'url_final', ctx, errors);
  reqNonEmptyString(rec, 'fetched_at', ctx, errors);
  if (badHex64(rec.bytes_sha256)) errors.push(ctx + '.bytes_sha256 must be 64-char hex on an OK record (empty bytes for a required surface must be a LaneError)');
}
// checkEvidence(rec, i, errors): an evidence record's id/lane/status shape.
function checkEvidence(rec, i, errors) {
  const ctx = 'evidence[' + i + ']';
  if (notObject(rec)) { errors.push(ctx + ' must be an object'); return; }
  reqNonEmptyString(rec, 'id', ctx, errors);
  if (!EVIDENCE_LANE_SET.has(rec.lane)) errors.push(ctx + '.lane must be one of ' + v1_2.EVIDENCE_LANES.join('|'));
  checkEvidenceStatus(rec, ctx, errors);
}
// checkCoverageManifest(cov, ctx, errors): reuse v1_2.coverageManifestErrors so the union invariant
// (checks_run union checks_unrun == checks_planned, every unrun has a reason) has ONE definition and no
// exception crosses this boundary (the constructor throws on the same list; the decoder collects it).
function checkCoverageManifest(cov, ctx, errors) {
  for (const e of v1_2.coverageManifestErrors(cov)) errors.push(ctx + ': ' + e);
}
// checkBreachVerdict / checkVerdict: structural per-kind shape. Catalogue resolution of law/penalty is the
// mint-time gate's job (it has the catalogue index); here we only assert the shape is present and typed.
// absenceCertProves(cert) -> true iff a plain (decoded) certificate object proves absence: threshold_met
// AND >= 2 discovery methods. Splits the multi-term test out of checkBreachVerdict (branching cap).
function absenceCertProves(cert) {
  if (!cert || cert.threshold_met !== true) return false;
  if (!Array.isArray(cert.discovery_methods)) return false;
  return new Set(cert.discovery_methods).size >= 2; // >= 2 DISTINCT methods (CodeRabbit PR #33)
}
// badQuoteShape(q) -> the quote is not a { evidence_id:string, byte_start:int, byte_end:int } shape,
// matching the evidence.js Quote constructor and the schema. Catalogue RESOLUTION stays the mint-time
// gate's job; here we only assert the SHAPE is present and typed (CodeRabbit PR #33).
function badQuoteShape(q) {
  if (!q || typeof q.evidence_id !== 'string') return true;
  return !Number.isInteger(q.byte_start) || !Number.isInteger(q.byte_end);
}
// checkBreachProof(vd, ctx, errors): the per-kind proof requirement (absence -> certificate; else quote).
function checkBreachProof(vd, ctx, errors) {
  if (vd.breach_kind === 'absence') {
    if (!absenceCertProves(vd.certificate)) errors.push(ctx + ': an absence Breach requires a CoverageCertificate with threshold_met true and >= 2 discovery methods (invariant b)');
    return;
  }
  if (badQuoteShape(vd.quote)) errors.push(ctx + ': a ' + vd.breach_kind + ' Breach requires a Quote { evidence_id, byte_start (int), byte_end (int) }');
}
// badLawRef / badPenaltyRef -> the ref is not the shape the schema pattern (64-hex catalogue_hash) and the
// v1_2/catalogue.js constructors require.
function badLawRef(law) {
  if (!law || typeof law.law_id !== 'string') return true;
  return badHex64(law.catalogue_hash);
}
function badPenaltyRef(p) {
  if (!p || typeof p.penalty_id !== 'string') return true;
  if (typeof p.law_id !== 'string') return true;
  return badHex64(p.catalogue_hash);
}
// penaltyLawMismatch(vd) -> true when both refs are present but the penalty belongs to a different law than
// the breach (the cross-attach fabrication; the constructor rejects it too).
function penaltyLawMismatch(vd) {
  if (!vd.law || !vd.penalty) return false; // shape errors are reported above; do not double-report
  return vd.penalty.law_id !== vd.law.law_id;
}
function checkBreachVerdict(vd, ctx, errors) {
  if (!BREACH_KIND_SET.has(vd.breach_kind)) errors.push(ctx + '.breach_kind must be one of ' + v1_2.BREACH_KINDS.join('|'));
  if (!BREACH_CLASS_SET.has(vd.class)) errors.push(ctx + '.class must be confirmed|likely');
  if (badLawRef(vd.law)) errors.push(ctx + '.law must be a LawRef { law_id, catalogue_hash (64-hex) }');
  if (badPenaltyRef(vd.penalty)) errors.push(ctx + '.penalty must be a PenaltyRef { law_id, penalty_id, catalogue_hash (64-hex) }');
  if (penaltyLawMismatch(vd)) errors.push(ctx + '.penalty.law_id must equal .law.law_id (a penalty belongs to its own law)');
  checkBreachProof(vd, ctx, errors);
}
function checkVerdict(vd, i, errors) {
  const ctx = 'verdicts[' + i + ']';
  if (!vd || typeof vd !== 'object') { errors.push(ctx + ' must be an object'); return; }
  if (vd.kind === 'Breach') { checkBreachVerdict(vd, ctx, errors); return; }
  if (vd.kind === 'Clean') { checkCoverageManifest(vd.coverage, ctx + '.coverage', errors); return; }
  if (vd.kind === 'Unknown') {
    reqNonEmptyString(vd, 'reason_code', ctx, errors);
    reqNonEmptyString(vd, 'missing', ctx, errors);
    return;
  }
  errors.push(ctx + '.kind must be Breach|Clean|Unknown');
}
function validateV1_2(payload) {
  const errors = [];
  const p = payload || {};
  checkEnvelopeTop(p, errors);
  if (errors.length) return errors; // top-level shape broken: deeper checks would be noise
  p.evidence.forEach((rec, i) => checkEvidence(rec, i, errors));
  p.verdicts.forEach((vd, i) => checkVerdict(vd, i, errors));
  checkCoverageManifest(p.coverage, 'coverage', errors);
  return errors;
}

// validatePayloadVersioned(payload) -> the errors array for the DETECTED version. v1.1 routes to the
// existing render-contract validator (byte-untouched); v1.2 to validateV1_2.
function validatePayloadVersioned(payload) {
  return payloadVersionOf(payload) === V1_2 ? validateV1_2(payload) : validatePayload(payload);
}
function decodePayload(payload) {
  const version = payloadVersionOf(payload);
  const errors = validatePayloadVersioned(payload);
  return { version, errors, ok: errors.length === 0 };
}

// ── selftest (node payload/contract/decode.js --selftest) ────────────────────────────────────────────────
function minimalValidV1_2() {
  const catHash = 'a'.repeat(64);
  const cov = {
    checks_planned: ['c1'], checks_run: ['c1'], checks_unrun: [],
    lanes: [{ lane: 'static', status: 'OK' }], evidence_ids: ['ev1'],
    catalogue_hash: catHash, taxonomy_version: '1.0.0', payload_version: V1_2,
  };
  return {
    payload_version: V1_2, taxonomy_version: '1.0.0', catalogue_hash: catHash,
    evidence: [{ id: 'ev1', lane: 'static', status: { kind: 'OK' }, bytes_sha256: 'b'.repeat(64), url_final: 'https://x/', fetched_at: 't', content_type: 'text/html' }],
    verdicts: [{ kind: 'Clean', coverage: cov }],
    coverage: cov,
  };
}
function selftest() {
  const errors = [];
  // 1. a minimal valid v1.2 payload validates clean.
  const good = validateV1_2(minimalValidV1_2());
  if (good.length) errors.push('minimal valid v1.2 payload flagged: ' + good.join(', '));
  // 2. an empty payload is NOT a valid v1.2 (the validator must reject).
  if (validateV1_2({}).length === 0) errors.push('validateV1_2({}) returned no errors - validator broken');
  // 3. the version router: a payload with no payload_version is v1.1 and routes to the render-contract validator.
  if (payloadVersionOf({}) !== '1.1') errors.push('a payload with no payload_version must route to v1.1');
  if (payloadVersionOf({ payload_version: V1_2 }) !== V1_2) errors.push('a payload_version 1.2 must route to v1.2');
  // 4. the schema and the validator agree on the required top-level keys.
  const schemaReq = (schema.required || []).slice().sort().join(',');
  const validatorReq = ['catalogue_hash', 'coverage', 'evidence', 'payload_version', 'taxonomy_version', 'verdicts'].join(',');
  if (schemaReq !== validatorReq) errors.push('schema.required (' + schemaReq + ') != validator required keys (' + validatorReq + ')');
  return errors;
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    const errs = selftest();
    if (errs.length) { console.error('payload v1.2 decoder selftest FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
    console.log('payload v1.2 decoder selftest OK: minimal valid payload accepted, empty rejected, version router + schema/validator in sync (schema payload_version ' + schema.payload_version + ').');
    process.exit(0);
  }
  console.error('Usage: node payload/contract/decode.js --selftest');
  process.exit(2);
}

module.exports = { payloadVersionOf, validateV1_2, validatePayloadVersioned, decodePayload, schema };
