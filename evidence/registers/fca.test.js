'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupFca, applies } = require('./fca');

const MATCH_RESPONSE = {
  status: 200,
  json: { Data: [{ 'Reference Number': '123456', 'Organisation Name': 'NORTHGATE WEALTH MANAGEMENT LLP', Status: 'Authorised' }] },
};

test('applies(): the finance family is in scope; an unrelated sector is not; unspecified tries', () => {
  assert.equal(applies('finance'), true);
  assert.equal(applies('fintech'), true);
  assert.equal(applies('insurance'), true);
  assert.equal(applies('hospitality'), false);
  assert.equal(applies(undefined), true);
});

test('lookupFca: sector gate skips a non-finance sector before any key/fetch check', async () => {
  const r = await lookupFca({ query: 'Northgate Wealth Management LLP', sector: 'hospitality', fetchFn: async () => MATCH_RESPONSE, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'skipped');
});

test('lookupFca: missing key (founder-blocked in this estate) degrades loudly, no fetch attempted', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return MATCH_RESPONSE; };
  const r = await lookupFca({ query: 'Northgate Wealth Management LLP', sector: 'finance', fetchFn, deadlineMs: 500, keys: {} });
  assert.equal(r.row, null);
  assert.equal(called, false);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'missing_key');
  assert.match(r.note.detail, /founder-blocked/);
});

test('lookupFca: with both key parts configured, a genuine match returns a row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupFca({
    query: 'Northgate Wealth Management LLP', sector: 'finance', fetchFn, deadlineMs: 500,
    keys: { fca: { email: 'test@example.invalid', key: 'test-key' } },
  });
  assert.ok(r.row);
  assert.equal(r.row.source, 'fca');
  assert.equal(r.row.frn, '123456');
  assert.equal(r.row.status, 'Authorised');
});

test('lookupFca: C-004 -- a non-empty response with no real name match returns no row', async () => {
  const fetchFn = async () => MATCH_RESPONSE;
  const r = await lookupFca({
    query: 'Silverline Insurance Brokers', sector: 'finance', fetchFn, deadlineMs: 500,
    keys: { fca: { email: 'test@example.invalid', key: 'test-key' } },
  });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'below_threshold');
});
