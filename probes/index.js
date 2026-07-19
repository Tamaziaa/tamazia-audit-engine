'use strict';
// probes/index.js - the SEO/GEO probe orchestrator. THE seam that threads real PageSpeed, keyword-map,
// authority, ai-readiness and geo-probe data into `payload.seo` / `payload.geo` / `payload.competitors`
// in the EXACT shapes payload/composer/sections.js's not-probed doctrine already promises the schema
// (same required keys, same exact-count invariants: geo.engines=8, geo.rootCause.chain=4). Where the
// old estate's `not_probed` meant "we never even tried", every leaf here is either REAL measured data
// or an explicit `{ state: 'probe_unavailable', reason }` marker - "we tried and could not" - per the
// mission brief's instruction to abolish the not-probed-that-renders-as-probed confusion. Passed to
// compose() as `inputs.seo` / `inputs.geo` / `inputs.competitors`, sections.js's `given()` uses this
// object VERBATIM (Rule 1: one producer of these leaves; sections.js never re-derives them once supplied).
//
// FAIL-OPEN JUSTIFICATION (Rule 4/caution.md swallow-gate): every probe call in here is wrapped so a
// single provider outage, a bad API response or a network timeout degrades ONLY that leaf to
// `probe_unavailable` and never throws out of runProbes(). This is a deliberate, written fail-open: SEO
// and GEO analysis is supplementary commercial insight, never a legal compliance finding (Rule 3/Rule 10
// do not apply to this data class), so a probe outage must degrade the marketing section of the report,
// not abort or fail the mint. Nothing here EVER downgrades or bypasses a compliance finding.
//
// Rule 9 (hard deadlines): the whole lane races against PROBE_LANE_DEADLINE_MS so a pathological hang in
// any one probe can never hold the mint hostage; whatever has not settled by the deadline is recorded as
// `probe_unavailable: deadline_exceeded` for its own leaves only.

const { raceWithDeadline } = require('../evidence/browser/deadline.js');
const { keywordsFromCorpus } = require('../payload/composer/sections.js');
const pagespeed = require('./pagespeed.js');
const onpageSignals = require('./onpage-signals.js');
const keywordMapMod = require('./keyword-map.js');
const authorityGapMod = require('./authority-gap.js');
const competitorOverlapMod = require('./competitor-overlap.js');
const aiReadinessMod = require('./ai-readiness.js');
const geoProbeMod = require('./geo-probe.js');
const geoVisuals = require('./geo-visuals.js');

const PROBE_LANE_DEADLINE_MS = 45000; // a CAP on the WHOLE seo/geo lane (Rule 8); the mint's compliance
// spine is never blocked on marketing data. Individual probes carry their own tighter deadlines too.

function unavailable(reason, extra) { return Object.assign({ state: 'probe_unavailable', reason: reason || 'unknown' }, extra || {}); }

// settle(promise, fallbackReason) -> the resolved value, or an { ok:false, reason } shape when the
// promise rejects (a probe module is expected to resolve its own {ok:false,...} on failure; this is
// defence in depth for a genuinely unexpected throw, which is otherwise the swallow-gate's business).
async function settle(promise, fallbackReason) {
  try { return await promise; }
  catch (e) { return { ok: false, reason: fallbackReason, error: String((e && e.message) || e).slice(0, 160) }; }
}

function corpusText(corpus) {
  const pages = (corpus && Array.isArray(corpus.pages)) ? corpus.pages : [];
  return pages.map((p) => (p && p.text) || '').join(' ').slice(0, 4000);
}

// ── section shapers: probe results -> the exact compose()-ready leaf shapes ────────────────────────────

