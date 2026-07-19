'use strict';
// mint/compose-bundle.js - THE evidence-collection step of the live mint (Constitution Rule 9, C-037,
// C-041). It runs the four evidence lanes and assembles the ONE EvidenceBundle shape facts/ and breach/
// read, plus a stageManifest that records ran/skipped/reason for EVERY lane so a missing lane is VISIBLE,
// never a silent nothing (C-037/C-041: absence and breakage are never confused with "ran and found none").
//
//   composeBundle(url, opts) -> { bundle, stageManifest }
//     bundle = { domain, corpus, browser:{ observed, consentControl, domNodes, lane, domLane }, registers,
//                documents, telemetry }
//     stageManifest = [{ stage, ran, reason, ... }]  - one entry per lane, always.
//
// THE FOUR LANES, each self-bounded (Rule 9: a slow dependency degrades the mint, never hangs it):
//   crawl      evidence/crawler/crawl.js with the injected production fetchFn (mint/fetch.js). Its own
//              per-page + wall-clock deadlines apply; an unreachable site is recorded, never asserted from.
//   observe    evidence/browser/observe.js (the PECR pre-consent lane). launchBrowser defaults to the lazy
//              real Playwright adapter; ABSENT it records lane:{ran:false, reason:'playwright-unavailable'}
//              LOUDLY (C-041) - never a silent nothing, never a throw into the mint.
//   domAssert  evidence/browser/dom-assert.js (the axe-style DOM-fact lane). observe.js closes its own
//              browser and its PUBLIC opts expose neither the page nor an extra-evaluate hook, so sharing
//              ONE context is not achievable through the public interface without editing evidence/ (out of
//              this unit's scope). Per the brief this runs a SECOND observe-style BOUNDED launch and RECORDS
//              it in the manifest (stage 'domAssert', launch:'second-bounded-launch'): a visible, honest
//              second Chromium, never a hidden fork. Sharing one context is a future evidence/ hook (T-later).
//   registers  evidence/registers/registers.js. The env -> keys mapping is documented in registerKeys().
//
// All live-fetch/browser paths are dependency-injected (opts.fetchFn / opts.launchBrowser /
// opts.registersFetchFn), so node:test drives the whole assembler with fakes and no real socket/Chromium.

const crypto = require('crypto');
const { crawl } = require('../evidence/crawler/crawl.js');
const { observe } = require('../evidence/browser/observe.js');
const { domAssert } = require('../evidence/browser/dom-assert.js');
const { resolvePlaywrightLauncher } = require('../evidence/browser/playwright-adapter.js');
const { fetchRegisters } = require('../evidence/registers/registers.js');
const { raceWithDeadline } = require('../evidence/browser/deadline.js');
const safeFetch = require('../tools/lib/safe-fetch.js');
const { createFetchFn } = require('./fetch.js');

// Budgets (Rule 8: every one a CAP, never a floor). The mint's own per-lane ceilings; each lane also
// carries its module's internal cap and takes whichever is tighter. The crawl lane's own deadline comes
// from crawl.js's injected fetchFn (mint/fetch.js's perPageMs); this module does not add a second crawl
// ceiling on top of it today (CodeQL js/unused-local-variable removed the unwired CRAWL_DEADLINE_MS).
const OBSERVE_DEADLINE_MS = 45000;
const DOM_LANE_DEADLINE_MS = 25000; // wall-clock ceiling around the SECOND launch (launch+goto+assert+close)
const DOM_ASSERT_MS = 20000;
const REGISTER_DEADLINE_MS = 6000;

// normaliseOpts(opts) -> the injected surfaces + the clock, with production defaults. fetchFn defaults to
// the real safe http/https primitive; launchBrowser/registersFetchFn default to production transports.
function normaliseOpts(opts) {
  const o = opts || {};
  return {
    fetchFn: typeof o.fetchFn === 'function' ? o.fetchFn : createFetchFn({ deadlineMs: o.perPageMs }),
    launchBrowser: typeof o.launchBrowser === 'function' ? o.launchBrowser : null,
    fetchLink: typeof o.fetchLink === 'function' ? o.fetchLink : null,
    registersFetchFn: typeof o.registersFetchFn === 'function' ? o.registersFetchFn : makeRegistersFetch(REGISTER_DEADLINE_MS),
    env: o.env || process.env,
    now: typeof o.now === 'function' ? o.now : Date.now,
    log: typeof o.log === 'function' ? o.log : null,
    crawlOpts: o.crawlOpts || {},
  };
}

