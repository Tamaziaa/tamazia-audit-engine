'use strict';
// catalogue/schema.test.js - node:test suite for the Compliance Object Model schema validator.
// Run: node --test catalogue/schema.test.js  (or node --test catalogue/*.test.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('./schema.js');

// ---------------------------------------------------------------------------------
// A known-good record, structurally identical to real pack records (pruned to a
// minimal-but-complete shape so mutation tests are easy to read).
//
// CR-37: every fact below is a SYNTHETIC placeholder ("Fake Act 2099" style) - never a real law
// name, citation, penalty figure, regulator or enforcement case. This is a pure SHAPE-validation
// fixture (catalogue/schema.js checks structure, type and enum membership only, never content
// truth), so it has no need of real legal content to do its job, and Constitution Rule 2
// (catalogue-only law facts) is best honoured by never hand-copying a real fine/regulator/law title
// into a test fixture outside catalogue/packs/ in the first place - a stale or drifted copy here
// would be exactly the class of defect Rule 2 exists to prevent, just one repo-search away from
// looking like a second source of truth. The citation/enforcement/register URLs use the `.example`
// TLD (IANA-reserved for documentation and testing, RFC 2606) so nothing here can ever collide with
// a real, live domain.
// ---------------------------------------------------------------------------------
function goodRecord() {
  return {
    jurisdiction: 'UK',
    sub_jurisdiction: null,
    status: 'candidate',
    client_useful: true,
    id: 'FAKE_ACT_2099_TEST_RECORD',
    name: 'Fake Act 2099 (synthetic test fixture - privacy notice duty)',
    citation: {
      act: 'Fake Act 2099 (synthetic fixture, not a real statute)',
      section: 'Fake Act 2099 s.1',
      url: 'https://law.example/fake-act-2099',
    },
    sector: ['universal'],
    sub_sector: [],
    activity_tags: ['b2c', 'ecommerce', 'cookies_present'],
    required_nexus: ['processes_residents_of', 'serves_customers_in'],
    applies_when: ['processes personal data of UK residents (synthetic fixture)'],
    excluded_when: ['purely personal or household processing'],
    website_obligations: [
      {
        duty: 'Publish an accessible privacy notice',
        elements: ['identity and contact details of the controller'],
        evidence_type: 'presence',
      },
    ],
    penalty: {
      typical_low: 100000,
      typical_high: 900000,
      statutory_max: 1000000,
      currency: 'GBP',
      basis: 'Synthetic test penalty basis (Fake Act 2099 s.9, not a real figure)',
      max_is_rare: true,
    },
    regulator: {
      name: 'Fake Test Regulator (synthetic fixture, not a real body)',
      register_url: 'https://law.example/register',
    },
    enforcement: [
      {
        case: 'Fake Test Regulator v Fake Test Co Ltd (synthetic fixture)',
        date: '2099-01',
        amount: 'GBP 900,000',
        url: 'https://law.example/enforcement/fake-test-co',
        summary: 'Synthetic test enforcement case; not a real regulatory action.',
      },
    ],
    intel: {
      why_matters: 'Synthetic fixture: exercises the intel.why_matters shape only.',
      regulator_asks_first: 'Synthetic fixture: exercises the intel.regulator_asks_first shape only.',
      relevance_hook: 'Synthetic fixture: exercises the intel.relevance_hook shape only.',
    },
    provenance: {
      sources: ['FAKE-SOURCE-01 (synthetic test fixture, not a real source)'],
      seed_status: 'confirmed',
      verified_date: '2026-07-16',
      last_synced: '2026-07-16',
    },
  };
}

function goodPack() {
  return {
    cell: 'fake-test-cell',
    jurisdiction: 'UK',
    generated: '2026-07-16',
    records: [goodRecord()],
  };
}

// ---------------------------------------------------------------------------------
// validateRecord
// ---------------------------------------------------------------------------------

test('validateRecord: accepts a well-formed record with zero violations', () => {
  assert.deepEqual(schema.validateRecord(goodRecord()), []);
});

