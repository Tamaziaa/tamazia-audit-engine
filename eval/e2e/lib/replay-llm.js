'use strict';
// eval/e2e/lib/replay-llm.js - the REPLAY-side implementation of the frozen recorded-response
// contract (docs/P3-TAIL-ACCEPTANCE.md "The frozen recorded-response contract"; caution.md C-236,
// C-211). Built from the contract AS WRITTEN in that spec, not from eval/e2e/lib/real-llm.js or
// eval/e2e/fixtures/recorded/** (U1's not-yet-final files, C-211): this module never requires them.
//
// THE CONTRACT (recap, docs/P3-TAIL-ACCEPTANCE.md):
//   eval/e2e/fixtures/recorded/<domain>.json, shape:
//     { contract: "recorded-llm.v1", engine: {...}, responses: [ { key, kind, raw, meta } ] }
//   key = sha256(kind + '|' + rule_id + '|' + artifact_fingerprint). A missing key resolves to a
//   DECLINE (fail-closed, Constitution Rule 4). `kind` covers every llmCall the adjudication path
//   makes: 'adjudicate' (breach/adjudicator/adjudicate.js's per-batch verdict call) and 'entailment'
//   (Rule 12 gate 3's NLI call, llm/entailment.js).
//
// WHERE rule_id AND artifact_fingerprint ACTUALLY COME FROM (read live, not assumed - C-211):
//   Neither llmCall(request) shape breach/adjudicator/adjudicate.js builds carries a literal
//   `rule_id`/`artifact_fingerprint` field - a candidate's real identifier
//   (breach/proposers/propose.js's `record_id`) and its artifact are never placed on the request the
//   model/replay sees (deliberately: the model should judge evidence, not read internal ids). This
//   module reconstructs the closest real equivalents from what IS actually on each request:
//
//   - 'adjudicate' requests are BATCHED (breach/adjudicator/adjudicate.js's BATCH=10): one request's
//     `prompt` string embeds `JSON.stringify(briefs)` between the literal markers 'CANDIDATES:\n' and
//     '\n\nReturn STRICT JSON only:' (adjudicate.js's buildPrompt(), read verbatim from source). Each
//     brief (adjudicate.js's briefOf()) carries { id, obligation, law, kind, evidence, page } - `law` is
//     the closest exposed proxy for a rule identifier (briefOf reads f.statutory_citation, else
//     f.framework), and `evidence` + `page` are the exposed artifact content (the verbatim quote or
//     absence-claim text, and the checked page URL). rule_id here is realised as `law`; the artifact
//     fingerprint is a hash of `evidence + '|' + page`. This module therefore parses the embedded
//     briefs out of the prompt per request and computes ONE key per candidate brief, not one key per
//     call - a batch of N candidates needs N recordings.
//
//   - 'entailment' requests are always SINGLE-claim (llm/entailment.js's checkEntailment is always
//     invoked with a one-element array from breach/adjudicator/adjudicate.js's gateEntailment) and DO
//     carry clean structured per-claim fields: `allowedSourceIds` (a one-element array) and `sources`
//     (an object keyed by that id, holding the verbatim premise text) - see llm/entailment.js
//     callModel(). rule_id is realised as the source id; the artifact fingerprint is a hash of the
//     premise text.
//
// A DOCUMENTED GAP THIS FILE'S DESIGN SURFACES (routed to Rob, C-214 - not fixed here, propose.js and
// breach/adjudicator/adjudicate.js are engine modules outside this unit's ownership): breach/
// proposers/propose.js's real candidate() builder emits only
// { record_id, duty_idx, evidence_type, kind, artifact, page_url, confidence_hint, suppressed_reason }.
// adjudicate.js's briefOf()/evidenceText()/ctxFromBundle() read description/statutory_citation/
// framework/evidence_quote/checked_urls/evidence_url/absence_evidence - none of which propose.js (or
// breach/verifiers/, which passes the candidate through UNMODIFIED) ever sets. On a REAL candidate
// today every brief therefore comes out near-identical and near-empty (empty `law`, empty `page`, and
// the fixed absence-claim placeholder text for `evidence`), which (a) is a plausible root cause of
// "0 of 5 known_breaches reproduce end-to-end" (the model is handed no real evidence to adjudicate)
// and (b) means this file's per-candidate replay key cannot yet distinguish between different REAL
// candidates. This file's own hermetic test therefore hand-builds candidates that ALSO carry the
// fields briefOf() reads (simulating the hydration step this gap implies is missing), exactly as
// C-211 prescribes: it does not require() propose.js/adjudicate.js's real candidate wiring, it locks
// the REAL, observed brief/request SHAPE those modules already emit.
//
// INTEGRATION RISK (for Rob/U1, not resolved here): a replay recording only ever hits if U1's
// real-llm.js records under the SAME key derivation this file implements. That reconciliation is
// explicitly Rob's job at integration (docs/P3-TAIL-ACCEPTANCE.md's Integration note); this file's
// derivation is documented above precisely so it can be checked against whatever U1 lands with.
//
// FAIL-CLOSED SEMANTICS (Rule 4): a candidate brief with no matching recording gets no verdict entry
// in the synthesised response, so breach/adjudicator/adjudicate.js's own filter-only `applyVerdicts`
// abstains JUST that candidate to needs_review - never the rest of the batch, and never a fabricated
// pass. An unparseable prompt (no 'CANDIDATES:' block found at all - e.g. a future prompt-framing
// change, see the sanitisation-door risk note below) or zero candidates resolving to ANY recording
// declines the WHOLE call (the scripted-llm.js default-decline shape), which is at least as safe as
// today's scripted default. Nothing here ever guesses a verdict.
//
// A NOTE ON llm/prompts/adjudicate.js AND llm/prompts/entailment.js (seen dirty on this shared tree
// while this file was written, C-210): those are U3's in-flight sanitisation-door files, not the code
// path breach/adjudicator/adjudicate.js actually calls today (its own buildPrompt()/briefOf() are
// inline in that file, importing neither). If a future change wires U3's sanitiser INTO
// breach/adjudicator/adjudicate.js's own prompt framing, the literal 'CANDIDATES:\n' / '\n\nReturn
// STRICT JSON only:' markers this file parses could move - Rob's own integration note anticipates
// exactly this ("re-records U1 if U3's sanitisation changed any prompt surface"). This file's own
// test locks today's real, observed framing so any such drift fails loudly here rather than silently.

