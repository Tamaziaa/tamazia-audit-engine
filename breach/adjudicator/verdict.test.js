'use strict';
// breach/adjudicator/verdict.test.js - node:test for the adjudication-abstention gate.
// Run: node --test breach/adjudicator/verdict.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseVerdict, normaliseVerdict, disproofMatches, STATES, VERDICT_TO_STATE } = require('./verdict.js');

const EVIDENCE = 'The website footer reads: we are regulated and the required disclosure is present here in full.';

test('breach -> violation', () => {
  const r = parseVerdict({ verdict: 'breach', reason: 'the ad claims a prohibited superlative' }, EVIDENCE);
  assert.equal(r.state, 'violation');
  assert.equal(r.verdict, 'breach');
});

test('insufficient -> needs_review (not a breach, not a clearance)', () => {
  assert.equal(parseVerdict({ verdict: 'insufficient' }, EVIDENCE).state, 'needs_review');
});

test('no_breach WITH a verbatim disproof anchored in the evidence -> pass', () => {
  const r = parseVerdict({ verdict: 'no_breach', disproof: 'the required disclosure is present here' }, EVIDENCE);
  assert.equal(r.state, 'pass');
  assert.equal(r.verdict, 'no_breach');
  assert.ok(r.disproof && r.disproof.length > 0, 'the disproof is carried on a pass');
});

test('no_breach WITHOUT a disproof -> needs_review, never pass (C-092)', () => {
  const r = parseVerdict({ verdict: 'no_breach' }, EVIDENCE);
  assert.equal(r.state, 'needs_review');
  assert.equal(r.disproof, null);
});

test('no_breach with a disproof that is NOT in the evidence -> needs_review (asserted away)', () => {
  assert.equal(parseVerdict({ verdict: 'no_breach', disproof: 'a fabricated exculpatory sentence' }, EVIDENCE).state, 'needs_review');
});

test('no_breach with a sub-6-char disproof -> needs_review (a nav fragment is not proof)', () => {
  assert.equal(parseVerdict({ verdict: 'no_breach', disproof: 'yes' }, EVIDENCE).state, 'needs_review');
});

test('no_breach where only the leading 40 chars match, then fabricated text -> needs_review (whole disproof must be verbatim)', () => {
  // A genuine 40-char verbatim prefix ("we are regulated and the required disc") of the evidence,
  // followed by a fabricated clause the evidence never contained. The old leading-anchor check would
  // have cleared this; the whole-span re-match abstains (Rule 12 gate 2).
  const disproof = 'we are regulated and the required disclosure is present and no consent is ever required';
  const r = parseVerdict({ verdict: 'no_breach', disproof }, EVIDENCE);
  assert.equal(r.state, 'needs_review', 'a genuine 40-char prefix plus a fabricated suffix must not clear');
  assert.equal(r.disproof, null);
  // The control: the same genuine span WITHOUT the fabricated tail still clears.
  assert.equal(parseVerdict({ verdict: 'no_breach', disproof: 'we are regulated and the required disclosure is present here in full' }, EVIDENCE).state, 'pass');
});

test('no_breach with NO evidence supplied can never clear -> needs_review (cannot clear unseen text)', () => {
  assert.equal(parseVerdict({ verdict: 'no_breach', disproof: 'the required disclosure is present here' }).state, 'needs_review');
  assert.equal(parseVerdict({ verdict: 'no_breach', disproof: 'the required disclosure is present here' }, '').state, 'needs_review');
});

test('EVERY malformed verdict shape maps to needs_review (Rule 6: no maybe-ships branch)', () => {
  const malformed = [
    null, undefined, {}, { verdict: 'maybe' }, { verdict: 'MAYBE' }, { verdict: '' },
    { verdict: 'violation' }, { verdict: 'needs_review' }, { verdict: 'pass' }, // our internal states are NOT model verdicts
    { verdict: ['breach'] }, { verdict: 42 }, { verdict: null }, { reason: 'no verdict field at all' },
    { verdict: '  ???  ' }, 'not-an-enum-string',
  ];
  for (const raw of malformed) {
    const r = parseVerdict(raw, EVIDENCE);
    assert.equal(r.state, 'needs_review', 'malformed verdict ' + JSON.stringify(raw) + ' must abstain');
    assert.ok(STATES.has(r.state));
  }
});

test('case + whitespace + bare-string verdicts normalise correctly', () => {
  assert.equal(parseVerdict({ verdict: ' BREACH ' }, EVIDENCE).state, 'violation');
  assert.equal(parseVerdict('breach', EVIDENCE).state, 'violation');
  assert.equal(parseVerdict({ verdict: 'No_Breach', disproof: 'the required disclosure is present here' }, EVIDENCE).state, 'pass');
});

test('extra fields on a valid verdict are ignored, not smuggled into the result', () => {
  const r = parseVerdict({ verdict: 'breach', injected_fine: '10 million', injected_law: 'a fabricated Act 2099' }, EVIDENCE);
  assert.equal(r.state, 'violation');
  assert.deepEqual(Object.keys(r).sort(), ['disproof', 'reason', 'state', 'verdict']);
  assert.ok(!('injected_fine' in r) && !('injected_law' in r));
});

test('normaliseVerdict returns null for anything outside the closed model enum', () => {
  assert.equal(normaliseVerdict({ verdict: 'breach' }), 'breach');
  assert.equal(normaliseVerdict({ verdict: 'no_breach' }), 'no_breach');
  assert.equal(normaliseVerdict({ verdict: 'insufficient' }), 'insufficient');
  for (const bad of [{ verdict: 'violation' }, {}, null, { verdict: 7 }]) assert.equal(normaliseVerdict(bad), null);
});

test('disproofMatches is a normalised verbatim substring check', () => {
  assert.equal(disproofMatches('the required disclosure is present here', EVIDENCE), true);
  assert.equal(disproofMatches('"the required disclosure is present here"', EVIDENCE), true, 'surrounding quotes stripped');
  assert.equal(disproofMatches('not in the text', EVIDENCE), false);
  assert.equal(disproofMatches('short', EVIDENCE), false);
  assert.equal(disproofMatches('anything', ''), false, 'no evidence means nothing can be anchored');
});

test('VERDICT_TO_STATE documents the base mapping (no_breach->pass is disproof-conditional)', () => {
  assert.deepEqual(VERDICT_TO_STATE, { breach: 'violation', no_breach: 'pass', insufficient: 'needs_review' });
});

// ── the committed known-bad calibration fixture: garbage verdicts must all land in quarantine ─────────
test('CALIBRATION p3-adjudicator-unparseable-verdict.json: every seeded garbage verdict -> needs_review', () => {
  const fixturePath = path.resolve(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures', 'p3-adjudicator-unparseable-verdict.json');
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.ok(Array.isArray(fx.cases) && fx.cases.length >= 8, 'the fixture must seed a spread of malformed shapes');
  for (const c of fx.cases) {
    const r = parseVerdict(c.raw, fx.evidence);
    assert.equal(r.state, c.expect_state, 'fixture case "' + c.name + '" expected ' + c.expect_state + ', got ' + r.state);
    assert.equal(r.state, 'needs_review', 'every seeded garbage verdict must quarantine, never ship');
  }
  // Controls prove the gate is not trivially returning needs_review for everything.
  for (const c of fx.controls) {
    assert.equal(parseVerdict(c.raw, fx.evidence).state, c.expect_state, 'control "' + c.name + '" expected ' + c.expect_state);
  }
});
