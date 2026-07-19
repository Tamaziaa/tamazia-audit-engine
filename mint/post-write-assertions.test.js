'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { assertMinted, stateFor } = require('./post-write-assertions.js');
const { ENGINE_VERSION } = require('./version.js');

const ROW = { slug: 'oakhurst-legal-example', hash: 'deadbeef' };
const PAYLOAD = { meta: { domain: 'oakhurst-legal.example' } };

// a sql door that returns a matching, current-version row for the read-back.
const okSql = async () => ({ ok: true, rows: [{ slug: ROW.slug, hash: ROW.hash, engine_version: ENGINE_VERSION }] });
const ok200 = async () => ({ status: 200 });

test('all three legs green with an injected passing truth-pack -> done:true, state "done" (Rule 7)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: async () => ({ ok: true }) } });
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.state, 'done');
});

test('truth-pack ABSENT (render-proof not landed) -> done:false, state "minted_pending_render" (the current reality)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200 } });
  assert.strictEqual(r.done, false, 'a mint is NEVER done on a missing leg (the phantom-data class, C-249)');
  assert.strictEqual(r.state, 'minted_pending_render');
  assert.strictEqual(r.checks.truthPack.ran, false);
  assert.match(r.checks.truthPack.reason, /render-proof not landed/);
});

test('KNOWN-BAD calibration: the row read-back returns NO row -> done:false, state "row_missing" (C-103)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: async () => ({ ok: true, rows: [] }), liveFetch: ok200 } });
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'row_missing');
});

test('KNOWN-BAD: a STALE engine_version row is rejected as row_missing (Rule 15/C-177), never accepted', async () => {
  const staleSql = async () => ({ ok: true, rows: [{ slug: ROW.slug, hash: ROW.hash, engine_version: 'engine-v1.old' }] });
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: staleSql, liveFetch: ok200 } });
  assert.strictEqual(r.state, 'row_missing');
  assert.match(r.checks.rowReadBack.reason, /stale-version/);
});

test('the live URL not answering 200 -> done:false, state "unreachable" (C-102)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: async () => ({ status: 503 }) } });
  assert.strictEqual(r.state, 'unreachable');
});

test('the truth-pack RAN but failed -> state "render_mismatch" (a rendered word did not match the payload)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: async () => ({ ok: false, reason: 'fine mismatch' }) } });
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'render_mismatch');
});

test('an unsafe live URL is refused before any fetch (SSRF door), and stateFor prioritises the row leg', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'http://127.0.0.1/audit/x/y', opts: { sqlFn: okSql } });
  assert.strictEqual(r.checks.live200.ok, false);
  // stateFor precedence: row first, then live, then render.
  assert.strictEqual(stateFor({ rowReadBack: { ok: false }, live200: { ok: true }, truthPack: { ok: true } }), 'row_missing');
  assert.strictEqual(stateFor({ rowReadBack: { ok: true }, live200: { ok: false }, truthPack: { ok: true } }), 'unreachable');
});