const fs = require('fs');
const crypto = require('crypto');
const { isEntailmentRequest } = require('./scripted-llm.js');
const { assertSafeDirEntry, safeJoinEntry } = require('../../../tools/lib/safe-path.js');

const CONTRACT = 'recorded-llm.v1';

// ---------------------------------------------------------------------------------------------------
// Hashing (Node's built-in crypto only - Constitution: zero runtime npm dependencies).
// ---------------------------------------------------------------------------------------------------

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex');
}

// fingerprintOf(text) -> a bounded, stable content fingerprint (sha256 hex) for one artifact's
// textual identity. Exported so a recorder (or this file's own tests) can compute the identical
// fingerprint from the same source text without re-deriving the hash choice (Rule 1: one door).
function fingerprintOf(text) {
  return sha256Hex(text);
}

// computeKey(kind, ruleId, artifactFingerprint) -> the frozen contract's key, EXACTLY as documented:
// sha256(kind + '|' + rule_id + '|' + artifact_fingerprint), lower-case hex.
function computeKey(kind, ruleId, artifactFingerprint) {
  return sha256Hex(String(kind || '') + '|' + String(ruleId || '') + '|' + String(artifactFingerprint || ''));
}

// ---------------------------------------------------------------------------------------------------
// Deriving (rule_id, artifact_fingerprint) from what an 'adjudicate'-kind request actually exposes.
// ---------------------------------------------------------------------------------------------------

// The exact literal framing breach/adjudicator/adjudicate.js's buildPrompt() emits around the
// embedded candidate briefs (read verbatim from that file's source; see this file's header). Locked
// by this module's own hermetic test, which drives the real adjudicate.js end to end.
const CANDIDATES_START = 'CANDIDATES:\n';
const CANDIDATES_END = '\n\nReturn STRICT JSON only:';

// briefsFromAdjudicatePrompt(prompt) -> the candidate brief[] embedded in an adjudicate-kind
// request's prompt string, or [] when the markers are absent or the slice does not parse as an
// array (fail closed: an unparseable prompt yields no briefs, which the caller declines rather than
// guesses at).
function briefsFromAdjudicatePrompt(prompt) {
  const text = String(prompt == null ? '' : prompt);
  const start = text.indexOf(CANDIDATES_START);
  if (start === -1) return [];
  const from = start + CANDIDATES_START.length;
  const end = text.indexOf(CANDIDATES_END, from);
  if (end === -1) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(from, end));
  } catch (_e) {
    return []; // FAIL-CLOSED: an unparseable embedded block yields no briefs, never a guess.
  }
  return Array.isArray(parsed) ? parsed : [];
}

