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
//  2. sub_sector[] is type-and-format checked (non-empty lowercase-hyphen slugs) but NOT
//     enum-checked against facts/vocabulary.js SECTORS[x].sub. That tree carries only a handful
//     of REGEX-DETECTION sub-nodes per sector (e.g. healthcare has 6), built to classify a
//     crawled page; the catalogue's sub_sector authoring taxonomy is deliberately much richer
//     (e.g. law-firms records use 'attorney', 'conveyancing', 'notaries', 'immigration' - none
//     of which are vocabulary sub-tree keys). Enum-checking sub_sector against the detection
//     tree would reject nearly every real record for a taxonomy mismatch that reflects two
//     different jobs (detect vs author), not a data error. If a future phase unifies the two
//     taxonomies, this is the file to update.
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
// ---------------------------------------------------------------------------------
function validateRecord(record) {
  const v = [];
  const fail = (msg) => v.push(msg);

  if (!isPlainObject(record)) {
    return ['record is not a plain object'];
  }

  // id
  if (!isNonEmptyString(record.id)) fail('id: required non-empty string');
  else if (!ID_RX.test(record.id)) fail('id: ' + JSON.stringify(record.id) + ' must match ' + ID_RX + ' (upper-snake identifier)');

  const idTag = isNonEmptyString(record.id) ? record.id : '<no id>';

  // name
  if (!isNonEmptyString(record.name)) fail('name: required non-empty string');

  // citation
  if (!isPlainObject(record.citation)) {
    fail('citation: required object {act, section, url}');
  } else {
    if (!isNonEmptyString(record.citation.act)) fail('citation.act: required non-empty string');
    if (!isNonEmptyString(record.citation.section)) fail('citation.section: required non-empty string');
    if (!isNonEmptyString(record.citation.url)) fail('citation.url: required non-empty string');
    else if (!isHttpUrl(record.citation.url)) fail('citation.url: ' + JSON.stringify(record.citation.url) + ' is not a valid http(s) URL');
  }

  // jurisdiction (required_nexus/applicability layer; the record's OWN jurisdiction, per Rule 13)
  if (!isNonEmptyString(record.jurisdiction)) fail('jurisdiction: required non-empty string');
  else if (!vocabulary.isJurisdiction(record.jurisdiction)) {
    fail('jurisdiction: ' + JSON.stringify(record.jurisdiction) + ' is not a known facts/vocabulary.js jurisdiction code');
  }

  // sub_jurisdiction: null, 'multi', or a code modelled for this jurisdiction
  if (!isValidSubJurisdiction(record.jurisdiction, record.sub_jurisdiction)) {
    fail('sub_jurisdiction: ' + JSON.stringify(record.sub_jurisdiction) + ' is not null, "multi", or a facts/vocabulary.js SUB_JURISDICTIONS code for jurisdiction ' + JSON.stringify(record.jurisdiction));
  }

  // status
  if (!STATUSES.includes(record.status)) {
    fail('status: ' + JSON.stringify(record.status) + ' must be one of ' + STATUSES.join('|'));
  }

  // client_useful
  if (!isBoolean(record.client_useful)) fail('client_useful: required boolean');

  // sector[]
  if (!isNonEmptyArray(record.sector)) {
    fail('sector: required non-empty array');
  } else {
    for (const s of record.sector) {
      if (typeof s !== 'string' || !isValidSector(s)) {
        fail('sector: ' + JSON.stringify(s) + ' does not resolve via facts/vocabulary.js canonicalSector and is not the "universal" sentinel');
      }
    }
  }

  // sub_sector[] - type/format only (see file header, scope decision 2)
  if (!isArray(record.sub_sector)) {
    fail('sub_sector: required array (may be empty)');
  } else {
    for (const s of record.sub_sector) {
      if (typeof s !== 'string' || !isNonEmptyString(s) || !SLUG_RX.test(s)) {
        fail('sub_sector: ' + JSON.stringify(s) + ' must be a non-empty lowercase-hyphen slug');
      }
    }
  }

  // activity_tags[] - enum-checked via facts/vocabulary.js ACTIVITY_TAGS
  if (!isArray(record.activity_tags)) {
    fail('activity_tags: required array (may be empty)');
  } else {
    for (const t of record.activity_tags) {
      if (!vocabulary.isActivityTag(t)) {
        fail('activity_tags: ' + JSON.stringify(t) + ' is not a facts/vocabulary.js ACTIVITY_TAGS member');
      }
    }
  }

  // required_nexus[] - enum-checked via facts/vocabulary.js NEXUS_TYPES; a law binds through at
  // least one nexus relation, so this must be non-empty (Rule 13: serving is not being bound).
  if (!isNonEmptyArray(record.required_nexus)) {
    fail('required_nexus: required non-empty array');
  } else {
    for (const n of record.required_nexus) {
      if (!vocabulary.isNexusType(n)) {
        fail('required_nexus: ' + JSON.stringify(n) + ' is not a facts/vocabulary.js NEXUS_TYPES member');
      }
    }
  }

  // applies_when[]
  if (!isNonEmptyArray(record.applies_when)) {
    fail('applies_when: required non-empty array of strings');
  } else {
    for (const a of record.applies_when) {
      if (!isNonEmptyString(a)) fail('applies_when: every entry must be a non-empty string');
    }
  }

  // excluded_when[] - array required (may be empty at schema level; the threshold-guard linter
  // enforces non-empty for the specific class of threshold-bearing records, caution.md C-071)
  if (!isArray(record.excluded_when)) {
    fail('excluded_when: required array (may be empty)');
  } else {
    for (const e of record.excluded_when) {
      if (!isNonEmptyString(e)) fail('excluded_when: every entry must be a non-empty string');
    }
  }

  // website_obligations[]
  if (!isNonEmptyArray(record.website_obligations)) {
    fail('website_obligations: required non-empty array');
  } else {
    record.website_obligations.forEach((w, i) => {
      const tag = 'website_obligations[' + i + ']';
      if (!isPlainObject(w)) { fail(tag + ': must be an object'); return; }
      if (!isNonEmptyString(w.duty)) fail(tag + '.duty: required non-empty string');
      if (!isNonEmptyArray(w.elements)) {
        fail(tag + '.elements: required non-empty array of strings');
      } else {
        for (const el of w.elements) {
          if (!isNonEmptyString(el)) fail(tag + '.elements: every entry must be a non-empty string');
        }
      }
      if (!EVIDENCE_TYPES.includes(w.evidence_type)) {
        fail(tag + '.evidence_type: ' + JSON.stringify(w.evidence_type) + ' must be one of ' + EVIDENCE_TYPES.join('|'));
      }
    });
  }

  // penalty
  if (!isPlainObject(record.penalty)) {
    fail('penalty: required object');
  } else {
    const p = record.penalty;
    if (!isNullOrFiniteNonNegative(p.typical_low)) fail('penalty.typical_low: must be null or a non-negative finite number');
    if (!isNullOrFiniteNonNegative(p.typical_high)) fail('penalty.typical_high: must be null or a non-negative finite number');
    if (!isNullOrFiniteNonNegative(p.statutory_max)) fail('penalty.statutory_max: must be null or a non-negative finite number');
    if (typeof p.typical_low === 'number' && typeof p.typical_high === 'number' && p.typical_low > p.typical_high) {
      fail('penalty: typical_low (' + p.typical_low + ') must not exceed typical_high (' + p.typical_high + ')');
    }
    if (!CURRENCIES.includes(p.currency)) fail('penalty.currency: ' + JSON.stringify(p.currency) + ' must be one of ' + CURRENCIES.join('|'));
    if (!isNonEmptyString(p.basis)) fail('penalty.basis: required non-empty string');
    if (!isBoolean(p.max_is_rare)) fail('penalty.max_is_rare: required boolean');
  }

  // regulator
  if (!isPlainObject(record.regulator)) {
    fail('regulator: required object {name, register_url}');
  } else {
    if (!isNonEmptyString(record.regulator.name)) fail('regulator.name: required non-empty string');
    if (record.regulator.register_url !== null && record.regulator.register_url !== undefined) {
      if (!isHttpUrl(record.regulator.register_url)) fail('regulator.register_url: ' + JSON.stringify(record.regulator.register_url) + ' must be null or a valid http(s) URL');
    }
  }

  // enforcement[] (may be empty)
  if (!isArray(record.enforcement)) {
    fail('enforcement: required array (may be empty)');
  } else {
    record.enforcement.forEach((e, i) => {
      const tag = 'enforcement[' + i + ']';
      if (!isPlainObject(e)) { fail(tag + ': must be an object'); return; }
      if (!isNonEmptyString(e.case)) fail(tag + '.case: required non-empty string');
      if (!isNonEmptyString(e.date)) fail(tag + '.date: required non-empty string');
      if (!isNonEmptyString(e.amount)) fail(tag + '.amount: required non-empty string');
      if (!isNonEmptyString(e.url)) fail(tag + '.url: required non-empty string');
      else if (!isHttpUrl(e.url)) fail(tag + '.url: ' + JSON.stringify(e.url) + ' is not a valid http(s) URL');
      if (!isNonEmptyString(e.summary)) fail(tag + '.summary: required non-empty string');
    });
  }

  // intel
  if (!isPlainObject(record.intel)) {
    fail('intel: required object {why_matters, regulator_asks_first, relevance_hook}');
  } else {
    if (!isNonEmptyString(record.intel.why_matters)) fail('intel.why_matters: required non-empty string');
    if (!isNonEmptyString(record.intel.regulator_asks_first)) fail('intel.regulator_asks_first: required non-empty string');
    if (!isNonEmptyString(record.intel.relevance_hook)) fail('intel.relevance_hook: required non-empty string');
  }

  // provenance (Constitution Rule 14: provenance-mandatory catalogue rows)
  if (!isPlainObject(record.provenance)) {
    fail('provenance: required object {sources, seed_status, verified_date}');
  } else {
    if (!isNonEmptyArray(record.provenance.sources)) {
      fail('provenance.sources: required non-empty array');
    } else {
      for (const s of record.provenance.sources) {
        if (!isNonEmptyString(s)) fail('provenance.sources: every entry must be a non-empty string');
      }
    }
    if (!isNonEmptyString(record.provenance.seed_status)) fail('provenance.seed_status: required non-empty string');
    if (!isNonEmptyString(record.provenance.verified_date)) fail('provenance.verified_date: required non-empty string');
    else if (!DATE_RX.test(record.provenance.verified_date)) fail('provenance.verified_date: ' + JSON.stringify(record.provenance.verified_date) + ' must match YYYY-MM-DD');
  }

  // advisory - optional, but if present must be boolean (caution.md C-055 advisory tier marker)
  if (record.advisory !== undefined && !isBoolean(record.advisory)) {
    fail('advisory: if present must be a boolean');
  }

  return v.map((msg) => idTag + ': ' + msg);
}

