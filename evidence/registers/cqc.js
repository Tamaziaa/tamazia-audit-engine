'use strict';
// evidence/registers/cqc.js: the CQC (Care Quality Commission) provider register.
//
// Port source: cowork-os-fresh src/lib/audit/register-check.js `_cqc()` (accepted the first provider
// result as a match, no scoring at all, C-004) and register-grounding.js (documented the base
// https://api.cqc.org.uk/public/v1, Open Government Licence).
//
// LIVE HOST (fixed 2026-07-19): the previously documented host api.cqc.org.uk now answers 403 on
// every request (retired). The live service host is api.service.cqc.org.uk, confirmed by a blind
// key test the same day: GET /public/v1/providers?page=1&perPage=1 with the
// Ocp-Apim-Subscription-Key header answers 200; the same call without the header answers 401 (so
// the header is genuinely enforced, not decorative; a missing key cannot be mistaken for a dead
// host). The subscription-key header therefore stays MANDATORY: an absent key degrades loudly with
// missing_key exactly as before, and fetchFn is never called in that case.
//
// PARTNER CODE IS OPTIONAL (2026-07-19): CQC's Partner Programme `partnerCode` query parameter is
// sent only when the caller actually configured one. This estate has never obtained a working
// partner code (CLAUDE.md's founder-blocked note), so a run with no configured partnerCode simply
// omits the parameter. When a partnerCode IS configured and the live host rejects it with HTTP 400,
// this module retries EXACTLY ONCE without it (evidence/registers/lib/lookup-runner.js's generic
// bounded-fallback gate, caution C-175: no backoff after the final attempt, never a loop) and
// records a loud notes[] entry (kind 'degraded', reason 'partner_code_rejected') so a bad/rejected
// partner code is visible rather than silently masked. Confirmed live 2026-07-19: an UNREGISTERED
// partnerCode value is rejected outright by the Azure-APIM-fronted host with a 400 body reading
// "Unspecified query parameter partnerCode is not allowed" when it is not a recognised value, so
// the live host validates partnerCode against a known list, unlike the old Mulesoft-era API's
// laissez-faire "any concise string is fine" policy this module's port source assumed.
//
// KNOWN LIMITATION, PROVEN LIVE 2026-07-19 (beyond this fix's scope): the live host has NO
// free-text name-search query parameter at all. `name`, `providerName`, `ProviderName`, `search`
// and `q` were each tried directly against GET /public/v1/providers with a valid subscription key
// and each answered HTTP 400 with the exact body "Unspecified query parameter <name> is not
// allowed." (Azure APIM's own schema validation, not this module's fault and not a partnerCode
// issue). The only confirmed-working parameters are page, perPage, inspectionDirectorate, region
// and partnerCode (matching the CQC Syndication API's own published examples); the full provider
// list is 63,937 rows with no name/text filter, so finding one company by name would require
// paginating and matching client-side across the WHOLE dataset, which Rule 8 (budgets are caps)
// and Rule 9 (hard deadlines) both forbid for a single register lookup. Net effect: buildRequest's
// `name=` query will 400 on every real call today REGARDLESS of partnerCode, so the bounded
// fallback above still degrades (with a now fully diagnosable notes[] detail, see
// lib/lookup-runner.js's responseMessageOf), not a genuine match. This is a pre-existing defect
// inherited from the port source (the old estate's `_cqc()` search-by-name call was apparently
// never actually exercised against a real response), not something introduced or fixable by the
// host-and-partnerCode fix in this file; see this PR's report for the founder-facing writeup and
// why a real fix (Partner Programme enrolment might unlock more, or a scheduled bulk-download-and-
// match redesign) is a separate, explicitly scoped decision, not a hot-fix.
//
// FOUNDER STATUS (2026-07-19): CQC_API_KEY has a value on file that this estate has verified live
// against api.service.cqc.org.uk (GET with only page/perPage succeeds); CQC_PARTNER_CODE has never
// been obtained (Partner Programme enrolment is a separate, still-open founder action; see this
// PR's report for the exact proposed DORMANT.md/CLAUDE.md wording). Wiring a working CQC_API_KEY
// into this estate's runtime ENV_B64 is an operational step outside this module's scope; the
// module only degrades loudly when the caller does not supply keys.cqc.apiKey at all, exactly as
// before this fix.
const { runLookup } = require('./lib/lookup-runner');
const { makeNote } = require('./lib/notes');

