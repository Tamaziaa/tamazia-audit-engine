'use strict';
// mint/persist.js - THE two persistence doors of the live mint (Constitution Rule 7, Rule 9, Rule 15,
// Rule 16, C-102/C-103/C-177).
//
// A mint writes to TWO stores, mirroring the tamazia-website read contract exactly:
//   R2  (writeR2)  the FULL payload, at object key `audits/<slug>/<hash>.json`. The website read path
//                  (functions/audit/[[path]].js) fetches `env.AUDITS.get('audits/${slug}/${hash}.json')`
//                  when the Neon row's payload_json is `{r2:true}`, so the object key here MIRRORS that
//                  read exactly. Written via the Cloudflare R2 REST API:
//                    PUT /client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/r2/buckets/<R2_BUCKET>/objects/<key>
//   Neon (writeRow) the COMPACT projection row {slug, hash, engine_version, generated_at, payload_json:
//                  {r2:true}, + summary fields}, INSERTed with ON CONFLICT on the idempotency key
//                  (url, engine_version) DO UPDATE (Rule 15: the engine version rides the idempotency key;
//                  the DB-level required_engine_version trigger, C-177, is the lock every minter passes).
//                  Written via the Neon HTTP /sql endpoint (header Neon-Connection-String), the SAME
//                  transport the website's functions/api/_neon.js uses on the Workers runtime.
//
// slug/hash DERIVATION (documented, mirrors the website's `/audit/<slug>/<hash>` route where each is a
// single `[^/]+` path segment):
//   slug = kebab(domain)   - a URL-safe single segment from the normalised host (never a slash), stable per
//                            site and independent of identity resolution (which may abstain).
//   hash = sha256(payload-json).slice(0,8) - the 8-hex content hash the website route reads as the barrier.
// A re-mint of the SAME site under the SAME engine version updates ONE row (idempotency key url+version); a
// content change yields a new hash and the DO UPDATE points the row's slug/hash at the fresh object.
//
// BOTH DOORS ARE INJECTABLE (opts.sqlFn / opts.putFn) so node:test never touches the network. BOTH default
// doors are deadline-bounded (a hard AbortSignal, Rule 9) and route their endpoint URL through the
// safe-fetch SSRF door before a socket opens. NO SECRET is ever logged, returned or stored on an object
// (Rule 16): NEON_URL / CLOUDFLARE_API_TOKEN are read from env inside the door at call time and used only
// to build that one request's header.

const crypto = require('crypto');
const { parseSafeFetchTarget } = require('../tools/lib/safe-fetch.js');
const { ENGINE_VERSION } = require('./version.js');

const WRITE_DEADLINE_MS = 10000; // a CAP on each persistence write (Rule 8/9), never a floor.
const DEFAULT_TABLE = 'audit_pages';
const DEFAULT_BUCKET = 'AUDITS';
const DEFAULT_AUDIT_BASE = 'https://tamazia.co.uk';

// kebab(s) -> a lowercase, hyphen-joined single URL path segment (alphanumerics kept, every other run
// collapsed to one hyphen, ends trimmed). '' when the input has no usable characters (the caller refuses).
function kebab(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// stableJson(payload) -> the payload serialised for hashing. compose() is pure and its generatedAt is
// injected (no clock), so the same inputs yield the same object and JSON.stringify is byte-stable for the
// content hash. Not a canonical sort (unnecessary: one producer, one shape), just the content bytes.
function stableJson(payload) {
  return JSON.stringify(payload);
}

// deriveSlug(payload) / deriveHash(payload) -> the two route segments. slug from the domain fact
// (payload.meta.domain, the one-door host), hash the 8-hex content digest.
function deriveSlug(payload) {
  const domain = payload && payload.meta && payload.meta.domain;
  return kebab(domain);
}
function deriveHash(payload) {
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 8);
}

