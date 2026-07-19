'use strict';
// mint/post-write-assertions.js - THE done-gate of the live mint (Constitution Rule 7, Rule 17, C-102/
// C-103/C-249). "Minted" means ALL THREE of: the DB row exists (read back), the live URL answers 200, and
// the Playwright truth-pass proves the rendered words match the payload. Anything less is NOT done, whatever
// the queue says. The old queue reported "done" on 1,004 PHANTOM audits; a transport failure masqueraded as
// an idempotent conflict and a row that was never written was hunted for days. This module makes that class
// structurally impossible: `done:true` is returned ONLY when every leg is green; otherwise `done:false` with
// a state that NAMES the failing leg, and the caller never flips a queue row to done on it.
//
//   assertMinted({ row, payload, liveUrl, opts }) -> { done, state, checks }
//     checks = { rowReadBack, live200, truthPack }  - each { ok, ... } with its own reason on failure.
//     state in:
//       'row_missing'            the row read-back returned no matching (slug,hash) row, or a STALE
//                                engine_version (C-103/C-177): the write did not land as this engine's row.
//       'unreachable'            the row is there but the live audit URL did not answer 200 (C-102).
//       'minted_pending_render'  row + 200 are green but the render truth-pack has NOT landed yet (T3b): the
//                                CURRENT expected terminal state - a mint is real but not yet render-proven,
//                                so it is DELIBERATELY not done (Rule 7: the truth-pass is mandatory).
//       'render_mismatch'        the truth-pack ran and FAILED (a rendered word did not match the payload).
//       'done'                   all three green - the ONLY state that carries done:true.
//
// The row read-back and the live check are DEPENDENCY-INJECTED (opts.sqlFn / opts.liveFetch) so node:test
// proves each failure leg with no network; the truth-pack is injectable too (opts.truthPackFn) AND falls
// back to a real presence probe of render-proof/truth-pack.spec.js, which does not exist until T3b.

const fs = require('fs');
const path = require('path');
const { parseSafeFetchTarget } = require('../tools/lib/safe-fetch.js');
const { ENGINE_VERSION } = require('./version.js');
const { defaultSqlFn, safeTable, DEFAULT_TABLE } = require('./persist.js');

const LIVE_DEADLINE_MS = 10000; // a CAP on the live-200 probe (Rule 8/9).
const TRUTH_PACK_REL = path.join('render-proof', 'truth-pack.spec.js');

// ── (a) row read-back: prove the row exists AND is THIS engine's version (never a stale-version row) ──
// rowQuery(table) -> the parameterised read-back by (slug, hash) - the SAME key the website read serves,
// so a read-back hit is proof the exact live page has a backing row (C-103). engine_version is returned so
// a stale-version row (C-177) is caught, not silently accepted.
function rowQuery(table) {
  return 'SELECT slug, hash, engine_version FROM ' + safeTable(table) + ' WHERE slug=$1 AND hash=$2 LIMIT 1';
}
// readBackRow(row, opts) -> { ok, reason?, engine_version? }. ok ONLY when a row comes back AND its
// engine_version equals THIS engine's version (Rule 15/C-177: a stale-version row is not a valid mint).
async function readBackRow(row, opts) {
  const table = opts.table || (opts.env && opts.env.MINT_TABLE) || DEFAULT_TABLE;
  const sqlFn = typeof opts.sqlFn === 'function' ? opts.sqlFn : defaultSqlFn(opts.env || process.env);
  const res = await sqlFn(rowQuery(table), [row.slug, row.hash]);
  if (!res || !res.ok) return { ok: false, reason: 'row read-back query failed (' + ((res && res.error) || 'no result') + '); the write cannot be confirmed (C-103)' };
  const found = Array.isArray(res.rows) ? res.rows[0] : null;
  if (!found) return { ok: false, reason: 'no row for (slug=' + row.slug + ', hash=' + row.hash + '); the row was never written (the phantom-row class, C-103)' };
  if (found.engine_version !== ENGINE_VERSION) return { ok: false, reason: 'row engine_version ' + JSON.stringify(found.engine_version) + ' != ' + ENGINE_VERSION + ' (a stale-version row, C-177)' };
  return { ok: true, engine_version: found.engine_version };
}

