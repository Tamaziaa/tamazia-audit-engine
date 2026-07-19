'use strict';
// mint/persist.js - THE two persistence doors of the live mint (Constitution Rule 7, Rule 9, Rule 15,
// Rule 16, C-102/C-103/C-177).
//
// A mint writes to TWO stores, mirroring the tamazia-website read contract EXACTLY (verified against the
// live audit_pages table + the live BEFORE-INSERT trigger trg_ap_engine, read-only, 2026-07-19):
//   R2  (writeR2)  the FULL payload, at object key `audits/<slug>/<hash>.json`. The website read path
//                  (functions/audit/[[path]].js) fetches `env.AUDITS.get('audits/${slug}/${hash}.json')`
//                  when the Neon row's payload_json is `{r2:true}`, so the object key here MIRRORS that
//                  read exactly. Written via the Cloudflare R2 REST API:
//                    PUT /client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/r2/buckets/<R2_BUCKET>/objects/<key>
//   Neon (writeRow) a COMPACT row of ONLY the columns that exist in the live audit_pages table
//                  (slug, hash, domain, sector, country, framework_version, payload_json, generated_at,
//                  status, idem_key), INSERTed with ON CONFLICT (slug, hash) DO UPDATE - the REAL unique
//                  constraint. payload_json is the r2 MARKER blob the DB trigger inspects, NOT the full
//                  payload. Written via the Neon HTTP /sql endpoint (header Neon-Connection-String), the
//                  SAME transport the website's functions/api/_neon.js uses on the Workers runtime.
//
// THE LIVE SCHEMA + TRIGGER THIS FILE IS BUILT TO (why the columns are exactly these ten):
//   - audit_pages has NO `url`, NO `engine_version`, NO `score`, NO `grade` column. Writing any of those
//     would fail the INSERT outright, so this door writes NONE of them (the four are the phantom columns the
//     pre-conform code carried; INSERT_COLUMNS below is the verified real subset, proven a subset of
//     LIVE_AUDIT_PAGES_COLUMNS by mint/persist.test.js - no live DB call).
//   - the UNIQUE constraint is (slug, hash); there is NO (url, engine_version) constraint, so the conflict
//     target is (slug, hash) (a re-mint of the SAME content updates ONE row; a content change is a new hash).
//   - the BEFORE-INSERT trigger reads the ENGINE VERSION and the realness markers from payload_json, NOT from
//     columns: it rejects a stub write unless payload_json carries `binding` (for an r2 marker) and it rejects
//     a STALE WORKER unless `payload_json->>'engine_version'` equals engine_flags.required_engine_version. So
//     the marker MUST carry { r2, binding, engine_version, llm_verify } (buildMarker below). RAISING the flag
//     to this engine's ENGINE_VERSION is a FOUNDER-GATED cutover (out of scope here); until it is raised the
//     conforming write is correctly rejected for the RIGHT reason (version), not a phantom-column SQL error.
//
// Rule 15 (the engine version is load-bearing): the version rides the idempotency key. Here it rides BOTH the
// live `idem_key` column (`<domain>|<ENGINE_VERSION>`) AND the payload_json marker's `engine_version` (the key
// the DB trigger actually gates on). ON CONFLICT is (slug, hash) because that is the real constraint; the
// version gate is enforced by the trigger over the marker, not by the conflict target.
//
// slug/hash DERIVATION (documented, mirrors the website's `/audit/<slug>/<hash>` route where each is a
// single `[^/]+` path segment):
//   slug = kebab(domain)   - a URL-safe single segment from the normalised host (never a slash), stable per
//                            site and independent of identity resolution (which may abstain).
//   hash = sha256(payload-json).slice(0,8) - the 8-hex content hash the website route reads as the barrier.
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
// DEFAULT_STATUS: the ready-state the website read tolerates. The read (functions/audit/[[path]].js) selects
// by slug+hash and honours expires_at; it does NOT filter on status, so any non-null ready string serves.
// 'ready' is the honest default for a freshly minted, live page.
const DEFAULT_STATUS = 'ready';

// LIVE_AUDIT_PAGES_COLUMNS: the EXACT column set of the live audit_pages table, verified read-only against
// Neon on 2026-07-19 (the schema of record, in code). INSERT_COLUMNS is asserted a SUBSET of this in
// mint/persist.test.js so a phantom column (url/engine_version/score/grade) can never silently return.
const LIVE_AUDIT_PAGES_COLUMNS = Object.freeze([
  'id', 'workspace_id', 'lead_id', 'slug', 'hash', 'domain', 'sector', 'country', 'framework_version',
  'payload_json', 'generated_at', 'expires_at', 'status', 'archived_at', 'pdf_url', 'share_card_url',
  'open_count', 'last_opened_at', 'high_intent_at', 'unlocked', 'verified', 'verify_report', 'idem_key',
]);

