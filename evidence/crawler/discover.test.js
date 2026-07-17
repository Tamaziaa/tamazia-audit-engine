'use strict';
// discover.test.js - link/sitemap discovery and the E-236 Tier-1-first-then-cap ordering (unit level).

const test = require('node:test');
const assert = require('node:assert');

const d = require('./discover.js');

const accepted = new Set(['example.com']);

test('classifyTier: Tier-1 legal wins over any lower tier; commercial and blog are ranked below', () => {
  assert.equal(d.classifyTier('https://example.com/privacy-policy'), 'tier1');
  assert.equal(d.classifyTier('https://example.com/modern-slavery-statement'), 'tier1');
  assert.equal(d.classifyTier('https://example.com/pricing'), 'tier2');
  assert.equal(d.classifyTier('https://example.com/blog/2024/post'), 'blog');
  assert.equal(d.classifyTier('https://example.com/gallery'), 'other');
  // a URL matching both tiers resolves to Tier-1 (legal wins).
  assert.equal(d.classifyTier('https://example.com/legal/pricing'), 'tier1');
});

test('discoverLinks: same-site only, query kept, fragments/mailto/tel dropped, deduped', () => {
  const html = [
    '<a href="/privacy?page_id=42">privacy</a>',
    '<a href="/privacy?page_id=42#section">dup</a>',
    '<a href="mailto:hi@example.com">mail</a>',
    '<a href="tel:+44">phone</a>',
    '<a href="https://evil.com/example.com">not us</a>',
    '<a href="https://blog.example.com/post">subdomain, same site</a>',
  ].join('');
  const links = d.discoverLinks(html, 'https://example.com', accepted);
  assert.ok(links.includes('https://example.com/privacy?page_id=42'), 'query strings are kept');
  assert.ok(links.some((u) => u.startsWith('https://blog.example.com/')), 'a same-registrable-site subdomain is in scope');
  assert.ok(!links.some((u) => u.includes('evil.com')), 'a hostile URL containing our name as a PATH is not same-site');
  assert.ok(!links.some((u) => /^mailto|^tel/.test(u)));
  assert.equal(new Set(links).size, links.length, 'links are deduped');
});

test('TIER-1-FIRST-THEN-CAP: a Tier-1 page discovered LAST survives a cap smaller than the candidate set', () => {
  // Four commercial pages discovered first, one legal page (NOT a guessed policy path, so it is only ever
  // seen via discovery) discovered LAST. cap = 12 fits the homepage + every Tier-1 (guessed + discovered)
  // but not the Tier-2 pages, so ranking-before-slice is what saves the DOM-last legal page.
  const discovered = [
    'https://example.com/services',
    'https://example.com/about',
    'https://example.com/pricing',
    'https://example.com/team',
    'https://example.com/modern-slavery-statement', // Tier-1, discovered LAST, not a guessed path
  ];
  const ordered = d.orderCandidates('https://example.com/', discovered, accepted, 12);
  assert.equal(ordered[0], 'https://example.com/', 'the homepage always leads');
  assert.ok(ordered.includes('https://example.com/modern-slavery-statement'),
    'the Tier-1 page discovered last survives the cap because ranking precedes the slice');
  // every commercial page was shed by the cap while the DOM-later Tier-1 page survived.
  for (const commercial of ['/services', '/about', '/pricing', '/team']) {
    assert.ok(!ordered.includes('https://example.com' + commercial), commercial + ' (Tier-2) is shed by the cap');
  }
});

test('orderCandidates: the policy-path backstop is injected even when nothing links to it', () => {
  const ordered = d.orderCandidates('https://example.com/', [], accepted, 50);
  assert.ok(ordered.some((u) => u.endsWith('/privacy')), 'guessed policy paths backstop a site that omits them');
  assert.ok(ordered.some((u) => u.endsWith('/complaints')));
});

test('parseSitemapLocs splits page URLs from child sitemaps', () => {
  const xml = '<urlset><url><loc>https://example.com/a</loc></url><loc>https://example.com/sitemap-2.xml</loc></urlset>';
  const { pageUrls, childSitemaps } = d.parseSitemapLocs(xml);
  assert.deepEqual(pageUrls, ['https://example.com/a']);
  assert.deepEqual(childSitemaps, ['https://example.com/sitemap-2.xml']);
});

test('discoverSitemap: robots Sitemap: directive is followed, same-site pages returned (injected fetchXml)', async () => {
  const responses = {
    'https://example.com/robots.txt': 'User-agent: *\nSitemap: https://example.com/sm.xml\n',
    'https://example.com/sm.xml': '<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://evil.com/b</loc></url></urlset>',
  };
  const fetchXml = (url) => Promise.resolve(responses[url] || '');
  const urls = await d.discoverSitemap('example.com', accepted, fetchXml);
  assert.deepEqual(urls, ['https://example.com/a'], 'off-site sitemap URLs are filtered out by the parsed-host door');
});
