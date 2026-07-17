'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupIco, isExpired } = require('./ico');

test('isExpired: a past date is expired, a future date is not, a missing date is not', () => {
  assert.equal(isExpired('2000-01-01'), true);
  assert.equal(isExpired('2999-01-01'), false);
  assert.equal(isExpired(null), false);
  assert.equal(isExpired(undefined), false);
});

test('lookupIco: no configured mirror endpoint (the estate-wide default today) degrades loudly, no fetch attempted', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { status: 200, json: { rows: [] } }; };
  const r = await lookupIco({ query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'missing_endpoint');
});

test('lookupIco: with a configured mirror, a genuine current registration returns a "registered" row', async () => {
  const fetchFn = async () => ({
    status: 200,
    json: { rows: [{ organisation_name: 'KINGSLEY NAPLEY LLP', registration_number: 'Z1234567', end_date: '2999-01-01' }] },
  });
  const r = await lookupIco({ query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { ico: 'https://ico-mirror.internal/lookup' } });
  assert.ok(r.row);
  assert.equal(r.row.source, 'ico');
  assert.equal(r.row.registration_number, 'Z1234567');
  assert.equal(r.row.status, 'registered');
});

test('lookupIco: a lapsed registration returns an "expired" row, still name-matched', async () => {
  const fetchFn = async () => ({
    status: 200,
    json: { rows: [{ organisation_name: 'KINGSLEY NAPLEY LLP', registration_number: 'Z1234567', end_date: '2000-01-01' }] },
  });
  const r = await lookupIco({ query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { ico: 'https://ico-mirror.internal/lookup' } });
  assert.ok(r.row);
  assert.equal(r.row.status, 'expired');
});

test('lookupIco: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => ({
    status: 200,
    json: { rows: [{ organisation_name: 'Kingsley Carpets Ltd', registration_number: 'Z9999999', end_date: '2999-01-01' }] },
  });
  const r = await lookupIco({ query: 'Kingsley Napley LLP', fetchFn, deadlineMs: 500, keys: { ico: 'https://ico-mirror.internal/lookup' } });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});