test('validateRecord: never throws on a non-object', () => {
  assert.doesNotThrow(() => schema.validateRecord(null));
  assert.doesNotThrow(() => schema.validateRecord(undefined));
  assert.doesNotThrow(() => schema.validateRecord('a string'));
  assert.doesNotThrow(() => schema.validateRecord(42));
  assert.doesNotThrow(() => schema.validateRecord([]));
  assert.ok(schema.validateRecord(null).length > 0);
});

test('validateRecord: rejects a missing id and a badly-shaped id', () => {
  const r1 = goodRecord(); delete r1.id;
  assert.ok(schema.validateRecord(r1).some((m) => m.includes('id: required')));

  const r2 = goodRecord(); r2.id = 'lower-case-not-allowed';
  assert.ok(schema.validateRecord(r2).some((m) => m.includes('id:') && m.includes('must match')));
});

test('validateRecord: rejects an unknown jurisdiction code', () => {
  const r = goodRecord();
  r.jurisdiction = 'ZZ';
  const v = schema.validateRecord(r);
  assert.ok(v.some((m) => m.includes('jurisdiction:') && m.includes('ZZ')));
});

test('validateRecord: accepts the "universal" sector sentinel and a real canonical sector, rejects an unknown sector', () => {
  const universal = goodRecord();
  assert.deepEqual(schema.validateRecord(universal), []);

  const canonical = goodRecord();
  canonical.sector = ['legal']; // aliases to law-firms via facts/vocabulary.js canonicalSector
  assert.deepEqual(schema.validateRecord(canonical), []);

  const bad = goodRecord();
  bad.sector = ['not-a-real-sector'];
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('sector:') && m.includes('not-a-real-sector')));
});

test('validateRecord: sub_sector accepts empty array and lowercase-hyphen slugs, rejects underscores/uppercase', () => {
  const empty = goodRecord(); empty.sub_sector = [];
  assert.deepEqual(schema.validateRecord(empty), []);

  const good = goodRecord(); good.sub_sector = ['gp-clinic', 'telemedicine'];
  assert.deepEqual(schema.validateRecord(good), []);

  const bad = goodRecord(); bad.sub_sector = ['medical_devices'];
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('sub_sector:') && m.includes('medical_devices')));
});

test('validateRecord (CR-36): sub_sector is enum-checked against facts/vocabulary.js CANONICAL_SUB_SECTORS - a well-formed slug that is not a canonical member is rejected', () => {
  const bad = goodRecord();
  bad.sub_sector = ['not-a-real-sub-sector'];
  const v = schema.validateRecord(bad);
  assert.ok(v.some((m) => m.includes('sub_sector:') && m.includes('not-a-real-sub-sector') && m.includes('CANONICAL_SUB_SECTORS')));
});

test('validateRecord: activity_tags is enum-checked against facts/vocabulary.js ACTIVITY_TAGS', () => {
  const bad = goodRecord();
  bad.activity_tags = ['b2c', 'not_a_real_tag'];
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('activity_tags:') && m.includes('not_a_real_tag')));
});

test('validateRecord: required_nexus must be non-empty and enum-checked', () => {
  const empty = goodRecord(); empty.required_nexus = [];
  assert.ok(schema.validateRecord(empty).some((m) => m.includes('required_nexus:') && m.includes('non-empty')));

  const bad = goodRecord(); bad.required_nexus = ['made_up_relation'];
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('required_nexus:') && m.includes('made_up_relation')));
});

test('validateRecord: sub_jurisdiction accepts null, "multi", and a modelled US state; rejects an unmodelled code', () => {
  const nullSub = goodRecord();
  assert.deepEqual(schema.validateRecord(nullSub), []);

  const multi = goodRecord();
  multi.jurisdiction = 'US';
  multi.sub_jurisdiction = 'multi';
  // clear US-specific fields not under test; jurisdiction mismatch with sector/citation is fine at record level
  assert.deepEqual(schema.validateRecord(multi).filter((m) => m.includes('sub_jurisdiction')), []);

  const state = goodRecord();
  state.jurisdiction = 'US';
  state.sub_jurisdiction = 'CA';
  assert.deepEqual(schema.validateRecord(state).filter((m) => m.includes('sub_jurisdiction')), []);

  const bad = goodRecord();
  bad.jurisdiction = 'US';
  bad.sub_jurisdiction = 'ZZ';
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('sub_jurisdiction:') && m.includes('ZZ')));

  const badUkRecord = goodRecord(); badUkRecord.sub_jurisdiction = 'CA'; // a US state code is not valid under UK
  assert.ok(schema.validateRecord(badUkRecord).some((m) => m.includes('sub_jurisdiction:')));
});

