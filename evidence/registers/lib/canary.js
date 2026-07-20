'use strict';
// evidence/registers/lib/canary.js — THE canary-guard for the register-establishment lane
// (Constitution Rule 4/9 applied to an external register outage). Every register call this lane
// makes against a live third-party API is preceded, once per fetchRegisters() run, by a lookup of a
// KNOWN-GOOD fixed record. A canary FAILURE (non-200, a body missing the expected field, a thrown
// fetch, or a timeout) marks that register's lane_status DEGRADED for the whole run: establishment
// is then NOT resolved from that register this run, no matter what the real lookup itself would
// have answered, and gated catalogue records stay needs_human/not-assessed exactly as they do when
// the key is simply absent. This is the one thing standing between a quietly-expired API key /
// register outage and an audit that silently renders "no issue found" or a fabricated
// "established" verdict — see this directory's README and CLAUDE.md §7.9 (silent lane failure must
// never render as clean).
//
// Each canary spec names a FIXED, well-known, non-secret record id (a major PLC's company number, a
// documented CQC provider id) — never anything derived from the site under audit. A canary is
// therefore reusable across every mint in a process and safe to log/report in full (it names no
// customer, carries no credential).

const { withDeadline, DEFAULT_DEADLINE_MS } = require('./deadline');

// CANARIES: register key -> {label, buildRequest(apiKeyBag) -> {url, headers}, check(json) -> bool}.
// companies_house: Tesco PLC, company number 00445790 — a large, permanently-active public company;
// the profile endpoint is expected to return company_status:'active' for it indefinitely.
// cqc: no confirmed-working canary id exists yet (evidence/registers/cqc.js's header: the live host
// has no free-text name search, and no CQC_PARTNER_CODE / confirmed provider id is on file in this
// estate today — see CLAUDE.md founder-blocked CQC row). The structural canary below proves the
// SUBSCRIPTION KEY + HOST are live (page/perPage, the one confirmed-working parameter pair) without
// asserting any specific provider exists; a provider-id canary should replace this the day a real
// id is confirmed (tracked as a deferred follow-up, not silently upgraded without one).
const CANARIES = {
  companies_house: {
    label: 'companies_house:00445790 (Tesco PLC)',
    buildRequest: (keys) => ({
      url: 'https://api.company-information.service.gov.uk/company/00445790',
      headers: { Authorization: 'Basic ' + Buffer.from((keys && keys.companiesHouse ? keys.companiesHouse : '') + ':').toString('base64') },
    }),
    check: (json) => Boolean(json && json.company_number === '00445790' && json.company_status),
  },
  cqc: {
    label: 'cqc:providers?page=1&perPage=1 (structural key/host canary; no confirmed provider-id canary yet)',
    buildRequest: (keys) => ({
      url: 'https://api.service.cqc.org.uk/public/v1/providers?page=1&perPage=1',
      headers: { 'Ocp-Apim-Subscription-Key': (keys && keys.cqc && keys.cqc.apiKey) || '' },
    }),
    check: (json) => Boolean(json && (Array.isArray(json.providers) || Array.isArray(json))),
  },
};

// hasKeyFor(register, keys) -> whether a canary can even be attempted (no key => no canary call is
// made at all, same missing_key doctrine as a real lookup; a canary is never run key-less).
function hasKeyFor(register, keys) {
  if (register === 'companies_house') return Boolean(keys && keys.companiesHouse);
  if (register === 'cqc') return Boolean(keys && keys.cqc && keys.cqc.apiKey);
  return false;
}

// runCanary(register, {fetchFn, deadlineMs, keys}) -> Promise<{register, label, ok, status, message,
// artifact}>. `artifact` is the raw {status, json, headers?} the canary call observed, handed back so
// the caller can fold it into the hash-chained artifact record (evidence/registers/lib/artifact.js)
// without this module needing to depend on that one (kept import-light / single-purpose).
async function runCanary(register, { fetchFn, deadlineMs, keys }) {
  const spec = CANARIES[register];
  if (!spec) return { register, label: null, ok: false, status: null, message: 'no canary defined for this register', artifact: null };
  if (!hasKeyFor(register, keys)) {
    return { register, label: spec.label, ok: false, status: null, message: 'missing_key: no canary attempted (same as a real lookup with no key)', artifact: null };
  }
  const { url, headers } = spec.buildRequest(keys);
  const outcome = await withDeadline(() => fetchFn(url, { headers, requestKey: register + '.canary' }), deadlineMs || DEFAULT_DEADLINE_MS, register);
  if (!outcome.ok) {
    const reason = outcome.reason === 'timeout' ? 'timeout' : 'fetch_error';
    return { register, label: spec.label, ok: false, status: null, message: 'canary ' + reason, artifact: null, requestUrl: url, headers };
  }
  const res = outcome.value;
  const okStatus = Boolean(res && res.status === 200);
  const okBody = okStatus && spec.check(res.json);
  return {
    register,
    label: spec.label,
    ok: okBody,
    status: res && res.status,
    message: okBody ? 'canary ok' : 'canary answered without the expected known-good shape (status ' + (res && res.status) + ')',
    artifact: res,
    requestUrl: url,
    headers,
  };
}

module.exports = { runCanary, CANARIES, hasKeyFor };
