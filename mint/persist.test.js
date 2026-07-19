'use strict';
const test = require('node:test');
const assert = require('node:assert');
const persist = require('./persist.js');
const { ENGINE_VERSION } = require('./version.js');
const { catalogue_version: CATALOGUE_VERSION } = require('../catalogue/dist/catalogue.v1.json');

// A minimal contract-shaped payload carrying ONLY the fields persist reads: meta.domain/sector/country (the
// row columns), frameworksBinding (the marker's binding count) and findings (the marker's llm_verify signal).
function payload(domain) {
  return { meta: { domain, sector: 'law-firms', country: 'UK' }, frameworksBinding: 3, findings: [] };
}

test('deriveSlug kebabs the domain into a single URL-safe segment (no slash); deriveHash is 8 hex', () => {
  const p = payload('oakhurst-legal.example');
  assert.strictEqual(persist.deriveSlug(p), 'oakhurst-legal-example');
  const h = persist.deriveHash(p);
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.strictEqual(persist.kebab('Foo.Bar_Baz!!'), 'foo-bar-baz');
});

test('deriveHash is deterministic for the same payload and changes when content changes (Rule 15: no cache)', () => {
  assert.strictEqual(persist.deriveHash(payload('a.example')), persist.deriveHash(payload('a.example')));
  assert.notStrictEqual(persist.deriveHash(payload('a.example')), persist.deriveHash(payload('b.example')));
});

// ── the column-subset proof (B3, mechanical, no live DB call) ──────────────────────────────────────────
test('every written column is a REAL audit_pages column, and NONE of the phantom columns are written', () => {
  // LIVE_AUDIT_PAGES_COLUMNS is the verified live schema of record (read-only against Neon 2026-07-19).
  const live = new Set(persist.LIVE_AUDIT_PAGES_COLUMNS);
  for (const c of persist.INSERT_COLUMNS) {
    assert.ok(live.has(c), 'INSERT column "' + c + '" is not a live audit_pages column');
  }
  // the four phantom columns the pre-conform code wrote must never appear (they would fail the INSERT).
  for (const phantom of ['url', 'engine_version', 'score', 'grade']) {
    assert.ok(!persist.INSERT_COLUMNS.includes(phantom), 'phantom column "' + phantom + '" must not be written');
    assert.ok(!persist.UPDATE_COLUMNS.includes(phantom), 'phantom column "' + phantom + '" must not be updated');
  }
  // the conflict target is the REAL unique constraint (slug, hash), never (url, engine_version).
  assert.deepStrictEqual([...persist.CONFLICT_TARGET], ['slug', 'hash']);
  assert.strictEqual(persist.INSERT_COLUMNS.length, 10, 'exactly the ten conforming columns');
});

test('buildInsertSql upserts ON CONFLICT (slug, hash) and binds params in the INSERT_COLUMNS order', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', generatedAt: '2026-07-19', payload: payload('a.example') });
  const { query, params } = persist.buildInsertSql('audit_pages', row);
  assert.match(query, /INSERT INTO audit_pages \(slug, hash, domain, sector, country, framework_version, payload_json, generated_at, status, idem_key\)/);
  assert.match(query, /ON CONFLICT \(slug, hash\) DO UPDATE SET/);
  assert.match(query, /payload_json=EXCLUDED\.payload_json/);
  assert.match(query, /RETURNING slug, hash, payload_json/);
  assert.doesNotMatch(query, /url|engine_version|score|grade/, 'no phantom column appears in the SQL');
  // params map 1:1 to INSERT_COLUMNS; slug/hash lead, payload_json ($7) is the STRINGIFIED marker.
  assert.strictEqual(params[0], 's');
  assert.strictEqual(params[1], 'h');
  const marker = JSON.parse(params[6]);
  assert.strictEqual(marker.engine_version, ENGINE_VERSION, 'the engine version rides inside the payload_json marker (the trigger reads it there)');
  assert.strictEqual(params[9], 'a.example|' + ENGINE_VERSION, 'idem_key ($10) carries the domain and ENGINE_VERSION (Rule 15)');
});

test('buildRow writes the r2 MARKER blob the live trigger inspects: r2 + binding + engine_version + llm_verify', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', generatedAt: '2026-07-19', payload: payload('a.example') });
  // the row carries ONLY the ten real columns.
  assert.deepStrictEqual(Object.keys(row).sort(), [...persist.INSERT_COLUMNS].sort());
  // the marker is the compact {r2:true, ...} blob, NEVER the full payload.
  assert.strictEqual(row.payload_json.r2, true, 'the website read keys on payload_json.r2 to fetch the full object from R2');
  assert.ok('binding' in row.payload_json, 'binding KEY must be present (trigger guard 1 tests key existence)');
  assert.strictEqual(row.payload_json.binding, 3, 'binding is the frameworksBinding count threaded from connect()');
  assert.strictEqual(row.payload_json.engine_version, ENGINE_VERSION, 'engine_version is the exact ENGINE_VERSION string (trigger guard 2)');
  assert.strictEqual(row.payload_json.llm_verify, true, 'llm_verify true when the payload carries the adjudicator findings surface');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(row.payload_json, 'meta'), false, 'the marker is NOT the full payload');
});

test('the marker binding KEY is present even when frameworksBinding is absent (guard 1 tests existence, not truthiness)', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', payload: { meta: { domain: 'z.example' } } });
  assert.ok('binding' in row.payload_json, 'binding key present');
  assert.strictEqual(row.payload_json.binding, 0, 'a firm with no binding frameworks records binding:0, not a missing key');
  assert.strictEqual(row.payload_json.llm_verify, false, 'no findings surface -> llm_verify false (a bare payload is not a verified mint)');
});