test('validateRecord: citation.url must be a valid http(s) URL', () => {
  const bad = goodRecord();
  bad.citation.url = 'not a url';
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('citation.url:')));

  const ftp = goodRecord();
  ftp.citation.url = 'ftp://example.com/x';
  assert.ok(schema.validateRecord(ftp).some((m) => m.includes('citation.url:')));
});

test('validateRecord: status is a closed three-value enum', () => {
  const bad = goodRecord();
  bad.status = 'approved';
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('status:') && m.includes('approved')));
  for (const s of schema.STATUSES) {
    const ok = goodRecord(); ok.status = s;
    assert.deepEqual(schema.validateRecord(ok).filter((m) => m.includes('status:')), []);
  }
});

test('validateRecord: website_obligations.evidence_type is a closed four-value enum', () => {
  const bad = goodRecord();
  bad.website_obligations[0].evidence_type = 'maybe';
  assert.ok(schema.validateRecord(bad).some((m) => m.includes('evidence_type:') && m.includes('maybe')));
  for (const e of schema.EVIDENCE_TYPES) {
    const ok = goodRecord(); ok.website_obligations[0].evidence_type = e;
    assert.deepEqual(schema.validateRecord(ok).filter((m) => m.includes('evidence_type:')), []);
  }
});

test('validateRecord: penalty.currency is a closed two-value enum and typical_low must not exceed typical_high', () => {
  const badCurrency = goodRecord();
  badCurrency.penalty.currency = 'EUR';
  assert.ok(schema.validateRecord(badCurrency).some((m) => m.includes('penalty.currency:')));

  const inverted = goodRecord();
  inverted.penalty.typical_low = 999999999;
  inverted.penalty.typical_high = 1;
  assert.ok(schema.validateRecord(inverted).some((m) => m.includes('typical_low') && m.includes('typical_high')));
});

test('validateRecord: penalty fields may be null (non-monetary regimes)', () => {
  const nonMonetary = goodRecord();
  nonMonetary.penalty = {
    typical_low: null, typical_high: null, statutory_max: null,
    currency: 'GBP', basis: 'No financial penalty; injunction only', max_is_rare: true,
  };
  assert.deepEqual(schema.validateRecord(nonMonetary), []);
});

test('validateRecord: enforcement entries each require case/date/amount/url/summary', () => {
  const bad = goodRecord();
  bad.enforcement = [{ case: 'X' }];
  const v = schema.validateRecord(bad);
  assert.ok(v.some((m) => m.includes('enforcement[0].date')));
  assert.ok(v.some((m) => m.includes('enforcement[0].amount')));
  assert.ok(v.some((m) => m.includes('enforcement[0].url')));
  assert.ok(v.some((m) => m.includes('enforcement[0].summary')));
});

test('validateRecord: provenance.sources must be non-empty and verified_date must be YYYY-MM-DD', () => {
  const noSources = goodRecord();
  noSources.provenance.sources = [];
  assert.ok(schema.validateRecord(noSources).some((m) => m.includes('provenance.sources:')));

  const badDate = goodRecord();
  badDate.provenance.verified_date = '16-07-2026';
  assert.ok(schema.validateRecord(badDate).some((m) => m.includes('provenance.verified_date:')));
});

