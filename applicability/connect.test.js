'use strict';
// applicability/connect.test.js - node:test suite for the one applicability door.
// Every test names the gate/rule it exercises. The unit tests use minimal synthetic records (connect()
// is not a schema validator; it reads only the fields the gates touch). The integration test at the
// foot drives the four REAL facts doors over the reference bundles and the compiled catalogue.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { connect, firmSectorIdentitySet, hasEstablishmentEvidence } = require('./connect.js');

// ── synthetic factories ───────────────────────────────────────────────────────────────────────────
// rec(over) -> a minimal catalogue-shaped record, applicable to a UK-bound firm by default. Every gate
// field is overridable. citation.act drives family dedupe; website_obligations drives rulesChecked.
function rec(over) {
  return Object.assign({
    id: 'R1',
    jurisdiction: 'UK',
    sub_jurisdiction: null,
    sector: ['universal'],
    sub_sector: [],
    activity_tags: [],
    required_nexus: ['serves_customers_in'],
    citation: { act: 'Act Alpha', section: 's.1', url: 'https://example.gov/a' },
    website_obligations: [{ duty: 'd1', elements: ['e'], evidence_type: 'presence' }],
  }, over);
}

// A UK-bound jurisdiction envelope. tierA controls whether the bound entry carries Tier A establishment
// evidence (register) or only Tier B market signals (postcode + currency).
function boundUK({ tierA = true, serves = [], subs = [], abstained = false } = {}) {
  const tier_evidence = tierA
    ? [{ tier: 'A', kind: 'register', weight: 5, source: 'registers.companiesHouse' }]
    : [{ tier: 'B', kind: 'postcode', weight: 3, source: 'footer' }, { tier: 'B', kind: 'currency', weight: 3, source: 'page' }];
  return {
    bound: [{ jurisdiction: 'UK', tier_evidence, confidence: tierA ? 'register' : 'corroborated', score: 5 }],
    serves,
    sub_jurisdictions: subs,
    abstained,
  };
}

function sectorFact(sector, sub_sector = null) {
  return { fact: 'sector', value: sector === null ? null : { sector, sub_sector }, confidence: sector ? 'corroborated' : 'abstain' };
}

function caps(predicateMap) {
  const predicates = {};
  for (const [tag, present] of Object.entries(predicateMap || {})) {
    predicates[tag] = { tag, present, confidence: present === 'unknown' ? 'abstain' : 'weak', evidence: [] };
  }
  return { fact: 'CAPABILITIES', predicates };
}

// factsFor -> the { jurisdiction, sector, capabilities } bundle connect() consumes.
function factsFor({ jurisdiction, sector = sectorFact('law-firms', 'solicitors'), capabilities = null } = {}) {
  return { jurisdiction, sector, capabilities };
}

// ── GATE 1: jurisdiction (Rule 13, the leak killer) ────────────────────────────────────────────────

test('gate 1: a US record is excluded for a UK-bound firm (the applicability-leak class)', () => {
  const catalogue = [rec({ id: 'UK_ONE', jurisdiction: 'UK' }), rec({ id: 'US_ONE', jurisdiction: 'US', citation: { act: 'US Act' } })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['UK_ONE']);
  const usEx = excluded.find((e) => e.record_id === 'US_ONE');
  assert.ok(usEx, 'the US record must be present in excluded');
  assert.match(usEx.reason, /gate-1 jurisdiction/, 'the reason names the failed gate');
  assert.match(usEx.reason, /not in the firm bound set/);
});

test('gate 1: a jurisdiction in serves[] but not bound[] never attaches', () => {
  // US is a served market, never a bound one. A US record must not attach off serves[].
  const jurisdiction = boundUK({ serves: [{ jurisdiction: 'US', confidence: 'weak', evidence: [] }] });
  const catalogue = [rec({ id: 'US_ONE', jurisdiction: 'US', citation: { act: 'US Act' } })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction }), catalogue);
  assert.equal(applicable.length, 0);
  assert.match(excluded[0].reason, /gate-1 jurisdiction/);
});

