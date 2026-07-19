'use strict';
// llm/providers/chain.js - THE production provider-chain builder for the live mint (Constitution Rule 9,
// Rule 11, Rule 16; caution.md C-133/C-135/C-137/C-138).
//
// buildChain({ env, fetchImpl }) -> { providers, families, preflight } constructs the free-first estate of
// router providers the mint drives: cloudflare / groq / nim / gemini (the C-133 independent families)
// PLUS the OpenRouter/Ministral anchor (family 'mistral') when OPENROUTER_API_KEY is present, so the Gate-3
// entailment and Gate-5 jury seams have the founder-anchored reliable leg. It is the production twin of the
// eval harness's eval/e2e/lib/real-llm-transport.js: the endpoints, structured-output bodies and wire
// extractors are the SAME shapes that transport proved live (C-135, 2026-07-18/19), so the mint and the
// proof drive an identical wire contract. That duplication of the four body/extractor shapes is a KNOWN,
// ACCEPTED jscpd single-tool lead (a lead is never auto-fixed; unifying a network transport across the
// core/test boundary would couple llm/ to eval/, which the layering forbids) - recorded here, not hidden.
//
// KEYS ARE READ AT CALL TIME, NEVER STORED (Rule 16, public repo). A provider's credential is read fresh
// from env INSIDE its .call closure at call time and used only to build that one request's Authorization
// header; it is never captured at construction, never a property of the returned provider object, never
// logged, never returned. This source names ENV VAR NAMES and the 'Bearer ' scheme word (neither a secret);
// it holds no key value. A family whose keys are absent contributes NO provider (buildChain omits it), so a
// dead leg is visible by its absence, never a phantom provider with an empty header.
//
// NETWORK-FREE BY INJECTION: the transport is dependency-injected (opts.fetchImpl); every test passes a
// fake, so no real socket ever opens in CI. The default production transport is a SINGLE fetch per call
// (C-138: exactly one attempt here; llm/router.js owns fall-over and the hard per-provider deadline, Rule 9).

const { withDeadline } = require('../router.js');
const { makeOpenRouterProvider, openRouterAbsence, OPENROUTER_FAMILY } = require('./openrouter.js');

// PROVIDER_MODELS: the ONE place the free-tier model ids live (C-135). Free-first families matching
// llm/router.js FAMILY_ORDER. Verified live by the eval preflight 2026-07-18/19; rotate ids HERE only.
const PROVIDER_MODELS = Object.freeze({
  cloudflare: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  nim: ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct'],
  gemini: ['gemini-2.0-flash'],
});

const MAX_TOKENS_CAP = 2048;
const DEFAULT_MAX_TOKENS = 900;
const PREFLIGHT_DEADLINE_MS = 12000; // a CAP on the one liveness probe per provider (Rule 8/9).

// envKeysPresent(env) -> the families whose credentials are ALL present. cloudflare needs a token AND an
// account id; the others need one key each. Reads only presence into a return, never a value (Rule 16).
function envKeysPresent(env) {
  const e = env || {};
  const present = [];
  if (e.CLOUDFLARE_API_TOKEN && (e.CLOUDFLARE_ACCOUNT_ID || e.CF_ACCOUNT_ID)) present.push('cloudflare');
  if (e.GROQ_API_KEY) present.push('groq');
  if (e.NIM_API_KEY) present.push('nim');
  if (e.GEMINI_API_KEY || e.GOOGLE_API_KEY) present.push('gemini');
  return present;
}

