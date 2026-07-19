'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { geoProbeShareOfVoice, normName } = require('./geo-probe.js');

const originalFetch = global.fetch;
function withGeminiFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}
function noGroundingFetch() { return Promise.resolve({ ok: false, status: 429, headers: { forEach() {} }, text: async () => '' }); }

test('geoProbeShareOfVoice abstains with reason no_query when no query is supplied', async () => {
  const r = await geoProbeShareOfVoice({ company: 'Acme Ltd', domain: 'acme.co.uk', env: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_query');
});

test('geoProbeShareOfVoice abstains with reason no_providers when no free-LLM key is configured', async () => {
  const r = await geoProbeShareOfVoice({ query: 'best dentist london', company: 'Acme Ltd', domain: 'acme.co.uk', env: {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_providers');
});

// fakeFetchImpl(text) -> a chain.js-shaped transport (url, options, signal, extract) that always answers
// the given JSON `text`, wired via buildChain's own injected-transport seam (no router-module monkeypatch).
function fakeFetchImpl(text) {
  return async (_url, _options, _signal, extract) => {
    const wire = JSON.stringify({ choices: [{ message: { content: text } }] });
    return { ok: true, text: extract(JSON.parse(wire)) };
  };
}

test('KNOWN-BAD calibration: malformed JSON from every provider yields all_providers_unavailable, never a crash or an invented name', async () => {
  await withGeminiFetch(noGroundingFetch, async () => {
    const r = await geoProbeShareOfVoice({
      query: 'best dentist london', company: 'Acme Dental', domain: 'acme.co.uk', samples: 2,
      env: { GROQ_API_KEY: 'k' }, fetchImpl: fakeFetchImpl('not json at all'),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'all_providers_unavailable');
  });
});

test('geoProbeShareOfVoice computes a real share-of-voice + names competitors from a live-shaped structured response', async () => {
  await withGeminiFetch(noGroundingFetch, async () => {
    const r = await geoProbeShareOfVoice({
      query: 'best dentist london', company: 'Acme Dental', domain: 'acme.co.uk', samples: 2,
      env: { GROQ_API_KEY: 'k' }, fetchImpl: fakeFetchImpl(JSON.stringify({ names: ['Acme Dental', 'Rival Dental'] })),
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.samples, 2);
    assert.strictEqual(r.firm_appears, 2, 'the firm was named in both samples');
    assert.strictEqual(r.share_of_voice, 100);
    assert.strictEqual(r.top_competitors[0].name, 'Rival Dental');
  });
});

test('geoProbeShareOfVoice reports 0 share of voice when the firm is never named but competitors are', async () => {
  await withGeminiFetch(noGroundingFetch, async () => {
    const r = await geoProbeShareOfVoice({
      query: 'best dentist london', company: 'Acme Dental', domain: 'acme.co.uk', samples: 1,
      env: { GROQ_API_KEY: 'k' }, fetchImpl: fakeFetchImpl(JSON.stringify({ names: ['Rival Dental', 'Other Dental'] })),
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.firm_appears, 0);
    assert.strictEqual(r.share_of_voice, 0);
  });
});

test('normName strips legal suffixes so "Acme Ltd" and "Acme" are recognised as the same firm', () => {
  assert.strictEqual(normName('Acme Dental Ltd'), normName('Acme Dental'));
});
