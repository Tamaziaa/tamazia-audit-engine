'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyRegisterRow } = require('./register-row');
const { CODES } = require('./result');

const sraRow = {
  organisation_name: 'Example Law Firm LLP',
  sra_number: '500046',
  firm_type: 'Solicitor firm',
  registered_office_address: '1 Example Street, London, EC1 1AA',
  source: 'sra',
  fetched_at: '2026-01-01T00:00:00.000Z',
  query: 'Example Law Firm LLP',
  match: { name_queried: 'Example Law Firm LLP', name_matched: 'EXAMPLE LAW FIRM LLP', score: 0.98 },
};

test('a register_row candidate that exactly matches the bundle row is verified', () => {
  const bundle = { registers: { sra: sraRow } };
  const r = verifyRegisterRow({ type: 'register_row', register: 'sra', row: { ...sraRow } }, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.REGISTER_ROW_VERIFIED);
});

test('a cited row that differs in even one field (an altered SRA number) is rejected', () => {
  const bundle = { registers: { sra: sraRow } };
  const alteredRow = { ...sraRow, sra_number: '999999' };
  const r = verifyRegisterRow({ type: 'register_row', register: 'sra', row: alteredRow }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ROW_MISMATCH);
});

test('a register key absent from bundle.registers is rejected, including an unknown/misspelt key', () => {
  const bundle = { registers: { sra: sraRow } };
  const missing = verifyRegisterRow({ type: 'register_row', register: 'fca', row: { any: 'thing' } }, bundle);
  assert.equal(missing.verified, false);
  assert.equal(missing.code, CODES.REGISTER_ROW_ABSENT);
  const misspelt = verifyRegisterRow({ type: 'register_row', register: 'srra', row: { ...sraRow } }, bundle);
  assert.equal(misspelt.verified, false);
  assert.equal(misspelt.code, CODES.REGISTER_ROW_ABSENT);
});

test('missing artifact.register or artifact.row is rejected before any bundle lookup', () => {
  const bundle = { registers: { sra: sraRow } };
  const noRegister = verifyRegisterRow({ type: 'register_row', row: { ...sraRow } }, bundle);
  assert.equal(noRegister.code, CODES.REGISTER_ROW_MISSING_FIELDS);
  const noRow = verifyRegisterRow({ type: 'register_row', register: 'sra' }, bundle);
  assert.equal(noRow.code, CODES.REGISTER_ROW_MISSING_FIELDS);
  const arrayRow = verifyRegisterRow({ type: 'register_row', register: 'sra', row: [1, 2, 3] }, bundle);
  assert.equal(arrayRow.code, CODES.REGISTER_ROW_MISSING_FIELDS);
  // a missing artifact ENVELOPE fails closed with the same code, never a TypeError from reading .register
  const noArtifact = verifyRegisterRow(undefined, bundle);
  assert.equal(noArtifact.verified, false);
  assert.equal(noArtifact.code, CODES.REGISTER_ROW_MISSING_FIELDS);
  assert.equal(verifyRegisterRow(null, bundle).code, CODES.REGISTER_ROW_MISSING_FIELDS);
});

test('an entirely absent bundle.registers is rejected, never a crash', () => {
  const r = verifyRegisterRow({ type: 'register_row', register: 'sra', row: { ...sraRow } }, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ROW_ABSENT);
});

test('nested field drift (a changed match.score) is caught by the deep-equality check, not just top-level fields', () => {
  const bundle = { registers: { sra: sraRow } };
  const driftedMatch = { ...sraRow, match: { ...sraRow.match, score: 0.61 } };
  const r = verifyRegisterRow({ type: 'register_row', register: 'sra', row: driftedMatch }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.REGISTER_ROW_MISMATCH);
});