test('gate 1: an abstained jurisdiction envelope attaches nothing; every record excluded with an abstention reason', () => {
  const jurisdiction = { bound: [], serves: [], sub_jurisdictions: [], abstained: true };
  const catalogue = [rec({ id: 'A' }), rec({ id: 'B', citation: { act: 'Act Beta' } })];
  const { applicable, excluded, counts } = connect(factsFor({ jurisdiction }), catalogue);
  assert.equal(applicable.length, 0);
  assert.equal(excluded.length, 2, 'every record is excluded');
  for (const e of excluded) assert.match(e.reason, /gate-1 jurisdiction unbound \(the jurisdiction fact abstained/);
  assert.deepEqual(counts, { frameworksAssessed: 0, frameworksBinding: 0, rulesChecked: 0 });
});

test('gate 1: a missing jurisdiction envelope attaches nothing (fail-closed)', () => {
  const catalogue = [rec({ id: 'A' })];
  const { applicable, excluded } = connect({ jurisdiction: null, sector: sectorFact('law-firms'), capabilities: null }, catalogue);
  assert.equal(applicable.length, 0);
  assert.match(excluded[0].reason, /no jurisdiction envelope was supplied/);
});

// ── GATE 2: sub-jurisdiction ────────────────────────────────────────────────────────────────────────

test('gate 2: a specific sub_jurisdiction code requires a BOUND entry; an advisory entry is rejected', () => {
  const advisory = boundUK({ subs: [{ country: 'US', code: 'CA', status: 'advisory', basis: 'mention' }] });
  // Reuse UK bound but attach a US-state sub advisory - a CA record still needs its own bound state AND
  // a bound US jurisdiction. Model a US-bound firm with an ADVISORY California sub.
  const usAdvisory = {
    bound: [{ jurisdiction: 'US', tier_evidence: [{ tier: 'A', kind: 'register' }], confidence: 'register', score: 5 }],
    serves: [],
    sub_jurisdictions: [{ country: 'US', code: 'CA', status: 'advisory', basis: 'mention' }],
    abstained: false,
  };
  const catalogue = [rec({ id: 'CA_REC', jurisdiction: 'US', sub_jurisdiction: 'CA', sector: ['universal'] })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: usAdvisory, sector: sectorFact('law-firms') }), catalogue);
  assert.equal(applicable.length, 0, 'an advisory sub-jurisdiction never binds a state-specific record');
  assert.match(excluded[0].reason, /gate-2 sub-jurisdiction/);
  assert.ok(advisory); // silence unused
});

test('gate 2: a specific sub_jurisdiction code with a BOUND entry passes; null and multi always pass', () => {
  const usBoundCA = {
    bound: [{ jurisdiction: 'US', tier_evidence: [{ tier: 'A', kind: 'register' }], confidence: 'register', score: 5 }],
    serves: [],
    sub_jurisdictions: [{ country: 'US', code: 'CA', status: 'bound', basis: 'office_address' }],
    abstained: false,
  };
  const catalogue = [
    rec({ id: 'CA_REC', jurisdiction: 'US', sub_jurisdiction: 'CA', sector: ['universal'] }),
    rec({ id: 'MULTI_REC', jurisdiction: 'US', sub_jurisdiction: 'multi', sector: ['universal'], citation: { act: 'Act Multi' } }),
    rec({ id: 'NULL_REC', jurisdiction: 'US', sub_jurisdiction: null, sector: ['universal'], citation: { act: 'Act Null' } }),
  ];
  const { applicable } = connect(factsFor({ jurisdiction: usBoundCA, sector: sectorFact('law-firms') }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id).sort(), ['CA_REC', 'MULTI_REC', 'NULL_REC']);
});

// ── GATE 3: displacement ────────────────────────────────────────────────────────────────────────────

test('gate 3: a bound sub_jurisdiction whose displaces[] lists the record id excludes it, naming the displacing code', () => {
  const aeDifc = {
    bound: [{ jurisdiction: 'AE', tier_evidence: [{ tier: 'A', kind: 'freezone_establishment' }], confidence: 'corroborated', score: 5 }],
    serves: [],
    sub_jurisdictions: [{ country: 'AE', code: 'DIFC', status: 'bound', basis: 'freezone_establishment', displaces: ['AE_FEDERAL_DP'] }],
    abstained: false,
  };
  const catalogue = [
    rec({ id: 'AE_FEDERAL_DP', jurisdiction: 'AE', sub_jurisdiction: null, sector: ['universal'], required_nexus: ['established_in'] }),
    rec({ id: 'AE_OTHER', jurisdiction: 'AE', sub_jurisdiction: null, sector: ['universal'], required_nexus: ['established_in'], citation: { act: 'Act Other' } }),
  ];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: aeDifc, sector: sectorFact('finance') }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['AE_OTHER'], 'the non-displaced AE record still binds');
  const displaced = excluded.find((e) => e.record_id === 'AE_FEDERAL_DP');
  assert.match(displaced.reason, /gate-3 displacement/);
  assert.match(displaced.reason, /DIFC/, 'the reason names the displacing code');
});

// ── GATE 4: sector + sub-sector ──────────────────────────────────────────────────────────────────────

test('gate 4: a universal-sector record attaches without any firm sector', () => {
  const catalogue = [rec({ id: 'U', sector: ['universal'] })];
  const { applicable } = connect(factsFor({ jurisdiction: boundUK(), sector: sectorFact(null) }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['U']);
});

test('gate 4: a sector mismatch excludes', () => {
  const catalogue = [rec({ id: 'HEALTH', sector: ['healthcare'] })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: boundUK(), sector: sectorFact('law-firms') }), catalogue);
  assert.equal(applicable.length, 0);
  assert.match(excluded[0].reason, /gate-4 sector/);
});

