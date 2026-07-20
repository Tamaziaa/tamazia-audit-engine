'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runCanary, hasKeyFor } = require('./canary');

test('runCanary: no key configured -> not attempted, ok:false, no fetch call made', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { status: 200, json: {} }; };
  const result = await runCanary('companies_house', { fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(result.ok, false);
  assert.match(result.message, /missing_key/);
  assert.equal(called, false);
});

test('runCanary: companies_house canary passes on the exact known-good Tesco PLC shape', async () => {
  const fetchFn = async () => ({ status: 200, json: { company_number: '00445790', company_status: 'active' } });
  const result = await runCanary('companies_house', { fetchFn, deadlineMs: 500, keys: { companiesHouse: 'k' } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

test('runCanary: companies_house canary fails on a wrong/empty body (key present but bad response)', async () => {
  const fetchFn = async () => ({ status: 200, json: {} });
  const result = await runCanary('companies_house', { fetchFn, deadlineMs: 500, keys: { companiesHouse: 'k' } });
  assert.equal(result.ok, false);
  assert.match(result.message, /expected known-good shape/);
});

test('runCanary: a 401/expired-key response fails the canary', async () => {
  const fetchFn = async () => ({ status: 401, json: { message: 'Access denied' } });
  const result = await runCanary('companies_house', { fetchFn, deadlineMs: 500, keys: { companiesHouse: 'stale-key' } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('runCanary: a fetch timeout/error fails the canary, never hangs (Rule 9)', async () => {
  const fetchFn = () => new Promise(() => {}); // never settles
  const result = await runCanary('companies_house', { fetchFn, deadlineMs: 20, keys: { companiesHouse: 'k' } });
  assert.equal(result.ok, false);
  assert.match(result.message, /timeout/);
});

test('runCanary: cqc structural canary passes on a well-formed providers page', async () => {
  const fetchFn = async () => ({ status: 200, json: { providers: [] } });
  const result = await runCanary('cqc', { fetchFn, deadlineMs: 500, keys: { cqc: { apiKey: 'k' } } });
  assert.equal(result.ok, true);
});

test('hasKeyFor: companies_house needs keys.companiesHouse; cqc needs keys.cqc.apiKey', () => {
  assert.equal(hasKeyFor('companies_house', { companiesHouse: 'x' }), true);
  assert.equal(hasKeyFor('companies_house', {}), false);
  assert.equal(hasKeyFor('cqc', { cqc: { apiKey: 'x' } }), true);
  assert.equal(hasKeyFor('cqc', { cqc: {} }), false);
  assert.equal(hasKeyFor('unknown_register', { unknown_register: 'x' }), false);
});