// registerKeys(env) -> the { companiesHouse, sra, cqc, fca, ico } key bag every register submodule reads
// (evidence/registers/lib/lookup-runner.js). The env -> keys mapping, documented per key (Rule 16: only
// NAMES appear here; the values live in env and never on any object this module returns or logs):
//   COMPANIES_HOUSE_API_KEY -> keys.companiesHouse  (HTTP Basic username; Companies House free self-service key)
//   SRA_API_KEY             -> keys.sra             (Solicitors Regulation Authority opt-in HTML/API token)
//   CQC_API_KEY             -> keys.cqc.apiKey      (Care Quality Commission subscription key; mandatory)
//   CQC_PARTNER_CODE        -> keys.cqc.partnerCode (CQC partner code; OPTIONAL, absence is a normal call)
//   FCA_API_EMAIL           -> keys.fca.email       (FCA Register API developer email)
//   FCA_API_KEY             -> keys.fca.key         (FCA Register API key; both email+key required together)
//   ICO_MIRROR_URL          -> keys.ico             (base URL of a JSON mirror of the ICO register; no free
//                                                    real-time ICO API exists, so this lane degrades loudly absent it)
function registerKeys(env) {
  const e = env || {};
  return {
    companiesHouse: e.COMPANIES_HOUSE_API_KEY,
    sra: e.SRA_API_KEY,
    cqc: { apiKey: e.CQC_API_KEY, partnerCode: e.CQC_PARTNER_CODE },
    fca: { email: e.FCA_API_EMAIL, key: e.FCA_API_KEY },
    ico: e.ICO_MIRROR_URL,
  };
}

// makeRegistersFetch(deadlineMs) -> the default register fetchFn (url, {headers}) -> {status, json}|null.
// The register URLs are built by the register submodules from FIXED, well-known public API bases (never an
// attacker-controlled host, unlike the crawl target), so the SSRF door here is the parsed-host check on
// that fixed host plus a hard AbortSignal deadline (Rule 9); lookup-runner.js also wraps every call in its
// own withDeadline. A non-JSON / errored body yields json:null so lookup-runner records a loud degraded note.
function makeRegistersFetch(deadlineMs) {
  return async function registersFetch(url, options) {
    const u = safeFetch.parseSafeFetchTarget(url);
    if (!u) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      const res = await fetch(u.href, { method: 'GET', headers: (options && options.headers) || {}, signal: controller.signal });
      let json = null;
      try { json = await res.json(); }
      catch (_e) { json = null; /* FAIL-OPEN: a non-JSON register body is a degraded response, not a throw; lookup-runner reads status + json:null and records a loud note (C-041). */ }
      return { status: res.status, json };
    } catch (_e) {
      return null; // FAIL-OPEN: a network throw/abort is a degraded lane, not a mint-killer; null -> lookup-runner's loud degraded note (Rule 9/C-041).
    } finally {
      clearTimeout(timer);
    }
  };
}

// ── lane runners (each records ran/skipped/reason on the manifest; none throws into the mint) ─────────
// runCrawlLane(domain, cfg, manifest) -> { corpus, documents, telemetry }. crawl.js is self-bounded and
// returns an unreachable bundle (empty corpus) rather than throwing on a bot-wall/SPA-shell; a genuine
// throw (an unfetchable domain shape) is caught and recorded as an errored lane with an empty corpus.
async function runCrawlLane(domain, cfg, manifest) {
  try {
    const res = await crawl(domain, Object.assign({ fetchFn: cfg.fetchFn, now: cfg.now, log: (kind, msg) => safeLog(cfg.log, { stage: 'crawl', kind, msg }) }, cfg.crawlOpts));
    const pages = res.corpus && Array.isArray(res.corpus.pages) ? res.corpus.pages.length : 0;
    manifest.push({ stage: 'crawl', ran: true, reason: res.reason || null, unreachable: Boolean(res.unreachable), pages });
    return { corpus: res.corpus || { pages: [] }, documents: res.documents || { records: [], unparsed: [] }, telemetry: res.telemetry || {} };
  } catch (e) {
    // FAIL-OPEN: a crawl construction throw (an unfetchable domain shape) degrades to an empty corpus
    // RECORDED on the manifest (facts then abstain -> the ICP gate refuses); it never throws into the mint.
    manifest.push({ stage: 'crawl', ran: false, reason: 'error', message: String((e && e.message) || e).slice(0, 160) });
    return { corpus: { pages: [] }, documents: { records: [], unparsed: [] }, telemetry: {} };
  }
}

