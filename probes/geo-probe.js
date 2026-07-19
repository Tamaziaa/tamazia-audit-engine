'use strict';
// probes/geo-probe.js - REAL multi-sample AI share-of-voice probe. Faithful port of the old estate's
// producer: cowork-os-fresh src/lib/audit/geo-probe.js `geoProbe`. Asks a real buyer query N times and
// measures how often the firm is named by a free LLM, plus which named competitors dominate the answer.
//
// PROVIDER CHAIN (mission instruction: "reuse the new engine's LLM router as the provider chain"): this
// probe calls llm/router.js `route()` over llm/providers/chain.js `buildChain()` - the SAME free-first
// Groq -> NIM -> Gemini -> Cloudflare estate the compliance adjudicator uses, rather than duplicating a
// second raw-https LLM client (the old producer's own src/lib/audit/llm.js). This gets Rule 9's hard
// per-call deadline and Rule 16's "keys read fresh at call time, never stored" for free, and means the
// prompt/response shape follows this repo's structured-JSON doctrine (Rule 11/12: every call asks for
// and parses strict JSON, never free-text comma-splitting as the old producer did).
//
// GROUNDED CITATIONS (real Google-grounded sources): llm/router.js's chain has no `tools` support (it
// is built for single-shot structured extraction), so the ONE piece of this probe that needs Gemini's
// `google_search` grounding tool - the real cited-source layer - makes its own single, deadline-bounded
// Gemini call directly, gated on GEMINI_API_KEY, exactly mirroring the old producer's
// `askGeminiGrounded`. This is the sole network call in this probe that does not go through the router.

const { route } = require('../llm/router.js');
const { buildChain } = require('../llm/providers/chain.js');
const { fetchJson } = require('./lib/net.js');
const { isSameHost } = require('../tools/lib/safe-fetch.js'); // reuse the one-door host comparator

const AGG = /(yell|yelp|tripadvisor|trustpilot|clutch|glassdoor|indeed|linkedin|facebook|instagram|wikipedia|reddit|quora|google|bing|youtube)/i;

function normName(s) {
  return String(s || '').toLowerCase().replace(/\b(llp|ltd|limited|inc|plc|solicitors|law firm|associates|group)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function median(nums) {
  if (!nums.length) return null;
  const a = nums.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v))); }

// askNames(prompt, {providers, deadlineMs, log}) -> { ok, names, provider }. Strict-JSON extraction over
// the router chain (Rule 11/12 doctrine): one field, `names`, an array of plain provider/firm names.
async function askNames(prompt, { providers, deadlineMs, log }) {
  const res = await route(
    { role: 'extract', system: 'Reply with strict JSON only, no prose, no markdown fences.', prompt, max_tokens: 220 },
    { providers, deadlineMs: deadlineMs || 9000, log },
  );
  if (!res.ok) return { ok: false, names: [], provider: null };
  let names = [];
  try { const j = JSON.parse(res.text); if (Array.isArray(j.names)) names = j.names.map(String); } catch (_e) { /* malformed JSON -> no names this sample, never a guess */ }
  return { ok: names.length > 0, names: names.filter((n) => n && n.length > 1 && n.length < 60 && !AGG.test(n)), provider: res.provider };
}

function groundedSourcesFrom(candidate) {
  const gm = candidate.groundingMetadata || {};
  return (gm.groundingChunks || []).map((x) => x.web && { uri: x.web.uri, title: x.web.title }).filter(Boolean);
}

function sourceHostname(source) {
  try { return new URL(source.uri).hostname.replace(/^www\./, ''); } catch (_e) { return ''; }
}

// groundedCitations(query, domain, env) -> { sources, source_domains, you_cited } | null (no key / no
// grounding data). The one direct-fetch call in this file (see file header).
async function groundedCitations(query, domain, env) {
  const key = env.GEMINI_API_KEY; if (!key) return null;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + encodeURIComponent(key);
  const body = { contents: [{ parts: [{ text: 'Who are the best providers for "' + query + '"? Name specific firms.' }] }], tools: [{ google_search: {} }] };
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), deadlineMs: 12000 });
  if (!r.ok) return null;
  const cand = (r.json.candidates || [])[0] || {};
  const sources = groundedSourcesFrom(cand);
  if (!sources.length) return null;
  const dom = String(domain || '').replace(/^www\./, '').toLowerCase();
  const domains = sources.map(sourceHostname).filter(Boolean);
  const youCited = dom ? sources.some((s) => isSameHost(s.uri, dom)) : null;
  return { sources: sources.slice(0, 8), source_domains: domains.slice(0, 8), you_cited: youCited };
}

