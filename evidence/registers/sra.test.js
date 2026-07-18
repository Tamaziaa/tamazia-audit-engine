'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupSra, applies } = require('./sra');

const MATCH_RESPONSE = {
  status: 200,
  json: [{ organisationName: 'KINGSLEY NAPLEY LLP', sraNumber: '500046', firmType: 'LLP', addressLine1: '1 Chancery Lane', town: 'London', postcode: 'WC2A 1AA' }],
};

const NONMATCH_RESPONSE = {
  status: 200,
  json: [{ organisationName: 'Kingsley Carpets Ltd', sraNumber: '999999' }],
};

test('applies(): law-firms and barristers are in scope; an unrelated sector is not; unspecified tries', () => {
  assert.equal(applies('law-firms'), true);
  assert.equal(applies('barristers'), true);
  assert.equal(applies('hospitality'), false);
  assert.equal(applies(undefined), true);
});

test('lookupSra: sector gate skips a non-law sector before any fetch, note kind is "skipped"', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupSra({ query: 'Kingsley Napley LLP', sector: 'hospitality', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.kind, 'skipped');
  assert.equal(r.note.reason, 'sector_not_applicable');
});

test('lookupSra: no key required; a genuine match on a law-firms sector returns a row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupSra({ query: 'Kingsley Napley LLP', sector: 'law-firms', fetchFn, deadlineMs: 500, keys: {} });
  assert.ok(r.row);
  assert.equal(r.row.source, 'sra');
  assert.equal(r.row.sra_number, '500046');
  assert.equal(r.row.organisation_name, 'KINGSLEY NAPLEY LLP');
});

test('lookupSra: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => NONMATCH_RESPONSE;
  const r = await lookupSra({ query: 'Kingsley Napley LLP', sector: 'law-firms', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});

test('lookupSra: Rule 3 -- a NAME-ONLY hit with no SRA number is not a verifiable register row, returns no row', async () => {
  // A perfect name match but the record carries no sraNumber: without the register identifier there is
  // no machine-verifiable artifact, so the candidate is dropped and no row can be built on it.
  const fetchFn = async () => ({ status: 200, json: [{ organisationName: 'KINGSLEY NAPLEY LLP' }] });
  const r = await lookupSra({ query: 'Kingsley Napley LLP', sector: 'law-firms', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null, 'no SRA number -> no verifiable row (NO ARTIFACT, NO BREACH)');
});
