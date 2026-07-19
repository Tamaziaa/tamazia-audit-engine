'use strict';
// probes/authority-gap.js - REAL OpenPageRank Domain Rating probe. Faithful port of the old estate's
// producer: cowork-os-fresh src/lib/audit/authority-gap.js `fetchOPR` + `authorityGap`. Same endpoint
// (openpagerank.com getPageRank, free, 10,000 calls/hour x 100 domains/call), same 0-10 -> /100 scaling
// (`da_100 = round(dr * 10)`), same competitor join shape.
//
// Rule 10 / the mission's explicit instruction: this is the ONLY Domain Rating this engine ever emits.
// The old estate's `_adapter.js drFallback(name)` invented a Domain Rating from a name-hash when
// OpenPageRank had no data for a domain (flagged `drEstimated`, labelled "est" in the render). That
// fabrication class is NOT ported: when OpenPageRank has no data for a domain this probe emits nothing
// for it (null), never a hashed guess dressed as a measurement.

const { fetchJson } = require('./lib/net.js');

const OPR_DEADLINE_MS = 12000;

function cleanD(d) { return String(d || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase(); }

// isValidOprRow(row) -> true for a response row this probe can trust: a named domain OpenPageRank
// actually scored (status_code 200; a non-200 row carries no usable rank).
function isValidOprRow(row) { return !!(row && row.domain && row.status_code === 200); }

function oprRowToEntry(row) { return { dr: Number(row.page_rank_decimal) || 0, rank: row.rank ? Number(row.rank) : null }; }

// oprResponseToMap(r) -> { [domain]: {dr, rank}, _last_updated }. `_last_updated` is read from the body
// whenever the body parsed, even on a non-ok HTTP status (matches the original: the freshness stamp is
// not gated on r.ok, only the per-domain rows are).
function oprResponseToMap(r) {
  const out = {};
  const rows = (r.ok && Array.isArray(r.json && r.json.response)) ? r.json.response : [];
  for (const row of rows) {
    if (isValidOprRow(row)) out[row.domain.toLowerCase()] = oprRowToEntry(row);
  }
  out._last_updated = (r.json && r.json.last_updated) || null;
  return out;
}

// fetchOPR(domains, key) -> { [domain]: {dr, rank} }. Up to 100 domains in one call, exactly as the old
// producer batched it.
async function fetchOPR(domains, key) {
  const uniq = [...new Set((domains || []).map(cleanD).filter(Boolean))].slice(0, 100);
  if (!uniq.length || !key) return {};
  const qs = uniq.map((d) => 'domains[]=' + encodeURIComponent(d)).join('&');
  const r = await fetchJson('https://openpagerank.com/api/v1.0/getPageRank?' + qs, { headers: { 'API-OPR': key }, deadlineMs: OPR_DEADLINE_MS });
  return oprResponseToMap(r);
}

const da100 = (dr) => Math.round((Number(dr) || 0) * 10);

// authorityGapProbe({domain, competitors, env}) -> { ok:true, you:{dr,rank,da_100}|null, top3, ranked,
// last_updated } | { ok:false, reason:'no_key' }. `you:null` (never a fabricated figure) when
// OpenPageRank genuinely holds no data for the domain (Rule 10: absence stays absence).
async function authorityGapProbe({ domain, competitors = [], env = {} } = {}) {
  const key = env.OPENPAGERANK_API_KEY || null;
  if (!key) return { ok: false, reason: 'no_key' };
  const me = cleanD(domain);
  const comps = [...new Set(competitors.map(cleanD).filter((c) => c && c !== me))].slice(0, 9);
  const data = await fetchOPR([me, ...comps], key);
  const you = data[me] || null;
  if (!you) return { ok: true, you: null, top3: [], ranked: [], last_updated: data._last_updated || null };
  const ranked = comps.map((c) => Object.assign({ domain: c }, data[c] || {})).filter((c) => typeof c.dr === 'number');
  ranked.sort((a, b) => b.dr - a.dr);
  const top3 = ranked.slice(0, 3).map((c) => ({ domain: c.domain, dr: c.dr, da_100: da100(c.dr) }));
  return { ok: true, you: { dr: you.dr, rank: you.rank, da_100: da100(you.dr) }, top3, ranked, last_updated: data._last_updated || null };
}

module.exports = { authorityGapProbe, fetchOPR, da100 };