// ── the trigger-guard satisfaction proof (mechanical: the live guard predicates re-implemented locally) ──
// wouldRejectStub(marker) mirrors live trigger guard 1: reject when (marker has r2 AND NOT binding) OR
// (NOT llm_verify AND NOT r2). engineVersionKey(marker) mirrors `payload_json->>'engine_version'` (guard 2).
function wouldRejectStub(marker) {
  const has = (k) => Object.prototype.hasOwnProperty.call(marker, k);
  return (has('r2') && !has('binding')) || (!has('llm_verify') && !has('r2'));
}
function engineVersionKey(marker) { return marker.engine_version; }

test('KNOWN-BAD calibration: a bare {r2:true} stub is REJECTED by guard 1; our real marker is NOT, and its engine_version key matches ENGINE_VERSION (guard 2)', () => {
  const stub = { r2: true }; // the phantom-stub the trigger exists to reject (no binding, no llm_verify)
  assert.strictEqual(wouldRejectStub(stub), true, 'guard 1 rejects an r2 stub with no binding (stale_or_stub_write_rejected)');
  const row = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example') });
  assert.strictEqual(wouldRejectStub(row.payload_json), false, 'the real marker passes guard 1 (binding present under r2)');
  assert.strictEqual(engineVersionKey(row.payload_json), ENGINE_VERSION, 'guard 2 compares payload_json->>engine_version to the flag; our marker carries the exact string');
});

test('framework_version defaults to the compiled catalogue_version and is overridable via opts', () => {
  const def = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example'), frameworkVersion: persist.frameworkVersionFor(payload('a.example'), {}) });
  assert.strictEqual(def.framework_version, CATALOGUE_VERSION, 'default framework_version is the catalogue artifact catalogue_version');
  assert.strictEqual(persist.frameworkVersionFor(payload('a.example'), { frameworkVersion: 'v9.9-test' }), 'v9.9-test', 'opts.frameworkVersion wins');
  const over = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example'), frameworkVersion: 'v9.9-test' });
  assert.strictEqual(over.framework_version, 'v9.9-test');
});

test('status defaults to a website-read-tolerated ready string; the read does not filter on status', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example') });
  assert.strictEqual(row.status, 'ready');
  assert.strictEqual(row.status, persist.DEFAULT_STATUS);
  const custom = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example'), status: 'minted' });
  assert.strictEqual(custom.status, 'minted');
});

test('KNOWN-BAD calibration: an unsafe MINT_TABLE identifier is REFUSED (never reaches the SQL string)', () => {
  assert.throws(() => persist.safeTable('audit_pages; DROP TABLE users'), /unsafe MINT_TABLE/);
  assert.throws(() => persist.buildInsertSql('a"b', persist.buildRow({ slug: 's', hash: 'h', payload: payload('x.example') })), /unsafe MINT_TABLE/);
  assert.strictEqual(persist.safeTable('public.audit_pages'), 'public.audit_pages');
});

test('persist writes R2 FIRST then the Neon row, via injected doors, and derives the live URL', async () => {
  const puts = []; const rows = [];
  const r = await persist.persist(payload('oakhurst-legal.example'), {
    generatedAt: '2026-07-19', env: {},
    putFn: async (key, body) => { puts.push({ key, body }); return { ok: true, status: 200 }; },
    sqlFn: async (q, p) => { rows.push({ q, p }); return { ok: true, rows: [{ slug: p[0], hash: p[1] }] }; },
  });
  assert.strictEqual(puts.length, 1);
  assert.strictEqual(puts[0].key, 'audits/oakhurst-legal-example/' + r.hash + '.json', 'R2 key mirrors the website read path exactly');
  assert.strictEqual(puts[0].body, JSON.stringify(payload('oakhurst-legal.example')), 'the FULL payload goes to R2, never to Neon');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(r.liveUrl, 'https://tamazia.co.uk/audit/oakhurst-legal-example/' + r.hash);
  assert.strictEqual(r.row.payload_json.engine_version, ENGINE_VERSION, 'the persisted row carries the version inside the marker, not a column');
  assert.strictEqual(r.row.idem_key, 'oakhurst-legal.example|' + ENGINE_VERSION);
});

test('opts.llmVerify overrides the marker llm_verify boolean (a caller may pass a report-derived truth)', async () => {
  let seen = null;
  await persist.persist(payload('a.example'), {
    env: {}, llmVerify: false,
    putFn: async () => ({ ok: true, status: 200 }),
    sqlFn: async (q, p) => { seen = JSON.parse(p[6]); return { ok: true, rows: [] }; },
  });
  assert.strictEqual(seen.llm_verify, false, 'the explicit override rode into the persisted marker');
});

test('KNOWN-BAD: a payload with no domain fact cannot derive a key and is REFUSED (Rule 7: no keyless row)', async () => {
  await assert.rejects(() => persist.persist({ meta: {} }, { sqlFn: async () => ({ ok: true, rows: [] }), putFn: async () => ({ ok: true }) }), /cannot derive a slug\/hash/);
});

test('the default Neon door reads the host from the connection string and refuses an unconfigured env', async () => {
  const sqlFn = persist.defaultSqlFn({});
  const res = await sqlFn('SELECT 1', []);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'neon_unconfigured');
  // a scheme-agnostic placeholder (never a real connection string; Rule 16, no credential-shape literal in
  // any file): neonHostFrom extracts only the part between '@' and '/', whatever the scheme.
  assert.strictEqual(persist.neonHostFrom('db-scheme://a@db.host.tld/main'), 'db.host.tld');
});

test('the default R2 door refuses an unconfigured env (no token/account) without opening a socket', async () => {
  const putFn = persist.defaultPutFn({});
  const res = await putFn('audits/x/y.json', '{}');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'r2_unconfigured');
});