const SEARCH_BASE = 'https://api.service.cqc.org.uk/public/v1/providers';

const APPLICABLE_SECTORS = new Set([
  'healthcare', 'dental', 'aesthetics', 'pharmacy', 'telemedicine', 'care-homes', 'fertility',
]);
function applies(sector) {
  return !sector || APPLICABLE_SECTORS.has(String(sector).toLowerCase());
}

// searchUrl(query, cqcKeys, includePartnerCode) -> the providers-search URL. partnerCode is
// appended only when the caller both asked for it (includePartnerCode) AND actually configured a
// value: an included-but-empty `partnerCode=` is itself a plausible cause of an HTTP 400, so an
// absent/blank code is never sent as an empty parameter (never guessed, never padded).
function searchUrl(query, cqcKeys, includePartnerCode) {
  let url = SEARCH_BASE + '?name=' + encodeURIComponent(query.slice(0, 80));
  if (includePartnerCode && cqcKeys.partnerCode) {
    url += '&partnerCode=' + encodeURIComponent(cqcKeys.partnerCode);
  }
  return url;
}

function authHeaders(cqcKeys) {
  return { 'Ocp-Apim-Subscription-Key': cqcKeys.apiKey };
}

// buildRequest(query, cqcKeys) -> the primary request: WITH partnerCode when one is configured (the
// CQC Partner Programme's documented shape), otherwise the bare subscription-key search the public
// API also accepts. The distinct requestKey per shape lets a caller's fetchFn (or a calibration
// fixture) script a different canned response for each.
function buildRequest(query, cqcKeys) {
  const withPartnerCode = Boolean(cqcKeys.partnerCode);
  return {
    url: searchUrl(query, cqcKeys, withPartnerCode),
    headers: authHeaders(cqcKeys),
    requestKey: withPartnerCode ? 'cqc.providers' : 'cqc.providers.no_partner_code',
  };
}

// buildRequestWithoutPartnerCode(query, cqcKeys) -> the bounded single fallback (C-175) tried
// exactly once when a CONFIGURED partnerCode is rejected with HTTP 400 by the primary request.
function buildRequestWithoutPartnerCode(query, cqcKeys) {
  return { url: searchUrl(query, cqcKeys, false), headers: authHeaders(cqcKeys), requestKey: 'cqc.providers.no_partner_code' };
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
    return { row: null, note: makeNote({ register: 'cqc', kind: 'skipped', reason: 'sector_not_applicable', detail, log }) };
  }
  const cqcKeys = keys && keys.cqc;
  // Only the subscription key is mandatory (C-135: a dependency that cannot complete a call as
  // configured is marked absent loudly). partnerCode is OPTIONAL: its absence is a normal,
  // first-try-succeeds call, never a degradation, so it plays no part in hasKey.
  const hasKey = Boolean(cqcKeys && cqcKeys.apiKey);
  const hasPartnerCode = Boolean(cqcKeys && cqcKeys.partnerCode);
  return runLookup({
    register: 'cqc',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: hasKey ? null : {
      present: false,
      reason: 'missing_key',
      detail: 'CQC_API_KEY is not configured in this estate today (founder-blocked; register at the CQC developer portal, see CLAUDE.md founder actions); CQC_PARTNER_CODE is optional, the subscription key alone is enough to search the public register',
    },
    buildRequest: () => buildRequest(query, cqcKeys || {}),
    // A bounded fallback is only offered when a partnerCode was actually configured (and so could
    // actually be the thing a 400 is rejecting); with none configured the primary request already
    // omits it, so there is no alternate shape to retry.
    buildFallbackRequest: hasPartnerCode ? () => buildRequestWithoutPartnerCode(query, cqcKeys) : undefined,
    fallbackReason: 'partner_code_rejected',
    fallbackDetailPrefix: 'the configured CQC partnerCode was rejected by the live host with HTTP 400 on the primary request',
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupCqc, applies, extractCandidates, buildRow };
