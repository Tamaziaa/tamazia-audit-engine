'use strict';
// payload/contract/v1_2/core.js - the shared primitives of the payload v1.2 typed lattice (Kimi WS0).
//
// The "types" are runtime-validated constructors that BRAND each value they return in a private WeakSet, so
// a downstream constructor can require a REAL instance and a hand-built look-alike is rejected. Those brands
// live here so every constructor module in this package shares one set of them (a value branded by
// coverage.js's CoverageManifest is recognised by verdicts.js's Clean). Also here: the closed enums, the
// fail-closed guards, the one hash door, and the version/penalty constants. Pure; no network, no clock.

const crypto = require('crypto');

const PAYLOAD_V1_2_VERSION = '1.2';
const CANONICAL_PENALTY_ID = 'primary';

// The four evidence lanes (blueprint 2.2). A lane not in this set is not a lane.
const EVIDENCE_LANES = ['static', 'browser', 'register', 'probe'];
const EVIDENCE_LANE_SET = new Set(EVIDENCE_LANES);
// The breach kinds (blueprint B4 discipline 1): the proof standard differs per kind.
const BREACH_KINDS = ['violation', 'absence', 'behavioural'];
const BREACH_KIND_SET = new Set(BREACH_KINDS);
const BREACH_CLASSES = ['confirmed', 'likely'];
const BREACH_CLASS_SET = new Set(BREACH_CLASSES);
const FACT_TIERS = ['A', 'B', 'C'];
const FACT_TIER_SET = new Set(FACT_TIERS);

// ── private brands: a value is "real" only if it is in its constructor's WeakSet ──────────────────────
const brands = {
  evidence: new WeakSet(),
  quote: new WeakSet(),
  lawRef: new WeakSet(),
  penaltyRef: new WeakSet(),
  fact: new WeakSet(),
  manifest: new WeakSet(),
  certificate: new WeakSet(),
  verdict: new WeakSet(),
};

function isEvidenceRecord(v) { return brands.evidence.has(v); }
function isQuote(v) { return brands.quote.has(v); }
function isLawRef(v) { return brands.lawRef.has(v); }
function isPenaltyRef(v) { return brands.penaltyRef.has(v); }
function isFact(v) { return brands.fact.has(v); }
function isCoverageManifest(v) { return brands.manifest.has(v); }
function isCoverageCertificate(v) { return brands.certificate.has(v); }
function isVerdict(v) { return brands.verdict.has(v); }

// freeze(o, brand?) -> the deep-frozen object, added to the given brand WeakSet when one is supplied.
function freeze(o, brand) { const f = Object.freeze(o); if (brand) brand.add(f); return f; }

// ── shared guards (fail closed, Rule 4) ───────────────────────────────────────────────────────────────
function reqString(value, field, ctx) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(ctx + ': ' + field + ' must be a non-empty string (got ' + JSON.stringify(value) + ')');
  }
  return value;
}
function reqArray(value, field, ctx) {
  if (!Array.isArray(value)) throw new Error(ctx + ': ' + field + ' must be an array (got ' + JSON.stringify(value) + ')');
  return value;
}
function isNonNegInt(n) { return Number.isInteger(n) && n >= 0; }
function isBlankString(v) { return typeof v !== 'string' || v === ''; }
// plainObjectCopy(o) -> a shallow copy of a plain object, or {} when o is not one. The one door for the
// defensive object copy the evidence/coverage constructors both need (before freezing).
function plainObjectCopy(o) { return o && typeof o === 'object' ? Object.assign({}, o) : {}; }

// sha256Hex(bytes) -> the lowercase hex sha256 of a string or Buffer. The one hash door for evidence.
function sha256Hex(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = {
  PAYLOAD_V1_2_VERSION, CANONICAL_PENALTY_ID,
  EVIDENCE_LANES, EVIDENCE_LANE_SET, BREACH_KINDS, BREACH_KIND_SET, BREACH_CLASSES, BREACH_CLASS_SET, FACT_TIERS, FACT_TIER_SET,
  brands, freeze,
  isEvidenceRecord, isQuote, isLawRef, isPenaltyRef, isFact, isCoverageManifest, isCoverageCertificate, isVerdict,
  reqString, reqArray, isNonNegInt, isBlankString, plainObjectCopy, sha256Hex,
};
