'use strict';
const test = require('node:test');
const assert = require('node:assert');
const persist = require('./persist.js');
const { ENGINE_VERSION } = require('./version.js');
const { catalogue_version: CATALOGUE_VERSION } = require('../catalogue/dist/catalogue.v1.json');
const { buildCaptureIndex } = require('../supervised/capture-index.js');
const { resolveQuoteSpan } = require('../supervised/quote-resolver.js');
const { verifyQuote, verifyRawProvenance } = require('../supervised/verify-quote.js');

// A minimal contract-shaped payload carrying ONLY the fields persist reads: meta.domain/sector/country (the
// row columns), frameworksBinding (the marker's binding count) and findings (the marker's llm_verify signal).
function payload(domain) {
  return { meta: { domain, sector: 'law-firms', country: 'UK' }, frameworksBinding: 3, findings: [] };
}

test('deriveSlug kebabs the domain into a single URL-safe segment (no slash); deriveHash is 16 hex (Kimi K3 R2 A19/#21: widened from 8 to defend against offline grinding)', () => {
  const p = payload('oakhurst-legal.example');
  assert.strictEqual(persist.deriveSlug(p), 'oakhurst-legal-example');
  const h = persist.deriveHash(p);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.strictEqual(persist.kebab('Foo.Bar_Baz!!'), 'foo-bar-baz');
});

test('deriveHash is stable under key-order-only changes to the same content (Kimi K3 R2 #50: stableJson sorts keys deeply)', () => {
  const a = { meta: { domain: 'x.example', sector: 'law-firms', country: 'UK' }, frameworksBinding: 3, findings: [] };
  const b = { findings: [], frameworksBinding: 3, meta: { country: 'UK', sector: 'law-firms', domain: 'x.example' } };
  assert.strictEqual(persist.deriveHash(a), persist.deriveHash(b));
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
  // Kimi K3 R2 A18/#20: llm_verify now reads the explicit pipeline fact payload.meta.adjudicated===true,
  // not shape (Array.isArray(payload.findings)), so a mint that genuinely ran the adjudicator must set it.
  const adjudicated = { meta: { domain: 'a.example', sector: 'law-firms', country: 'UK', adjudicated: true }, frameworksBinding: 3, findings: [] };
  const row = persist.buildRow({ slug: 's', hash: 'h', generatedAt: '2026-07-19', payload: adjudicated });
  // the row carries ONLY the ten real columns.
  assert.deepStrictEqual(Object.keys(row).sort(), [...persist.INSERT_COLUMNS].sort());
  // the marker is the compact {r2:true, ...} blob, NEVER the full payload.
  assert.strictEqual(row.payload_json.r2, true, 'the website read keys on payload_json.r2 to fetch the full object from R2');
  assert.ok('binding' in row.payload_json, 'binding KEY must be present (trigger guard 1 tests key existence)');
  assert.strictEqual(row.payload_json.binding, 3, 'binding is the frameworksBinding count threaded from connect()');
  assert.strictEqual(row.payload_json.engine_version, ENGINE_VERSION, 'engine_version is the exact ENGINE_VERSION string (trigger guard 2)');
  assert.strictEqual(row.payload_json.llm_verify, true, 'llm_verify true when the payload carries meta.adjudicated===true (the real pipeline fact)');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(row.payload_json, 'meta'), false, 'the marker is NOT the full payload');
});

test('#20/A18: llm_verify is false when the payload only carries a findings[] ARRAY shape but no meta.adjudicated fact (the shape-derived guess this fix closed)', () => {
  const row = persist.buildRow({ slug: 's', hash: 'h', payload: payload('a.example') });
  assert.strictEqual(row.payload_json.llm_verify, false, 'a bare findings:[] shape with no adjudicated fact must NOT be read as a verified mint');
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
  // Kimi K3 R2 #50: the R2 body is stableJson (deep-sorted keys), not raw JSON.stringify, so compare by
  // parsed content (what actually matters: the FULL payload, byte-content-equivalent) rather than a
  // literal string whose key order is now a stableJson implementation detail.
  assert.deepStrictEqual(JSON.parse(puts[0].body), payload('oakhurst-legal.example'), 'the FULL payload goes to R2, never to Neon');
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

// ── sealed artifact-store persistence (Kimi K3 MEDIUM-E5) ──────────────────────────────────────────────

test('persistArtifactStore writes one sealed, content-addressed object per artifact via the injected putFn, never the real network', async () => {
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/privacy', text: 'We use cookies before you consent to them.' }] } });
  const puts = [];
  const result = await persist.persistArtifactStore(store, { putFn: async (key, body) => { puts.push({ key, body }); return { ok: true, status: 200 }; } });
  const artifact = store.list()[0];
  assert.strictEqual(puts.length, 1);
  assert.strictEqual(puts[0].key, persist.sealedObjectKey(artifact.evidence_id, artifact.sha256));
  const parsed = JSON.parse(puts[0].body);
  assert.strictEqual(parsed.evidence_id, artifact.evidence_id);
  assert.strictEqual(parsed.sha256, artifact.sha256);
  assert.strictEqual(Buffer.from(parsed.bytes_base64, 'base64').toString('utf8'), artifact.bytes.toString('utf8'));
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].ok, true);
  assert.match(result.chainHead, /^[0-9a-f]{64}$/);
});

