'use strict';
// eval/e2e/lib/scripted-llm.js - the ONLY llmCall the e2e harness ever hands to breach/adjudicator.
//
// Constitution Rule 9 + the repo's testability doctrine ("live-fetch code paths must be dependency-
// injected... no real network in CI", docs/P3-ACCEPTANCE.md wave-1 definition of done): eval/e2e is an
// EVALUATION harness, not a mint. It must run offline, deterministically, and identically in CI and on
// a laptop with no provider keys configured. It never phones a real LLM provider, so it never supplies
// the adjudicator its own real llmCall - it always injects one of the two functions below instead.
//
// defaultScriptedLlmCall is the harness's own default: it always answers the safe, abstaining verdict
// (breach/adjudicator/verdict.js's Rule-12-gate-4 default), so an adjudicator wired to it degrades to
// needs-review rather than inventing a verdict for evidence it was never really shown by a live model.
//
// scriptedLlmCall(script) builds a fully-controllable fake for tests: a fixed array of canned responses
// consumed in call order, or a function for full per-call control. eval/e2e/lib/pipeline.test.js uses
// this to prove the reproduced/contradiction/skip semantics deterministically, without a real
// adjudicator, a real model, or a network call anywhere in the loop.

function defaultScriptedLlmCall(_request) {
  return Promise.resolve({
    verdict: 'insufficient',
    reason: 'eval/e2e harness default llmCall: no real LLM call is ever made here; abstain-by-default (Rule 12 gate 4)',
  });
}

// scriptedLlmCall(script) -> an llmCall(request) function.
//   script a function       -> called with each request, its return value (or resolved promise) is the response.
//   script an array         -> responses consumed strictly in call order; once exhausted, further calls
//                              get an honest "insufficient" abstention rather than reusing a stale entry.
//   script anything else    -> every call gets the same single response object.
function scriptedLlmCall(script) {
  if (typeof script === 'function') {
    return (request) => Promise.resolve(script(request));
  }
  if (Array.isArray(script)) {
    const queue = script.slice();
    return function scripted(_request) {
      if (queue.length === 0) {
        return Promise.resolve({ verdict: 'insufficient', reason: 'scripted-llm.js: scripted response queue exhausted' });
      }
      return Promise.resolve(queue.shift());
    };
  }
  const fixed = script;
  return (_request) => Promise.resolve(fixed);
}

module.exports = { defaultScriptedLlmCall, scriptedLlmCall };