test('gate 4: sector fold - a record authored "legal" matches a firm resolved to "law-firms" (canonical one-door fold)', () => {
  const catalogue = [rec({ id: 'LEGAL', sector: ['legal'] })];
  const { applicable } = connect(factsFor({ jurisdiction: boundUK(), sector: sectorFact('law-firms', 'solicitors') }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['LEGAL'], 'canonicalSector folds legal -> law-firms');
});

test('gate 4: a firm resolved to a CHILD sector matches a PARENT-family record, but not vice versa (one-directional fold)', () => {
  // dental is a child of healthcare in the vocabulary tree.
  const dentalFirm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('dental', 'general-dental') });
  const healthcareRec = [rec({ id: 'HC', sector: ['healthcare'] })];
  assert.deepEqual(connect(dentalFirm, healthcareRec).applicable.map((r) => r.id), ['HC'], 'a dental firm inherits healthcare-wide law');

  const healthcareFirm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('healthcare', 'general-practice') });
  const dentalRec = [rec({ id: 'DENTAL', sector: ['dental'] })];
  assert.equal(connect(healthcareFirm, dentalRec).applicable.length, 0, 'a general healthcare firm does NOT inherit dental-specific law');
});

test('gate 4: a sector-specific record is excluded when the firm sector abstained, while a universal record still passes', () => {
  const catalogue = [rec({ id: 'HEALTH', sector: ['healthcare'] }), rec({ id: 'U', sector: ['universal'], citation: { act: 'Act U' } })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: boundUK(), sector: sectorFact(null) }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['U']);
  assert.match(excluded.find((e) => e.record_id === 'HEALTH').reason, /gate-4 sector: the firm sector is unresolved\/abstained/);
});

test('gate 4: a restricted sub_sector with a null firm sub_sector excludes (fail-closed)', () => {
  const catalogue = [rec({ id: 'SUB', sector: ['law-firms'], sub_sector: ['solicitors'] })];
  const firm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('law-firms', null) });
  const { applicable, excluded } = connect(firm, catalogue);
  assert.equal(applicable.length, 0);
  assert.match(excluded[0].reason, /gate-4 sub-sector/);
});

test('gate 4: a restricted sub_sector matches when the firm sub_sector is a member', () => {
  const catalogue = [rec({ id: 'SUB', sector: ['law-firms'], sub_sector: ['solicitors', 'conveyancing'] })];
  const firm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('law-firms', 'solicitors') });
  assert.deepEqual(connect(firm, catalogue).applicable.map((r) => r.id), ['SUB']);
});

// ── GATE 4 sub-sector: ancestor/sector/synonym-aware binding (P6 connection-integrity, D4) ─────────────
// The classifier only ever emits a detection-tree LEAF sub-sector; the catalogue restricts records with
// the coarse PARENT label, a SYNONYM, or the leaf. Exact string membership stranded 9 of 12 uk-healthcare
// tags and every us-legal record. These prove the ancestor-aware bind and, crucially, that it does not
// over-bind across sectors.

test('gate 4 sub-sector (D4 Site 1): a Botox clinic (leaf injectables) binds a record restricted to the PARENT label aesthetics', () => {
  const botox = [rec({ id: 'MHRA', sector: ['healthcare'], sub_sector: ['aesthetics', 'gp-clinic', 'pharmacy'] })];
  const firm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('aesthetics', 'injectables') });
  assert.deepEqual(connect(firm, botox).applicable.map((r) => r.id), ['MHRA'],
    'an injectables leaf binds the coarse aesthetics parent label (the Botox/injectables miss, now fixed)');
});

test('gate 4 sub-sector (D4 Site 2): a GP clinic (leaf general-practice) binds a record restricted to the SYNONYM gp-clinic', () => {
  const cqc = [rec({ id: 'CQC20A', sector: ['healthcare'], sub_sector: ['gp-clinic', 'dental', 'hospital'] })];
  const firm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('healthcare', 'general-practice') });
  assert.deepEqual(connect(firm, cqc).applicable.map((r) => r.id), ['CQC20A'],
    'the CQC rating record binds a GP lead via the gp-clinic->general-practice synonym');
});

test('gate 4 sub-sector: a US law firm (leaf solicitors) binds records restricted to the SYNONYMS law-firm/attorney (us-legal was 100% dead)', () => {
  const aba = [rec({ id: 'ABA', jurisdiction: 'US', sector: ['legal'], sub_sector: ['law-firm', 'attorney'] })];
  const firm = { jurisdiction: { bound: [{ jurisdiction: 'US', tier_evidence: [{ tier: 'A', kind: 'register' }] }], serves: [], sub_jurisdictions: [], abstained: false },
    sector: sectorFact('law-firms', 'solicitors'), capabilities: null };
  assert.deepEqual(connect(firm, aba).applicable.map((r) => r.id), ['ABA']);
});

