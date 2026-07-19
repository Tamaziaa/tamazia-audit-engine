'use strict';
// mint/llm-seam.js - THE production llmCall the mint injects into breach/adjudicator/adjudicate.js
// (Constitution Rule 9, Rule 11, Rule 12 gates 1-3; caution.md C-137/C-145/C-146).
//
// It productionises eval/e2e/lib/real-llm.js's makeLlmCall dispatch: the SAME three request kinds routed
// through the engine's OWN provider-routing shell (llm/router.js route(): free-first, ONE deadline-bounded
// attempt per provider, no retry storm) over the injected provider chain, gated by the SAME two structural
// validators (llm/gate.js). It drops the eval-only legs entirely: NO recording, NO replay, NO frozen-key
// derivation - a live mint call is made, gated and returned, nothing is written to a fixture.
//
//   buildLlmCall({ providers, log, deadlineMs }) -> llmCall(request)
//     - ADJUDICATION request (adjudicate.js callGate: carries a `rubric` function, no schema): the router
//       runs the adjudicator's OWN deterministic rubric as its structural gate (a fluent-but-unparseable
//       answer loses to the next provider; a rubric miss is a provider failure, never a retry with an
//       altered prompt - Rule 11, the base prompt is sent verbatim). Returns { ok, out:{verdicts}, provider,
//       model, score } | { ok:false } - the shape adjudicate.js verdictsFrom() consumes.
//     - ENTAILMENT request (llm/entailment.js callModel, Gate 3: carries a `schema` whose verdict enum
//       includes 'entailment'): the router applies llm/gate.js validateResponse (schema + retrieval-gate +
//       quote-match) as its gate, and this hands back the raw verbatim text for entailment.js's own
//       authoritative second gate. Returns { ok, text, provider, model } | { ok:false }.
//     - GENERIC request (anything else): a plain structured call, no contract gate. Returns { ok, text }.
//
// NO KEY EVER TOUCHES THIS FILE (Rule 16): the providers are already-built router providers whose .call
// closures read their own keys at call time (llm/providers/chain.js); this seam only routes and gates.

const { route } = require('../llm/router.js');
const { validateResponse } = require('../llm/gate.js');

// caps (Rule 8: every one an upper bound, never a floor).
const DEFAULT_DEADLINE_MS = 20000; // per-call hard deadline CAP handed to the router (Rule 9).
const MAX_DEADLINE_MS = 30000;     // the ceiling a request.deadline_ms override is clamped to.

// ── request-kind detection (mirrors eval/e2e/lib/real-llm.js + scripted-llm.js) ───────────────────────
function isEntailmentRequest(request) {
  const enumSet = request && request.schema && request.schema.properties
    && request.schema.properties.verdict && request.schema.properties.verdict.enum;
  return Array.isArray(enumSet) && enumSet.includes('entailment');
}
function isAdjudicationRequest(request) {
  return Boolean(request) && typeof request.rubric === 'function';
}

// ── the two structural gates applied inside the router's validated() path ─────────────────────────────
// parseModelJson(text): reuse llm/gate.js's OWN validateResponse as the shared JSON parser (no schema, no
// retrieval set -> parse-only, gates nothing). Never a second divergent parser (C-216: gate.js is the one
// door for "turn a model reply into a parsed object"). Returns the parsed value, or null when unparseable.
function parseModelJson(text) {
  const gated = validateResponse(text, {});
  return gated.ok ? gated.value : null;
}

// rubricValidator(request): the router `validate` for an adjudication call - parse via gate.js, run the
// adjudicator's deterministic rubric, accept only at/above the request threshold. A miss FALLS the chain
// over (never a retry with an altered prompt - Rule 11). A hard_fail is an immediate reject.
function rubricValidator(request) {
  const threshold = Number.isFinite(Number(request.threshold)) ? Number(request.threshold) : 7;
  return function validate(raw) {
    const text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
    const parsed = parseModelJson(text);
    if (!parsed) return { ok: false, violations: [{ code: 'unparseable_json' }] };
    const verdict = request.rubric(parsed);
    if (verdict && verdict.hard_fail) return { ok: false, violations: [{ code: 'rubric_hard_fail' }] };
    const score = verdict && Number.isFinite(verdict.score) ? verdict.score : 0;
    if (score >= threshold) return { ok: true, value: parsed };
    return { ok: false, violations: [{ code: 'rubric_below_threshold' }] };
  };
}

