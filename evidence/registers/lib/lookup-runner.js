'use strict';
// evidence/registers/lib/lookup-runner.js: the ONE execution flow every register module in this
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

// responseMessageOf(res) -> a short, bounded diagnostic string pulled from a JSON error body's
// common shape ({message} or {error}), or null. Never assumed: many registers answer a non-200
// with no body at all (a plain text/HTML error page), in which case this is null and the note
// falls back to the status alone. Caution C-181: a causeless error is itself a defect, so this
// surfaces whatever the register actually told us, verbatim and bounded, rather than inventing a
// diagnosis it did not state (e.g. Azure APIM's own "Unspecified query parameter X is not
// allowed." on a rejected filter parameter, which the status code alone cannot convey).
function responseMessageOf(res) {
  const body = res && res.json;
  const msg = body && typeof body === 'object' ? (body.message || body.error) : null;
  return typeof msg === 'string' && msg.length > 0 ? msg.slice(0, 200) : null;
}
// noteForBadResponse(spec, res) -> note when the settled fetchFn result is not a well-formed
// {status:200, json} shape (a non-200 status, or a missing/absent JSON body).
function noteForBadResponse(spec, res) {
  const status = res && res.status;
  const msg = responseMessageOf(res);
  const detail = 'register answered with status ' + status + (msg ? ': ' + msg : '');
  return makeNote({ register: spec.register, kind: 'degraded', reason: 'unexpected_response', detail, log: spec.log });
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

// ---------------------------------------------------------------------------------
// Bounded single alternate-shape fallback (caution.md C-175: no backoff after the final attempt,
// permanent-looking rejections are never retried in a loop). A register module opts in by
// supplying spec.buildFallbackRequest(); when the PRIMARY call answers exactly HTTP 400, this runs
// ONE further call via that alternate shape and stops -- there is no third attempt whatever the
// second call answers. This is generic (register-agnostic) infrastructure, not a CQC-specific
// bolt-on, so a future register with the same "an optional parameter the live host sometimes
// rejects" shape reuses this flow rather than re-implementing it (the C-188 "stale door" doctrine).
// ---------------------------------------------------------------------------------

// isHttp400(outcome) -> true only for a SETTLED (never timed out/thrown) response whose status is
// exactly 400. A timeout or thrown/rejected fetchFn is a different failure class (Rule 9's deadline
// doctrine already covers it via noteForFailedFetch) and must never trigger a retry here.
function isHttp400(outcome) {
  return Boolean(outcome.ok && outcome.value && outcome.value.status === 400);
}

// fallbackNoteDetail(spec, fallbackResult) -> the single notes[] `detail` string covering both the
// primary rejection and whatever the bounded retry then produced. One note carries the whole story
// (a matched row can still be returned alongside it, per the {row, note} contract every caller of
// runLookup already reads) rather than inventing a second notes[] slot no consumer expects.
function fallbackNoteDetail(spec, fallbackResult) {
  const base = spec.fallbackDetailPrefix + ' (C-175: one bounded alternate-shape retry attempted, no further attempts)';
  if (fallbackResult.row) {
    return base + '; the retry succeeded and found a genuine name match, so a row is still returned, '
      + 'but the rejected configuration should be corrected';
  }
  const why = fallbackResult.note ? fallbackResult.note.detail : 'the retry did not produce a usable response either';
  return base + '; ' + why;
}

// runFallback(spec) -> Promise<{row, note}>. Builds and runs spec.buildFallbackRequest() exactly
// once, judges it through the SAME candidate/row logic as the primary call (spec.extractCandidates /
// spec.buildRow / the C-004 name-match gate all still apply), and always records a single loud
// 'degraded' note under spec.fallbackReason -- visible even when the retry happens to succeed,
// because a configured value the live host rejected is itself worth surfacing (C-135 doctrine: a
// dependency that cannot complete a call as configured is marked absent loudly, never silently
// degraded around).
async function runFallback(spec) {
  const { register, fetchFn, deadlineMs, log } = spec;
  const { url, headers, requestKey } = spec.buildFallbackRequest();
  const outcome = await withDeadline(() => fetchFn(url, { headers, requestKey }), deadlineMs || DEFAULT_DEADLINE_MS, register);
  const fallbackResult = judgeOutcome(spec, outcome);
  const note = makeNote({ register, kind: 'degraded', reason: spec.fallbackReason, detail: fallbackNoteDetail(spec, fallbackResult), log });
  return { row: fallbackResult.row, note };
}

// runLookup(spec) -> Promise<{row, note}> for ONE register call. `spec` fields:
//   register              register id, e.g. 'companies_house'
//   query                 the company-name candidate being searched
//   fetchFn               injected fetch(url, options) -> Promise<{status, json}|null> (Rule 9: the
//                         ONLY way this module ever touches the network; never called directly by a
//                         submodule)
//   deadlineMs            per-call budget (Rule 9); DEFAULT_DEADLINE_MS if not given
//   log                   optional structured logger, forwarded to every note
//   requiredKeyNote       optional {present:false, reason, detail}; when present.present is false
//                         this lookup degrades on missing key/config WITHOUT ever calling fetchFn
//   buildRequest()        -> {url, headers, requestKey}
//   extractCandidates(json) -> [{name, raw}]
//   buildRow(candidate, best) -> the register-specific row object (source/fetched_at/query/match are
//                         added by judgeOutcome above, never by the submodule; C-005: only the
//                         establishing call stamps provenance, and it is stamped in exactly one place)
//   buildFallbackRequest() -> optional; {url, headers, requestKey} for the ONE bounded retry fired
//                         only when the primary call answers exactly HTTP 400 (see runFallback
//                         above). Omit entirely when a submodule has no alternate shape to offer.
//   fallbackReason        required alongside buildFallbackRequest: the notes[] `reason` stamped on
//                         the single note this path always records.
//   fallbackDetailPrefix  required alongside buildFallbackRequest: a human, secret-free description
//                         of what was retried and why (never interpolate the rejected value itself).
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
  if (typeof spec.buildFallbackRequest === 'function' && isHttp400(outcome)) {
    return runFallback(spec);
  }
  return judgeOutcome(spec, outcome);
}

module.exports = { runLookup, judgeOutcome };
