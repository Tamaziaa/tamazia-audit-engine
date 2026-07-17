'use strict';
/**
 * discover.js - link + sitemap discovery and the E-236 Tier-1-first ordering.
 *
 * Two properties this file exists to preserve:
 *  - QUERY-STRING URLs are crawled (caution.md C-027): CMS policy pages live at /privacy?page_id=42, so
 *    link discovery keeps '?' (only the fragment is dropped). isNonCrawlable in the safe-fetch door drops
 *    mailto/tel/js schemes; a query string is never dropped.
 *  - TIER-1 legal pages (privacy, cookies, terms, complaints) are ordered ahead of any commercial page
 *    and BEFORE the page cap applies (caution.md C-026): orderCandidates ranks by tier, THEN slices to the
 *    cap, so a Tier-1 page discovered LAST still survives a cap smaller than the candidate count.
 *
 * Sitemap discovery fans out in PARALLEL (E-236): the robots.txt sitemap roots race together and each
 * root's child sitemaps are fetched together; the identical URL set is produced with the idling removed.
 * The XML fetch is INJECTED (fetchXml) so this module is pure/offline and node:test drives it with mocks.
 * Host identity is decided ONLY through the tools/lib/safe-fetch.js parsed-host door.
 */

const safeFetch = require('../../tools/lib/safe-fetch.js');
const { extractHrefs } = require('./extract.js');

// Guessed policy-path backstop (privacy/cookie/terms FIRST) for sites whose links/sitemap miss them.
const POLICY_PATHS = [
  '/privacy', '/privacy-policy', '/cookies', '/cookie-policy', '/terms', '/terms-and-conditions',
  '/legal', '/complaints', '/accessibility', '/data-protection',
];

const TIER1_RX = /privacy|cookie|terms|legal|gdpr|data[-_ ]protection|accessibility|complaint|modern[-_ ]slavery|disclaimer|imprint|disclosure|safeguard|regulat|compliance|confidentialit|datenschutz|rgpd/i;
const TIER2_RX = /about|contact|service|pricing|prices|fees|returns|refund|shipping|delivery|team|locations|offices|sector/i;
const BLOG_RX = /\/blog|\/news|\/insights|\/press|\/article|\/resources|\/stories|\/updates|\/knowledge|\/20\d\d\//i;

// classifyTier(url) -> the crawl priority tier of a URL by PATH (not host): 'tier1' policy/legal,
// 'tier2' commercial, 'blog' editorial, 'other'. Tier-1 wins even if the URL also matches a lower tier.
function classifyTier(url) {
  const u = String(url || '');
  if (TIER1_RX.test(u)) return 'tier1';
  if (TIER2_RX.test(u)) return 'tier2';
  if (BLOG_RX.test(u)) return 'blog';
  return 'other';
}

const TIER_RANK = { tier1: 1, tier2: 2, blog: 3, other: 4 };
function normaliseUrl(u) { return String(u).split('#')[0].replace(/\/$/, '').toLowerCase(); }