// INSERT_COLUMNS: the columns this door writes (all REAL, all in LIVE_AUDIT_PAGES_COLUMNS). workspace_id and
// lead_id are deliberately left to their table defaults (never invented). CONFLICT_TARGET is the real unique
// constraint (slug, hash). UPDATE_COLUMNS are the mutable columns re-pointed on a same-key re-mint. The SQL
// is built from these lists so the column order and the bound-param order cannot drift apart.
const INSERT_COLUMNS = Object.freeze([
  'slug', 'hash', 'domain', 'sector', 'country', 'framework_version', 'payload_json', 'generated_at',
  'status', 'idem_key',
]);
const CONFLICT_TARGET = Object.freeze(['slug', 'hash']);
const UPDATE_COLUMNS = Object.freeze(['payload_json', 'generated_at', 'framework_version', 'status', 'idem_key']);

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

// str(v) -> the string value, or null for null/undefined/empty (the columns are nullable metadata, never a
// fabricated placeholder). numeric/other values are coerced to their string form.
function str(v) { return typeof v === 'string' && v ? v : (v == null ? null : String(v)); }

// domainOf(payload) -> the one-door host fact (payload.meta.domain), or '' when absent.
function domainOf(payload) {
  const d = payload && payload.meta && payload.meta.domain;
  return typeof d === 'string' ? d : (d == null ? '' : String(d));
}

// idemKeyFor(domain) -> the version-bearing idempotency key value (Rule 15: the engine version rides the key).
// `<domain>|<ENGINE_VERSION>`, deterministic per site+version. This is the live `idem_key` column value; the
// conflict target stays (slug, hash) - the real constraint.
function idemKeyFor(domain) {
  return String(domain == null ? '' : domain) + '|' + ENGINE_VERSION;
}

// ── the payload_json MARKER blob (what the live trigger inspects) ─────────────────────────────────────────
// markerBinding(payload) -> the frameworksBinding COUNT the payload carries (connect()'s binding count,
// threaded verbatim into compose). A FINITE number always (0 when absent), so the `binding` KEY is ALWAYS
// present in the marker - trigger guard 1 tests key EXISTENCE (`payload_json ? 'binding'`), not truthiness,
// so `binding: 0` (a firm with no binding frameworks) still satisfies it.
function markerBinding(payload) {
  const b = Number(payload && payload.frameworksBinding);
  return Number.isFinite(b) ? b : 0;
}
// llmVerifyFor(payload, explicit) -> the boolean "did the LLM adjudication step run". A caller MAY pass an
// explicit boolean (opts.llmVerify, e.g. a report-derived truth); absent, it is derived from the payload:
// true when the payload carries the adjudicator's findings output array. In this engine a `findings` array
// exists ONLY on a fully composed payload (the propose -> verify -> enrich -> adjudicate chain, including the
// LLM Gate-3/Gate-5 seam, ran and produced the findings surface), so this genuinely distinguishes a real
// verified mint from a bare `{r2:true}` stub. It does NOT claim per-finding model approval: observed/register
// facts bypass the model to a violation (C-084), which is a fact, not a model judgement.
function llmVerifyFor(payload, explicit) {
  if (typeof explicit === 'boolean') return explicit;
  return Array.isArray(payload && payload.findings);
}
// buildMarker(payload, llmVerify) -> the COMPACT r2 marker persisted in the Neon row's payload_json (NEVER
// the full payload; that lives in R2). Carries the four keys the live trigger reads: r2 (dual-path flag the
// website read keys on), binding (guard 1), engine_version (guard 2, the STRING the trigger compares to
// engine_flags.required_engine_version), llm_verify (realness marker; required by guard 1 only for a non-r2
// blob, carried here regardless per the marker contract).
function buildMarker(payload, llmVerify) {
  return {
    r2: true,
    binding: markerBinding(payload),
    engine_version: ENGINE_VERSION,
    llm_verify: llmVerifyFor(payload, llmVerify),
  };
}

