'use strict';
// eval/e2e/lib/replay-llm.js - the REPLAY-side implementation of the frozen recorded-response
// contract (docs/P3-TAIL-ACCEPTANCE.md "The frozen recorded-response contract"; caution.md C-236,
// C-211, C-222, C-223).
//
// THE CONTRACT (recap, docs/P3-TAIL-ACCEPTANCE.md):
//   eval/e2e/fixtures/recorded/<domain>.json, shape:
//     { contract: "recorded-llm.v1", engine: {...}, responses: [ { key, kind, raw, meta } ] }
//   key = sha256(kind + '|' + rule_id + '|' + artifact_fingerprint). A missing key resolves to a
//   DECLINE (fail-closed, Constitution Rule 4). `kind` covers every llmCall the adjudication path
//   makes: 'adjudicate' (breach/adjudicator/adjudicate.js's per-batch verdict call) and 'entailment'
//   (Rule 12 gate 3's NLI call, llm/entailment.js).
//
// P3-TAIL WAVE-2 REVISION (C-211/C-222 closure - read this before the rest of the file):
// This file's FIRST version derived the adjudicate-kind key from a law+hash(evidence+page) guess
// parsed out of the model-facing CANDIDATES JSON text embedded in the prompt. That guess was
// INDEPENDENT of what the recorder (eval/e2e/lib/real-llm.js, driven by eval/e2e/run-real-proof.js)
// actually computes: run-real-proof.js's entailmentEntryFor/adjudicateEntriesFor key EVERY recording as
//   realLlm.recordingKey(kind, candidate.record_id, realLlm.artifactFingerprint(candidate.artifact))
// - i.e. the candidate's own catalogue rule id (record_id) and its own deterministic Rule-3 artifact
// OBJECT (not a text string reconstructed from what the prompt happened to show a model). The recorder
// never derives its key from a prompt string at all: it already holds the full candidate in memory.
// The two guesses could never agree, which is exactly the class of bug C-211 exists to catch ("a
// verifier built to an assumed sibling shape rejected 100% of real output").
//
// THE FIX: eval/e2e/lib/record-key.js is now the ONE shared derivation (stableStringify,
// artifactFingerprint, recordingKey); this file and real-llm.js both import it and carry no local
// hashing re-implementation (C-216). For the 'adjudicate' kind, this file reads `record_id` and
// `artifact` off `request.candidates` - a small, OUT-OF-BAND array
// (`[{id, record_id, artifact}, ...]`) breach/adjudicator/adjudicate.js's callGate() now attaches
// directly onto the llmCall request ALONGSIDE (never inside) the model-facing prompt text (its
// candidateRefsFor() helper, added in the SAME change as this file per the C-223 hard pairing below).
// This is deliberately NOT embedded in the model-visible CANDIDATES JSON: doing so would either (a)
// duplicate the candidate's raw, unsanitised artifact text a second time next to the newly
// door-routed `evidence` field (undermining the sanitisation this same change adds - see the C-134
// note below), or (b) require this eval-only module's hashing code to be imported by an ENGINE module
// (breach/adjudicator/adjudicate.js), inverting the eval-depends-on-engine layering for no reason: the
// real llmCall transport (eval/e2e/lib/real-llm.js's provider body-builders) never reads any field
// except `system`/`prompt`, so attaching `candidates` changes nothing a live model ever sees.
//
// HARD PAIRING (C-223): this same change routes breach/adjudicator/adjudicate.js's untrusted brief
// fields (the evidence quote, the page URL) through llm/prompts/sanitise.js's docDelimit/sanitiseSpan
// (C-134 completion - see that file's own header). That sanitisation changes the CONTENT of the
// `evidence`/`page` string fields inside the model-facing CANDIDATES JSON (a legitimate span passes
// through byte-identical per sanitise.js's own proof; only a delimiter-breakout attempt changes at
// all), which is exactly the kind of prompt-framing move this file's OWN key derivation used to depend
// on. Because the key derivation now lives entirely on `request.candidates` (never on
// `evidence`/`page`), that content change has NO EFFECT on key derivation - the coupling this file's
// FIRST version had to the CANDIDATES text framing is retired by this same change, which is why both
// land together rather than as two separate PRs (never finalise a consumer against an assumed sibling
// shape that could move again independently, C-211/C-223).
//
// briefsFromAdjudicatePrompt() (below) is RETAINED, exported and still fully tested: it is a correct,
// standalone description of the CANDIDATES text framing breach/adjudicator/adjudicate.js's buildPrompt()
// still emits (useful for debugging/inspection of a captured prompt), but it is no longer this file's
// key-derivation path - see answerAdjudicate() below.
//
// ENTAILMENT KEY - NOW UNIFIED WITH THE ADJUDICATE BASIS (P3-tail Wave-2 resume, C-211/C-222 gap
// CLOSED; this block previously recorded the gap as open). The recorder (eval/e2e/run-real-proof.js's
// entailmentEntryFor) has always keyed an entailment recording by
// recordingKey('entailment', cand.record_id, artifactFingerprint(cand.artifact)) - the record_id +
// artifact-object basis, NOT the premise text. This file's FIRST version keyed the replay side by
// allowedSourceIds[0] + the premise TEXT instead (the only fields an entailment request then exposed),
// so a real recorder-side entailment recording could never match. The gap is now closed at the source:
// breach/adjudicator/adjudicate.js's claimFor() attaches candidate = { record_id, artifact } to the
// entailment claim, llm/entailment.js's callModel() passes it straight onto the llmCall request as
// request.candidate WITHOUT it ever entering the prompt text (the prompt is built from
// {hypothesis, premise, sourceId} only, and the real transport reads only system/prompt/schema/sources
// - so no live model ever sees it). This file's entailmentRequestKey() now reads request.candidate and
// derives the key on the SAME (record_id, artifact) basis as adjudicate, via the SAME shared helper
// (candidateKey below), differing only by kind. One basis, both kinds, both sides. The old
// allowedSourceIds+premise-text basis is REMOVED (not kept as a fallback): U1's committed recordings
// carry zero entailment entries (all responses:[] today), so nothing validated against the old basis,
// and the recorder never used it - keeping it would be two competing bases for no consumer.