// adjudicateBriefKey(brief) -> the frozen-contract key for ONE candidate brief (kind='adjudicate').
// rule_id is realised as the brief's `law` field (adjudicate.js briefLaw(): statutory_citation, else
// framework, truncated to 90 chars) - the closest identifier the adjudication path exposes across the
// llmCall seam (see this file's header: record_id itself never reaches the request). The artifact
// fingerprint is realised from `evidence` + `page` (the verbatim-quote/absence-claim text and the
// checked page URL), hashed for a bounded, stable fingerprint.
function adjudicateBriefKey(brief) {
  const b = brief || {};
  const ruleId = String(b.law == null ? '' : b.law);
  const artifactFingerprint = fingerprintOf(String(b.evidence == null ? '' : b.evidence) + '|' + String(b.page == null ? '' : b.page));
  return computeKey('adjudicate', ruleId, artifactFingerprint);
}

// entailmentRequestKey(request) -> the frozen-contract key for a gate-3 NLI request (kind='entailment').
// An entailment call is always ONE claim (see this file's header), and its request carries clean,
// structured per-claim fields: allowedSourceIds[0] (the premise's source id) and sources[thatId] (the
// verbatim premise text) - llm/entailment.js callModel(). rule_id is realised as the source id; the
// artifact fingerprint is the hashed premise text.
function entailmentRequestKey(request) {
  const ids = Array.isArray(request && request.allowedSourceIds) ? request.allowedSourceIds : [];
  const sourceId = ids.length ? String(ids[0]) : '';
  const sources = (request && request.sources) || {};
  const premise = typeof sources[sourceId] === 'string' ? sources[sourceId] : '';
  return computeKey('entailment', sourceId, fingerprintOf(premise));
}

// ---------------------------------------------------------------------------------------------------
// Loading committed recordings (eval/e2e/fixtures/recorded/<domain>.json per the frozen contract).
// ---------------------------------------------------------------------------------------------------

