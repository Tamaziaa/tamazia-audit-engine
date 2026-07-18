'use strict';
/**
 * eval/e2e/lib/real-llm-transport.js - the PROVIDER TRANSPORT layer for the real-model proof, extracted
 * from eval/e2e/lib/real-llm.js (P3-tail Wave-2 U1 resume, caution.md C-254: real-llm.js crossed the
 * 500-line health-gate cap once Builder B unified the key-derivation seam into it; C-254's prescribed
 * remedy is "extract a module, never grow the file"). This file owns everything about CONSTRUCTING and
 * CALLING a provider: the ONE model-id config (C-135), the per-provider structured-output body builders
 * (C-137), the wire-response text extractors, the single deadline-bounded fetch attempt, and the
 * liveness-probe request/row reducer. It is INJECTED into llm/router.js as the provider `.call` transport
 * (the "callers supplied by the mint layer" the router documents); real-llm.js owns the routing,
 * recording, gating and factory around it.
 *
 * NO retry, NO backoff (C-175: exactly one fetch per call; the router owns fall-over). NO key is ever
 * logged or returned - the Authorization header lives only inside each provider `.call` closure and is
 * never placed in a return value (Rule 16). Pure transport: no recording, no router, no factory state.
 */

// PROVIDER_MODELS: the ONE place model IDs live (caution.md C-135). Free-first families matching
// llm/router.js FAMILY_ORDER (cloudflare, groq, nim, gemini). Each family lists candidate model IDs in
// preference order; the liveness preflight probes them and the first that answers is used. A dead id is
// reported (C-135), never silently retried. Add/rotate ids HERE and nowhere else.
// Model IDs verified against the live providers on 2026-07-18/19 by run-real-proof.js's preflight (C-135):
// cloudflare (both live), groq (both live), nim (8b live; 70b slow, kept - a timeout is transient, not
// a dead id), gemini-2.0-flash (live; free key currently 429 quota-limited). gemini-1.5-flash and
// gemini-1.5-flash-8b were REMOVED after the preflight returned 404 "not found for v1beta" for both -
// shipping a retired id is exactly the C-135 defect (8 refs to a retired model 401'd for weeks).
const PROVIDER_MODELS = {
  cloudflare: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  nim: ['meta/llama-3.1-8b-instruct', 'meta/llama-3.3-70b-instruct'],
  gemini: ['gemini-2.0-flash'],
};

// envKeysPresent(env): the families whose credentials are all present in env. cloudflare needs BOTH a
// token and an account id; the others need one key each. Never reads a value into a return, only names.
function envKeysPresent(env) {
  const e = env || {};
  const present = [];
  if (e.CLOUDFLARE_API_TOKEN && (e.CLOUDFLARE_ACCOUNT_ID || e.CF_ACCOUNT_ID)) present.push('cloudflare');
  if (e.GROQ_API_KEY) present.push('groq');
  if (e.NIM_API_KEY) present.push('nim');
  if (e.GEMINI_API_KEY || e.GOOGLE_API_KEY) present.push('gemini');
  return present;
}

// ── structured-output body builders (C-137: every JSON-expecting call sets the provider's own mode) ──
// messagesFor(request): the OpenAI-style message array shared by the OpenAI-compatible providers.
function messagesFor(request) {
  const msgs = [];
  if (request.system) msgs.push({ role: 'system', content: String(request.system) });
  msgs.push({ role: 'user', content: String(request.prompt || '') });
  return msgs;
}
function maxTokensFor(request) {
  const n = Number(request.max_tokens);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2048) : 900;
}

