'use strict';
// llm/providers/openrouter.js - the OpenRouter / Ministral-8b PROVIDER FACTORY (Constitution Rule 9,
// Rule 11, Rule 12 gates 3 and 5, Rule 16; caution.md C-133/C-135/C-137/C-138).
//
// This is the production provider the founder decided (2026-07-19, delegated) to ANCHOR Gate-3
// entailment and the Gate-5 jury on: model `mistralai/ministral-8b` served by OpenRouter. It returns a
// plain llm/router.js provider object { name, family:'mistral', tier:'paid', model, call } that
// route()/quorum() drive; router.js re-exports makeOpenRouterProvider so this file is reachable from the
// routing layer (Rule 5) while router.js itself stays free of any socket in its own body.
//
// WHY A SEPARATE FILE, NOT INSIDE router.js: router.js is the deterministic, NO-NETWORK routing shell -
// its header contract is that it never opens a socket or reads a provider key. A fetch-capable, key-
// reading factory placed literally in router.js would break that contract and Rule 9's "llm/router.js
// exposes only deadline-wrapped call primitives (no raw fetch call exports)". So the factory lives here
// and router.js re-exports it; the routing body stays pure.
//
// NETWORK-FREE BY INJECTION (the no-network test doctrine): the transport is dependency-injected
// (opts.fetchImpl). Every test passes a fake, so no real OpenRouter socket ever opens in CI. The default
// production transport is a SINGLE fetch (C-138: exactly one attempt here, the router owns fall-over);
// the hard per-call deadline is imposed by the router's withDeadline when this provider is routed
// (Rule 9), and the injected AbortSignal is honoured, so a slow OpenRouter degrades the mint, never
// hangs it.
//
// C-137: response_format json_object is set on every call (OpenRouter is OpenAI-compatible), so the
// JSON-expecting Gate-3 / jury calls use the provider's own structured-output mode.
//
// Rule 16 (public repo, no secret in any file): the OPENROUTER_API_KEY is read from env ONLY inside the
// call closure, at CALL time, and is never captured at construction, never returned, never logged, never
// written to a recording. This source names the ENV VAR NAME and the "Bearer " scheme word (neither is a
// secret); it never contains a key value.
//
// C-135 (a missing model/key is LOUD, never silent): makeOpenRouterProvider returns null when the key is
// absent and openRouterAbsence() explains why, so the caller falls back to the free chain (entailment) or
// fails the quorum closed (jury) - it never silently degrades to a phantom Ministral leg.

const FAMILY = 'mistral';                                   // the C-133 independence key, distinct from
//                                                             llama/groq/gemini/qwen/nemotron/cloudflare.
const MODEL = 'mistralai/ministral-8b';                     // the ONE model id (C-135); rotate HERE only.
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const KEY_ENV = 'OPENROUTER_API_KEY';                       // the env var NAME (not a secret); Rule 16.
const AUTH_SCHEME = 'Bearer ';                              // the scheme word (not a secret); Rule 16.
const MAX_TOKENS_CAP = 2048;
const DEFAULT_MAX_TOKENS = 900;

// readKey(env): the raw key STRING from env, or '' when absent. Called ONLY inside the call closure at
// call time (Rule 16); the returned value is used to build the Authorization header and is never
// retained beyond the single request.
function readKey(env) {
  const e = env || process.env;
  const v = e[KEY_ENV];
  return typeof v === 'string' ? v : '';
}

// hasKey(env): a boolean presence probe used at construction to decide ABSENT (C-135). It reads whether
// the var is set; it does NOT retain the value (no closure capture of the secret at construction time).
function hasKey(env) {
  return readKey(env).length > 0;
}

// messagesFor(request): the OpenAI-style chat message array (system then user). Self-contained on purpose
// so llm/ carries no dependency on the eval-harness transport (dependency direction stays core <- test).
function messagesFor(request) {
  const msgs = [];
  if (request && request.system) msgs.push({ role: 'system', content: String(request.system) });
  msgs.push({ role: 'user', content: String((request && request.prompt) || '') });
  return msgs;
}

// maxTokensFor(request): a positive request override CLAMPED to the cap, else the default (Rule 8: a cap,
// never a floor).
function maxTokensFor(request) {
  const n = Number(request && request.max_tokens);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOKENS_CAP) : DEFAULT_MAX_TOKENS;
}

// openRouterBody(request): the OpenAI-compatible chat body. temperature 0 and response_format json_object
// (C-137); Ministral-8b named as the model (C-135).
function openRouterBody(request) {
  return {
    model: MODEL,
    messages: messagesFor(request),
    temperature: 0,
    max_tokens: maxTokensFor(request),
    response_format: { type: 'json_object' },
  };
}