// summaryFields(payload) -> the compact summary the Neon row carries alongside slug/hash (the website read
// selects domain/sector/country; score/grade are cheap projections for the ops surface). Never the full
// payload (that lives in R2).
function summaryFields(payload) {
  const meta = (payload && payload.meta) || {};
  return {
    domain: str(meta.domain), sector: str(meta.sector), country: str(meta.country),
    score: numOrNull(payload && payload.score), grade: str(payload && payload.grade),
  };
}
function str(v) { return typeof v === 'string' && v ? v : (v == null ? null : String(v)); }
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// buildRow({slug, hash, generatedAt, payload}) -> the compact projection persisted to Neon. payload_json is
// the `{r2:true}` marker the website read keys on to fetch the full object from R2 (never the full payload).
function buildRow({ slug, hash, generatedAt, payload }) {
  const s = summaryFields(payload);
  return {
    url: s.domain, slug, hash, engine_version: ENGINE_VERSION, generated_at: generatedAt || null,
    r2: true, payload_json: { r2: true },
    domain: s.domain, sector: s.sector, country: s.country, score: s.score, grade: s.grade,
  };
}

// buildInsertSql(table, row) -> { query, params } for the idempotent upsert. ON CONFLICT (url,
// engine_version) DO UPDATE (Rule 15). The column set mirrors the website read (slug/hash/payload_json/
// domain/sector/country) plus engine_version + generated_at for the version gate (C-177). Parameterised
// ($1..$N) so no value is interpolated into SQL. The table name is a validated identifier (never a param).
function buildInsertSql(table, row) {
  const t = safeTable(table);
  const query =
    'INSERT INTO ' + t + ' (url, slug, hash, engine_version, generated_at, payload_json, domain, sector, country, score, grade)'
    + ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)'
    + ' ON CONFLICT (url, engine_version) DO UPDATE SET'
    + ' slug=EXCLUDED.slug, hash=EXCLUDED.hash, generated_at=EXCLUDED.generated_at, payload_json=EXCLUDED.payload_json,'
    + ' domain=EXCLUDED.domain, sector=EXCLUDED.sector, country=EXCLUDED.country, score=EXCLUDED.score, grade=EXCLUDED.grade'
    + ' RETURNING slug, hash, engine_version';
  const params = [row.url, row.slug, row.hash, row.engine_version, row.generated_at, JSON.stringify(row.payload_json), row.domain, row.sector, row.country, row.score, row.grade];
  return { query, params };
}

// safeTable(name) -> a validated SQL identifier (letters, digits, underscore, optional schema-qualified).
// A table name is NEVER a bound parameter, so it must be validated as an identifier; anything else throws
// (fail closed, Rule 4) rather than reaching the SQL string.
function safeTable(name) {
  const n = String(name || DEFAULT_TABLE);
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(n)) throw new Error('mint/persist: unsafe MINT_TABLE identifier: ' + JSON.stringify(name));
  return n;
}

// ── default Neon door (the HTTP /sql endpoint, mirroring functions/api/_neon.js) ──────────────────────
// neonHostFrom(connStr) -> the host of a postgres:// connection string (the /sql endpoint host). Reads only
// the host into a return; the full connection string (a secret) stays in the header, never in a return/log.
function neonHostFrom(connStr) {
  const m = /.*@([^/]+)\/.*/.exec(String(connStr || ''));
  return m ? m[1] : '';
}
// defaultSqlFn(env) -> (query, params) => Promise<{ ok, rows }>. Reads NEON_URL at call time (Rule 16),
// POSTs to the /sql endpoint under a hard AbortSignal deadline (Rule 9). The connection-string header is
// never logged. A non-2xx / throw yields { ok:false } (the caller records it; a mint never flips done on it).
function defaultSqlFn(env) {
  return async function sqlFn(query, params) {
    const conn = (env && env.NEON_URL) || '';
    const host = neonHostFrom(conn);
    if (!host) return { ok: false, rows: [], error: 'neon_unconfigured' };
    const target = parseSafeFetchTarget('https://' + host + '/sql');
    if (!target) return { ok: false, rows: [], error: 'neon_unsafe_host' };
    return withAbort(WRITE_DEADLINE_MS, (signal) => fetch(target.href, {
      method: 'POST', signal,
      headers: { 'Neon-Connection-String': conn, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params }),
    }).then(async (r) => (r.ok ? { ok: true, rows: (await r.json()).rows || [] } : { ok: false, rows: [], error: 'neon_http_' + r.status })));
  };
}

