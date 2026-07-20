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
const { withDeadline, DEFAULT_DEADLINE_MS } = require('./lib/deadline');
const { extractCompanyNumber } = require('./lib/establishment-id');
const { makeNote } = require('./lib/notes');

const SEARCH_BASE = 'https://api.company-information.service.gov.uk/search/companies';
const PROFILE_BASE = 'https://api.company-information.service.gov.uk/company/';

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

// buildProfileRow(json) -> the companies_house row shape, sourced from the PROFILE endpoint (which,
// unlike search, DOES carry a registered_office_address). Register-establishment lane addition.
function buildProfileRow(json) {
  const addr = json.registered_office_address || {};
  const line = [addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code]
    .filter(Boolean).join(', ') || null;
  return {
    company_name: json.company_name || null,
    company_number: json.company_number,
    company_status: json.company_status || null,
    registered_office_address: line,
  };
}

// lookupCompaniesHouseByNumber(companyNumber, {fetchFn, deadlineMs, keys, log}) -> {row, note}. THE
// register-establishment lane's direct path (Tier A, no name-match ambiguity): a company number
// scraped from the audited site's own footer (lib/establishment-id.js's extractCompanyNumber) is
// resolved against the PROFILE endpoint directly. A 200 with a company_number echoing back the
// queried one IS the establishment (Companies House never returns someone else's profile for a
// number you supply); a 404 is a genuine register-negative (number does not exist) and is reported
// in lookup-phrased wording, never as an accusation (Rule: register-negative != "you are
// unregistered", defamation risk) — see runRegisterEstablishmentLane's own C-004-class handling.
async function lookupCompaniesHouseByNumber(companyNumber, { fetchFn, deadlineMs, keys, log }) {
  const apiKey = keys && keys.companiesHouse;
  if (!apiKey) {
    return { row: null, note: makeNote({ register: 'companies_house', kind: 'degraded', reason: 'missing_key', detail: 'no Companies House API key supplied on keys.companiesHouse; register a free self-service key at the Companies House developer hub', log }) };
  }
  const url = PROFILE_BASE + encodeURIComponent(companyNumber);
  const headers = { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') };
  const outcome = await withDeadline(() => fetchFn(url, { headers, requestKey: 'companies_house.profile' }), deadlineMs || DEFAULT_DEADLINE_MS, 'companies_house');
  if (!outcome.ok) {
    const reason = outcome.reason === 'timeout' ? 'timeout' : 'fetch_error';
    return { row: null, note: makeNote({ register: 'companies_house', kind: 'degraded', reason, detail: 'direct profile lookup for scraped company number ' + companyNumber + ' did not complete', log }) };
  }
  const res = outcome.value;
  if (res && res.status === 404) {
    return { row: null, note: makeNote({ register: 'companies_house', kind: 'no_match', reason: 'not_found', detail: 'our lookup at ' + new Date().toISOString() + ' for company number ' + companyNumber + ' (scraped from the site footer) returned no match on the Companies House register', log }) };
  }
  if (!res || res.status !== 200 || !res.json || !res.json.company_number) {
    return { row: null, note: makeNote({ register: 'companies_house', kind: 'degraded', reason: 'unexpected_response', detail: 'direct profile lookup for ' + companyNumber + ' answered with status ' + (res && res.status), log }) };
  }
  const row = buildProfileRow(res.json);
  row.source = 'companies_house';
  row.fetched_at = new Date().toISOString();
  row.query = companyNumber;
  row.match = { name_queried: companyNumber, name_matched: row.company_number, score: 1, method: 'direct_id' };
  return { row, note: null };
}

async function lookupCompaniesHouse({ query, fetchFn, deadlineMs, keys, log, corpusText }) {
  const apiKey = keys && keys.companiesHouse;
  // Register-establishment lane: a scraped footer company number wins over the fuzzy name search
  // whenever one is present — it is a direct Tier-A route with no ambiguity, and is tried FIRST.
  const scrapedNumber = extractCompanyNumber(corpusText);
  if (scrapedNumber) {
    const direct = await lookupCompaniesHouseByNumber(scrapedNumber, { fetchFn, deadlineMs, keys, log });
    if (direct.row) return direct;
    // A scraped number that failed to resolve (not-found/degraded) still falls through to the name
    // search below rather than giving up outright (the number may have been mis-scraped); the direct
    // attempt's note is preserved by being returned only if the fallback also fails to produce a row.
    const fallback = await runLookup({
      register: 'companies_house', query, fetchFn, deadlineMs, log,
      requiredKeyNote: apiKey ? null : { present: false, reason: 'missing_key', detail: 'no Companies House API key supplied on keys.companiesHouse; register a free self-service key at the Companies House developer hub' },
      buildRequest: () => buildRequest(query, apiKey), extractCandidates, buildRow,
    });
    return fallback.row ? fallback : direct;
  }
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

module.exports = { lookupCompaniesHouse, lookupCompaniesHouseByNumber, extractCandidates, buildRow, buildProfileRow };
