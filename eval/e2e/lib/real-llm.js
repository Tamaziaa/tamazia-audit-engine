'use strict';
/**
 * eval/e2e/lib/real-llm.js - the ENV-GATED real-model llmCall adapter for the P3-tail reproduction
 * proof (docs/P3-TAIL-ACCEPTANCE.md, U1). This is the ONLY file in eval/e2e that ever opens a network
 * socket, and it opens one ONLY when process.env.RUN_REAL_LLM === '1' AND at least one provider key is
 * present. Absent either, construction THROWS (fail-closed): the harness's default remains the offline
 * scripted-llm.js, so CI and a keyless laptop never phone a provider.
 *
 * WHAT IT IS. A factory that builds a real llmCall(request) routed through the engine's OWN
 * provider-routing shell (llm/router.js route(): free-first, one deadline-bounded attempt per provider,
 * no retry storm) over provider objects this module constructs from env keys. The provider .call()
 * functions are the transport llm/router.js documents as "injected by the mint layer" - this file is
 * that layer for the proof. It touches NO breach/, llm/, facts/, evidence/ or tools/ module (it only
 * IMPORTS the already-deadline-wrapped router primitive and the gate.js structural validator, per the
 * Constitution's "expose only deadline-wrapped call primitives" contract).
 *
 * THE llmCall CONTRACT (mirrors eval/e2e/lib/scripted-llm.js, the shape the real consumers expect):
 *   - ADJUDICATION request (breach/adjudicator/adjudicate.js callGate): carries `rubric` (a function)
 *     and `system`/`prompt`, NO schema. Return { ok, out:{verdicts:[...]}, provider, model, score } or
 *     { ok:false }. The router applies the adjudicator's own deterministic rubric as its structural
 *     `validate` (a fluent-but-unparseable answer loses to the next provider; a rubric miss is a
 *     provider failure, never a retry-with-altered-prompt - the base prompt is sent VERBATIM, Rule 11).
 *   - ENTAILMENT request (llm/entailment.js callModel, Gate 3): carries `schema` whose verdict enum
 *     includes 'entailment', plus allowedSourceIds/sources. Return { ok, text:<verbatim>, provider,
 *     model }; llm/entailment.js then runs its OWN llm/gate.js validateResponse over the text (schema +
 *     retrieval-gate + quote-match), so this adapter passes the same gate.js validator as the router's
 *     `validate` and hands back the raw text for that second, authoritative gate to reduce.
 *
 * CAUTIONS HONOURED: C-137 (structured-output mode set per provider), C-138/C-184 (serial, quota-aware
 * spacing between calls, one attempt per provider, no concurrency burst), C-175 (no backoff/retry after
 * the final attempt - the router makes exactly one attempt per provider and this adapter adds none),
 * C-135 (model IDs in ONE config with a liveness preflight; a dead id is reported, never silently
 * retried), C-146 (temperature 0 is not determinism: every call's prompt/model/inputs/output is logged
 * in full to the gitignored record dir), Rule 9 (every call is deadline-wrapped by the router; the cap
 * is never a floor), Rule 16 (no key is ever logged, written to a recording, or returned; a secret-shape
 * guard scans every recording before it is written).
 *
 * NO recording, log line, or return value ever carries a provider key. See writeRecordingFile()'s
 * secret-shape guard and callTransport()'s deliberate omission of the Authorization header from logs.
 */

const fs = require('fs');
const path = require('path');
const { route } = require('../../../llm/router.js');
const { validateResponse } = require('../../../llm/gate.js');
// The key-derivation seam (P3-tail Wave-2 Builder B, C-211/C-222 closure): stableStringify,
// artifactFingerprint and recordingKey used to be defined locally in this file; they now live in the
// ONE shared module both this recorder and eval/e2e/lib/replay-llm.js import, so the two sides of the
// frozen recorded-response contract can never independently drift (C-216). CONTRACT is single-sourced
// there too. Nothing else in this file changes: these are re-exported below under their original names
// so every existing caller of this module (run-real-proof.js, real-llm.test.js) is unaffected.
const { CONTRACT, stableStringify, artifactFingerprint, recordingKey } = require('./record-key.js');

