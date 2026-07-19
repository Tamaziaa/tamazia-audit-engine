'use strict';
// probes/geo-visuals.js - pure derivation of the per-engine readiness grid and the AI-visibility radar
// from already-restored signals (ai-readiness + geo-probe + authority-gap). No I/O, no clock, no env.
//
// Faithful to the old estate's design intent (cowork-os-fresh src/lib/audit/geo-visuals.js +
// `_adapter.js` ENGINE_W weighting): the 8 named engines are a FIXED list (this engine does not run a
// live per-engine probe), and each engine's `readiness` is MODELLED from the real entity-readiness
// signals via a per-engine weighting - explicitly flagged `engineEstimate: true` throughout (Rule 10:
// a derived/modelled figure is never dressed as a direct measurement). The `cited` flag is the one real
// per-engine-independent signal this probe has: the multi-sample share-of-voice hit rate.

const ENGINES = ['ChatGPT', 'Gemini', 'Perplexity', 'Claude', 'Copilot', 'Grok', 'Meta AI', 'Google AI'];

// ENGINE_W: relative weight each engine places on (entity schema, crawler access, knowledge-graph
// presence) when forming its own readiness estimate - all engines read the same underlying signals, so
// the differences are intentionally small (this is a modelling convenience, not a measured divergence).
const ENGINE_W = {
  ChatGPT: [0.4, 0.4, 0.2], Gemini: [0.3, 0.3, 0.4], Perplexity: [0.3, 0.5, 0.2], Claude: [0.4, 0.4, 0.2],
  Copilot: [0.35, 0.35, 0.3], Grok: [0.4, 0.4, 0.2], 'Meta AI': [0.4, 0.4, 0.2], 'Google AI': [0.25, 0.25, 0.5],
};

// sig3(aiReadiness) -> [entitySignal, crawlerSignal, kgSignal], each 0-1, the three inputs ENGINE_W mixes.
function sig3(aiReadiness) {
  const r = aiReadiness || {};
  const entity = (r.has_org_schema ? 0.6 : 0) + (r.has_same_as ? 0.4 : 0);
  const crawler = Array.isArray(r.blocked_ai_bots) && r.blocked_ai_bots.length ? Math.max(0, 1 - r.blocked_ai_bots.length / 10) : 1;
  const kg = r.in_wikidata ? 1 : 0;
  return [entity, crawler, kg];
}

// engineGrid(aiReadiness, sovHitRate) -> exactly 8 { engine, readiness, cited, engineEstimate:true,
// state }. `readiness` is 0-100, modelled; `cited` is the real geo-probe hit-rate flag shared across
// engines (this probe cannot distinguish per-engine citation without a per-engine live call).
function engineGrid(aiReadiness, sovHitRate) {
  const s = sig3(aiReadiness);
  const cited = typeof sovHitRate === 'number' ? sovHitRate >= 50 : null;
  return ENGINES.map((name) => {
    const w = ENGINE_W[name];
    const readiness = Math.round(100 * (w[0] * s[0] + w[1] * s[1] + w[2] * s[2]));
    return { engine: name, readiness, cited, engineEstimate: true, state: 'modelled' };
  });
}

// radarAxes(aiReadiness, sov, authorityDr) -> the 6 fixed axes the dossier's radar binding expects:
// Entity, Crawler access, Share of voice, Schema, Knowledge graph, Citations. Each 0-100.
function radarAxes(aiReadiness, sov, authorityDr) {
  const r = aiReadiness || {};
  const s = sig3(r);
  return [
    { label: 'Entity', v: Math.round(s[0] * 100) },
    { label: 'Crawler access', v: Math.round(s[1] * 100) },
    { label: 'Share of voice', v: typeof sov === 'number' ? sov : 0 },
    { label: 'Schema', v: (r.has_org_schema ? 60 : 0) + (r.has_service ? 20 : 0) + (r.has_faq ? 20 : 0) },
    { label: 'Knowledge graph', v: Math.round(s[2] * 100) },
    { label: 'Citations', v: Number.isFinite(authorityDr) ? Math.round(authorityDr * 10) : 0 },
  ];
}

module.exports = { ENGINES, engineGrid, radarAxes, sig3 };