test('validateRecord: provenance.last_synced is mandatory and semantically validated (Rule 14)', () => {
  const noSync = goodRecord();
  delete noSync.provenance.last_synced;
  assert.ok(schema.validateRecord(noSync).some((m) => m.includes('provenance.last_synced:')));

  // ISO-shaped but impossible calendar dates are rejected on BOTH provenance dates.
  const impossible = goodRecord();
  impossible.provenance.last_synced = '2026-02-30';
  assert.ok(schema.validateRecord(impossible).some((m) => m.includes('provenance.last_synced:') && m.includes('not a real calendar date')));

  const impossibleVerified = goodRecord();
  impossibleVerified.provenance.verified_date = '2026-13-01';
  assert.ok(schema.validateRecord(impossibleVerified).some((m) => m.includes('provenance.verified_date:') && m.includes('not a real calendar date')));
});

test('isRealDate / isRealTimestamp: shape passes but impossible calendar values are rejected', () => {
  assert.equal(schema.isRealDate('2026-07-16'), true);
  assert.equal(schema.isRealDate('2028-02-29'), true); // real leap day
  assert.equal(schema.isRealDate('2026-02-30'), false);
  assert.equal(schema.isRealDate('2026-13-01'), false);
  assert.equal(schema.isRealDate('2026-00-10'), false);
  assert.equal(schema.isRealTimestamp('2026-07-16T00:00:00Z'), true);
  assert.equal(schema.isRealTimestamp('2026-07-16T23:59:59.999Z'), true);
  assert.equal(schema.isRealTimestamp('2026-02-30T00:00:00Z'), false);
  assert.equal(schema.isRealTimestamp('2026-07-16T24:00:00Z'), false);
  assert.equal(schema.isRealTimestamp('2026-07-16T00:60:00Z'), false);
});

test('validateRecord: advisory is optional but must be boolean when present', () => {
  const withTrue = goodRecord(); withTrue.advisory = true;
  assert.deepEqual(schema.validateRecord(withTrue), []);

  const badType = goodRecord(); badType.advisory = 'yes';
  assert.ok(schema.validateRecord(badType).some((m) => m.includes('advisory:')));
});

// ---------------------------------------------------------------------------------
// validatePack
// ---------------------------------------------------------------------------------

test('validatePack: accepts a well-formed pack with zero violations', () => {
  assert.deepEqual(schema.validatePack(goodPack()), []);
});

test('validatePack: never throws on a non-object', () => {
  assert.doesNotThrow(() => schema.validatePack(null));
  assert.ok(schema.validatePack(null).length > 0);
});

test('validatePack: rejects a malformed generated date and cell slug', () => {
  const p = goodPack();
  p.generated = '16 July 2026';
  p.cell = 'UK_Universal';
  const v = schema.validatePack(p);
  assert.ok(v.some((m) => m.includes('generated:')));
  assert.ok(v.some((m) => m.includes('cell:')));
});

test('validatePack: rejects duplicate record ids', () => {
  const p = goodPack();
  p.records = [goodRecord(), goodRecord()];
  const v = schema.validatePack(p);
  assert.ok(v.some((m) => m.includes('duplicates records[0]')));
});

test('validatePack: rejects a record whose jurisdiction disagrees with the pack jurisdiction', () => {
  const p = goodPack();
  const r = goodRecord();
  r.jurisdiction = 'US';
  r.sub_jurisdiction = 'multi';
  p.records = [r];
  const v = schema.validatePack(p);
  assert.ok(v.some((m) => m.includes('does not match pack jurisdiction')));
});

test('validatePack: propagates a nested record violation with a records[i] locator', () => {
  const p = goodPack();
  delete p.records[0].name;
  const v = schema.validatePack(p);
  assert.ok(v.some((m) => m.startsWith('records[0]') && m.includes('name: required')));
});

// ---------------------------------------------------------------------------------
// Calibration: eval/calibration-known-bad/fixtures/p2-schema-violation.json (the earn-your-zero
// doctrine, Constitution Rule 4/caution.md C-149). schema.js is a pure validator module with no
// --calibrate CLI of its own (unlike the linters in catalogue/linters/, which are gate-cli tools),
// so this suite IS the calibration gate for the schema: it must load the seeded-bad pack directly
// and prove validatePack() reports every one of its independently-seeded defects, not just "some".
// ---------------------------------------------------------------------------------