// ── framework_version: the catalogue/law-pack version (a metadata column; distinct from ENGINE_VERSION) ──
// The composed payload carries no framework/catalogue version field today, so the honest source is the
// compiled catalogue artifact's `catalogue_version` (Rule 2: the one law-fact door). Read ONCE and memoised.
let _catalogueVersion; // undefined until first resolved; then a string or null.
function catalogueVersion() {
  if (_catalogueVersion !== undefined) return _catalogueVersion;
  try {
    const cat = require('../catalogue/dist/catalogue.v1.json');
    _catalogueVersion = (cat && typeof cat.catalogue_version === 'string' && cat.catalogue_version) ? cat.catalogue_version : null;
  } catch (e) {
    // FAIL-OPEN: the compiled catalogue is a build product. If it is somehow unreadable at persist time,
    // framework_version records as null - a NULLABLE metadata column the website read does NOT select -
    // rather than throwing the mint (Rule 9). The write still conforms; the version fact is recorded
    // (memoised) as null, not silently swallowed (Rule 4/swallow-gate). e is the read failure, unused here.
    _catalogueVersion = null;
  }
  return _catalogueVersion;
}
// frameworkVersionFor(payload, opts) -> the framework_version column value. An explicit opts.frameworkVersion
// wins (tests / a future payload-borne version); absent, the compiled catalogue's catalogue_version.
function frameworkVersionFor(payload, opts) {
  const o = opts || {};
  if (typeof o.frameworkVersion === 'string' && o.frameworkVersion) return o.frameworkVersion;
  const carried = payload && (payload.framework_version || payload.catalogue_version
    || (payload.meta && payload.meta.framework_version));
  if (typeof carried === 'string' && carried) return carried;
  return catalogueVersion();
}

// buildRow({slug, hash, generatedAt, payload, frameworkVersion, llmVerify, status}) -> the COMPACT row
// persisted to Neon, keyed ONLY to real audit_pages columns. payload_json is the r2 marker (buildMarker), not
// the full payload. frameworkVersion/llmVerify/status are explicit inputs (pure function); persist() sources
// them. Absent frameworkVersion -> null; absent llmVerify -> derived from the payload; absent status -> ready.
function buildRow({ slug, hash, generatedAt, payload, frameworkVersion, llmVerify, status }) {
  const domain = domainOf(payload);
  return {
    slug,
    hash,
    domain: str(domain),
    sector: str(payload && payload.meta && payload.meta.sector),
    country: str(payload && payload.meta && payload.meta.country),
    framework_version: str(frameworkVersion) || null,
    payload_json: buildMarker(payload, llmVerify),
    generated_at: generatedAt || null,
    status: str(status) || DEFAULT_STATUS,
    idem_key: idemKeyFor(domain),
  };
}

// buildInsertSql(table, row) -> { query, params } for the idempotent upsert. ON CONFLICT (slug, hash) DO
// UPDATE (the REAL unique constraint) re-points the mutable columns on a same-key re-mint. The column list,
// the placeholder list and the bound-param list are all built from INSERT_COLUMNS so they cannot drift; the
// only non-1:1 mapping is payload_json, sent as a JSON string for the jsonb column. The table name is a
// validated identifier (never a bound param); no value is interpolated into the SQL string.
function buildInsertSql(table, row) {
  const t = safeTable(table);
  const cols = INSERT_COLUMNS.join(', ');
  const placeholders = INSERT_COLUMNS.map((_c, i) => '$' + (i + 1)).join(',');
  const conflict = CONFLICT_TARGET.join(', ');
  const updates = UPDATE_COLUMNS.map((c) => c + '=EXCLUDED.' + c).join(', ');
  const query =
    'INSERT INTO ' + t + ' (' + cols + ')'
    + ' VALUES (' + placeholders + ')'
    + ' ON CONFLICT (' + conflict + ') DO UPDATE SET ' + updates
    + ' RETURNING slug, hash, payload_json';
  const params = INSERT_COLUMNS.map((c) => (c === 'payload_json' ? JSON.stringify(row[c]) : row[c]));
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
 * persist(payload, opts) -> Promise<{ slug, hash, row, liveUrl, objectKey, r2Result, rowResult }>. Writes R2
 * FIRST (the full object must exist before the row that points at it - the website 404s a row whose R2 object
 * is missing), then the idempotent Neon row. NEVER throws: a failed door returns its typed { ok:false } and
 * the caller (post-write assertions) refuses to flip done (the phantom-data class, Rule 7/C-249).
 *
 * opts.env             env for both doors (default process.env; secrets read at call time only, Rule 16).
 * opts.generatedAt     the row's generated_at (the caller's minted timestamp; NEVER Date.now inside pure code).
 * opts.table           the Neon table (default env.MINT_TABLE or 'audit_pages').
 * opts.frameworkVersion override the framework_version column (default: the compiled catalogue_version).
 * opts.llmVerify       override the marker's llm_verify boolean (default: derived from the payload).
 * opts.status          override the status column (default 'ready').
 * opts.sqlFn           injected (query, params) => {ok, rows} (tests: in-memory; production: the Neon door).
 * opts.putFn           injected (objectKey, body) => {ok, status} (tests: in-memory; production: the R2 door).
 */