// openAiBody(model, request): the OpenAI-compatible chat body (Groq, NIM). response_format json_object
// is the portable structured-output mode both support (C-137).
function openAiBody(model, request) {
  return {
    model,
    messages: messagesFor(request),
    temperature: 0,
    max_tokens: maxTokensFor(request),
    response_format: { type: 'json_object' },
  };
}
// geminiBody(request): Gemini generateContent with responseMimeType application/json (C-137). The
// system prompt is folded into systemInstruction (v1beta).
function geminiBody(request) {
  return {
    systemInstruction: request.system ? { parts: [{ text: String(request.system) }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: String(request.prompt || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokensFor(request), responseMimeType: 'application/json' },
  };
}
// cloudflareBody(request): Workers AI chat body; response_format json_object where the model supports it
// (C-137). Unknown-support models still return text the gate.js extractor can parse.
function cloudflareBody(request) {
  return {
    messages: messagesFor(request),
    temperature: 0,
    max_tokens: maxTokensFor(request),
    response_format: { type: 'json_object' },
  };
}

// ── response text extractors (one per provider wire shape) ───────────────────────────────────────────
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

// ── the transport: ONE deadline-bounded fetch attempt (the router owns the deadline + no-retry) ───────
// httpErr(status, bodyText): a short, key-free error string for the attempt ledger (U1-B4: 429s and
// dead-model 401/404 surface here). Never includes a request header.
function httpErr(status, bodyText) {
  return 'HTTP ' + status + ': ' + String(bodyText || '').replace(/\s+/g, ' ').slice(0, 120);
}
// doFetch(url, options, signal, extract): perform ONE fetch, honour the abort signal, and reduce the
// response to { ok, text } | { ok:false, error }. Returns ok:false (never throws) on a non-2xx so the
// router records a clean outcome and falls over; a network throw propagates to the router's withDeadline
// (which captures it as a first-class value - no redundant catch here, caution.md C-239).
async function doFetch(url, options, signal, extract) {
  const res = await fetch(url, Object.assign({ signal }, options));
  if (!res.ok) {
    let body = '';
    // FAIL-OPEN: reading the error body is best-effort telemetry for the attempt ledger; if the body
    // stream itself errors we still return the status code, which is the load-bearing signal (U1-B4).
    try { body = await res.text(); } catch (_e) { body = '(error body unreadable)'; }
    return { ok: false, error: httpErr(res.status, body) };
  }
  const json = await res.json();
  const text = extract(json);
  return text && text.trim() ? { ok: true, text } : { ok: false, error: 'empty_text' };
}

// ── provider builders (each returns a router provider {name, family, tier, model, call} or null) ──────
// name is family::model so it is unique per model and the recording meta can recover the model id.
function providerName(family, model) { return family + '::' + model; }
function modelOfName(name) { const i = String(name).indexOf('::'); return i === -1 ? '' : String(name).slice(i + 2); }
function familyOfName(name) { const i = String(name).indexOf('::'); return i === -1 ? String(name) : String(name).slice(0, i); }

function buildGroqProvider(env, model, fetchImpl) {
  const key = env.GROQ_API_KEY;
  if (!key) return null;
  return {
    name: providerName('groq', model), family: 'groq', tier: 'free', model,
    call: (request, { signal }) => (fetchImpl || doFetch)(
      'https://api.groq.com/openai/v1/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(openAiBody(model, request)) },
      signal, textFromOpenAi),
  };
}
function buildNimProvider(env, model, fetchImpl) {
  const key = env.NIM_API_KEY;
  if (!key) return null;
  return {
    name: providerName('nim', model), family: 'nim', tier: 'free', model,
    call: (request, { signal }) => (fetchImpl || doFetch)(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(openAiBody(model, request)) },
      signal, textFromOpenAi),
  };
}
function buildGeminiProvider(env, model, fetchImpl) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) return null;
  return {
    name: providerName('gemini', model), family: 'gemini', tier: 'free', model,
    call: (request, { signal }) => (fetchImpl || doFetch)(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(geminiBody(request)) },
      signal, textFromGemini),
  };
}
function buildCloudflareProvider(env, model, fetchImpl) {
  const key = env.CLOUDFLARE_API_TOKEN;
  const acct = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  if (!key || !acct) return null;
  return {
    name: providerName('cloudflare', model), family: 'cloudflare', tier: 'free', model,
    call: (request, { signal }) => (fetchImpl || doFetch)(
      'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(acct) + '/ai/run/' + model,
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(cloudflareBody(request)) },
      signal, textFromCloudflare),
  };
}

const FAMILY_BUILDERS = {
  cloudflare: buildCloudflareProvider, groq: buildGroqProvider, nim: buildNimProvider, gemini: buildGeminiProvider,
};

// buildProvidersFromEnv(env, opts): the full provider set from env keys, one entry per (family, model)
// candidate whose key is present. opts.families limits to a subset; opts.fetchImpl injects a fake
// transport for tests (network-free). Free-first ordering is imposed by the router, not here.
function buildProvidersFromEnv(env, opts = {}) {
  const e = env || {};
  const families = opts.families || Object.keys(PROVIDER_MODELS);
  const out = [];
  for (const fam of families) {
    const builder = FAMILY_BUILDERS[fam];
    const models = PROVIDER_MODELS[fam] || [];
    if (!builder) continue;
    for (const model of models) {
      const p = builder(e, model, opts.fetchImpl);
      if (p) out.push(p);
    }
  }
  return out;
}

// ── liveness preflight request + row reducer (C-135) ─────────────────────────────────────────────────
// preflightRequest(): a trivial JSON-echo probe. Not a breach-path call kind; its result is logged to
// the gitignored raw log only, never to the committed recorded-llm.v1 contract.
function preflightRequest() {
  return {
    role: 'extract',
    system: 'You are a JSON echo. Reply with STRICT JSON only, no prose.',
    prompt: 'Return exactly this JSON object and nothing else: {"ok":true,"probe":"tamazia-real-llm-preflight"}',
    max_tokens: 60, temperature: 0, deadline_ms: 12000, scan_id: 'preflight',
  };
}
// buildPreflightRow(provider, raced, ms): reduce a router withDeadline result to a liveness row. No
// throw: a timeout, a rejection and a non-2xx are all first-class reported outcomes (C-135/U1-B4).
function buildPreflightRow(p, raced, ms) {
  if (raced.timedOut) return { provider: p.family, model: p.model, ok: false, ms, error: 'timeout', raw: null };
  if (raced.error !== undefined) return { provider: p.family, model: p.model, ok: false, ms, error: String(raced.error).slice(0, 120), raw: null };
  const v = raced.value;
  if (v && v.ok) return { provider: p.family, model: p.model, ok: true, ms, error: null, raw: String(v.text || '').slice(0, 200) };
  return { provider: p.family, model: p.model, ok: false, ms, error: (v && v.error) || 'no_text', raw: null };
}

if (require.main === module) {
  process.stderr.write('eval/e2e/lib/real-llm-transport.js is a library (provider transport). It is injected into llm/router.js by real-llm.js; it opens a socket only when a real provider .call is invoked.\n');
  process.exit(2);
}

module.exports = {
  PROVIDER_MODELS,
  envKeysPresent,
  messagesFor,
  maxTokensFor,
  openAiBody,
  geminiBody,
  cloudflareBody,
  textFromOpenAi,
  textFromGemini,
  textFromCloudflare,
  httpErr,
  doFetch,
  providerName,
  modelOfName,
  familyOfName,
  buildGroqProvider,
  buildNimProvider,
  buildGeminiProvider,
  buildCloudflareProvider,
  buildProvidersFromEnv,
  preflightRequest,
  buildPreflightRow,
};