test('gate 4 sub-sector: newly-reachable opticians and vets bind their previously-DEAD records', () => {
  const optician = factsFor({ jurisdiction: boundUK(), sector: sectorFact('healthcare', 'optometry') });
  assert.deepEqual(connect(optician, [rec({ id: 'GOC', sector: ['healthcare'], sub_sector: ['optometry'] })]).applicable.map((r) => r.id), ['GOC']);
  const vet = factsFor({ jurisdiction: boundUK(), sector: sectorFact('healthcare', 'veterinary') });
  assert.deepEqual(connect(vet, [rec({ id: 'RCVS', sector: ['healthcare'], sub_sector: ['veterinary'] })]).applicable.map((r) => r.id), ['RCVS']);
});

test('gate 4 sub-sector: ancestor-aware binding does NOT over-bind across siblings (a dental firm never gets the aesthetics-only record)', () => {
  const dentalFirm = factsFor({ jurisdiction: boundUK(), sector: sectorFact('dental', 'general-dental') });
  const aestheticsOnly = [rec({ id: 'BOTOX_U18', sector: ['healthcare'], sub_sector: ['aesthetics'] })];
  const { applicable, excluded } = connect(dentalFirm, aestheticsOnly);
  assert.equal(applicable.length, 0, 'a dental firm must not inherit an aesthetics-only injectables rule');
  assert.match(excluded[0].reason, /gate-4 sub-sector/);
});

test('gate 4 sub-sector: a general healthcare firm (general-practice) does NOT bind an aesthetics-only record', () => {
  const gp = factsFor({ jurisdiction: boundUK(), sector: sectorFact('healthcare', 'general-practice') });
  const aestheticsOnly = [rec({ id: 'BOTOX_U18', sector: ['healthcare'], sub_sector: ['aesthetics'] })];
  assert.equal(connect(gp, aestheticsOnly).applicable.length, 0);
});

// ── GATE 5: activity tags ────────────────────────────────────────────────────────────────────────────

test('gate 5: a record whose EVERY activity tag is present:false is excluded (basis disproven)', () => {
  const catalogue = [rec({ id: 'ACT', activity_tags: ['ecommerce', 'payments'] })];
  const firm = factsFor({ jurisdiction: boundUK(), capabilities: caps({ ecommerce: false, payments: false }) });
  const { applicable, excluded } = connect(firm, catalogue);
  assert.equal(applicable.length, 0);
  assert.match(excluded[0].reason, /gate-5 activity/);
});

test('gate 5: a record stays applicable when one tag is present:false but another is true (any true proves the basis)', () => {
  const catalogue = [rec({ id: 'ACT', activity_tags: ['ecommerce', 'payments'] })];
  const firm = factsFor({ jurisdiction: boundUK(), capabilities: caps({ ecommerce: false, payments: true }) });
  assert.deepEqual(connect(firm, catalogue).applicable.map((r) => r.id), ['ACT']);
});

test('gate 5: an unknown/missing tag leaves the basis unproven (not disproven); the record stays applicable', () => {
  const catalogue = [rec({ id: 'ACT', activity_tags: ['ecommerce', 'payments'] })];
  // ecommerce disproven, payments unknown -> not EVERY tag disproven -> applicable.
  const firm = factsFor({ jurisdiction: boundUK(), capabilities: caps({ ecommerce: false, payments: 'unknown' }) });
  assert.deepEqual(connect(firm, catalogue).applicable.map((r) => r.id), ['ACT']);
});

test('gate 5: null capabilities never excludes an activity-tagged record (unknown, never disproven; no crash)', () => {
  const catalogue = [rec({ id: 'ACT', activity_tags: ['ecommerce', 'payments'] })];
  const firm = factsFor({ jurisdiction: boundUK(), capabilities: null });
  assert.deepEqual(connect(firm, catalogue).applicable.map((r) => r.id), ['ACT']);
});

// ── GATE 6: required nexus (the any-of mapping this module owns) ──────────────────────────────────────

test('gate 6: an established_in-only record is REJECTED without Tier A establishment evidence', () => {
  const catalogue = [rec({ id: 'ESTAB', sector: ['universal'], required_nexus: ['established_in'] })];
  const tierBonly = factsFor({ jurisdiction: boundUK({ tierA: false }) });
  const { applicable, excluded } = connect(tierBonly, catalogue);
  assert.equal(applicable.length, 0, 'Tier B binding does not satisfy established_in');
  assert.match(excluded[0].reason, /gate-6 required-nexus/);
});

