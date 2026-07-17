#!/usr/bin/env node
'use strict';
// eval/reference-set/build-fixtures.js - reproducible OFFLINE evidence-fixture builder.
//
// Fetches the homepage (plus, when cheaply discoverable, up to two about/contact/legal
// pages) for every firm in reference-set.json and writes an EvidenceBundle-shaped
// fixture to eval/reference-set/fixtures/<domain>.json:
//
//   { domain, fetched_at, corpus: { pages: [{url, title, text, jsonLd, ogSiteName}],
//     footerText }, registers: {} }
//
// Sites that block, bot-wall or fail are written HONESTLY as
//   { domain, fetched_at, unreachable: true, note }
// - never fabricated (caution.md C-038: an unreadable site is asserted against by
// nothing). Blocked fixtures are themselves useful test data: facts modules must
// abstain on them.
//
// Facts modules NEVER fetch at runtime; this script is the only network step and it
// runs offline from the engine, on demand, to (re)generate the fixtures.
//
// Plain Node (>=20), zero npm dependencies. Budgets are CAPS, never floors
// (CONSTITUTION Rule 8): 10s hard deadline per fetch, max 3 pages per domain,
// max 5 redirects, 3MB body cap, 150KB per fixture file.
//
// Usage:
//   node eval/reference-set/build-fixtures.js            # all 27 firms
//   node eval/reference-set/build-fixtures.js --only dermexpert.co.uk
//   node eval/reference-set/build-fixtures.js --list     # print domains, no network

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const http = require('http');

const USER_AGENT =
  'TamaziaReferenceFixtureBot/1.0 (compliance-audit reference fixtures; contact: hello@tamazia.co.uk)';
const FETCH_DEADLINE_MS = 10000; // hard cap per fetch (never a floor)
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_PAGES_PER_DOMAIN = 3;
const MAX_TEXT_CHARS = 20000;
const FOOTER_CHARS = 3000;
const MAX_FIXTURE_BYTES = 150 * 1024;
const INTER_FETCH_PAUSE_MS = 400; // politeness pause between fetches

const REF_SET = path.join(__dirname, 'reference-set.json');
const OUT_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in build-fixtures.test.js)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', hellip: '...', copy: '(c)', reg: '(R)', trade: '(TM)',
  pound: '£', euro: '€', dollar: '$', middot: '·', bull: '•',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase())
        ? NAMED_ENTITIES[name.toLowerCase()]
        : m
    );
}

function safeFromCodePoint(cp) {
  try {
    if (!Number.isFinite(cp) || cp < 9 || cp > 0x10ffff) return ' ';
    return String.fromCodePoint(cp);
  } catch (e) {
    return ' '; // invalid code point in source HTML; a space is the honest substitute
  }
}

// Visible text only (caution.md C-012: never classify on <script>/<style> noise).
function stripHtml(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // Block-level closers become newlines so footer lines survive as lines.
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|footer|header|nav|br)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t\r\f\v]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function extractOgSiteName(html) {
  const s = String(html);
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tag = m[0];
    if (!/property\s*=\s*["']og:site_name["']/i.test(tag)) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (c) return decodeEntities(c[1]).trim();
  }
  return undefined;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch (e) {
      // Invalid JSON-LD on the live site is a fact about the site; record nothing,
      // fabricate nothing. (Fail-closed: no partial parse guesses.)
    }
  }
  return out;
}

// Discover cheap secondary pages: about / contact / legal / privacy / terms on the
// same registrable host. Query-string URLs are permitted (caution.md C-027).
const SECONDARY_PATH_RE = /(about|contact|who-we-are|our-(team|firm|practice|clinic|company)|legal|imprint|privacy|terms)/i;

function discoverSecondaryLinks(html, baseUrl, max) {
  const cap = typeof max === 'number' ? max : 2;
  const found = [];
  const seen = new Set();
  let base;
  try { base = new URL(baseUrl); } catch (e) { return found; }
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null && found.length < cap) {
    const href = decodeEntities(m[1]).trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (stripWww(u.hostname) !== stripWww(base.hostname)) continue;
    if (!SECONDARY_PATH_RE.test(u.pathname + u.search)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|doc|docx|mp4)$/i.test(u.pathname)) continue;
    const key = u.origin + u.pathname + u.search;
    if (seen.has(key)) continue;
    if (key === base.origin + base.pathname + base.search) continue;
    seen.add(key);
    found.push(u.href);
  }
  return found;
}

function stripWww(host) {
  return String(host).toLowerCase().replace(/^www\./, '');
}