const fs = require('fs');
const { assertSafeDirEntry, safeJoinEntry } = require('../../../tools/lib/safe-path.js');
const { CONTRACT, artifactFingerprint, recordingKey } = require('./record-key.js');
const { isEntailmentRequest } = require('./scripted-llm.js');

// ---------------------------------------------------------------------------------------------------
// Hashing: delegates entirely to eval/e2e/lib/record-key.js (Constitution: zero runtime npm
// dependencies; C-216: no local re-implementation of the shared hash formula).
// ---------------------------------------------------------------------------------------------------

// computeKey(kind, ruleId, artifactFingerprint) -> the frozen contract's key, delegating to
// record-key.js's recordingKey (kept under this file's original exported name for backward
// compatibility with existing callers of this module's public API).
function computeKey(kind, ruleId, fp) {
  return recordingKey(kind, ruleId, fp);
}

// ---------------------------------------------------------------------------------------------------
// Candidate-ref key: record_id + the candidate's own deterministic artifact object, EXACTLY as the
// recorder computes it (see this file's header). This is the ONE derivation both breach-lane kinds use
// (adjudicate and entailment), differing only by `kind` - the C-211/C-222 unification.
// ---------------------------------------------------------------------------------------------------

// candidateKey(kind, ref) -> recordingKey(kind, ref.record_id, artifactFingerprint(ref.artifact)). The
// single shared derivation for BOTH breach-lane kinds. `ref` is any object carrying record_id/artifact
// (a candidate ref, or a hand-built candidate directly, since record_id/artifact are exactly the fields
// breach/proposers/propose.js's candidate() emits and breach/adjudicator/adjudicate.js preserves
// untouched onto every finding). Tolerates a missing/undefined ref without throwing (an absent
// record_id/artifact still yields a real, if unlikely-to-match, key rather than blowing up the caller -
// fail-closed via a lookup miss, never a crash).
function candidateKey(kind, ref) {
  const r = ref || {};
  return computeKey(kind, String(r.record_id == null ? '' : r.record_id), artifactFingerprint(r.artifact));
}

// adjudicateBriefKey(ref) -> the frozen-contract key for ONE adjudicate-kind candidate ref
// ({id, record_id, artifact}). Read from request.candidates (the out-of-band ref array
// breach/adjudicator/prompt.js candidateRefsFor() attaches to the adjudicate request), never from
// prompt text.
function adjudicateBriefKey(ref) {
  return candidateKey('adjudicate', ref);
}

// entailmentCandidateKey(ref) -> the frozen-contract key for ONE entailment-kind candidate ref
// ({record_id, artifact}). The mirror of adjudicateBriefKey on the SAME basis, differing only by kind.
function entailmentCandidateKey(ref) {
  return candidateKey('entailment', ref);
}