// ── structured-output body builders (C-137: every JSON call sets the provider's own structured mode) ──
function messagesFor(request) {
  const msgs = [];
  if (request && request.system) msgs.push({ role: 'system', content: String(request.system) });
  msgs.push({ role: 'user', content: String((request && request.prompt) || '') });
  return msgs;
}
function maxTokensFor(request) {
  const n = Number(request && request.max_tokens);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOKENS_CAP) : DEFAULT_MAX_TOKENS;
}
function openAiBody(model, request) {
  return { model, messages: messagesFor(request), temperature: 0, max_tokens: maxTokensFor(request), response_format: { type: 'json_object' } };
}
function geminiBody(request) {
  return {
    systemInstruction: request && request.system ? { parts: [{ text: String(request.system) }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: String((request && request.prompt) || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokensFor(request), responseMimeType: 'application/json' },
  };
}
function cloudflareBody(request) {
  return { messages: messagesFor(request), temperature: 0, max_tokens: maxTokensFor(request), response_format: { type: 'json_object' } };
}

// ── wire-response text extractors (one per provider shape) ───────────────────────────────────────────
function textFromOpenAi(json) {
  const c = json && json.choices && json.choices[0];
  return (c && c.message && typeof c.message.content === 'string') ? c.message.content : '';
}
function textFromGemini(json) {
  const cand = json && json.candidates && json.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
}
function textFromCloudflare(json) {
  const r = json && json.result;
  if (r && typeof r.response === 'string') return r.response;
  if (r && r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  return '';
}

// ── the transport: ONE deadline-bounded fetch (router owns the deadline + no-retry) ───────────────────
function httpErr(status, bodyText) {
  return 'HTTP ' + status + ': ' + String(bodyText || '').replace(/\s+/g, ' ').slice(0, 120);
}
async function readErrorBody(res) {
  try { return await res.text(); }
  catch (_e) { return '(error body unreadable)'; /* FAIL-OPEN: best-effort telemetry; the status code carries the load-bearing signal. */ }
}
// doFetch(url, options, signal, extract) -> { ok, text } | { ok:false, error }. ONE fetch, honouring the
// injected abort signal. A non-2xx returns ok:false (never throws) so the router records a clean outcome
// and falls over; a network throw propagates to the router's withDeadline (captured as a first-class
// value there, so no redundant catch here - caution.md C-239).
async function doFetch(url, options, signal, extract) {
  const res = await fetch(url, Object.assign({ signal }, options));
  if (!res.ok) return { ok: false, error: httpErr(res.status, await readErrorBody(res)) };
  const text = extract(await res.json());
  return (text && text.trim()) ? { ok: true, text } : { ok: false, error: 'empty_text' };
}

// ── provider builders. Each returns a router provider { name, family, tier, model, call } whose .call
//    reads its key FRESH from env at call time (Rule 16: never captured at construction, never on the
//    object). The transport is injected (fetchImpl) so no socket opens in tests. ────────────────────────
function providerName(family, model) { return family + '::' + model; }

function buildGroqProvider(env, model, fetchImpl) {
  return {
    name: providerName('groq', model), family: 'groq', tier: 'free', model,
    call: (request, ctx) => (fetchImpl || doFetch)(
      'https://api.groq.com/openai/v1/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (env.GROQ_API_KEY || '') }, body: JSON.stringify(openAiBody(model, request)) },
      ctx && ctx.signal, textFromOpenAi),
  };
}
function buildNimProvider(env, model, fetchImpl) {
  return {
    name: providerName('nim', model), family: 'nim', tier: 'free', model,
    call: (request, ctx) => (fetchImpl || doFetch)(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (env.NIM_API_KEY || '') }, body: JSON.stringify(openAiBody(model, request)) },
      ctx && ctx.signal, textFromOpenAi),
  };
}
function buildGeminiProvider(env, model, fetchImpl) {
  return {
    name: providerName('gemini', model), family: 'gemini', tier: 'free', model,
    call: (request, ctx) => (fetchImpl || doFetch)(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || ''),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(geminiBody(request)) },
      ctx && ctx.signal, textFromGemini),
  };
}
function buildCloudflareProvider(env, model, fetchImpl) {
  const acct = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || '';
  return {
    name: providerName('cloudflare', model), family: 'cloudflare', tier: 'free', model,
    call: (request, ctx) => (fetchImpl || doFetch)(
      'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(acct) + '/ai/run/' + model,
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (env.CLOUDFLARE_API_TOKEN || '') }, body: JSON.stringify(cloudflareBody(request)) },
      ctx && ctx.signal, textFromCloudflare),
  };
}

const FAMILY_BUILDERS = Object.freeze({
  cloudflare: buildCloudflareProvider, groq: buildGroqProvider, nim: buildNimProvider, gemini: buildGeminiProvider,
});