async function persist(payload, opts = {}) {
  const env = opts.env || process.env;
  const slug = deriveSlug(payload);
  const hash = deriveHash(payload);
  if (!slug || !hash) throw new Error('mint/persist: cannot derive a slug/hash (no domain fact in the payload); refusing to persist a keyless row (Rule 7)');
  const table = opts.table || env.MINT_TABLE || DEFAULT_TABLE;
  const row = buildRow({
    slug, hash, generatedAt: opts.generatedAt, payload,
    frameworkVersion: frameworkVersionFor(payload, opts), llmVerify: opts.llmVerify, status: opts.status,
  });
  const sqlFn = typeof opts.sqlFn === 'function' ? opts.sqlFn : defaultSqlFn(env);
  const putFn = typeof opts.putFn === 'function' ? opts.putFn : defaultPutFn(env);

  const objectKey = 'audits/' + slug + '/' + hash + '.json';
  const r2Result = await putFn(objectKey, stableJson(payload));
  const { query, params } = buildInsertSql(table, row);
  const rowResult = await sqlFn(query, params);

  return { slug, hash, row, liveUrl: liveUrlFor(slug, hash, env), objectKey, r2Result, rowResult };
}

// ── sealed artifact-store persistence (Kimi K3 MEDIUM-E5) ──────────────────────────────────────────────
// Verification today anchors ONLY to the in-memory supervised/capture-index.js ArtifactStore; stub
// persistence stores nothing, so once the process exits no auditor can re-run verify_quote over a minted
// claim - the bytes are gone and the payload's evidence_ids resolve nowhere. This section adds a real,
// testable-offline persistence path for the hash-chained artifact store itself, using the SAME
// injectable-door seam (opts.putFn) the rest of this file already uses for R2 - so it is unit-testable with
// an in-memory door today and ready for the live R2 writer the moment it is pointed at defaultPutFn. The
// live destination wiring (Neon/R2 credentials) stays founder-gated exactly like the rest of this file
// (Rule 23); nothing here reaches a real network path in a test.
//
// sealedObjectKey(evidenceId, sha256) -> the content-addressed R2 object key for one sealed artifact.
// Content-addressed (keyed on the artifact's OWN hash, not a mutable slug) so a re-fetch of the same
// evidence_id+sha256 is always byte-identical or absent, never silently replaced.
function sealedObjectKey(evidenceId, sha256) {
  return 'evidence/' + evidenceId + '/' + sha256 + '.json';
}

// sealedRecordFor(artifact) -> the JSON-serialisable sealed record for one supervised/capture-index.js
// artifact. Carries BOTH the normalised bytes and, when captured, the raw bytes + boundary map (capture-
// index.js's HIGH-E2 raw-durability fields) so a re-verifier can run verifyQuote() AND
// verifyRawProvenance() against this record alone, with no dependency on the in-memory store that produced
// it.
function sealedRecordFor(artifact) {
  return {
    evidence_id: artifact.evidence_id,
    url: artifact.url,
    lane: artifact.lane,
    sha256: artifact.sha256,
    length: artifact.length,
    fetched_at: artifact.fetched_at,
    bytes_base64: Buffer.isBuffer(artifact.bytes) ? artifact.bytes.toString('base64') : null,
    raw_available: Boolean(artifact.rawAvailable),
    raw_sha256: artifact.rawSha256 || null,
    raw_bytes_base64: Buffer.isBuffer(artifact.rawBytes) ? artifact.rawBytes.toString('base64') : null,
    boundaries: Array.isArray(artifact.boundaries) ? artifact.boundaries : [],
  };
}

