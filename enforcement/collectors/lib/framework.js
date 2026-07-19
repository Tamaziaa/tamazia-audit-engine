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

// fetchErrorResult(fetched, source, url) -> the ok:false shape for a failed fetch. A failed fetch is
// a typed, reported LaneError - never an empty rows[] masquerading as "no enforcement actions today"
// (the same discipline evidence/registers/lib/lookup-runner.js uses). The HTTP status carries through
// on an 'http_status' failure (fetchWithDeadline sets status, not error, for that reason) so a
// blocked source's actual response code (403, 404, ...) survives into this collection report -
// exactly the debugging signal an operator needs, never silently dropped.
function fetchErrorResult(fetched, source, url) {
  const detail = fetched.error ? String(fetched.error.message || fetched.error) : null;
  return { ok: false, reason: fetched.reason, source, url, status: fetched.status ?? null, detail };
}

// parseCandidates(parse, fetched, source, url) -> Array | the ok:false parse_error shape (never
// throws). Isolates the ONE try/catch this file needs so collectFromSource's own body stays a flat
// sequence of guard clauses (CodeScene Complex Method).
function parseCandidates(parse, fetched, source, url) {
  try {
    const candidates = parse(fetched.text, { url: fetched.url, sha256: fetched.sha256, fetchedAt: fetched.fetchedAt, source });
    if (Array.isArray(candidates)) return candidates;
    return { ok: false, reason: 'parse_error', source, url, detail: 'parser did not return an array' };
  } catch (err) {
    // FAIL-OPEN: a parser exception is a structural drift signal (the source's page/JSON shape
    // changed). It is never rethrown or logged here because turning it into the typed
    // {ok:false, reason:'parse_error', detail} result IS the record - the caller (and every test in
    // this directory) reads that discriminated result, never swallowed into a silent empty array.
    return { ok: false, reason: 'parse_error', source, url, detail: err.message };
  }
}

// classifyCandidates(candidates) -> { rows, rejected }. Splits the parser's raw candidates into
// schema-valid rows and rejected (row, error) pairs, one door for both the store writer and this
// collection report to trust (Rule 1).
function classifyCandidates(candidates) {
  const rows = [];
  const rejected = [];
  for (const candidate of candidates) {
    if (isValidRow(candidate)) rows.push(candidate);
    else rejected.push({ row: candidate, error: describeInvalid(candidate) });
  }
  return { rows, rejected };
}

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
  if (!fetched.ok) return fetchErrorResult(fetched, source, url);

  const candidates = parseCandidates(parse, fetched, source, url);
  if (!Array.isArray(candidates)) return candidates; // already the ok:false parse_error shape

  const { rows, rejected } = classifyCandidates(candidates);
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
