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
const dns = require('dns');

const safePath = require('../../tools/lib/safe-path.js');

const USER_AGENT =
  'TamaziaReferenceFixtureBot/1.0 (compliance-audit reference fixtures; contact: hello@tamazia.co.uk)';
const FETCH_DEADLINE_MS = 10000; // hard cap per fetch (never a floor)
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_PAGES_PER_DOMAIN = 3;
const FOOTER_CHARS = 3000;
const MAX_FIXTURE_BYTES = 150 * 1024;
const INTER_FETCH_PAUSE_MS = 400; // politeness pause between fetches

const REF_SET = path.join(__dirname, 'reference-set.json');
const OUT_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in build-fixtures.test.js) - moved to build-fixtures-lib.js purely
// to keep this file under the health-gate file-length cap; required back in and re-exported
// below under the exact same names build-fixtures.test.js already imports.
// ---------------------------------------------------------------------------

const {
  MAX_TEXT_CHARS,
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
  stripControlChars,
  logSafe,
  isBlockedHost,
  isBlockedAddress,
  parseSafeFetchTarget,
  makeSafeLookup,
} = require('./build-fixtures-lib.js');

// The single resolved-address guard, built once from the real resolver. Passed as the request
// `lookup` option (below) so every DNS answer - initial hop AND every redirect hop - is validated
// against the private/loopback/link-local blocklist before a socket is opened. The hostname string
// is checked by parseSafeFetchTarget; the resolved IP is checked here; one door decides both.
const safeLookup = makeSafeLookup(dns.lookup);

// ---------------------------------------------------------------------------
// Network layer (deadline-wrapped; never used by facts modules)
// ---------------------------------------------------------------------------

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    // Single door: every hop (initial attempt AND every redirect, since redirects re-enter here)
    // is re-parsed and re-validated for host safety before a socket is opened. A hostname-shaped
    // string is never trusted; localhost/loopback/private/link-local targets are refused (CR#21).
    const u = parseSafeFetchTarget(url);
    if (!u) return reject(new Error(`refused unsafe or malformed fetch target: ${url}`));
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
        // Pin the connection to a resolved address that has passed the private/loopback/link-local
        // blocklist. Without this, parseSafeFetchTarget validates only the HOSTNAME and DNS could
        // still resolve it to an internal address after the check (DNS-rebinding SSRF).
        lookup: safeLookup,
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

// isFetchableDomain(domain) -> true for a plain PUBLIC hostname shape this offline dev tool may
// fetch. The shape gate rejects non-hostname characters; the host-safety single door (isBlockedHost)
// then rejects localhost/loopback/private/link-local literals so this never duplicates host logic.
// By design: it fetches only the reference-set domains, never in the mint path.
function isFetchableDomain(domain) {
  if (!/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(domain)) return false;
  return !isBlockedHost(domain.toLowerCase());
}

// fetchHomeOrAbstain(domain, fetchedAt) -> {home} on success, or {abstain: <unreachable fixture>}
// when the homepage could not be fetched at all (every attempt in fetchHomepage failed/threw).
async function fetchHomeOrAbstain(domain, fetchedAt) {
  try {
    return { home: await fetchHomepage(domain) };
  } catch (e) {
    return { abstain: { domain, fetched_at: fetchedAt, unreachable: true, note: `fetch failed: ${e.message}` } };
  }
}

// classifyHomepage(domain, fetchedAt, home, homePage) -> an honest unreachable-fixture object
// when the homepage is a bot wall/challenge page, an unrendered SPA shell, or otherwise not
// usable content; null when the homepage is genuinely usable and the build may proceed.
function classifyHomepage(domain, fetchedAt, home, homePage) {
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
  return null;
}

// collectSecondaryPages(homePage, home) -> [homePage, ...secondary pages actually fetched], up to
// MAX_PAGES_PER_DOMAIN total. A missing/blocked secondary page never fabricates anything; the
// homepage always stands alone as pages[0].
async function collectSecondaryPages(homePage, home) {
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
  return pages;
}

async function buildFixtureForDomain(domain) {
  const fetchedAt = new Date().toISOString();
  if (!isFetchableDomain(domain)) {
    return { domain, fetched_at: fetchedAt, unreachable: true, note: 'invalid domain, refused' };
  }

  const fetched = await fetchHomeOrAbstain(domain, fetchedAt);
  if (fetched.abstain) return fetched.abstain;
  const home = fetched.home;

  const homePage = buildBundlePage(home.finalUrl, home.body);
  const abstained = classifyHomepage(domain, fetchedAt, home, homePage);
  if (abstained) return abstained;

  const fullHomeText = stripHtml(home.body);
  const pages = await collectSecondaryPages(homePage, home);

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
// --clean-existing: a one-off transform over ALREADY-WRITTEN fixtures on disk. Applies
// stripControlChars to every string field (not just the four fields the live crawl path
// covers) and rewrites the file with the same stable shape and indentation, so a fixture
// captured before this fix landed (or hand-edited) still ends up clean. Guarded behind a CLI
// flag because it mutates committed fixtures; it never runs as a side effect of a normal build.
// ---------------------------------------------------------------------------

function deepStripControlChars(value) {
  if (typeof value === 'string') return stripControlChars(value);
  if (Array.isArray(value)) return value.map(deepStripControlChars);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepStripControlChars(value[k]);
    return out;
  }
  return value;
}

function cleanExistingFixtures(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let changed = 0;
  for (const f of files) {
    // f is always a filename from fs.readdirSync() output above: a safe single PATH COMPONENT.
    const fp = safePath.safeJoin(dir, [f], { label: 'reference-set fixture clean target' });
    const before = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(before);
    const cleaned = deepStripControlChars(parsed);
    const after = JSON.stringify(cleaned, null, 2) + '\n';
    if (after !== before) {
      fs.writeFileSync(fp, after);
      changed += 1;
      console.log(`cleaned ${logSafe(f)}`);
    }
  }
  console.log(`--clean-existing: ${changed}/${files.length} fixture(s) rewritten`);
  return changed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const args = argv.slice(2);
  const listOnly = args.includes('--list');
  const cleanExisting = args.includes('--clean-existing');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  if (cleanExisting) {
    cleanExistingFixtures(OUT_DIR);
    return 0;
  }

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
      // fixture.note can carry remote-derived text (a fetched <title>, a redirect URL, a
      // network error message) - never printed to the terminal unsanitised (log-injection).
      console.log(`UNREACHABLE (${logSafe(fixture.note)})`);
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
  isFetchableDomain,
  isBlockedHost,
  isBlockedAddress,
  parseSafeFetchTarget,
  makeSafeLookup,
  stripControlChars,
  logSafe,
  deepStripControlChars,
  cleanExistingFixtures,
  MAX_FIXTURE_BYTES,
  MAX_TEXT_CHARS,
  FOOTER_CHARS,
};