// loadRecordingsDir(dir) -> Map<key, {raw, kind, meta, file}>. An absent directory is tolerated (an
// empty Map: every request then declines - useful for --llm replay:<not-yet-populated-dir>, which
// then honestly fails the vacuity clause rather than crashing, Rule 4). A recording file that EXISTS
// but is not valid contract JSON, or declares the wrong contract version, or carries a keyless
// response entry, throws loudly - a broken recording is a defect, never silently ignored (caution.md
// C-037).
function loadRecordingsDir(dir) {
  const map = new Map();
  if (!dir || !fs.existsSync(dir)) return map;
  const entries = fs.readdirSync(dir).filter((f) => assertSafeDirEntry(f, { label: 'replay-llm.js recordings dir entry' }) && f.endsWith('.json'));
  for (const entry of entries) {
    const abs = safeJoinEntry(dir, entry, { label: 'replay-llm.js recording file' });
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw new Error('replay-llm.js: unreadable recording file ' + abs + ': ' + e.message);
    }
    if (parsed.contract !== CONTRACT) {
      throw new Error('replay-llm.js: ' + abs + ' does not declare contract ' + JSON.stringify(CONTRACT) + ' (got ' + JSON.stringify(parsed.contract) + ')');
    }
    const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
    for (const r of responses) {
      if (!r || typeof r.key !== 'string' || !r.key) {
        throw new Error('replay-llm.js: ' + abs + ' carries a response entry with no string key');
      }
      map.set(r.key, { raw: r.raw, kind: r.kind || null, meta: r.meta || null, file: abs });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------
// Answering one llmCall(request) from the loaded recordings.
// ---------------------------------------------------------------------------------------------------

// DECLINE: the shared fail-closed response. Matches scripted-llm.js's defaultScriptedLlmCall shape
// exactly (an {ok:false} both breach/adjudicator/adjudicate.js's verdictsFrom() and llm/gate.js's
// validateResponse() already treat as a clean, typed refusal) so replay mode degrades EXACTLY like
// the scripted default when nothing is recorded, never a new failure shape.
const DECLINE = Object.freeze({
  ok: false,
  reason: 'eval/e2e replay-llm.js: no recorded response for this key -> decline (fail-closed, Rule 4)',
});

// parseRecordedRaw(raw) -> the parsed JSON value of a recording's raw string, or null on a parse
// failure (never throws at call time: a corrupt raw is treated as a missing recording, fail-closed).
// A pre-parsed object (a hand-built test fixture that skipped the string round-trip) is tolerated too.
function parseRecordedRaw(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

// answerEntailment(recordings, request) -> the resolved llmCall return value for a gate-3 request.
function answerEntailment(recordings, request) {
  const key = entailmentRequestKey(request);
  const rec = recordings.get(key);
  if (!rec) return DECLINE;
  const parsed = parseRecordedRaw(rec.raw);
  if (parsed == null) return DECLINE;
  return parsed; // llm/gate.js's validateResponse() accepts a pre-parsed object directly.
}

// verdictFromParsedRaw(parsed, brief) -> one {id,verdict,reason,disproof}-shaped verdict, with `id`
// REMAPPED to this candidate's CURRENT batch position (the id a recording was made under may differ
// from where its candidate lands in a later, differently-batched run - ids are per-batch positional,
// never a stable identifier). Tolerates a recording that stored a whole {verdicts:[...]} response for
// this one candidate (takes the first entry) as well as the primary documented shape (a single verdict
// object) - defence in depth against the cross-unit key-granularity risk noted in this file's header.
function verdictFromParsedRaw(parsed, brief) {
  if (parsed && Array.isArray(parsed.verdicts)) {
    return Object.assign({}, parsed.verdicts[0] || {}, { id: brief.id });
  }
  return Object.assign({}, parsed || {}, { id: brief.id });
}

// answerAdjudicate(recordings, request) -> the resolved llmCall return value for an adjudicate-kind
// (possibly batched) request. Each candidate brief is looked up INDEPENDENTLY: a brief with no
// recording simply gets no verdict entry, so breach/adjudicator/adjudicate.js's own filter-only
// applyVerdicts() abstains JUST that candidate to needs_review (Rule 12 gate 4) - a batch is a
// call-shape convenience, not a unit of trust, so one missing recording never discards a batch-mate's
// genuine recorded verdict. An unparseable prompt (no candidates identifiable at all) or a batch where
// NOTHING resolves declines the whole call, matching the scripted default.
function answerAdjudicate(recordings, request) {
  const briefs = briefsFromAdjudicatePrompt(request && request.prompt);
  if (!briefs.length) return DECLINE;
  const verdicts = [];
  for (const brief of briefs) {
    const key = adjudicateBriefKey(brief);
    const rec = recordings.get(key);
    if (!rec) continue; // no recording for this candidate -> no verdict entry -> it abstains alone.
    const parsed = parseRecordedRaw(rec.raw);
    if (parsed == null) continue;
    verdicts.push(verdictFromParsedRaw(parsed, brief));
  }
  if (!verdicts.length) return DECLINE;
  return { ok: true, out: { verdicts } };
}

// ---------------------------------------------------------------------------------------------------
// The public factory.
// ---------------------------------------------------------------------------------------------------

/**
 * replayLlmCall(dir) -> an llmCall(request) function that answers ONLY from committed recordings
 * under `dir` (the frozen recorded-response contract; see this file's header). Recordings are loaded
 * ONCE per factory call (eval/e2e/run-pipeline.js builds one replay llmCall per invocation). A request
 * whose derived key(s) have no matching recording DECLINES / abstains exactly as scripted-llm.js's own
 * default does (Rule 12 gate 4: the adjudicator abstains to needs_review, never a fabricated pass).
 *
 * Covers ONLY the breach-lane adjudication (kind='adjudicate') and entailment (kind='entailment')
 * llmCall seams - the two kinds breach/adjudicator/adjudicate.js actually calls. Red-team handlers
 * (eval/e2e/lib/redteam-handlers.js, U3-owned) inject their own calls and never see this function.
 */
function replayLlmCall(dir) {
  const recordings = loadRecordingsDir(dir);
  return function replay(request) {
    const response = isEntailmentRequest(request) ? answerEntailment(recordings, request) : answerAdjudicate(recordings, request);
    return Promise.resolve(response);
  };
}

module.exports = {
  replayLlmCall,
  computeKey,
  fingerprintOf,
  adjudicateBriefKey,
  entailmentRequestKey,
  briefsFromAdjudicatePrompt,
  loadRecordingsDir,
  CONTRACT,
  DECLINE,
  // exported for tests only (not part of the public replay contract surface):
  parseRecordedRaw,
  verdictFromParsedRaw,
};
