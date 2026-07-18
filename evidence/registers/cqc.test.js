'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupCqc, applies } = require('./cqc');

const MATCH_RESPONSE = {
  status: 200,
  json: { providers: [{ providerId: '1-1000000123', name: 'AURORA AESTHETICS CLINIC', postalAddressLine1: '1 Harley Street', postalAddressTownCity: 'London', postalPostCode: 'W1G 6BA' }] },
};

test('applies(): the health family is in scope; an unrelated sector is not; unspecified tries', () => {
  assert.equal(applies('healthcare'), true);
  assert.equal(applies('dental'), true);
  assert.equal(applies('aesthetics'), true);
  assert.equal(applies('hospitality'), false);
  assert.equal(applies(undefined), true);
});

test('lookupCqc: sector gate skips a non-health sector before any key/fetch check', async () => {
  const r = await lookupCqc({ query: 'Aurora Aesthetics Clinic', sector: 'hospitality', fetchFn: async () => MATCH_RESPONSE, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'skipped');
});

test('lookupCqc: missing key (founder-blocked in this estate) degrades loudly, no fetch attempted', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupCqc({ query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'missing_key');
  assert.match(r.note.detail, /founder-blocked/);
});

test('lookupCqc: partial key config (apiKey without partnerCode) still counts as missing', async () => {
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare',
    fetchFn: async () => MATCH_RESPONSE, deadlineMs: 500,
    keys: { cqc: { apiKey: 'only-half-configured' } },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'missing_key');
});

test('lookupCqc: with both keys configured, a genuine match returns a row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'tamazia' } },
  });
  assert.ok(r.row);
  assert.equal(r.row.source, 'cqc');
  assert.equal(r.row.provider_id, '1-1000000123');
  assert.equal(r.row.registered_office_address, '1 Harley Street, London, W1G 6BA');
});

test('lookupCqc: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupCqc({
    query: 'Radiant Skin Body Studio', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'tamazia' } },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});
