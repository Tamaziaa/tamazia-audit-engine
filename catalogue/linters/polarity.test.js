'use strict';
// catalogue/linters/polarity.test.js - node:test suite for the rule-polarity linter
// (caution.md C-046/C-047/C-048). Run: node --test catalogue/linters/polarity.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const linter = require('./polarity.js');
const lib = require('./lib.js');
const { packsDirOrFail } = require('./test-helpers.js');

// ---------------------------------------------------------------------------------
// checkComRecord: the SEMANTIC DOCTRINE
// ---------------------------------------------------------------------------------

test('checkComRecord: a correctly-typed prohibition (absence) and requirement (presence) clear with zero findings', () => {
  const r = {
    id: 'CAL_TEST_GOOD',
    website_obligations: [
      { duty: 'Do not advertise prescription-only medicine to the public', evidence_type: 'absence' },
      { duty: 'The firm must publish a privacy notice', evidence_type: 'presence' },
      { duty: 'The register must include the practitioner', evidence_type: 'register' },
    ],
  };
  assert.deepEqual(linter.checkComRecord(r, 'test'), []);
});

test('checkComRecord: prohibition language typed "presence" is a polarity-prohibition-mismatch (the DG-02 must_appear-fires-on-absence class)', () => {
  const r = {
    id: 'CAL_TEST_BAD_PROHIBIT',
    website_obligations: [{ duty: 'It is an offence to advertise this treatment to under-18s', evidence_type: 'presence' }],
  };
  const v = linter.checkComRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'polarity-prohibition-mismatch'));
});

test('checkComRecord: prohibition language typed "register" is still a mismatch (only "absence" satisfies a prohibition)', () => {
  const r = {
    id: 'CAL_TEST_BAD_PROHIBIT_REGISTER',
    website_obligations: [{ duty: 'The firm must not act where a conflict of interest is undisclosed', evidence_type: 'register' }],
  };
  const v = linter.checkComRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'polarity-prohibition-mismatch'));
});

test('checkComRecord: requirement language typed "absence" is a polarity-requirement-mismatch', () => {
  const r = {
    id: 'CAL_TEST_BAD_REQUIRE',
    website_obligations: [{ duty: 'The firm must publish its complaints procedure', evidence_type: 'absence' }],
  };
  const v = linter.checkComRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'polarity-requirement-mismatch'));
});

// ---------------------------------------------------------------------------------
// CR-9: inverted-combination fixtures modelled on real catalogue defect classes flagged on PR #3 -
// "the zero-polarity assertion is currently false confidence" without these. Each fixture below is
// modelled on a REAL record shape (cited in comments) rather than an arbitrary synthetic string, so
// the test documents exactly which production disease class it locks against a regression.
// ---------------------------------------------------------------------------------

test('checkComRecord: inverted combination - a PROHIBITION duty phrased "breach ... being present" (catalogue/packs/uk-tech-media-industrial.json\'s unfair-terms duty) typed "presence" is flagged polarity-prohibition-mismatch (CR-8)', () => {
  const r = {
    id: 'CAL_TEST_INVERTED_BREACH_PRESENT',
    website_obligations: [{
      duty: 'Published membership terms must be fair and transparent (the breach is an unfair term being present in the published terms)',
      evidence_type: 'presence', // inverted: this is prohibition wording, must be "absence"
    }],
  };
  const v = linter.checkComRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'polarity-prohibition-mismatch'), 'expected the "breach ... being present" wording class to be caught; got: ' + JSON.stringify(v));
});

test('checkComRecord: inverted combination - a REQUIREMENT duty ("must include a disclaimer", the US_ABA_RULE_7_1 prior-results-disclaimer class) typed "absence" is flagged polarity-requirement-mismatch', () => {
  const r = {
    id: 'CAL_TEST_INVERTED_DISCLAIMER_ABSENCE',
    website_obligations: [{
      duty: 'Where case results or testimonials are advertised, the firm must include a disclaimer that prior results do not guarantee a similar outcome',
      evidence_type: 'absence', // inverted: this is requirement wording, must be "presence" or "register"
    }],
  };
  const v = linter.checkComRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'polarity-requirement-mismatch'), 'expected the requirement-typed-absence inversion to be caught; got: ' + JSON.stringify(v));
});

test('checkComRecord: requirement language typed "presence" or "register" both clear (no mismatch)', () => {
  for (const evidenceType of ['presence', 'register']) {
    const r = { id: 'CAL_TEST_' + evidenceType, website_obligations: [{ duty: 'The firm must state its registration number', evidence_type: evidenceType }] };
    assert.deepEqual(linter.checkComRecord(r, 'test').filter((f) => f.rule.startsWith('polarity-')), []);
  }
});

