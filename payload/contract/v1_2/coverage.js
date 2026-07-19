'use strict';
// payload/contract/v1_2/coverage.js - CoverageManifest and CoverageCertificate (Kimi WS0, blueprint 2.2 /
// B4). The manifest is the proof-of-completeness Clean depends on (invariant a). The certificate is the
// discovery proof an ABSENCE breach requires (invariant b). The manifest RULE (checks_run union
// checks_unrun == checks_planned, every unrun names why) lives in ./manifest-errors.js so validation and
// construction stay apart; this module only constructs (and brands) the frozen records.
//
// This module imports the shared taxonomy (Rule 22): when a caller omits taxonomy_version, the manifest
// stamps it from the taxonomy package's one door, so a payload's taxonomy_version is never a stray literal.

const core = require('./core.js');
const taxonomy = require('../../../taxonomy/index.js');
const { coverageManifestErrors } = require('./manifest-errors.js');

const { brands, freeze, reqArray, isCoverageCertificate, plainObjectCopy } = core;

// withTaxonomyVersion(spec) -> the spec with taxonomy_version defaulted from the shared taxonomy package
// when the caller omits it (Rule 22: the current version has one door). An explicit value (e.g. replaying
// an older payload) is left untouched.
function withTaxonomyVersion(spec) {
  const s = spec || {};
  if (s.taxonomy_version != null) return s;
  return Object.assign({}, s, { taxonomy_version: taxonomy.TAXONOMY_VERSION });
}
// frozenUnrunEntry / frozenLane: the two frozen sub-records the manifest carries.
function frozenUnrunEntry(e) { return Object.freeze({ check: String(e.check), reason: String(e.reason) }); }
function frozenLane(l) { return Object.freeze({ lane: String(l.lane), status: String(l.status) }); }
function CoverageManifest(spec) {
  const s = withTaxonomyVersion(spec);
  const errs = coverageManifestErrors(s);
  if (errs.length) throw new Error('CoverageManifest: ' + errs.join('; '));
  const m = {
    checks_planned: freeze(s.checks_planned.map(String)),
    checks_run: freeze(s.checks_run.map(String)),
    checks_unrun: freeze(s.checks_unrun.map(frozenUnrunEntry)),
    lanes: freeze(s.lanes.map(frozenLane)),
    evidence_ids: freeze(s.evidence_ids.map(String)),
    catalogue_hash: s.catalogue_hash,
    taxonomy_version: s.taxonomy_version,
    payload_version: s.payload_version,
  };
  return freeze(m, brands.manifest);
}

// finiteOrZero(n) -> n or 0. (plainObjectCopy is the shared one-door helper from core.js.)
function finiteOrZero(n) { return Number.isFinite(n) ? n : 0; }
// CoverageCertificate(spec) -> a frozen, branded certificate (the SHAPE). The >=2-method / threshold_met
// RULE is enforced where it matters, at Breach() for an absence breach (certificateProvesAbsence).
function CoverageCertificate(spec) {
  const s = spec || {};
  const c = {
    pages_fetched: freeze(reqArray(s.pages_fetched, 'pages_fetched', 'CoverageCertificate').map(String)),
    discovery_methods: freeze(reqArray(s.discovery_methods, 'discovery_methods', 'CoverageCertificate').map(String)),
    page_classes_searched: Object.freeze(plainObjectCopy(s.page_classes_searched)),
    planned: finiteOrZero(s.planned),
    fetched: finiteOrZero(s.fetched),
    failed: freeze(Array.isArray(s.failed) ? s.failed.map(String) : []),
    threshold_met: s.threshold_met === true,
  };
  return freeze(c, brands.certificate);
}
// certificateProvesAbsence(cert) -> true iff the certificate can support an absence breach: threshold met
// AND at least two independent discovery methods agree (blueprint B4 rule).
function certificateProvesAbsence(cert) {
  if (!isCoverageCertificate(cert)) return false;
  if (cert.threshold_met !== true) return false;
  // >= 2 DISTINCT methods: ['search','search'] is one method twice, not two independent agreeing methods
  // (CodeRabbit PR #33; blueprint B4 requires two INDEPENDENT discovery methods).
  return new Set(cert.discovery_methods).size >= 2;
}

module.exports = { CoverageManifest, coverageManifestErrors, CoverageCertificate, certificateProvesAbsence };
