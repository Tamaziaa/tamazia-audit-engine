'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('./metrics.js');

function fakeFamilyOf(sectorId) {
  const map = { solicitors: 'law-firms', 'gp-clinic': 'healthcare', telemedicine: 'healthcare', 'claims-management': 'finance' };
  return map[sectorId] || sectorId;
}

test('sectorTop1: correct family match', () => {
  const site = { sector_paths: ['legal.solicitors'] };
  const status = metrics.sectorTop1(site, { sector: 'solicitors' }, fakeFamilyOf);
  assert.equal(status, 'correct');
});

test('sectorTop1: abstain (null value) is distinguished from wrong', () => {
  const site = { sector_paths: ['healthcare.gp-clinic'] };
  assert.equal(metrics.sectorTop1(site, null, fakeFamilyOf), 'abstain');
  assert.equal(metrics.sectorTop1(site, { sector: 'claims-management' }, fakeFamilyOf), 'wrong');
});

test('THE NAMED REGRESSION: londondoctors-shaped site abstains, not "wrong"', () => {
  // Mirrors eval/reality-corpus/sites/londondoctors.yml: an unambiguous healthcare GP group. The
  // current engine's _rivalFamiliesAtFloor gate emits sector.value === null (abstain) for this shape,
  // not a wrong classification - this test locks the DISTINCTION the corpus gate depends on: an
  // abstain must never be silently scored the same as either a correct match or a wrong one.
  const site = { sector_paths: ['healthcare.gp-clinic'] };
  assert.equal(metrics.sectorTop1(site, null, fakeFamilyOf), 'abstain');
});

test('jurisdictionEstablishmentBind: recall and wrong-attach counted separately', () => {
  const site = { establishment: [{ jurisdiction: 'UK' }] };
  const clean = metrics.jurisdictionEstablishmentBind(site, ['UK']);
  assert.equal(clean.recall, 1);
  assert.equal(clean.wrong_attach_count, 0);

  const wrongAttach = metrics.jurisdictionEstablishmentBind(site, ['UK', 'US']);
  assert.equal(wrongAttach.recall, 1);
  assert.equal(wrongAttach.wrong_attach_count, 1);
  assert.deepEqual(wrongAttach.wrong_attach, ['US']);

  const abstained = metrics.jurisdictionEstablishmentBind(site, []);
  assert.equal(abstained.recall, 0);
});

test('applicabilityRecall: catalogue gap is excluded from the recall denominator', () => {
  const site = { applicable_law_ids: ['UK_SRA_TRANSPARENCY', 'UK_OISC_IAA_REGISTRATION'] };
  const catalogueIds = ['UK_SRA_TRANSPARENCY', 'UK_PECR_COOKIES_MARKETING'];
  // UK_SRA_TRANSPARENCY exists and bound; UK_OISC_IAA_REGISTRATION does not exist in the catalogue at all.
  const result = metrics.applicabilityRecall(site, ['UK_SRA_TRANSPARENCY'], catalogueIds);
  assert.deepEqual(result.catalogue_gaps, ['UK_OISC_IAA_REGISTRATION']);
  assert.equal(result.assessable_count, 1);
  assert.equal(result.recall, 1);
});

test('applicabilityRecall: a record that exists but did not bind is a real miss, recall < 1', () => {
  const site = { applicable_law_ids: ['UK_CQC_20A_RATING', 'UK_CQC_REGISTRATION'] };
  const catalogueIds = ['UK_CQC_20A_RATING', 'UK_CQC_REGISTRATION'];
  const result = metrics.applicabilityRecall(site, ['UK_CQC_REGISTRATION'], catalogueIds);
  assert.equal(result.assessable_count, 2);
  assert.equal(result.recall, 0.5);
  assert.deepEqual(result.not_bound, ['UK_CQC_20A_RATING']);
});