// discoverLinks(html, base, accepted) -> the same-registrable-site hrefs on a page, resolved absolute,
// query strings kept (C-027), fragments/mailto/tel/js dropped, deduped in discovery order.
function discoverLinks(html, base, accepted) {
  const out = [];
  const seen = new Set();
  for (const href of extractHrefs(html)) {
    if (safeFetch.isNonCrawlable(href)) continue;
    let abs;
    try { abs = new URL(href, base).toString(); } catch (e) { continue; /* FAIL-OPEN: an unparseable href is not a crawl target; skipping it hides nothing (the URL simply is not a link). */ }
    if (!safeFetch.sameRegistrableSite(abs, accepted)) continue;
    const clean = abs.split('#')[0];
    const key = normaliseUrl(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

// parseSitemapLocs(xml) -> { pageUrls, childSitemaps } from a <urlset>/<sitemapindex> body.
function parseSitemapLocs(xml) {
  const locs = (String(xml || '').match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi) || [])
    .map((x) => x.replace(/<\/?loc>/gi, '').trim());
  return {
    childSitemaps: locs.filter((u) => /sitemap.*\.xml/i.test(u)).slice(0, 8),
    pageUrls: locs.filter((u) => !/\.xml/i.test(u)),
  };
}

// sitemapRoots(domain, robotsBody) -> the sitemap roots to try: robots.txt Sitemap: directives first
// (authoritative), then the conventional roots.
function sitemapRoots(domain, robotsBody) {
  const roots = [];
  for (const m of String(robotsBody || '').matchAll(/(?:^|\n)\s*sitemap:\s*(\S+)/gi)) roots.push(m[1].trim());
  roots.push('https://' + domain + '/sitemap.xml', 'https://' + domain + '/sitemap_index.xml', 'https://' + domain + '/sitemap-index.xml');
  return roots;
}

// collectSitemapPages(body, accepted, fetchXml) -> same-site page URLs from one root body, following its
// child sitemaps in PARALLEL (E-236). Returns [] when the body yields no same-site pages.
async function collectSitemapPages(body, accepted, fetchXml) {
  const { pageUrls, childSitemaps } = parseSitemapLocs(body);
  const urls = pageUrls.filter((u) => safeFetch.sameRegistrableSite(u, accepted));
  const childBodies = await Promise.all(childSitemaps.map((cs) => fetchXml(cs).catch(() => '')));
  for (const cb of childBodies) {
    for (const u of parseSitemapLocs(cb).pageUrls) if (safeFetch.sameRegistrableSite(u, accepted)) urls.push(u);
  }
  return urls;
}

// discoverSitemap(domain, accepted, fetchXml) -> same-site page URLs from the sitemap. Roots race in
// PARALLEL; the first root that yields same-site pages wins (identical set, no sequential idling).
async function discoverSitemap(domain, accepted, fetchXml) {
  const robots = await fetchXml('https://' + domain + '/robots.txt').catch(() => '');
  const roots = sitemapRoots(domain, robots);
  const bodies = await Promise.all(roots.map((r) => fetchXml(r).catch(() => '')));
  for (const body of bodies) {
    if (!body) continue;
    const urls = await collectSitemapPages(body, accepted, fetchXml);
    if (urls.length) return urls;
  }
  return [];
}

// guessedPaths(accepted) -> the policy-path backstop across every accepted registrable host.
function guessedPaths(accepted) {
  const out = [];
  for (const reg of accepted) for (const p of POLICY_PATHS) out.push('https://' + reg + p);
  return out;
}

// orderCandidates(homeUrl, discovered, accepted, maxPages) -> the deduped, same-site fetch list ordered
// TIER-1-FIRST and THEN capped (C-026): the homepage leads, then Tier-1 (legal), Tier-2 (commercial),
// blog, other; a stable sort preserves discovery order within a tier; the cap is applied LAST so Tier-1
// survives even when it was discovered last and the cap is smaller than the candidate count.
function orderCandidates(homeUrl, discovered, accepted, maxPages) {
  const homeKey = normaliseUrl(homeUrl);
  const pool = [homeUrl, ...guessedPaths(accepted), ...(discovered || [])];
  const seen = new Set();
  const ranked = [];
  for (const u of pool) {
    if (!safeFetch.sameRegistrableSite(u, accepted)) continue;
    const key = normaliseUrl(u);
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ url: u, rank: key === homeKey ? 0 : TIER_RANK[classifyTier(u)] });
  }
  ranked.sort((a, b) => a.rank - b.rank); // stable in Node: ties keep discovery order
  const capped = ranked.slice(0, maxPages).map((r) => r.url);
  return capped;
}

module.exports = {
  POLICY_PATHS, classifyTier, discoverLinks, discoverSitemap, orderCandidates,
  parseSitemapLocs, guessedPaths, normaliseUrl,
};