// entailmentValidator(request): the router `validate` for a Gate-3 call - exactly llm/gate.js
// validateResponse over the request's schema + retrieval set. A structurally-valid neutral/contradiction
// PASSES the router (so entailment.js can see and demote it); only a structurally-broken reply
// (unparseable, out-of-set source_id, quote drift) falls the chain over. A thin adapter over the one gate
// door, never a second parser (C-216).
function entailmentValidator(request) {
  return function validate(raw) {
    const text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
    const gated = validateResponse(text, { schema: request.schema, allowedSourceIds: request.allowedSourceIds, sources: request.sources });
    return gated.ok ? { ok: true, value: gated.value } : { ok: false, violations: gated.violations || [{ code: 'gate_reject' }] };
  };
}

// ── the shared route body ─────────────────────────────────────────────────────────────────────────────
// deadlineFor(request, cap): clamp the request's deadline to the cap (Rule 8: a caller may ask for a
// SHORTER deadline, never a longer one; the cap is the ceiling, never a floor).
function deadlineFor(request, cap) {
  const n = Number(request && request.deadline_ms);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : cap;
}

// runRoute(request, ctx, validate) -> the router result plus the winning provider/family. ctx carries
// { providers, deadlineMs, log }. Every call is deadline-bounded by the router (Rule 9) and the full
// routing decision is emitted to the injected log (C-146: every call's provider/outcome is observable).
async function runRoute(kind, request, ctx, validate) {
  const attempts = [];
  const result = await route(request, {
    providers: ctx.providers,
    deadlineMs: deadlineFor(request, ctx.deadlineMs),
    validate,
    log: (rec) => attempts.push(rec),
  });
  if (typeof ctx.log === 'function') {
    ctx.log({ event: 'llm_call', kind, ok: Boolean(result.ok), provider: result.provider || null, family: result.family || null, attempts });
  }
  return result;
}

// adjudicationCall / entailmentCall / genericCall: the three consumer-shaped returns (mirrors real-llm.js).
async function adjudicationCall(request, ctx) {
  const result = await runRoute('adjudicate', request, ctx, rubricValidator(request));
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider: result.provider || null };
  return { ok: true, out: result.value, provider: result.provider || null, model: result.provider || null, score: null };
}
async function entailmentCall(request, ctx) {
  const result = await runRoute('entailment', request, ctx, entailmentValidator(request));
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider: result.provider || null };
  return { ok: true, text: result.text, provider: result.provider || null, model: result.provider || null };
}
async function genericCall(request, ctx) {
  const result = await runRoute('generic', request, ctx, null);
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider: result.provider || null };
  return { ok: true, text: result.text, provider: result.provider || null };
}

/**
 * buildLlmCall(opts) -> llmCall(request). The dispatching caller adjudicate.js receives. Entailment first
 * (it also carries a prompt), then adjudication (rubric), else a generic structured call - mirroring
 * eval/e2e/lib/real-llm.js's makeLlmCall exactly, minus the recording/replay legs.
 *
 * opts.providers   the router-provider chain (from llm/providers/chain.js buildChain). Absent/empty -> the
 *                  router returns a no_providers abstain and every call is { ok:false } (fail-closed).
 * opts.deadlineMs  the per-call deadline CAP handed to the router (default 20000; clamped to MAX, never a floor).
 * opts.log         optional observability sink (C-146).
 */
function buildLlmCall(opts = {}) {
  const ctx = {
    providers: Array.isArray(opts.providers) ? opts.providers : [],
    deadlineMs: clampDeadline(opts.deadlineMs),
    log: typeof opts.log === 'function' ? opts.log : null,
  };
  return function llmCall(request) {
    if (isEntailmentRequest(request)) return entailmentCall(request, ctx);
    if (isAdjudicationRequest(request)) return adjudicationCall(request, ctx);
    return genericCall(request, ctx);
  };
}
function clampDeadline(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DEADLINE_MS) : DEFAULT_DEADLINE_MS;
}

module.exports = {
  buildLlmCall,
  isEntailmentRequest,
  isAdjudicationRequest,
  rubricValidator,
  entailmentValidator,
  parseModelJson,
  deadlineFor,
  clampDeadline,
  DEFAULT_DEADLINE_MS,
  MAX_DEADLINE_MS,
};