// Honest bot-wall / challenge detection. A 200 that is a Cloudflare interstitial is
// NOT content (caution.md C-031: reachable is guarded by classification, not bytes).
const CHALLENGE_MARKERS = [
  'just a moment', 'attention required', 'checking your browser',
  'verify you are human', 'access denied', 'ddos protection', 'cf-challenge',
  'enable javascript and cookies to continue', 'captcha', 'request unsuccessful',
  'incapsula', 'perimeterx', 'are you a robot',
];

function looksLikeChallengePage(status, text, title) {
  if (status === 403 || status === 429 || status === 503 || status === 401) return true;
  const hay = `${title || ''}\n${(text || '').slice(0, 2500)}`.toLowerCase();
  if (!hay.trim()) return false;
  const marked = CHALLENGE_MARKERS.some((mk) => hay.includes(mk));
  // A real page can mention 'captcha' in prose; only call it a wall when the visible
  // text is also very thin.
  return marked && (text || '').length < 4000;
}

// Unrendered SPA shell: HTTP 200, an HTML document, but near-zero visible text.
// The old estate fabricated 22 cookie findings on exactly this shape (caution.md
// C-032, royalparkpartners.com); the fixture must record it honestly instead.
function looksLikeSpaShell(bodyHtml, visibleText) {
  const body = String(bodyHtml || '');
  if ((visibleText || '').length >= 200) return false;
  if (!/<html[\s>]/i.test(body)) return false;
  return (
    /<div[^>]*id\s*=\s*["'](root|app|__next|___gatsby)["']/i.test(body) ||
    /data-vite-theme|src="\/assets\/index-|type="module"/i.test(body) ||
    /<script/i.test(body)
  );
}

// Trim a fixture object under the byte budget without fabricating anything.
function trimToBudget(fixture, maxBytes) {
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  if (size(fixture) <= maxBytes) return fixture;
  const f = JSON.parse(JSON.stringify(fixture));
  const steps = [
    () => { for (const p of pagesOf(f)) if (p.jsonLd && size(p.jsonLd) > 20000) p.jsonLd = []; },
    () => { for (const p of pagesOf(f)) p.text = (p.text || '').slice(0, 12000); },
    () => { for (const p of pagesOf(f)) p.jsonLd = []; },
    () => { const pp = pagesOf(f); if (pp.length > 2) pp.length = 2; },
    () => { for (const p of pagesOf(f)) p.text = (p.text || '').slice(0, 6000); },
    () => { const pp = pagesOf(f); if (pp.length > 1) pp.length = 1; },
  ];
  for (const step of steps) {
    step();
    if (size(f) <= maxBytes) { f.trimmed = true; return f; }
  }
  f.trimmed = true;
  return f;
}

function pagesOf(f) {
  return (f.corpus && Array.isArray(f.corpus.pages)) ? f.corpus.pages : [];
}

function buildBundlePage(url, html) {
  return {
    url,
    title: extractTitle(html),
    text: stripHtml(html).slice(0, MAX_TEXT_CHARS),
    jsonLd: extractJsonLd(html),
    ogSiteName: extractOgSiteName(html),
  };
}

// ---------------------------------------------------------------------------
// Network layer (deadline-wrapped; never used by facts modules)
// ---------------------------------------------------------------------------

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error(`bad url: ${url}`)); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
        },
        timeout: FETCH_DEADLINE_MS,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
        else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        stream.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_BODY_BYTES) {
            req.destroy();
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncatedBody: true });
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', (e) => reject(e));
      }
    );
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${FETCH_DEADLINE_MS}ms`)); });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

async function fetchFollowingRedirects(url) {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const outerDeadline = new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`hard deadline ${FETCH_DEADLINE_MS}ms exceeded`)), FETCH_DEADLINE_MS + 500).unref()
    );
    const res = await Promise.race([fetchOnce(current), outerDeadline]);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      current = new URL(res.headers.location, current).href;
      continue;
    }
    return { finalUrl: current, status: res.status, body: res.body };
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Per-domain build
// ---------------------------------------------------------------------------

async function fetchHomepage(domain) {
  // The /en attempts cover language-gated sites whose root 301s to itself without a
  // cookie (observed live on medcare.ae); still capped at one fetch chain each.
  const attempts = [
    `https://${domain}/`,
    `https://www.${domain}/`,
    `https://www.${domain}/en`,
    `https://${domain}/en`,
  ];
  let lastErr = null;
  for (const url of attempts) {
    try {
      const res = await fetchFollowingRedirects(url);
      if (res.status === 200) return res;
      lastErr = new Error(`HTTP ${res.status} at ${url}`);
      if ([403, 429, 503, 401].includes(res.status)) return res; // a wall is an answer
    } catch (e) {
      lastErr = e;
    }
    await sleep(INTER_FETCH_PAUSE_MS);
  }
  throw lastErr || new Error('unreachable');
}

