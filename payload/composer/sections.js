'use strict';
// payload/composer/sections.js - the analysis/scaffold half of the composer: SEO, GEO, competitors,
// pricing, trajectory, dims, scoring and the narrative scaffold (exec, heat, glossary, projected,
// fixes). These are the sections the COMPLIANCE spine (compose.js) does not itself compute.
//
// THE HONEST-SCREENED DOCTRINE (Rule 10; caution.md C-037 spirit): every one of these sections is
// OPTIONAL engine output. When the caller supplies it, it passes through VERBATIM. When it is absent,
// this module emits a contract-VALID section whose values are either
//   (a) derived from REAL crawl-derived facts where that is deterministically possible (only SEO
//       keywords qualify today: the tokens a firm itself puts in its page titles and H1s), or
//   (b) explicit not-probed markers - every synthetic row carries `state: 'not_probed'` and the
//       section carries a plain-language `note` stating it was not probed.
// It NEVER invents a metric value: no fabricated ranking, no invented competitor name, no made-up
// score. Absence is made visible, never dressed as data. This is what keeps a partial audit honest
// instead of confidently wrong (the old estate's 16-breach cascade on an unread French site, C-037).
//
// Pure: no I/O, no clock, no env, no law/fine/regulator literal (Rule 2). The composer injects any
// timestamp via inputs; nothing here reads a clock.

const { arr, str } = require('./util.js');

const NOT_PROBED = 'not_probed';

// notProbed(extra) -> a not-probed marker leaf. A non-null object, so it satisfies the contract's
// nonNull leaves while stating plainly (state) that nothing was measured here.
function notProbed(extra) { return Object.assign({ state: NOT_PROBED }, extra || {}); }

// The section notes: plain English, no jargon-as-data. Each says, in one line, that the section was
// not probed in this run so a reader never mistakes an empty scaffold for a measured zero.
const NOTES = {
  seo: 'SEO signals were not probed in this audit run; no on-page, performance or keyword measurements were taken.',
  geo: 'AI and GEO visibility were not probed in this audit run; no engine, entity or citation signals were measured.',
  competitors: 'The competitive set was not probed in this audit run; no competitor was identified and no ranking was measured.',
  pricing: 'Pricing analysis was not probed in this audit run.',
  trajectory: 'A trajectory was not projected in this audit run.',
  scoring: 'A headline score was not computed in this audit run; no score is asserted.',
  exec: 'An executive summary was not composed in this audit run.',
  fixes: 'A remediation plan was not composed in this audit run.',
};

// STOPWORDS: high-frequency words that are never a useful keyword signal. Small and generic (Rule 2
// safe: no law/sector/regulator term). Used only to filter tokens harvested from the firm's OWN pages.
const STOPWORDS = new Set([
  'home', 'about', 'contact', 'privacy', 'policy', 'terms', 'cookie', 'cookies', 'welcome',
  'page', 'menu', 'search', 'login', 'ltd', 'limited', 'llp', 'inc', 'company', 'services',
  'with', 'from', 'your', 'this', 'that', 'their', 'more', 'here', 'https', 'http', 'www',
]);

