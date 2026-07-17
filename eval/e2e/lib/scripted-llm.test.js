'use strict';
// eval/e2e/lib/scripted-llm.test.js
//   node --test eval/e2e/lib/scripted-llm.test.js

const test = require('node:test');
const assert = require('node:assert');

const { defaultScriptedLlmCall, scriptedLlmCall } = require('./scripted-llm');

test('defaultScriptedLlmCall: always abstains (insufficient), never asserts a verdict', async () => {
  const r1 = await defaultScriptedLlmCall({ any: 'request' });
  const r2 = await defaultScriptedLlmCall(undefined);
  assert.strictEqual(r1.verdict, 'insufficient');
  assert.strictEqual(r2.verdict, 'insufficient');
  assert.ok(typeof r1.reason === 'string' && r1.reason.length > 0);
});

test('scriptedLlmCall: an array is consumed strictly in call order', async () => {
  const call = scriptedLlmCall([{ verdict: 'breach' }, { verdict: 'pass', disproof: 'x' }]);
  const first = await call({ i: 1 });
  const second = await call({ i: 2 });
  assert.strictEqual(first.verdict, 'breach');
  assert.strictEqual(second.verdict, 'pass');
});

test('scriptedLlmCall: an exhausted array queue abstains honestly rather than repeating a stale entry', async () => {
  const call = scriptedLlmCall([{ verdict: 'breach' }]);
  await call({});
  const exhausted = await call({});
  assert.strictEqual(exhausted.verdict, 'insufficient');
});

test('scriptedLlmCall: a function script is called per-request for full control', async () => {
  const call = scriptedLlmCall((request) => ({ verdict: request.wantBreach ? 'breach' : 'no_breach' }));
  const a = await call({ wantBreach: true });
  const b = await call({ wantBreach: false });
  assert.strictEqual(a.verdict, 'breach');
  assert.strictEqual(b.verdict, 'no_breach');
});

test('scriptedLlmCall: a bare object script answers every call identically', async () => {
  const call = scriptedLlmCall({ verdict: 'insufficient', reason: 'fixed' });
  const a = await call({});
  const b = await call({});
  assert.strictEqual(a.reason, 'fixed');
  assert.strictEqual(b.reason, 'fixed');
});
