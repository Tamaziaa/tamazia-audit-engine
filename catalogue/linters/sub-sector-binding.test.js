'use strict';
// node:test suite for the sub_sector connection-integrity compile gate (P6).
// Run: node --test catalogue/linters/sub-sector-binding.test.js
//
// Proves the gate that makes the empirical-healthcare D4 defect un-shippable: a record whose
// sub_sector[] can bind no classifiable firm must FAIL the build, and a record whose sub_sector[]
// is a real detection leaf / coarse parent label / synonym / empty must PASS. Also proves the gate
// earns its zero (selfTest) and speaks to the real compiled packs it will police.

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./sub-sector-binding.js');
const vocabulary = require('../../facts/vocabulary.js');

function findings(record) {
  return gate.checkRecord(record, 'test');
}

test('selfTest passes: the gate SEES its disease before any zero it reports is trusted (Rule 4)', () => {
  const st = gate.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('a record with an UNKNOWN sub_sector tag is flagged (typo / dead reference)', () => {
  const f = findings({ id: 'R', sub_sector: ['not-a-real-sub-sector'] });
  assert.ok(f.some((x) => x.rule === 'sub-sector-binding/unknown-sub-sector'),
    'an unknown sub_sector must be flagged: ' + JSON.stringify(f));
});

test('a record whose ONLY sub_sector is canonical-but-unreachable is a DEAD record (the D4 class)', () => {
  // 'solo-practice' / 'wellness' / 'conveyancing' are real CANONICAL_SUB_SECTORS members but no
  // classifier leaf resolves to them and they are neither a sector label nor a synonym of a leaf.
  for (const tag of ['solo-practice', 'wellness', 'conveyancing']) {
    assert.equal(vocabulary.isCanonicalSubSector(tag), true, tag + ' should be a canonical sub-sector');
    const f = findings({ id: 'R', sub_sector: [tag] });
    assert.ok(f.some((x) => x.rule === 'sub-sector-binding/dead-record'),
      'a record restricted to ONLY ' + tag + ' binds no firm and must be flagged dead: ' + JSON.stringify(f));
  }
});

test('a record clears when it carries a bindable tag: exact leaf, coarse parent label, or synonym', () => {
  assert.equal(findings({ id: 'A', sub_sector: ['injectables'] }).length, 0, 'exact detection leaf binds');
  assert.equal(findings({ id: 'B', sub_sector: ['aesthetics'] }).length, 0, 'coarse parent label (a sector node) binds');
  assert.equal(findings({ id: 'C', sub_sector: ['gp-clinic'] }).length, 0, 'synonym of general-practice binds');
  assert.equal(findings({ id: 'D', sub_sector: ['law-firm', 'attorney'] }).length, 0, 'US synonyms of solicitors bind');
  assert.equal(findings({ id: 'E', sub_sector: ['care-home'] }).length, 0, 'a newly-added detection leaf binds');
});

test('an EMPTY sub_sector[] is never a break: it binds every in-sector firm', () => {
  assert.equal(findings({ id: 'U', sub_sector: [] }).length, 0);
});

test('a dead record still binds via a co-occurring reachable tag (record-level, not tag-level)', () => {
  // Mirrors the real us-healthcare US_FTC_SUBST_HEALTH [wellness, supplements]: wellness is
  // unreachable but supplements is a real leaf, so the RECORD is bindable and must not be flagged.
  assert.equal(findings({ id: 'MIX', sub_sector: ['wellness', 'supplements'] }).length, 0);
});

test('scan of the compiled (QA-signed) packs reports ZERO violations - the gate does not break the build', () => {
  // Only the six packs with a QA sidecar compile; scan them explicitly (uk-tech-media-industrial has
  // no sidecar, is EXCLUDED from compilation, and its sub_sectors are a separate work-in-flight).
  const compiled = [
    'uk-healthcare', 'uk-legal', 'uk-universal', 'us-healthcare', 'us-legal', 'us-universal',
  ].map((c) => 'catalogue/packs/' + c + '.json');
  const res = gate.scan(compiled);
  assert.equal(res.violations.length, 0,
    'every compiled record must carry a bindable sub_sector: ' + JSON.stringify(res.violations.slice(0, 3)));
  assert.ok(res.recordsWithSubSector > 0, 'the gate must actually have sub_sector-bearing records to police');
});
