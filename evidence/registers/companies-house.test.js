'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupCompaniesHouse } = require('./companies-house');

const MATCH_RESPONSE = {
  status: 200,
  json: {
    items: [{ title: 'KINGSLEY NAPLEY LLP', company_number: '00930093', company_status: 'active' }],
    total_results: 1,
  },
};

const NONMATCH_RESPONSE = {
  status: 200,
  json: {
    items: [{ title: 'KINGSLEY CARPETS LTD', company_number: '01234567', company_status: 'active' }],
    total_results: 1,
  },
};

function fetchReturning(response) {
  return async () => response;
}

test('lookupCompaniesHouse: missing key degrades loudly, no fetch attempted, no row', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupCompaniesHouse({ query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.register, 'companies_house');
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'missing_key');
});

test('lookupCompaniesHouse: a genuine name match returns a row with full provenance', async () => {
  const fetchFn = fetchReturning(MATCH_RESPONSE);
  const r = await lookupCompaniesHouse({
    query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' },
  });
  assert.equal(r.note, null);
  assert.ok(r.row);
  assert.equal(r.row.source, 'companies_house');
  assert.equal(r.row.company_number, '00930093');
  assert.equal(r.row.company_name, 'KINGSLEY NAPLEY LLP');
  assert.equal(r.row.match.name_matched, 'KINGSLEY NAPLEY LLP');
  assert.ok(r.row.match.score >= 0.6);
  assert.ok(r.row.fetched_at);
  assert.equal(r.row.query, 'Kingsley Napley LLP');
});

test('lookupCompaniesHouse: C-004 -- a non-empty HTTP 200 response with no real name match returns no row', async () => {
  const fetchFn = fetchReturning(NONMATCH_RESPONSE);
  const r = await lookupCompaniesHouse({
    query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'no_match');
  assert.equal(r.note.reason, 'below_threshold');
});

test('lookupCompaniesHouse: zero candidates returned is a no_match note, never a row', async () => {
  const fetchFn = fetchReturning({ status: 200, json: { items: [] } });
  const r = await lookupCompaniesHouse({
    query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'no_candidates_returned');
});

test('lookupCompaniesHouse: a fetch that never resolves times out and degrades, never hangs', async () => {
  const fetchFn = () => new Promise(() => {});
  const r = await lookupCompaniesHouse({
    query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 30, keys: { companiesHouse: 'test-key' },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'timeout');
});

test('lookupCompaniesHouse: a thrown/rejected fetch degrades with fetch_error, never propagates', async () => {
  const fetchFn = async () => { throw new Error('ECONNRESET'); };
  const r = await lookupCompaniesHouse({
    query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'fetch_error');
});

test('lookupCompaniesHouse: a too-short query is refused before any fetch is attempted', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupCompaniesHouse({ query: 'BP', fetchFn, deadlineMs: 500, keys: { companiesHouse: 'k' } });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.reason, 'query_too_short');
});
