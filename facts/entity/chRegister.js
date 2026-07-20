'use strict';
// facts/entity/chRegister.js — Companies House side of the entity-resolution verification ladder
// (Kimi KIMI-FINAL-BATCH-2026-07-20.md §1b, E4). REUSES the register-establishment lane's own CH
// client (evidence/registers/companies-house.js) rather than duplicating a second HTTP client for the
// same register (Constitution Rule 1, one door per external source) — this module only adds the
// officer/PSC corroboration lookup and the raw-response hashing the entity lane needs on top of it.
//
// Companies House is the SOLE AUTHORITY (§1b): the LLM output is a search hint only. This module
// never accepts a lens-proposed name/number as fact; it always re-fetches from the live register (or
// serves a TTL-capped cache of a prior fetch, §1f) and hashes the raw response bytes so the ladder's
// verdict is provably reproducible against what CH actually returned.

const { lookupCompaniesHouseByNumber, lookupCompaniesHouse } = require('../../evidence/registers/companies-house.js');
const { withDeadline, DEFAULT_DEADLINE_MS } = require('../../evidence/registers/lib/deadline.js');
const { scoreMatch } = require('../../evidence/registers/lib/name-match.js');
const { stableStringify, sha256Hex } = require('../../evidence/registers/lib/artifact.js');

const OFFICERS_BASE = 'https://api.company-information.service.gov.uk/company/';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (§1f: CH is a moving target, mint replays stored bytes)

// A tiny in-process TTL cache keyed by company number; per-process only (Rule: no module-level
// mutable fact state — this is a NETWORK CACHE, not a fact, and is scoped to raw-bytes reuse across
// calls within one run/process, never persisted, never a second source of truth for a verdict).
const _cache = new Map();

function cacheGet(crn) {
  const hit = _cache.get(crn);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAtMs > CACHE_TTL_MS) { _cache.delete(crn); return null; }
  return hit.value;
}
function cachePut(crn, value) {
  _cache.set(crn, { value, fetchedAtMs: Date.now() });
}

function hashResponse(json) {
  return sha256Hex(Buffer.from(json === undefined ? 'null' : stableStringify(json), 'utf8'));
}

// normalisePostcode(pc) -> a digit/letter-squeezed comparable key ('SW1A 1AA' -> 'SW1A1AA'). Missing
// input returns ''.
function normalisePostcode(pc) {
  return String(pc || '').toUpperCase().replace(/\s+/g, '');
}

function surnameOf(fullName) {
  // CH officer names are typically "SURNAME, Forename Middle" — take the pre-comma token; fall back
  // to the last whitespace-separated token when no comma is present.
  const s = String(fullName || '').trim();
  if (!s) return '';
  const comma = s.indexOf(',');
  if (comma !== -1) return s.slice(0, comma).trim().toLowerCase();
  const parts = s.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

// fetchOfficerSurnames(crn, {fetchFn, deadlineMs, keys}) -> {surnames: string[], responses: [{url, json}]}.
// Fetches officers + PSC lists; a failure on either degrades to an empty list for that endpoint
// (corroboration point simply unavailable, never a hard failure of the whole ladder — §1f).
async function fetchOfficerSurnames(crn, { fetchFn, deadlineMs, keys }) {
  const apiKey = keys && keys.companiesHouse;
  if (!apiKey || !fetchFn) return { surnames: [], responses: [] };
  const headers = { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') };
  const endpoints = [
    { url: OFFICERS_BASE + encodeURIComponent(crn) + '/officers', key: 'officers.items' },
    { url: OFFICERS_BASE + encodeURIComponent(crn) + '/persons-with-significant-control', key: 'items' },
  ];
  const surnames = [];
  const responses = [];
  for (const ep of endpoints) {
    const outcome = await withDeadline(
      () => fetchFn(ep.url, { headers, requestKey: 'companies_house.' + ep.key }),
      deadlineMs || DEFAULT_DEADLINE_MS, 'companies_house'
    );
    if (!outcome.ok || !outcome.value || outcome.value.status !== 200 || !outcome.value.json) continue;
    const json = outcome.value.json;
    responses.push({ url: ep.url, json, hash: hashResponse(json) });
    const items = Array.isArray(json.items) ? json.items : [];
    for (const it of items) {
      const name = (it && (it.name || (it.name_elements && it.name_elements.surname))) || '';
      const sn = surnameOf(name);
      if (sn) surnames.push(sn);
    }
  }
  return { surnames, responses };
}

// corroborate({ practicePostcode, teamText, sicCodes, officerSurnames }) -> { score, points: [...] }.
// §1b point table: postcode match = 3 (one-directional: only a MATCH counts, never a mismatch veto);
// officer/PSC surname on team page = 2; SIC 86230 = 1.
function corroborate({ chOfficeAddress, chSicCodes, practicePostcode, teamText, officerSurnames }) {
  const points = [];
  let score = 0;

  const officePc = normalisePostcode(extractPostcodeFrom(chOfficeAddress));
  const practicePc = normalisePostcode(practicePostcode);
  if (officePc && practicePc && officePc === practicePc) {
    score += 3;
    points.push({ kind: 'postcode_match', weight: 3 });
  }

  const team = String(teamText || '').toLowerCase();
  if (team && Array.isArray(officerSurnames)) {
    const hit = officerSurnames.find((sn) => sn && team.includes(sn));
    if (hit) { score += 2; points.push({ kind: 'officer_surname_on_team_page', weight: 2, surname: hit }); }
  }

  const sics = Array.isArray(chSicCodes) ? chSicCodes.map(String) : [];
  if (sics.includes('86230')) { score += 1; points.push({ kind: 'sic_86230', weight: 1 }); }

  return { score, points };
}

function extractPostcodeFrom(addressLine) {
  const m = String(addressLine || '').match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1] : '';
}

// fetchProfileByCrn(crn, opts) -> { row, rawJson, hash } | null. Uses the shared companies-house.js
// direct-by-number path (register-establishment lane, PR#51) — one door, one CH profile client.
async function fetchProfileByCrn(crn, { fetchFn, deadlineMs, keys, log }) {
  const cached = cacheGet(crn);
  if (cached) return cached;
  const { row } = await lookupCompaniesHouseByNumber(crn, { fetchFn, deadlineMs, keys, log });
  if (!row) return null;
  const result = { row, hash: hashResponse(row) };
  cachePut(crn, result);
  return result;
}

// searchByName(name, opts) -> the shared companies-house.js fuzzy-name search, unchanged shape.
async function searchByName(name, { fetchFn, deadlineMs, keys, log }) {
  return lookupCompaniesHouse({ query: name, fetchFn, deadlineMs, keys, log, corpusText: '' });
}

module.exports = {
  fetchProfileByCrn,
  searchByName,
  fetchOfficerSurnames,
  corroborate,
  normalisePostcode,
  scoreMatch,
  hashResponse,
  CACHE_TTL_MS,
  _cacheClearForTests: () => _cache.clear(),
};