async function buildFixtureForDomain(domain) {
  const fetchedAt = new Date().toISOString();
  let home;
  try {
    home = await fetchHomepage(domain);
  } catch (e) {
    return { domain, fetched_at: fetchedAt, unreachable: true, note: `fetch failed: ${e.message}` };
  }

  const homePage = buildBundlePage(home.finalUrl, home.body);
  if (looksLikeChallengePage(home.status, homePage.text, homePage.title)) {
    return {
      domain,
      fetched_at: fetchedAt,
      unreachable: true,
      note: `blocked: HTTP ${home.status}${homePage.title ? `, title "${homePage.title.slice(0, 120)}"` : ''} - bot wall or challenge page; no content asserted (C-038)`,
    };
  }
  if (looksLikeSpaShell(home.body, homePage.text)) {
    return {
      domain,
      fetched_at: fetchedAt,
      unreachable: true,
      spa_shell: true,
      note: `unrendered SPA shell: HTTP ${home.status} but ${homePage.text.length} chars of visible text without JS rendering (C-032); no absence claim may be made from this fixture`,
    };
  }
  if (home.status !== 200 || !homePage.text) {
    return {
      domain,
      fetched_at: fetchedAt,
      unreachable: true,
      note: `no usable content: HTTP ${home.status}, visible text ${homePage.text.length} chars`,
    };
  }

  const fullHomeText = stripHtml(home.body);
  const pages = [homePage];
  const secondaries = discoverSecondaryLinks(home.body, home.finalUrl, MAX_PAGES_PER_DOMAIN - 1);
  for (const link of secondaries) {
    if (pages.length >= MAX_PAGES_PER_DOMAIN) break;
    await sleep(INTER_FETCH_PAUSE_MS);
    try {
      const res = await fetchFollowingRedirects(link);
      if (res.status !== 200) continue;
      const p = buildBundlePage(res.finalUrl, res.body);
      if (!p.text || looksLikeChallengePage(res.status, p.text, p.title)) continue;
      pages.push(p);
    } catch (e) {
      // A missing secondary page never fabricates anything; the homepage stands alone.
    }
  }

  const fixture = {
    domain,
    fetched_at: fetchedAt,
    corpus: {
      pages,
      footerText: fullHomeText.slice(-FOOTER_CHARS),
    },
    registers: {},
  };
  return trimToBudget(fixture, MAX_FIXTURE_BYTES);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const args = argv.slice(2);
  const listOnly = args.includes('--list');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  const refSet = JSON.parse(fs.readFileSync(REF_SET, 'utf8'));
  let domains = refSet.firms.map((f) => f.domain);
  if (only) domains = domains.filter((d) => d === only);
  if (!domains.length) {
    console.error(only ? `domain not in reference set: ${only}` : 'no domains found');
    return 2;
  }
  if (listOnly) {
    for (const d of domains) console.log(d);
    return 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let ok = 0;
  let blocked = 0;
  for (const domain of domains) {
    process.stdout.write(`${domain} ... `);
    const fixture = await buildFixtureForDomain(domain);
    const outPath = path.join(OUT_DIR, `${domain}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
    if (fixture.unreachable) {
      blocked++;
      console.log(`UNREACHABLE (${fixture.note})`);
    } else {
      ok++;
      const bytes = fs.statSync(outPath).size;
      console.log(`OK (${fixture.corpus.pages.length} page(s), ${bytes} bytes${fixture.trimmed ? ', trimmed' : ''})`);
    }
    await sleep(INTER_FETCH_PAUSE_MS);
  }
  console.log(`\ndone: ${ok} fetched clean, ${blocked} unreachable/blocked, ${domains.length} total`);
  return 0;
}

if (require.main === module) {
  main(process.argv).then(
    (code) => process.exit(code),
    (e) => { console.error(e && e.stack || e); process.exit(2); }
  );
}

module.exports = {
  decodeEntities,
  stripHtml,
  extractTitle,
  extractOgSiteName,
  extractJsonLd,
  discoverSecondaryLinks,
  looksLikeChallengePage,
  looksLikeSpaShell,
  trimToBudget,
  buildBundlePage,
  buildFixtureForDomain,
  MAX_FIXTURE_BYTES,
  MAX_TEXT_CHARS,
  FOOTER_CHARS,
};
