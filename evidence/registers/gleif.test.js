'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupGleif } = require('./gleif');

const MATCH_RESPONSE = {
  status: 200,
  json: {
    data: [{
      id: '213800WSGIIZCXF1P572',
      type: 'lei-records',
      attributes: {
        entity: {
          legalName: { name: 'TAMAZIA GROUP LIMITED' },
          status: 'ACTIVE',
          legalAddress: { addressLines: ['1 Example Street'], city: 'London', country: 'GB', postalCode: 'EC1 1AA' },
        },
      },
    }],
  },
};

test('lookupGleif: works without any key (public, keyless register)', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupGleif({ query: 'Tamazia Group Limited', fetchFn, deadlineMs: 500, keys: {} });
  assert.ok(r.row);
  assert.equal(r.row.source, 'gleif');
  assert.equal(r.row.lei, '213800WSGIIZCXF1P572');
  assert.equal(r.row.entity_status, 'ACTIVE');
  assert.equal(r.row.registered_office_address, '1 Example Street, London, EC1 1AA, GB');
});

test('lookupGleif: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupGleif({ query: 'Northgate Wealth Management', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});

test('lookupGleif: an empty data array is a no_candidates_returned note', async () => {
  const fetchFn = async () => ({ status: 200, json: { data: [] } });
  const r = await lookupGleif({ query: 'Tamazia Group Limited', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'no_candidates_returned');
});

test('lookupGleif: a non-200 status degrades with unexpected_response', async () => {
  const fetchFn = async () => ({ status: 503, json: null });
  const r = await lookupGleif({ query: 'Tamazia Group Limited', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'unexpected_response');
});
