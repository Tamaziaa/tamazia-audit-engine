'use strict';
// catalogue/schema.js - the Compliance Object Model (COM) schema validator.
//
// THE ONE DOOR for "is this catalogue record/pack shaped correctly". Every catalogue linter,
// compiler and future migration tool validates a record or a pack through this module and
// nowhere else (Constitution Rule 1: one door per fact - here the "fact" is the record SHAPE).
//
// validateRecord(record) -> string[] violations (empty = valid)
// validatePack(pack)     -> string[] violations (empty = valid; includes every record's own
//                            violations, prefixed with the record's position/id so a flat list
//                            is still traceable back to source)
//
// DOCTRINE (Constitution Rule 4: fail closed):
//  - Pure. No I/O, no network, no filesystem, no clock (except reading Date.now() nowhere at
//    all - "generated"/"verified_date" are validated as STRINGS in the right shape, never
//    compared against wall-clock "now").
//  - Never throws on malformed input: a record that is not even an object degrades to a single
//    violation string, not a crash. The catalogue compiler calls this in a loop over untrusted
//    pack files and a thrown TypeError must never abort the whole run.
//  - Enum discipline: uniform tags/vocab tokens are validated ONLY through facts/vocabulary.js
//    (Constitution Rule 2: this module holds no catalogue law facts and defines no parallel
//    vocabulary - jurisdiction/sector/activity-tag/nexus validity all come from vocabulary.js).
//  - Ambiguity is never silently accepted: an unknown enum value, a malformed URL, a wrong type
//    all produce a violation string. There is no "best effort" pass.
//
// SCOPE DECISIONS worth reading before extending this file:
//
//  1. sector[] accepts the vocabulary's canonical sectors (via canonicalSector, which folds
//     aliases like 'legal' -> 'law-firms') PLUS the sentinel 'universal'. 'universal' is NOT a
//     vocabulary sector - facts/sector.js's SECTORS tree is a SITE-DETECTION taxonomy (it exists
//     to classify a crawled website), whereas 'universal' names a catalogue-authoring concept:
//     a law that binds regardless of sector (caution.md C-069: "sector-agnostic law without an
//     explicit baseline entry fails the linter" - the schema is the guard that keeps 'universal'
//     a distinct, deliberate state rather than a typo that happens to canonicalise to null).
//
//  2. sub_sector[] (CR-36, CodeRabbit PR #3: "sector, sub-sector, jurisdiction, and nexus
//     identifiers come ONLY from facts/vocabulary.js") is enum-checked against
//     facts/vocabulary.js CANONICAL_SUB_SECTORS - a flat, deliberately RICHER canonical set than
//     the SECTORS tree's own `sub` detection nodes (e.g. healthcare's tree has 6 regex-detection
//     sub-nodes, built to classify a crawled page). CANONICAL_SUB_SECTORS is the union of every
//     SECTORS[x].sub key PLUS every sub_sector value actually authored across the catalogue packs
//     at the time this gate landed (e.g. law-firms records' 'attorney', 'conveyancing', 'notaries',
//     'immigration' - none of which are detection-tree keys, because authoring a
//     licensed-profession/activity taxonomy for law attachment is a different job from detecting a
//     sector from raw page text). Adding a genuinely new sub_sector value means adding it to
//     CANONICAL_SUB_SECTORS first (one door, Constitution Rule 1), exactly like `sector`,
//     `activity_tags` and `required_nexus` already require.
//
//  3. sub_jurisdiction accepts null, the sentinel 'multi' (a law that binds across more than one
//     sub-jurisdiction inside the same top-level jurisdiction - seen in real US privacy-wave
//     records), or a code present in facts/vocabulary.js SUB_JURISDICTIONS for the record's own
//     (family-folded) jurisdiction. A jurisdiction with no modelled sub-jurisdiction structure at
//     all can only take null or 'multi'.
//
//  4. Extra fields (e.g. the boolean `advisory` tier marker, caution.md C-055) are tolerated:
//     this validator checks that REQUIRED fields are present and well-typed, it does not reject
//     unknown fields. A closed-field gate would make every future field addition a breaking
//     change to a file this module does not own.

const vocabulary = require('../facts/vocabulary.js');