test('gate 6: an established_in-only record is ACCEPTED with incorporated_in (Tier A) evidence', () => {
  const jurisdiction = {
    bound: [{ jurisdiction: 'UK', tier_evidence: [{ tier: 'A', kind: 'incorporated_in', weight: 5, source: 'footer' }], confidence: 'corroborated', score: 5 }],
    serves: [], sub_jurisdictions: [], abstained: false,
  };
  const catalogue = [rec({ id: 'ESTAB', sector: ['universal'], required_nexus: ['established_in'] })];
  assert.deepEqual(connect(factsFor({ jurisdiction }), catalogue).applicable.map((r) => r.id), ['ESTAB']);
});

test('gate 6: any-of - a record listing [established_in, serves_customers_in] binds a bound-only (Tier B) firm', () => {
  const catalogue = [rec({ id: 'EITHER', sector: ['universal'], required_nexus: ['established_in', 'serves_customers_in'] })];
  const tierBonly = factsFor({ jurisdiction: boundUK({ tierA: false }) });
  assert.deepEqual(connect(tierBonly, catalogue).applicable.map((r) => r.id), ['EITHER'], 'serves_customers_in holds on a bound jurisdiction');
});

test('gate 6: Tier B/C evidence never satisfies established_in (hasEstablishmentEvidence unit)', () => {
  assert.equal(hasEstablishmentEvidence({ tier_evidence: [{ tier: 'B', kind: 'postcode' }, { tier: 'C', kind: 'prose_mention' }] }), false);
  assert.equal(hasEstablishmentEvidence({ tier_evidence: [{ tier: 'A', kind: 'register' }] }), true);
  // A mislabelled kind at a B tier is still rejected (defence in depth).
  assert.equal(hasEstablishmentEvidence({ tier_evidence: [{ tier: 'B', kind: 'register' }] }), false);
});

// ── counts ────────────────────────────────────────────────────────────────────────────────────────

test('counts: frameworksAssessed dedupes families by normalised citation.act', () => {
  // Two UK records citing the SAME act (different spacing/case) are ONE family; a third is another.
  const catalogue = [
    rec({ id: 'A1', citation: { act: 'Data Protection Act 2018' } }),
    rec({ id: 'A2', citation: { act: 'data protection act  2018' } }),
    rec({ id: 'B1', citation: { act: 'Equality Act 2010' } }),
  ];
  const { counts } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.equal(counts.frameworksAssessed, 2, 'two distinct families among the three gate-1 passers');
  assert.equal(counts.frameworksBinding, 2);
});

test('counts: frameworksBinding <= frameworksAssessed, and a jurisdiction-only passer inflates assessed not binding', () => {
  // A UK record that passes gate 1 but fails gate 6 raises frameworksAssessed above frameworksBinding.
  const catalogue = [
    rec({ id: 'BIND', citation: { act: 'Act Bind' }, required_nexus: ['serves_customers_in'], sector: ['universal'] }),
    rec({ id: 'ASSESS_ONLY', citation: { act: 'Act Assess' }, required_nexus: ['established_in'], sector: ['universal'] }),
  ];
  const { applicable, counts } = connect(factsFor({ jurisdiction: boundUK({ tierA: false }) }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['BIND']);
  assert.equal(counts.frameworksAssessed, 2);
  assert.equal(counts.frameworksBinding, 1);
  assert.ok(counts.frameworksBinding <= counts.frameworksAssessed);
});

test('counts: rulesChecked sums website_obligations.length over the applicable set only', () => {
  const catalogue = [
    rec({ id: 'A', website_obligations: [{ duty: 'a' }, { duty: 'b' }] }),
    rec({ id: 'US_SKIP', jurisdiction: 'US', citation: { act: 'US' }, website_obligations: [{ duty: 'x' }, { duty: 'y' }, { duty: 'z' }] }),
    rec({ id: 'C', citation: { act: 'Act C' }, website_obligations: [{ duty: 'c' }] }),
  ];
  const { counts } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.equal(counts.rulesChecked, 3, 'only the two applicable UK records contribute 2 + 1 duties');
});

test('counts: catalogueSize is NOT emitted (C-118)', () => {
  const { counts } = connect(factsFor({ jurisdiction: boundUK() }), [rec({})]);
  assert.deepEqual(Object.keys(counts).sort(), ['frameworksAssessed', 'frameworksBinding', 'rulesChecked']);
});

// ── input tolerance + robustness ────────────────────────────────────────────────────────────────────

test('input tolerance: a { records: [] } wrapper and a bare array are equivalent', () => {
  const records = [rec({ id: 'A' }), rec({ id: 'US', jurisdiction: 'US', citation: { act: 'US' } })];
  const facts = factsFor({ jurisdiction: boundUK() });
  const fromArray = connect(facts, records);
  const fromWrapper = connect(facts, { records });
  assert.deepEqual(fromArray.applicable.map((r) => r.id), fromWrapper.applicable.map((r) => r.id));
  assert.deepEqual(fromArray.counts, fromWrapper.counts);
});

test('input tolerance: a malformed (null / non-object) record is excluded, never crashes', () => {
  const catalogue = [null, 42, rec({ id: 'GOOD' })];
  const { applicable, excluded } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['GOOD']);
  const shapeFails = excluded.filter((e) => /gate-0 shape/.test(e.reason));
  assert.equal(shapeFails.length, 2);
});

