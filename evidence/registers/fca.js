'use strict';
// evidence/registers/fca.js — the FCA Financial Services Register.
//
// Port source: cowork-os-fresh src/lib/audit/register-check.js `_fca()` (accepted the first search
// result as a match, no scoring at all — C-004).
//
// FOUNDER-BLOCKED IN THIS ESTATE (2026-07): CLAUDE.md records FCA_API_EMAIL and FCA_API_KEY as
// blank, pending registration at the FCA Register API developer portal. This module degrades loudly
// on every real call in this estate today (see the missing_key note below) — expected, reported
// honestly, and not a bug in this module.
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

// extractCandidates(json) -> [{name, raw}]. The search response carries its rows under Data or data;
// each row's reference number and organisation name arrive under human-readable, spaced field names
// as well as compact aliases depending on the API version fetched.
function extractCandidates(json) {
  const items = Array.isArray(json && json.Data) ? json.Data : (Array.isArray(json && json.data) ? json.data : []);
  return items
    .filter((it) => it && (it['Reference Number'] || it.FRN || it.frn))
    .map((it) => ({ name: String(it.Name || it['Organisation Name'] || ''), raw: it }));
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
    return { row: null, note: makeNote('fca', 'skipped', 'sector_not_applicable', detail, log) };
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
      detail: 'FCA_API_EMAIL/FCA_API_KEY are not configured in this estate today (founder-blocked; register at the FCA Register API developer portal, see CLAUDE.md founder actions)',
    },
    buildRequest: () => buildRequest(query, fcaKeys || {}),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupFca, applies, extractCandidates, buildRow };
