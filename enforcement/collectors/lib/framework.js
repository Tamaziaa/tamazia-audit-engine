'use strict';
// enforcement/collectors/lib/framework.js - THE one collector-run orchestration shared by every
// per-source module in this directory (Constitution Rule 1: one door for the collect flow). Each
// source module (asa.js, ico.js, cnil.js, ftc.js, ocr.js, gdprhub.js) supplies only its own fetch
// target(s) and its own parse(text, ctx) -> EnforcementAction[]; this file owns the fetch, the
// deadline, the hashing and the fail-closed validation every source shares.
//
// WHAT THIS IS NOT: an LLM is never called from this file or from any per-source parser. Collectors
// parse deterministically (regex / DOM-ish text slicing over known page structures); a page whose
// structure has drifted produces zero rows and a typed 'parse_error' or 'no_rows' note, never a
// guess (Rule 4: fail closed; Rule 11 boundary: no LLM anywhere in the store-write path).

const { fetchWithDeadline } = require('./fetcher');
const { isValidRow, assertValidRow } = require('../../store/schema');

// collectFromSource({ source, url, deadlineMs, fetchImpl, parse, label })
//   -> Promise<{ ok:true, rows: EnforcementAction[], rejected: {row, error}[], meta }
//            | { ok:false, reason, source, url, detail }>
//
// fetchImpl defaults to fetchWithDeadline and is the ONLY injection seam tests use (fixture-backed
// fetchImpl reading a saved HTML/JSON sample instead of the network) - the parse logic under test is
// therefore byte-identical between a live run and a fixture run.
async function collectFromSource({ source, url, deadlineMs, fetchImpl, parse, label }) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetchWithDeadline;
  const fetched = await doFetch(url, { deadlineMs, label: label || `${source}:${url}` });

  if (!fetched.ok) {
    // A failed fetch is a typed, reported LaneError - never an empty rows[] masquerading as "no
    // enforcement actions today" (the same discipline evidence/registers/lib/lookup-runner.js uses).
    return { ok: false, reason: fetched.reason, source, url, detail: fetched.error ? String(fetched.error.message || fetched.error) : null };
  }

  let candidates;
  try {
    candidates = parse(fetched.text, { url: fetched.url, sha256: fetched.sha256, fetchedAt: fetched.fetchedAt, source });
  } catch (err) {
    // FAIL-OPEN: a parser exception is a structural drift signal (the source's page/JSON shape
    // changed). It is never rethrown or logged here because turning it into the typed
    // {ok:false, reason:'parse_error', detail} result IS the record - the caller (and every test in
    // this directory) reads that discriminated result, never swallowed into a silent empty array.
    return { ok: false, reason: 'parse_error', source, url, detail: err.message };
  }
  if (!Array.isArray(candidates)) {
    return { ok: false, reason: 'parse_error', source, url, detail: 'parser did not return an array' };
  }

  const rows = [];
  const rejected = [];
  for (const candidate of candidates) {
    if (isValidRow(candidate)) rows.push(candidate);
    else rejected.push({ row: candidate, error: describeInvalid(candidate) });
  }

  return {
    ok: true,
    rows,
    rejected,
    meta: { url: fetched.url, sha256: fetched.sha256, fetchedAt: fetched.fetchedAt, candidateCount: candidates.length },
  };
}

// describeInvalid(row) -> a best-effort diagnostic string for the rejected[] list (never thrown; the
// caller already knows isValidRow failed, this just re-runs assertValidRow to capture WHY, for the
// collection report).
function describeInvalid(row) {
  try {
    assertValidRow(row);
    return 'unknown (isValidRow said false but assertValidRow did not throw - schema drift)';
  } catch (err) {
    // FAIL-OPEN: this catch's entire purpose is to capture assertValidRow's rejection reason for the
    // rejected[] report; returning err.message IS the record, never rethrown or logged separately.
    return err.message;
  }
}

module.exports = { collectFromSource };
