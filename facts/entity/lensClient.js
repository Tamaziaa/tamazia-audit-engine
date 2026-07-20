'use strict';
// facts/entity/lensClient.js — provider-agnostic LLM client for the entity-resolution lane (Kimi
// KIMI-FINAL-BATCH-2026-07-20.md §2, E1). PRIMARY = Gemini Flash (native structured-output JSON mode
// gives the strongest schema-locked guarantee); FALLBACK = mistralai/ministral-8b via OpenRouter with
// response_format json_object. REUSES the engine's existing provider chain and router
// (llm/providers/chain.js buildChain / llm/router.js route) rather than opening a THIRD HTTP client
// for an LLM in this repo (Rule 1, one door) — this module supplies only the entity-lane PROMPT, the
// gemini-family-first ordering, the 2-call/run cap, and transcript capture/hashing on top of that
// shared transport.
//
// Rule 16 (public repo, no secret ever committed/logged): every credential is read fresh inside the
// shared chain's provider .call closures at call time, exactly as chain.js already guarantees; this
// module never touches process.env directly and never logs a header or a key.
//
// FAIL CLOSED: no configured provider, a timeout, a thrown transport error, or an exhausted 2-call
// budget all resolve to `{ ok: false }` — never a fabricated proposal. The linter (facts/entity/lint.js)
// is a second, independent backstop on top of this.

const { buildChain } = require('../../llm/providers/chain.js');
const { route } = require('../../llm/router.js');

const SYSTEM_PROMPT = [
  'You are an extraction lens inside an audit engine. You copy; you never infer.',
  '- Use ONLY the supplied page text. World knowledge is forbidden.',
  '- Every string you return must be copied VERBATIM from the supplied text.',
  '- If a value is absent, return null. Guessing is a fatal error.',
  '- Return JSON matching the schema. No commentary.',
].join('\n');

function userPrompt(windowsText) {
  return [
    'PAGE TEXT (visible text only; sources: site footer, /privacy, /terms, /about, /contact):',
    '"""',
    String(windowsText || ''),
    '"""',
    'Identify the legal entity operating this website.',
    '1. candidates[] (max 3): each distinct legal name appearing with Ltd/Limited/LLP/LP',
    '   or alongside a company number. company_number only if printed',
    '   (8 digits, or 2 letters + 6 digits). source_quote: ONE verbatim span',
    '   (<=300 chars) containing the name AND, if present, the number.',
    '2. privacy_controller: entity named as data controller, with verbatim quote, else null.',
    '3. sector_evidence: verbatim spans mentioning GDC, CQC, treatments.',
    '4. sector / sub_sector: from the enum, based ONLY on those spans; "unknown" if unsure.',
    '',
    'Respond with ONLY a JSON object of this exact shape (no markdown fences, no commentary):',
    '{"candidates":[{"legal_name":string|null,"company_number":string|null,"source_quote":string|null}],',
    '"privacy_controller":{"legal_name":string|null,"company_number":string|null,"source_quote":string|null}|null,',
    '"sector_evidence":string[],"sector":string,"sub_sector":string}',
  ].join('\n');
}

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_DEADLINE_MS = 20000;
const MAX_CALLS_PER_RUN = 2;

function sha256Hex(input) {
  // Deferred require to keep this file's top-level import list minimal and honest about what it
  // needs (crypto is a Node built-in; no third module dependency added).
  return require('crypto').createHash('sha256').update(String(input)).digest('hex');
}

// stripFences(text) -> text with a leading/trailing ```json ... ``` fence removed, when present.
// Gemini's responseMimeType:'application/json' mode does not fence; Ministral occasionally does
// despite response_format json_object, so this is defensive only.
function stripFences(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

// parseJson(text) -> object | null. Never throws.
function parseJson(text) {
  try {
    const parsed = JSON.parse(stripFences(text));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    return null; // FAIL-OPEN: an unparseable completion is a normal LLM failure mode here, not a bug;
    // the caller (extractEntity) turns a null return into ok:false/'unparseable_json', which resolve.js
    // then treats as UNRESOLVED (fail closed on the FACT, even though this parse step fails open).
  }
}

// makeLensClient(opts) -> { extractEntity(windowsText) -> Promise<LensResult> }.
//   opts.env        env to read (default process.env); passed straight through to buildChain.
//   opts.fetchImpl  injected transport (tests: a fake; production: omit -> real fetch).
//   opts.log        optional structured logger.
//
// LensResult:
//   { ok:true, proposal, provider, family, model, transcript:{system,prompt,completion},
//     transcriptHash, promptHash, completionHash, callsUsed }
//   { ok:false, reason, callsUsed }
function makeLensClient(opts = {}) {
  let callsUsed = 0;

  async function extractEntity(windowsText) {
    if (!windowsText || !String(windowsText).trim()) {
      return { ok: false, reason: 'no_windows', callsUsed };
    }
    if (callsUsed >= MAX_CALLS_PER_RUN) {
      return { ok: false, reason: 'call_budget_exhausted', callsUsed };
    }

    const chain = buildChain({ env: opts.env, fetchImpl: opts.fetchImpl, log: opts.log });
    if (!chain.providers.length) {
      return { ok: false, reason: 'no_providers', callsUsed };
    }

    const prompt = userPrompt(windowsText);
    const task = { system: SYSTEM_PROMPT, prompt, max_tokens: DEFAULT_MAX_TOKENS };

    callsUsed += 1;
    // gemini is preferred by naming it as the anchor-equivalent front-of-queue family; buildChain
    // already orders free-first with gemini present in FAMILY_ORDER ahead of the paid mistral anchor,
    // so passing no anchorFamily already yields Gemini-primary, Ministral-fallback per §2 — this
    // comment exists so a future reordering of FAMILY_ORDER does not silently invert that intent
    // without a test catching it (see lensClient.test.js).
    const result = await route(task, {
      providers: chain.providers,
      deadlineMs: DEFAULT_DEADLINE_MS,
      log: opts.log,
    });

    if (!result.ok) {
      return { ok: false, reason: 'route_failed:' + (result.reason || 'unknown'), callsUsed, attempts: result.attempts };
    }

    const proposal = parseJson(result.text);
    if (!proposal) {
      return { ok: false, reason: 'unparseable_json', callsUsed, provider: result.provider, family: result.family };
    }

    const transcript = { system: SYSTEM_PROMPT, prompt, completion: result.text };
    return {
      ok: true,
      proposal,
      provider: result.provider,
      family: result.family,
      promptHash: sha256Hex(SYSTEM_PROMPT + '\n' + prompt),
      completionHash: sha256Hex(result.text),
      transcriptHash: sha256Hex(JSON.stringify(transcript)),
      transcript,
      callsUsed,
    };
  }

  return { extractEntity, callsUsed: () => callsUsed, MAX_CALLS_PER_RUN };
}

module.exports = { makeLensClient, SYSTEM_PROMPT, userPrompt, parseJson, stripFences, MAX_CALLS_PER_RUN };