const STATUSES = ['candidate', 'needs_verification', 'rejected_qa'];
const CURRENCIES = ['GBP', 'USD'];
const EVIDENCE_TYPES = ['presence', 'absence', 'behavioural', 'register'];
const SECTOR_UNIVERSAL = 'universal';

const ID_RX = /^[A-Z][A-Z0-9_]*$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const CELL_RX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SLUG_RX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------------
// Small pure type guards. None of these throw.
// ---------------------------------------------------------------------------------
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
// proves shape only, so "2026-02-30" must still be rejected. Re-exported below so schema stays the
// facade its callers already import.
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

// ---------------------------------------------------------------------------------
// sector / sub_jurisdiction helpers, delegated to facts/vocabulary.js wherever a vocabulary
// concept exists (Rule 1/2: this file adds no parallel sector or jurisdiction data).
// ---------------------------------------------------------------------------------
function isValidSector(sector) {
  if (sector === SECTOR_UNIVERSAL) return true;
  return vocabulary.canonicalSector(sector) !== null;
}

function isValidSubJurisdiction(jurisdiction, sub) {
  if (sub === null || sub === undefined) return true;
  if (sub === 'multi') return true;
  if (typeof sub !== 'string' || sub.trim().length === 0) return false;
  const fam = vocabulary.famCanon(jurisdiction);
  const subDef = vocabulary.SUB_JURISDICTIONS[fam];
  if (!subDef) return false;
  if (subDef.states && Object.prototype.hasOwnProperty.call(subDef.states, sub)) return true;
  if (subDef.nations && Object.prototype.hasOwnProperty.call(subDef.nations, sub)) return true;
  if (subDef.free_zones && Object.prototype.hasOwnProperty.call(subDef.free_zones, sub)) return true;
  return false;
}

// ---------------------------------------------------------------------------------
// validateRecord(record) -> string[]
//
// Decomposed into one validator per field group, each pure and independently
// under the health-gate caps (tools/health-gate/check.js): validateRecord itself
// is a flat aggregator that concatenates every group's violations, then prefixes
// the whole list with the record's id tag. Message strings are unchanged from the
// pre-refactor monolith (tests assert on them verbatim).
// ---------------------------------------------------------------------------------

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
    if (!isNonEmptyString(record.citation.url)) v.push('citation.url: required non-empty string');
    else if (!isHttpUrl(record.citation.url)) v.push('citation.url: ' + JSON.stringify(record.citation.url) + ' is not a valid http(s) URL');
  }
  return v;
}