// ── (b) live 200: the audit URL must actually answer 200 ──────────────────────────────────────────────
// liveCheck(liveUrl, opts) -> { ok, status, reason? }. Injected liveFetch (tests) or a real signal-bounded
// fetch routed through the SSRF door (Rule 9). A non-200 / throw is a failed leg, never a thrown mint.
async function liveCheck(liveUrl, opts) {
  const target = parseSafeFetchTarget(liveUrl);
  if (!target) return { ok: false, status: 0, reason: 'live URL is unsafe or unparseable: ' + String(liveUrl).slice(0, 120) };
  const liveFetch = typeof opts.liveFetch === 'function' ? opts.liveFetch : defaultLiveFetch;
  const res = await liveFetch(target.href);
  const status = res && Number(res.status);
  if (status === 200) return { ok: true, status: 200 };
  return { ok: false, status: status || 0, reason: 'live audit URL answered ' + (status || 'no status') + ', not 200 (C-102)' };
}
// defaultLiveFetch(url) -> { status } under a hard AbortSignal deadline (Rule 9). A throw resolves to
// { status:0 } (a failed leg), never a thrown mint.
async function defaultLiveFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_DEADLINE_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  try { const r = await fetch(url, { method: 'GET', signal: controller.signal }); return { status: r.status }; }
  catch (e) { return { status: 0, error: String((e && e.message) || e).slice(0, 120) }; }
  finally { clearTimeout(timer); }
}

// ── (c) truth-pack: the render truth-pass (T3b). Injected checker (tests) OR a real presence probe. ──
// truthPackCheck(payload, opts) -> { ok, ran, reason? }. An injected opts.truthPackFn is authoritative
// (tests use it to prove the done:true and render_mismatch legs). Absent, this PROBES for
// render-proof/truth-pack.spec.js: while it does not exist (the reality until T3b lands), the check is
// { ran:false, ok:false, reason:'render-proof not landed (T3b)' } and the mint stays minted_pending_render.
async function truthPackCheck(payload, opts) {
  if (typeof opts.truthPackFn === 'function') {
    const r = await opts.truthPackFn(payload);
    return { ok: Boolean(r && r.ok), ran: true, reason: (r && r.reason) || (r && r.ok ? null : 'truth-pack reported a render mismatch') };
  }
  const abs = path.join(__dirname, '..', TRUTH_PACK_REL);
  if (!fs.existsSync(abs)) return { ok: false, ran: false, reason: 'render-proof not landed (T3b)' };
  // The spec exists but this unit does not own its invocation contract (T3b): record it present-but-not-run
  // rather than guess an API. done stays false (Rule 7) until T3b wires the invocation here.
  return { ok: false, ran: false, reason: 'render-proof/truth-pack.spec.js present but its invocation contract is owned by T3b; not run here' };
}

// stateFor(checks) -> the single terminal state, naming the FIRST failing leg in write-order (row, then
// live, then render). done:true is returned ONLY when every leg is green (Rule 7).
function stateFor(checks) {
  if (!checks.rowReadBack.ok) return 'row_missing';
  if (!checks.live200.ok) return 'unreachable';
  if (!checks.truthPack.ok) return checks.truthPack.ran ? 'render_mismatch' : 'minted_pending_render';
  return 'done';
}

/**
 * assertMinted({ row, payload, liveUrl, opts }) -> Promise<{ done, state, checks }>. Runs the three
 * mandatory post-write checks and returns done:true ONLY when all three are green. Never throws: a failing
 * leg is a recorded { ok:false } and a named non-done state, so a mint NEVER flips done on a missing leg
 * (the phantom-data class, Rule 7/C-249). `opts` = { sqlFn?, liveFetch?, truthPackFn?, table?, env? }.
 */
async function assertMinted({ row, payload, liveUrl, opts } = {}) {
  const o = opts || {};
  const checks = {
    rowReadBack: await readBackRow(row || {}, o),
    live200: await liveCheck(liveUrl, o),
    truthPack: await truthPackCheck(payload, o),
  };
  const state = stateFor(checks);
  return { done: state === 'done', state, checks };
}

module.exports = {
  assertMinted,
  readBackRow,
  liveCheck,
  truthPackCheck,
  stateFor,
  rowQuery,
  TRUTH_PACK_REL,
  LIVE_DEADLINE_MS,
};
