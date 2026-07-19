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
// proves each failure leg with no network; the truth-pack is injectable too (opts.truthPackFn) AND, absent
// that seam, runs the REAL render-proof/truth-pack.js checker against opts.renderedText (T3b landed). Without
// a truthPackFn AND without renderedText there is no live page text to assert, so the leg is honestly NOT RUN
// (ran:false) and the mint stays minted_pending_render (Rule 7: done is withheld, never faked).

const fs = require('fs');
const path = require('path');
const { parseSafeFetchTarget } = require('../tools/lib/safe-fetch.js');
const { ENGINE_VERSION } = require('./version.js');
const { defaultSqlFn, safeTable, DEFAULT_TABLE } = require('./persist.js');

const LIVE_DEADLINE_MS = 10000; // a CAP on the live-200 probe (Rule 8/9).
const TRUTH_PACK_REL = path.join('render-proof', 'truth-pack.spec.js'); // the render-truth lane harness (the named ledger gate)
const TRUTH_PACK_MODULE_REL = path.join('render-proof', 'truth-pack.js'); // the PURE checker this unit invokes

// ── (a) row read-back: prove the row exists AND is THIS engine's version (never a stale-version row) ──
// rowQuery(table) -> the parameterised read-back by (slug, hash) - the SAME key the website read serves,
// so a read-back hit is proof the exact live page has a backing row (C-103). The engine version is read as
// `payload_json->>'engine_version'` - the SAME expression the live BEFORE-INSERT trigger gates on, NOT a
// column (audit_pages has no engine_version column) - and aliased to `engine_version` so a stale-version
// row (C-177) is caught, not silently accepted. The `'engine_version'` JSON key is a fixed literal, never
// user input, so it carries no injection surface; only the table stays a validated identifier.
function rowQuery(table) {
  return "SELECT slug, hash, payload_json->>'engine_version' AS engine_version FROM " + safeTable(table) + ' WHERE slug=$1 AND hash=$2 LIMIT 1';
}
// readBackRow(row, opts) -> { ok, reason?, engine_version? }. ok ONLY when a row comes back AND its
// engine_version (read off the payload_json marker) equals THIS engine's version (Rule 15/C-177: a
// stale-version row is not a valid mint).
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
  catch (e) {
    // FAIL-OPEN: a live-check throw/abort becomes a typed { status:0 } (a failed leg), so stateFor reports
    // 'unreachable' and done stays false; it never throws into the mint (Rule 7/9).
    return { status: 0, error: String((e && e.message) || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// ── (c) truth-pack: the render truth-pass (Rule 7 / C-124). Three sources, in priority order. ─────────────
// truthPackCheck(payload, opts) -> { ok, ran, reason? }.
//   1. opts.truthPackFn (authoritative): the live orchestrator captures the browser-extracted page text and
//      wires it into a closure here at run time (the injection seam mint/index.js forwards). Tests use it to
//      drive the done:true and render_mismatch legs directly. THE SEAM IS PRESERVED - it wins when present.
//   2. else, render-proof/truth-pack.js (the pure checker) + opts.renderedText: run the REAL pack against the
//      supplied live page text. This is the default path now T3b has landed.
//   3. else: honestly NOT RUN. Without a truthPackFn AND without renderedText there is no page text to
//      assert, so the leg stays { ran:false } and the mint stays minted_pending_render (Rule 7: done is
//      withheld, never faked).
async function truthPackCheck(payload, opts) {
  if (typeof opts.truthPackFn === 'function') {
    const r = await opts.truthPackFn(payload);
    return { ok: Boolean(r && r.ok), ran: true, reason: (r && r.reason) || (r && r.ok ? null : 'truth-pack reported a render mismatch') };
  }
  const abs = path.join(__dirname, '..', TRUTH_PACK_MODULE_REL);
  if (!fs.existsSync(abs)) return { ok: false, ran: false, reason: 'render-proof not landed (T3b)' };
  if (typeof opts.renderedText !== 'string' || opts.renderedText === '') {
    // Honest NOT-RUN: the pack exists but no live page text was captured for THIS mint. Leads with the real
    // reason (renderedText not supplied) and keeps the contiguous 'render-proof not landed for this mint'
    // marker so the render proof's absence for this mint reads uniformly to every consumer of this leg.
    return { ok: false, ran: false, reason: 'renderedText not supplied to truthPackCheck; render-proof not landed for this mint (pass opts.renderedText to run the real render pack)' };
  }
  return runRealTruthPack(abs, payload, opts);
}

// payloadDate(payload) -> the payload's own generatedAt stamp (meta.date), the default source for the render
// freshness check ('opts.generatedAt is the payload's'); undefined when the payload carries none.
function payloadDate(payload) { return payload && payload.meta && payload.meta.date != null ? payload.meta.date : undefined; }

// runRealTruthPack(abs, payload, opts) -> the pure checker's verdict as { ok, ran:true, reason }. generatedAt
// defaults to the payload's own date; the injected clock (opts.now), catalogue and HMAC opts pass through
// untouched. A checker that fails to load OR throws is recorded as a ran-but-FAILED leg (render_mismatch),
// never a thrown mint (Rule 7/17): a broken render gate is not a pass.
function runRealTruthPack(abs, payload, opts) {
  let checker;
  try { checker = require(abs); }
  catch (e) {
    // FAIL-OPEN: a truth-pack module that will not load is a broken render gate, not a pass. Recorded as a
    // ran-but-failed leg so done stays false; never a thrown mint (Rule 7/17).
    return { ok: false, ran: true, reason: 'render-proof/truth-pack.js failed to load: ' + String((e && e.message) || e).slice(0, 120) };
  }
  const checkOpts = Object.assign({}, opts, { generatedAt: opts.generatedAt != null ? opts.generatedAt : payloadDate(payload) });
  try {
    const r = checker.check(payload, opts.renderedText, checkOpts);
    if (r && r.ok) return { ok: true, ran: true, reason: null };
    const first = r && Array.isArray(r.violations) ? r.violations[0] : null;
    const n = r && Array.isArray(r.violations) ? r.violations.length : 0;
    return { ok: false, ran: true, reason: 'render truth-pack found ' + n + ' violation(s)' + (first ? ': [' + first.rule + '] ' + first.detail : '') };
  } catch (e) {
    // FAIL-OPEN: a throw inside the pure checker is a broken gate, recorded as a failed (not passed) leg so
    // done stays false; never a thrown mint (Rule 7/17). The pure checker is written not to throw; this is
    // defence in depth around the require boundary.
    return { ok: false, ran: true, reason: 'render truth-pack threw: ' + String((e && e.message) || e).slice(0, 120) };
  }
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
  TRUTH_PACK_MODULE_REL,
  LIVE_DEADLINE_MS,
};
