'use strict';
// breach/enrich.js - THE production catalogue-enrichment join (Constitution Rule 2: the compiled
// catalogue is the ONLY source of law facts; caution.md C-079, the propose -> verify -> ENRICH ->
// adjudicate seam).
//
// WHY THIS EXISTS. breach/proposers/propose.js's candidate() emits only the ROUTING skeleton of a
// candidate - { record_id, artifact, page_url, duty_idx, kind, ... } - deliberately carrying NO
// description, NO law name and NO lifted evidence quote (Rule 2: a proposer never authors a law fact). But
// breach/adjudicator/adjudicate.js's briefOf()/evidenceText()/claimFor() read description /
// statutory_citation / framework / evidence_quote / atomic_claim, so a bare candidate reaches the model
// with an EMPTY hypothesis and abstains before it is ever really asked. This module is the JOIN that closes
// that gap: it stamps each verified candidate with the catalogue-only fields read off its compiled record,
// plus the Gate-3 atomic claim from the one door (breach/adjudicator/claim.js), so the adjudicator rules on
// a real brief. record_id, artifact, page_url, kind and every other candidate field pass through UNTOUCHED.
//
// This is the PRODUCTION twin of eval/e2e/lib/pipeline.js's enrichVerifiedCandidates(): the eval harness
// runs the same join between its verify and adjudicate stages so replay/scripted runs adjudicate real
// briefs too. The two are byte-for-byte the same behaviour by design (one join, applied identically on both
// paths); the harness keeps its own copy so eval/ never imports from breach/ (the layering rule), which is
// a KNOWN, ACCEPTED jscpd single-tool lead recorded here, not hidden (a lead is never auto-fixed).
//
// Pure and synchronous over its arguments: no I/O, no network, no clock, no env, no module-scope mutable
// state. Holds NO law/fine/regulator literal (Rule 2): every field it writes is read off the record it was
// handed, never invented.

const { atomicClaimFor } = require('./adjudicator/claim.js');

// catalogueRecordIndex(records) -> Map<id, record> for a fast record_id lookup. A record with no `id` is
// skipped (never indexed under undefined); a non-array/absent `records` yields an empty Map so the join
// always degrades to "no catalogue record found" rather than throwing.
function catalogueRecordIndex(records) {
  const idx = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (rec && rec.id) idx.set(rec.id, rec);
  }
  return idx;
}

// obligationTextFor(record, dutyIdx) -> the catalogue's OWN obligation prose for one duty (this becomes the
// adjudicator's Gate-3 HYPOTHESIS basis and the finding's `description`). Reads
// record.website_obligations[dutyIdx].duty; falls back to the record's own name; never invents text (Rule 2:
// a literal obligation string here would itself be a catalogue-lint violation - this always READS the record).
function obligationTextFor(record, dutyIdx) {
  const duties = record && Array.isArray(record.website_obligations) ? record.website_obligations : [];
  const at = Number.isInteger(dutyIdx) ? dutyIdx : 0;
  const duty = duties[at] && duties[at].duty;
  if (typeof duty === 'string' && duty) return duty;
  return record && record.name ? String(record.name) : '';
}

// citationTextFor(record) -> the catalogue's own citation string (section, else act, else url) for the
// finding's `statutory_citation`. Rule 2: the compiled catalogue is the only source of a citation; a
// missing/malformed citation block yields '' rather than a guess.
function citationTextFor(record) {
  const cite = record && record.citation;
  if (!cite) return '';
  return String(cite.section || cite.act || cite.url || '');
}

// quoteFromArtifact(candidate) -> the verified verbatim quote lifted from a QUOTE-typed artifact (Gate 2's
// own string-matched span), or '' for anything else (an absence/behavioural/register candidate has no quote
// to lift). Never re-derives the quote; it only reads what the verifier already matched onto the artifact.
function quoteFromArtifact(candidate) {
  const art = candidate && candidate.artifact;
  if (!art || art.type !== 'quote') return '';
  return String(art.quote != null ? art.quote : (art.text != null ? art.text : ''));
}

// joinCatalogueFacts(candidate, record) -> the finding the adjudicator actually rules on: the bare
// candidate merged with the catalogue-only fields (description, framework, statutory_citation) plus the
// verified quote lifted to evidence_quote and the Gate-3 atomic claim. Every candidate field passes through
// UNTOUCHED (Object.assign onto a fresh copy, never mutating the input). A record_id with no compiled record
// (a stale/test id) degrades to empty catalogue-derived fields rather than throwing.
function joinCatalogueFacts(candidate, record) {
  const quote = quoteFromArtifact(candidate);
  return Object.assign({}, candidate, {
    description: obligationTextFor(record, candidate && candidate.duty_idx),
    framework: record ? String(record.name || '') : '',
    statutory_citation: citationTextFor(record),
    evidence_quote: quote || undefined,
    evidence_source_id: (candidate && candidate.page_url) || undefined,
    checked_urls: (candidate && candidate.page_url) ? [candidate.page_url] : undefined,
    // The Gate-3 (Rule 12 gate 3) hypothesis computed from the FULL catalogue record via the one door
    // (breach/adjudicator/claim.js). For a presence-breach this is the atomic BREACH claim the verbatim
    // quote must ENTAIL, not the obligation duty (`description` stays the duty for the adjudication prompt;
    // only the NLI hypothesis differs). For non-presence kinds the door returns the duty, so it equals
    // description - absence/coverage/register/observed keep their existing hypothesis basis unchanged.
    atomic_claim: atomicClaimFor(record, candidate),
  });
}

// enrichVerifiedCandidates(candidates, catalogueRecords) -> every verified candidate joined to its compiled
// catalogue record BEFORE the adjudicator sees it (Rule 2). Builds the record index once per call; a
// candidate whose record_id resolves to no record still passes through (joinCatalogueFacts degrades
// honestly rather than dropping the candidate or crashing the lane).
function enrichVerifiedCandidates(candidates, catalogueRecords) {
  const idx = catalogueRecordIndex(catalogueRecords);
  return (Array.isArray(candidates) ? candidates : []).map((c) => joinCatalogueFacts(c, idx.get(c && c.record_id) || null));
}

module.exports = {
  enrichVerifiedCandidates,
  joinCatalogueFacts,
  catalogueRecordIndex,
  obligationTextFor,
  citationTextFor,
  quoteFromArtifact,
};