test('breachCoverage: a reproduced quote-matched violation counts as reproduced', () => {
  const site = { labelled_breaches: [{ law_id: 'UK_PECR_COOKIES_MARKETING', quote_substring: 'google-analytics.com/analytics.js' }] };
  const findings = [{ record_id: 'UK_PECR_COOKIES_MARKETING', state: 'violation', artifact: { text: 'google-analytics.com/analytics.js loaded unconditionally' } }];
  const result = metrics.breachCoverage(site, findings, true);
  assert.equal(result.reproduced_count, 1);
  assert.equal(result.coverage_adjusted_recall, 1);
});

test('breachCoverage: a lane-incomplete run marks the label unassessable, never "missed"', () => {
  const site = { labelled_breaches: [{ law_id: 'UK_PECR_COOKIES_MARKETING', quote_substring: 'ga.js' }] };
  const result = metrics.breachCoverage(site, [], false);
  assert.equal(result.rows[0].status, 'unassessable_lane_incomplete');
  assert.equal(result.assessable_count, 0);
  assert.equal(result.coverage_adjusted_recall, null);
});

test('breachCoverage: complete lane + zero findings for that record is a genuine miss', () => {
  const site = { labelled_breaches: [{ law_id: 'UK_SRA_TRANSPARENCY', quote_substring: 'domestic-conveyancing' }] };
  const result = metrics.breachCoverage(site, [], true);
  assert.equal(result.rows[0].status, 'missed');
  assert.equal(result.assessable_count, 1);
  assert.equal(result.coverage_adjusted_recall, 0);
});

// ---------------------------------------------------------------------------------------------------
// THE ADVERSARIAL PROOF the task requires: a synthetic fabricated finding injected into a fixture
// payload must make the false-accusation gate fail. This is proof (b) from the task's PROOF list.
// ---------------------------------------------------------------------------------------------------
test('ADVERSARIAL: a fabricated violation on a known-clean law trips falseAccusations', () => {
  const site = {
    known_clean_laws: ['UK_EQUALITY_ACCESSIBILITY'],
  };
  // This finding never existed in the real audit; it is HAND-INJECTED here to prove the gate reacts.
  const fabricatedFindings = [
    { record_id: 'UK_EQUALITY_ACCESSIBILITY', state: 'violation', artifact: { snippet: 'input#wpforms-1523-field_1 has no accessible label (FABRICATED FOR THIS TEST)' } },
  ];
  const hits = metrics.falseAccusations(site, fabricatedFindings);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].law_id, 'UK_EQUALITY_ACCESSIBILITY');
  assert.match(hits[0].quote, /FABRICATED FOR THIS TEST/);
});

test('falseAccusations: a violation on a law NOT in known_clean_laws is not flagged (it may be a real, correctly-labelled breach elsewhere)', () => {
  const site = { known_clean_laws: ['UK_EQUALITY_ACCESSIBILITY'] };
  const findings = [{ record_id: 'UK_PECR_COOKIES_MARKETING', state: 'violation', artifact: {} }];
  assert.deepEqual(metrics.falseAccusations(site, findings), []);
});

test('falseAccusations: needs_review on a known-clean law is never a false accusation (only violation counts)', () => {
  const site = { known_clean_laws: ['UK_EQUALITY_ACCESSIBILITY'] };
  const findings = [{ record_id: 'UK_EQUALITY_ACCESSIBILITY', state: 'needs_review', artifact: {} }];
  assert.deepEqual(metrics.falseAccusations(site, findings), []);
});

test('findingQuoteText: checks evidence_quote, then artifact.text/snippet/quote/host/url, never throws on empty finding', () => {
  assert.equal(metrics.findingQuoteText(null), '');
  assert.equal(metrics.findingQuoteText({}), '');
  assert.equal(metrics.findingQuoteText({ evidence_quote: 'a' }), 'a');
  assert.equal(metrics.findingQuoteText({ artifact: { snippet: 'b' } }), 'b');
});
