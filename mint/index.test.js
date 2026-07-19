'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mint, icpGate, runFactsDoors, normaliseOpts } = require('./index.js');

// A fetchFn that reads nothing (an unreachable site): facts abstain, so the ICP gate must REFUSE.
const deadFetch = () => Promise.resolve({ ok: false, status: 0, body: '', finalUrl: null });
// browser + register fakes that run cleanly but contribute no facts.
const launchBrowser = async () => ({ async newPage() { return { on() {}, async goto() {}, async settle() {}, async cookies() { return []; }, async findConsentControl() { return { found: false }; }, async clickConsent() {}, async evaluate() { return []; } }; }, async close() {} });
const registersFetchFn = async () => null;

test('icpGate REFUSES when the sector is unresolved (silence is free; no fabrication - Aman\'s ICP directive)', () => {
  const abstained = icpGate({ sector: { value: null }, jurisdiction: { bound: [] } });
  assert.strictEqual(abstained.auditable, false);
  const served = icpGate({ sector: { value: { sector: 'law-firms', sub_sector: 'solicitors' } }, jurisdiction: { bound: [{ jurisdiction: 'UK' }] } });
  assert.strictEqual(served.auditable, true);
  const unservedJurisdiction = icpGate({ sector: { value: { sector: 'law-firms' } }, jurisdiction: { bound: [{ jurisdiction: 'AE' }] } });
  assert.strictEqual(unservedJurisdiction.auditable, false);
});

test('mint() REFUSES an unreachable/unserved site with a stated reason, no payload, no row, no persistence', async () => {
  const persisted = [];
  const res = await mint('nowhere.example', {
    fetchFn: deadFetch, launchBrowser, registersFetchFn, llmCall: async () => ({ ok: false }), providers: [],
    sqlFn: async () => { persisted.push('sql'); return { ok: true, rows: [] }; },
    putFn: async () => { persisted.push('r2'); return { ok: true }; },
    now: () => 1, generatedAt: '2026-07-19', env: {},
  });
  assert.strictEqual(res.status, 'refused');
  assert.ok(res.refusal && res.refusal.length > 0, 'the refusal names why');
  assert.strictEqual(res.payload, null);
  assert.strictEqual(res.row, null);
  assert.deepStrictEqual(persisted, [], 'a refused audit is NEVER persisted (no phantom row)');
  assert.ok(Array.isArray(res.stageManifest), 'the manifest still shows what ran');
});

test('runFactsDoors returns the four fact envelopes; capabilities abstains (null) on an empty corpus', () => {
  const facts = runFactsDoors({ domain: 'x.example', corpus: { pages: [] }, registers: { notes: [] } });
  assert.ok('identity' in facts && 'jurisdiction' in facts && 'sector' in facts && 'capabilities' in facts);
  assert.strictEqual(facts.capabilities, null, 'no readable corpus -> capabilities abstains rather than derive from nothing');
});

test('normaliseOpts derives generatedAt from the INJECTED clock (no bare Date.now reaches compose)', () => {
  const cfg = normaliseOpts({ now: () => 0 });
  assert.strictEqual(cfg.generatedAt, new Date(0).toISOString());
  assert.strictEqual(normaliseOpts({ generatedAt: '2026-01-01' }).generatedAt, '2026-01-01');
});