test('validatePack: catches every seeded defect in the p2-schema-violation.json calibration fixture', () => {
  const fixturePath = path.join(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures', 'p2-schema-violation.json');
  if (!fs.existsSync(fixturePath)) {
    assert.fail('eval/calibration-known-bad/fixtures/p2-schema-violation.json is missing; the schema gate has nothing to earn its zero against');
  }
  const pack = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const v = schema.validatePack(pack);
  assert.ok(v.length > 0, 'expected non-empty violations on the deliberately malformed calibration fixture');

  const expectSome = (fragment) => assert.ok(
    v.some((m) => m.includes(fragment)),
    'expected a violation containing ' + JSON.stringify(fragment) + '; got: ' + JSON.stringify(v)
  );
  expectSome('id:'); // lowercase id fails ID_RX
  expectSome('name: required'); // name missing entirely
  expectSome('status:'); // "approved-by-nobody" is not a closed enum value
  expectSome('activity_tags:'); // "not_a_real_activity_tag" is not an ACTIVITY_TAGS member
  expectSome('citation.url:'); // "not-a-valid-url" is not http(s)
  expectSome('evidence_type:'); // "not_a_real_evidence_type" is not a closed enum value
  expectSome('typical_low'); // 5,000,000 exceeds typical_high 100
  expectSome('penalty.currency:'); // "EUR" is not GBP|USD
  expectSome('provenance.verified_date:'); // "not-a-date" fails DATE_RX
});

// ---------------------------------------------------------------------------------
// Smoke test against the real, committed packs (the C-148 doctrine: an eval that never
// executes the real entry point against real data is not coverage). us-healthcare.json's
// US_FDA_DEVICE sub_sector was fixed (medical_devices -> medical-devices, a P2 catalogue hygiene
// pass); every real pack now clears with zero schema violations. Re-add a KNOWN_FINDINGS entry
// here (never loosen the schema itself) if a real pack regresses.
//
// CR-10 (fail closed, caution.md C-201): catalogue/packs/ is COMMITTED, git-tracked staged data
// (`git ls-files catalogue/packs` lists all 13 files) - never a gitignored build output this module
// happens not to own. Its absence at test time therefore means a broken checkout, not a legitimate
// reason to silently SKIP the one smoke test that exercises real content: a skip here looks
// IDENTICAL to a clean pass in a green CI run. This test now FAILS instead.
// ---------------------------------------------------------------------------------

const PACKS_DIR = path.join(__dirname, 'packs');

test('validatePack: smoke test against every real committed pack', () => {
  assert.ok(
    fs.existsSync(PACKS_DIR),
    'catalogue/packs/ is not present on disk. This directory is committed, git-tracked staged data '
    + '(see `git ls-files catalogue/packs`), not a build output - its absence means a broken checkout '
    + 'or a working tree not cloned from repo HEAD (caution.md C-201), not a legitimate skip condition.'
  );
  const files = fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 7, 'expected at least 7 packs on disk, found ' + files.length);

  const KNOWN_FINDINGS = {};

  for (const f of files) {
    const pack = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8'));
    const v = schema.validatePack(pack);
    const allowed = KNOWN_FINDINGS[f] || [];
    const unexpected = v.filter((msg) => !allowed.some((frag) => msg.includes(frag)));
    assert.deepEqual(unexpected, [], f + ' has unexpected schema violations: ' + JSON.stringify(unexpected));
    // Every allowed known finding must still actually be present (not stale).
    for (const frag of allowed) {
      assert.ok(v.some((msg) => msg.includes(frag)), f + ' expected known finding not present: ' + frag);
    }
  }
});

test('validateRecord: an OMITTED sub_jurisdiction key is rejected; only explicit null passes (CR round-5)', () => {
  const omitted = goodRecord();
  delete omitted.sub_jurisdiction;
  assert.ok(schema.validateRecord(omitted).some((m) => m.includes('sub_jurisdiction:') && m.includes('required key')));
});
