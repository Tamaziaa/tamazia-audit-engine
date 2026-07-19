'use strict';
// probes/index.test.js - orchestration + structural-parity tests for runProbes(). All three cases share
// ONE mutable `global.fetch` seam (no probe module below this orchestrator accepts its own fetch/fetchImpl
// injection), so they are nested as SEQUENTIAL subtests of one parent test (`await t.test(...)`, which
// Node's test runner guarantees completes fully before the next line runs) rather than three independent
// top-level tests - node:test's default runner concurrency otherwise interleaves top-level tests within a
// file, and two tests racing to set/restore the SAME `global.fetch` corrupts whichever is mid-flight.
const test = require('node:test');
const assert = require('node:assert');
const { runProbes } = require('./index.js');
const { buildSeo, buildGeo, buildCompetitors } = require('../payload/composer/sections.js');
const { validatePayload } = require('../payload/contract');
const { compose } = require('../payload/composer/compose.js');

const originalFetch = global.fetch;
function withFetch(impl, fn) {
  global.fetch = impl;
  return fn().finally(() => { global.fetch = originalFetch; });
}

const CORPUS = { pages: [{ url: 'https://acme-dental.co.uk/', title: 'Acme Dental | Dental Clinic London', text: 'Acme Dental is a dental clinic in London offering implants and whitening.', jsonLd: [] }] };

// router()/json()/text(): a Response-shaped fake covering every real endpoint this orchestrator's probes
// call, for the "real numbers flow through" case. Supports BOTH .text() (probes/lib/net.js's own
// primitive) AND .json() (llm/providers/chain.js's doFetch calls res.json() directly) - two genuinely
// different real call sites in this codebase, so the fake must answer both like a real fetch Response.
function json(body, status = 200) {
  const raw = JSON.stringify(body);
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { forEach() {} }, text: async () => raw, json: async () => body });
}
function text(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { forEach() {} }, text: async () => body, json: async () => { throw new SyntaxError('Unexpected token'); } });
}
function router(url) {
  const u = String(url);
  if (u.includes('pagespeedonline')) {
    return json({ lighthouseResult: { categories: { performance: { score: 0.7 }, seo: { score: 0.8 }, accessibility: { score: 0.9 }, 'best-practices': { score: 0.85 } }, audits: { 'largest-contentful-paint': { numericValue: 2000 }, 'cumulative-layout-shift': { numericValue: 0.05 } } } });
  }
  if (u.includes('chromeuxreport')) return json({}, 404);
  if (u.includes('google.serper.dev')) return json({ organic: [{ title: 'Rival Dental', link: 'https://rival-dental.co.uk/', position: 1 }, { title: 'Acme Dental', link: 'https://acme-dental.co.uk/', position: 3 }] });
  if (u.includes('openpagerank.com')) return json({ response: [{ domain: 'acme-dental.co.uk', status_code: 200, page_rank_decimal: '4.10', rank: 500000 }, { domain: 'rival-dental.co.uk', status_code: 200, page_rank_decimal: '6.00', rank: 100000 }], last_updated: '2026-07-01' });
  if (u.includes('/robots.txt')) return text('User-agent: *\nDisallow:\n');
  if (u.includes('/llms.txt')) return json({}, 404);
  if (u.includes('wikidata')) return json({ search: [] });
  if (u.includes('generativelanguage.googleapis.com')) return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ names: ['Acme Dental', 'Rival Dental'] }) }] } }] });
  if (u.includes('groq.com')) return json({ choices: [{ message: { content: JSON.stringify({ names: ['Acme Dental', 'Rival Dental'] }) } }] });
  return json({}, 404);
}
const alwaysUnreachable = () => Promise.resolve({ ok: false, status: 0, headers: { forEach() {} }, text: async () => '' });

