#!/usr/bin/env node
'use strict';
/**
 * MINT-RECONCILER: a mint is done only when row + HTTP 200 + truth-pack all pass (Constitution Rule 7,
 * Rule 17, caution.md C-176/C-177/C-187).
 *
 * The old estate reported "done" on 1,004 phantom audits: a row said done with no page behind it, and a
 * transport failure once masqueraded as an idempotent conflict so a row that was never written was
 * hunted for days. This reconciler is the scheduled ground-truth check named in Rule 7's own gate map:
 * it reads the mint's persisted table directly (never the queue - see SCOPE below) and alarms on drift.
 *
 * SCOPE, HONESTLY STATED (do not invent columns this repo does not have, per the brief): Rule 7's prose
 * says "diffs queue vs audit_pages vs leads". At P4 T1 there IS NO queue table yet (mint/worker.js's own
 * header calls the real queue integration - claim/lease/ack, the DB required_engine_version gate - "T6";
 * see mint/worker.js) and this engine's mint path never touches `leads`. The only real table today is the
 * one mint/persist.js writes (default `audit_pages`, override via MINT_TABLE), so THIS reconciler checks
 * exactly that table against the COLUMN SET persist.js actually writes: url, slug, hash, engine_version,
 * generated_at, payload_json, domain, sector, country, score, grade (see mint/persist.js buildRow/
 * buildInsertSql). The queue/leads legs are NOT YET WIRED (a P4 T6 dependency); this is recorded here
 * and in the self-report rather than papered over with invented columns.
 *
 * WHAT "done" MEANS AGAINST THIS COLUMN SET: `audit_pages` carries no separate status column - a row's
 * mere PRESENCE in this table is the only "done" claim it can make (persist.js's buildRow always sets
 * payload_json to the {r2:true} marker the website read path keys on; there is no partial-row insert
 * path). So "done-without-page" here means: a row exists but the reference by which its R2 object would
 * be located is absent or malformed - slug/hash missing (the object key `audits/<slug>/<hash>.json`
 * cannot be built) or payload_json does not carry payload_json.r2 === true (the website read-path marker,
 * see mint/persist.js's header comment on the R2 door). A row failing this is the structural analogue of
 * the 1,004-phantom-row class for this schema.
 *
 * ALARM CLASSES:
 *   (a) done-without-page   a row present in the table (its only "done" claim) whose stored object
 *                           reference is absent/malformed (see above).
 *   (b) stale-version       a row whose engine_version differs from the CURRENT ENGINE_VERSION (Rule 15/
 *                           C-177: a scan cached under an old engine version is not current evidence).
 *   (c) row-count           always emitted, informational only (never flips ok to false): how many rows
 *                           were scanned, so a human can sanity-check the reconciler actually ran.
 *
 * reconcile({sqlFn, engineVersion, table}) -> Promise<{ok, alarms:[{kind, slug, detail}]}>. PURE over the
 * injected sqlFn (the SAME discriminated {ok, rows} shape mint/persist.js's doors use - Rule 4: a
 * transport failure and an empty result are distinct states, C-170; a malformed response is never
 * silently read as "0 rows, clean"). sqlFn may reject/throw (a test double) or resolve {ok:false,...}
 * (the real Neon door's contract); either becomes a `query-failed` alarm and ok:false - reconcile()
 * itself never throws.
 *
 * CLI mode reads NEON_URL from env AT CALL TIME (via mint/persist.js's own exported defaultSqlFn door -
 * one door, not a second copy) and NEVER prints a connection string or any env value.
 *   node tools/mint-reconciler/reconcile.js     exit 0 clean, 1 real alarms, 2 broken (query failed).
 */
const { safeTable, DEFAULT_TABLE, defaultSqlFn } = require('../../mint/persist.js');
const { ENGINE_VERSION } = require('../../mint/version.js');

// reconcileQuery(table) -> the one read this whole reconciler needs: every row's identity + version +
// object-reference columns. safeTable validates the identifier (never a bound param, Rule 4/C-102-class
// discipline, reusing persist.js's own door rather than a second copy - Rule 1).
function reconcileQuery(table) {
  return 'SELECT url, slug, hash, engine_version, payload_json FROM ' + safeTable(table) + ' ORDER BY slug, hash';
}

// parsePayloadJson(v) -> the payload_json value as an object, or null. The Neon HTTP /sql door may return
// a jsonb column already object-shaped or as a JSON string depending on driver; both are accepted, and
// anything unparseable is null (never silently treated as "no marker present but fine").
function parsePayloadJson(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return null; /* FAIL-OPEN: malformed JSON is captured HERE as null, read downstream as "no r2 marker" - the safe (more scrutiny, not less) direction. */ }
  }
  return null;
}

function hasSlugHash(row) {
  return typeof row.slug === 'string' && row.slug.length > 0 && typeof row.hash === 'string' && row.hash.length > 0;
}
function hasR2Marker(row) {
  const pj = parsePayloadJson(row.payload_json);
  return Boolean(pj) && pj.r2 === true;
}

// hasPageReference(row) -> true only when the row's R2 object key is BOTH resolvable (slug+hash present)
// AND the row actually claims to point at one (payload_json.r2 === true). Either gap alone is enough to
// alarm - see reasonFor for the human-readable detail.
function hasPageReference(row) {
  return hasSlugHash(row) && hasR2Marker(row);
}

// reasonFor(row) -> the precise gap(s) a done-without-page row carries, joined for the alarm detail.
function reasonFor(row) {
  const parts = [];
  if (!(typeof row.slug === 'string' && row.slug.length)) parts.push('slug missing');
  if (!(typeof row.hash === 'string' && row.hash.length)) parts.push('hash missing');
  if (!hasR2Marker(row)) parts.push('payload_json.r2 !== true (unparseable, absent, or false)');
  return parts.join(', ') || 'unknown';
}

