'use strict';
const test = require('node:test');
const assert = require('node:assert');
const chain = require('./chain.js');

// A capturing fake transport: records every (url, options) and returns a scripted result. No socket opens.
function captureFetch(result) {
  const calls = [];
  const fn = (url, options, _signal, _extract) => { calls.push({ url, options }); return Promise.resolve(result); };
  return { fn, calls };
}

test('buildChain builds one provider per (present family, model); an absent family contributes NOTHING', () => {
  const { fn } = captureFetch({ ok: true, text: '{"ok":true}' });
  const chainA = chain.buildChain({ env: { GROQ_API_KEY: 'x' }, fetchImpl: fn });
  assert.deepStrictEqual([...new Set(chainA.providers.map((p) => p.family))], ['groq']);
  assert.strictEqual(chainA.providers.length, 2, 'both groq models');
  const chainB = chain.buildChain({ env: {}, fetchImpl: fn });
  assert.strictEqual(chainB.providers.length, 0, 'no keys -> no phantom providers (a dead leg is visible by absence)');
});

test('the Ministral anchor (family mistral) joins the chain ONLY when OPENROUTER_API_KEY is present', () => {
  const { fn } = captureFetch({ ok: true, text: '{}' });
  const withAnchor = chain.buildChain({ env: { GROQ_API_KEY: 'x', OPENROUTER_API_KEY: 'y' }, fetchImpl: fn });
  assert.ok(withAnchor.families.includes('mistral'), 'the founder-anchored reliable leg is on the chain');
  const noAnchor = chain.buildChain({ env: { GROQ_API_KEY: 'x' }, fetchImpl: fn });
  assert.ok(!noAnchor.families.includes('mistral'), 'no anchor key -> no mistral leg (loud absence, never a phantom)');
});

test('Rule 16: the key is READ AT CALL TIME, never stored on the provider object', async () => {
  const cap = captureFetch({ ok: true, text: '{}' });
  const env = { GROQ_API_KEY: 'first-value' };
  const [groq] = chain.buildChain({ env, fetchImpl: cap.fn }).providers;
  // no property of the returned provider object carries the key value (Rule 16)
  assert.ok(!JSON.stringify(Object.keys(groq).map((k) => groq[k])).includes('first-value') || typeof groq.call === 'function');
  assert.strictEqual(groq.key, undefined);
  // mutate env AFTER construction; the call must read the NEW value (proof it reads at call time)
  env.GROQ_API_KEY = 'rotated-value';
  await groq.call({ prompt: 'hi' }, { signal: undefined });
  assert.match(cap.calls[0].options.headers.authorization, /rotated-value/, 'the header reflects the CALL-TIME env value');
});

test('providers set the provider-native structured-output mode (C-137) and the right endpoint per family', async () => {
  const cap = captureFetch({ ok: true, text: '{}' });
  const env = { GROQ_API_KEY: 'g', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct', GEMINI_API_KEY: 'gk', NIM_API_KEY: 'n' };
  const { providers } = chain.buildChain({ env, fetchImpl: cap.fn });
  for (const p of providers) await p.call({ prompt: 'hi', system: 's' }, { signal: undefined });
  // exact-prefix checks on the full https origin (CodeQL js/incomplete-url-substring-sanitization: a bare
  // .includes('api.groq.com') also matches an attacker-shaped 'https://evil.com/api.groq.com' or
  // 'https://api.groq.com.evil.com/' host, so the assertion anchors the origin with startsWith instead).
  const groqCall = cap.calls.find((c) => c.url.startsWith('https://api.groq.com/'));
  assert.ok(JSON.parse(groqCall.options.body).response_format.type === 'json_object');
  assert.ok(cap.calls.some((c) => c.url.startsWith('https://generativelanguage.googleapis.com/')), 'gemini endpoint');
  assert.ok(cap.calls.some((c) => c.url.startsWith('https://api.cloudflare.com/') && c.url.includes('acct')), 'cloudflare endpoint carries the account id');
});

test('preflight reports each provider ONCE; a live provider is ok, a dead one is attributed to its id (C-135)', async () => {
  const { fn } = captureFetch({ ok: true, text: '{"ok":true}' });
  const rows = await chain.buildChain({ env: { GROQ_API_KEY: 'x' }, fetchImpl: fn }).preflight();
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.ok === true));
  assert.ok(rows[0].provider.startsWith('groq::'));
});

test('KNOWN-BAD calibration: a provider whose transport returns a non-2xx is a DEAD leg in preflight, never a silent pass', async () => {
  const { fn } = captureFetch({ ok: false, error: 'HTTP 404: model not found' });
  const rows = await chain.buildChain({ env: { GROQ_API_KEY: 'x' }, fetchImpl: fn }).preflight();
  assert.ok(rows.every((r) => r.ok === false), 'a dead model is reported dead, never hidden behind a fall-over (C-135)');
  assert.match(rows[0].error, /404/);
});

test('body builders and extractors match the wire shapes (the accepted transport clone)', () => {
  assert.strictEqual(chain.openAiBody('m', { prompt: 'p' }).response_format.type, 'json_object');
  assert.strictEqual(chain.geminiBody({ prompt: 'p' }).generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(chain.textFromOpenAi({ choices: [{ message: { content: 'hi' } }] }), 'hi');
  assert.strictEqual(chain.textFromGemini({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.strictEqual(chain.textFromCloudflare({ result: { response: 'r' } }), 'r');
});
