'use strict';
// breach/adjudicator/verdict.js - THE adjudication-abstention gate (P3 Wave-2c, GAPS.md P0).
//
// THE DISEASE (caution.md C-082, C-086, C-092, and Constitution Rule 6):
//   The old adjudicator's verdict enum had a "maybe-ships" gap. An ambiguous entailment verdict
//   ("Unclear, leaning no") matched NEITHER the breach nor the clear branch, so the finding stayed
//   CONFIRMED with its fine attached. Separately, a NO_BREACH clearance was accepted on the model's
//   bare say-so, with no proof, so the model could clear a real breach simply by asserting it away.
//
// THE RULE THIS ENFORCES (Constitution Rule 6 + Rule 12 gate 4 - abstain by default):
//   parseVerdict maps the model's closed enum { breach | no_breach | insufficient } to the engine's
//   closed three-state { violation | needs_review | pass }:
//     breach        -> violation      (an adjudicated breach; this is what ships)
//     no_breach     -> pass           BUT ONLY with a verbatim disproof anchored in the supplied
//                                     evidence (C-092). Without it: needs_review, never pass.
//     insufficient  -> needs_review   (not a breach, not a clearance)
//   ANYTHING ELSE - a missing verdict, an unknown enum value, a wrong-typed field, one of our own
//   internal state names echoed back, or any shape the model was never allowed to emit - maps to
//   needs_review. There is NO branch that keeps an accusation on an unparseable answer. Abstention is
//   the default and the cheapest path; a claim is released only on an explicit, well-formed verdict.
//
// This module is PURE: a function of (raw verdict, evidence text). No I/O, no network, no LLM call.

// The model's CLOSED verdict enum. Anything outside this set is not a verdict; it is noise -> abstain.
const LLM_VERDICTS = new Set(['breach', 'no_breach', 'insufficient']);
// VERDICTS: the engine's CLOSED three-state (axe-core doctrine), the ONE canonical spelling (underscore
// token in code; CONSTITUTION prose uses hyphenated English). This is the one door for the three-state
// enum (ledger decision 5): every consumer imports it rather than re-declaring the strings, so a
// hyphen/underscore drift (llm/prompts/adjudicate.js's old 'needs-review') cannot recur. No fourth
// "maybe" value exists.
const VERDICTS = Object.freeze(['violation', 'needs_review', 'pass']);
const STATES = new Set(VERDICTS);
// The base mapping. no_breach -> pass is CONDITIONAL on a verbatim disproof (see parseVerdict).
const VERDICT_TO_STATE = { breach: 'violation', no_breach: 'pass', insufficient: 'needs_review' };

const MIN_DISPROOF_CHARS = 6;   // a sub-6-char "disproof" is a nav fragment, never proof (cf. C-089)
const DISPROOF_ANCHOR_CHARS = 40; // the leading span that must appear verbatim in the evidence

// verdictWord(raw) -> the lowercased verdict string carried by a raw verdict (a { verdict } object or
// a bare string), or null when none is present. Non-string verdict fields are null (a wrong type is
// not a verdict).
function verdictWord(raw) {
  if (typeof raw === 'string') return raw.toLowerCase().trim();
  if (raw && typeof raw.verdict === 'string') return raw.verdict.toLowerCase().trim();
  return null;
}

// normaliseVerdict(raw) -> a member of LLM_VERDICTS, or null for anything outside the closed enum
// (missing, unknown, extra-state, wrong type). The whole safety property rests on this returning null
// rather than guessing.
function normaliseVerdict(raw) {
  const v = verdictWord(raw);
  return v && LLM_VERDICTS.has(v) ? v : null;
}

// normaliseDisproof(disproof) -> the disproof lowercased, trimmed, and stripped of surrounding quotes.
// A non-string disproof normalises to '' (which fails the length gate below).
function normaliseDisproof(disproof) {
  if (typeof disproof !== 'string') return '';
  return disproof.toLowerCase().trim().replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
}

/**
 * disproofMatches(disproof, evidence) -> true when `disproof` is a real verbatim span of `evidence`.
 * The proven port rubric (C-092): normalise, require a minimum length, and require the evidence
 * haystack to contain the disproof's leading anchor span. A disproof the engine cannot find in the
 * evidence it handed the model is not a disproof.
 */
function disproofMatches(disproof, evidence) {
  const q = normaliseDisproof(disproof);
  if (q.length < MIN_DISPROOF_CHARS) return false;
  const hay = typeof evidence === 'string' ? evidence.toLowerCase() : '';
  if (!hay) return false;
  return hay.includes(q.slice(0, DISPROOF_ANCHOR_CHARS));
}

function reasonOf(raw, fallback) {
  const r = raw && typeof raw.reason === 'string' ? raw.reason.trim() : '';
  return (r || fallback || '').slice(0, 160);
}

function abstain(verdict, reason) {
  return { state: 'needs_review', verdict: verdict || null, reason, disproof: null };
}

/**
 * parseVerdict(raw, evidence) -> { state, verdict, reason, disproof }
 *   state    the closed three-state: 'violation' | 'needs_review' | 'pass'.
 *   verdict  the normalised model verdict ('breach'|'no_breach'|'insufficient') or null if unparseable.
 *   reason   a short human-readable cause (the model's own reason when present, else a fixed default).
 *   disproof the verbatim disproof span (only on a `pass`; null otherwise).
 *
 * `evidence` is the text the model was shown (see adjudicate.js `evidenceText`); it is required to
 * clear a no_breach. If evidence is omitted or empty, a no_breach can NEVER reach `pass` (it abstains
 * to needs_review) - the safe direction: you cannot clear a claim against text you were not shown
 * (the port's HARD RULE 4).
 */
function parseVerdict(raw, evidence) {
  const v = normaliseVerdict(raw);
  if (v === null) return abstain(null, 'unparseable, missing or out-of-enum verdict -> abstain (Rule 6)');
  if (v === 'breach') {
    return { state: 'violation', verdict: 'breach', reason: reasonOf(raw, 'adjudicated breach'), disproof: null };
  }
  if (v === 'insufficient') {
    return abstain('insufficient', reasonOf(raw, 'insufficient evidence to rule either way -> abstain'));
  }
  // v === 'no_breach': clears to pass ONLY with a verbatim disproof anchored in the evidence (C-092).
  const disproof = raw && raw.disproof;
  if (disproofMatches(disproof, evidence)) {
    return { state: 'pass', verdict: 'no_breach', reason: reasonOf(raw, 'false positive, disproved verbatim'), disproof: normaliseDisproof(disproof) };
  }
  return abstain('no_breach', 'no_breach with no verbatim disproof anchored in the evidence (C-092) -> abstain');
}

module.exports = {
  parseVerdict,
  normaliseVerdict,
  disproofMatches,
  normaliseDisproof,
  LLM_VERDICTS,
  VERDICTS,
  STATES,
  VERDICT_TO_STATE,
  MIN_DISPROOF_CHARS,
  DISPROOF_ANCHOR_CHARS,
};
