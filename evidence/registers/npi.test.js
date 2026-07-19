'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupNpi, applies, primaryTaxonomy } = require('./npi');

// Response shape confirmed against a LIVE call to npiregistry.cms.hhs.gov 2026-07-20 (see this
// module's header); the taxonomy codes below are real NUCC codes (207Q00000X Family Medicine,
// 2084P0800X Psychiatry) but the organisation is fictitious.
const MATCH_RESPONSE = {
  status: 200,
  json: {
    result_count: 1,
    results: [{
      number: '1999999999',
      enumeration_type: 'NPI-2',
      basic: { organization_name: 'EXAMPLE FAMILY HEALTH CLINIC', status: 'A' },
      taxonomies: [
        { code: '207Q00000X', desc: 'Family Medicine', primary: true, state: 'CA', license: 'A12345' },
        { code: '2084P0800X', desc: 'Psychiatry', primary: false, state: 'CA', license: null },
      ],
    }],
  },
};

test('lookupNpi: works without any key (public, keyless CMS register)', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupNpi({ query: 'Example Family Health Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500 });
  assert.ok(r.row);
  assert.equal(r.row.source, 'npi');
  assert.equal(r.row.id, '1999999999');
  assert.equal(r.row.taxonomy_code, '207Q00000X');
  assert.equal(r.row.taxonomy_desc, 'Family Medicine');
  assert.equal(r.row.taxonomies.length, 2);
});

test('lookupNpi: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupNpi({ query: 'Northgate Wealth Management', sector: 'healthcare', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});

test('lookupNpi: an empty results array is a no_candidates_returned note', async () => {
  const fetchFn = async () => ({ status: 200, json: { result_count: 0, results: [] } });
  const r = await lookupNpi({ query: 'Example Family Health Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'no_candidates_returned');
});

test('lookupNpi: a non-200 status degrades with unexpected_response', async () => {
  const fetchFn = async () => ({ status: 503, json: null });
  const r = await lookupNpi({ query: 'Example Family Health Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'unexpected_response');
});

test('lookupNpi: Rule 8 -- a non-healthcare, non-US-hinted sector is skipped without calling fetchFn', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupNpi({ query: 'Example Law Firm LLP', sector: 'law-firms', country: 'UK', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note, null);
  assert.equal(called, false);
});

test('lookupNpi: an unspecified sector still tries (register can corroborate a guess, C-014)', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupNpi({ query: 'Example Family Health Clinic', fetchFn, deadlineMs: 500 });
  assert.ok(r.row);
});

test('applies(): healthcare/dental/aesthetics or unspecified sector, US or unspecified country', () => {
  assert.equal(applies('healthcare', 'US'), true);
  assert.equal(applies('dental', undefined), true);
  assert.equal(applies(undefined, undefined), true);
  assert.equal(applies('law-firms', 'US'), false);
  assert.equal(applies('healthcare', 'UK'), false);
});

test('primaryTaxonomy(): prefers the primary:true entry, falls back to the first', () => {
  const taxes = [{ code: 'A', primary: false }, { code: 'B', primary: true }];
  assert.equal(primaryTaxonomy(taxes).code, 'B');
  assert.equal(primaryTaxonomy([{ code: 'C', primary: false }]).code, 'C');
  assert.equal(primaryTaxonomy([]), null);
  assert.equal(primaryTaxonomy(null), null);
});