// geoProbeShareOfVoice({query, company, domain, env, samples, log, fetchImpl}) -> the real multi-sample
// result: { ok:true, provider, providers_used, samples, firm_appears, share_of_voice, repeatability,
// top_competitors, grounded } | { ok:false, reason }. `fetchImpl` is forwarded to buildChain() (its own
// injected-transport seam, llm/providers/chain.js) so node:test can drive this probe over a fake
// transport without monkey-patching the router module - the SAME injection pattern the mint itself uses.
// sampleNames(prompt, providers, log, count) -> the runs that resolved a usable {names} answer, in
// sample order (sequential, one router call at a time - the same rate the original for-loop called at).
async function sampleNames(prompt, providers, log, count) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    const r = await askNames(prompt, { providers, log });
    if (r.ok) runs.push(r);
  }
  return runs;
}

// firmHitPredicate(firmKey) -> a (run) => boolean testing whether that sample's named list included the
// firm itself (a short/empty firmKey never matches, so a firm with no resolvable name is honestly absent).
function firmHitPredicate(firmKey) {
  return (r) => r.names.some((n) => firmKey && firmKey.length >= 4 && normName(n).includes(firmKey));
}

// shareOfVoiceFromRuns(runs, hit) -> { byProvider, sov }: the per-provider hit-rate map, and the overall
// share-of-voice as the median hit-rate across providers (never a single provider's own bias).
function shareOfVoiceFromRuns(runs, hit) {
  const byProvider = {};
  runs.forEach((r) => { (byProvider[r.provider] = byProvider[r.provider] || []).push(hit(r) ? 1 : 0); });
  const fractions = Object.values(byProvider).map((hits) => 100 * hits.reduce((a, b) => a + b, 0) / hits.length);
  return { byProvider, sov: runs.length ? clamp100(median(fractions)) : null };
}

function shouldSkipCompetitorName(k, seen, firmKey) {
  return !k || (firmKey && k.includes(firmKey)) || seen.has(k);
}

// competitorFrequencyFromRuns(runs, firmKey) -> { [normName]: {name, count} }, one tally per run at
// most per distinct competitor name (a name repeated within one run's own list counts once for that run).
function competitorFrequencyFromRuns(runs, firmKey) {
  const freq = {};
  runs.forEach((r) => {
    const seen = new Set();
    r.names.forEach((n) => {
      const k = normName(n);
      if (shouldSkipCompetitorName(k, seen, firmKey)) return;
      seen.add(k);
      freq[k] = freq[k] || { name: n, count: 0 };
      freq[k].count++;
    });
  });
  return freq;
}

function topCompetitorsFromFreq(freq, runsLength, fallbackN) {
  return Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 3).map((c) => ({ name: c.name, in_runs: c.count, of: runsLength || fallbackN }));
}

async function geoProbeShareOfVoice({ query, company, domain, env = process.env, samples = 5, log, fetchImpl } = {}) {
  if (!query) return { ok: false, reason: 'no_query' };
  const chain = buildChain({ env, log, fetchImpl });
  if (!chain.providers.length) return { ok: false, reason: 'no_providers' };
  const prompt = 'A buyer asks for the best providers for "' + query + '". List up to 6 specific firms or providers by name. Reply with strict JSON: {"names": ["...", "..."]}.';
  const N = Math.max(1, Math.min(8, samples));
  const runs = await sampleNames(prompt, chain.providers, log, N);
  const grounded = await groundedCitations(query, domain, env).catch(() => null);
  if (!runs.length && !grounded) return { ok: false, reason: 'all_providers_unavailable' };

  const firmKey = normName(company);
  const hit = firmHitPredicate(firmKey);
  const firmAppears = runs.filter(hit).length;
  const { byProvider, sov } = shareOfVoiceFromRuns(runs, hit);
  const freq = competitorFrequencyFromRuns(runs, firmKey);
  const topCompetitors = topCompetitorsFromFreq(freq, runs.length, N);

  return {
    ok: true, provider: runs[0] ? runs[0].provider : null, providers_used: Object.keys(byProvider),
    samples: runs.length || N, firm_appears: firmAppears, share_of_voice: sov, repeatability: firmAppears,
    top_competitors: topCompetitors, grounded,
  };
}

module.exports = { geoProbeShareOfVoice, askNames, groundedCitations, normName };
