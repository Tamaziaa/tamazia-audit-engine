'use strict';
// eval/e2e/lib/real-llm-transport.test.js - network-free tests for the provider transport layer
// extracted from real-llm.js (P3-tail Wave-2 U1 resume, C-254). Every test injects a FAKE fetch or reads
// a pure body/extractor; NO real network call is ever made.
//   node --test eval/e2e/lib/real-llm-transport.test.js

const test = require('node:test');
const assert = require('node:assert');

const T = require('./real-llm-transport.js');

test('envKeysPresent detects families from env keys (names only, never values asserted)', () => {
  assert.deepStrictEqual(T.envKeysPresent({ GROQ_API_KEY: 'x' }), ['groq']);
  assert.deepStrictEqual(T.envKeysPresent({ CLOUDFLARE_API_TOKEN: 'x' }), [], 'cloudflare needs a token AND an account id');
  assert.deepStrictEqual(T.envKeysPresent({ CLOUDFLARE_API_TOKEN: 'x', CF_ACCOUNT_ID: 'y' }), ['cloudflare']);
  assert.ok(T.envKeysPresent({ GEMINI_API_KEY: 'x', NIM_API_KEY: 'y' }).sort().join(',') === 'gemini,nim');
});

test('buildProvidersFromEnv builds one provider per present-key model, using the injected fetch', async () => {
  const seen = [];
  const fakeFetch = (url, options, _signal, _extract) => { seen.push({ url, hasAuth: /^Bearer /.test(options.headers.authorization || '') }); return Promise.resolve({ ok: true, text: '{}' }); };
  const providers = T.buildProvidersFromEnv({ GROQ_API_KEY: 'FAKEGROQKEY' }, { fetchImpl: fakeFetch });
  assert.ok(providers.length >= 1 && providers.every((p) => p.family === 'groq'));
  await providers[0].call({ system: 's', prompt: 'p' }, { signal: undefined });
  assert.match(seen[0].url, /api\.groq\.com/);
  assert.strictEqual(seen[0].hasAuth, true, 'the Authorization header is set (its value is never asserted or logged, Rule 16)');
});

test('cloudflare provider requires BOTH token and account id', () => {
  assert.strictEqual(T.buildProvidersFromEnv({ CLOUDFLARE_API_TOKEN: 'x' }, {}).length, 0);
  assert.ok(T.buildProvidersFromEnv({ CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'y' }, {}).length >= 1);
});

test('structured-output mode is set per provider (C-137)', () => {
  assert.deepStrictEqual(T.openAiBody('m', { prompt: 'p' }).response_format, { type: 'json_object' });
  assert.strictEqual(T.geminiBody({ prompt: 'p' }).generationConfig.responseMimeType, 'application/json');
  assert.deepStrictEqual(T.cloudflareBody({ prompt: 'p' }).response_format, { type: 'json_object' });
});

test('response extractors read each provider wire shape; a shapeless reply yields empty text', () => {
  assert.strictEqual(T.textFromOpenAi({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
  assert.strictEqual(T.textFromGemini({ candidates: [{ content: { parts: [{ text: '{"b":2}' }] } }] }), '{"b":2}');
  assert.strictEqual(T.textFromCloudflare({ result: { response: '{"c":3}' } }), '{"c":3}');
  assert.strictEqual(T.textFromOpenAi({}), '');
  assert.strictEqual(T.textFromGemini(null), '');
});

test('provider name helpers round-trip family::model and PROVIDER_MODELS carries no retired ids', () => {
  assert.strictEqual(T.modelOfName('cloudflare::@cf/meta/llama-3.1-8b-instruct'), '@cf/meta/llama-3.1-8b-instruct');
  assert.strictEqual(T.familyOfName('groq::llama-3.3-70b-versatile'), 'groq');
  const gemini = T.PROVIDER_MODELS.gemini || [];
  assert.ok(!gemini.includes('gemini-1.5-flash') && !gemini.includes('gemini-1.5-flash-8b'), 'retired 404 model ids stay removed (C-135)');
});

test('buildPreflightRow reduces a router race result to a liveness row (timeout/error/ok)', () => {
  const p = { family: 'groq', model: 'm' };
  assert.strictEqual(T.buildPreflightRow(p, { timedOut: true }, 12000).error, 'timeout');
  assert.strictEqual(T.buildPreflightRow(p, { error: 'HTTP 401' }, 40).ok, false);
  assert.strictEqual(T.buildPreflightRow(p, { value: { ok: true, text: 'hi' } }, 200).ok, true);
});
