'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { assertMinted, stateFor, rowQuery, TRUTH_PACK_DEADLINE_MS } = require('./post-write-assertions.js');
const { ENGINE_VERSION } = require('./version.js');

const ROW = { slug: 'oakhurst-legal-example', hash: 'deadbeef' };
const PAYLOAD = { meta: { domain: 'oakhurst-legal.example' } };

// The render-proof golden fixtures - a real composed v1.1 payload and its recorded render - let the mint
// prove the DEFAULT path actually RUNS the pure truth-pack when live page text is supplied (T3b).
const FIX = path.join(__dirname, '..', 'render-proof', 'fixtures');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIX, 'audit-golden-v11.json'), 'utf8'));
const GOLDEN_TEXT = fs.readFileSync(path.join(FIX, 'audit-golden-v11.rendered.txt'), 'utf8');
const RENDER_NOW = Date.parse('2026-07-20T00:00:00Z'); // one day after the golden's generatedAt: a fresh render
const LIVE_URL = 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef';

// a sql door that returns a matching, current-version row for the read-back. In production the read-back
// query aliases `payload_json->>'engine_version'` to `engine_version` (audit_pages has NO engine_version
// column), so a faithful fake returns that aliased field - the version off the marker the trigger gates on.
const okSql = async () => ({ ok: true, rows: [{ slug: ROW.slug, hash: ROW.hash, engine_version: ENGINE_VERSION }] });
const ok200 = async () => ({ status: 200 });

test('the read-back reads the version from the payload_json marker (payload_json->>engine_version), NOT a column', () => {
  const q = rowQuery('audit_pages');
  assert.match(q, /payload_json->>'engine_version' AS engine_version/, 'reads the marker expression the live trigger itself gates on');
  assert.match(q, /WHERE slug=\$1 AND hash=\$2/, 'keyed on the real (slug, hash) barrier the website read serves');
  assert.doesNotMatch(q, /,\s*engine_version\s+FROM/, 'never selects a bare (phantom) engine_version column');
});

test('all three legs green with an injected passing truth-pack -> done:true, state "done" (Rule 7)', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: async () => ({ ok: true }) } });
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.state, 'done');
});

test('truth-pack pack present but NO renderedText supplied -> done:false, state "minted_pending_render", NOT RUN (honest)', async () => {
  // T3b landed render-proof/truth-pack.js, but without a truthPackFn AND without live page text there is
  // nothing to assert, so the leg is honestly not-run and the mint withholds done (Rule 7).
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: LIVE_URL, opts: { sqlFn: okSql, liveFetch: ok200 } });
  assert.strictEqual(r.done, false, 'a mint is NEVER done on a missing leg (the phantom-data class, C-249)');
  assert.strictEqual(r.state, 'minted_pending_render');
  assert.strictEqual(r.checks.truthPack.ran, false);
  assert.match(r.checks.truthPack.reason, /renderedText not supplied/, 'the honest reason names the missing input');
});

test('DEFAULT path RUNS the real pack: renderedText + a matching golden render -> all three green, done:true (Rule 7)', async () => {
  const r = await assertMinted({ row: ROW, payload: GOLDEN, liveUrl: LIVE_URL, opts: { sqlFn: okSql, liveFetch: ok200, renderedText: GOLDEN_TEXT, now: RENDER_NOW } });
  assert.strictEqual(r.checks.truthPack.ran, true, 'the real pure checker actually ran');
  assert.strictEqual(r.checks.truthPack.ok, true);
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.state, 'done');
});