test('input tolerance: an empty / non-array catalogue yields empty applicable and zero counts', () => {
  const facts = factsFor({ jurisdiction: boundUK() });
  for (const cat of [[], {}, null, undefined, { records: 'nope' }]) {
    const { applicable, excluded, counts } = connect(facts, cat);
    assert.equal(applicable.length, 0);
    assert.equal(excluded.length, 0);
    assert.deepEqual(counts, { frameworksAssessed: 0, frameworksBinding: 0, rulesChecked: 0 });
  }
});

// ── non-mutation + order ─────────────────────────────────────────────────────────────────────────────

test('non-mutation: a deep-frozen record does not throw and is returned by reference', () => {
  const frozen = Object.freeze(rec({ id: 'FROZEN', citation: Object.freeze({ act: 'Act Frozen' }), website_obligations: Object.freeze([Object.freeze({ duty: 'd' })]), sector: Object.freeze(['universal']), required_nexus: Object.freeze(['serves_customers_in']), activity_tags: Object.freeze([]), sub_sector: Object.freeze([]) }));
  const catalogue = Object.freeze([frozen]);
  let result;
  assert.doesNotThrow(() => { result = connect(factsFor({ jurisdiction: boundUK() }), catalogue); });
  assert.equal(result.applicable.length, 1);
  assert.equal(result.applicable[0], frozen, 'the applicable record is the SAME object reference (never a mutated copy)');
});

test('order preservation: applicable preserves input order', () => {
  const catalogue = [
    rec({ id: 'A', citation: { act: 'Act A' } }),
    rec({ id: 'US', jurisdiction: 'US', citation: { act: 'US' } }),
    rec({ id: 'B', citation: { act: 'Act B' } }),
    rec({ id: 'C', citation: { act: 'Act C' } }),
  ];
  const { applicable } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.deepEqual(applicable.map((r) => r.id), ['A', 'B', 'C']);
});

test('first-failure-wins: the reason names the EARLIEST failing gate (jurisdiction before nexus)', () => {
  // A US record that ALSO fails nexus must report the jurisdiction gate (evaluated first), not nexus.
  const catalogue = [rec({ id: 'US', jurisdiction: 'US', required_nexus: ['established_in'], citation: { act: 'US' } })];
  const { excluded } = connect(factsFor({ jurisdiction: boundUK() }), catalogue);
  assert.match(excluded[0].reason, /gate-1 jurisdiction/);
  assert.doesNotMatch(excluded[0].reason, /gate-6/);
});

// ── firmSectorIdentitySet unit ───────────────────────────────────────────────────────────────────────

test('firmSectorIdentitySet: a child sector yields {child, family}; an abstained sector yields null', () => {
  const dental = firmSectorIdentitySet(sectorFact('dental', 'general-dental'));
  assert.ok(dental.has('dental') && dental.has('healthcare'), 'dental folds up to its healthcare family');
  assert.equal(firmSectorIdentitySet(sectorFact(null)), null, 'an abstained sector fact has no identity set');
  assert.equal(firmSectorIdentitySet(null), null);
});

// ── INTEGRATION: the four real facts doors over the reference bundles + the compiled catalogue ─────────
// Loads the compiled catalogue via the e2e loader; SKIPS LOUDLY if the dist artifact is absent (CI
// compiles it first per caution.md C-201/C-240). Asserts the leak class is closed on real firms.

const catalogueRecordsLib = require('../eval/e2e/lib/catalogue-records.js');
const distExists = fs.existsSync(catalogueRecordsLib.DEFAULT_CATALOGUE_PATH);

