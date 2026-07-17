'use strict';
// catalogue/schema.js - the Compliance Object Model (COM) schema validator.
//
// THE ONE DOOR for "is this catalogue record/pack shaped correctly". Every catalogue linter,
// compiler and future migration tool validates a record or a pack through this module and
// nowhere else (Constitution Rule 1: one door per fact - here the "fact" is the record SHAPE).
//
// validateRecord(record) -> string[] violations (empty = valid). validatePack(pack) -> string[]
// (every record's own violations, prefixed with its position/id so a flat list stays traceable).
//
// DOCTRINE (Constitution Rule 4: fail closed):
//  - Pure: no I/O, no network, no filesystem, no clock (dates are validated as STRINGS in the right
//    shape, never compared against wall-clock "now").
//  - Never throws on malformed input: a non-object record degrades to a single violation string, not a
//    crash, so the compiler's loop over untrusted pack files is never aborted by a thrown TypeError.
//  - Enum discipline (Rule 2): jurisdiction/sector/activity-tag/nexus validity come ONLY from
//    facts/vocabulary.js; this module holds no law facts and no parallel vocabulary.
//  - Ambiguity is never silently accepted: an unknown enum, a malformed URL or a wrong type all
//    produce a violation string. There is no "best effort" pass.
//
// SCOPE DECISIONS worth reading before extending this file:
//  1. sector[] accepts the vocabulary's canonical sectors (via canonicalSector, folding aliases like
//     'legal' -> 'law-firms') PLUS the sentinel 'universal' (binds regardless of sector, C-069) -
//     kept a deliberate state rather than a typo that happens to canonicalise to null.
//  2. sub_sector[] (CR-36) is enum-checked against facts/vocabulary.js CANONICAL_SUB_SECTORS (richer
//     than the SECTORS detection tree: 'attorney'/'conveyancing'/'notaries'/'immigration'). A new
//     value is added THERE first (one door, Rule 1), like sector/activity_tags/required_nexus.
//  3. sub_jurisdiction: explicit null, 'multi' (binds across sub-jurisdictions of one top-level
//     jurisdiction), or a SUB_JURISDICTIONS code for the record's own (family-folded) jurisdiction.
//     The key itself is REQUIRED; a jurisdiction with no modelled structure takes only null/'multi'.
//  4. Extra fields (e.g. the boolean `advisory` tier marker, C-055) are tolerated: REQUIRED fields
//     are checked present and well-typed; unknown fields are not rejected.

const vocabulary = require('../facts/vocabulary.js');

const STATUSES = ['candidate', 'needs_verification', 'rejected_qa'];
const CURRENCIES = ['GBP', 'USD'];
const EVIDENCE_TYPES = ['presence', 'absence', 'behavioural', 'register'];
const SECTOR_UNIVERSAL = 'universal';

const ID_RX = /^[A-Z][A-Z0-9_]*$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const CELL_RX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SLUG_RX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Small pure type guards. None of these throw.
function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}
function isArray(x) {
  return Array.isArray(x);
}
function isNonEmptyArray(x) {
  return Array.isArray(x) && x.length > 0;
}
function isBoolean(x) {
  return typeof x === 'boolean';
}

