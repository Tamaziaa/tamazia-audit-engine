'use strict';
// evidence/registers/fca.js: the FCA Financial Services Register.
//
// Port source: cowork-os-fresh src/lib/audit/register-check.js `_fca()` (accepted the first search
// result as a match, no scoring at all, C-004).
//
// SHAPE RESEARCHED AND CONFIRMED CURRENT (2026-07-19): the base URL, the /Search?q=&type= resource
// path and the X-Auth-Email/X-Auth-Key header names below are NOT a guess. They match the FCA's own
// account of the API (https://www.fca.org.uk/firms/financial-services-register: registration via
// the FS Register API Developer Portal at https://register.fca.org.uk/Developer/s/ issues a key;
// "https://register.fca.org.uk/services/" is the stated base) AND the source of
// sr-murthy/financial-services-register-api (PyPI, actively maintained, v1.3.1 released
// 2026-04-11), whose published constants are BASEURL = 'https://register.fca.org.uk/services/V0.1'
// and headers {'X-AUTH-EMAIL', 'X-AUTH-KEY'} (HTTP header names are case-insensitive, so the casing
// difference from this file is immaterial), with common_search() building exactly
// `${BASEURL}/Search?q=<name>&type=<firm|individual|fund>`. This is the same shape already in this
// file; this fix did not need to change it.
//
// LIVE FINDING 2026-07-19 (see this PR's report for the full smoke-test evidence, no secrets
// included): with this estate's real FCA_API_EMAIL/FCA_API_KEY, /Search?q=...&type=firm answers
// HTTP 404, and so does a bare GET on /Firm/106078 (a direct reference-number lookup, no Search
// involved at all). Critically, the SAME calls with NO auth headers at all answer HTTP 403, not
// 404, so the auth headers are doing SOMETHING (a bare 403 gatekeeper lets an authenticated-
// looking request through to a routing layer that then cannot find the resource FOR THIS ACCOUNT),
// and an apexrest URL variant and an upper-cased header-name variant both still answered 404. Every
// avenue this module's code shape can control was tried and behaves consistently with an
// ACCOUNT-SIDE problem (the key/email pair not actually subscribed/entitled to the Financial
// Services Register API product on the FCA's Salesforce developer portal, or a stale/rotated key)
// rather than a URL or header defect. Per Constitution's own discipline for this task (never guess
// an endpoint into the code; only ship a shape proven live or backed by an official/actively-
// maintained citable source), the code shape stays exactly as documented above. The founder action
// is to sign in at https://register.fca.org.uk/Developer/s/, confirm the Financial Services
// Register API product shows as an ACTIVE subscription for this key (not just an account with no
// product attached), regenerate the key if it shows expired/revoked/unsubscribed, and re-run this
// module's own request-builder path with the fresh key before assuming a further code change is
// needed.
const { runLookup } = require('./lib/lookup-runner');
const { makeNote } = require('./lib/notes');

const SEARCH_BASE = 'https://register.fca.org.uk/services/V0.1/Search';

const APPLICABLE_SECTORS = new Set(['finance', 'fintech', 'insurance']);
function applies(sector) {
  return !sector || APPLICABLE_SECTORS.has(String(sector).toLowerCase());
}

function buildRequest(query, fcaKeys) {
  const url = SEARCH_BASE + '?q=' + encodeURIComponent(query.slice(0, 80)) + '&type=firm';
  const headers = { 'X-Auth-Email': fcaKeys.email, 'X-Auth-Key': fcaKeys.key };
  return { url, headers, requestKey: 'fca.search' };
}

// candidateItemsOf(json) -> the raw row array, whichever of the two casing conventions the API version
// used. Named (rather than a nested ternary) so it is its own unit, not folded into extractCandidates.
function candidateItemsOf(json) {
  if (Array.isArray(json && json.Data)) return json.Data;
  if (Array.isArray(json && json.data)) return json.data;
  return [];
}
function hasReferenceNumber(it) {
  return it && (it['Reference Number'] || it.FRN || it.frn);
}
function toCandidate(it) {
  return { name: String(it.Name || it['Organisation Name'] || ''), raw: it };
}
// extractCandidates(json) -> [{name, raw}]. The search response carries its rows under Data or data;
// each row's reference number and organisation name arrive under human-readable, spaced field names
// as well as compact aliases depending on the API version fetched.
function extractCandidates(json) {
  return candidateItemsOf(json).filter(hasReferenceNumber).map(toCandidate);
}

function buildRow(candidate) {
  const raw = candidate.raw;
  const frn = raw['Reference Number'] || raw.FRN || raw.frn;
  return {
    firm_name: candidate.name || null,
    frn: String(frn),
    status: raw.Status || null,
    registered_office_address: null,
  };
}

async function lookupFca({ query, sector, fetchFn, deadlineMs, keys, log }) {
  if (!applies(sector)) {
    const detail = 'sector "' + sector + '" is not a finance family; FCA lookup skipped (Rule 8 budget cap)';
    return { row: null, note: makeNote({ register: 'fca', kind: 'skipped', reason: 'sector_not_applicable', detail, log }) };
  }
  const fcaKeys = keys && keys.fca;
  const hasKey = Boolean(fcaKeys && fcaKeys.email && fcaKeys.key);
  return runLookup({
    register: 'fca',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: hasKey ? null : {
      present: false,
      reason: 'missing_key',
      detail: 'FCA_API_EMAIL/FCA_API_KEY were not supplied to this lookup (founder-blocked; see CLAUDE.md founder actions: sign in at the FCA Register API developer portal and confirm the API product subscription is active for this key, not only that an account exists)',
    },
    buildRequest: () => buildRequest(query, fcaKeys || {}),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupFca, applies, extractCandidates, buildRow };