// buildFreeProviders(env, fetchImpl) -> one provider per (present family, candidate model). A family whose
// keys are absent contributes nothing (a dead leg is visible by its absence, never a phantom provider).
function buildFreeProviders(env, fetchImpl) {
  const present = new Set(envKeysPresent(env));
  const out = [];
  for (const fam of Object.keys(PROVIDER_MODELS)) {
    if (!present.has(fam)) continue;
    for (const model of PROVIDER_MODELS[fam]) out.push(FAMILY_BUILDERS[fam](env, model, fetchImpl));
  }
  return out;
}

// ── liveness preflight (C-135): probe each provider/model ONCE, serially, deadline-bounded, and report
//    which answered. A dead id is attributed to its exact provider, never hidden behind a fall-over. ────
function preflightRequest() {
  return {
    role: 'extract',
    system: 'You are a JSON echo. Reply with STRICT JSON only, no prose.',
    prompt: 'Return exactly this JSON object and nothing else: {"ok":true,"probe":"tamazia-mint-preflight"}',
    max_tokens: 60, temperature: 0, deadline_ms: PREFLIGHT_DEADLINE_MS,
  };
}
function preflightRow(p, raced, ms) {
  if (raced.timedOut) return { provider: p.name, family: p.family, model: p.model, ok: false, ms, error: 'timeout' };
  if (raced.error !== undefined) return { provider: p.name, family: p.family, model: p.model, ok: false, ms, error: String(raced.error).slice(0, 120) };
  const v = raced.value;
  if (v && v.ok) return { provider: p.name, family: p.family, model: p.model, ok: true, ms, error: null };
  return { provider: p.name, family: p.family, model: p.model, ok: false, ms, error: (v && v.error) || 'no_text' };
}
// preflightAll(providers, opts) -> [{provider, family, model, ok, ms, error}]. Serial (C-138: never a
// concurrency burst on a free tier); each probe hard-bounded by the router's withDeadline (Rule 9).
async function preflightAll(providers, opts = {}) {
  const out = [];
  for (const p of providers) {
    const t0 = Date.now();
    const controller = new AbortController();
    const raced = await withDeadline(
      Promise.resolve().then(() => p.call(preflightRequest(), { signal: controller.signal })),
      PREFLIGHT_DEADLINE_MS, () => controller.abort());
    const row = preflightRow(p, raced, Date.now() - t0);
    if (typeof opts.log === 'function') opts.log({ event: 'preflight', provider: row.provider, ok: row.ok, ms: row.ms, error: row.error });
    out.push(row);
  }
  return out;
}

/**
 * buildChain(opts) -> { providers, families, preflight }.
 *   providers  the router-provider array (free families present in env, then the Ministral anchor when
 *              OPENROUTER_API_KEY is present). Each has a .call that reads its key fresh at call time.
 *   families   the distinct family names on the chain (the C-133 independence set the jury draws from).
 *   preflight  () => Promise<liveness rows> (C-135), bound to THIS chain's providers.
 *
 * opts.env       the env to read (default process.env); only PRESENCE is checked here (values at call time).
 * opts.fetchImpl injected transport for the free providers AND the anchor (tests: a fake; production: omit).
 */
function buildChain(opts = {}) {
  const env = opts.env || process.env;
  const providers = buildFreeProviders(env, opts.fetchImpl);
  const anchor = makeOpenRouterProvider({ env, fetchImpl: opts.fetchImpl });
  if (anchor) providers.push(anchor);
  else if (typeof opts.log === 'function') opts.log({ event: 'anchor_absent', ...openRouterAbsence(env) });
  return {
    providers,
    families: [...new Set(providers.map((p) => p.family))],
    preflight: () => preflightAll(providers, { log: opts.log }),
  };
}

module.exports = {
  buildChain,
  buildFreeProviders,
  envKeysPresent,
  preflightAll,
  preflightRequest,
  // body/extractor shapes exported for the node:test suite (the accepted transport clone; never a fact producer):
  openAiBody,
  geminiBody,
  cloudflareBody,
  textFromOpenAi,
  textFromGemini,
  textFromCloudflare,
  doFetch,
  PROVIDER_MODELS,
  OPENROUTER_FAMILY,
};
