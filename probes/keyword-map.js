'use strict';
// probes/keyword-map.js - REAL live-SERP keyword map. Faithful port of the old estate's producer:
// cowork-os-fresh src/lib/touch0/rank-insight.js `buildKeywordMap` + `checkKeyword` + `isAggregator` +
// `positionBand`. Same mechanics: build candidate buyer keywords for the firm's sector + city, run a
// REAL live SERP check per candidate (full depth), and record the firm's own position plus the real
// domain that leads each query - every ranking claim traces to a live SERP result or is dropped.
//
// DEVIATION (documented): the old producer derived its category noun from a bespoke sector-intelligence
// data tier (title-catalogue.json, a free-LLM category-noun classifier, per-sector/per-jurisdiction
// aggregator JSON files) that has no equivalent in this repo. This port keeps the SAME two-stage shape
// (a service-noun table keyed by sector, with a light regex sub-sector refiner) but as a small, inlined,
// deterministic table rather than an external data asset - the live-SERP CHECKING logic (the part the
// mission calls out as the "soul" of the module: `checkKeyword`, the aggregator filter, the position
// bands) is copied faithfully; the noun VOCABULARY is condensed. Sector is read from the engine's own
// resolved sector fact (facts/sector.js), never invented here.

const serp = require('./serp-client.js');

const SECTOR_NOUN = {
  'law-firms': 'law firm', legal: 'law firm', healthcare: 'clinic', dental: 'dental clinic',
  'real-estate': 'estate agent', hospitality: 'hotel', financial: 'financial adviser', finance: 'financial adviser',
  fintech: 'digital bank', banking: 'bank', insurance: 'insurance company', accounting: 'accountant',
  ecommerce: 'online store', retail: 'store', food: 'restaurant', technology: 'software company',
  education: 'school', automotive: 'car dealer', professional: 'consultancy', wellness: 'gym',
  fitness: 'gym', veterinary: 'veterinary clinic', travel: 'tour operator', energy: 'renewable energy company',
};

// A small, curated blocklist of directories/aggregators/social/gov hosts that co-rank on almost every
// buyer query but are never a real operating competitor (ported subset of the old estate's much larger
// AGGREGATORS set - the mechanism, not the exhaustive list).
const AGGREGATORS = new Set([
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'facebook.com', 'linkedin.com', 'youtube.com',
  'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com', 'wikipedia.org', 'reddit.com',
  'yell.com', 'yelp.com', 'yelp.co.uk', 'trustpilot.com', 'tripadvisor.com', 'tripadvisor.co.uk',
  'indeed.com', 'glassdoor.com', 'glassdoor.co.uk', 'checkatrade.com', 'bark.com', 'clutch.co',
  'gov.uk', 'nhs.uk', 'amazon.com', 'amazon.co.uk', 'ebay.com', 'ebay.co.uk',
]);
const AGG_TOKEN = /(?:^|[.-])(?:best|top\d*|review(?:s|ed)?|rated|directory|listings?|compare|comparison|guide|magazine|nearme|near-me|ranking|rankings|find(?:a|my)?|vs|versus|cheapest|deals|news|wiki|forum|aggregat\w*|marketplace)(?:[.-]|$)/i;

