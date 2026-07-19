'use strict';
// probes/pagespeed.js - REAL Google PageSpeed Insights v5 + Chrome UX Report (CrUX) probe.
//
// Faithful port of the old estate's producer: cowork-os-fresh src/lib/audit/site-scan.js
// `_pageSpeedOne` (PSI v5 fetch + `_parsePsi` parse) and `_cruxOne` (CrUX field-data fallback), called
// together as `pageSpeed()`. Same endpoints, same query shape, same parsed leaf names (perf/seo/lcp_ms/
// cls/tbt_ms/fcp_ms/scores/cwv/audits) so a downstream consumer reading this probe's output reads the
// exact same field names the old estate's renderer (`_adapter.js`) already knew how to bind.
//
// DELIBERATE DEVIATION from the old estate (documented, not hidden): the old producer retried each
// strategy up to 2x at 55s per attempt (up to ~113s worst case) to ride out slow corporate sites. This
// engine's Constitution Rule 9 (caution.md C-138) forbids exactly that retry-storm shape at the shared
// primitive level - "one attempt per provider, then fall over". This probe therefore makes ONE
// deadline-bounded attempt per strategy; a slow/heavy site degrades honestly to `probe_unavailable`
// (or the CrUX field-data fallback) rather than holding the mint hostage for up to two minutes. The
// PARSED OUTPUT SHAPE is unchanged; only the retry policy is tightened to this repo's stricter budget
// discipline.
//
// Key gate: PAGESPEED_API_KEY (free tier). No key -> { ok:false, reason:'no_key' }, never a fabricated
// score (Rule 10: absence is honest, never dressed as a measured zero).

const { fetchJson, cleanDomain } = require('./lib/net.js');

const PSI_DEADLINE_MS = 25000; // one attempt, one strategy (Rule 8: a cap, not the old estate's 55s x2).
const CRUX_DEADLINE_MS = 10000;

// parsePsi(json, strategy) -> the parsed per-strategy leaf, or null on a malformed/absent lighthouseResult.
// Field names match the old producer's `_parsePsi` exactly (perf/seo/lcp_ms/cls/tbt_ms/fcp_ms/scores/cwv/audits).
function parsePsi(json, strategy) {
  const lr = json && json.lighthouseResult;
  if (!lr || !lr.audits) return null;
  const cats = lr.categories || {};
  const a = lr.audits || {};
  const num = (id) => (a[id] && typeof a[id].numericValue === 'number') ? a[id].numericValue : null;
  const sc = (c) => (cats[c] && typeof cats[c].score === 'number') ? cats[c].score : null;
  const cwv = {
    lcp_ms: num('largest-contentful-paint'),
    inp_ms: num('interaction-to-next-paint') || num('experimental-interaction-to-next-paint') || null,
    cls: num('cumulative-layout-shift'), fcp_ms: num('first-contentful-paint'), tbt_ms: num('total-blocking-time'),
  };
  const audits = Object.values(a)
    .filter((x) => x && typeof x.score === 'number' && x.score < 0.9 && ['binary', 'numeric', 'metricSavings'].includes(x.scoreDisplayMode))
    .slice(0, 40)
    .map((x) => ({ id: x.id, title: x.title || '', score: x.score, displayValue: x.displayValue || '' }));
  return {
    strategy: strategy || 'mobile', source: 'lab',
    perf: sc('performance'), seo: sc('seo'), lcp_ms: cwv.lcp_ms, cls: cwv.cls, tbt_ms: cwv.tbt_ms, fcp_ms: cwv.fcp_ms,
    scores: { performance: sc('performance'), accessibility: sc('accessibility'), 'best-practices': sc('best-practices'), seo: sc('seo') },
    cwv, audits,
  };
}

// pageSpeedOne(domain, key, strategy) -> one strategy's parsed result, or null (no key / fetch failure /
// malformed response). ONE attempt (see file header deviation note).
async function pageSpeedOne(domain, key, strategy) {
  if (!key) return null;
  const url = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
    + '?url=' + encodeURIComponent('https://' + domain)
    + '&strategy=' + strategy + '&category=performance&category=seo&category=accessibility&category=best-practices'
    + '&key=' + encodeURIComponent(key);
  const r = await fetchJson(url, { deadlineMs: PSI_DEADLINE_MS });
  if (!r.ok) return null;
  return parsePsi(r.json, strategy);
}

// cruxP75(metrics, key) -> the p75 numeric value for a CrUX metric key, tolerant of both a number and a
// numeric string (the live API has returned both historically).
function cruxP75(metrics, key) {
  const v = metrics && metrics[key] && metrics[key].percentiles && metrics[key].percentiles.p75;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// cruxOne(domain, key, strategy) -> real-user CrUX field data for the strategy, or null. Fallback path
// for whichever strategy the lab (Lighthouse) test could not produce (site too heavy/slow within budget).
async function cruxOne(domain, key, strategy) {
  if (!key) return null;
  const formFactor = strategy === 'desktop' ? 'DESKTOP' : 'PHONE';
  const url = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=' + encodeURIComponent(key);
  for (const body of [{ url: 'https://' + domain, formFactor }, { origin: 'https://' + domain, formFactor }]) {
    const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), deadlineMs: CRUX_DEADLINE_MS });
    if (!r.ok) continue;
    const m = r.json && r.json.record && r.json.record.metrics;
    if (!m) continue;
    const cwv = { lcp_ms: cruxP75(m, 'largest_contentful_paint'), inp_ms: cruxP75(m, 'interaction_to_next_paint') || cruxP75(m, 'experimental_interaction_to_next_paint'), cls: cruxP75(m, 'cumulative_layout_shift'), fcp_ms: cruxP75(m, 'first_contentful_paint'), tbt_ms: null };
    if (cwv.lcp_ms == null && cwv.cls == null && cwv.fcp_ms == null) continue;
    return { strategy, source: 'crux-field', perf: null, seo: null, lcp_ms: cwv.lcp_ms, cls: cwv.cls, tbt_ms: null, fcp_ms: cwv.fcp_ms, scores: { performance: null, accessibility: null, 'best-practices': null, seo: null }, cwv, audits: [] };
  }
  return null;
}

// pagespeedProbe({domain, env, deadlineMs}) -> { ok, mobile, desktop } | { ok:false, reason }. Runs both
// strategies in parallel (as the old producer did) so a mobile-only or desktop-only failure still yields
// a usable result; falls back to CrUX field data for whichever strategy the lab test could not produce.
async function pagespeedProbe({ domain, env = {} } = {}) {
  const key = env.PAGESPEED_API_KEY || null;
  if (!key) return { ok: false, reason: 'no_key' };
  const dom = cleanDomain(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  let [mobile, desktop] = await Promise.all([pageSpeedOne(dom, key, 'mobile'), pageSpeedOne(dom, key, 'desktop')]);
  if (!mobile || !desktop) {
    const [cm, cd] = await Promise.all([
      mobile ? Promise.resolve(null) : cruxOne(dom, key, 'mobile'),
      desktop ? Promise.resolve(null) : cruxOne(dom, key, 'desktop'),
    ]);
    mobile = mobile || cm; desktop = desktop || cd;
  }
  if (!mobile && !desktop) return { ok: false, reason: 'no_data' };
  return { ok: true, mobile: mobile || null, desktop: desktop || null };
}

module.exports = { pagespeedProbe, parsePsi, pageSpeedOne, cruxOne };