// jurisdiction (required_nexus/applicability layer; the record's OWN jurisdiction, per Rule 13)
// + sub_jurisdiction: null, 'multi', or a code modelled for this jurisdiction
function validateJurisdictionFields(record) {
  const v = [];
  if (!isNonEmptyString(record.jurisdiction)) v.push('jurisdiction: required non-empty string');
  else if (!vocabulary.isJurisdiction(record.jurisdiction)) {
    v.push('jurisdiction: ' + JSON.stringify(record.jurisdiction) + ' is not a known facts/vocabulary.js jurisdiction code');
  }
  if (!isValidSubJurisdiction(record.jurisdiction, record.sub_jurisdiction)) {
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

// sub_sector[] - format AND enum-checked against facts/vocabulary.js CANONICAL_SUB_SECTORS
// (see file header, scope decision 2, and CR-36)
function validateSubSectorField(record) {
  const v = [];
  if (!isArray(record.sub_sector)) {
    v.push('sub_sector: required array (may be empty)');
  } else {
    for (const s of record.sub_sector) {
      if (typeof s !== 'string' || !isNonEmptyString(s) || !SLUG_RX.test(s)) {
        v.push('sub_sector: ' + JSON.stringify(s) + ' must be a non-empty lowercase-hyphen slug');
      } else if (!vocabulary.isCanonicalSubSector(s)) {
        v.push('sub_sector: ' + JSON.stringify(s) + ' is not a facts/vocabulary.js CANONICAL_SUB_SECTORS member');
      }
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

// jurisdiction, sub_jurisdiction, sector, sub_sector, activity_tags - the record's
// vocabulary-controlled classification tags (facts/vocabulary.js is their one door).
function validateTags(record) {
  return [
    ...validateJurisdictionFields(record),
    ...validateSectorField(record),
    ...validateSubSectorField(record),
    ...validateActivityTagsField(record),
  ];
}

// required_nexus[], applies_when[], excluded_when[] - the attachment/exclusion conditions.
// required_nexus is enum-checked via facts/vocabulary.js NEXUS_TYPES; a law binds through at
// least one nexus relation, so it must be non-empty (Rule 13: serving is not being bound).
// excluded_when may be empty at schema level (the threshold-guard linter enforces non-empty
// for the specific class of threshold-bearing records, caution.md C-071).
function validateNexusAndConditions(record) {
  const v = [];
  if (!isNonEmptyArray(record.required_nexus)) {
    v.push('required_nexus: required non-empty array');
  } else {
    for (const n of record.required_nexus) {
      if (!vocabulary.isNexusType(n)) {
        v.push('required_nexus: ' + JSON.stringify(n) + ' is not a facts/vocabulary.js NEXUS_TYPES member');
      }
    }
  }
  if (!isNonEmptyArray(record.applies_when)) {
    v.push('applies_when: required non-empty array of strings');
  } else {
    for (const a of record.applies_when) {
      if (!isNonEmptyString(a)) v.push('applies_when: every entry must be a non-empty string');
    }
  }
  if (!isArray(record.excluded_when)) {
    v.push('excluded_when: required array (may be empty)');
  } else {
    for (const e of record.excluded_when) {
      if (!isNonEmptyString(e)) v.push('excluded_when: every entry must be a non-empty string');
    }
  }
  return v;
}

// website_obligations[]
function validateObligations(record) {
  const v = [];
  if (!isNonEmptyArray(record.website_obligations)) {
    v.push('website_obligations: required non-empty array');
  } else {
    record.website_obligations.forEach((w, i) => {
      const tag = 'website_obligations[' + i + ']';
      if (!isPlainObject(w)) { v.push(tag + ': must be an object'); return; }
      if (!isNonEmptyString(w.duty)) v.push(tag + '.duty: required non-empty string');
      if (!isNonEmptyArray(w.elements)) {
        v.push(tag + '.elements: required non-empty array of strings');
      } else {
        for (const el of w.elements) {
          if (!isNonEmptyString(el)) v.push(tag + '.elements: every entry must be a non-empty string');
        }
      }
      if (!EVIDENCE_TYPES.includes(w.evidence_type)) {
        v.push(tag + '.evidence_type: ' + JSON.stringify(w.evidence_type) + ' must be one of ' + EVIDENCE_TYPES.join('|'));
      }
    });
  }
  return v;
}

// penalty
function validatePenalty(record) {
  const v = [];
  if (!isPlainObject(record.penalty)) {
    v.push('penalty: required object');
  } else {
    const p = record.penalty;
    if (!isNullOrFiniteNonNegative(p.typical_low)) v.push('penalty.typical_low: must be null or a non-negative finite number');
    if (!isNullOrFiniteNonNegative(p.typical_high)) v.push('penalty.typical_high: must be null or a non-negative finite number');
    if (!isNullOrFiniteNonNegative(p.statutory_max)) v.push('penalty.statutory_max: must be null or a non-negative finite number');
    if (typeof p.typical_low === 'number' && typeof p.typical_high === 'number' && p.typical_low > p.typical_high) {
      v.push('penalty: typical_low (' + p.typical_low + ') must not exceed typical_high (' + p.typical_high + ')');
    }
    if (!CURRENCIES.includes(p.currency)) v.push('penalty.currency: ' + JSON.stringify(p.currency) + ' must be one of ' + CURRENCIES.join('|'));
    if (!isNonEmptyString(p.basis)) v.push('penalty.basis: required non-empty string');
    if (!isBoolean(p.max_is_rare)) v.push('penalty.max_is_rare: required boolean');
  }
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

// enforcement[] (may be empty)
function validateEnforcement(record) {
  const v = [];
  if (!isArray(record.enforcement)) {
    v.push('enforcement: required array (may be empty)');
  } else {
    record.enforcement.forEach((e, i) => {
      const tag = 'enforcement[' + i + ']';
      if (!isPlainObject(e)) { v.push(tag + ': must be an object'); return; }
      if (!isNonEmptyString(e.case)) v.push(tag + '.case: required non-empty string');
      if (!isNonEmptyString(e.date)) v.push(tag + '.date: required non-empty string');
      if (!isNonEmptyString(e.amount)) v.push(tag + '.amount: required non-empty string');
      if (!isNonEmptyString(e.url)) v.push(tag + '.url: required non-empty string');
      else if (!isHttpUrl(e.url)) v.push(tag + '.url: ' + JSON.stringify(e.url) + ' is not a valid http(s) URL');
      if (!isNonEmptyString(e.summary)) v.push(tag + '.summary: required non-empty string');
    });
  }
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

// validateProvenanceDate(v, prov, field) -> pushes a violation when prov[field] is not a real
// YYYY-MM-DD calendar date (required + shape + semantic). Shared by verified_date and last_synced so
// both are policed identically (one door for provenance-date semantics).
function validateProvenanceDate(v, prov, field) {
  if (!isNonEmptyString(prov[field])) {
    v.push('provenance.' + field + ': required non-empty string');
  } else if (!DATE_RX.test(prov[field])) {
    v.push('provenance.' + field + ': ' + JSON.stringify(prov[field]) + ' must match YYYY-MM-DD');
  } else if (!isRealDate(prov[field])) {
    v.push('provenance.' + field + ': ' + JSON.stringify(prov[field]) + ' is not a real calendar date');
  }
}

// provenance {sources, seed_status, verified_date, last_synced} (Constitution Rule 14:
// provenance-mandatory catalogue rows; last_synced is mandatory - "Every row must carry provenance
// (source, last_synced)").
function validateProvenance(record) {
  const v = [];
  if (!isPlainObject(record.provenance)) {
    v.push('provenance: required object {sources, seed_status, verified_date, last_synced}');
    return v;
  }
  if (!isNonEmptyArray(record.provenance.sources)) {
    v.push('provenance.sources: required non-empty array');
  } else {
    for (const s of record.provenance.sources) {
      if (!isNonEmptyString(s)) v.push('provenance.sources: every entry must be a non-empty string');
    }
  }
  if (!isNonEmptyString(record.provenance.seed_status)) v.push('provenance.seed_status: required non-empty string');
  validateProvenanceDate(v, record.provenance, 'verified_date');
  validateProvenanceDate(v, record.provenance, 'last_synced');
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

// ---------------------------------------------------------------------------------
// validatePack(pack) -> string[]  (decomposed so no single function exceeds the health caps)
// ---------------------------------------------------------------------------------

// validatePackHeader(pack) -> violations for the pack's own scalar fields (cell, jurisdiction, and
// a real-calendar-date generated stamp).
function validatePackHeader(pack) {
  const v = [];
  if (!isNonEmptyString(pack.cell)) v.push('cell: required non-empty string');
  else if (!CELL_RX.test(pack.cell)) v.push('cell: ' + JSON.stringify(pack.cell) + ' must be a lowercase-hyphen slug');

  if (!isNonEmptyString(pack.jurisdiction)) v.push('jurisdiction: required non-empty string');
  else if (!vocabulary.isJurisdiction(pack.jurisdiction)) {
    v.push('jurisdiction: ' + JSON.stringify(pack.jurisdiction) + ' is not a known facts/vocabulary.js jurisdiction code');
  }

  if (!isNonEmptyString(pack.generated)) v.push('generated: required non-empty string');
  else if (!DATE_RX.test(pack.generated)) v.push('generated: ' + JSON.stringify(pack.generated) + ' must match YYYY-MM-DD');
  else if (!isRealDate(pack.generated)) v.push('generated: ' + JSON.stringify(pack.generated) + ' is not a real calendar date');
  return v;
}

// validatePackRecord(record, i, pack, seenIds) -> violations for one record: its own field-group
// validation, plus duplicate-id and jurisdiction-consistency checks against the pack. seenIds is
// threaded so duplicate detection spans the whole records array.
function validatePackRecord(record, i, pack, seenIds) {
  const v = validateRecord(record).map((rv) => 'records[' + i + '] ' + rv);

  if (isPlainObject(record) && isNonEmptyString(record.id)) {
    if (seenIds.has(record.id)) {
      v.push('records[' + i + '] id: ' + JSON.stringify(record.id) + ' duplicates records[' + seenIds.get(record.id) + ']');
    } else {
      seenIds.set(record.id, i);
    }
  }

  if (isPlainObject(record) && isNonEmptyString(pack.jurisdiction) && record.jurisdiction !== pack.jurisdiction) {
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