// runObserveLane(url, cfg, manifest) -> { observed, consentControl, lane }. observe() never throws and
// records its own lane:{ran,reason} (playwright-unavailable/deadline/error/ran); this only threads the
// injected launcher + clock and mirrors the lane's outcome onto the manifest (C-041).
async function runObserveLane(url, cfg, manifest) {
  const res = await observe(url, { launchBrowser: cfg.launchBrowser || undefined, fetchLink: cfg.fetchLink || undefined, deadlineMs: OBSERVE_DEADLINE_MS, now: cfg.now });
  manifest.push({ stage: 'observe', ran: Boolean(res.lane && res.lane.ran), reason: (res.lane && res.lane.reason) || null, observed: Array.isArray(res.observed) ? res.observed.length : 0 });
  return { observed: res.observed || [], consentControl: res.consentControl || { found: false }, lane: res.lane || { ran: false, reason: 'no-lane' } };
}

// domLanePipeline(url, launch, cfg, holder) -> the second bounded launch: launch -> newPage -> goto ->
// domAssert -> close. `launch` is a LOCAL alias of the resolved launcher; the whole pipeline is bounded by
// raceWithDeadline in runDomLane (Rule 9), and the browser is force-closed on every exit path (the 752s
// hostage class stays impossible even on this second launch).
async function domLanePipeline(url, launch, cfg, holder) {
  const browser = await launch();
  holder.browser = browser;
  const page = await browser.newPage();
  await page.goto(url);
  const dom = await domAssert(page, { deadlineMs: DOM_ASSERT_MS, now: cfg.now });
  await browser.close();
  holder.browser = null;
  return dom;
}

// forceClose(holder, cfg) -> bounded best-effort close of a browser left open by a timed-out/errored
// pipeline. A browser that will not close cannot block the mint (the runner is ephemeral); recorded, never
// rethrown (Rule 4 FAIL-OPEN justification).
async function forceClose(holder, cfg) {
  const browser = holder.browser;
  holder.browser = null;
  if (!browser || typeof browser.close !== 'function') return;
  try { await raceWithDeadline(Promise.resolve().then(() => browser.close()), 5000, cfg.now); }
  catch (e) {
    // FAIL-OPEN: a browser that will not close cannot block the mint (the runner is ephemeral and reaps the
    // process); the failure is RECORDED to the log and never rethrown into the mint (Rule 4).
    safeLog(cfg.log, { stage: 'domAssert', kind: 'force-close-failed', msg: String((e && e.message) || e).slice(0, 120) });
  }
}

// runDomLane(url, cfg, manifest) -> { nodes, lane }. The SECOND bounded launch, recorded on the manifest.
// A launcher that will not resolve (no injected browser, no Playwright driver) records the lane unavailable
// LOUDLY (C-041) without attempting a launch. Never throws into the mint (Rule 4).
async function runDomLane(url, cfg, manifest) {
  const launch = typeof cfg.launchBrowser === 'function' ? cfg.launchBrowser : await resolvePlaywrightLauncher({ now: cfg.now });
  if (typeof launch !== 'function') {
    manifest.push({ stage: 'domAssert', ran: false, reason: 'playwright-unavailable', launch: 'second-bounded-launch (not attempted: no launcher)' });
    return { nodes: [], lane: { ran: false, reason: 'playwright-unavailable' } };
  }
  const holder = { browser: null };
  let result;
  try {
    const raced = await raceWithDeadline(domLanePipeline(url, launch, cfg, holder), DOM_LANE_DEADLINE_MS, cfg.now);
    result = raced.timedOut ? { nodes: [], lane: { ran: false, reason: 'deadline', elapsedMs: raced.elapsed } } : raced.value;
  } catch (e) {
    // FAIL-OPEN: (Rule 4) a launch/goto/evaluate failure degrades the DOM lane to a recorded error, never
    // throws into the mint. domAssert itself already records evaluate faults; this catches launch/goto.
    result = { nodes: [], lane: { ran: false, reason: 'error', message: String((e && e.message) || e).slice(0, 160) } };
  } finally {
    await forceClose(holder, cfg);
  }
  manifest.push({ stage: 'domAssert', ran: Boolean(result.lane && result.lane.ran), reason: (result.lane && result.lane.reason) || null, launch: 'second-bounded-launch', nodes: Array.isArray(result.nodes) ? result.nodes.length : 0 });
  return result;
}