// ---------------------------------------------------------------------------------
// validatePack(pack) -> string[]
// ---------------------------------------------------------------------------------
function validatePack(pack) {
  const v = [];
  const fail = (msg) => v.push(msg);

  if (!isPlainObject(pack)) return ['pack is not a plain object'];

  if (!isNonEmptyString(pack.cell)) fail('cell: required non-empty string');
  else if (!CELL_RX.test(pack.cell)) fail('cell: ' + JSON.stringify(pack.cell) + ' must be a lowercase-hyphen slug');

  if (!isNonEmptyString(pack.jurisdiction)) fail('jurisdiction: required non-empty string');
  else if (!vocabulary.isJurisdiction(pack.jurisdiction)) {
    fail('jurisdiction: ' + JSON.stringify(pack.jurisdiction) + ' is not a known facts/vocabulary.js jurisdiction code');
  }

  if (!isNonEmptyString(pack.generated)) fail('generated: required non-empty string');
  else if (!DATE_RX.test(pack.generated)) fail('generated: ' + JSON.stringify(pack.generated) + ' must match YYYY-MM-DD');

  if (!isNonEmptyArray(pack.records)) {
    fail('records: required non-empty array');
    return v;
  }

  const seenIds = new Map();
  pack.records.forEach((record, i) => {
    const recordViolations = validateRecord(record);
    for (const rv of recordViolations) fail('records[' + i + '] ' + rv);

    if (isPlainObject(record) && isNonEmptyString(record.id)) {
      if (seenIds.has(record.id)) {
        fail('records[' + i + '] id: ' + JSON.stringify(record.id) + ' duplicates records[' + seenIds.get(record.id) + ']');
      } else {
        seenIds.set(record.id, i);
      }
    }

    if (isPlainObject(record) && isNonEmptyString(pack.jurisdiction) && record.jurisdiction !== pack.jurisdiction) {
      fail('records[' + i + '] jurisdiction: ' + JSON.stringify(record.jurisdiction) + ' does not match pack jurisdiction ' + JSON.stringify(pack.jurisdiction));
    }
  });

  return v;
}

module.exports = {
  STATUSES,
  CURRENCIES,
  EVIDENCE_TYPES,
  SECTOR_UNIVERSAL,
  isValidSector,
  isValidSubJurisdiction,
  validateRecord,
  validatePack,
};
