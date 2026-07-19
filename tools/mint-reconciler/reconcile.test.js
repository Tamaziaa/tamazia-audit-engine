'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reconcile, parsePayloadJson, hasPageReference, exitCodeFor } = require('./reconcile.js');
const { ENGINE_VERSION } = require('../../mint/version.js');

const TABLE = 'audit_pages';

// cleanRow(overrides) -> a row shaped exactly like mint/persist.js's buildRow output, matching the real
// column set (url, slug, hash, engine_version, payload_json). Fully "done" by default.
function cleanRow(overrides) {
  return Object.assign({
    url: 'oakhurst-legal.example', slug: 'oakhurst-legal-example', hash: 'deadbeef',
    engine_version: ENGINE_VERSION, payload_json: { r2: true },
  }, overrides);
}

function sqlFnReturning(rows) {
  return async () => ({ ok: true, rows });
}

// ── clean state ──────────────────────────────────────────────────────────────────────────────────────
test('a fully clean table passes: ok:true, alarms carry ONLY the row-count info entry', async () => {
  const rows = [cleanRow(), cleanRow({ slug: 'second-firm-example', hash: 'cafebabe', url: 'second-firm.example' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.alarms.length, 1);
  assert.strictEqual(res.alarms[0].kind, 'row-count');
  assert.strictEqual(res.alarms[0].detail, '2 row(s) scanned.');
});

test('an empty table passes: ok:true, row-count reports 0', async () => {
  const res = await reconcile({ sqlFn: sqlFnReturning([]), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.alarms, [{ kind: 'row-count', slug: null, detail: '0 row(s) scanned.' }]);
});

// ── (a) done-without-page: every seeded gap shape ───────────────────────────────────────────────────
test('KNOWN-BAD seed (done-without-page, missing r2 marker): payload_json has no r2:true', async () => {
  const rows = [cleanRow({ payload_json: {} })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const a = res.alarms.find((x) => x.kind === 'done-without-page');
  assert.ok(a, 'done-without-page must fire');
  assert.strictEqual(a.slug, 'oakhurst-legal-example');
  assert.match(a.detail, /payload_json\.r2/);
});

test('KNOWN-BAD seed (done-without-page, payload_json null): the R2 marker is entirely absent', async () => {
  const rows = [cleanRow({ payload_json: null })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.ok(res.alarms.some((x) => x.kind === 'done-without-page'));
});

test('KNOWN-BAD seed (done-without-page, unparseable JSON string): a malformed payload_json is never read as "fine"', async () => {
  const rows = [cleanRow({ payload_json: '{not json' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.ok(res.alarms.some((x) => x.kind === 'done-without-page'));
});

test('done-without-page ALSO fires on a valid r2 marker whose JSON arrived as a string (driver-shape tolerant)', async () => {
  const rows = [cleanRow({ payload_json: '{"r2":true}' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, true, 'a STRING-encoded {"r2":true} is still a valid marker, not an alarm');
});

test('KNOWN-BAD seed (done-without-page, missing slug): the R2 object key cannot be built', async () => {
  const rows = [cleanRow({ slug: null })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const a = res.alarms.find((x) => x.kind === 'done-without-page');
  assert.match(a.detail, /slug missing/);
  assert.strictEqual(a.slug, 'oakhurst-legal.example', 'falls back to url when slug itself is absent');
});

test('KNOWN-BAD seed (done-without-page, missing hash): the R2 object key cannot be built', async () => {
  const rows = [cleanRow({ hash: '' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const a = res.alarms.find((x) => x.kind === 'done-without-page');
  assert.match(a.detail, /hash missing/);
});

test('a row with neither slug nor url gets a null alarm slug, never a crash, and the gap still names itself in detail', async () => {
  const rows = [{ url: null, slug: null, hash: null, engine_version: ENGINE_VERSION, payload_json: null }];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const a = res.alarms.find((x) => x.kind === 'done-without-page');
  assert.strictEqual(a.slug, null);
  assert.match(a.detail, /slug missing/);
  assert.match(a.detail, /hash missing/);
});

// ── (b) stale-version ────────────────────────────────────────────────────────────────────────────────
test('KNOWN-BAD seed (stale-version): a row minted under an old ENGINE_VERSION is flagged (Rule 15/C-177)', async () => {
  const rows = [cleanRow({ engine_version: 'engine-v1.old' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const a = res.alarms.find((x) => x.kind === 'stale-version');
  assert.ok(a);
  assert.match(a.detail, /engine-v1\.old/);
  assert.match(a.detail, new RegExp(ENGINE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a row exactly matching the CURRENT engine version never trips stale-version', async () => {
  const res = await reconcile({ sqlFn: sqlFnReturning([cleanRow()]), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.ok(!res.alarms.some((x) => x.kind === 'stale-version'));
});

test('BOTH alarm classes fire together on one row and are both reported (not just the first found)', async () => {
  const rows = [cleanRow({ engine_version: 'engine-v0.ancient', payload_json: {} })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  const kinds = res.alarms.map((a) => a.kind).sort();
  assert.deepStrictEqual(kinds, ['done-without-page', 'row-count', 'stale-version']);
});

test('reconcile() defaults engineVersion to the real ENGINE_VERSION when the caller omits it', async () => {
  const rows = [cleanRow({ engine_version: 'some-other-version' })];
  const res = await reconcile({ sqlFn: sqlFnReturning(rows), table: TABLE }); // engineVersion omitted
  assert.strictEqual(res.ok, false, 'compared against the REAL current ENGINE_VERSION, not a blank/undefined');
  assert.ok(res.alarms.some((a) => a.kind === 'stale-version'));
});

// ── (c) row-count is always present and never flips ok to false on its own ─────────────────────────
test('row-count is present on every clean AND every alarming run, and never counts as an actionable alarm', async () => {
  const clean = await reconcile({ sqlFn: sqlFnReturning([cleanRow()]), engineVersion: ENGINE_VERSION, table: TABLE });
  const dirty = await reconcile({ sqlFn: sqlFnReturning([cleanRow({ payload_json: {} })]), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.ok(clean.alarms.some((a) => a.kind === 'row-count'));
  assert.ok(dirty.alarms.some((a) => a.kind === 'row-count'));
  assert.strictEqual(exitCodeFor(clean), 0);
  assert.strictEqual(exitCodeFor(dirty), 1);
});

// ── fail-closed: sqlFn errors are query-failed/broken, never read as "0 rows = clean" ──────────────
test('KNOWN-BAD calibration: a THROWING sqlFn becomes query-failed (ok:false), never an uncaught rejection', async () => {
  const res = await reconcile({ sqlFn: async () => { throw new Error('ECONNRESET'); }, engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.alarms.map((a) => a.kind), ['query-failed']);
  assert.match(res.alarms[0].detail, /ECONNRESET/);
  assert.strictEqual(exitCodeFor(res), 2, 'query-failed maps to exit 2 (broken), distinct from exit 1 (real alarms)');
});

test('KNOWN-BAD calibration: sqlFn resolving {ok:false} (the real Neon door\'s transport-failure shape) becomes query-failed', async () => {
  const res = await reconcile({ sqlFn: async () => ({ ok: false, rows: [], error: 'neon_http_503' }), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.alarms[0].kind, 'query-failed');
  assert.match(res.alarms[0].detail, /neon_http_503/);
  assert.strictEqual(exitCodeFor(res), 2);
});

test('KNOWN-BAD calibration: {ok:true, rows: not-an-array} is a malformed response, never silently "0 rows clean" (C-170/C-243)', async () => {
  const res = await reconcile({ sqlFn: async () => ({ ok: true, rows: undefined }), engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.alarms[0].kind, 'query-failed');
});

test('KNOWN-BAD calibration: a null/undefined sqlFn result is query-failed, not a crash', async () => {
  const res = await reconcile({ sqlFn: async () => null, engineVersion: ENGINE_VERSION, table: TABLE });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.alarms[0].kind, 'query-failed');
});

// ── table identifier reuses persist.js's own safeTable door (Rule 1: one door, not a second copy) ──
test('an unsafe MINT_TABLE identifier REJECTS the whole reconcile() call before any query runs (reuses mint/persist.js safeTable)', async () => {
  await assert.rejects(
    () => reconcile({ sqlFn: sqlFnReturning([]), engineVersion: ENGINE_VERSION, table: 'audit_pages; DROP TABLE users' }),
    /unsafe MINT_TABLE/
  );
});

test('reconcile() defaults table to DEFAULT_TABLE (audit_pages) when the caller omits it', async () => {
  let seenQuery = null;
  const res = await reconcile({ sqlFn: async (q) => { seenQuery = q; return { ok: true, rows: [] }; }, engineVersion: ENGINE_VERSION });
  assert.match(seenQuery, /FROM audit_pages/);
  assert.strictEqual(res.ok, true);
});

// ── parsePayloadJson / hasPageReference: direct unit coverage of the edge shapes ────────────────────
test('parsePayloadJson accepts an object as-is, parses a JSON string, and returns null for anything else', () => {
  assert.deepStrictEqual(parsePayloadJson({ r2: true }), { r2: true });
  assert.deepStrictEqual(parsePayloadJson('{"r2":true}'), { r2: true });
  assert.strictEqual(parsePayloadJson('not json'), null);
  assert.strictEqual(parsePayloadJson(null), null);
  assert.strictEqual(parsePayloadJson(undefined), null);
  assert.strictEqual(parsePayloadJson(42), null);
});

test('hasPageReference requires slug AND hash AND payload_json.r2 === true, all three together', () => {
  assert.strictEqual(hasPageReference({ slug: 's', hash: 'h', payload_json: { r2: true } }), true);
  assert.strictEqual(hasPageReference({ slug: 's', hash: 'h', payload_json: { r2: false } }), false);
  assert.strictEqual(hasPageReference({ slug: '', hash: 'h', payload_json: { r2: true } }), false);
  assert.strictEqual(hasPageReference({ slug: 's', hash: null, payload_json: { r2: true } }), false);
});

// ── exitCodeFor: the three-way exit contract ────────────────────────────────────────────────────────
test('exitCodeFor: 0 clean, 1 real alarms, 2 broken (query-failed) - broken wins even alongside other kinds', () => {
  assert.strictEqual(exitCodeFor({ ok: true, alarms: [{ kind: 'row-count' }] }), 0);
  assert.strictEqual(exitCodeFor({ ok: false, alarms: [{ kind: 'stale-version' }, { kind: 'row-count' }] }), 1);
  assert.strictEqual(exitCodeFor({ ok: false, alarms: [{ kind: 'query-failed' }] }), 2);
});