// candidateRefsFromRequest(request) -> the request.candidates[] array (breach/adjudicator/prompt.js
// candidateRefsFor() output), or [] when absent/malformed. Fail-closed: no refs means nothing can be
// keyed, so the caller declines the whole call rather than guessing.
function candidateRefsFromRequest(request) {
  return Array.isArray(request && request.candidates) ? request.candidates : [];
}

// ---------------------------------------------------------------------------------------------------
// briefsFromAdjudicatePrompt: parsing the embedded CANDIDATES: block breach/adjudicator/adjudicate.js's
// buildPrompt() frames (read verbatim from that file's source). RETAINED as a correct, independently
// useful, fully-tested description of the prompt's own text framing (e.g. for inspecting a captured
// prompt during debugging) but NO LONGER this file's key-derivation path - see this file's header.
// ---------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------
// ENTAILMENT-kind key: record_id + artifact from request.candidate - the SAME basis as adjudicate, the
// SAME basis the recorder uses (see this file's header). NOT the premise text (the closed C-211/C-222
// gap).
// ---------------------------------------------------------------------------------------------------

// entailmentRequestKey(request) -> the frozen-contract key for a gate-3 NLI request (kind='entailment').
// An entailment call is always ONE claim (llm/entailment.js's checkEntailment is always invoked with a
// one-element array from breach/adjudicator/adjudicate.js's gateEntailment), and its request now carries
// the owning candidate's identity out-of-band as request.candidate = { record_id, artifact }
// (breach/adjudicator/adjudicate.js's claimFor -> llm/entailment.js's callModel; never in the prompt).
// The key is candidateKey('entailment', request.candidate) - identical to the recorder's
// recordingKey('entailment', cand.record_id, artifactFingerprint(cand.artifact)). A request with no
// candidate (a caller that did not attach one - not the live breach path, which always does) derives
// from an empty ref and thus fail-closed declines at lookup, never throws.
function entailmentRequestKey(request) {
  return entailmentCandidateKey(request && request.candidate);
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

// verdictFromParsedRaw(parsed, ref) -> one {id,verdict,reason,disproof}-shaped verdict, with `id`
// REMAPPED to this candidate's CURRENT batch position (the id a recording was made under may differ
// from where its candidate lands in a later, differently-batched run - ids are per-batch positional,
// never a stable identifier). Tolerates a recording that stored a whole {verdicts:[...]} response for
// this one candidate (takes the first entry) as well as the primary documented shape (a single verdict
// object) - defence in depth against the cross-unit key-granularity risk noted in this file's header.
function verdictFromParsedRaw(parsed, ref) {
  if (parsed && Array.isArray(parsed.verdicts)) {
    return Object.assign({}, parsed.verdicts[0] || {}, { id: ref.id });
  }
  return Object.assign({}, parsed || {}, { id: ref.id });
}

// answerAdjudicate(recordings, request) -> the resolved llmCall return value for an adjudicate-kind
// (possibly batched) request. Each candidate ref (request.candidates[], attached by
// breach/adjudicator/adjudicate.js's callGate - see this file's header) is looked up INDEPENDENTLY: a
// ref with no recording simply gets no verdict entry, so breach/adjudicator/adjudicate.js's own
// filter-only applyVerdicts() abstains JUST that candidate to needs_review (Rule 12 gate 4) - a batch
// is a call-shape convenience, not a unit of trust, so one missing recording never discards a
// batch-mate's genuine recorded verdict. No candidate refs at all (an older caller, or a malformed
// request) declines the whole call, matching the scripted default (fail-closed, Rule 4).
function answerAdjudicate(recordings, request) {
  const refs = candidateRefsFromRequest(request);
  if (!refs.length) return DECLINE;
  const verdicts = [];
  for (const ref of refs) {
    const key = adjudicateBriefKey(ref);
    const rec = recordings.get(key);
    if (!rec) continue; // no recording for this candidate -> no verdict entry -> it abstains alone.
    const parsed = parseRecordedRaw(rec.raw);
    if (parsed == null) continue;
    verdicts.push(verdictFromParsedRaw(parsed, ref));
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
  candidateKey,
  adjudicateBriefKey,
  entailmentCandidateKey,
  entailmentRequestKey,
  candidateRefsFromRequest,
  briefsFromAdjudicatePrompt,
  loadRecordingsDir,
  CONTRACT,
  DECLINE,
  // exported for tests only (not part of the public replay contract surface):
  parseRecordedRaw,
  verdictFromParsedRaw,
};