test('probes/index.js runProbes() orchestration', async (t) => {
  await t.test('STRUCTURAL PARITY: output carries the EXACT same required keys as sections.js\'s not-probed baseline (keys/shapes must not differ; values may)', async () => {
    await withFetch(alwaysUnreachable, async () => {
      const out = await runProbes({ domain: 'acme-dental.co.uk', corpus: CORPUS, sector: 'dental', env: {} });
      const baseline = { seo: buildSeo({}), geo: buildGeo({}), competitors: buildCompetitors({}) };
      assert.deepStrictEqual(Object.keys(out.seo).sort(), Object.keys(baseline.seo).sort());
      assert.deepStrictEqual(Object.keys(out.geo).sort(), Object.keys(baseline.geo).sort());
      assert.deepStrictEqual(Object.keys(out.competitors).sort(), Object.keys(baseline.competitors).sort());
      // exact-count invariants hold identically whether or not the probes actually found data:
      assert.strictEqual(out.geo.engines.length, 8);
      assert.strictEqual(out.geo.rootCause.chain.length, 4);
      assert.ok(out.seo.keywords.length >= 1);
      assert.ok(out.competitors.rows.length >= 1);
    });
  });

  await t.test('KNOWN-BAD calibration: a fully unreachable network degrades every keyed leaf to probe_unavailable and the payload stays contract-valid through compose()', async () => {
    await withFetch(alwaysUnreachable, async () => {
      const { seo, geo, competitors } = await runProbes({ domain: 'acme-dental.co.uk', corpus: CORPUS, sector: 'dental', env: {} });
      // key-gated probes (PageSpeed, OpenPageRank, the free-LLM share-of-voice chain) abstain honestly:
      assert.strictEqual(seo.psi.state, 'probe_unavailable');
      assert.strictEqual(competitors.youDr.state, 'probe_unavailable');
      assert.strictEqual(geo.shareOfVoice.state, 'probe_unavailable');
      // ai-readiness is the ONE zero-key GEO signal (by design, see probes/ai-readiness.js's file header):
      // an unreachable robots.txt/llms.txt/Wikidata degrades to the SAME reading as "nothing found there"
      // (no bot genuinely observed blocked, no entity genuinely observed), never a crash, and the modelled
      // per-engine grid still emits exactly 8 rows flagged engineEstimate:true off that degraded reading.
      assert.strictEqual(geo.entityReadiness.state, 'measured');
      assert.strictEqual(geo.entityReadiness.has_org_schema, false);
      assert.strictEqual(geo.engines.length, 8);
      assert.ok(geo.engines.every((e) => e.engineEstimate === true));

      const payload = compose({
        domain: 'acme-dental.co.uk', generatedAt: '2026-07-20',
        facts: { identity: {}, jurisdiction: { bound: [{ jurisdiction: 'UK' }] }, sector: { value: { sector: 'dental' } } },
        applicability: { applicable: [], excluded: [], counts: {} }, findings: [], coverage: { site: {} },
        corpus: CORPUS, seo, geo, competitors,
      });
      assert.deepStrictEqual(validatePayload(payload), []);
    });
  });

  // 3. Real-shaped mocked responses across every endpoint: proves REAL numbers flow through where the
  //    engine previously emitted not_probed placeholders (the mission's central proof, at the unit level;
  //    the PR body carries the actual live-network run against a real domain).
  await t.test('threads REAL PageSpeed + real live SERP keyword/authority + real GEO share-of-voice numbers into the exact payload.seo/geo/competitors shapes (was not_probed before this port)', async () => {
    await withFetch((url) => router(String(url)), async () => {
      const out = await runProbes({
        domain: 'acme-dental.co.uk', corpus: CORPUS, sector: 'dental', city: 'London', company: 'Acme Dental',
        env: { PAGESPEED_API_KEY: 'k', SERPER_KEY: 'k', OPENPAGERANK_API_KEY: 'k', GROQ_API_KEY: 'k' },
      });
      assert.strictEqual(out.seo.psi.state, 'measured');
      assert.strictEqual(out.seo.psi.mobile.perf, 0.7);
      assert.strictEqual(out.competitors.youDr.dr, 4.1);
      assert.strictEqual(out.competitors.youDr.da_100, 41);
      assert.ok(out.competitors.rows.some((r) => r.name === 'rival-dental.co.uk'));
      assert.strictEqual(out.geo.shareOfVoice.state, 'measured');
      assert.ok(typeof out.geo.shareOfVoice.value === 'number');
      assert.strictEqual(out.geo.engines.length, 8);
      assert.ok(out.geo.engines.every((e) => e.engineEstimate === true));

      const payload = compose({
        domain: 'acme-dental.co.uk', generatedAt: '2026-07-20',
        facts: { identity: {}, jurisdiction: { bound: [{ jurisdiction: 'UK' }] }, sector: { value: { sector: 'dental' } } },
        applicability: { applicable: [], excluded: [], counts: {} }, findings: [], coverage: { site: {} },
        corpus: CORPUS, seo: out.seo, geo: out.geo, competitors: out.competitors,
      });
      assert.deepStrictEqual(validatePayload(payload), []);
      assert.strictEqual(payload.seo.psi.mobile.perf, 0.7, 'the real PSI number reaches the composed payload, not a not_probed marker');
    });
  });
});
