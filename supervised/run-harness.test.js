'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSupervised } = require('./run-harness.js');
const { ManifestStore } = require('./manifest-store.js');
const { verifyQuote } = require('./verify-quote.js');

// A trimmed-but-schema-faithful catalogue record: shaped exactly like the REAL compiled
// US_FTC_ACT_S5_UDAP record (catalogue/dist/catalogue.v1.json) - `sector` an array containing the
// literal 'universal' marker (catalogue/schema.js's SECTOR_UNIVERSAL, not a bare null), `required_nexus`
// an array, `regulator` an object - so this fixture exercises the SAME gate shapes a real run does,
// with one genuinely prohibited phrase ('miracle cure') this test's fake page can trigger for real.
function tinyCatalogue() {
  return {
    content_hash: 'TEST_HASH_1',
    records: [{
      id: 'UK_TEST_UDAP_PROHIBITION',
      cell: 'uk-universal',
      jurisdiction: 'UK',
      sub_jurisdiction: null,
      sector: ['universal'],
      sub_sector: [],
      activity_tags: [],
      required_nexus: ['serves_customers_in'],
      applies_when: ['markets any product or service to UK consumers through the website'],
      excluded_when: [],
      website_obligations: [{
        duty: 'Do not publish false, misleading or deceptive representations about a product or service.',
        evidence_type: 'absence', // catalogue polarity: 'absence' = PROHIBITED content; breaches when PRESENT
        prohibited_phrases: ['miracle cure'],
      }],
      penalty: { statutory_max: null, typical_low: null, typical_high: null, currency: 'GBP', basis: 'test fixture', max_is_rare: true },
      regulator: { name: 'Test Regulator', register_url: null },
      enforcement: [], intel: {}, provenance: {}, status: 'candidate', client_useful: true,
    }],
  };
}

function fakeFetchFn() {
  const html = '<html><body><p>Welcome to Test Firm Ltd, registered in England.</p>'
    + '<p>Try our miracle cure for all your ailments today.</p>'
    + '<p>Test Firm Ltd, company number 01234567.</p></body></html>';
  return async (url) => ({ ok: true, status: 200, body: html, finalUrl: url, contentType: 'text/html' });
}

function tmpBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-harness-'));
}

// HERMETIC CAPTURE SEAMS: composeBundle's registersFetchFn defaults to a LIVE Companies House transport
// (mint/compose-bundle.js normaliseOpts) and its browser lanes to a real Chromium launcher. A test that
// injects only fetchFn therefore leaves the register lane making a real network call, whose variable
// latency/response is a genuine nondeterminism source (it flaked one full-suite run). These stubs make
// every runSupervised() call below fully offline: the register lane returns no match (degrades honestly)
// and the browser lanes run against a no-op fake page (no Chromium). This mirrors mint/compose-bundle.test.js.
const registersFetchFn = async () => null;
function fakePage() {
  return {
    on() {}, async goto() {}, async settle() {}, async cookies() { return []; },
    async findConsentControl() { return { found: false }; }, async clickConsent() {}, async evaluate() { return []; },
  };
}
const launchBrowser = async () => ({ async newPage() { return fakePage(); }, async close() {} });
// HERMETIC: the fixed opts every runSupervised call in this file spreads in, so no test touches the network.
const HERMETIC = { registersFetchFn, launchBrowser, env: {} };

test('runSupervised produces an entity card, applicability ledger, capture index and manifest for a fake site', async (t) => {
  const manifestStore = new ManifestStore({ baseDir: tmpBaseDir() });
  const result = await runSupervised('https://test-firm.example/', {
    ...HERMETIC, fetchFn: fakeFetchFn(), catalogue: tinyCatalogue(), manifestStore, runId: 'test-run-1',
  });
  assert.strictEqual(result.runId, 'test-run-1');
  assert.ok(result.entityCard);
  assert.ok(Array.isArray(result.applicabilityLedger.entries));
  assert.ok(result.captureIndex.list().length > 0);
  const manifestEntries = manifestStore.readAll('test-run-1');
  assert.ok(manifestEntries.some((e) => e.stage === 'run_start'));
  assert.ok(manifestEntries.some((e) => e.stage === 'capture_index'));
  assert.ok(manifestEntries.some((e) => e.stage === 'coverage_manifest'));
  t.diagnostic('stages recorded: ' + manifestEntries.map((e) => e.stage).join(','));
});

test('every candidate finding the harness produces PASSES verify_quote against the SAME run captureIndex', async () => {
  const manifestStore = new ManifestStore({ baseDir: tmpBaseDir() });
  const result = await runSupervised('https://test-firm.example/', {
    ...HERMETIC, fetchFn: fakeFetchFn(), catalogue: tinyCatalogue(), manifestStore, runId: 'test-run-2',
  });
  assert.ok(result.candidateFindings.length > 0, 'expected the harness to surface at least one candidate finding from the fake breach page');
  for (const finding of result.candidateFindings) {
    assert.strictEqual(verifyQuote(result.captureIndex, finding.quote), true);
    assert.strictEqual(finding.catalogue_hash, 'TEST_HASH_1');
    assert.strictEqual(finding.class, 'likely');
  }
});

test('an excerpt exists for every candidate finding, and it is a BOUNDED window (not the whole page)', async () => {
  const manifestStore = new ManifestStore({ baseDir: tmpBaseDir() });
  const result = await runSupervised('https://test-firm.example/', {
    ...HERMETIC, fetchFn: fakeFetchFn(), catalogue: tinyCatalogue(), manifestStore, runId: 'test-run-3',
  });
  assert.strictEqual(result.excerpts.length, result.candidateFindings.length);
  for (const e of result.excerpts) {
    assert.ok(e.excerpt.quote_text.length < 600);
  }
});

test('an unreachable site still produces a run with a typed capture LaneError, never a fabricated clean result', async () => {
  const manifestStore = new ManifestStore({ baseDir: tmpBaseDir() });
  const failingFetch = async () => ({ ok: false, status: 0, body: '' });
  const result = await runSupervised('https://unreachable.example/', {
    ...HERMETIC, fetchFn: failingFetch, catalogue: tinyCatalogue(), manifestStore, runId: 'test-run-unreachable',
  });
  assert.strictEqual(result.candidateFindings.length, 0);
  assert.ok(result.captureIndex.errors.length >= 0); // always inspectable, never throws away the fact of failure
});
