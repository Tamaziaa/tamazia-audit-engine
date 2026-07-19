#!/usr/bin/env node
'use strict';
// catalogue/linters/sub-sector-binding.js - the sub_sector connection-integrity gate (P6).
//
// THE PERMANENT GUARANTEE that no sector/sub_sector connection can silently break again (the founder's
// #1 priority: "no connection of sector sub sector or jurisdiction should break"). This gate exists
// because a whole class of catalogue records were shipping VALID (schema-clean) yet UNBINDABLE: a real
// Botox clinic resolves to the detection leaf `injectables`, but UK_MHRA_POM_AD_BAN restricted itself to
// the coarse parent label `aesthetics`, and applicability/connect.js gate-4 was exact-string membership,
// so it could never match - 9 of 12 uk-healthcare sub_sector tags and 100% of the us-legal records bound
// NOBODY (empirical-healthcare D4). Schema validity never proved runtime binding: CANONICAL_SUB_SECTORS
// deliberately carries BOTH the coarse parent labels AND the detection leaves, so hidden-defects D6 saw
// every token as "resolving" while the records were dead in the field. That gap is exactly this gate.
//
// Two fail-closed checks per compiled pack (both ERROR-severity, so catalogue/compile.js refuses the
// build - Constitution Rule 4 fail-closed):
//   1. UNKNOWN sub_sector: every sub_sector tag MUST be a facts/vocabulary.js CANONICAL_SUB_SECTORS
//      member (a real vocabulary node), never a typo or a dead reference. (schema.js also enforces this;
//      duplicated here on purpose so this gate is self-sufficient and its message is binding-specific.)
//   2. DEAD record: a record with a NON-EMPTY sub_sector[] MUST carry at least one REACHABLE tag - a tag
//      SOME classifiable firm can be resolved into and bound through the ancestor/sector/synonym-aware
//      gate-4 (facts/vocabulary.js#recordSubSectorBindable). A record whose entire sub_sector[] is
//      unreachable binds no firm on earth; that is the D4 defect, and this gate makes it un-shippable.
//      (An empty sub_sector[] is "no sub-sector restriction" - it binds every in-sector firm - and never
//      trips this gate.)
//
// The reachability relation is owned entirely by facts/vocabulary.js (Rule 1: one door); this linter
// never re-derives it. Adding a legitimately new sub_sector to a future pack means either it is already
// a detection leaf / sector label / synonym there, or a detection node + relation is added THERE first.
const lib = require('./lib');
const vocabulary = require('../../facts/vocabulary.js');

// unreachableTags(subSectors) -> the subset of a record's tags that no classifiable firm can carry.
function unreachableTags(subSectors) {
  return (Array.isArray(subSectors) ? subSectors : []).filter((t) => !vocabulary.isReachableSubSector(t));
}

// checkRecord(record, locator) -> finding[] (rule/id/message shape the linter fleet speaks). A record
// that is not the COM shape, or carries no sub_sector array, contributes nothing (schema.js owns record
// shape; this gate speaks only to sub_sector binding).
function checkRecord(record, locator) {
  const findings = [];
  const id = typeof record.id === 'string' ? record.id : '<no id>';
  if (!Array.isArray(record.sub_sector)) return findings; // shape is schema.js's door, not this gate's
  const subs = record.sub_sector;

  // Check 1: every tag must be a declared canonical sub_sector (a real vocabulary node).
  for (const tag of subs) {
    if (!vocabulary.isCanonicalSubSector(tag)) {
      findings.push({
        locator, id, rule: 'sub-sector-binding/unknown-sub-sector',
        message: 'sub_sector ' + JSON.stringify(tag) + ' is not a facts/vocabulary.js CANONICAL_SUB_SECTORS '
          + 'member (a real vocabulary node) - a typo or a dead reference can never bind a firm; add it to '
          + 'the one door (facts/vocabulary.js) with its detection/relation, or fix the tag',
      });
    }
  }

  // Check 2: a non-empty sub_sector[] must be bindable by at least one classifiable firm.
  if (subs.length > 0 && !vocabulary.recordSubSectorBindable(subs)) {
    const dead = unreachableTags(subs);
    findings.push({
      locator, id, rule: 'sub-sector-binding/dead-record',
      message: 'record sub_sector [' + subs.join(', ') + '] is UNBINDABLE: no tag is a detection leaf, a '
        + 'parent sector/family label, or a synonym of a leaf, so no classifiable firm can ever satisfy '
        + 'gate-4 for this record (the empirical-healthcare D4 class). Unreachable tag(s): [' + dead.join(', ')
        + ']. Add a detection node/relation for one of them in facts/vocabulary.js, or tag the record with a '
        + 'sub_sector a real firm resolves to.',
    });
  }
  return findings;
}

