'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyCoverageProof } = require('./coverage-proof');
const { CODES } = require('./result');

function bundleWithPages(urls) {
  return { corpus: { pages: urls.map((url) => ({ url, title: '', text: '', jsonLd: [] })) } };
}

const goodArtifact = {
  type: 'coverage_proof',
  page_class: 'complaints',
  coverage: {
    pages: ['https://example.com/', 'https://example.com/complaints'],
    tier1_fetched: true,
    truncated: false,
  },
};

test('a coverage_proof whose pages are all in the bundle, Tier-1 fetched and not truncated is verified', () => {
  const bundle = bundleWithPages(['https://example.com/', 'https://example.com/complaints', 'https://example.com/about']);
  const r = verifyCoverageProof(goodArtifact, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.COVERAGE_PROOF_VERIFIED);
});

test('absence claim without coverage_proof REJECTED: no artifact.coverage at all', () => {
  const bundle = bundleWithPages(['https://example.com/']);
  const r = verifyCoverageProof({ type: 'coverage_proof', page_class: 'complaints' }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.COVERAGE_PROOF_MISSING_FIELDS);
});

test('an empty or missing pages list is rejected', () => {
  const bundle = bundleWithPages(['https://example.com/']);
  const empty = verifyCoverageProof({ type: 'coverage_proof', coverage: { pages: [], tier1_fetched: true, truncated: false } }, bundle);
  assert.equal(empty.code, CODES.COVERAGE_PROOF_NO_PAGES);
  const missing = verifyCoverageProof({ type: 'coverage_proof', coverage: { tier1_fetched: true, truncated: false } }, bundle);
  assert.equal(missing.code, CODES.COVERAGE_PROOF_NO_PAGES);
});

test('a coverage_proof listing a page never actually crawled is rejected (fabricated coverage claim)', () => {
  const bundle = bundleWithPages(['https://example.com/']);
  const r = verifyCoverageProof(goodArtifact, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.COVERAGE_PROOF_PAGES_NOT_IN_BUNDLE);
});

test('an entirely pageless bundle rejects every coverage_proof (nothing to prove crawl coverage against)', () => {
  const bundle = { corpus: { pages: [] } };
  const r = verifyCoverageProof(goodArtifact, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.COVERAGE_PROOF_PAGES_NOT_IN_BUNDLE);
});

test('tier1_fetched must be literally true; missing/false/truthy-but-not-boolean all reject', () => {
  const bundle = bundleWithPages(goodArtifact.coverage.pages);
  for (const tier1_fetched of [false, undefined, 1, 'true']) {
    const artifact = { ...goodArtifact, coverage: { ...goodArtifact.coverage, tier1_fetched } };
    const r = verifyCoverageProof(artifact, bundle);
    assert.equal(r.verified, false);
    assert.equal(r.code, CODES.COVERAGE_PROOF_TIER1_NOT_FETCHED);
  }
});

test('truncated must be literally false; missing/true/truthy-but-not-boolean all reject (C-024/C-025)', () => {
  const bundle = bundleWithPages(goodArtifact.coverage.pages);
  for (const truncated of [true, undefined, 1]) {
    const artifact = { ...goodArtifact, coverage: { ...goodArtifact.coverage, truncated } };
    const r = verifyCoverageProof(artifact, bundle);
    assert.equal(r.verified, false);
    assert.equal(r.code, CODES.COVERAGE_PROOF_TRUNCATED);
  }
});
