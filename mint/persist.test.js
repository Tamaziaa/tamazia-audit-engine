'use strict';
const test = require('node:test');
const assert = require('node:assert');
const persist = require('./persist.js');
const { ENGINE_VERSION } = require('./version.js');

// A minimal contract-shaped payload (only the fields persist reads: meta.domain/sector/country, score, grade).
function payload(domain) {
  return { meta: { domain, sector: 'law-firms', country: 'UK' }, score: 72, grade: 'C', findings: [] };
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

test('buildInsertSql upserts on the idempotency key (url, engine_version) and RETURNs slug/hash (Rule 15)', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', generatedAt: '2026-07-19', payload: payload('a.example') });
  const { query, params } = persist.buildInsertSql('audit_pages', row);
  assert.match(query, /INSERT INTO audit_pages/);
  assert.match(query, /ON CONFLICT \(url, engine_version\) DO UPDATE/);
  assert.match(query, /RETURNING slug, hash, engine_version/);
  assert.strictEqual(params[3], ENGINE_VERSION, 'engine_version is the 4th bound param, riding the key');
  assert.strictEqual(row.payload_json.r2, true, 'the Neon row stores the {r2:true} marker, not the full payload');
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
    sqlFn: async (q, p) => { rows.push({ q, p }); return { ok: true, rows: [{ slug: p[1], hash: p[2] }] }; },
  });
  assert.strictEqual(puts.length, 1);
  assert.strictEqual(puts[0].key, 'audits/oakhurst-legal-example/' + r.hash + '.json', 'R2 key mirrors the website read path exactly');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(r.liveUrl, 'https://tamazia.co.uk/audit/oakhurst-legal-example/' + r.hash);
  assert.strictEqual(r.row.engine_version, ENGINE_VERSION);
});

test('KNOWN-BAD: a payload with no domain fact cannot derive a key and is REFUSED (Rule 7: no keyless row)', async () => {
  await assert.rejects(() => persist.persist({ meta: {} }, { sqlFn: async () => ({ ok: true, rows: [] }), putFn: async () => ({ ok: true }) }), /cannot derive a slug\/hash/);
});

test('the default Neon door reads the host from the connection string and refuses an unconfigured env', async () => {
  const sqlFn = persist.defaultSqlFn({});
  const res = await sqlFn('SELECT 1', []);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'neon_unconfigured');
  assert.strictEqual(persist.neonHostFrom('postgres://u:p@db.host.tld/main'), 'db.host.tld');
});

test('the default R2 door refuses an unconfigured env (no token/account) without opening a socket', async () => {
  const putFn = persist.defaultPutFn({});
  const res = await putFn('audits/x/y.json', '{}');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'r2_unconfigured');
});