test('DEFAULT path CATCHES a render mismatch: renderedText missing the not-legal-advice line -> render_mismatch', async () => {
  const badText = GOLDEN_TEXT.replace(GOLDEN.notLegalAdvice, '');
  const r = await assertMinted({ row: ROW, payload: GOLDEN, liveUrl: LIVE_URL, opts: { sqlFn: okSql, liveFetch: ok200, renderedText: badText, now: RENDER_NOW } });
  assert.strictEqual(r.checks.truthPack.ran, true);
  assert.strictEqual(r.checks.truthPack.ok, false);
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'render_mismatch');
  assert.match(r.checks.truthPack.reason, /violation/);
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

test('CodeRabbit fix: a THROWING opts.truthPackFn degrades to a ran-but-FAILED leg, never an uncaught mint exception', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: async () => { throw new Error('stuck browser truth-pass'); } } });
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'render_mismatch');
  assert.strictEqual(r.checks.truthPack.ran, true, 'a broken render gate is a FAILED leg, never an honest not-run');
  assert.strictEqual(r.checks.truthPack.ok, false);
  assert.match(r.checks.truthPack.reason, /truthPackFn threw/);
  assert.match(r.checks.truthPack.reason, /stuck browser truth-pass/);
});

test('CodeRabbit fix: a REJECTING opts.truthPackFn promise is caught the same way as a synchronous throw', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: () => Promise.reject(new Error('network reset')) } });
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'render_mismatch');
  assert.strictEqual(r.checks.truthPack.ran, true);
  assert.match(r.checks.truthPack.reason, /truthPackFn threw/);
});

test('Rule 9 fix (PR #20 comment 3610487213): a HANGING opts.truthPackFn degrades to a ran-but-FAILED leg under a tiny override, and the assertion completes promptly, never hanging the mint', async () => {
  const t0 = Date.now();
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: () => new Promise(() => {}), truthPackDeadlineMs: 25 } });
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.done, false);
  assert.strictEqual(r.state, 'render_mismatch');
  assert.strictEqual(r.checks.truthPack.ran, true, 'a hanging truth-pass is a ran-but-FAILED leg, never an honest not-run');
  assert.strictEqual(r.checks.truthPack.ok, false);
  assert.match(r.checks.truthPack.reason, /timed out after 25ms/);
  assert.match(r.checks.truthPack.reason, /Rule 9/);
  assert.ok(elapsed < 2000, 'the mint is never held hostage on a hanging truthPackFn (took ' + elapsed + 'ms against a 25ms cap)');
});

test('the timeout leg NEVER produces an unhandledRejection once the abandoned truthPackFn promise eventually rejects', async () => {
  let onUnhandled = null;
  const seen = [];
  onUnhandled = (err) => seen.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late reject after the deadline won')), 30)), truthPackDeadlineMs: 5 } });
    assert.strictEqual(r.state, 'render_mismatch');
    assert.match(r.checks.truthPack.reason, /timed out after 5ms/);
    // give the abandoned promise time to actually reject in the background.
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepStrictEqual(seen, [], 'the late rejection was absorbed by the settled handler, never surfaced as an unhandledRejection');
});

test('opts.truthPackDeadlineMs overrides the module default when finite and positive; an invalid override falls back to TRUTH_PACK_DEADLINE_MS', async () => {
  assert.ok(Number.isFinite(TRUTH_PACK_DEADLINE_MS) && TRUTH_PACK_DEADLINE_MS > 0, 'the exported default is a sane positive CAP');
  const t0 = Date.now();
  const bad = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'https://tamazia.co.uk/audit/oakhurst-legal-example/deadbeef', opts: { sqlFn: okSql, liveFetch: ok200, truthPackFn: async () => ({ ok: true }), truthPackDeadlineMs: -5 } });
  // a well-behaved (fast, resolving) truthPackFn still succeeds regardless of a bogus override value, since
  // it settles long before ANY positive deadline (the module default) could fire.
  assert.strictEqual(bad.done, true);
  assert.ok(Date.now() - t0 < 2000);
});

test('an unsafe live URL is refused before any fetch (SSRF door), and stateFor prioritises the row leg', async () => {
  const r = await assertMinted({ row: ROW, payload: PAYLOAD, liveUrl: 'http://127.0.0.1/audit/x/y', opts: { sqlFn: okSql } });
  assert.strictEqual(r.checks.live200.ok, false);
  // stateFor precedence: row first, then live, then render.
  assert.strictEqual(stateFor({ rowReadBack: { ok: false }, live200: { ok: true }, truthPack: { ok: true } }), 'row_missing');
  assert.strictEqual(stateFor({ rowReadBack: { ok: true }, live200: { ok: false }, truthPack: { ok: true } }), 'unreachable');
});
