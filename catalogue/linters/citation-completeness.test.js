'use strict';
// catalogue/linters/citation-completeness.test.js - node:test suite for the citation-completeness
// linter (Constitution Rule 14, caution.md C-104).
// Run: node --test catalogue/linters/citation-completeness.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const linter = require('./citation-completeness.js');
const lib = require('./lib.js');
const { packsDirOrFail } = require('./test-helpers.js');

// ---------------------------------------------------------------------------------
// OFFICIAL_HOSTS shape
// ---------------------------------------------------------------------------------

test('OFFICIAL_HOSTS is a frozen, non-empty array of lowercase host suffixes', () => {
  assert.ok(Object.isFrozen(linter.OFFICIAL_HOSTS));
  assert.ok(linter.OFFICIAL_HOSTS.length > 10);
  for (const h of linter.OFFICIAL_HOSTS) {
    assert.equal(typeof h, 'string');
    assert.equal(h, h.toLowerCase());
  }
});

test('citationHostOfficial: matches an exact allowlist entry and a subdomain of one, rejects an unrelated host', () => {
  assert.equal(linter.citationHostOfficial('https://www.legislation.gov.uk/ukpga/2015/30'), true);
  assert.equal(linter.citationHostOfficial('https://register.fca.org.uk/s/'), true); // subdomain of fca.org.uk
  assert.equal(linter.citationHostOfficial('https://some-law-firm-blog.com/article'), false);
  assert.equal(linter.citationHostOfficial('not a url'), false);
});

test('citationHostOfficial: the generic .gov and .gov.uk suffixes cover an unlisted agency subdomain', () => {
  assert.equal(linter.citationHostOfficial('https://www.tmb.texas.gov/page/board-rules'), true);
  assert.equal(linter.citationHostOfficial('https://modern-slavery-statement-registry.service.gov.uk/'), true);
});

// ---------------------------------------------------------------------------------
// checkRecord: the mandatory contract
// ---------------------------------------------------------------------------------

function goodRecord() {
  return {
    id: 'CAL_TEST_GOOD',
    status: 'candidate',
    citation: { act: 'x', section: 'y', url: 'https://www.legislation.gov.uk/x' },
    provenance: { sources: ['seed'] },
    penalty: { currency: 'GBP', basis: 'x' },
    enforcement: [{ url: 'https://ico.org.uk/case', date: '2026-01' }],
    regulator: { name: 'ICO', register_url: 'https://ico.org.uk/ESDWebPages/Search' },
  };
}

test('checkRecord: a candidate record with an official citation host and complete provenance/penalty/enforcement clears with zero findings', () => {
  assert.deepEqual(linter.checkRecord(goodRecord(), 'test'), []);
});

test('checkRecord: a candidate record citing an unofficial host is flagged citation-host-unofficial', () => {
  const r = goodRecord();
  r.citation.url = 'https://www.some-law-firm.com/insights/gdpr-guide';
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'citation-host-unofficial'));
});

test('checkRecord: a candidate record with no citation.url at all is flagged citation-missing, not citation-host-unofficial', () => {
  const r = goodRecord();
  delete r.citation.url;
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'citation-missing'));
  assert.ok(!v.some((f) => f.rule === 'citation-host-unofficial'));
});

test('checkRecord: a needs_verification record is NOT held to the mandatory official-host citation rule', () => {
  const r = goodRecord();
  r.status = 'needs_verification';
  r.citation.url = 'https://some-random-blog.example/article';
  const v = linter.checkRecord(r, 'test');
  assert.ok(!v.some((f) => f.rule === 'citation-host-unofficial'));
  assert.ok(!v.some((f) => f.rule === 'citation-missing'));
});

test('checkRecord: empty provenance.sources is flagged unconditionally regardless of status', () => {
  const r = goodRecord();
  r.status = 'needs_verification';
  r.provenance.sources = [];
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'provenance-sources-empty'));
});

test('checkRecord: penalty missing currency or basis is flagged', () => {
  const r = goodRecord();
  r.penalty = {};
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'penalty-currency-missing'));
  assert.ok(v.some((f) => f.rule === 'penalty-basis-missing'));
});

test('checkRecord: enforcement entries missing url or date are each flagged, and an unofficial enforcement host is flagged separately from a missing one', () => {
  const r = goodRecord();
  r.enforcement = [{ date: '2026-01' }, { url: 'https://a-news-outlet.example/story', date: '2026-02' }];
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'enforcement-url-missing'));
  assert.ok(v.some((f) => f.rule === 'enforcement-host-unofficial'));
});

test('checkRecord: an unofficial regulator.register_url is flagged register-host-unofficial (secondary, not blocking-only)', () => {
  const r = goodRecord();
  r.regulator.register_url = 'https://a-membership-body.example/register';
  const v = linter.checkRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'register-host-unofficial'));
});

test('checkRecord: never throws on a record with missing nested objects', () => {
  assert.doesNotThrow(() => linter.checkRecord({}, 'test'));
  const v = linter.checkRecord({}, 'test');
  assert.ok(v.length > 0);
});

// ---------------------------------------------------------------------------------
// selfTest + --calibrate
// ---------------------------------------------------------------------------------

test('selfTest passes', () => {
  const st = linter.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('scan against eval/calibration-known-bad/fixtures catches the seeded p2-citation-missing-official-host.json violation', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('p2-citation-missing-official-host.json') && v.rule === 'citation-host-unofficial');
  assert.ok(hit, 'expected a citation-host-unofficial finding on the seeded p2 fixture; got: ' + JSON.stringify(res.violations));
});

// ---------------------------------------------------------------------------------
// Real-pack smoke test (C-148 doctrine: an eval that never executes the real entry point
// against real data is not coverage). Documents today's known real findings so drift is
// visible rather than silently tolerated.
// ---------------------------------------------------------------------------------

test('scan: real committed packs produce exactly the documented known findings', () => {
  packsDirOrFail(__dirname);
  const res = linter.scan([lib.DEFAULT_PACK_GLOB]);
  assert.ok(res.scanned > 0);

  const KNOWN = [
    ['uk-tech-media-industrial.json', 'UK_CAP_AI_CLAIMS', 'enforcement-host-unofficial'],
    ['uk-tech-media-industrial.json', 'UK_PECR_EMARKETING', 'enforcement-host-unofficial'],
    // us-healthcare.json US_HIPAA_TRACKING/US_TELEHEALTH_LICENSURE and us-universal.json
    // US_STATE_PRIVACY_WAVE_2025_26 previously carried unofficial-host citation/enforcement/
    // register URLs (P2 catalogue hygiene pass): the unofficial enforcement entries were removed
    // (hosts moved to provenance.sources), the unofficial register_url was set to null, and the
    // uncitable aggregate record was downgraded to needs_verification (exempt from the mandatory
    // official-host check). All three now clear with zero findings; tighten back here if they
    // ever regress.
  ];
  for (const [file, id, rule] of KNOWN) {
    assert.ok(
      res.violations.some((v) => v.file.includes(file) && v.id === id && v.rule === rule),
      `expected known finding ${file}/${id}/${rule} not present`
    );
  }
  // No unexpected rule classes beyond the documented ones (a new unofficial host or a new
  // missing-field defect appearing must be seen, not silently absorbed by a >= check).
  const unexpected = res.violations.filter(
    (v) => !KNOWN.some(([file, id, rule]) => v.file.includes(file) && v.id === id && v.rule === rule)
  );
  assert.deepEqual(unexpected, [], 'unexpected citation-completeness findings on real packs: ' + JSON.stringify(unexpected));
});