// rowLabel(row) -> the best identifier available for an alarm's `slug` field, or null when the row
// carries neither (the row-identification gap is itself part of the alarm's `detail`, never hidden).
function rowLabel(row) {
  return (row && (row.slug || row.url)) || null;
}

function checkDoneWithoutPage(rows) {
  const alarms = [];
  for (const row of rows) {
    if (hasPageReference(row)) continue;
    alarms.push({
      kind: 'done-without-page',
      slug: rowLabel(row),
      detail: 'row present in ' + '`audit_pages`' + ' (the only "done" claim this table can make) but its stored '
        + 'object reference is absent or malformed: ' + reasonFor(row) + ' (Rule 7/C-176: a row with no '
        + 'resolvable R2 object is a phantom mint).',
    });
  }
  return alarms;
}

function checkStaleVersion(rows, engineVersion) {
  const alarms = [];
  for (const row of rows) {
    if (row.engine_version === engineVersion) continue;
    alarms.push({
      kind: 'stale-version',
      slug: rowLabel(row),
      detail: 'row engine_version ' + JSON.stringify(row.engine_version) + ' != current ' + JSON.stringify(engineVersion)
        + ' (Rule 15/C-177: a row minted under an old engine version is not current evidence).',
    });
  }
  return alarms;
}

// rowCountInfo(rows) -> the always-present informational entry (never flips ok to false).
function rowCountInfo(rows) {
  return { kind: 'row-count', slug: null, detail: rows.length + ' row(s) scanned.' };
}

// isRealAlarm(a) -> true for the two actionable kinds; row-count is informational only.
function isRealAlarm(a) {
  return a.kind !== 'row-count';
}

// queryFailed(detail) -> the one shape every broken-query path returns (Rule 4: fail closed, never a
// silent "0 rows = clean"; C-170's "transport failure is a distinct state from empty" applied here).
function queryFailed(detail) {
  return { ok: false, alarms: [{ kind: 'query-failed', slug: null, detail }] };
}

/**
 * reconcile({sqlFn, engineVersion, table}) -> Promise<{ok, alarms}>. See file header for the full
 * contract. Defaults: engineVersion = this build's ENGINE_VERSION, table = DEFAULT_TABLE ('audit_pages'),
 * sqlFn = the real Neon door (persist.js's defaultSqlFn(process.env), reading NEON_URL at call time).
 */
async function reconcile({ sqlFn, engineVersion, table } = {}) {
  const ev = engineVersion || ENGINE_VERSION;
  const t = table || DEFAULT_TABLE;
  const fn = typeof sqlFn === 'function' ? sqlFn : defaultSqlFn(process.env);
  const query = reconcileQuery(t); // throws synchronously (an unsafe table identifier) - a config bug, not a soft alarm.

  let res;
  try {
    res = await fn(query, []);
  } catch (e) {
    // FAIL-OPEN: a throwing sqlFn (a hard transport error) is captured HERE as a typed query-failed
    // result, never propagated as an uncaught rejection (Rule 4: BLOCK, never crash past the caller).
    return queryFailed('sqlFn threw: ' + String((e && e.message) || e).slice(0, 200));
  }
  if (!res || res.ok !== true || !Array.isArray(res.rows)) {
    // A transport failure (ok:false) and a malformed response (rows not an array) are BOTH broken, never
    // coerced to an empty-but-clean table (C-170/C-243: validate fail-closed, a missing/wrong-shaped
    // field is an error, not an optional skip).
    return queryFailed('reconcile query failed: ' + ((res && res.error) || 'malformed or absent result (ok=' + (res && res.ok) + ')'));
  }

  const rows = res.rows;
  const alarms = [...checkDoneWithoutPage(rows), ...checkStaleVersion(rows, ev), rowCountInfo(rows)];
  return { ok: !alarms.some(isRealAlarm), alarms };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
function report(res, table, engineVersion) {
  console.log('  mint-reconciler: table=' + table + ' engine_version=' + engineVersion);
  for (const a of res.alarms) {
    const line = '  [' + a.kind.toUpperCase() + ']' + (a.slug ? ' ' + a.slug : '') + ': ' + a.detail;
    if (a.kind === 'row-count') console.log(line);
    else console.error(line);
  }
  console.log('  ' + (res.ok ? 'CLEAN' : 'ALARMS OPEN') + ': ' + res.alarms.filter(isRealAlarm).length + ' actionable alarm(s).');
}

// exitCodeFor(res) -> 2 when the reconciler itself could not run (query-failed: fail closed, Rule 4), 1
// when real alarms are open, 0 clean.
function exitCodeFor(res) {
  if (res.alarms.some((a) => a.kind === 'query-failed')) return 2;
  return res.ok ? 0 : 1;
}

async function runCli() {
  const table = process.env.MINT_TABLE || DEFAULT_TABLE;
  // defaultSqlFn(process.env) reads NEON_URL lazily, AT CALL TIME, inside the returned function - not
  // here at module load - and never logs/returns the connection string (Rule 16; see mint/persist.js).
  const res = await reconcile({ sqlFn: defaultSqlFn(process.env), engineVersion: ENGINE_VERSION, table });
  report(res, table, ENGINE_VERSION);
  return res;
}

if (require.main === module) {
  runCli().then(
    (res) => process.exit(exitCodeFor(res)),
    (e) => { process.stderr.write('mint-reconciler fatal: ' + String((e && e.stack) || e) + '\n'); process.exit(2); }
  );
}

module.exports = {
  reconcile,
  reconcileQuery,
  parsePayloadJson,
  hasPageReference,
  checkDoneWithoutPage,
  checkStaleVersion,
  rowCountInfo,
  exitCodeFor,
};
