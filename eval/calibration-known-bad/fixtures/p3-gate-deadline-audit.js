'use strict';
// p3-gate-deadline-audit.js - SEEDED KNOWN-BAD for tools/domain-gates/deadline-audit.js
// (Constitution Rule 9, GAPS.md deadline-hang). The four leak* functions are the 752s-hang disease:
// an external step awaited (or spawned) with NO hard deadline around it. The gate MUST catch each one;
// a run that reports zero here means the gate cannot see the class it exists to catch (Rule 4).
//
// This file is DATA (a calibration fixture), never wired into the mint. safeFetch is the clean control
// that proves the gate discriminates: an await routed through a real deadline wrapper is NOT flagged.

const cp = require('child_process');

// withDeadline: a genuine hard-deadline wrapper (the control below routes its external call through it).
function withDeadline(factory, ms) {
  return Promise.race([Promise.resolve().then(factory), new Promise((r) => setTimeout(() => r(null), ms))]);
}

// BAD 1: an injected fetch awaited with no wrapper and no deadline arg - a slow host hangs the mint.
async function leakFetch(fetchFn, url) {
  const res = await fetchFn(url);
  return res;
}

// BAD 2: an injected LLM caller awaited bare - an exhausted free tier never answers and never times out.
async function leakLlm(opts, request) {
  return await opts.llmCall(request);
}

// BAD 3: a provider .call(...) awaited with no deadline - the correlated-hang vector.
async function leakProviderCall(provider, task) {
  return await provider.call(task);
}

// BAD 4: shelling out to an http URL through spawnSync with no timeout - an unbounded external step.
function leakShell(target) {
  return cp.spawnSync('curl', ['-s', 'https://' + target + '/probe']);
}

// CLEAN CONTROL: the SAME external fetch, awaited INSIDE a hard deadline wrapper - must NOT be flagged.
async function safeFetch(fetchFn, url) {
  return await withDeadline(async () => await fetchFn(url), 5000);
}

module.exports = { withDeadline, leakFetch, leakLlm, leakProviderCall, leakShell, safeFetch };