test('checkComRecord: the negation-guard warning fires on an "absence" duty carrying self-declaration wording (the Botox U18 class), and is a warning severity not a mismatch', () => {
  const r = {
    id: 'CAL_TEST_NEGGUARD',
    website_obligations: [{ duty: 'We do not treat patients under the age of 18 with this product', evidence_type: 'absence' }],
  };
  const v = linter.checkComRecord(r, 'test');
  const guard = v.find((f) => f.rule === 'negation-guard-needed');
  assert.ok(guard);
  assert.equal(guard.severity, 'warning');
  assert.ok(!v.some((f) => f.rule === 'polarity-prohibition-mismatch'));
});

test('checkComRecord: neutral duty language (no prohibition or requirement markers) produces no findings regardless of evidence_type', () => {
  const r = { id: 'CAL_TEST_NEUTRAL', website_obligations: [{ duty: 'Cookie banner colour scheme', evidence_type: 'behavioural' }] };
  assert.deepEqual(linter.checkComRecord(r, 'test'), []);
});

test('checkComRecord: "behavioural" is exempt from polarity language checks even when the duty carries prohibition or requirement wording (an observed action can legitimately go either way)', () => {
  const prohibitionWorded = {
    id: 'CAL_TEST_BEHAVIOURAL_PROHIBIT',
    website_obligations: [{ duty: 'Firm names and domain names must not be false or misleading', evidence_type: 'behavioural' }],
  };
  const requirementWorded = {
    id: 'CAL_TEST_BEHAVIOURAL_REQUIRE',
    website_obligations: [{ duty: 'The site must display a working cookie consent banner', evidence_type: 'behavioural' }],
  };
  assert.deepEqual(linter.checkComRecord(prohibitionWorded, 'test'), []);
  assert.deepEqual(linter.checkComRecord(requirementWorded, 'test'), []);
});

test('checkComRecord: never throws on malformed website_obligations entries', () => {
  const r = { id: 'CAL_TEST_MALFORMED', website_obligations: [null, {}, { duty: 42 }, 'not an object'] };
  assert.doesNotThrow(() => linter.checkComRecord(r, 'test'));
});

// ---------------------------------------------------------------------------------
// checkLegacyRecord: the pre-COM flat-rule shape (still calibrated against)
// ---------------------------------------------------------------------------------

test('checkLegacyRecord: a prohibit-style rule whose regex describes the LAWFUL consent-before-cookies workflow is flagged legacy-polarity-inverted', () => {
  const r = { id: 'CAL_TEST_LEGACY_BAD', style: 'prohibit', regex_pattern: 'we (ask for|obtain) your consent before (setting|placing)( any)? cookies' };
  const v = linter.checkLegacyRecord(r, 'test');
  assert.ok(v.some((f) => f.rule === 'legacy-polarity-inverted'));
});

test('checkLegacyRecord: a prohibit-style rule with unrelated regex text clears', () => {
  const r = { id: 'CAL_TEST_LEGACY_GOOD', style: 'prohibit', regex_pattern: 'no\\s*win\\s*no\\s*fee\\s*guarantee' };
  assert.deepEqual(linter.checkLegacyRecord(r, 'test'), []);
});

// ---------------------------------------------------------------------------------
// selfTest + --calibrate
// ---------------------------------------------------------------------------------

test('selfTest passes', () => {
  const st = linter.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('scan against eval/calibration-known-bad/fixtures catches the seeded p2-polarity-inverted.json violation', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('p2-polarity-inverted.json') && v.rule === 'polarity-prohibition-mismatch');
  assert.ok(hit, 'expected a polarity-prohibition-mismatch finding on the seeded p2 fixture; got: ' + JSON.stringify(res.violations));
});

test('scan against eval/calibration-known-bad/fixtures also still catches the pre-existing legacy rule-polarity-inverted.json fixture', () => {
  const res = linter.scan([lib.CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('rule-polarity-inverted.json') && v.rule === 'legacy-polarity-inverted');
  assert.ok(hit);
});

// ---------------------------------------------------------------------------------
// Real-pack smoke test
// ---------------------------------------------------------------------------------

test('scan: real committed packs produce zero polarity findings (NY_RPC_7_3_7_4 carries prohibition wording under evidence_type "behavioural", which is exempt by design - see the behavioural-exemption test above; several UK register-verified claim-authenticity duties carry "breach ... being present" wording under evidence_type "register", also exempt by design - see the BREACH_PRESENT_RX register-exemption selfTest case)', () => {
  packsDirOrFail(__dirname);
  const res = linter.scan([lib.DEFAULT_PACK_GLOB]);
  assert.ok(res.scanned > 0);
  assert.deepEqual(res.violations, [], 'unexpected polarity findings on real packs: ' + JSON.stringify(res.violations));
});
