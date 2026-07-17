'use strict';
// evidence/registers/cqc.js — the CQC (Care Quality Commission) provider register.
//
// Port source: cowork-os-fresh src/lib/audit/register-check.js `_cqc()` (accepted the first provider
// result as a match, no scoring at all — C-004) and register-grounding.js (documents the base
// https://api.cqc.org.uk/public/v1, Open Government Licence).
//
// FOUNDER-BLOCKED IN THIS ESTATE (2026-07): CLAUDE.md records CQC_PARTNER_CODE and CQC_API_KEY as
// blank, pending registration at the CQC developer portal. This module therefore degrades loudly on
// every real call in this estate today (see the missing_key note below) — this is expected, reported
// honestly, and is not a bug in this module.
const { runLookup } = require('./lib/lookup-runner');
const { makeNote } = require('./lib/notes');

const SEARCH_BASE = 'https://api.cqc.org.uk/public/v1/providers';

const APPLICABLE_SECTORS = new Set([
  'healthcare', 'dental', 'aesthetics', 'pharmacy', 'telemedicine', 'care-homes', 'fertility',
]);
function applies(sector) {
  return !sector || APPLICABLE_SECTORS.has(String(sector).toLowerCase());
}

function buildRequest(query, cqcKeys) {
  const url = SEARCH_BASE
    + '?partnerCode=' + encodeURIComponent(cqcKeys.partnerCode)
    + '&name=' + encodeURIComponent(query.slice(0, 80));
  return { url, headers: { 'Ocp-Apim-Subscription-Key': cqcKeys.apiKey }, requestKey: 'cqc.providers' };
}

// extractCandidates(json) -> [{name, raw}]. The provider search answers either {providers:[...]} or
// a bare array; each provider carries a display name and an id under one of two casings.
function extractCandidates(json) {
  const items = Array.isArray(json && json.providers) ? json.providers : (Array.isArray(json) ? json : []);
  return items
    .filter((it) => it && (it.providerId || it.providerID))
    .map((it) => ({ name: String(it.name || it.providerName || ''), raw: it }));
}

function addressLine(raw) {
  const parts = [raw.postalAddressLine1, raw.postalAddressTownCity, raw.postalAddressCounty, raw.postalPostCode]
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function buildRow(candidate) {
  const raw = candidate.raw;
  return {
    provider_name: candidate.name || null,
    provider_id: raw.providerId || raw.providerID,
    registered_office_address: addressLine(raw),
  };
}

async function lookupCqc({ query, sector, fetchFn, deadlineMs, keys, log }) {
  if (!applies(sector)) {
    const detail = 'sector "' + sector + '" is not a health family; CQC lookup skipped (Rule 8 budget cap)';
    return { row: null, note: makeNote('cqc', 'skipped', 'sector_not_applicable', detail, log) };
  }
  const cqcKeys = keys && keys.cqc;
  const hasKey = Boolean(cqcKeys && cqcKeys.apiKey && cqcKeys.partnerCode);
  return runLookup({
    register: 'cqc',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: hasKey ? null : {
      present: false,
      reason: 'missing_key',
      detail: 'CQC_API_KEY/CQC_PARTNER_CODE are not configured in this estate today (founder-blocked; register at the CQC developer portal, see CLAUDE.md founder actions)',
    },
    buildRequest: () => buildRequest(query, cqcKeys || {}),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupCqc, applies, extractCandidates, buildRow };
