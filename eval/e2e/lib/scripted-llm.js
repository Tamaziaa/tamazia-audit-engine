'use strict';
// eval/e2e/lib/scripted-llm.js - the ONLY llmCall the e2e harness ever hands to breach/adjudicator.
//
// Constitution Rule 9 + the repo's testability doctrine ("live-fetch code paths must be dependency-
// injected... no real network in CI", docs/P3-ACCEPTANCE.md wave-1 definition of done): eval/e2e is an
// EVALUATION harness, not a mint. It must run offline, deterministically, and identically in CI and on
// a laptop with no provider keys configured. It never phones a real LLM provider, so it never supplies
// the adjudicator its own real llmCall - it always injects one of the functions below instead.
//
// THE CONTRACT breach/adjudicator/adjudicate.js expects of an llmCall (its `verdictsFrom`):
//   llmCall(request) -> { ok, out: { verdicts: [{ id, verdict, reason, disproof }] } }   (gate.js shape)
//                    OR { verdicts: [{ id, verdict, reason, disproof }] }                  (bare shape)
//                    OR { ok: false }                                                      (declined)
//   - `verdict` is one of the model's closed enum: breach | no_breach | insufficient.
//   - `id` is the per-batch candidate index the adjudicator assigned (0..N-1); a verdict for an id no
//     candidate owns is simply never looked up (the adjudicator is filter-only, so a verdict cannot
//     inject a finding). `verdictsFrom` reads null from `{ok:false}` / a missing verdicts array, and
//     the adjudicator then ABSTAINS every candidate in the batch to needs_review (Rule 12 gate 4).
//
// defaultScriptedLlmCall is the harness's own default: it always DECLINES (`{ok:false}`), so every
// text-derived candidate abstains to needs_review rather than being asserted as a violation the harness
// could never actually have adjudicated with a real model. This is the safe default: a needs_review
// finding is not "asserted" (eval/reference-set/verify.js's findingIsAsserted), so it can never
// contradict a known_non_breach - the P3 zero-false-accusation bar holds by construction on the default
// path. Observed/register facts still bypass the model inside the adjudicator itself (C-084); this
// default governs only the text lane.
//
// scriptedLlmCall(script) builds a fully-controllable fake for tests that DO want to drive real
// verdicts through the real adjudicator: a fixed response object, an array consumed in call order, or a
// function for full per-call control. eval/e2e/lib/scripted-llm.test.js drives the REAL adjudicate.js
// through it to prove the shape is correct end to end (no real model, no network).

function defaultScriptedLlmCall(_request) {
  return Promise.resolve({
    ok: false,
    reason: 'eval/e2e harness default llmCall: no real LLM call is ever made here; the adjudicator abstains every text candidate to needs_review (Rule 12 gate 4)',
  });
}

// allVerdicts(verdict, count, extra) -> a well-formed verdicts response asserting the SAME verdict for
// every candidate id 0..count-1. A convenience for tests that want, e.g., an all-breach or all-
// insufficient batch without hand-writing the ids. `extra` (e.g. { disproof }) is merged onto each.
function allVerdicts(verdict, count, extra) {
  const verdicts = [];
  for (let id = 0; id < count; id++) verdicts.push(Object.assign({ id, verdict, reason: 'scripted' }, extra || {}));
  return { verdicts };
}

// scriptedLlmCall(script) -> an llmCall(request) function.
//   script a function       -> called with each request; its return value (or resolved promise) is the response.
//   script an array         -> responses consumed strictly in call order; once exhausted, further calls
//                              DECLINE (`{ok:false}`) rather than reusing a stale entry.
//   script anything else     -> every call gets the same single response object.
function scriptedLlmCall(script) {
  if (typeof script === 'function') {
    return (request) => Promise.resolve(script(request));
  }
  if (Array.isArray(script)) {
    const queue = script.slice();
    return function scripted(_request) {
      if (queue.length === 0) {
        return Promise.resolve({ ok: false, reason: 'scripted-llm.js: scripted response queue exhausted -> decline (abstain)' });
      }
      return Promise.resolve(queue.shift());
    };
  }
  const fixed = script;
  return (_request) => Promise.resolve(fixed);
}

module.exports = { defaultScriptedLlmCall, scriptedLlmCall, allVerdicts };
