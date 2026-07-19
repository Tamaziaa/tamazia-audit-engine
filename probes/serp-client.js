'use strict';
// probes/serp-client.js - provider-agnostic SERP client. Faithful port of the old estate's
// cowork-os-fresh src/lib/scraping/serp-client.js: same output shape { ads, organic, provider } |
// { error }, same free-first-then-paid cascade philosophy (the old client tried a self-hosted
// SearXNG/Brave/DuckDuckGo layer before spending a SERPER_KEY credit).
//
// DEVIATION (documented): the old cascade's free layer was SearXNG (self-hosted, this engine has no
// such deployment) and DuckDuckGo HTML scraping (keyless but explicitly "flaky", per the old file's own
// comment). This port keeps the ONE free layer that is a genuine, keyed, documented API - Brave Search
// (BRAVE_API_KEY, explicitly named optional/degrade-gracefully by the founder brief) - and drops the
// unauthenticated-scrape layer, which is not a "real API key" per the mission brief. SERPER_KEY
// (google.serper.dev) remains the backstop exactly as before. Absent both keys, search() returns
// { error, hint }, never a fabricated result set.

const { fetchJson } = require('./lib/net.js');

const GL = { UK: 'gb', US: 'us', USA: 'us', UAE: 'ae', AE: 'ae', SA: 'sa', QA: 'qa' };

function rootDomain(u) {
  try { return new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, ''); }
  catch (_e) { return ''; }
}

// viaBrave(query, country, num, env) -> {ads, organic, provider} | null. Brave Search API (free tier).
async function viaBrave(query, country, num, env) {
  const key = env.BRAVE_API_KEY; if (!key) return null;
  const url = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query)
    + '&country=' + (GL[country] || 'gb') + '&count=' + Math.min(num, 20);
  const r = await fetchJson(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, deadlineMs: 12000 });
  if (!r.ok) return null;
  const results = (r.json && r.json.web && r.json.web.results) || [];
  const organic = results.map((o, i) => ({ title: o.title, url: o.url, domain: rootDomain(o.url || ''), rank: i + 1 }));
  return { ads: [], organic, provider: 'brave' };
}

// viaSerper(query, country, num, env) -> {ads, organic, provider} | null. google.serper.dev (paid
// backstop, SERPER_KEY - the key the founder brief names explicitly).
async function viaSerper(query, country, num, env) {
  const key = env.SERPER_KEY; if (!key) return null;
  const r = await fetchJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: GL[country] || 'gb', num }),
    deadlineMs: 15000,
  });
  if (!r.ok) return null;
  const j = r.json || {};
  const ads = (j.ads || []).map((a) => ({ title: a.title, url: a.link, domain: rootDomain(a.link || '') }));
  const organic = (j.organic || []).map((o, i) => ({ title: o.title, url: o.link, domain: rootDomain(o.link || ''), rank: o.position || i + 1 }));
  return { ads, organic, provider: 'serper' };
}

// search(query, country, num, {env}) -> {ads, organic, provider} | {error, hint}. Free-first
// (Brave), then the paid backstop (Serper). Never throws.
async function search(query, country = 'UK', num = 20, { env = process.env } = {}) {
  for (const fn of [viaBrave, viaSerper]) {
    const r = await fn(query, country, num, env);
    if (r && (r.organic.length || r.ads.length)) return r;
  }
  return { error: 'no_serp_result', hint: 'Set BRAVE_API_KEY (free) or SERPER_KEY to run a live SERP probe.' };
}

function hasKey(env = process.env) { return !!(env.BRAVE_API_KEY || env.SERPER_KEY); }

module.exports = { search, hasKey, rootDomain, GL };