// Semantic date validation lives in its own single-door module (catalogue/valid-date.js): a regex
// proves shape only, so "2026-02-30" must still be rejected. Re-exported below as the schema facade.
const { isRealDate, isRealTimestamp } = require('./valid-date.js');
function isNullOrFiniteNonNegative(x) {
  return x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
}
function isHttpUrl(x) {
  if (typeof x !== 'string' || x.trim().length === 0) return false;
  let u;
  try { u = new URL(x); }
  catch (e) { return false; /* not a schema throw: a malformed URL IS the violation the caller reports */ }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

// Shared field-check helpers. Each pushes violation strings onto `v`; extracted so a repeated shape (a
// jurisdiction code, a real calendar date, an array of non-empty strings) is checked by ONE door.
function pushJurisdictionCode(v, value, label) {
  if (!isNonEmptyString(value)) v.push(label + ': required non-empty string');
  else if (!vocabulary.isJurisdiction(value)) {
    v.push(label + ': ' + JSON.stringify(value) + ' is not a known facts/vocabulary.js jurisdiction code');
  }
}

// pushRealDate: a required YYYY-MM-DD field that must name a REAL calendar date (shape then semantics;
// "2026-02-30" is rejected). Shared by pack.generated and both provenance dates.
function pushRealDate(v, value, label) {
  if (!isNonEmptyString(value)) v.push(label + ': required non-empty string');
  else if (!DATE_RX.test(value)) v.push(label + ': ' + JSON.stringify(value) + ' must match YYYY-MM-DD');
  else if (!isRealDate(value)) v.push(label + ': ' + JSON.stringify(value) + ' is not a real calendar date');
}

function pushNonEmptyStringElements(v, arr, elementMsg) {
  for (const e of arr) {
    if (!isNonEmptyString(e)) v.push(elementMsg);
  }
}

// pushHttpUrlField: a REQUIRED http(s) URL string field. Shared by citation.url and enforcement[].url.
function pushHttpUrlField(v, value, label) {
  if (!isNonEmptyString(value)) v.push(label + ': required non-empty string');
  else if (!isHttpUrl(value)) v.push(label + ': ' + JSON.stringify(value) + ' is not a valid http(s) URL');
}

// sector / sub_jurisdiction helpers, delegated to facts/vocabulary.js wherever a vocabulary concept
// exists (Rule 1/2: this file adds no parallel sector or jurisdiction data).
function isValidSector(sector) {
  if (sector === SECTOR_UNIVERSAL) return true;
  return vocabulary.canonicalSector(sector) !== null;
}

const SUB_JURISDICTION_GROUPS = ['states', 'nations', 'free_zones'];

// subJurisdictionHas(subDef, group, sub) -> true when subDef[group] models the code `sub`.
function subJurisdictionHas(subDef, group, sub) {
  return Boolean(subDef[group]) && Object.prototype.hasOwnProperty.call(subDef[group], sub);
}

function isValidSubJurisdiction(jurisdiction, sub) {
  if (sub === null || sub === 'multi') return true; // EXPLICIT null or the cross-sub sentinel
  if (typeof sub !== 'string' || sub.trim().length === 0) return false;
  const subDef = vocabulary.SUB_JURISDICTIONS[vocabulary.famCanon(jurisdiction)];
  if (!subDef) return false;
  return SUB_JURISDICTION_GROUPS.some((g) => subJurisdictionHas(subDef, g, sub));
}

// validateRecord(record) -> string[]. One pure validator per field group; validateRecord aggregates
// and prefixes the id tag. Message strings are pre-refactor verbatim (tests assert on them).

// id, name
function validateIdentity(record) {
  const v = [];
  if (!isNonEmptyString(record.id)) v.push('id: required non-empty string');
  else if (!ID_RX.test(record.id)) v.push('id: ' + JSON.stringify(record.id) + ' must match ' + ID_RX + ' (upper-snake identifier)');
  if (!isNonEmptyString(record.name)) v.push('name: required non-empty string');
  return v;
}

// citation {act, section, url}
function validateCitation(record) {
  const v = [];
  if (!isPlainObject(record.citation)) {
    v.push('citation: required object {act, section, url}');
  } else {
    if (!isNonEmptyString(record.citation.act)) v.push('citation.act: required non-empty string');
    if (!isNonEmptyString(record.citation.section)) v.push('citation.section: required non-empty string');
    pushHttpUrlField(v, record.citation.url, 'citation.url');
  }
  return v;
}

// jurisdiction (the record's OWN jurisdiction, per Rule 13) + sub_jurisdiction (null, 'multi', or a
// code modelled for this jurisdiction).
function validateJurisdictionFields(record) {
  const v = [];
  pushJurisdictionCode(v, record.jurisdiction, 'jurisdiction');
  // The key must be PRESENT: omission is an incomplete record, not an implicit "whole jurisdiction";
  // only an explicit null carries that meaning (JSON.parse never yields undefined for a present key).
  if (!Object.prototype.hasOwnProperty.call(record, 'sub_jurisdiction')) {
    v.push('sub_jurisdiction: required key (explicit null for whole-jurisdiction scope, "multi", or a SUB_JURISDICTIONS code) - omitting it is not an implicit null');
  } else if (!isValidSubJurisdiction(record.jurisdiction, record.sub_jurisdiction)) {
    v.push('sub_jurisdiction: ' + JSON.stringify(record.sub_jurisdiction) + ' is not null, "multi", or a facts/vocabulary.js SUB_JURISDICTIONS code for jurisdiction ' + JSON.stringify(record.jurisdiction));
  }
  return v;
}

// sector[]
function validateSectorField(record) {
  const v = [];
  if (!isNonEmptyArray(record.sector)) {
    v.push('sector: required non-empty array');
  } else {
    for (const s of record.sector) {
      if (typeof s !== 'string' || !isValidSector(s)) {
        v.push('sector: ' + JSON.stringify(s) + ' does not resolve via facts/vocabulary.js canonicalSector and is not the "universal" sentinel');
      }
    }
  }
  return v;
}

// sub_sector[] - format AND enum-checked against facts/vocabulary.js CANONICAL_SUB_SECTORS (scope
// decision 2, CR-36). isInvalidSubSectorSlug: isNonEmptyString subsumes the typeof-string check, so
// this stays a single-operator predicate.
function isInvalidSubSectorSlug(s) {
  return !isNonEmptyString(s) || !SLUG_RX.test(s);
}

function validateSubSectorField(record) {
  const v = [];
  if (!isArray(record.sub_sector)) {
    v.push('sub_sector: required array (may be empty)');
    return v;
  }
  for (const s of record.sub_sector) {
    if (isInvalidSubSectorSlug(s)) {
      v.push('sub_sector: ' + JSON.stringify(s) + ' must be a non-empty lowercase-hyphen slug');
    } else if (!vocabulary.isCanonicalSubSector(s)) {
      v.push('sub_sector: ' + JSON.stringify(s) + ' is not a facts/vocabulary.js CANONICAL_SUB_SECTORS member');
    }
  }
  return v;
}

// activity_tags[] - enum-checked via facts/vocabulary.js ACTIVITY_TAGS
function validateActivityTagsField(record) {
  const v = [];
  if (!isArray(record.activity_tags)) {
    v.push('activity_tags: required array (may be empty)');
  } else {
    for (const t of record.activity_tags) {
      if (!vocabulary.isActivityTag(t)) {
        v.push('activity_tags: ' + JSON.stringify(t) + ' is not a facts/vocabulary.js ACTIVITY_TAGS member');
      }
    }
  }
  return v;
}

// The record's vocabulary-controlled classification tags (facts/vocabulary.js is their one door).
function validateTags(record) {
  return [
    ...validateJurisdictionFields(record),
    ...validateSectorField(record),
    ...validateSubSectorField(record),
    ...validateActivityTagsField(record),
  ];
}

// required_nexus[]/applies_when[]/excluded_when[] - the attachment/exclusion conditions. required_nexus
// is enum-checked via facts/vocabulary.js NEXUS_TYPES and must be non-empty (Rule 13: a law binds
// through at least one nexus; serving is not being bound). excluded_when may be empty at schema level
// (threshold-guard enforces non-empty for threshold-bearing records, caution.md C-071).
function validateRequiredNexus(v, record) {
  if (!isNonEmptyArray(record.required_nexus)) {
    v.push('required_nexus: required non-empty array');
    return;
  }
  for (const n of record.required_nexus) {
    if (!vocabulary.isNexusType(n)) {
      v.push('required_nexus: ' + JSON.stringify(n) + ' is not a facts/vocabulary.js NEXUS_TYPES member');
    }
  }
}

function validateAppliesWhen(v, record) {
  if (!isNonEmptyArray(record.applies_when)) {
    v.push('applies_when: required non-empty array of strings');
    return;
  }
  pushNonEmptyStringElements(v, record.applies_when, 'applies_when: every entry must be a non-empty string');
}

function validateExcludedWhen(v, record) {
  if (!isArray(record.excluded_when)) {
    v.push('excluded_when: required array (may be empty)');
    return;
  }
  pushNonEmptyStringElements(v, record.excluded_when, 'excluded_when: every entry must be a non-empty string');
}

function validateNexusAndConditions(record) {
  const v = [];
  validateRequiredNexus(v, record);
  validateAppliesWhen(v, record);
  validateExcludedWhen(v, record);
  return v;
}

// website_obligations[]
// filter+map keeps pre-refactor multiplicity (one message per bad element).
function validateObligationElements(w, tag) {
  if (!isNonEmptyArray(w.elements)) return [tag + '.elements: required non-empty array of strings'];
  return w.elements.filter((el) => !isNonEmptyString(el)).map(() => tag + '.elements: every entry must be a non-empty string');
}

function validateObligationEntry(w, i) {
  const tag = 'website_obligations[' + i + ']';
  if (!isPlainObject(w)) return [tag + ': must be an object'];
  const v = [];
  if (!isNonEmptyString(w.duty)) v.push(tag + '.duty: required non-empty string');
  v.push(...validateObligationElements(w, tag));
  if (!EVIDENCE_TYPES.includes(w.evidence_type)) {
    v.push(tag + '.evidence_type: ' + JSON.stringify(w.evidence_type) + ' must be one of ' + EVIDENCE_TYPES.join('|'));
  }
  return v;
}

function validateObligations(record) {
  if (!isNonEmptyArray(record.website_obligations)) return ['website_obligations: required non-empty array'];
  return record.website_obligations.flatMap((w, i) => validateObligationEntry(w, i));
}

// penaltyLowExceedsHigh(p) -> true only when both bounds are numbers and low > high (guard-claused).
function penaltyLowExceedsHigh(p) {
  if (typeof p.typical_low !== 'number' || typeof p.typical_high !== 'number') return false;
  return p.typical_low > p.typical_high;
}

function validatePenaltyNumbers(v, p) {
  if (!isNullOrFiniteNonNegative(p.typical_low)) v.push('penalty.typical_low: must be null or a non-negative finite number');
  if (!isNullOrFiniteNonNegative(p.typical_high)) v.push('penalty.typical_high: must be null or a non-negative finite number');
  if (!isNullOrFiniteNonNegative(p.statutory_max)) v.push('penalty.statutory_max: must be null or a non-negative finite number');
  if (penaltyLowExceedsHigh(p)) {
    v.push('penalty: typical_low (' + p.typical_low + ') must not exceed typical_high (' + p.typical_high + ')');
  }
}

// penalty
function validatePenalty(record) {
  const v = [];
  if (!isPlainObject(record.penalty)) {
    v.push('penalty: required object');
    return v;
  }
  const p = record.penalty;
  validatePenaltyNumbers(v, p);
  if (!CURRENCIES.includes(p.currency)) v.push('penalty.currency: ' + JSON.stringify(p.currency) + ' must be one of ' + CURRENCIES.join('|'));
  if (!isNonEmptyString(p.basis)) v.push('penalty.basis: required non-empty string');
  if (!isBoolean(p.max_is_rare)) v.push('penalty.max_is_rare: required boolean');
  return v;
}

// regulator {name, register_url}
function validateRegulator(record) {
  const v = [];
  if (!isPlainObject(record.regulator)) {
    v.push('regulator: required object {name, register_url}');
  } else {
    if (!isNonEmptyString(record.regulator.name)) v.push('regulator.name: required non-empty string');
    if (record.regulator.register_url !== null && record.regulator.register_url !== undefined) {
      if (!isHttpUrl(record.regulator.register_url)) v.push('regulator.register_url: ' + JSON.stringify(record.regulator.register_url) + ' must be null or a valid http(s) URL');
    }
  }
  return v;
}

// validateEnforcementItem(v, e, i) -> violations for one enforcement[] entry (case/date/amount/url/
// summary), pushed with its positional tag. Extracted so validateEnforcement stays a thin driver.
function validateEnforcementItem(v, e, i) {
  const tag = 'enforcement[' + i + ']';
  if (!isPlainObject(e)) { v.push(tag + ': must be an object'); return; }
  if (!isNonEmptyString(e.case)) v.push(tag + '.case: required non-empty string');
  if (!isNonEmptyString(e.date)) v.push(tag + '.date: required non-empty string');
  if (!isNonEmptyString(e.amount)) v.push(tag + '.amount: required non-empty string');
  pushHttpUrlField(v, e.url, tag + '.url');
  if (!isNonEmptyString(e.summary)) v.push(tag + '.summary: required non-empty string');
}

// enforcement[] (may be empty)
function validateEnforcement(record) {
  const v = [];
  if (!isArray(record.enforcement)) {
    v.push('enforcement: required array (may be empty)');
    return v;
  }
  record.enforcement.forEach((e, i) => validateEnforcementItem(v, e, i));
  return v;
}

// intel {why_matters, regulator_asks_first, relevance_hook}
function validateIntel(record) {
  const v = [];
  if (!isPlainObject(record.intel)) {
    v.push('intel: required object {why_matters, regulator_asks_first, relevance_hook}');
  } else {
    if (!isNonEmptyString(record.intel.why_matters)) v.push('intel.why_matters: required non-empty string');
    if (!isNonEmptyString(record.intel.regulator_asks_first)) v.push('intel.regulator_asks_first: required non-empty string');
    if (!isNonEmptyString(record.intel.relevance_hook)) v.push('intel.relevance_hook: required non-empty string');
  }
  return v;
}

// validateProvenanceSources(v, prov) -> provenance.sources must be a non-empty array of non-empty strings.
function validateProvenanceSources(v, prov) {
  if (!isNonEmptyArray(prov.sources)) {
    v.push('provenance.sources: required non-empty array');
    return;
  }
  pushNonEmptyStringElements(v, prov.sources, 'provenance.sources: every entry must be a non-empty string');
}

// provenance {sources, seed_status, verified_date, last_synced} (Rule 14: provenance-mandatory rows;
// last_synced is mandatory). verified_date/last_synced are policed identically through pushRealDate.
function validateProvenance(record) {
  const v = [];
  if (!isPlainObject(record.provenance)) {
    v.push('provenance: required object {sources, seed_status, verified_date, last_synced}');
    return v;
  }
  const prov = record.provenance;
  validateProvenanceSources(v, prov);
  if (!isNonEmptyString(prov.seed_status)) v.push('provenance.seed_status: required non-empty string');
  pushRealDate(v, prov.verified_date, 'provenance.verified_date');
  pushRealDate(v, prov.last_synced, 'provenance.last_synced');
  return v;
}

// status, client_useful, advisory
function validateStatus(record) {
  const v = [];
  if (!STATUSES.includes(record.status)) {
    v.push('status: ' + JSON.stringify(record.status) + ' must be one of ' + STATUSES.join('|'));
  }
  if (!isBoolean(record.client_useful)) v.push('client_useful: required boolean');
  // advisory - optional, but if present must be boolean (caution.md C-055 advisory tier marker)
  if (record.advisory !== undefined && !isBoolean(record.advisory)) {
    v.push('advisory: if present must be a boolean');
  }
  return v;
}

const FIELD_GROUP_VALIDATORS = [
  validateIdentity,
  validateCitation,
  validateTags,
  validateNexusAndConditions,
  validateObligations,
  validatePenalty,
  validateRegulator,
  validateEnforcement,
  validateIntel,
  validateProvenance,
  validateStatus,
];

function validateRecord(record) {
  if (!isPlainObject(record)) return ['record is not a plain object'];
  const idTag = isNonEmptyString(record.id) ? record.id : '<no id>';
  const violations = FIELD_GROUP_VALIDATORS.flatMap((validate) => validate(record));
  return violations.map((msg) => idTag + ': ' + msg);
}

// validatePack(pack) -> string[] (decomposed so no single function exceeds the health caps).
// validatePackHeader(pack) -> violations for the pack's own scalar fields (cell, jurisdiction, and a
// real-calendar-date generated stamp).
function validatePackHeader(pack) {
  const v = [];
  if (!isNonEmptyString(pack.cell)) v.push('cell: required non-empty string');
  else if (!CELL_RX.test(pack.cell)) v.push('cell: ' + JSON.stringify(pack.cell) + ' must be a lowercase-hyphen slug');
  pushJurisdictionCode(v, pack.jurisdiction, 'jurisdiction');
  pushRealDate(v, pack.generated, 'generated');
  return v;
}

// recordJurisdictionMismatches(record, pack) -> true when the record is an object carrying a
// jurisdiction that disagrees with its pack's jurisdiction (guard-claused, no multi-operator
// conditional). validatePackRecord below threads seenIds so duplicate-id detection spans all records.
function recordJurisdictionMismatches(record, pack) {
  if (!isPlainObject(record)) return false;
  if (!isNonEmptyString(pack.jurisdiction)) return false;
  return record.jurisdiction !== pack.jurisdiction;
}

function validatePackRecord(record, i, pack, seenIds) {
  const v = validateRecord(record).map((rv) => 'records[' + i + '] ' + rv);

  if (isPlainObject(record) && isNonEmptyString(record.id)) {
    if (seenIds.has(record.id)) {
      v.push('records[' + i + '] id: ' + JSON.stringify(record.id) + ' duplicates records[' + seenIds.get(record.id) + ']');
    } else {
      seenIds.set(record.id, i);
    }
  }

  if (recordJurisdictionMismatches(record, pack)) {
    v.push('records[' + i + '] jurisdiction: ' + JSON.stringify(record.jurisdiction) + ' does not match pack jurisdiction ' + JSON.stringify(pack.jurisdiction));
  }
  return v;
}

function validatePack(pack) {
  if (!isPlainObject(pack)) return ['pack is not a plain object'];

  const v = validatePackHeader(pack);

  if (!isNonEmptyArray(pack.records)) {
    v.push('records: required non-empty array');
    return v;
  }

  const seenIds = new Map();
  pack.records.forEach((record, i) => v.push(...validatePackRecord(record, i, pack, seenIds)));
  return v;
}

module.exports = {
  STATUSES,
  CURRENCIES,
  EVIDENCE_TYPES,
  SECTOR_UNIVERSAL,
  isValidSector,
  isValidSubJurisdiction,
  isRealDate,
  isRealTimestamp,
  validateRecord,
  validatePack,
};