test('integration: reference firms - no jurisdiction leak, russell-cooke usefulness, every excluded carries a reason', { skip: distExists ? false : 'compiled catalogue absent at catalogue/dist/catalogue.v1.json - run `npm run catalogue` first (C-201/C-240). SKIPPING the integration leg LOUDLY rather than passing vacuously.' }, () => {
  const identity = require('../facts/identity.js');
  const jurisdiction = require('../facts/jurisdiction.js');
  const sector = require('../facts/sector.js');
  const capabilities = require('../facts/capabilities.js');
  const records = catalogueRecordsLib.loadCatalogueRecords();
  assert.ok(records.length > 0, 'the loader returned records (dist present)');

  function run(fixtureFile) {
    const bundle = require(path.join('..', 'eval', 'reference-set', 'fixtures', fixtureFile));
    identity.resolveIdentity(bundle); // the fourth real facts door runs over the bundle (its output is not an applicability input)
    const facts = {
      jurisdiction: jurisdiction.resolveJurisdiction(bundle),
      sector: sector.resolveSector(bundle),
      capabilities: capabilities.deriveCapabilities(bundle),
    };
    return { facts, result: connect(facts, records) };
  }

  for (const fixtureFile of ['russell-cooke.co.uk.json', 'lomond.co.uk.json']) {
    const { facts, result } = run(fixtureFile);
    const boundSet = new Set(facts.jurisdiction.bound.map((b) => b.jurisdiction));
    const leaks = result.applicable.filter((r) => !boundSet.has(r.jurisdiction));
    assert.deepEqual(leaks.map((r) => r.id), [], fixtureFile + ': ZERO applicable records outside the bound set [' + [...boundSet].join(', ') + ']');
    for (const e of result.excluded) {
      assert.equal(typeof e.reason, 'string', fixtureFile + ': every excluded entry carries a reason string');
      assert.ok(e.reason.length > 0, fixtureFile + ': the reason is non-empty');
    }
    assert.ok(result.counts.frameworksBinding <= result.counts.frameworksAssessed, fixtureFile + ': binding <= assessed');
  }

  // Usefulness (C-236): the filter must not be vacuously safe. russell-cooke (a UK law firm) MUST retain
  // at least one applicable UK record.
  const rc = run('russell-cooke.co.uk.json');
  const ukApplicable = rc.result.applicable.filter((r) => r.jurisdiction === 'UK');
  assert.ok(ukApplicable.length > 0, 'russell-cooke keeps at least one applicable UK record (the filter is not vacuously empty)');
});

// ── INTEGRATION: P6 connection-integrity (uk-tech-media-industrial wave) ────────────────────────────
// End-to-end proof that the vocabulary leaves added for the tmi dead-record class, and the
// ATOL/package-travel + barrister sector-tag retags, actually bind through the REAL compiled
// catalogue - not just that facts/vocabulary.js's own reachability predicate is satisfied. Uses the
// REAL facts/sector.js resolveSector() (no injected vocabulary) over a synthetic firm bundle, and a
// synthetic Tier A UK-established jurisdiction envelope (the jurisdiction door itself is out of scope
// for this probe; only the sector/sub-sector binding this PR touches is under test). Skips loudly
// when the compiled catalogue is absent, matching the pattern above.

const realSector = require('../facts/sector.js');

function realBundleFor(domain, text) {
  return { domain, corpus: { pages: [{ url: 'https://' + domain + '/', title: 'x', text, jsonLd: [] }] }, registers: {} };
}

// ukEstablishedFacts(text) -> the { jurisdiction, sector, capabilities } envelope connect() reads, built
// from a Tier A UK-established jurisdiction (satisfies every required_nexus alternative these records
// use) and the REAL sector door's resolution of a synthetic firm's page text.
function ukEstablishedFacts(domain, text) {
  return {
    jurisdiction: boundUK({ tierA: true }),
    sector: realSector.resolveSector(realBundleFor(domain, text)),
    capabilities: null,
  };
}