// tokens(s) -> lowercase word tokens of length >= 4 that are not stopwords. Deterministic.
function tokens(s) {
  return str(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

// keywordsFromCorpus(corpus) -> keyword rows harvested from the firm's OWN page titles and H1s, ranked
// by frequency, or null when there is no corpus to harvest from. Each row carries the REAL term the
// firm used and state 'derived_from_corpus' - a fact about their own site, never an invented ranking
// or search volume (no metric is attached). This is the one place the honest-screened doctrine can
// emit real data instead of a not-probed marker.
function keywordsFromCorpus(corpus) {
  const pages = arr(corpus && corpus.pages);
  const freq = new Map();
  for (const p of pages) {
    for (const tok of tokens(str(p && p.title) + ' ' + str(p && p.h1))) {
      freq.set(tok, (freq.get(tok) || 0) + 1);
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  if (ranked.length === 0) return null;
  return ranked.map(([term]) => ({ term, state: 'derived_from_corpus' }));
}

// given(value, fallbackFn) -> value verbatim when the caller supplied it (non-null), else fallbackFn().
// A supplied section is trusted; compose()'s final validatePayload fails closed on a malformed one.
function given(value, fallbackFn) { return value != null ? value : fallbackFn(); }

// buildSeo(i) - the SEO section. Real keyword terms from the corpus if present, else a single
// not-probed keyword row (NONEMPTY needs >= 1; a row object with a state field satisfies it).
function buildSeo(i) {
  return given(i.seo, () => ({
    psi: notProbed(), cwv: notProbed(), onpage: notProbed(), security: notProbed(),
    a11y: notProbed(), tech: notProbed(), keywordSummary: notProbed(), psiAudits: notProbed(),
    keywords: keywordsFromCorpus(i.corpus) || [{ term: null, state: NOT_PROBED }],
    note: NOTES.seo,
  }));
}

// buildGeo(i) - the GEO section. engines is exactly 8 and rootCause.chain exactly 4 (the exact-count
// invariants) with each slot a not-probed marker; no engine is named and no readiness is asserted.
function buildGeo(i) {
  return given(i.geo, () => ({
    entityReadiness: notProbed(), shareOfVoice: notProbed(), radar: notProbed(), schema: notProbed(),
    citations: notProbed(), sourceGap: notProbed(), fix: notProbed(),
    engines: Array.from({ length: 8 }, () => ({ engine: null, state: NOT_PROBED })),
    rootCause: { state: NOT_PROBED, chain: Array.from({ length: 4 }, () => ({ label: null, state: NOT_PROBED })) },
    note: NOTES.geo,
  }));
}

// buildCompetitors(i) - the competitive set. The rows fallback carries a null name, never an invented
// competitor (the drFallback name-hash was exactly this fabrication class).
function buildCompetitors(i) {
  return given(i.competitors, () => ({
    bestKeyword: notProbed(), youDr: notProbed(), cols: notProbed(), drBars: notProbed(),
    rows: [{ name: null, state: NOT_PROBED }],
    note: NOTES.competitors,
  }));
}

// buildPricing(i) -> { pricing, pricingNotes, upsellProof }. pricing is NONEMPTY; the two notes leaves
// are nonNull. All three carry the not-probed marker when absent.
function buildPricing(i) {
  return {
    pricing: given(i.pricing, () => [{ tier: null, state: NOT_PROBED }]),
    pricingNotes: given(i.pricingNotes, () => notProbed({ note: NOTES.pricing })),
    upsellProof: given(i.upsellProof, () => notProbed({ note: NOTES.pricing })),
  };
}

// buildDims(i) - exactly 10 dimensions. Each carries a stable key, a null label and a null score under
// the not-probed marker: the dimension slot exists (the render draws 10), but no score is invented.
function buildDims(i) {
  return given(i.dims, () => Array.from({ length: 10 }, (_, n) => ({ key: 'dim-' + (n + 1), label: null, score: null, state: NOT_PROBED })));
}

// buildTrajectory(i) - NONEMPTY; a single not-probed row when no trajectory was projected.
function buildTrajectory(i) {
  return given(i.trajectory, () => [{ state: NOT_PROBED, note: NOTES.trajectory }]);
}

// buildScoring(i) -> { score, grade, scoreBand, scoring }. No scoring stage feeds this unit, so unless
// a score is supplied the headline is a not-probed marker - the engine never invents a 58/100 (Rule 10).
function buildScoring(i) {
  return {
    score: given(i.score, () => notProbed()),
    grade: given(i.grade, () => notProbed()),
    scoreBand: given(i.scoreBand, () => notProbed()),
    scoring: given(i.scoring, () => ({ formula: notProbed(), why: notProbed(), inputs: notProbed(), bands: [notProbed()], note: NOTES.scoring })),
  };
}

// buildNarrative(i) -> the remaining scaffold leaves (exec, heat 5x5 trio, glossary, projected, fixes).
// Each is passthrough-or-not-probed; fixes is NONEMPTY so it carries a single marker row.
function buildNarrative(i) {
  return {
    exec: given(i.exec, () => notProbed({ note: NOTES.exec })),
    glossary: given(i.glossary, () => notProbed()),
    heat: given(i.heat, () => notProbed()),
    heatRows: given(i.heatRows, () => notProbed()),
    heatCols: given(i.heatCols, () => notProbed()),
    projected: given(i.projected, () => ({ wk12: notProbed(), wk24: notProbed() })),
    fixes: given(i.fixes, () => [{ state: NOT_PROBED, note: NOTES.fixes }]),
  };
}

// buildAnalysisSections(i) -> every analysis/scaffold key the contract requires, in one object the
// spine merges over its compliance keys. Order is irrelevant; each builder owns its own keys.
function buildAnalysisSections(i) {
  const input = i || {};
  return Object.assign(
    {
      seo: buildSeo(input),
      geo: buildGeo(input),
      competitors: buildCompetitors(input),
      dims: buildDims(input),
      trajectory: buildTrajectory(input),
    },
    buildPricing(input),
    buildScoring(input),
    buildNarrative(input),
  );
}

module.exports = {
  NOT_PROBED,
  NOTES,
  notProbed,
  tokens,
  keywordsFromCorpus,
  buildSeo,
  buildGeo,
  buildCompetitors,
  buildPricing,
  buildDims,
  buildTrajectory,
  buildScoring,
  buildNarrative,
  buildAnalysisSections,
};
