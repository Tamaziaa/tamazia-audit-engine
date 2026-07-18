'use strict';
// evidence/registers/sra.js — the SRA (Solicitors Regulation Authority) Data Sharing Platform,
// organisation search. Port source: cowork-os-fresh src/lib/compliance/register-grounding.js (the
// SRA entry: base https://data.sra.org.uk, path /organisations?name=... — a public organisation
// search that answers a bare JSON array, no subscription key required for this endpoint).
// Strengthened here with the shared name-match gate (C-004): the old register-grounding.js treated
// ANY non-empty array as establishment evidence with no scoring at all.
const { runLookup } = require('./lib/lookup-runner');
const { makeNote } = require('./lib/notes');

const SEARCH_BASE = 'https://data.sra.org.uk/organisations';

// Only a law-firms/barristers caller should pay for this lookup (Rule 8: budgets are caps, and an
// irrelevant register call is a wasted one). An unspecified sector still tries: the register itself
// can corroborate or contradict a sector guess (caution C-014), so withholding the call just because
// the sector is not yet known would defeat that purpose.
const APPLICABLE_SECTORS = new Set(['law-firms', 'barristers']);
function applies(sector) {
  return !sector || APPLICABLE_SECTORS.has(String(sector).toLowerCase());
}

function buildRequest(query, apiToken) {
  const headers = apiToken ? { Authorization: 'Bearer ' + apiToken } : {};
  const url = SEARCH_BASE + '?name=' + encodeURIComponent(query.slice(0, 80));
  return { url, headers, requestKey: 'sra.organisations' };
}

// extractCandidates(json) -> [{name, raw}]. The endpoint answers a bare array of organisation
// objects; each candidate's display name may arrive under either camelCase or snake_case field name
// depending on the API version fetched. A candidate is kept ONLY when it carries BOTH a name AND an SRA
// number: the SRA number is the register row's machine-verifiable identifier, and "NO ARTIFACT, NO
// BREACH" (Rule 3) means a name-only hit is not a verifiable register row - it is dropped, so a
// downstream finding can never rest on a matched row with sra_number:null.
function extractCandidates(json) {
  const items = Array.isArray(json) ? json : [];
  return items
    .filter((it) => it && (it.organisationName || it.name) && (it.sraNumber || it.sra_number))
    .map((it) => ({ name: String(it.organisationName || it.name || ''), raw: it }));
}

function addressLine(raw) {
  const parts = [raw.addressLine1, raw.town, raw.postcode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function buildRow(candidate) {
  const raw = candidate.raw;
  return {
    organisation_name: candidate.name || null,
    sra_number: raw.sraNumber || raw.sra_number || null,
    firm_type: raw.firmType || raw.firm_type || null,
    registered_office_address: addressLine(raw),
  };
}

async function lookupSra({ query, sector, fetchFn, deadlineMs, keys, log }) {
  if (!applies(sector)) {
    const detail = 'sector "' + sector + '" is not law-firms/barristers; SRA lookup skipped (Rule 8 budget cap)';
    return { row: null, note: makeNote({ register: 'sra', kind: 'skipped', reason: 'sector_not_applicable', detail, log }) };
  }
  const apiToken = keys && keys.sra;
  return runLookup({
    register: 'sra',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: null, // the organisation search endpoint is publicly queryable without a key
    buildRequest: () => buildRequest(query, apiToken),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupSra, applies, extractCandidates, buildRow };