test('P6 wave: genuine samples bind the exact records they target, through the real compiled catalogue', { skip: distExists ? false : 'compiled catalogue absent at catalogue/dist/catalogue.v1.json - run `npm run catalogue` first' }, () => {
  const records = catalogueRecordsLib.loadCatalogueRecords();
  assert.ok(records.length > 0, 'the loader returned records (dist present)');

  function applicableIds(domain, text) {
    const facts = ukEstablishedFacts(domain, text);
    return connect(facts, records).applicable.map((r) => r.id);
  }

  const gymIds = applicableIds('ironclad-gym.co.uk',
    'Join Ironclad Gym today. Our gym membership includes access to a fitness studio for spin studio '
    + 'classes, plus a sports club social area. Sign up online for a rolling monthly membership.');
  assert.ok(gymIds.includes('UK_CCR_FITNESS_DISTANCE'), 'a genuine gym binds UK_CCR_FITNESS_DISTANCE');
  assert.ok(gymIds.includes('UK_CRA_UNFAIR_TERMS_FITNESS'), 'a genuine gym binds UK_CRA_UNFAIR_TERMS_FITNESS');

  const vodIds = applicableIds('streambox.example',
    'Watch on StreamBox: a video on demand service with thousands of shows and movies. Our streaming '
    + 'service lets you stream TV and movies on any device, plus catch-up TV on our catchup service so '
    + 'you never miss a programme.');
  assert.ok(vodIds.includes('UK_ODPS_NOTIFICATION'), 'a genuine VOD service binds UK_ODPS_NOTIFICATION');

  const carDealerIds = applicableIds('thornfield-motors.co.uk',
    'Browse our used cars for sale at Thornfield Motors, a main dealer for three leading brands. We '
    + 'also offer vehicle leasing and van sales for business customers, plus PCP finance from GBP 199 a '
    + 'month.');
  assert.ok(carDealerIds.includes('UK_FCA_MOTOR_FINANCE_PROMOTIONS'), 'a genuine car dealer binds UK_FCA_MOTOR_FINANCE_PROMOTIONS');

  // The sector-tag fix: was sector:["transport"] (never bindable by a travel firm), now
  // sector:["hospitality"] (the sector a real ATOL travel agent actually resolves to).
  const atolIds = applicableIds('suntrail-travel.co.uk',
    'Book your next holiday with SunTrail Travel, an ATOL-protected tour operator and travel agent. We '
    + 'are ABTA members offering package holiday deals across Europe.');
  assert.ok(atolIds.includes('UK_ATOL_LICENSING'), 'a genuine ATOL travel agent binds UK_ATOL_LICENSING (post sector-tag fix)');
  assert.ok(atolIds.includes('UK_PACKAGE_TRAVEL_2018'), 'a genuine ATOL travel agent binds UK_PACKAGE_TRAVEL_2018 (post sector-tag fix)');

  // The barrister sector-tag fix (uk-legal.json): was sector:["legal"] (folds to law-firms, never
  // bindable by a barrister), now sector:["barristers"] (the sector a real chambers firm resolves to).
  const barristerIds = applicableIds('ashford-chambers.co.uk',
    'Ashford Chambers offers direct access to our barristers for individuals and businesses. We accept '
    + 'public access instructions and offer instructing counsel services without delay.');
  assert.ok(barristerIds.includes('UK_BSB_HANDBOOK_PUBLICITY'), 'a genuine barristers chambers binds UK_BSB_HANDBOOK_PUBLICITY (post sector-tag fix)');
  assert.ok(barristerIds.includes('UK_BSB_TRANSPARENCY'), 'a genuine barristers chambers binds UK_BSB_TRANSPARENCY (post sector-tag fix)');

  // Anti-misclassification, end to end: the same three adversarial samples from facts/sector.test.js
  // must not pick up ANY tmi-pack record through the new leaves (proves the vocabulary hardening holds
  // all the way through connect(), not just at the resolveSector layer).
  const healthcareIds = applicableIds('meadowbrook-medical.co.uk',
    'Welcome to Meadowbrook Medical Centre, a private hospital and medical centre offering GP '
    + 'appointments and cancer care. The clinic is CQC registered. All staff wear appropriate personal '
    + 'protective equipment and our clinical waste removal is handled by a licensed contractor.');
  const tmiIds = new Set(['UK_GDPR_SAAS', 'UK_NIS_RDSP', 'UK_DMCC_SUBS_UCP', 'UK_CAP_AI_CLAIMS', 'UK_PECR_EMARKETING',
    'UK_INFLUENCER_AD_DISCLOSURE', 'UK_OSA_UGC', 'UK_ODPS_NOTIFICATION', 'UK_PRESS_REGULATOR_MEMBERSHIP',
    'UK_CCR_FITNESS_DISTANCE', 'UK_CRA_UNFAIR_TERMS_FITNESS', 'UK_CAP_HEALTH_FITNESS_CLAIMS',
    'UK_FCA_MOTOR_FINANCE_PROMOTIONS', 'UK_OFGEM_SUPPLY_LICENCE', 'UK_ATOL_LICENSING', 'UK_PACKAGE_TRAVEL_2018',
    'UK_UKCA_CE_MARKING_CLAIMS', 'UK_CPR305_DOP', 'UK_ENERGY_LABELLING_ONLINE', 'UK_GAS_SAFE_REGISTRATION',
    'UK_BSA_BUILDING_CONTROL_REGISTRATION', 'UK_WASTE_CARRIER_REGISTRATION']);
  assert.deepEqual(healthcareIds.filter((id) => tmiIds.has(id)), [],
    'a hospital mentioning PPE/clinical waste must never bind any tmi-pack sector-restricted record');

  const realEstateIds = applicableIds('bellview-estates.co.uk',
    "Bellview Estates is a leading estate agent with properties for sale and homes for sale across the "
    + "city. Our current listings include a stunning studio apartment with access to the building's "
    + 'residents\' gym, and a two-bedroom home to let for tenants seeking a long-term tenancy.');
  assert.deepEqual(realEstateIds.filter((id) => tmiIds.has(id)), [],
    'a real-estate listing with a studio apartment and a residents-gym amenity must never bind a fitness record');
});