// ── caps + defaults (Rule 8: every one is an upper bound, never a floor) ─────────────────────────────
const DEFAULT_DEADLINE_MS = 20000;   // per-call hard deadline CAP handed to the router (Rule 9).
const MAX_DEADLINE_MS = 30000;       // the ceiling a request.deadline_ms override is clamped to.
const DEFAULT_SPACING_MS = 400;      // quota-courtesy gap BETWEEN calls (C-138); a rate cap, not a
//                                      per-call latency floor - it delays the START of the next call,
//                                      never lengthens any single call (see Pacer below).
const MAX_SPACING_MS = 5000;         // clamp on any REAL_LLM_SPACING_MS override.
const RECORD_DIRNAME = path.join(__dirname, '..', 'record');            // gitignored raw call logs.
const RECORDED_DIRNAME = path.join(__dirname, '..', 'fixtures', 'recorded'); // committed, sanitised.

// Secret-SHAPE fragments (Rule 16). A recording or log line containing any of these is refused. Each is
// BUILT from non-contiguous parts so no literal credential prefix ever appears in this source file - the
// required secret-shape grep then returns zero hits on this file while runtime detection is unchanged
// (caution.md C-253: a no-leak guard must not embed a secret-shaped literal). The reassembled runtime
// values are the real provider-key prefixes (Groq, Google, GitHub, Stripe-style, Neon, Cloudflare) the
// guard matches against, plus the Authorization scheme word.
const SECRET_SHAPES = [
  'g' + 'sk_', 'AI' + 'za', 'g' + 'hp_', 'git' + 'hub_pat_', 's' + 'k-', 'np' + 'g_', 'cf' + 'ut_', 'Bearer ',
];

// PROVIDER_MODELS: the ONE place model IDs live (caution.md C-135). Free-first families matching
// llm/router.js FAMILY_ORDER (cloudflare, groq, nim, gemini). Each family lists candidate model IDs in
// preference order; the liveness preflight probes them and the first that answers is used. A dead id is
// reported (C-135), never silently retried. Add/rotate ids HERE and nowhere else.
// Model IDs verified against the live providers on 2026-07-18 by run-real-proof.js's preflight (C-135):
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

// ── env gate (fail-closed construction) ─────────────────────────────────────────────────────────────
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

// assertRunGate(env): the RUN_REAL_LLM=1 hard gate. Construction of a real caller is refused unless the
// operator explicitly opted in AND at least one provider's keys are present (fail-closed, Rule 4).
function assertRunGate(env) {
  const e = env || {};
  if (e.RUN_REAL_LLM !== '1') {
    throw new Error('real-llm: refusing to construct a real LLM caller (RUN_REAL_LLM is not "1"). The eval harness default is the offline scripted-llm.js; set RUN_REAL_LLM=1 only for the local proof run.');
  }
  const fams = envKeysPresent(e);
  if (fams.length === 0) {
    throw new Error('real-llm: RUN_REAL_LLM=1 but no provider keys are present in env (need one of GROQ_API_KEY, GEMINI_API_KEY, or CLOUDFLARE_API_TOKEN+CLOUDFLARE_ACCOUNT_ID, or NIM_API_KEY). Refusing to construct (fail-closed).');
  }
  return fams;
}

// ── the quota pacer (C-138): a courtesy gap BETWEEN calls, never a per-call latency floor (Rule 8). ──
// It delays only the START of the next call so a burst never storms a free tier; a call that arrives
// after the gap has already elapsed waits zero. Per-instance state (closure), never module scope (C-153).
function createPacer(spacingMs) {
  let last = 0;
  return {
    async wait() {
      const now = Date.now();
      const gap = last === 0 ? 0 : Math.max(0, spacingMs - (now - last));
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      last = Date.now();
    },
  };
}

