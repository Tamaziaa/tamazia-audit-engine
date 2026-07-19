'use strict';
// payload/contract/v1_2.js - THE public barrel for the typed verdict lattice of payload v1.2 (Kimi WS0,
// blueprint 2.2). These constructors make the failure modes the engine has already shipped UNCONSTRUCTIBLE,
// not merely tested against: incapacity cannot be rendered as health, and a fabricated quote/law/penalty is
// a type error. CommonJS has no static types, so the "types" are runtime-validated constructors that fail
// closed and BRAND each value in a private WeakSet (payload/contract/v1_2/core.js), so a downstream
// constructor can require a REAL instance and a hand-built look-alike is rejected.
//
// The implementation is split into a small cohesive package so no one file carries the whole lattice:
//   v1_2/core.js       shared brands, enums, guards, the one hash door, the version constants
//   v1_2/evidence.js   EvidenceRecord + typed lane status + Quote (offsets, never a string)
//   v1_2/catalogue.js  the hash-pinned catalogue index + LawRef / PenaltyRef
//   v1_2/coverage.js   CoverageManifest (the Clean invariant) + CoverageCertificate (the absence invariant)
//   v1_2/verdicts.js   Fact + the Breach | Clean | Unknown lattice
// This barrel re-exports the exact same API the rest of the engine imports (decode.js, verify-quote.js,
// mint/quote-verify-gate.js). Every consumer imports THIS module, never a sub-file directly.
//
// VERSIONING NOTE: the RENDER payload contract in payload/contract/index.js + payload.schema.json is at its
// own minor "1.2.0" (it reached that minor when P6 added coverageCaveats). That is a DIFFERENT axis from
// Kimi's "payload v1.1 vs v1.2": the CURRENT minted payload (findings[] + applicability, string quotes) is
// "v1.1", and THIS typed lattice is "v1.2". The versioned decoder (payload/contract/decode.js) routes a
// payload with no payload_version (or '1.1') to the existing render-contract validator and '1.2' here. The
// existing v1.1 path is byte-untouched; v1.2 lives alongside it (additive).

const core = require('./v1_2/core.js');
const evidence = require('./v1_2/evidence.js');
const catalogue = require('./v1_2/catalogue.js');
const coverage = require('./v1_2/coverage.js');
const verdicts = require('./v1_2/verdicts.js');

module.exports = {
  // constants + enums
  PAYLOAD_V1_2_VERSION: core.PAYLOAD_V1_2_VERSION,
  CANONICAL_PENALTY_ID: core.CANONICAL_PENALTY_ID,
  EVIDENCE_LANES: core.EVIDENCE_LANES,
  BREACH_KINDS: core.BREACH_KINDS,
  BREACH_CLASSES: core.BREACH_CLASSES,
  FACT_TIERS: core.FACT_TIERS,
  // evidence + quote
  EvidenceRecord: evidence.EvidenceRecord,
  laneError: evidence.laneError,
  evidenceStatusOK: evidence.evidenceStatusOK,
  requireBytes: evidence.requireBytes,
  Quote: evidence.Quote,
  sha256Hex: core.sha256Hex,
  // catalogue + refs
  buildCatalogueIndex: catalogue.buildCatalogueIndex,
  LawRef: catalogue.LawRef,
  PenaltyRef: catalogue.PenaltyRef,
  // coverage
  CoverageManifest: coverage.CoverageManifest,
  coverageManifestErrors: coverage.coverageManifestErrors,
  CoverageCertificate: coverage.CoverageCertificate,
  certificateProvesAbsence: coverage.certificateProvesAbsence,
  // verdict lattice
  Fact: verdicts.Fact,
  Breach: verdicts.Breach,
  Clean: verdicts.Clean,
  Unknown: verdicts.Unknown,
  // brand membership tests
  isEvidenceRecord: core.isEvidenceRecord,
  isQuote: core.isQuote,
  isLawRef: core.isLawRef,
  isPenaltyRef: core.isPenaltyRef,
  isFact: core.isFact,
  isCoverageManifest: core.isCoverageManifest,
  isCoverageCertificate: core.isCoverageCertificate,
  isVerdict: core.isVerdict,
  isLaneError: evidence.isLaneError,
  isEvidenceStatusOK: evidence.isEvidenceStatusOK,
};
