'use strict';
// evidence/registers/rdap.js — RDAP (Registration Data Access Protocol) domain lookup via the
// rdap.org bootstrap convenience redirector (IANA-blessed, free, keyless, no rate-limit key).
//
// WS-Signals (KIMI-K3-DEEP-BLUEPRINT-2026-07-20 §B3/§C): "RDAP (rdap.org) for registrant country as
// a weak signal (WHOIS is redacted — demote)." This module is DELIBERATELY not run through
// evidence/registers/lib/lookup-runner.js's name-match flow: RDAP is keyed by DOMAIN, not by a
// company-name candidate, so there is no name to match — the query IS the domain the bundle already
// carries. Its one output field (`registrant_country`) is honest by construction: it is populated
// ONLY when the RDAP response carries an explicit `registrant`-role entity with a country in its
// vCard address, and it is left absent (not guessed, not defaulted) otherwise.
//
// LIVE-CALLED AND CONFIRMED 2026-07-20 (two real domains, both showing the exact WHOIS-redaction
// pattern the blueprint predicts):
//   - GET https://rdap.org/domain/mayoclinic.org -> 200, `entities` carries only a `registrar`-role
//     entity (CSC Corporate Domains) and an `abuse`-role sub-entity; NO `registrant`-role entity at
//     all (post-2018 WHOIS-privacy redaction is the norm, not the exception, exactly as the blueprint
//     says). This module correctly emits registrant_country: null for cases like this — an ABSENT
//     signal, never a guess.
//   - GET https://rdap.org/domain/nhs.uk -> 302 to rdap.nominet.uk/uk/domain/nhs.uk -> 200 (rdap.org
//     is a redirecting bootstrap; a fetchFn that follows redirects, as the injected implementation
//     must per this module's contract, reaches the authoritative registry RDAP server). Nominet's own
//     response likewise carries no registrant-role entity with a country.
// A domain that DOES publish a registrant country (some ccTLDs still do for organisations, e.g. a
// registrant vCard `adr` with a populated 7th ("country") component) is handled by the same parser;
// it was simply not the case for either domain live-tested here, which is itself the honest, expected
// outcome this module is built to represent rather than paper over.
const { withDeadline, DEFAULT_DEADLINE_MS } = require('./lib/deadline');
const { makeNote } = require('./lib/notes');

const BOOTSTRAP_BASE = 'https://rdap.org/domain/';

function buildRequest(domain) {
  return { url: BOOTSTRAP_BASE + encodeURIComponent(domain), headers: { Accept: 'application/rdap+json' }, requestKey: 'rdap.domain' };
}

// vcardCountry(vcardArray) -> the country token from a vCard `adr` property, or null. vCard 4.0 JSON
// shape: ["vcard", [["version",{},"text","4.0"], ["adr",{},"text",[pobox,ext,street,locality,region,
// postcode,country]], ...]]. The country is always the 7th (index 6) element of the `adr` value array.
function vcardCountry(vcardArray) {
  const props = Array.isArray(vcardArray) && Array.isArray(vcardArray[1]) ? vcardArray[1] : [];
  for (const prop of props) {
    if (!Array.isArray(prop) || prop[0] !== 'adr') continue;
    const parts = prop[3];
    const country = Array.isArray(parts) ? parts[6] : null;
    if (typeof country === 'string' && country.trim()) return country.trim();
  }
  return null;
}

// findRegistrantCountry(entities) -> the country from the FIRST entity carrying an explicit
// 'registrant' role, searched recursively (an entity may nest sub-entities, e.g. an 'abuse' contact
// nested under a 'registrar'). Any other role (registrar, admin, tech, abuse) is never read as a
// registrant signal — a wrong role read here would be exactly the "WHOIS registrar mistaken for
// registrant" class of bug this module exists to avoid.
function findRegistrantCountry(entities, depth) {
  if (!Array.isArray(entities) || depth > 4) return null;
  for (const ent of entities) {
    if (!ent || typeof ent !== 'object') continue;
    const roles = Array.isArray(ent.roles) ? ent.roles : [];
    if (roles.includes('registrant')) {
      const country = vcardCountry(ent.vcardArray);
      if (country) return country;
    }
    const nested = findRegistrantCountry(ent.entities, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function isWellFormedResponse(res) {
  return Boolean(res) && res.status === 200 && res.json != null && typeof res.json === 'object';
}

// lookupRdap({domain, fetchFn, deadlineMs, log}) -> Promise<{row, note}>. `row`, when present, is
// ALWAYS Tier C (registrant_country is a weak, frequently-absent signal per the blueprint; this
// module never asserts a tier — facts/jurisdiction.js is the one door that grades tiers, Rule 1 — it
// simply never returns anything a consumer could mistake for a Tier-A identifier: no company number,
// no registration id, nothing but a bare country token).
async function lookupRdap({ domain, fetchFn, deadlineMs, log }) {
  const clean = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (!clean) {
    return { row: null, note: makeNote({ register: 'rdap', kind: 'no_match', reason: 'no_domain', detail: 'no domain supplied to look up', log }) };
  }
  const { url, headers, requestKey } = buildRequest(clean);
  const outcome = await withDeadline(() => fetchFn(url, { headers, requestKey }), deadlineMs || DEFAULT_DEADLINE_MS, 'rdap');
  if (!outcome.ok) {
    const reason = outcome.reason === 'timeout' ? 'timeout' : 'fetch_error';
    const detail = outcome.reason === 'timeout' ? 'no response within the call deadline' : 'fetch failed: ' + (outcome.error && outcome.error.message);
    return { row: null, note: makeNote({ register: 'rdap', kind: 'degraded', reason, detail, log }) };
  }
  const res = outcome.value;
  if (!isWellFormedResponse(res)) {
    return { row: null, note: makeNote({ register: 'rdap', kind: 'degraded', reason: 'unexpected_response', detail: 'RDAP answered with status ' + (res && res.status), log }) };
  }
  const country = findRegistrantCountry(res.json.entities, 0);
  if (!country) {
    return { row: null, note: makeNote({ register: 'rdap', kind: 'no_match', reason: 'registrant_redacted', detail: 'RDAP response carried no registrant-role entity with a country (WHOIS-privacy redaction is the norm; C-004 doctrine applied to a redacted register)', log }) };
  }
  return {
    row: { registrant_country: country, source: 'rdap', fetched_at: new Date().toISOString(), query: clean },
    note: null,
  };
}

module.exports = { lookupRdap, findRegistrantCountry, vcardCountry };