// ── request-kind detection (mirrors scripted-llm.js isEntailmentRequest) ─────────────────────────────
function isEntailmentRequest(request) {
  const enumSet = request && request.schema && request.schema.properties
    && request.schema.properties.verdict && request.schema.properties.verdict.enum;
  return Array.isArray(enumSet) && enumSet.includes('entailment');
}
// isAdjudicationRequest: the adjudicator always hands a deterministic `rubric` function and no schema.
function isAdjudicationRequest(request) {
  return Boolean(request) && typeof request.rubric === 'function';
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
// system prompt is folded into the first user turn (v1beta systemInstruction is also honoured below).
function geminiBody(request) {
  return {
    systemInstruction: request.system ? { parts: [{ text: String(request.system) }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: String(request.prompt || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokensFor(request), responseMimeType: 'application/json' },
  };
}
// cloudflareBody(model, request): Workers AI chat body; response_format json_object where the model
// supports it (C-137). Unknown-support models still return text the gate.js extractor can parse.
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

// ── the two route validators (the structural gates applied inside the router's own validated() path) ──
// parseModelJson(text): reuse llm/gate.js's OWN exported validateResponse as the shared JSON
// extractor+parser (no schema, no retrieval set: it then only parses and returns the value, gating
// nothing). This deliberately does NOT reimplement gate.js's internal object-slice extractor - a second
// divergent parser is exactly the cross-wave clone caution.md C-216 forbids, and gate.js is the one door
// for "turn a model reply into a parsed object". Returns the parsed value, or null when unparseable.
function parseModelJson(text) {
  const gated = validateResponse(text, {}); // no schema/allowedSourceIds -> parse-only, gates nothing
  return gated.ok ? gated.value : null;
}

// rubricValidator(request): a router `validate` that parses the model text (via gate.js), runs the
// adjudicator's OWN deterministic rubric, and accepts only when the score clears the request threshold.
// A miss is a provider failure (fall over), NEVER a retry with an altered prompt (Rule 11: the base
// prompt is sent verbatim; the deterministic rubric is the structural gate). Returns { ok, value }.
function rubricValidator(request) {
  const threshold = Number.isFinite(Number(request.threshold)) ? Number(request.threshold) : 7;
  return function validate(raw) {
    const text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
    const parsed = parseModelJson(text);
    if (!parsed) return { ok: false, violations: [{ code: 'unparseable_json' }] };
    const verdict = request.rubric(parsed);
    const score = verdict && Number.isFinite(verdict.score) ? verdict.score : 0;
    if (verdict && verdict.hard_fail) return { ok: false, violations: [{ code: 'rubric_hard_fail' }] };
    if (score >= threshold) return { ok: true, value: parsed };
    return { ok: false, violations: [{ code: 'rubric_below_threshold' }] };
  };
}
// entailmentValidator(request): the router `validate` for a Gate-3 call - exactly llm/gate.js
// validateResponse over the request's schema + retrieval set. A structurally-valid neutral/contradiction
// PASSES the router (so llm/entailment.js can see and demote it); only a structurally-broken reply
// (unparseable, out-of-set source_id, quote drift) falls the chain over.
function entailmentValidator(request) {
  return function validate(raw) {
    const text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
    const gated = validateResponse(text, { schema: request.schema, allowedSourceIds: request.allowedSourceIds, sources: request.sources });
    if (gated.ok) return { ok: true, value: gated.value };
    return { ok: false, violations: gated.violations || [{ code: 'gate_reject' }] };
  };
}

// ── recording (the frozen recorded-llm.v1 contract) ──────────────────────────────────────────────────
// stableStringify/artifactFingerprint/recordingKey are imported above from the shared record-key.js
// module (the key-derivation seam this wave unified) - see this file's header.

// containsSecretShape(s): true if any secret-shape fragment appears (Rule 16 defence in depth).
function containsSecretShape(s) {
  const str = String(s == null ? '' : s);
  return SECRET_SHAPES.some((frag) => str.includes(frag));
}

// buildRecordingFile({domain, providers, responses, note}): the recorded-llm.v1 object for one domain.
function buildRecordingFile({ domain, providers, responses, note } = {}) {
  return {
    contract: CONTRACT,
    engine: {
      providers: Array.isArray(providers) ? providers.slice() : [],
      recorded_at: new Date().toISOString().slice(0, 10),
      prompt_versions: {},
      domain: domain || null,
      note: note || null,
    },
    responses: Array.isArray(responses) ? responses : [],
  };
}

// validateRecordingFile(obj): schema self-validation of a recorded-llm.v1 file (the calibration gate:
// a malformed recording is REFUSED, never written). Returns { ok, errors }.
function validateOneResponse(r, i, errors) {
  const at = 'responses[' + i + ']';
  if (!r || typeof r !== 'object') { errors.push(at + ': not an object'); return; }
  if (typeof r.key !== 'string' || !/^[0-9a-f]{64}$/.test(r.key)) errors.push(at + '.key must be a 64-hex sha256');
  if (r.kind !== 'adjudicate' && r.kind !== 'entailment') errors.push(at + '.kind must be "adjudicate" or "entailment"');
  if (typeof r.raw !== 'string') errors.push(at + '.raw must be a string (verbatim model output)');
  if (!r.meta || typeof r.meta !== 'object') errors.push(at + '.meta must be an object');
  else {
    if (typeof r.meta.provider !== 'string') errors.push(at + '.meta.provider must be a string');
    if (typeof r.meta.model !== 'string') errors.push(at + '.meta.model must be a string');
  }
  if (containsSecretShape(r.raw)) errors.push(at + '.raw carries a secret-shaped string (Rule 16)');
}
function validateRecordingFile(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['recording is not an object'] };
  if (obj.contract !== CONTRACT) errors.push('contract must be "' + CONTRACT + '"');
  if (!obj.engine || typeof obj.engine !== 'object') errors.push('engine block missing');
  if (!Array.isArray(obj.responses)) errors.push('responses must be an array');
  else obj.responses.forEach((r, i) => validateOneResponse(r, i, errors));
  if (containsSecretShape(stableStringify(obj))) errors.push('recording carries a secret-shaped string (Rule 16)');
  return { ok: errors.length === 0, errors };
}

// writeRecordingFile(dir, domain, obj): validate then write recorded/<domain>.json. THROWS on a
// validation failure or a secret-shape hit (fail-closed, Rule 16): a malformed or key-bearing recording
// is never committed. Returns the absolute path written.
function assertSafeDomain(domain) {
  if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(String(domain))) {
    throw new Error('real-llm: unsafe recording domain component: ' + JSON.stringify(domain));
  }
}
function writeRecordingFile(dir, domain, obj) {
  assertSafeDomain(domain);
  const check = validateRecordingFile(obj);
  if (!check.ok) throw new Error('real-llm: refusing to write an invalid recording for ' + domain + ': ' + check.errors.join('; '));
  const outDir = dir || RECORDED_DIRNAME;
  fs.mkdirSync(outDir, { recursive: true });
  const abs = path.join(outDir, domain + '.json');
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n');
  return abs;
}

// appendRawLog(dir, entry): full call logging (Rule 11 / C-146) to the GITIGNORED record dir. Best
// effort; a log failure must never break the proof (it is observability, not a legal claim). The entry
// carries prompt/rawText/provider/model/ms/attempts but NEVER an auth header or key.
function appendRawLog(dir, entry) {
  const outDir = dir || RECORD_DIRNAME;
  // FAIL-OPEN: the raw call log is gitignored observability (C-146); a write fault here must not fail a
  // proof run or, worse, lose the model's real answer from the run's own stdout. Recorded and dropped.
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(path.join(outDir, 'calls.ndjson'), JSON.stringify(entry) + '\n');
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) console.error('[real-llm] raw-log append failed (non-fatal): ' + e.message);
  }
}

