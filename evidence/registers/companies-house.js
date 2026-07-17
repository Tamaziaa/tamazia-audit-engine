'use strict';
// evidence/registers/companies-house.js — UK Companies House free-tier company search.
//
// Port source: cowork-os-fresh src/lib/audit/register-check.js `_companiesHouse()` (accepted ANY
// non-empty search response as a match, caution C-004 — false establishment nexus). Strengthened
// here: a candidate is returned only when evidence/registers/lib/name-match.js scores it at or above
// MATCH_THRESHOLD against the query (see that module's header for the threshold justification and
// the near-miss rejection case this guards against).
//
// This module produces NO client-facing fact of its own (Constitution Rule 1): it only supplies a
// pre-fetched, binary-matched evidence row that facts/identity.js's readCompaniesHouseRow may then
// read from bundle.registers.companiesHouse. facts/identity.js stays the one door for legal_name,
// company_number and registered_office.
//
// Free tier: a self-service Companies House API key is required (HTTP Basic auth, the key as the
// username, no password — register one at the Companies House developer hub). An absent key means
// this lookup degrades loudly: no guess, no fabricated row.
const { runLookup } = require('./lib/lookup-runner');

const SEARCH_BASE = 'https://api.company-information.service.gov.uk/search/companies';

function buildRequest(query, apiKey) {
  const url = SEARCH_BASE + '?q=' + encodeURIComponent(query.slice(0, 80)) + '&items_per_page=5';
  const headers = { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') };
  return { url, headers, requestKey: 'companies_house.search' };
}

// extractCandidates(json) -> [{name, raw}]. The search endpoint's items array carries a display
// title and a company number per candidate; a candidate with no number is not usable evidence.
function extractCandidates(json) {
  const items = Array.isArray(json && json.items) ? json.items : [];
  return items
    .filter((it) => it && it.company_number)
    .map((it) => ({ name: String(it.title || ''), raw: it }));
}

// buildRow(candidate) -> the companies_house-specific row fields (source/fetched_at/query/match are
// added by lib/lookup-runner.js, never here). The search endpoint carries no registered-office
// address; a follow-up profile fetch would be needed to populate one. Left absent rather than
// guessed — facts/identity.js already treats a missing office as abstain, never a default.
function buildRow(candidate) {
  return {
    company_name: candidate.name || null,
    company_number: candidate.raw.company_number,
    company_status: candidate.raw.company_status || null,
    registered_office_address: null,
  };
}

async function lookupCompaniesHouse({ query, fetchFn, deadlineMs, keys, log }) {
  const apiKey = keys && keys.companiesHouse;
  return runLookup({
    register: 'companies_house',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: apiKey ? null : {
      present: false,
      reason: 'missing_key',
      detail: 'no Companies House API key supplied on keys.companiesHouse; register a free self-service key at the Companies House developer hub',
    },
    buildRequest: () => buildRequest(query, apiKey),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupCompaniesHouse, extractCandidates, buildRow };