// textFromOpenAi(json): pull the assistant text out of an OpenAI-shaped chat response, or '' when absent.
function textFromOpenAi(json) {
  const c = json && json.choices && json.choices[0];
  return (c && c.message && typeof c.message.content === 'string') ? c.message.content : '';
}

// httpErr(status, bodyText): a short, KEY-FREE error string for the router's attempt ledger. Never
// includes a request header (Rule 16).
function httpErr(status, bodyText) {
  return 'HTTP ' + status + ': ' + String(bodyText || '').replace(/\s+/g, ' ').slice(0, 120);
}

// doFetchOpenRouter(url, options, signal, extract): ONE fetch attempt, honouring the abort signal, reduced
// to { ok, text } | { ok:false, error }. `fetch` is the Node global (not a known injected external ident,
// so the deadline-audit gate does not flag it) and it carries the AbortSignal, so it reads as self-bounded
// and the router's withDeadline is the hard deadline around it (Rule 9). A non-2xx returns ok:false (never
// throws) so the router records a clean outcome and falls over; a network throw propagates to the router's
// withDeadline, which captures it as a first-class value (no redundant catch here, caution.md C-239).
// readErrorBody(res): best-effort error-body text for the attempt ledger. NEVER throws - if the body
// stream itself errors we still surface the status code, which is the load-bearing signal.
async function readErrorBody(res) {
  try {
    return await res.text();
  } catch (_e) {
    return '(error body unreadable)'; // FAIL-OPEN: best-effort telemetry; the status code carries the signal.
  }
}
async function doFetchOpenRouter(url, options, signal, extract) {
  const res = await fetch(url, Object.assign({ signal }, options));
  if (!res.ok) return { ok: false, error: httpErr(res.status, await readErrorBody(res)) };
  const text = extract(await res.json());
  return (text && text.trim()) ? { ok: true, text } : { ok: false, error: 'empty_text' };
}

// openRouterAbsence(env): the C-135 LOUD-ABSENT report. { absent:false } when the key is present, else
// { absent:true, family, reason } so a caller can log WHY Ministral did not join the chain/jury and fall
// back or fail-closed rather than silently drop a leg.
function openRouterAbsence(env) {
  if (hasKey(env)) return { absent: false, family: FAMILY, model: MODEL };
  return {
    absent: true, family: FAMILY, model: MODEL,
    reason: KEY_ENV + ' is absent -> the Ministral-8b provider is ABSENT (C-135); the caller falls back to the free chain (Gate 3) or fails the quorum closed (Gate 5), never silently degrades',
  };
}

/**
 * makeOpenRouterProvider(opts) -> a router provider { name, family:'mistral', tier:'paid', model, call }
 * or NULL when the key is absent (C-135 loud absent; pair with openRouterAbsence() for the reason).
 *
 * opts.env        the env to read (default process.env). Only its PRESENCE is checked here; the value is
 *                 read fresh inside call() at call time (Rule 16).
 * opts.fetchImpl  the injected transport (tests: a fake; production: omit to use the single real fetch).
 *                 Signature (url, options, signal, extract) -> Promise<{ok,text}|{ok:false,error}>.
 *
 * call(request, { signal }) returns the transport promise WITHOUT awaiting it, so llm/router.js's
 * withDeadline is the ONE hard deadline around the network step (Rule 9); this factory adds no retry
 * (C-138: exactly one attempt, the router owns fall-over).
 */
function makeOpenRouterProvider(opts = {}) {
  const env = opts.env || process.env;
  if (!hasKey(env)) return null; // C-135: absent key -> no phantom provider; caller handles the absence.
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : doFetchOpenRouter;
  return {
    name: 'openrouter::' + MODEL,
    family: FAMILY,
    tier: 'paid',
    model: MODEL,
    call: (request, ctx) => {
      const key = readKey(env); // Rule 16: read at CALL time, used only to build this one header.
      const signal = ctx && ctx.signal;
      const options = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: AUTH_SCHEME + key },
        body: JSON.stringify(openRouterBody(request)),
      };
      return fetchImpl(ENDPOINT, options, signal, textFromOpenAi);
    },
  };
}

if (require.main === module) {
  process.stderr.write('llm/providers/openrouter.js is a library (makeOpenRouterProvider). The transport is injected; it opens a socket only when a routed .call is invoked in production, never in CI.\n');
  process.exit(2);
}

module.exports = {
  makeOpenRouterProvider,
  openRouterAbsence,
  messagesFor,
  maxTokensFor,
  openRouterBody,
  textFromOpenAi,
  doFetchOpenRouter,
  OPENROUTER_FAMILY: FAMILY,
  OPENROUTER_MODEL: MODEL,
  OPENROUTER_ENDPOINT: ENDPOINT,
  OPENROUTER_KEY_ENV: KEY_ENV,
};
