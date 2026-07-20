'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const chRegister = require('./chRegister.js');

const PROFILE_OK = {
  status: 200,
  json: {
    company_number: '12345678',
    company_name: 'ACME DENTAL CARE LTD',
    company_status: 'active',
    registered_office_address: { address_line_1: '1 High Street', locality: 'London', postal_code: 'SW1A 1AA' },
    sic_codes: ['86230'],
  },
};

const OFFICERS_OK = { status: 200, json: { items: [{ name: 'SMITH, John' }] } };
const PSC_OK = { status: 200, json: { items: [] } };

test.beforeEach(() => chRegister._cacheClearForTests());

test('fetchProfileByCrn returns row + hash on a 200 profile response', async () => {
  const fetchFn = async () => PROFILE_OK;
  const result = await chRegister.fetchProfileByCrn('12345678', { fetchFn, keys: { companiesHouse: 'k' } });
  assert.ok(result);
  assert.equal(result.row.company_number, '12345678');
  assert.equal(typeof result.hash, 'string');
  assert.equal(result.hash.length, 64);
});

test('fetchProfileByCrn returns null when no key is supplied (fail closed)', async () => {
  const fetchFn = async () => PROFILE_OK;
  const result = await chRegister.fetchProfileByCrn('12345678', { fetchFn, keys: {} });
  assert.equal(result, null);
});

test('fetchProfileByCrn caches within TTL (second call does not refetch)', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return PROFILE_OK; };
  await chRegister.fetchProfileByCrn('12345678', { fetchFn, keys: { companiesHouse: 'k' } });
  await chRegister.fetchProfileByCrn('12345678', { fetchFn, keys: { companiesHouse: 'k' } });
  assert.equal(calls, 1);
});

test('fetchOfficerSurnames extracts a lowercase surname from officers + PSC', async () => {
  const calls = [];
  const fetchFn = async (url) => { calls.push(url); return url.includes('persons-with-significant-control') ? PSC_OK : OFFICERS_OK; };
  const { surnames } = await chRegister.fetchOfficerSurnames('12345678', { fetchFn, keys: { companiesHouse: 'k' } });
  assert.deepEqual(surnames, ['smith']);
  assert.equal(calls.length, 2);
});

test('corroborate: postcode match scores 3, one-directional (mismatch scores 0 for that point)', () => {
  const match = chRegister.corroborate({ chOfficeAddress: '1 High Street, London, SW1A 1AA', chSicCodes: [], practicePostcode: 'SW1A 1AA' });
  assert.equal(match.score, 3);
  const mismatch = chRegister.corroborate({ chOfficeAddress: '1 High Street, London, SW1A 1AA', chSicCodes: [], practicePostcode: 'EC1A 1BB' });
  assert.equal(mismatch.score, 0);
});

test('corroborate: officer surname on team page scores 2, SIC 86230 scores 1, additive', () => {
  const r = chRegister.corroborate({
    chOfficeAddress: null, chSicCodes: ['86230'], practicePostcode: null,
    teamText: 'Meet our lead dentist Dr John Smith', officerSurnames: ['smith'],
  });
  assert.equal(r.score, 3); // 2 (surname) + 1 (SIC)
});

test('corroborate: all three signals stack to 6', () => {
  const r = chRegister.corroborate({
    chOfficeAddress: '1 High Street, SW1A 1AA', chSicCodes: ['86230'], practicePostcode: 'SW1A 1AA',
    teamText: 'Dr John Smith', officerSurnames: ['smith'],
  });
  assert.equal(r.score, 6);
});