// ── the calls ────────────────────────────────────────────────────────────────────────────────────────
// deadlineFor(request, cap): clamp the request's deadline to the cap (Rule 8: a caller may ask for a
// SHORTER deadline, never a longer one; the cap is the ceiling, never a floor).
function deadlineFor(request, cap) {
  const n = Number(request && request.deadline_ms);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : cap;
}

// runRoute(kind, request, ctx): the shared body of both call kinds - pace, route through the engine's
// own free-first shell with the correct structural validator, log the full call, and return the router
// result plus the winning provider/model. ctx = { providers, pacer, deadlineMs, log, recordDir }.
async function runRoute(kind, request, ctx, validate) {
  await ctx.pacer.wait(); // quota-courtesy gap between calls (C-138), not a per-call floor (Rule 8)
  const t0 = Date.now();
  const attempts = [];
  const result = await route(request, {
    providers: ctx.providers,
    deadlineMs: deadlineFor(request, ctx.deadlineMs),
    validate,
    log: (rec) => attempts.push(rec),
  });
  const ms = Date.now() - t0;
  const provider = result.family || (result.provider ? familyOfName(result.provider) : null);
  const model = result.provider ? modelOfName(result.provider) : null;
  appendRawLog(ctx.recordDir, {
    at: new Date().toISOString(), kind, ok: Boolean(result.ok), ms,
    provider, model, scan_id: request.scan_id || null,
    prompt_chars: String(request.prompt || '').length,
    raw: result.ok ? result.text : null, attempts,
  });
  if (typeof ctx.log === 'function') {
    // The log event carries the verbatim raw text + the request so the DRIVER (run-real-proof.js) can
    // correlate a call to the candidate(s) it covered and assemble the recorded-llm.v1 file. No key is
    // ever in `request` (auth headers live only inside the provider .call closures) or in `raw` (a model
    // completion); writeRecordingFile still secret-scans the final recording (Rule 16, defence in depth).
    ctx.log({ event: 'real_llm_call', kind, ok: Boolean(result.ok), provider, model, ms, attempts, raw: result.ok ? result.text : null, request });
  }
  return { result, provider, model, ms, attempts };
}

