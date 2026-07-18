'use strict';
// evidence/registers/lib/lookup-runner.js — the ONE execution flow every register module in this
// directory shares: guard the query length, check for a required key/config, make the single
// deadline-wrapped fetch, and judge the response against the shared name-match gate (C-004). Each
// register module supplies only its own request shape, response parsing and row fields; this file
// owns the flow they all have in common so a fix or a strengthening (a new guard, a new note kind)
// lands once, not six times (the C-188 "stale door" doctrine applied to evidence collection, not just
// facts production).
const { withDeadline, DEFAULT_DEADLINE_MS } = require('./deadline');
const { queryTooShort, bestCandidate } = require('./name-match');
const { makeNote } = require('./notes');

// noteForFailedFetch(spec, outcome) -> note for a withDeadline() outcome that did not settle ok
// (a timeout or a thrown/rejected fetchFn). Split out of judgeOutcome so no single unit there
// carries every branch (tools/health-gate/check.js's decision-point cap).
function noteForFailedFetch(spec, outcome) {
  const reason = outcome.reason === 'timeout' ? 'timeout' : 'fetch_error';
  const detail = outcome.reason === 'timeout'
    ? 'no response within the call deadline'
    : 'fetch failed: ' + (outcome.error && outcome.error.message);
  return makeNote({ register: spec.register, kind: 'degraded', reason, detail, log: spec.log });
}

// noteForBadResponse(spec, res) -> note when the settled fetchFn result is not a well-formed
// {status:200, json} shape (a non-200 status, or a missing/absent JSON body).
function noteForBadResponse(spec, res) {
  const status = res && res.status;
  return makeNote({ register: spec.register, kind: 'degraded', reason: 'unexpected_response', detail: 'register answered with status ' + status, log: spec.log });
}

// judgeCandidates(spec, json) -> {row, note}. Runs the shared name-match gate (C-004) over a
// well-formed response body: zero candidates and a below-threshold best candidate are both
// row-absent, loud notes; a matched candidate is stamped with provenance and returned as a row.
function judgeCandidates(spec, json) {
  const { register, query, log } = spec;
  const candidates = spec.extractCandidates(json) || [];
  if (candidates.length === 0) {
    return { row: null, note: makeNote({ register, kind: 'no_match', reason: 'no_candidates_returned', detail: 'register returned zero candidates for "' + query + '"', log }) };
  }
  const best = bestCandidate(query, candidates, (c) => c.name);
  if (!best || !best.matched) {
    const nearest = best ? (best.nameMatched + ' (score ' + best.score.toFixed(2) + ')') : '(none)';
    const detail = 'nearest candidate for "' + query + '" was ' + nearest
      + '; refused (C-004: a non-empty response is not a match without a real name match)';
    return { row: null, note: makeNote({ register, kind: 'no_match', reason: 'below_threshold', detail, log }) };
  }
  const row = spec.buildRow(best.candidate, best);
  row.source = register;
  row.fetched_at = new Date().toISOString();
  row.query = query;
  row.match = { name_queried: best.nameQueried, name_matched: best.nameMatched, score: Number(best.score.toFixed(4)) };
  return { row, note: null };
}

// judgeOutcome(spec, outcome) -> {row, note}. `outcome` is a withDeadline() result: either
// {ok:false, reason:'timeout'|'error', ...} or {ok:true, value:{status, json}|null}. Never throws:
// every branch here is a typed, recorded degrade (never a fabricated or partial row).
// isWellFormedResponse(res) -> true only for a settled {status:200, json} shape. Named so the 2-operator
// disjunction is not its own "Complex Conditional" inline in judgeOutcome.
function isWellFormedResponse(res) {
  return Boolean(res) && res.status === 200 && res.json != null;
}
function judgeOutcome(spec, outcome) {
  if (!outcome.ok) return { row: null, note: noteForFailedFetch(spec, outcome) };
  const res = outcome.value;
  if (!isWellFormedResponse(res)) return { row: null, note: noteForBadResponse(spec, res) };
  return judgeCandidates(spec, res.json);
}

// runLookup(spec) -> Promise<{row, note}> for ONE register call. `spec` fields:
//   register          register id, e.g. 'companies_house'
//   query             the company-name candidate being searched
//   fetchFn           injected fetch(url, options) -> Promise<{status, json}|null> (Rule 9: the ONLY
//                     way this module ever touches the network; never called directly by a submodule)
//   deadlineMs        per-call budget (Rule 9); DEFAULT_DEADLINE_MS if not given
//   log               optional structured logger, forwarded to every note
//   requiredKeyNote   optional {present:false, reason, detail}; when present.present is false this
//                     lookup degrades on missing key/config WITHOUT ever calling fetchFn
//   buildRequest()    -> {url, headers, requestKey}
//   extractCandidates(json) -> [{name, raw}]
//   buildRow(candidate, best) -> the register-specific row object (source/fetched_at/query/match are
//                     added by judgeOutcome above, never by the submodule — C-005: only the
//                     establishing call stamps provenance, and it is stamped in exactly one place)
async function runLookup(spec) {
  const { register, query, fetchFn, deadlineMs, log } = spec;
  if (queryTooShort(query)) {
    const detail = 'normalised query "' + query + '" is too short to search a register safely';
    return { row: null, note: makeNote({ register, kind: 'no_match', reason: 'query_too_short', detail, log }) };
  }
  if (spec.requiredKeyNote && spec.requiredKeyNote.present === false) {
    return { row: null, note: makeNote({ register, kind: 'degraded', reason: spec.requiredKeyNote.reason, detail: spec.requiredKeyNote.detail, log }) };
  }
  const { url, headers, requestKey } = spec.buildRequest();
  const outcome = await withDeadline(() => fetchFn(url, { headers, requestKey }), deadlineMs || DEFAULT_DEADLINE_MS, register);
  return judgeOutcome(spec, outcome);
}

module.exports = { runLookup, judgeOutcome };
