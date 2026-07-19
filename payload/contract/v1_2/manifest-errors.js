'use strict';
// payload/contract/v1_2/manifest-errors.js - coverageManifestErrors: THE one definition of the coverage
// manifest rule (Kimi WS0, invariant a / R21, Rule 1). Split out of coverage.js so the manifest's
// VALIDATION (branchy by nature: five field-shape checks, per-entry reason checks, and the run/unrun/planned
// partition) lives apart from its CONSTRUCTION. CoverageManifest() throws when this returns non-empty, and
// payload/contract/decode.js collects it, so the union invariant has a single door.

const { isBlankString } = require('./core.js');

// oneUnrunEntryErrors(e) -> the error strings for a single checks_unrun entry (empty when valid).
function oneUnrunEntryErrors(e) {
  if (!e || typeof e !== 'object') return ['every checks_unrun entry must be { check, reason }'];
  const errs = [];
  if (isBlankString(e.check)) errs.push('checks_unrun[].check must be a non-empty string');
  if (isBlankString(e.reason)) errs.push('checks_unrun[].reason must be a non-empty string (R21: an unrun check always names why)');
  return errs;
}
// hasCheckName(e) -> true when a checks_unrun entry is an object carrying a non-blank check name.
function hasCheckName(e) {
  if (!e || typeof e !== 'object') return false;
  return !isBlankString(e.check);
}
function unrunEntryErrors(checks_unrun) {
  const errors = [];
  const names = [];
  for (const e of checks_unrun) {
    errors.push(...oneUnrunEntryErrors(e));
    if (hasCheckName(e)) names.push(e.check);
  }
  return { errors, names };
}

// disjointErrors / notInPlannedErrors / gapErrors: the three partition checks between the run, unrun and
// planned sets, each its own single-loop unit so coversPlannedErrors stays a flat concatenation.
function disjointErrors(runSet, unrunSet) {
  const errors = [];
  for (const c of runSet) if (unrunSet.has(c)) errors.push('check ' + JSON.stringify(c) + ' is in BOTH checks_run and checks_unrun');
  return errors;
}
function notInPlannedErrors(label, set, plannedSet) {
  const errors = [];
  for (const c of set) if (!plannedSet.has(c)) errors.push('checks_' + label + ' has ' + JSON.stringify(c) + ' which is not in checks_planned');
  return errors;
}
function isUnaccounted(c, runSet, unrunSet) { return !runSet.has(c) && !unrunSet.has(c); }
function gapErrors(plannedSet, runSet, unrunSet) {
  const errors = [];
  for (const c of plannedSet) if (isUnaccounted(c, runSet, unrunSet)) errors.push('planned check ' + JSON.stringify(c) + ' is neither run nor declared unrun - a planned check with no outcome is a silent coverage gap (blueprint 2.2)');
  return errors;
}
// coversPlannedErrors(planned, run, unrunNames) -> string[]: the run set and the unrun set must be disjoint
// and together exactly equal the planned set.
function coversPlannedErrors(planned, run, unrunNames) {
  const plannedSet = new Set(planned);
  const runSet = new Set(run);
  const unrunSet = new Set(unrunNames);
  return [
    ...disjointErrors(runSet, unrunSet),
    ...notInPlannedErrors('run', runSet, plannedSet),
    ...notInPlannedErrors('unrun', unrunSet, plannedSet),
    ...gapErrors(plannedSet, runSet, unrunSet),
  ];
}

const MANIFEST_ARRAY_FIELDS = ['checks_planned', 'checks_run', 'checks_unrun', 'lanes', 'evidence_ids'];
const MANIFEST_STRING_FIELDS = ['catalogue_hash', 'taxonomy_version', 'payload_version'];
function manifestShapeErrors(s) {
  const errors = [];
  for (const key of MANIFEST_ARRAY_FIELDS) if (!Array.isArray(s[key])) errors.push(key + ' must be an array');
  for (const key of MANIFEST_STRING_FIELDS) if (isBlankString(s[key])) errors.push(key + ' must be a non-empty string');
  return errors;
}
// STRING_ELEMENT_FIELDS: the arrays whose elements MUST already be strings. checks_planned/checks_run feed
// the partition Sets, so a non-string element that String()-coerces to an existing key (e.g. 1 and '1')
// would silently collide and mask a real gap; guard against it before .map(String) (CodeRabbit PR #33).
const STRING_ELEMENT_FIELDS = ['checks_planned', 'checks_run', 'evidence_ids'];
function nonStringElementErrors(s) {
  const errors = [];
  for (const key of STRING_ELEMENT_FIELDS) {
    if (s[key].some((x) => typeof x !== 'string')) errors.push(key + '[] must contain only strings');
  }
  return errors;
}
// coverageManifestErrors(spec) -> string[] of reasons the spec is NOT a valid manifest (empty = valid).
function coverageManifestErrors(spec) {
  const s = spec || {};
  const shape = manifestShapeErrors(s);
  if (shape.length) return shape; // shape broken; the checks below would be noise
  const elem = nonStringElementErrors(s);
  if (elem.length) return elem; // non-string elements would collide under String() coercion below
  const { errors: unrunErrors, names } = unrunEntryErrors(s.checks_unrun);
  return [...unrunErrors, ...coversPlannedErrors(s.checks_planned.map(String), s.checks_run.map(String), names)];
}

module.exports = { coverageManifestErrors };
