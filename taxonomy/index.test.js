'use strict';
// taxonomy/index.test.js - proves the shared taxonomy is derived (no drift), that sectorPathMatches does
// ancestor-or-equal (the aesthetics-vs-injectables fix), and that the JurisdictionAxes constructor fails
// closed with establishment vs audience as a required first-class field.

const test = require('node:test');
const assert = require('node:assert/strict');

const taxonomy = require('./index.js');
const vocabulary = require('../facts/vocabulary.js');

test('sector paths are DERIVED from vocabulary (no second source of sector names)', () => {
  // one door: the taxonomy re-exports vocabulary's canonical sector set rather than declaring its own.
  assert.deepEqual(taxonomy.CANONICAL_SECTORS, vocabulary.CANONICAL_SECTORS);
  // every path's first segment must be a canonical sector key (nothing invented).
  for (const p of taxonomy.SECTOR_PATHS) {
    const first = p.split('.')[0];
    assert.ok(vocabulary.isCanonicalSector(first), `path ${p} has non-canonical root ${first}`);
  }
});

test('the tree carries the real parent/child depth (healthcare -> aesthetics -> injectables)', () => {
  assert.equal(taxonomy.sectorPath('healthcare'), 'healthcare');
  assert.equal(taxonomy.sectorPath('aesthetics', 'injectables'), 'healthcare.aesthetics.injectables');
  assert.equal(taxonomy.sectorPath('dental', 'orthodontics'), 'healthcare.dental.orthodontics');
  assert.equal(taxonomy.sectorPath('law-firms', 'solicitors'), 'law-firms.solicitors');
  assert.ok(taxonomy.isSectorPath('healthcare.aesthetics.injectables'));
  assert.ok(taxonomy.isSectorPath('healthcare.aesthetics'));
  assert.ok(taxonomy.isSectorPath('healthcare'));
});

test('sectorPath returns null on an unknown pair (never guesses a default)', () => {
  assert.equal(taxonomy.sectorPath('aesthetics', 'not-a-leaf'), null);
  assert.equal(taxonomy.sectorPath('not-a-sector'), null);
  assert.equal(taxonomy.sectorPath(''), null);
});

test('parentPath walks up one level and stops at the root', () => {
  assert.equal(taxonomy.parentPath('healthcare.aesthetics.injectables'), 'healthcare.aesthetics');
  assert.equal(taxonomy.parentPath('healthcare.aesthetics'), 'healthcare');
  assert.equal(taxonomy.parentPath('healthcare'), null);
});

test('sectorPathMatches: a law at an ANCESTOR path binds a firm at a descendant leaf (the injectables fix)', () => {
  // this is the exact class the old exact-string sub_sector match missed: aesthetics != injectables.
  assert.equal(taxonomy.sectorPathMatches('healthcare', 'healthcare.aesthetics.injectables'), true);
  assert.equal(taxonomy.sectorPathMatches('healthcare.aesthetics', 'healthcare.aesthetics.injectables'), true);
  assert.equal(taxonomy.sectorPathMatches('healthcare.aesthetics.injectables', 'healthcare.aesthetics.injectables'), true);
});

test('sectorPathMatches: leaf_locked binds ONLY the exact path, never a descendant', () => {
  assert.equal(taxonomy.sectorPathMatches('healthcare', 'healthcare.aesthetics.injectables', { leafLocked: true }), false);
  assert.equal(taxonomy.sectorPathMatches('healthcare.aesthetics.injectables', 'healthcare.aesthetics.injectables', { leafLocked: true }), true);
});

test('sectorPathMatches: a DESCENDANT law never binds an ancestor firm, and prefix-not-at-boundary never matches', () => {
  assert.equal(taxonomy.sectorPathMatches('healthcare.aesthetics.injectables', 'healthcare.aesthetics'), false);
  // 'health' is a text prefix of 'healthcare' but not a path-boundary ancestor.
  assert.equal(taxonomy.sectorPathMatches('health', 'healthcare'), false);
  // unparseable inputs never attach (deny-by-default), never throw.
  assert.equal(taxonomy.sectorPathMatches('', 'healthcare'), false);
  assert.equal(taxonomy.sectorPathMatches('healthcare', ''), false);
  assert.equal(taxonomy.sectorPathMatches(null, undefined), false);
});

test('isSectorPath rejects a signal-name-shaped dotted string (ecommerce.jsonld_product_offers)', () => {
  // guards the taxonomy-onedoor gate against flagging non-path dotted literals in real code.
  assert.equal(taxonomy.isSectorPath('ecommerce.jsonld_product_offers'), false);
});

test('JurisdictionAxes builds a frozen record and requires country + establishment/audience relation', () => {
  const ax = taxonomy.JurisdictionAxes({ country: 'US', relation: 'establishment', sub_jurisdiction: 'CA', profession: 'attorney' });
  assert.equal(ax.country, 'US');
  assert.equal(ax.relation, 'establishment');
  assert.equal(ax.sub_jurisdiction, 'CA');
  assert.equal(ax.profession, 'attorney');
  assert.equal(ax.regulator, null); // an omitted axis is an explicit wildcard, never undefined
  assert.ok(Object.isFrozen(ax));
});

test('JurisdictionAxes fails closed on every invalid axis (Rule 4)', () => {
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'ZZ', relation: 'audience' }), /country/);
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'US' }), /relation/); // relation is never defaulted
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'US', relation: 'somewhere' }), /relation/);
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'US', relation: 'audience', sub_jurisdiction: 'XX' }), /sub_jurisdiction/);
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'UK', relation: 'audience', sub_jurisdiction: 'CA' }), /sub_jurisdiction/); // CA is not a UK sub-jurisdiction
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'US', relation: 'audience', regulator: 'NOPE' }), /regulator/);
  assert.throws(() => taxonomy.JurisdictionAxes({ country: 'US', relation: 'audience', profession: 'wizard' }), /profession/);
});

test('the establishment vs audience distinction is a first-class, closed enum', () => {
  assert.deepEqual(taxonomy.JURISDICTION_RELATIONS.slice().sort(), ['audience', 'establishment']);
  assert.ok(taxonomy.isJurisdictionRelation('establishment'));
  assert.ok(taxonomy.isJurisdictionRelation('audience'));
  assert.equal(taxonomy.isJurisdictionRelation('country'), false);
});

test('exported taxonomy structures are deep-frozen (a consumer cannot mutate the shared vocabulary)', () => {
  assert.ok(Object.isFrozen(taxonomy.SECTOR_PATHS));
  assert.ok(Object.isFrozen(taxonomy.COUNTRIES));
  assert.ok(Object.isFrozen(taxonomy.REGULATOR_CODES));
  assert.throws(() => { taxonomy.SECTOR_PATHS.push('rogue'); }, TypeError);
});

test('validators fail closed on unknowns', () => {
  assert.equal(taxonomy.isCountry('US'), true);
  assert.equal(taxonomy.isCountry('zz'), false);
  assert.equal(taxonomy.isRegulatorCode('ICO'), true);
  assert.equal(taxonomy.isRegulatorCode('ICOX'), false);
  assert.equal(taxonomy.isProfession('solicitor'), true);
  assert.equal(taxonomy.isProfession('astronaut'), false);
});