function cleanD(d) { return String(d || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase(); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function isAggregator(d) {
  const dom = cleanD(d);
  if (!dom) return true;
  if (AGGREGATORS.has(dom)) return true;
  if (/(^|\.)(wikipedia|facebook|linkedin|youtube|gov\.uk|nhs\.uk)\./.test(dom + '.')) return true;
  return AGG_TOKEN.test(dom);
}

function isSelf(d, me) { return !!d && !!me && (d === me || d.endsWith('.' + me) || me.endsWith('.' + d)); }

// positionBand(pos) -> the SAME four bands as the old estate ('winning'/'striking'/'almost'/'distant'/
// 'absent'), so a consumer reading `band` gets identical semantics.
function positionBand(pos) {
  if (pos == null) return 'absent';
  if (pos <= 10) return 'winning';
  if (pos <= 19) return 'striking';
  if (pos <= 50) return 'almost';
  return 'distant';
}

function deriveServiceNoun(sector, corpusText) {
  const sec = String(sector || '').toLowerCase();
  const hay = String(corpusText || '').toLowerCase();
  if (/dental|dentist|orthodont|invisalign/.test(hay)) return 'dental clinic';
  if (/aesthetic|cosmetic|botox/.test(hay)) return 'aesthetic clinic';
  if (/personal injury|accident/.test(hay) && /law|solicit/.test(sec)) return 'personal injury solicitor';
  if (/family law|divorce/.test(hay) && /law|solicit/.test(sec)) return 'family law solicitor';
  return SECTOR_NOUN[sec] || sec.replace(/-/g, ' ') || 'business';
}

function keywordsFor(noun, city) {
  const kws = [`${noun} ${city}`, `best ${noun} in ${city}`, `top ${noun} ${city}`, `${noun} near me`];
  return Array.from(new Set(kws.map((k) => k.replace(/\s+/g, ' ').trim())));
}

// checkKeyword(keyword, domain, country, env) -> the live-SERP row, or null when unverifiable (GATE: no
// invented position, ever). Ported one-to-one from rank-insight.js `checkKeyword`.
async function checkKeyword(keyword, domain, country, env) {
  const r = await serp.search(keyword, country, 40, { env });
  if (!r || r.error || !((r.organic || []).length)) return null;
  const ranked = r.organic.map((o) => ({ pos: o.rank, domain: cleanD(o.domain) })).filter((x) => x.domain);
  const mine = ranked.find((x) => x.domain === domain);
  const top3 = ranked.filter((x) => x.domain !== domain && !isAggregator(x.domain)).slice(0, 3);
  return { keyword, my_position: mine ? mine.pos : null, top3, ranked_seen: ranked.length };
}

// keywordMapProbe({domain, sector, city, corpusText, country, env, max}) -> {ok, service_noun, city,
// keywords:[{keyword,my_position,band,leader,leader_pos}]} | {ok:false, reason}. `city` is REQUIRED
// (a local-intent keyword ladder needs a real operating city; a caller with none should not call this,
// matching the old estate's own "missing_domain_or_city" gate).
async function keywordMapProbe({ domain, sector, city, corpusText, country = 'UK', env = process.env, max = 6 } = {}) {
  const dom = cleanD(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  if (!city) return { ok: false, reason: 'no_operating_city' };
  if (!serp.hasKey(env)) return { ok: false, reason: 'no_key' };
  const noun = deriveServiceNoun(sector, corpusText);
  const brand = norm(dom.split('.')[0]);
  const seeds = keywordsFor(noun, city).filter((k) => brand.length < 4 || !norm(k).includes(brand)).slice(0, max);
  const out = [];
  for (const kw of seeds) {
    const r = await checkKeyword(kw, dom, country, env);
    if (!r) continue;
    if (!r.top3.length && !r.my_position) continue; // SKIP-UNTIL-REAL: no real operating competitor and we don't rank either
    const leader = r.top3[0] || {};
    out.push({ keyword: kw, my_position: r.my_position, band: positionBand(r.my_position), leader: leader.domain || null, leader_pos: leader.pos || null });
  }
  if (!out.length) return { ok: false, reason: 'no_verifiable_keywords' };
  const bandRank = { almost: 0, striking: 1, distant: 2, absent: 3, winning: 4 };
  out.sort((a, b) => (bandRank[a.band] ?? 5) - (bandRank[b.band] ?? 5));
  return { ok: true, service_noun: noun, city, keywords: out };
}

module.exports = { keywordMapProbe, checkKeyword, isAggregator, positionBand, deriveServiceNoun, keywordsFor };