// ── SEO leaf shapers: each takes just the probe result(s) it needs and returns ONE payload leaf, so
// shapeSeo() itself is a flat list of calls with no branching of its own. ─────────────────────────────
function seoPsi(ps) { return ps.ok ? { mobile: ps.mobile, desktop: ps.desktop, state: 'measured' } : unavailable(ps.reason); }
function seoCwv(ps) { return ps.ok ? { mobile: ps.mobile && ps.mobile.cwv, desktop: ps.desktop && ps.desktop.cwv, state: 'measured' } : unavailable(ps.reason); }
function seoPsiAudits(ps) { return ps.ok ? { mobile: (ps.mobile && ps.mobile.audits) || [], state: 'measured' } : unavailable(ps.reason); }
function onpageLeaf(onp, key) { return onp.ok ? onp[key] : unavailable(onp.reason); }
function seoKeywordSummary(kwMap) { return kwMap.ok ? { service_noun: kwMap.service_noun, city: kwMap.city, count: kwMap.keywords.length, state: 'measured' } : unavailable(kwMap.reason); }
function seoKeywords(kwMap, corpus) {
  if (kwMap.ok && kwMap.keywords.length) return kwMap.keywords.map((k) => Object.assign({ state: 'measured' }, k));
  const derived = keywordsFromCorpus(corpus);
  return derived || [{ term: null, state: 'probe_unavailable', reason: kwMap.reason }];
}

function shapeSeo({ ps, onp, kwMap, corpus }) {
  return {
    psi: seoPsi(ps),
    cwv: seoCwv(ps),
    onpage: onpageLeaf(onp, 'onpage'),
    security: onpageLeaf(onp, 'security'),
    a11y: onpageLeaf(onp, 'a11y'),
    tech: onpageLeaf(onp, 'tech'),
    keywordSummary: seoKeywordSummary(kwMap),
    psiAudits: seoPsiAudits(ps),
    keywords: seoKeywords(kwMap, corpus),
    note: 'SEO signals: real PageSpeed Insights + live SERP keyword map where keys/city were available; a leaf carries state:probe_unavailable when its underlying key or input was absent.',
  };
}

// ── root-cause chain: one row-builder per signal, so buildRootCauseChain() is just an array literal. ──
function rowCrawlerAccess(air) {
  return { label: 'Crawler access', ok: air.ok ? air.blocked_ai_bots.length === 0 : null, state: air.ok ? 'measured' : 'probe_unavailable' };
}
function rowIdentityAnchors(air) {
  return { label: 'Identity anchors', ok: air.ok ? (air.has_org_schema && air.has_same_as) : null, state: air.ok ? 'measured' : 'probe_unavailable' };
}
function rowKnowledgeGraph(air) {
  return { label: 'Knowledge graph', ok: air.ok ? air.in_wikidata : null, state: air.ok ? 'measured' : 'probe_unavailable' };
}
function rowShareOfVoice(gp) {
  return { label: 'Share of voice', ok: gp.ok && typeof gp.share_of_voice === 'number' ? gp.share_of_voice >= 50 : null, state: gp.ok ? 'measured' : 'probe_unavailable' };
}
function buildRootCauseChain(air, gp) {
  const chain = [rowCrawlerAccess(air), rowIdentityAnchors(air), rowKnowledgeGraph(air), rowShareOfVoice(gp)];
  return { state: chain.every((l) => l.state === 'measured') ? 'measured' : 'partial', chain };
}

// ── fix gaps: one predicate per gap, filtered rather than pushed conditionally, same push order. ──────
function fixGapOpenRobots(air) { return air.blocked_ai_bots.length ? 'open robots.txt for: ' + air.blocked_ai_bots.join(', ') : null; }
function fixGapLlmsTxt(air) { return air.has_llms_txt ? null : 'publish an llms.txt'; }
function fixGapOrgSchema(air) { return air.has_org_schema ? null : 'ship Organization/LocalBusiness schema'; }
function fixGapSameAs(air) { return air.has_same_as ? null : 'add sameAs links to authoritative profiles'; }
function fixGapWikidata(air) { return air.in_wikidata ? null : 'establish a Wikidata entity'; }
function fixGapShareOfVoice(gp) { return (gp.ok && typeof gp.share_of_voice === 'number' && gp.share_of_voice < 50) ? 'build the content/authority signals that lift AI share of voice' : null; }

