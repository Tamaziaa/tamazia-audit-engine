'use strict';
// facts/entity/lensClient.test.js — NETWORK-FREE (fetchImpl is a fake; no real socket opens).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLensClient, parseJson, stripFences } = require('./lensClient.js');

const GOOD_PROPOSAL = {
  candidates: [{ legal_name: 'Acme Dental Ltd', company_number: '12345678', source_quote: 'Acme Dental Ltd, Company No. 12345678' }],
  privacy_controller: null,
  sector_evidence: ['GDC number 123456'],
  sector: 'healthcare',
  sub_sector: 'dental',
};

function fakeFetchReturning(text) {
  return async (_url, _options, _signal, extract) => ({ ok: true, text: extract ? text : text });
}

test('parseJson strips markdown fences defensively', () => {
  const t = '```json\n{"a":1}\n```';
  assert.deepEqual(parseJson(t), { a: 1 });
  assert.equal(stripFences('  {"a":1}  '), '{"a":1}');
});

test('extractEntity returns ok:false with no_windows on empty input', async () => {
  const client = makeLensClient({ env: {} });
  const r = await client.extractEntity('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_windows');
});

test('extractEntity returns ok:false with no_providers when no keys are configured (fail closed)', async () => {
  const client = makeLensClient({ env: {} });
  const r = await client.extractEntity('Acme Dental Ltd, Company No. 12345678');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_providers');
});

test('extractEntity via Gemini (env.GEMINI_API_KEY) returns a parsed proposal + hashes', async () => {
  const fetchImpl = async (url, options, signal, extract) => {
    const json = { candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD_PROPOSAL) }] } }] };
    return { ok: true, text: extract(json) };
  };
  const client = makeLensClient({ env: { GEMINI_API_KEY: 'fake-gemini-key' }, fetchImpl });
  const r = await client.extractEntity('Acme Dental Ltd, Company No. 12345678');
  assert.equal(r.ok, true);
  assert.equal(r.family, 'gemini');
  assert.deepEqual(r.proposal, GOOD_PROPOSAL);
  assert.equal(typeof r.promptHash, 'string');
  assert.equal(r.promptHash.length, 64);
  assert.equal(typeof r.transcriptHash, 'string');
  assert.equal(r.callsUsed, 1);
});

test('extractEntity falls back to Ministral/OpenRouter when Gemini is not configured', async () => {
  const fetchImpl = async (url, options, signal, extract) => {
    const json = { choices: [{ message: { content: JSON.stringify(GOOD_PROPOSAL) } }] };
    return { ok: true, text: extract(json) };
  };
  const client = makeLensClient({ env: { OPENROUTER_API_KEY: 'fake-openrouter-key' }, fetchImpl });
  const r = await client.extractEntity('Acme Dental Ltd, Company No. 12345678');
  assert.equal(r.ok, true);
  assert.equal(r.family, 'mistral');
  assert.deepEqual(r.proposal, GOOD_PROPOSAL);
});

test('the 2-call/run budget is enforced (third call in a fresh client after 2 exhausts)', async () => {
  const fetchImpl = async (url, options, signal, extract) => ({ ok: true, text: extract({ candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD_PROPOSAL) }] } }] }) });
  const client = makeLensClient({ env: { GEMINI_API_KEY: 'k' }, fetchImpl });
  await client.extractEntity('a Ltd company no 12345678');
  await client.extractEntity('a Ltd company no 12345678');
  const third = await client.extractEntity('a Ltd company no 12345678');
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'call_budget_exhausted');
});

test('unparseable completion text fails closed, never throws', async () => {
  const fetchImpl = async (url, options, signal, extract) => ({ ok: true, text: extract({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }) });
  const client = makeLensClient({ env: { GEMINI_API_KEY: 'k' }, fetchImpl });
  const r = await client.extractEntity('Acme Dental Ltd, Company No. 12345678');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unparseable_json');
});
