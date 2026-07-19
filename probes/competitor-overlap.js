'use strict';
// probes/competitor-overlap.js - REAL organic-competitor set from free/paid SERP-overlap. Faithful port
// of the old estate's producer: cowork-os-fresh src/lib/audit/competitor-overlap.js `organicCompetitors`.
// A real competitor is a domain that co-ranks with the firm across its own buyer queries and is not a
// directory/aggregator/social/gov host - reuses the same SERP client and aggregator filter as
// probes/keyword-map.js so this adds zero new keys, exactly like the old producer's design intent.

const serp = require('./serp-client.js');
const { isAggregator } = require('./keyword-map.js');

function cleanD(d) { return String(d || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase(); }
function isSelf(d, me) { return !!d && !!me && (d === me || d.endsWith('.' + me) || me.endsWith('.' + d)); }

// organicCompetitorsProbe({keywords, domain, env, want}) -> string[] (domains), never throws. `keywords`
// is the plain keyword strings from keyword-map.js's output (the firm's own buyer queries).
async function organicCompetitorsProbe({ keywords = [], domain, env = process.env, want = 6 } = {}) {
  const me = cleanD(domain);
  const freq = new Map();
  const bump = (d) => {
    const dom = cleanD(d);
    if (!dom || isSelf(dom, me) || isAggregator(dom)) return;
    freq.set(dom, (freq.get(dom) || 0) + 1);
  };
  const seedKws = Array.from(new Set(keywords)).slice(0, 4);
  for (const kw of seedKws) {
    const r = await serp.search(kw, 'UK', 12, { env });
    const organic = (r && r.organic) || [];
    for (const o of organic.slice(0, 10)) bump(o.domain);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, want).map(([d]) => d);
}

module.exports = { organicCompetitorsProbe };
