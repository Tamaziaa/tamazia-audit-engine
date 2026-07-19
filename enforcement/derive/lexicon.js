'use strict';
// enforcement/derive/lexicon.js - derives violation-lexicon PROPOSALS per law_id from the
// EnforcementAction store's offending_quote fields (blueprint B4 Discipline 2: "your violation
// lexicons ... should all be derived from these corpora, not from reading statutes and guessing").
//
// WHAT THIS PRODUCES: a proposal file, never a catalogue write. Output lands under
// catalogue/lexicon-proposals/<law_id>.json - deliberately OUTSIDE catalogue/packs/ (the compiled,
// legal-QA-signed artifact) so nothing here is auto-consumed by the live mint path. Constitution
// Rule 2 (catalogue-only law facts) and Rule 14 (provenance-mandatory catalogue rows, human-gated
// promotion) both apply to catalogue/packs/; a proposal is exactly the un-promoted candidate stage
// Rule 14 already describes ("Discovered candidates are three-state (verified / rejected /
// unverifiable); only verified rows are promoted, and promotion of legal judgements is
// human-gated").
//
// NO LLM ANYWHERE IN THIS FILE. Every phrase in a proposal is a verbatim `offending_quote` already
// present in a validated EnforcementAction row, which itself was extracted deterministically (regex
// over normalised page text) by a collector, itself re-checkable against the row's stored
// (url, sha256). An LLM may only ever PROPOSE additional candidate phrases for a human/agent to
// fold in by hand-editing a collector or the store - never write here directly (mission constraint,
// restated in this file's own module doc so a future edit cannot drift past it unnoticed).

const fs = require('fs');
const path = require('path');

const { loadStore } = require('../store/store');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'out', 'lexicon-proposals');

// phraseCandidateOf(row) -> the one phrase-candidate shape pushed onto every law_id bucket a row
// contributes to.
function phraseCandidateOf(row) {
  return {
    phrase: row.offending_quote,
    source: row.source,
    entity_name: row.entity_name,
    decision_date: row.decision_date,
    url: row.url,
    sha256: row.sha256,
  };
}

// addRowPhrasesToBuckets(byLawId, row) -> void. Pushes row's phrase candidate onto every law_id
// bucket it carries, creating a bucket on first use. The one place that touches byLawId's Map API,
// kept out of groupPhrasesByLawId's own body so that function nests only one level deep (CodeScene
// Bumpy Road Ahead: a loop-inside-a-loop is two nested-conditional chunks in one function).
function addRowPhrasesToBuckets(byLawId, row) {
  for (const lawId of row.law_ids) {
    if (!byLawId.has(lawId)) byLawId.set(lawId, []);
    byLawId.get(lawId).push(phraseCandidateOf(row));
  }
}

// groupPhrasesByLawId(rows) -> Map<law_id, phraseCandidate[]>. Rows with no verbatim quote
// contribute nothing (there is no phrase to propose); every law_id a quoted row carries gets its own
// bucket.
function groupPhrasesByLawId(rows) {
  const byLawId = new Map();
  for (const row of rows) {
    if (!row.offending_quote) continue; // no verbatim quote on this row: nothing to propose
    addRowPhrasesToBuckets(byLawId, row);
  }
  return byLawId;
}

// compareByDecisionDateDesc(a, b) -> the most-recent-first comparator every phrase list is sorted
// with. Returns 0 for equal dates (Array.prototype.sort's contract requires it - a comparator that
// only ever answers -1/1 for equal inputs can produce an inconsistent order across engines).
function compareByDecisionDateDesc(a, b) {
  if (a.decision_date === b.decision_date) return 0;
  return a.decision_date < b.decision_date ? 1 : -1;
}

// toSortedProposals(byLawId, generatedAt) -> Map<law_id, LexiconProposal>, each bucket's phrases
// ordered most-recent-decision-first so a human reviewer sees the freshest evidence first.
function toSortedProposals(byLawId, generatedAt) {
  const proposals = new Map();
  for (const [lawId, phrases] of byLawId) {
    const sorted = [...phrases].sort(compareByDecisionDateDesc);
    proposals.set(lawId, { law_id: lawId, phrases: sorted, generated_at: generatedAt });
  }
  return proposals;
}

// buildLexiconProposals(rows) -> Map<law_id, LexiconProposal>. Pure function over already-loaded,
// already-validated rows (Rule 1: this module does not re-open the store file itself when called as
// a library; the CLI entry point at the bottom does that once).
//
// LexiconProposal = { law_id, phrases: [{ phrase, source, entity_name, decision_date, url, sha256 }],
//                      generated_at }
function buildLexiconProposals(rows, generatedAt) {
  return toSortedProposals(groupPhrasesByLawId(rows), generatedAt);
}

// writeLexiconProposals(proposals, outDir = DEFAULT_OUTPUT_DIR) -> string[] of written file paths.
// One JSON file per law_id, so a legal-QA reviewer can pick up and sign off a single law's proposal
// file at a time (the same per-record review discipline the catalogue's own .QA.md sidecars use).
function writeLexiconProposals(proposals, outDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [lawId, proposal] of proposals) {
    const filePath = path.join(outDir, `${lawId}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
    written.push(filePath);
  }
  return written;
}

// run(opts) -> { proposals, written } - the CLI/library entry point: load the store, derive, write.
function run(opts = {}) {
  const rows = loadStore(opts.storePath);
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const proposals = buildLexiconProposals(rows, generatedAt);
  const written = writeLexiconProposals(proposals, opts.outDir);
  return { proposals, written };
}

if (require.main === module) {
  const { written } = run();
  for (const filePath of written) process.stdout.write(`wrote ${filePath}\n`);
}

module.exports = { buildLexiconProposals, writeLexiconProposals, run, DEFAULT_OUTPUT_DIR };
