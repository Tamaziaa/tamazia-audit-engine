'use strict';
// payload/composer/util.js - the small pure helpers the composer's two halves (compose.js, the
// compliance spine; sections.js, the analysis/scaffold builders) both read. It exists so those two
// files never grow their own near-duplicate copies of a coercion (the jscpd/one-door lesson) and so
// there is a single place the "id of a record" and "family key of a citation" conventions live.
//
// Pure data helpers only: no I/O, no clock, no env, no law/fine/regulator literal (Rule 2). Every
// function is total (never throws) and defensively tolerant of a missing or wrong-typed argument,
// because the composer runs over engine outputs that MAY be partial and must still produce a
// contract-valid payload rather than crash a mint.

// arr(x) -> x when it is an array, else []. The universal "iterate this safely" guard.
function arr(x) { return Array.isArray(x) ? x : []; }

// isObject(x) -> true for a plain non-null, non-array object.
function isObject(x) { return x != null && typeof x === 'object' && !Array.isArray(x); }

// str(x) -> a trimmed string for a string/number input, else ''. Never returns null/undefined, so a
// leaf built from it is always a real string (the contract's nonNull leaves and the schema's string
// finding fields both want a string, never a null masquerading as text).
function str(x) {
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

// numOrNull(x) -> a finite number, or null. The honest coercion for a penalty band leaf: a missing or
// non-numeric band is null (absent), NEVER 0 (which would read as "the fine is zero pounds"). Only a
// number or a numeric string coerces; null/undefined/''/boolean/object all return null. This guard
// matters: Number(null) === 0, so without it a band-less record would masquerade as a zero-pound band
// and mis-bucket a finding (a null band is "no figure", never "the figure is zero").
function numOrNull(x) {
  if (typeof x !== 'number' && typeof x !== 'string') return null;
  if (x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// num(x, d) -> a finite number or the default d (shares numOrNull's non-numeric guard, so num(null, d)
// is d, not 0). For counts, where an absent count falls back to the supplied default.
function num(x, d) {
  const n = numOrNull(x);
  return n == null ? d : n;
}

// recordIdOf(o) -> the record identifier off a catalogue record, a connect()-applicable entry or an
// adjudicated finding, accepting both `record_id` (findings, connect output) and `id` (raw catalogue
// records). One convention, read the same way everywhere - so a finding and its record join reliably.
function recordIdOf(o) {
  if (!isObject(o)) return '';
  if (o.record_id != null) return str(o.record_id);
  if (o.id != null) return str(o.id);
  return '';
}

// normaliseKey(s) -> a lowercase alphanumeric-token key for grouping. Used as the DEFAULT family key
// for exposure de-duplication (C-094: one ceiling per statute family) when the caller injects no
// familyKeyFn; T1 injects applicability/conflicts.js's family door in its place.
function normaliseKey(s) {
  return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = { arr, isObject, str, numOrNull, num, recordIdOf, normaliseKey };