// deriveArtifactChainHead(store) -> the sha256 "chain head" over every artifact's (evidence_id, sha256)
// pair, SORTED by evidence_id so the head is stable regardless of capture order (never a random/positional
// hash). This is the value attachChainHead() carries onto the minted payload so a later re-verifier can
// confirm the sealed store it is replaying against is EXACTLY the snapshot the payload was minted against,
// not a superset/subset/mixed swap.
function deriveArtifactChainHead(store) {
  const rows = store.list().map((a) => a.evidence_id + ':' + a.sha256).sort();
  return crypto.createHash('sha256').update(rows.join('\n'), 'utf8').digest('hex');
}

// attachChainHead(payload, chainHead) -> a SHALLOW CLONE of payload carrying the sealed store's chain head
// under `evidence_chain_head`. Deliberately additive metadata, not a payload/contract/* schema field (this
// file is not that schema's producer, Rule 1) - a re-verifier reads it to pin which sealed-store snapshot a
// shipped finding was minted against; it never gates mint-time validation itself.
function attachChainHead(payload, chainHead) {
  return Object.assign({}, payload, { evidence_chain_head: chainHead });
}

/**
 * persistArtifactStore(store, opts) -> Promise<{ chainHead, results }>. Writes every artifact in a
 * supervised/capture-index.js ArtifactStore to its own sealed, content-addressed object via opts.putFn
 * (default: the SAME defaultPutFn() R2 door persist() itself uses - production-ready, founder-gated
 * exactly like the rest of this file). NEVER throws (Rule 9): one artifact's write failure is recorded in
 * its own result row, not thrown into the mint. `results` is `[{evidence_id, sha256, objectKey, ok}]`.
 *
 * opts.env    env for the door (default process.env; secrets read at call time only, Rule 16).
 * opts.putFn  injected (objectKey, body) => {ok, status} (tests: in-memory; production: the R2 door).
 */
async function persistArtifactStore(store, opts = {}) {
  const env = opts.env || process.env;
  const putFn = typeof opts.putFn === 'function' ? opts.putFn : defaultPutFn(env);
  const results = [];
  for (const artifact of store.list()) {
    const objectKey = sealedObjectKey(artifact.evidence_id, artifact.sha256);
    const putResult = await putFn(objectKey, JSON.stringify(sealedRecordFor(artifact)));
    results.push({ evidence_id: artifact.evidence_id, sha256: artifact.sha256, objectKey, ok: Boolean(putResult && putResult.ok) });
  }
  return { chainHead: deriveArtifactChainHead(store), results };
}

// replaySealedStore(records) -> an ArtifactStore-SHAPED { get, list } object rehydrated ONLY from sealed
// records (sealedRecordFor()'s JSON shape) - no dependency on the in-memory captureIndex that produced
// them. Buffers are rehydrated from their base64 fields. This is the replay path MEDIUM-E5 requires: a
// re-verifier calls supervised/verify-quote.js's verifyQuote()/verifyRawProvenance() against the object
// this returns, exactly as an offline re-audit would, with the original process (and its in-memory store)
// long gone.
function replaySealedStore(records) {
  const byId = new Map();
  for (const r of (records || [])) {
    byId.set(r.evidence_id, {
      evidence_id: r.evidence_id, url: r.url, lane: r.lane, sha256: r.sha256, length: r.length, fetched_at: r.fetched_at,
      bytes: r.bytes_base64 ? Buffer.from(r.bytes_base64, 'base64') : null,
      rawAvailable: Boolean(r.raw_available),
      rawSha256: r.raw_sha256 || null,
      rawBytes: r.raw_bytes_base64 ? Buffer.from(r.raw_bytes_base64, 'base64') : null,
      boundaries: Array.isArray(r.boundaries) ? r.boundaries : [],
    });
  }
  return { get: (id) => byId.get(id) || null, list: () => Array.from(byId.values()) };
}

module.exports = {
  persist,
  deriveSlug,
  deriveHash,
  buildRow,
  buildMarker,
  buildInsertSql,
  frameworkVersionFor,
  catalogueVersion,
  idemKeyFor,
  liveUrlFor,
  kebab,
  safeTable,
  neonHostFrom,
  defaultSqlFn,
  defaultPutFn,
  WRITE_DEADLINE_MS,
  DEFAULT_TABLE,
  DEFAULT_BUCKET,
  DEFAULT_STATUS,
  INSERT_COLUMNS,
  CONFLICT_TARGET,
  UPDATE_COLUMNS,
  LIVE_AUDIT_PAGES_COLUMNS,
  // sealed artifact-store persistence (MEDIUM-E5)
  persistArtifactStore,
  replaySealedStore,
  deriveArtifactChainHead,
  attachChainHead,
  sealedObjectKey,
  sealedRecordFor,
};