function scan(dirsOrPatterns) {
  const { entries, parseErrors } = lib.loadRecords(dirsOrPatterns);
  const violations = [];
  let recordsWithSubSector = 0;
  for (const entry of entries) {
    if (Array.isArray(entry.record.sub_sector) && entry.record.sub_sector.length > 0) recordsWithSubSector += 1;
    for (const f of checkRecord(entry.record, entry.locator)) violations.push({ file: entry.file, ...f });
  }
  // CR-7: an unreadable/unparseable file fails the gate through the same violations array a real defect uses.
  for (const v of lib.parseErrorViolations(parseErrors)) violations.push(v);
  return { violations, scanned: entries.length, recordsWithSubSector, parseErrors };
}

// selfTest() -> {pass, detail}. Proves this gate SEES its disease before any zero it reports is trusted
// (Constitution Rule 4 / the self-test-first doctrine): it must reject a typo'd tag, reject a record
// whose only tag is canonical-but-unreachable (the D4 dead-record class), and clear a bindable record,
// a coarse-parent-label record, and an unrestricted (empty) record.
function selfTest() {
  const unknown = checkRecord({ id: 'ST_UNKNOWN', sub_sector: ['not-a-real-sub-sector'] }, 'selftest');
  const deadReal = checkRecord({ id: 'ST_DEAD', sub_sector: ['wellness'] }, 'selftest'); // canonical but unreachable alone
  const leafOk = checkRecord({ id: 'ST_LEAF', sub_sector: ['injectables'] }, 'selftest');
  const parentOk = checkRecord({ id: 'ST_PARENT', sub_sector: ['aesthetics'] }, 'selftest'); // coarse parent label
  const synonymOk = checkRecord({ id: 'ST_SYN', sub_sector: ['gp-clinic'] }, 'selftest'); // synonym of general-practice
  const emptyOk = checkRecord({ id: 'ST_EMPTY', sub_sector: [] }, 'selftest');

  const pass = unknown.some((f) => f.rule === 'sub-sector-binding/unknown-sub-sector')
    && deadReal.some((f) => f.rule === 'sub-sector-binding/dead-record')
    && leafOk.length === 0
    && parentOk.length === 0
    && synonymOk.length === 0
    && emptyOk.length === 0;

  return {
    pass,
    detail: pass
      ? 'rejects an unknown/typo sub_sector, rejects a canonical-but-unreachable dead record (the D4 class), '
        + 'and clears an exact leaf, a coarse parent label, a synonym, and an unrestricted (empty) record'
      : 'FAILED one or more self-test cases: ' + JSON.stringify({ unknown, deadReal, leafOk, parentOk, synonymOk, emptyOk }),
  };
}

const toFindings = lib.makeToFindings('catalogue-sub-sector-binding');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'sub-sector-binding', {
    summary: (r) => r.recordsWithSubSector + ' record(s) with a sub_sector restriction across ' + r.scanned
      + ' record(s), ' + r.violations.length + ' violation(s)'
      + (r.parseErrors.length ? ' (' + r.parseErrors.length + ' file(s) unreadable: ' + r.parseErrors.join('; ') + ')' : ''),
    calibrateSummary: (r) => r.scanned + ' fixture record(s) scanned, ' + r.violations.length + ' seeded violation(s) found',
  });
}

if (require.main === module) main();

module.exports = { checkRecord, unreachableTags, scan, selfTest, toFindings };