// adjudicationCall(request, ctx): return the { ok, out, provider, model, score } shape
// breach/adjudicator/adjudicate.js verdictsFrom() consumes. The rubric is the structural gate.
async function adjudicationCall(request, ctx) {
  const { result, provider, model } = await runRoute('adjudicate', request, ctx, rubricValidator(request));
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider, model };
  return { ok: true, out: result.value, provider, model, score: null };
}
// entailmentCall(request, ctx): return { ok, text } - the raw model text llm/entailment.js re-gates
// with its OWN llm/gate.js validateResponse. result.value is the gate-parsed object; result.text is the
// verbatim string. We hand back the verbatim text (entailment.js parses it), and record that verbatim.
async function entailmentCall(request, ctx) {
  const { result, provider, model } = await runRoute('entailment', request, ctx, entailmentValidator(request));
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider, model };
  return { ok: true, text: result.text, provider, model };
}
// genericCall(request, ctx): a plain structured call (the preflight liveness probe uses this). No
// contract recording (it is not a breach-path adjudicate/entailment kind); the raw log still captures it.
async function genericCall(request, ctx) {
  const { result, provider, model } = await runRoute('generic', request, ctx, null);
  if (!result.ok) return { ok: false, reason: result.reason || 'all_providers_exhausted', provider, model };
  return { ok: true, text: result.text, provider, model };
}

// makeLlmCall(ctx): the dispatching llmCall(request) the consumers receive. Entailment first (it also
// carries a prompt), then adjudication (rubric), else a generic structured call.
function makeLlmCall(ctx) {
  return function llmCall(request) {
    if (isEntailmentRequest(request)) return entailmentCall(request, ctx);
    if (isAdjudicationRequest(request)) return adjudicationCall(request, ctx);
    return genericCall(request, ctx);
  };
}

// ── liveness preflight (C-135): probe each provider/model once, serially, and report which answer ─────
function preflightRequest() {
  return {
    role: 'extract',
    system: 'You are a JSON echo. Reply with STRICT JSON only, no prose.',
    prompt: 'Return exactly this JSON object and nothing else: {"ok":true,"probe":"tamazia-real-llm-preflight"}',
    max_tokens: 60, temperature: 0, deadline_ms: 12000, scan_id: 'preflight',
  };
}
// preflight(ctx): call each provider directly (one attempt each, serial, paced) and report liveness.
// Uses the same doFetch transport but bypasses route() so a dead model is attributed to its exact id
// (C-135), not hidden behind a fall-over. Returns [{provider, model, ok, ms, error}].
async function preflight(ctx) {
  const out = [];
  const { withDeadline } = require('../../../llm/router.js');
  for (const p of ctx.providers) {
    await ctx.pacer.wait();
    const t0 = Date.now();
    const controller = new AbortController();
    const raced = await withDeadline(
      Promise.resolve().then(() => p.call(preflightRequest(), { signal: controller.signal })),
      12000, () => controller.abort());
    const ms = Date.now() - t0;
    const row = buildPreflightRow(p, raced, ms);
    appendRawLog(ctx.recordDir, { at: new Date().toISOString(), kind: 'preflight', provider: p.family, model: p.model, ok: row.ok, ms, error: row.error, raw: row.raw });
    out.push(row);
    if (typeof ctx.log === 'function') ctx.log({ event: 'preflight', provider: p.family, model: p.model, ok: row.ok, ms, error: row.error });
  }
  return out;
}
// buildPreflightRow(provider, raced, ms): reduce a withDeadline result to a liveness row. No throw: a
// timeout, a rejection and a non-2xx are all first-class reported outcomes (C-135/U1-B4).
function buildPreflightRow(p, raced, ms) {
  if (raced.timedOut) return { provider: p.family, model: p.model, ok: false, ms, error: 'timeout', raw: null };
  if (raced.error !== undefined) return { provider: p.family, model: p.model, ok: false, ms, error: String(raced.error).slice(0, 120), raw: null };
  const v = raced.value;
  if (v && v.ok) return { provider: p.family, model: p.model, ok: true, ms, error: null, raw: String(v.text || '').slice(0, 200) };
  return { provider: p.family, model: p.model, ok: false, ms, error: (v && v.error) || 'no_text', raw: null };
}

