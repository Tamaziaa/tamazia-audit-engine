'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyRegisterAbsence, noteForRegister } = require('./register-absence');
const { CODES } = require('./result');

function bundleWith(notes, registers) {
  return { registers: Object.assign({ notes }, registers || {}) };
}

const noMatchNote = { register: 'sra', kind: 'no_match', reason: 'no candidate cleared the name match', detail: null };

test('a register_absence backed by a definitive no_match note (and no present row) is verified', () => {
  const bundle = bundleWith([noMatchNote]);
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: noMatchNote }, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_VERIFIED);
});

test('a degraded lookup proves NOTHING: an absence claim behind a degraded note is rejected (C-004)', () => {
  const degraded = { register: 'sra', kind: 'degraded', reason: 'missing api key', detail: null };
  const bundle = bundleWith([degraded]);
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: degraded }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

test('a skipped lookup (judged not applicable) also proves nothing and is rejected', () => {
  const skipped = { register: 'sra', kind: 'skipped', reason: 'not applicable to this sector', detail: null };
  const bundle = bundleWith([skipped]);
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: skipped }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

test('no note at all for the register is rejected (the lane never recorded running)', () => {
  const bundle = bundleWith([]);
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: null }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

test('an absence claim against a register that returned a PRESENT row is rejected (the firm is on it)', () => {
  const bundle = bundleWith([noMatchNote], { sra: { organisation_name: 'Example Law Firm LLP', sra_number: '500046' } });
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: noMatchNote }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_ROW_PRESENT);
});

test('a missing register field is rejected before any bundle lookup', () => {
  const bundle = bundleWith([noMatchNote]);
  const r = verifyRegisterAbsence({ type: 'register_absence', lane: 'no_match', note: noMatchNote }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_MISSING_FIELDS);
});

test('an entirely absent bundle.registers rejects (no note proves the lookup ran), never a crash', () => {
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: noMatchNote }, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

test('the note for the wrong register does not satisfy the claim (per-register proof)', () => {
  const otherNote = { register: 'fca', kind: 'no_match', reason: 'no match', detail: null };
  const bundle = bundleWith([otherNote]);
  const r = verifyRegisterAbsence({ type: 'register_absence', register: 'sra', lane: 'no_match', note: otherNote }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ABSENCE_NOT_PROVEN);
});

test('noteForRegister returns the matching entry or null, never throws on a malformed bundle', () => {
  assert.equal(noteForRegister({ registers: { notes: [noMatchNote] } }, 'sra'), noMatchNote);
  assert.equal(noteForRegister({ registers: { notes: [] } }, 'sra'), null);
  assert.equal(noteForRegister({}, 'sra'), null);
  assert.equal(noteForRegister(null, 'sra'), null);
});
