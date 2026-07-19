'use strict';
// evidence/registers/npi.js — the NPPES NPI Registry (CMS, US), organisation search.
//
// WS-Signals (ground-truth-anchoring workstream, KIMI-K3-DEEP-BLUEPRINT-2026-07-20 §B2/§C): a free,
// keyless, worldwide-reachable US federal register that maps a healthcare organisation's National
// Provider Identifier to its NUCC taxonomy code(s) — the hard signal the sector cascade needs to
// discriminate healthcare SUB-sectors (general practice vs mental health vs pharmacy vs optometry vs
// physiotherapy) instead of inferring them from body-text lexicon cues alone. No API key exists for
// this endpoint; it is a public CMS data service (LIVE-CALLED and confirmed 2026-07-20: GET
// https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=MAYO+CLINIC&limit=2&
// enumeration_type=NPI-2 answers 200 with real organisation rows carrying `basic.organization_name`,
// `number` and a `taxonomies[]` array of `{code, desc, primary, state, license}`).
//
// SCOPE: NPPES enumerates only US HIPAA-covered healthcare providers and organisations (individual
// NPI-1 and organisational NPI-2 records) — it carries NO veterinary, NO non-US, and NO non-healthcare
// entries. This module therefore only ever fires usefully for a US healthcare-family query; a firm
// outside that scope legitimately returns zero candidates (a correct, honest `no_candidates_returned`,
// never a guess).
const { runLookup } = require('./lib/lookup-runner');

const SEARCH_BASE = 'https://npiregistry.cms.hhs.gov/api/';

// Only a healthcare-family caller, or an unspecified/US-hinted one, should pay for this lookup
// (Rule 8: an irrelevant register call is a wasted one). Mirrors evidence/registers/sra.js's
// `applies()` doctrine: an unspecified sector or country still tries, because the register itself can
// corroborate or contradict a sector/jurisdiction guess (caution C-014) rather than only confirming one
// already resolved.
const APPLICABLE_SECTORS = new Set(['healthcare', 'dental', 'aesthetics']);
function applies(sector, country) {
  const sectorOk = !sector || APPLICABLE_SECTORS.has(String(sector).toLowerCase());
  const countryOk = !country || String(country).toUpperCase() === 'US';
  return sectorOk && countryOk;
}

function buildRequest(query) {
  const url = SEARCH_BASE
    + '?version=2.1'
    + '&organization_name=' + encodeURIComponent(query.slice(0, 80))
    + '&limit=5&enumeration_type=NPI-2';
  return { url, headers: {}, requestKey: 'npi.registry' };
}

// extractCandidates(json) -> [{name, raw}]. NPPES v2.1 answers {result_count, results:[...]}; each
// organisation result carries its display name at basic.organization_name.
function extractCandidates(json) {
  const results = Array.isArray(json && json.results) ? json.results : [];
  return results
    .filter((r) => r && r.basic && typeof r.basic.organization_name === 'string' && r.basic.organization_name.trim())
    .map((r) => ({ name: r.basic.organization_name, raw: r }));
}

// primaryTaxonomy(taxonomies) -> the {primary:true} entry, or the first entry, or null. NPPES allows
// multiple taxonomies per NPI (a multi-specialty clinic); the primary one is the one the register
// itself designates as the organisation's principal classification.
function primaryTaxonomy(taxonomies) {
  const list = Array.isArray(taxonomies) ? taxonomies : [];
  return list.find((t) => t && t.primary === true) || list[0] || null;
}

// _cleanTaxonomyRow(t) -> {code, desc, primary, state} for one raw NPPES taxonomy entry.
function _cleanTaxonomyRow(t) {
  return { code: t.code, desc: t.desc || null, primary: t.primary === true, state: t.state || null };
}

// _cleanTaxonomies(taxonomies) -> the raw taxonomy list normalised to row shape, dropping any
// entry with no code (a taxonomy row is useless without its NUCC code).
function _cleanTaxonomies(taxonomies) {
  return taxonomies.filter((t) => t && t.code).map(_cleanTaxonomyRow);
}

function buildRow(candidate) {
  const r = candidate.raw;
  const taxonomies = Array.isArray(r.taxonomies) ? r.taxonomies : [];
  const primary = primaryTaxonomy(taxonomies);
  return {
    name: candidate.name,
    id: r.number || null,
    enumeration_type: r.enumeration_type || null,
    taxonomy_code: primary ? primary.code : null,
    taxonomy_desc: primary ? primary.desc : null,
    taxonomies: _cleanTaxonomies(taxonomies),
  };
}

async function lookupNpi({ query, sector, country, fetchFn, deadlineMs, log }) {
  if (!applies(sector, country)) {
    return { row: null, note: null }; // Rule 8: correctly skipped, not a gap; caller never counts this against coverage.
  }
  return runLookup({
    register: 'npi',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: null, // public, keyless CMS endpoint: always attempted when applicable
    buildRequest: () => buildRequest(query),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupNpi, applies, extractCandidates, buildRow, primaryTaxonomy };