function buildFix(air, gp) {
  if (!air.ok) return unavailable(air.reason);
  const gaps = [fixGapOpenRobots(air), fixGapLlmsTxt(air), fixGapOrgSchema(air), fixGapSameAs(air), fixGapWikidata(air), fixGapShareOfVoice(gp)].filter(Boolean);
  return { gaps, state: 'measured' };
}

// ── GEO leaf shapers: same one-leaf-per-function discipline as the SEO shapers above. ──────────────────
function geoEntityReadiness(air) {
  return air.ok ? { score: air.score, blocked_ai_bots: air.blocked_ai_bots, has_llms_txt: air.has_llms_txt, has_org_schema: air.has_org_schema, has_same_as: air.has_same_as, in_wikidata: air.in_wikidata, state: 'measured' } : unavailable(air.reason);
}
function geoShareOfVoice(gp) {
  return gp.ok ? { value: gp.share_of_voice, repeatability: gp.repeatability, samples: gp.samples, provider: gp.provider, top_competitors: gp.top_competitors, state: 'measured' } : unavailable(gp.reason);
}
function geoDr(auth) { return auth.ok && auth.you ? auth.you.dr : NaN; }
function geoRadar(air, gp, dr) {
  return air.ok ? { axes: geoVisuals.radarAxes(air, gp.ok ? gp.share_of_voice : null, dr), state: 'measured' } : unavailable(air.reason);
}
function geoSchema(air) {
  return air.ok ? { has_org_schema: air.has_org_schema, has_localbusiness: air.has_localbusiness, has_service: air.has_service, has_faq: air.has_faq, has_same_as: air.has_same_as, state: 'measured' } : unavailable(air.reason);
}
function geoCitations(gp) {
  return (gp.ok && gp.grounded) ? Object.assign({ state: 'measured' }, gp.grounded) : unavailable(gp.ok ? 'no_grounding_data' : gp.reason);
}
function geoSourceGap(air) {
  return air.ok ? { in_wikidata: air.in_wikidata, has_llms_txt: air.has_llms_txt, state: 'measured' } : unavailable(air.reason);
}
function geoEngines(air, gp) {
  return air.ok ? geoVisuals.engineGrid(air, gp.ok ? gp.share_of_voice : null) : Array.from({ length: 8 }, () => ({ engine: null, state: 'probe_unavailable', reason: air.reason }));
}

function shapeGeo({ air, gp, auth }) {
  const dr = geoDr(auth);
  return {
    entityReadiness: geoEntityReadiness(air),
    shareOfVoice: geoShareOfVoice(gp),
    radar: geoRadar(air, gp, dr),
    schema: geoSchema(air),
    citations: geoCitations(gp),
    sourceGap: geoSourceGap(air),
    fix: buildFix(air, gp),
    engines: geoEngines(air, gp),
    rootCause: buildRootCauseChain(air, gp),
    note: 'GEO signals: real AI-entity readiness (robots.txt/llms.txt/schema/Wikidata, zero-key) + a real multi-sample AI share-of-voice probe where a free LLM key was available. Per-engine readiness and the radar are MODELLED from these real signals (engineEstimate:true), never a per-engine live probe.',
  };
}

// ── competitors leaf shapers ─────────────────────────────────────────────────────────────────────────
function compBestKeyword(kwMap) {
  return kwMap.ok && kwMap.keywords.length ? { keyword: kwMap.keywords[0].keyword, state: 'measured' } : unavailable(kwMap.reason);
}
function compYouDr(auth) {
  return auth.ok && auth.you ? Object.assign({ state: 'measured' }, auth.you) : unavailable(auth.ok ? 'no_opr_data' : auth.reason);
}
function compRows(auth, overlap) {
  if (auth.ok && auth.top3.length) return auth.top3.map((c) => Object.assign({ name: c.domain, state: 'measured' }, c));
  if (overlap.length) return overlap.map((d) => ({ name: d, state: 'named_not_scored' }));
  return [{ name: null, state: 'probe_unavailable', reason: auth.ok ? 'no_competitor_data' : auth.reason }];
}
function compDrBars(auth) {
  if (!(auth.ok && auth.you)) return unavailable(auth.ok ? 'no_opr_data' : auth.reason);
  return auth.top3.map((c) => ({ l: c.domain, v: c.da_100 })).concat([{ l: 'You', v: auth.you.da_100, you: true }]);
}

