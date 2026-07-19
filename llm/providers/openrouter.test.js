'use strict';
// llm/providers/openrouter.test.js - node:test for the OpenRouter / Ministral-8b provider factory.
// Run: node --test llm/providers/openrouter.test.js
//
// NETWORK-FREE: the transport is an injected fake (fetchImpl); no real OpenRouter socket ever opens.
// Covers: C-135 loud absence (missing key -> null + a reason), the router-provider shape, C-137 JSON
// mode, the Bearer auth built from the key read at CALL time (Rule 16), one attempt only (C-138), Rule 16
// (no key on the returned object), and integration with llm/router.js route()'s hard deadline (Rule 9).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeOpenRouterProvider, openRouterAbsence, openRouterBody, textFromOpenAi,
  OPENROUTER_FAMILY, OPENROUTER_MODEL, OPENROUTER_ENDPOINT, OPENROUTER_KEY_ENV,
} = require('./openrouter.js');
const { route } = require('../router.js');

// A fake key value that carries no real provider-credential prefix, so the Rule 16 secret-shape grep
// stays clean over this test file while still exercising the Bearer-header path.
const FAKE_KEY = 'test-openrouter-key-value';

// recordingFetch(reply): a fake fetchImpl (url, options, signal, extract) that records its call and
// returns `reply` (default a valid OpenAI-shaped success). It NEVER opens a socket.
function recordingFetch(reply) {
  const calls = [];
  const impl = async (url, options, signal, extract) => {
    calls.push({ url, options, signal, extract });
    return reply || { ok: true, text: JSON.stringify({ verdict: 'entailment', source_id: 'src-1' }) };
  };
  return { impl, calls };
}

test('C-135: a MISSING key marks the provider ABSENT (null), and openRouterAbsence explains why', () => {
  const provider = makeOpenRouterProvider({ env: {} });
  assert.equal(provider, null, 'no key -> no phantom provider');
  const absence = openRouterAbsence({});
  assert.equal(absence.absent, true);
  assert.equal(absence.family, OPENROUTER_FAMILY);
  assert.match(absence.reason, new RegExp(OPENROUTER_KEY_ENV));
  assert.match(absence.reason, /ABSENT/);
});

test('with a key present, openRouterAbsence reports not-absent', () => {
  const absence = openRouterAbsence({ [OPENROUTER_KEY_ENV]: FAKE_KEY });
  assert.equal(absence.absent, false);
  assert.equal(absence.model, OPENROUTER_MODEL);
});

test('the built provider has the mistral family, the ministral-8b model, and a paid tier (C-133 distinct family)', () => {
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: recordingFetch().impl });
  assert.equal(provider.family, 'mistral', 'the C-133 independence key is distinct from groq/gemini/etc');
  assert.equal(provider.model, OPENROUTER_MODEL);
  assert.equal(provider.model, 'mistralai/ministral-8b');
  assert.equal(provider.tier, 'paid');
  assert.equal(provider.name, 'openrouter::mistralai/ministral-8b');
  assert.equal(typeof provider.call, 'function');
});

test('.call posts to the OpenRouter endpoint with a Bearer auth header and JSON structured-output mode (C-137)', async () => {
  const fetch = recordingFetch();
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: fetch.impl });
  await provider.call({ system: 'SYS', prompt: 'HELLO', max_tokens: 123 }, { signal: 'sig-1' });
  assert.equal(fetch.calls.length, 1, 'exactly one attempt, no retry storm (C-138)');
  const c = fetch.calls[0];
  assert.equal(c.url, OPENROUTER_ENDPOINT);
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(c.options.method, 'POST');
  assert.equal(c.options.headers.authorization, 'Bearer ' + FAKE_KEY);
  assert.equal(c.options.headers['content-type'], 'application/json');
  assert.equal(c.signal, 'sig-1', 'the router AbortSignal is passed to the transport (Rule 9)');
  const body = JSON.parse(c.options.body);
  assert.equal(body.model, 'mistralai/ministral-8b');
  assert.deepEqual(body.response_format, { type: 'json_object' }, 'C-137 structured-output mode is set');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 123);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'SYS');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content, 'HELLO');
});

test('Rule 16: the API key is read at CALL time (a rotation between construct and call is honoured)', async () => {
  const env = { [OPENROUTER_KEY_ENV]: 'first-key-value' };
  const fetch = recordingFetch();
  const provider = makeOpenRouterProvider({ env, fetchImpl: fetch.impl });
  env[OPENROUTER_KEY_ENV] = 'rotated-key-value'; // rotate AFTER construction
  await provider.call({ prompt: 'x' }, { signal: null });
  assert.equal(fetch.calls[0].options.headers.authorization, 'Bearer rotated-key-value', 'the key is read fresh at call time, not captured at construction');
});

test('Rule 16: the returned provider object carries NO key (only name/family/tier/model are enumerable)', () => {
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: recordingFetch().impl });
  const serialisable = JSON.stringify(provider); // functions are dropped by JSON.stringify
  assert.ok(!serialisable.includes(FAKE_KEY), 'the key must never appear on the provider object');
  assert.deepEqual(Object.keys(provider).sort(), ['call', 'family', 'model', 'name', 'tier']);
});

test('a default max_tokens is used when the request omits it, and clamped when it is over-large', async () => {
  const fetch = recordingFetch();
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: fetch.impl });
  await provider.call({ prompt: 'x' }, {});
  assert.equal(JSON.parse(fetch.calls[0].options.body).max_tokens, 900, 'default max_tokens');
  await provider.call({ prompt: 'x', max_tokens: 999999 }, {});
  assert.equal(JSON.parse(fetch.calls[1].options.body).max_tokens, 2048, 'over-large max_tokens is clamped to the cap (Rule 8)');
});

test('the provider drives cleanly through llm/router.js route() as a first-success provider', async () => {
  const fetch = recordingFetch({ ok: true, text: JSON.stringify({ verdict: 'entailment', source_id: 'src-1' }) });
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: fetch.impl });
  const r = await route({ prompt: 'p' }, { providers: [provider], deadlineMs: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.family, 'mistral');
  assert.match(r.text, /entailment/);
});

test('Rule 9: route() abandons a hanging OpenRouter transport at the hard deadline (no mint hostage)', async () => {
  const hangingFetch = async () => new Promise(() => {}); // never resolves
  const provider = makeOpenRouterProvider({ env: { [OPENROUTER_KEY_ENV]: FAKE_KEY }, fetchImpl: hangingFetch });
  const t0 = Date.now();
  const r = await route({ prompt: 'p' }, { providers: [provider], deadlineMs: 25 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts[0].outcome, 'timeout', 'the router hard-deadlines the injected transport (Rule 9)');
  assert.ok(Date.now() - t0 < 2000, 'the deadline fires; the call is not held hostage');
});

test('openRouterBody + textFromOpenAi are OpenAI-compatible (body has model+messages, extractor reads choices[0])', () => {
  const body = openRouterBody({ system: 's', prompt: 'p' });
  assert.equal(body.model, 'mistralai/ministral-8b');
  assert.equal(body.messages.length, 2);
  const text = textFromOpenAi({ choices: [{ message: { content: '{"ok":true}' } }] });
  assert.equal(text, '{"ok":true}');
  assert.equal(textFromOpenAi({}), '', 'a shapeless response yields empty text (falls over, never throws)');
});
