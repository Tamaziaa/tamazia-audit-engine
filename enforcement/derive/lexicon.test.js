'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildLexiconProposals, writeLexiconProposals, run } = require('./lexicon');
const { loadStore, DEFAULT_STORE_PATH } = require('../store/store');

const ROW_WITH_QUOTE = {
  id: 'ASA-TEST-0001', source: 'ASA', regulator: 'Advertising Standards Authority', jurisdiction: 'UK',
  law_ids: ['UK_MHRA_POM_AD_BAN'], entity_name: 'Test Clinic Ltd', offending_quote: 'Book your Botox today from only £49',
  decision_date: '2026-06-01', penalty_amount: null, currency: null,
  url: 'https://www.asa.org.uk/rulings/test-clinic.html', sha256: 'a'.repeat(64), summary: 'fixture',
};
const ROW_NO_QUOTE = {
  id: 'ICO-TEST-0001', source: 'ICO', regulator: "Information Commissioner's Office", jurisdiction: 'UK',
  law_ids: ['UK_GDPR_ART_5'], entity_name: 'Test Org Ltd', offending_quote: null,
  decision_date: '2026-05-01', penalty_amount: 1000, currency: 'GBP',
  url: 'https://ico.org.uk/action-weve-taken/enforcement/test-org/', sha256: 'b'.repeat(64), summary: 'fixture',
};
const ROW_SHARED_LAW = {
  id: 'ASA-TEST-0002', source: 'ASA', regulator: 'Advertising Standards Authority', jurisdiction: 'UK',
  law_ids: ['UK_MHRA_POM_AD_BAN'], entity_name: 'Another Clinic Ltd', offending_quote: 'Get your Wegovy prescription online now',
  decision_date: '2026-07-01', penalty_amount: null, currency: null,
  url: 'https://www.asa.org.uk/rulings/another-clinic.html', sha256: 'c'.repeat(64), summary: 'fixture',
};

test('buildLexiconProposals groups verbatim quotes by law_id and excludes quote-less rows', () => {
  const proposals = buildLexiconProposals([ROW_WITH_QUOTE, ROW_NO_QUOTE, ROW_SHARED_LAW], '2026-07-20T00:00:00.000Z');
  assert.equal(proposals.size, 1, 'ROW_NO_QUOTE has no offending_quote and must not create a law_id entry');
  const proposal = proposals.get('UK_MHRA_POM_AD_BAN');
  assert.equal(proposal.phrases.length, 2);
  const phraseText = proposal.phrases.map((p) => p.phrase);
  assert.ok(phraseText.includes('Book your Botox today from only £49'));
  assert.ok(phraseText.includes('Get your Wegovy prescription online now'));
});

test('buildLexiconProposals orders phrases most-recent-decision-first', () => {
  const proposals = buildLexiconProposals([ROW_WITH_QUOTE, ROW_SHARED_LAW], '2026-07-20T00:00:00.000Z');
  const proposal = proposals.get('UK_MHRA_POM_AD_BAN');
  assert.equal(proposal.phrases[0].decision_date, '2026-07-01');
  assert.equal(proposal.phrases[1].decision_date, '2026-06-01');
});

test('every phrase carries traceable provenance (url + sha256) back to its EnforcementAction row (KNOWN-BAD CALIBRATION FIXTURE would be a phrase with no source)', () => {
  const proposals = buildLexiconProposals([ROW_WITH_QUOTE], '2026-07-20T00:00:00.000Z');
  const phrase = proposals.get('UK_MHRA_POM_AD_BAN').phrases[0];
  assert.equal(phrase.url, ROW_WITH_QUOTE.url);
  assert.equal(phrase.sha256, ROW_WITH_QUOTE.sha256);
  assert.ok(phrase.url && phrase.sha256, 'a lexicon phrase with no url/sha256 provenance must never be producible');
});

test('an empty row set produces zero proposals, never a fabricated placeholder', () => {
  const proposals = buildLexiconProposals([], '2026-07-20T00:00:00.000Z');
  assert.equal(proposals.size, 0);
});

test('writeLexiconProposals writes one JSON file per law_id into a temp directory', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-proposals-'));
  const proposals = buildLexiconProposals([ROW_WITH_QUOTE, ROW_SHARED_LAW, ROW_NO_QUOTE], '2026-07-20T00:00:00.000Z');
  const written = writeLexiconProposals(proposals, outDir);
  assert.equal(written.length, 1);
  const content = JSON.parse(fs.readFileSync(written[0], 'utf8'));
  assert.equal(content.law_id, 'UK_MHRA_POM_AD_BAN');
  assert.equal(content.phrases.length, 2);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('run() against the real committed seed store yields at least one POM/aesthetics lexicon phrase traceable to a fetched ASA ruling', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-proposals-real-'));
  const { proposals } = run({ storePath: DEFAULT_STORE_PATH, outDir, generatedAt: '2026-07-20T00:00:00.000Z' });
  writeLexiconProposals(proposals, outDir);
  assert.ok(proposals.has('UK_MHRA_POM_AD_BAN'), 'expected a POM advertising lexicon proposal derived from the seeded ASA rulings');
  const pomProposal = proposals.get('UK_MHRA_POM_AD_BAN');
  assert.ok(pomProposal.phrases.length >= 1);
  const phrase = pomProposal.phrases[0];
  assert.ok(phrase.phrase.length > 0);
  assert.ok(phrase.url.startsWith('https://www.asa.org.uk/'));
  assert.match(phrase.sha256, /^[0-9a-f]{64}$/);
  // cross-check the row backing this phrase is genuinely present, and validates, in the real store
  const storeRows = loadStore(DEFAULT_STORE_PATH);
  const backingRow = storeRows.find((r) => r.sha256 === phrase.sha256 && r.offending_quote === phrase.phrase);
  assert.ok(backingRow, 'the lexicon phrase must be traceable to an actual row in the committed store');
  fs.rmSync(outDir, { recursive: true, force: true });
});
