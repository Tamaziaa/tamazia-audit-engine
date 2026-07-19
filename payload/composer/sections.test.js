'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./sections.js');

test('buildAnalysisSections: with no inputs, every section is contract-valid and honestly not-probed', () => {
  const a = S.buildAnalysisSections({});
  // exact-count invariants hold on the not-probed scaffolds
  assert.equal(a.dims.length, 10);
  assert.equal(a.geo.engines.length, 8);
  assert.equal(a.geo.rootCause.chain.length, 4);
  // NONEMPTY arrays are non-empty
  for (const arrKey of [a.seo.keywords, a.competitors.rows, a.pricing, a.trajectory, a.dims, a.geo.engines]) {
    assert.ok(Array.isArray(arrKey) && arrKey.length >= 1);
  }
});

test('not-probed doctrine: every synthetic row is marked not_probed and each section carries a plain note', () => {
  const a = S.buildAnalysisSections({});
  assert.equal(a.seo.keywords[0].state, 'not_probed');
  assert.equal(a.seo.note, S.NOTES.seo);
  assert.ok(a.geo.engines.every((e) => e.state === 'not_probed' && e.engine === null));
  assert.ok(a.geo.rootCause.chain.every((c) => c.state === 'not_probed'));
  assert.equal(a.geo.note, S.NOTES.geo);
  assert.equal(a.competitors.rows[0].name, null); // never an invented competitor name
  assert.equal(a.competitors.rows[0].state, 'not_probed');
  assert.ok(a.dims.every((d) => d.score === null && d.state === 'not_probed'));
  assert.equal(a.pricing[0].state, 'not_probed');
  assert.equal(a.trajectory[0].state, 'not_probed');
  assert.equal(a.score.state, 'not_probed'); // no invented headline score (Rule 10)
  assert.equal(a.grade.state, 'not_probed');
  assert.equal(a.exec.state, 'not_probed');
});

test('passthrough: a supplied section is used verbatim, not replaced by a placeholder', () => {
  const realSeo = { psi: { score: 88 }, keywords: [{ term: 'conveyancing', rank: 12 }] };
  const a = S.buildAnalysisSections({ seo: realSeo });
  assert.equal(a.seo, realSeo);
  const realDims = Array.from({ length: 10 }, (_, n) => ({ key: 'd' + n, score: n }));
  assert.equal(S.buildAnalysisSections({ dims: realDims }).dims, realDims);
});

test('keywordsFromCorpus: harvests the firm\'s OWN title/H1 tokens, ranked, no invented metric', () => {
  const corpus = { pages: [
    { title: 'Conveyancing Solicitors London', h1: 'Conveyancing and Probate' },
    { title: 'Probate Services', h1: 'Probate' },
  ] };
  const kws = S.keywordsFromCorpus(corpus);
  assert.ok(Array.isArray(kws) && kws.length >= 1);
  assert.equal(kws[0].term, 'probate'); // most frequent real token
  assert.ok(kws.every((k) => k.state === 'derived_from_corpus'));
  // honest: it never attaches a rank/volume metric it did not measure
  assert.ok(kws.every((k) => !('rank' in k) && !('volume' in k)));
});

test('buildSeo: a corpus present derives real keyword rows instead of the not-probed marker', () => {
  const seo = S.buildSeo({ corpus: { pages: [{ title: 'Immigration Appeals', h1: 'Immigration' }] } });
  assert.equal(seo.keywords[0].term, 'immigration');
  assert.equal(seo.keywords[0].state, 'derived_from_corpus');
});

// KNOWN-BAD calibration: a corpus with ONLY stopwords/short tokens yields no real keyword, so buildSeo
// must fall back to the explicit not-probed marker rather than emit an empty NONEMPTY array or a junk term.
test('KNOWN-BAD keywordsFromCorpus: an all-stopword corpus yields null, and buildSeo falls back honestly', () => {
  assert.equal(S.keywordsFromCorpus({ pages: [{ title: 'Home About Contact', h1: 'Privacy Terms' }] }), null);
  const seo = S.buildSeo({ corpus: { pages: [{ title: 'Home', h1: 'About' }] } });
  assert.equal(seo.keywords.length, 1);
  assert.equal(seo.keywords[0].term, null);
  assert.equal(seo.keywords[0].state, 'not_probed');
});