test('deriveArtifactChainHead is stable regardless of capture order (sorted by evidence_id, not insertion order)', () => {
  const storeA = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/a', text: 'page a text' }, { url: 'https://x.example/b', text: 'page b text' }] } });
  const storeB = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/b', text: 'page b text' }, { url: 'https://x.example/a', text: 'page a text' }] } });
  assert.strictEqual(persist.deriveArtifactChainHead(storeA), persist.deriveArtifactChainHead(storeB));
});

test('attachChainHead adds evidence_chain_head to a CLONE of the payload without mutating the original', () => {
  const p = payload('a.example');
  const withHead = persist.attachChainHead(p, 'deadbeef'.repeat(8));
  assert.strictEqual(withHead.evidence_chain_head, 'deadbeef'.repeat(8));
  assert.strictEqual(p.evidence_chain_head, undefined, 'the original payload object must not be mutated');
  assert.strictEqual(withHead.meta.domain, 'a.example', 'the rest of the payload is carried through unchanged');
});

test('a failed sealed-artifact write is recorded per-artifact, never thrown into the caller (Rule 9)', async () => {
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/', text: 'some real text' }] } });
  const result = await persist.persistArtifactStore(store, { putFn: async () => ({ ok: false, status: 500 }) });
  assert.strictEqual(result.results[0].ok, false);
  // Kimi K3 R2 A17/#22: chainHead must be null (and ok:false) when ANY artifact write failed - a partial
  // store must never carry a durability marker claiming the full chain is real.
  assert.strictEqual(result.chainHead, null, 'a partially-written store must not carry a chainHead - false durability claim');
  assert.strictEqual(result.ok, false);
});

test('#22/A17: chainHead is null when SOME artifacts write ok and others fail (partial write, not just total failure)', async () => {
  const store = buildCaptureIndex({ domain: 'x', corpus: { pages: [
    { url: 'https://x.example/a', text: 'page a real text' },
    { url: 'https://x.example/b', text: 'page b real text' },
  ] } });
  let calls = 0;
  const result = await persist.persistArtifactStore(store, { putFn: async () => { calls += 1; return { ok: calls === 1, status: calls === 1 ? 200 : 500 }; } });
  assert.strictEqual(result.results.length, 2);
  assert.ok(result.results.some((r) => r.ok === false), 'at least one artifact genuinely failed');
  assert.strictEqual(result.chainHead, null, 'ANY failed write must null the chainHead, not just an all-fail store');
});

// THE MEDIUM-E5 PROOF: mint a finding, DROP the in-memory captureIndex entirely, re-verify every shipped
// finding against the SEALED STORE ALONE (replaySealedStore over the records persistArtifactStore wrote) ->
// all verify. This is the exact scenario the finding names: "once the process exits no auditor can re-run
// verify_quote over a minted claim" - proven false here by never touching the original `store`/`quote`
// objects again after the sealed write, only the plain JSON records captured off the wire.
test('MEDIUM-E5 PROOF: after dropping the in-memory captureIndex, every shipped finding re-verifies against the sealed store alone', async () => {
  const rawHtml = '<p>We use cookies before you consent to them, which some visitors will find intrusive.</p>';
  const text = 'We use cookies before you consent to them, which some visitors will find intrusive.';
  let store = buildCaptureIndex({ domain: 'x', corpus: { pages: [{ url: 'https://x.example/privacy', text, rawHtml }] } });
  const shippedQuote = resolveQuoteSpan(store, 'https://x.example/privacy', 'cookies before you consent');
  assert.ok(shippedQuote);
  assert.strictEqual(verifyQuote(store, shippedQuote), true);
  assert.strictEqual(verifyRawProvenance(store, shippedQuote), true);

  // Seal every artifact to a plain in-memory "object store" (the same shape a real R2 PUT would receive).
  const sealed = new Map();
  await persist.persistArtifactStore(store, { putFn: async (key, body) => { sealed.set(key, body); return { ok: true, status: 200 }; } });

  // DROP the in-memory captureIndex - the process-exit scenario the finding describes. Only the plain JSON
  // records survive (as if fetched back from R2 by evidence_id/sha256 in a fresh process).
  store = null;
  const records = Array.from(sealed.values()).map((body) => JSON.parse(body));
  const replayedStore = persist.replaySealedStore(records);

  // Re-verify the SAME shipped quote against ONLY the sealed store - no reference to the original store.
  assert.strictEqual(verifyQuote(replayedStore, shippedQuote), true);
  assert.strictEqual(verifyRawProvenance(replayedStore, shippedQuote), true);
});