// ── default R2 door (the Cloudflare R2 REST object PUT) ────────────────────────────────────────────────
// defaultPutFn(env) -> (objectKey, body) => Promise<{ ok, status }>. Reads CLOUDFLARE_API_TOKEN /
// CLOUDFLARE_ACCOUNT_ID / R2_BUCKET at call time (Rule 16), PUTs the object under a hard AbortSignal
// deadline (Rule 9). The token is never logged. A non-2xx / throw yields { ok:false }.
function defaultPutFn(env) {
  return async function putFn(objectKey, body) {
    const e = env || {};
    const token = e.CLOUDFLARE_API_TOKEN, acct = e.CLOUDFLARE_ACCOUNT_ID, bucket = e.R2_BUCKET || DEFAULT_BUCKET;
    if (!token || !acct) return { ok: false, status: 0, error: 'r2_unconfigured' };
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(acct) + '/r2/buckets/' + encodeURIComponent(bucket) + '/objects/' + objectKey;
    const target = parseSafeFetchTarget(url);
    if (!target) return { ok: false, status: 0, error: 'r2_unsafe_host' };
    return withAbort(WRITE_DEADLINE_MS, (signal) => fetch(target.href, {
      method: 'PUT', signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body,
    }).then((r) => ({ ok: r.ok, status: r.status })));
  };
}

// withAbort(ms, fn) -> run fn(signal) under a hard AbortController deadline; a timeout/throw resolves to a
// typed { ok:false } (never throws into the mint - Rule 9). fn returns the door's own {ok,...} shape.
async function withAbort(ms, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  try { return await fn(controller.signal); }
  catch (e) {
    // FAIL-OPEN: a persistence write that throws/aborts becomes a typed { ok:false } RESULT (the caller's
    // post-write assertions read it and refuse to flip done, Rule 7); it never throws into the mint (Rule 9).
    return { ok: false, status: 0, error: String((e && e.message) || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// liveUrlFor(slug, hash, env) -> the audit URL the post-write live-200 check hits, from the website route.
function liveUrlFor(slug, hash, env) {
  const base = (env && env.AUDIT_BASE_URL) || DEFAULT_AUDIT_BASE;
  return String(base).replace(/\/+$/, '') + '/audit/' + encodeURIComponent(slug) + '/' + encodeURIComponent(hash);
}

/**
 * persist(payload, opts) -> Promise<{ slug, hash, row, liveUrl, r2, rowResult, r2Result }>. Writes R2 FIRST
 * (the full object must exist before the row that points at it - the website 404s a row whose R2 object is
 * missing), then the idempotent Neon row. NEVER throws: a failed door returns its typed { ok:false } and the
 * caller (post-write assertions) refuses to flip done (the phantom-data class, Rule 7/C-249).
 *
 * opts.env        env for both doors (default process.env; secrets read at call time only, Rule 16).
 * opts.generatedAt the row's generated_at (the caller's minted timestamp; NEVER Date.now inside pure code).
 * opts.table      the Neon table (default env.MINT_TABLE or 'audit_pages').
 * opts.sqlFn      injected (query, params) => {ok, rows} (tests: in-memory; production: the Neon door).
 * opts.putFn      injected (objectKey, body) => {ok, status} (tests: in-memory; production: the R2 door).
 */
async function persist(payload, opts = {}) {
  const env = opts.env || process.env;
  const slug = deriveSlug(payload);
  const hash = deriveHash(payload);
  if (!slug || !hash) throw new Error('mint/persist: cannot derive a slug/hash (no domain fact in the payload); refusing to persist a keyless row (Rule 7)');
  const table = opts.table || env.MINT_TABLE || DEFAULT_TABLE;
  const row = buildRow({ slug, hash, generatedAt: opts.generatedAt, payload });
  const sqlFn = typeof opts.sqlFn === 'function' ? opts.sqlFn : defaultSqlFn(env);
  const putFn = typeof opts.putFn === 'function' ? opts.putFn : defaultPutFn(env);

  const objectKey = 'audits/' + slug + '/' + hash + '.json';
  const r2Result = await putFn(objectKey, stableJson(payload));
  const { query, params } = buildInsertSql(table, row);
  const rowResult = await sqlFn(query, params);

  return { slug, hash, row, liveUrl: liveUrlFor(slug, hash, env), objectKey, r2Result, rowResult };
}

module.exports = {
  persist,
  deriveSlug,
  deriveHash,
  buildRow,
  buildInsertSql,
  liveUrlFor,
  kebab,
  safeTable,
  neonHostFrom,
  defaultSqlFn,
  defaultPutFn,
  WRITE_DEADLINE_MS,
  DEFAULT_TABLE,
  DEFAULT_BUCKET,
};