// runRegisterLane(domain, cfg, manifest) -> the EvidenceBundle.registers object. fetchRegisters searches
// UK registers by a domain-derived query (identity is resolved AFTER the bundle, so no company-name hint is
// available at this point; a richer hint is a future two-pass design). It never throws for a degraded lane
// (each records a loud note); a missing fetchFn is the one throw, caught and recorded here.
async function runRegisterLane(domain, cfg, manifest) {
  try {
    const registers = await fetchRegisters({ domain }, {
      fetchFn: cfg.registersFetchFn, deadlineMs: REGISTER_DEADLINE_MS, keys: registerKeys(cfg.env),
      log: (note) => safeLog(cfg.log, { stage: 'registers', note }),
    });
    const matched = Object.keys(registers).filter((k) => k !== 'notes');
    manifest.push({ stage: 'registers', ran: true, matched, notes: Array.isArray(registers.notes) ? registers.notes.length : 0 });
    return registers;
  } catch (e) {
    // FAIL-OPEN: the one register throw is a missing fetchFn; it degrades to an empty register set RECORDED
    // on the manifest (propose then abstains on register duties), never a throw into the mint (C-041).
    manifest.push({ stage: 'registers', ran: false, reason: 'error', message: String((e && e.message) || e).slice(0, 160) });
    return { notes: [] };
  }
}

function safeLog(log, event) {
  if (typeof log !== 'function') return;
  try { log(event); }
  catch (_e) { /* FAIL-OPEN: observability logging never breaks bundle assembly; a broken sink is not an evidence failure. */ }
}

// bundleId(domain, now) -> a short correlation id for this assembly (observability only, never a fact).
function bundleId(domain, now) {
  return crypto.createHash('sha1').update(String(domain) + '|' + String(now())).digest('hex').slice(0, 12);
}

/**
 * composeBundle(url, opts) -> Promise<{ bundle, stageManifest }>. Runs all four evidence lanes and
 * assembles the EvidenceBundle. Every lane records ran/skipped/reason on stageManifest (C-037/C-041); a
 * lane that could not run is VISIBLE there, never a silent empty surface. Never throws into the caller.
 *
 * opts.fetchFn           the crawl fetchFn (default the real safe http/https primitive, mint/fetch.js).
 * opts.launchBrowser     the browser factory for observe + the domAssert second launch (default: the lazy
 *                        real Playwright adapter; absent -> both browser lanes record unavailable LOUDLY).
 * opts.registersFetchFn  the register fetchFn (default a signal-bounded fetch over the fixed register hosts).
 * opts.env               env for the register key bag (default process.env; values never leave env, Rule 16).
 * opts.now / opts.log    injected clock + optional observability sink (both optional).
 */
async function composeBundle(url, opts) {
  const cfg = normaliseOpts(opts);
  const domain = safeFetch.inputHost(url);
  const manifest = [];
  const started = cfg.now();

  const crawlLane = await runCrawlLane(domain, cfg, manifest);
  const observeLane = await runObserveLane(url, cfg, manifest);
  const domLane = await runDomLane(url, cfg, manifest);
  const registers = await runRegisterLane(domain, cfg, manifest);

  const bundle = {
    domain,
    corpus: crawlLane.corpus,
    browser: {
      observed: observeLane.observed,
      consentControl: observeLane.consentControl,
      lane: observeLane.lane,
      domNodes: domLane.nodes,
      domLane: domLane.lane,
    },
    registers,
    documents: crawlLane.documents,
    telemetry: Object.assign({}, crawlLane.telemetry, { bundle_id: bundleId(domain, cfg.now), assembled_ms: cfg.now() - started }),
  };
  return { bundle, stageManifest: manifest };
}

module.exports = {
  composeBundle,
  registerKeys,
  makeRegistersFetch,
  // exported for the node:test suite (lane runners over injected inputs; never fact producers):
  runCrawlLane,
  runObserveLane,
  runDomLane,
  runRegisterLane,
  normaliseOpts,
};
