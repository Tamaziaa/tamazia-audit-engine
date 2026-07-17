'use strict';
// evidence/registers/gleif.js — the Global LEI Index (GLEIF), a free, keyless public register of
// Legal Entity Identifiers covering entities across most jurisdictions (not UK-specific, unlike the
// other five modules in this directory). No port source names GLEIF by name; it is added here as a
// genuine "free-tier API" strengthening this evidence lane beyond the UK-only register set the old
// register-check.js checked, matching facts/README.md's Tier-A register-match doctrine (a worldwide,
// name-matched LEI record is exactly the kind of Tier-A signal facts/jurisdiction.js can use).
const { runLookup } = require('./lib/lookup-runner');

const SEARCH_BASE = 'https://api.gleif.org/api/v1/lei-records';

function buildRequest(query) {
  const url = SEARCH_BASE
    + '?filter%5Bentity.legalName%5D=' + encodeURIComponent(query.slice(0, 80))
    + '&page%5Bsize%5D=5';
  return { url, headers: {}, requestKey: 'gleif.lei_records' };
}

function addressLine(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const lines = Array.isArray(addr.addressLines) ? addr.addressLines : [];
  const parts = lines.concat([addr.city, addr.region, addr.postalCode, addr.country]).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// extractCandidates(json) -> [{name, raw}]. GLEIF's JSON:API response shape carries each candidate's
// display name at attributes.entity.legalName.name and its LEI at the record's own id field.
function extractCandidates(json) {
  const data = Array.isArray(json && json.data) ? json.data : [];
  return data
    .filter((d) => d && d.id && d.attributes && d.attributes.entity)
    .map((d) => ({ name: String((d.attributes.entity.legalName || {}).name || ''), raw: d }));
}

function buildRow(candidate) {
  const entity = candidate.raw.attributes.entity;
  return {
    entity_name: candidate.name || null,
    lei: candidate.raw.id,
    entity_status: entity.status || null,
    registered_office_address: addressLine(entity.legalAddress),
  };
}

async function lookupGleif({ query, fetchFn, deadlineMs, log }) {
  return runLookup({
    register: 'gleif',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: null, // public, keyless endpoint: always attempted
    buildRequest: () => buildRequest(query),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupGleif, extractCandidates, buildRow };