function shapeCompetitors({ auth, overlap, kwMap }) {
  return {
    bestKeyword: compBestKeyword(kwMap),
    youDr: compYouDr(auth),
    cols: ['domain', 'da_100'],
    drBars: compDrBars(auth),
    rows: compRows(auth, overlap),
    note: 'Competitor Domain Rating is REAL OpenPageRank data only; a competitor with no public DR is never given a fabricated estimate (Rule 10 - the old estate\'s name-hash drFallback is deliberately not ported).',
  };
}

// runProbesInner(input) -> { seo, geo, competitors }. The sequenced real work (see file header for the
// dependency chain: keyword-map -> competitor-overlap/geo-probe -> authority-gap).
async function runProbesInner(input) {
  const { domain, corpus, sector, city, company, env, log } = input;
  const cText = corpusText(corpus);

  const [ps, onp, air, kwMap] = await Promise.all([
    settle(pagespeed.pagespeedProbe({ domain, env }), 'probe_threw'),
    settle(onpageSignals.onpageSignalsProbe({ domain, corpus }), 'probe_threw'),
    settle(aiReadinessMod.aiReadinessProbe({ domain, company, corpus }), 'probe_threw'),
    settle(keywordMapMod.keywordMapProbe({ domain, sector, city, corpusText: cText, env }), 'probe_threw'),
  ]);

  const query = kwMap.ok ? (kwMap.service_noun + (kwMap.city ? ' ' + kwMap.city : '')) : (sector ? String(sector).replace(/-/g, ' ') : null);
  const [overlapRaw, gp] = await Promise.all([
    settle(competitorOverlapMod.organicCompetitorsProbe({ keywords: kwMap.ok ? kwMap.keywords.map((k) => k.keyword) : [], domain, env }), 'probe_threw'),
    settle(geoProbeMod.geoProbeShareOfVoice({ query, company: company || domain, domain, env, log }), 'probe_threw'),
  ]);
  const overlap = Array.isArray(overlapRaw) ? overlapRaw : [];

  const auth = await settle(authorityGapMod.authorityGapProbe({ domain, competitors: overlap, env }), 'probe_threw');

  return {
    seo: shapeSeo({ ps, onp, kwMap, corpus }),
    geo: shapeGeo({ air, gp, auth }),
    competitors: shapeCompetitors({ auth, overlap, kwMap }),
  };
}

// deadlineFallback() -> the all-unavailable shape used when the whole lane blows its deadline (Rule 8/9:
// a cap, never a hang). Every required leaf/exact-count invariant is still satisfied.
function deadlineFallback() {
  const reason = 'deadline_exceeded';
  return {
    seo: shapeSeo({ ps: { ok: false, reason }, onp: { ok: false, reason }, kwMap: { ok: false, reason }, corpus: null }),
    geo: shapeGeo({ air: { ok: false, reason }, gp: { ok: false, reason }, auth: { ok: false, reason } }),
    competitors: shapeCompetitors({ auth: { ok: false, reason }, overlap: [], kwMap: { ok: false, reason } }),
  };
}

// runProbes(input) -> Promise<{ seo, geo, competitors }>. input = { domain, corpus, sector, city?,
// company?, env, log?, deadlineMs? }. Never throws (see the fail-open justification above); never
// hangs past deadlineMs (default PROBE_LANE_DEADLINE_MS).
async function runProbes(input = {}) {
  const ms = Number.isFinite(input.deadlineMs) && input.deadlineMs > 0 ? input.deadlineMs : PROBE_LANE_DEADLINE_MS;
  const raced = await raceWithDeadline(runProbesInner(input), ms);
  if (raced.timedOut) return deadlineFallback();
  return raced.value;
}

module.exports = { runProbes, unavailable, PROBE_LANE_DEADLINE_MS };
