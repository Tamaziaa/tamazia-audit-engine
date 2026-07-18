'use strict';
// evidence/registers/ico.js — the ICO Register of Data Controllers (fee payers).
//
// Port source: cowork-os-fresh src/lib/evidence/ico-register.js: the first binary, un-arguable
// breach the old estate could prove (an absent or lapsed registration), sourced by mirroring the
// ICO's weekly CSV download into a Neon table and querying it with a direct SQL prefix match — no
// scoring, no rejection of a merely-similar name, and no HTTP fetch at all.
//
// HONEST GAP (stated plainly, per this wave's brief): the ICO publishes no free, real-time, JSON
// search API for this register today; the only official access path is the downloadable CSV mirror
// the port source loads into a database. This evidence layer is fetch-only and dependency-injected
// (Rule 9: every register lookup is a deadline-wrapped fetchFn call, never a direct database query),
// so it cannot call that mirror directly without smuggling in a second, undeclared external
// dependency. The seam this module exposes instead: keys.ico names the base URL of a small
// JSON-serving mirror of that same dataset (a thin wrapper service over the existing mirrored table,
// not yet built in this estate). Until keys.ico is configured, this lookup degrades loudly — no
// guess, no silent skip — exactly like the CQC/FCA founder-blocked keys elsewhere in this directory.
const { runLookup } = require('./lib/lookup-runner');
const { makeNote } = require('./lib/notes');

function buildRequest(query, endpointBase) {
  const url = endpointBase.replace(/\/+$/, '') + '?name=' + encodeURIComponent(query.slice(0, 80));
  return { url, headers: {}, requestKey: 'ico.lookup' };
}

// extractCandidates(json) -> [{name, raw}]. The mirror's contract (this module's own seam, modelled
// 1:1 on the columns the port source already queries): a rows array of organisation records, each
// carrying a registration number, an organisation name and an optional registration end date.
function extractCandidates(json) {
  const rows = Array.isArray(json && json.rows) ? json.rows : [];
  return rows
    .filter((r) => r && r.organisation_name && r.registration_number)
    .map((r) => ({ name: String(r.organisation_name), raw: r }));
}

// isExpired(endDate) -> true | false | null. A missing end_date is an OPEN-ENDED registration (false,
// not expired). A date-only expiry (YYYY-MM-DD) is valid THROUGH the whole of that day, so it lapses at
// END-OF-DAY UTC, never from midnight - parsing '2024-01-15' as midnight would mark a live registration
// lapsed throughout its final day. An UNPARSEABLE end_date proves NEITHER currency nor lapse: it fails
// closed to null (unknown), so buildRow never fabricates a 'registered' (or 'expired') from garbage data
// (Rule 4 fail-closed; Rule 6 abstain below confidence).
function isExpired(endDate) {
  if (!endDate) return false;
  const s = String(endDate).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const t = new Date(dateOnly ? s + 'T23:59:59.999Z' : s).getTime();
  if (!Number.isFinite(t)) return null; // unparseable -> unknown, never silently 'registered'
  return t < Date.now();
}

function buildRow(candidate) {
  const raw = candidate.raw;
  const expired = isExpired(raw.end_date);
  return {
    organisation_name: candidate.name || null,
    registration_number: raw.registration_number,
    end_date: raw.end_date || null,
    // A garbage end_date is 'unknown' (abstain), never a confident 'registered'/'expired' on data we
    // could not parse; a downstream consumer treats 'unknown' as needs-review, not as a clean pass.
    status: expired === null ? 'unknown' : (expired ? 'expired' : 'registered'),
  };
}

async function lookupIco({ query, fetchFn, deadlineMs, keys, log }) {
  const endpointBase = keys && keys.ico;
  return runLookup({
    register: 'ico',
    query,
    fetchFn,
    deadlineMs,
    log,
    requiredKeyNote: endpointBase ? null : {
      present: false,
      reason: 'missing_endpoint',
      detail: 'no free real-time JSON search API is published for the ICO Register of Data Controllers; configure keys.ico to a JSON-serving mirror of the existing register table to enable this lookup (see this module header)',
    },
    buildRequest: () => buildRequest(query, endpointBase || ''),
    extractCandidates,
    buildRow,
  });
}

module.exports = { lookupIco, extractCandidates, buildRow, isExpired };
