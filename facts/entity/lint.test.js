'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lintProposal, lintShape } = require('./lint.js');

const BYTES = 'Acme Dental Care Ltd, Company No. 12345678, registered in England and Wales. GDC number 123456. VAT registered.';

test('accepts a fully grounded candidate', () => {
  const p = { candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '12345678', source_quote: 'Acme Dental Care Ltd, Company No. 12345678' }] };
  assert.deepEqual(lintProposal(p, BYTES), { ok: true });
});

test('rejects a fabricated legal_name not in the bytes', () => {
  const p = { candidates: [{ legal_name: 'Totally Fake Ltd', company_number: null, source_quote: null }] };
  const r = lintProposal(p, BYTES);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^fabricated:/);
});

test('rejects a malformed CRN shape', () => {
  const p = { candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '123', source_quote: 'Acme Dental Care Ltd, Company No. 12345678' }] };
  const r = lintProposal(p, BYTES);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-crn');
});

test('rejects a CRN not present in the bytes even if shape-valid', () => {
  const p = { candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '99999999', source_quote: 'Acme Dental Care Ltd, Company No. 99999999' }] };
  const r = lintProposal(p, BYTES);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^fabricated:|^crn-not-in-bytes$/);
});

test('rejects an unbound candidate: name and number are each real but never co-occur in the quote', () => {
  const bytes = 'Acme Dental Care Ltd is on this page. Elsewhere: Company No. 12345678 belongs to someone else.';
  const p = { candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '12345678', source_quote: 'Acme Dental Care Ltd is on this page.' }] };
  const r = lintProposal(p, bytes);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unbound-candidate');
});

test('accepts null fields (LLM correctly reporting absence)', () => {
  const p = { candidates: [], privacy_controller: null, sector_evidence: [] };
  assert.deepEqual(lintProposal(p, BYTES), { ok: true });
});

test('rejects too many candidates (shape)', () => {
  const p = { candidates: [1, 2, 3, 4].map((n) => ({ legal_name: null, company_number: null, source_quote: null })) };
  const r = lintProposal(p, BYTES);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^shape:/);
});

test('sector claim without grounded evidence is rejected', () => {
  const p = { candidates: [], sector: 'healthcare', sub_sector: 'dental', sector_evidence: [] };
  const r = lintProposal(p, BYTES);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'sector-unevidenced');
});

test('sector claim WITH a grounded evidence span passes', () => {
  const p = { candidates: [], sector: 'healthcare', sub_sector: 'dental', sector_evidence: ['GDC number 123456'] };
  assert.deepEqual(lintProposal(p, BYTES), { ok: true });
});

test('lintShape rejects a non-object proposal', () => {
  assert.equal(lintShape(null), 'not-an-object');
  assert.equal(lintShape('nope'), 'not-an-object');
});

test('normalises smart quotes and whitespace before comparing', () => {
  const bytes = 'The firm “Acme Dental Care Ltd”  trading as Acme.';
  const p = { candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: null, source_quote: null }] };
  assert.deepEqual(lintProposal(p, bytes), { ok: true });
});
