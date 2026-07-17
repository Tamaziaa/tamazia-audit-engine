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
// ---------------------------------------------------------------------------------
function goodRecord() {
  return {
    jurisdiction: 'UK',
    sub_jurisdiction: null,
    status: 'candidate',
    client_useful: true,
    id: 'UK_GDPR_PRIVACY_NOTICE',
    name: 'UK GDPR and Data Protection Act 2018 (privacy notice)',
    citation: {
      act: 'UK GDPR (assimilated Regulation (EU) 2016/679); Data Protection Act 2018',
      section: 'UK GDPR Arts 5, 6, 13, 14, 21',
      url: 'https://www.legislation.gov.uk/eur/2016/679/contents',
    },
    sector: ['universal'],
    sub_sector: [],
    activity_tags: ['b2c', 'ecommerce', 'cookies_present'],
    required_nexus: ['processes_residents_of', 'serves_customers_in'],
    applies_when: ['processes personal data of UK residents'],
    excluded_when: ['purely personal or household processing'],
    website_obligations: [
      {
        duty: 'Publish an accessible privacy notice',
        elements: ['identity and contact details of the controller'],
        evidence_type: 'presence',
      },
    ],
    penalty: {
      typical_low: 1230000,
      typical_high: 14000000,
      statutory_max: 17500000,
      currency: 'GBP',
      basis: 'Higher maximum of GBP 17.5m or 4% of turnover',
      max_is_rare: true,
    },
    regulator: {
      name: "Information Commissioner's Office (ICO)",
      register_url: 'https://ico.org.uk/ESDWebPages/Search',
    },
    enforcement: [
      {
        case: 'ICO v Capita plc',
        date: '2025-10',
        amount: 'GBP 14,000,000',
        url: 'https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2025/10/capita-14m-fine/',
        summary: 'Fined GBP 14m after a ransomware attack.',
      },
    ],
    intel: {
      why_matters: 'Almost every business website processes personal data.',
      regulator_asks_first: 'Show me your privacy notice.',
      relevance_hook: 'A missing privacy notice is a visible, evidenced breach.',
    },
    provenance: {
      sources: ['UK-GDPR-01 (seed, confirmed)'],
      seed_status: 'confirmed',
      verified_date: '2026-07-16',
    },
  };
}

function goodPack() {
  return {
    cell: 'uk-universal',
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
// catalogue/packs/ is STAGED INPUT DATA, not something this module owns or writes. If it is
// absent at test time (a fresh clone before the packs are staged, or a working tree where they
// have not been restored) this smoke test SKIPS with a loud, explicit reason rather than either
// silently passing (a directory that does not exist is not "zero violations") or hard-failing
// the whole suite on a precondition outside catalogue/schema.js's control.
// ---------------------------------------------------------------------------------

const PACKS_DIR = path.join(__dirname, 'packs');

test('validatePack: smoke test against every real committed pack', (t) => {
  if (!fs.existsSync(PACKS_DIR)) {
    t.skip('catalogue/packs/ is not present on disk (staged input data, not owned by this module) - skipping the real-pack smoke test');
    return;
  }
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
