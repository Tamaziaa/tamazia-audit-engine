'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupCqc, applies } = require('./cqc');

const MATCH_RESPONSE = {
  status: 200,
  json: { providers: [{ providerId: '1-1000000123', name: 'AURORA AESTHETICS CLINIC', postalAddressLine1: '1 Harley Street', postalAddressTownCity: 'London', postalPostCode: 'W1G 6BA' }] },
};

const PARTNER_CODE_REJECTED_RESPONSE = { status: 400, json: { statusCode: 400, message: 'Unspecified query parameter partnerCode is not allowed.' } };
const NAME_PARAM_REJECTED_RESPONSE = { status: 400, json: { statusCode: 400, message: 'Unspecified query parameter name is not allowed.' } };

// scriptedFetch(responses) -> {fetchFn, calls}. `responses` is an array; call N of fetchFn answers
// responses[N-1] (or the last entry if fetchFn is called more times than scripted). `calls` records
// {url, requestKey} for every invocation so a test can assert both the request shape AND the call
// count (C-175: this module must never call fetchFn a third time for one lookup).
function scriptedFetch(responses) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, requestKey: options && options.requestKey, headers: options && options.headers });
    const idx = Math.min(calls.length - 1, responses.length - 1);
    return responses[idx];
  };
  return { fetchFn, calls };
}

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

test('lookupCqc: apiKey alone (no partnerCode) is now sufficient config -- partnerCode is optional', async () => {
  const { fetchFn, calls } = scriptedFetch([MATCH_RESPONSE]);
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'only-half-configured' } },
  });
  assert.equal(calls.length, 1, 'exactly one call: no partnerCode configured means nothing to fall back from');
  assert.ok(r.row, 'a genuine match still returns a row with apiKey alone');
  assert.notEqual(r.note && r.note.reason, 'missing_key');
});

test('lookupCqc: the request moves to the live api.service.cqc.org.uk host and carries the subscription-key header', async () => {
  const { fetchFn, calls } = scriptedFetch([MATCH_RESPONSE]);
  await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'tamazia' } },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.service\.cqc\.org\.uk\/public\/v1\/providers\?/);
  assert.equal(calls[0].headers['Ocp-Apim-Subscription-Key'], 'test-key');
});

test('lookupCqc: partnerCode is included on the primary request when configured, and requestKey reflects it', async () => {
  const { fetchFn, calls } = scriptedFetch([MATCH_RESPONSE]);
  await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'tamazia' } },
  });
  assert.match(calls[0].url, /[?&]partnerCode=tamazia(&|$)/);
  assert.equal(calls[0].requestKey, 'cqc.providers');
});

test('lookupCqc: partnerCode is NEVER sent as an empty parameter when not configured (never guessed, never padded)', async () => {
  const { fetchFn, calls } = scriptedFetch([MATCH_RESPONSE]);
  await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key' } },
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /partnerCode/);
  assert.equal(calls[0].requestKey, 'cqc.providers.no_partner_code');
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

test('lookupCqc: a rejected partnerCode (HTTP 400) triggers exactly ONE bounded fallback without it (C-175); a matching fallback still returns the row alongside a loud partner_code_rejected note', async () => {
  const { fetchFn, calls } = scriptedFetch([PARTNER_CODE_REJECTED_RESPONSE, MATCH_RESPONSE]);
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'a-code-this-estate-was-never-issued' } },
  });
  assert.equal(calls.length, 2, 'primary call WITH partnerCode, then exactly one fallback WITHOUT it');
  assert.match(calls[0].url, /partnerCode=/);
  assert.doesNotMatch(calls[1].url, /partnerCode/);
  assert.ok(r.row, 'the fallback found a genuine match, so a row is still returned');
  assert.equal(r.row.provider_id, '1-1000000123');
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'partner_code_rejected');
  assert.match(r.note.detail, /partnerCode/);
  assert.match(r.note.detail, /C-175|bounded|no further/);
});

test('lookupCqc: a rejected partnerCode whose fallback ALSO fails still stops at exactly 2 calls (never a third), and the note surfaces the register\'s own rejection message via the second call', async () => {
  const { fetchFn, calls } = scriptedFetch([PARTNER_CODE_REJECTED_RESPONSE, NAME_PARAM_REJECTED_RESPONSE]);
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key', partnerCode: 'a-code-this-estate-was-never-issued' } },
  });
  assert.equal(calls.length, 2, 'never a third attempt, whatever the fallback answers');
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'partner_code_rejected');
  assert.match(r.note.detail, /Unspecified query parameter name is not allowed/, 'the fallback\'s own diagnostic message is surfaced, not just a bare status code');
});

test('lookupCqc: with NO partnerCode configured, an HTTP 400 is NOT retried (there is no alternate shape to fall back from)', async () => {
  const { fetchFn, calls } = scriptedFetch([NAME_PARAM_REJECTED_RESPONSE, MATCH_RESPONSE]);
  const r = await lookupCqc({
    query: 'Aurora Aesthetics Clinic', sector: 'healthcare', fetchFn, deadlineMs: 500,
    keys: { cqc: { apiKey: 'test-key' } },
  });
  assert.equal(calls.length, 1, 'a single call; no partnerCode was ever in play so there is nothing to retry without');
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'unexpected_response');
  assert.notEqual(r.note.reason, 'partner_code_rejected');
  assert.match(r.note.detail, /Unspecified query parameter name is not allowed/);
});