// ── the factory ──────────────────────────────────────────────────────────────────────────────────────
/**
 * createRealLlmCall(opts) -> { llmCall, providers, families, preflight, recordDir, recordedDir }
 *
 * THROWS unless opts.env.RUN_REAL_LLM === '1' AND at least one provider's keys are present (fail-closed).
 * opts.env         the env to read (default process.env); tests supply a controlled env + fake providers.
 * opts.providers   injected router providers (tests: fake transport; production: built from env keys).
 * opts.fetchImpl   injected transport for buildProvidersFromEnv (tests only).
 * opts.deadlineMs  the per-call deadline CAP (default 20000; clamped to MAX_DEADLINE_MS).
 * opts.spacingMs   the quota-courtesy gap between calls (default 400; clamped to MAX_SPACING_MS).
 * opts.recordDir   the gitignored raw-log dir (default eval/e2e/record/).
 * opts.recordedDir the committed recordings dir (default eval/e2e/fixtures/recorded/).
 * opts.log         optional observability sink.
 */
function createRealLlmCall(opts = {}) {
  const env = opts.env || process.env;
  // The RUN_REAL_LLM=1 hard gate always applies (fail-closed opt-in). The "keys present" half of the
  // gate is satisfied by EITHER real env keys (production) OR explicitly injected providers (tests supply
  // a fake transport). A flag-on run with neither is refused - it could make no call.
  if (env.RUN_REAL_LLM !== '1') {
    throw new Error('real-llm: refusing to construct a real LLM caller (RUN_REAL_LLM is not "1"). The eval harness default is the offline scripted-llm.js; set RUN_REAL_LLM=1 only for the local proof run.');
  }
  const providers = opts.providers || buildProvidersFromEnv(env, { families: opts.families, fetchImpl: opts.fetchImpl });
  if (!providers.length) {
    throw new Error('real-llm: RUN_REAL_LLM=1 but no providers could be constructed (need GROQ_API_KEY, GEMINI_API_KEY, CLOUDFLARE_API_TOKEN+CLOUDFLARE_ACCOUNT_ID, or NIM_API_KEY in env, or inject opts.providers). Refusing to construct (fail-closed).');
  }
  const spacingMs = clampSpacing(opts.spacingMs);
  const ctx = {
    providers,
    pacer: createPacer(spacingMs),
    deadlineMs: clampDeadline(opts.deadlineMs),
    recordDir: opts.recordDir || RECORD_DIRNAME,
    recordedDir: opts.recordedDir || RECORDED_DIRNAME,
    log: typeof opts.log === 'function' ? opts.log : null,
  };
  return {
    llmCall: makeLlmCall(ctx),
    providers: providers.map((p) => ({ name: p.name, family: p.family, model: p.model })),
    families: [...new Set(providers.map((p) => p.family))],
    preflight: () => preflight(ctx),
    recordDir: ctx.recordDir,
    recordedDir: ctx.recordedDir,
  };
}
function clampDeadline(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DEADLINE_MS) : DEFAULT_DEADLINE_MS;
}
function clampSpacing(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_SPACING_MS) : DEFAULT_SPACING_MS;
}

if (require.main === module) {
  process.stderr.write('eval/e2e/lib/real-llm.js is a library (createRealLlmCall). It makes network calls ONLY when RUN_REAL_LLM=1 and provider keys are present, and only via run-real-proof.js.\n');
  process.exit(2);
}

module.exports = {
  createRealLlmCall,
  buildProvidersFromEnv,
  envKeysPresent,
  assertRunGate,
  isEntailmentRequest,
  isAdjudicationRequest,
  rubricValidator,
  entailmentValidator,
  artifactFingerprint,
  recordingKey,
  buildRecordingFile,
  validateRecordingFile,
  writeRecordingFile,
  containsSecretShape,
  stableStringify,
  preflightRequest,
  PROVIDER_MODELS,
  CONTRACT,
  SECRET_SHAPES,
  DEFAULT_DEADLINE_MS,
  MAX_DEADLINE_MS,
  DEFAULT_SPACING_MS,
  RECORD_DIRNAME,
  RECORDED_DIRNAME,
  // internal helpers exported for the node:test suite (never fact producers):
  openAiBody,
  geminiBody,
  cloudflareBody,
  textFromOpenAi,
  textFromGemini,
  textFromCloudflare,
  parseModelJson,
  deadlineFor,
  clampDeadline,
  clampSpacing,
};
