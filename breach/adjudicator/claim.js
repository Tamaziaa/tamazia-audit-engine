'use strict';
// breach/adjudicator/claim.js - THE one door for the Gate-3 (Constitution Rule 12 gate 3) NLI
// HYPOTHESIS: the atomic claim a candidate's premise must ENTAIL (P3-tail Wave-2 FINAL UNIT).
//
// THE DISEASE (U1's real-model finding, docs/P3-TAIL-ACCEPTANCE.md "WAVE 2 FINAL UNIT"): the adjudicator
// ruled the synthetic a `breach` correctly, but Gate 3 (llm/entailment.js) demoted it, because the
// hypothesis handed to the NLI was the raw compliance OBLIGATION (the catalogue duty text). An offending
// verbatim quote CONTRADICTS a duty (the duty says "do not advertise a POM / remove POM references"; the
// quote shows a POM IS advertised), so a faithful NLI returns `contradiction` and every presence-breach
// is demoted. The verbatim evidence being fixed:
//   adjudication verdict: {"verdict":"breach","reason":"advertising prescription only medicine"}
//   Gate-3 verdict:       {"verdict":"contradiction","rationale":"... 'wrinkle-relaxing injections' ...
//                          contradicting the hypothesis that such references should be removed ..."}
//
// THE FIX (a framing correction through ONE door, NEVER a loosening): Rule 12 gate 3 wants the ATOMIC
// CLAIM as the hypothesis, not the obligation. For a presence-breach the atomic claim is the affirmative
// breach proposition the offending quote ENTAILS ("this website advertises a POM to the public"), so the
// NLI can affirm it. `contradiction` and `neutral` still demote exactly as before; ONLY what the
// hypothesis SAYS changes, never what the gate accepts. Absence/coverage_proof keep the existing basis;
// register/observed bypass text adjudication (C-084) and never reach Gate 3.
//
// CATALOGUE-GROUNDED, DETERMINISTIC, NO INVENTED FACTS (Constitution Rule 2 + Rule 11): the atomic claim
// is built ONLY by re-framing the record's OWN catalogue duty text - stripping the leading prohibition
// operator ("Do not X" -> "This website does X") or removal verb ("remove Y" -> "... includes Y") and
// prepending a fixed page-subject frame. This file holds NO law name, fine, regulator or statute
// literal of its own (the catalogue-only-literals lint scans it); it only transforms text the caller
// read from the compiled catalogue. There is no LLM authorship: the derivation is a pure string
// function. Where a duty's phrasing supports neither deterministic transform, a documented fallback
// template embeds the duty clause verbatim and the limitation is reported honestly (never invented
// content).

// Artifact types that ARE a verbatim quote (Rule 3 ground truth for a presence-breach: a prohibited
// phrase FOUND on the page). Mirrors breach/adjudicator/evidence-kind.js's own quote family + port
// aliases so a ported/legacy candidate classifies the same way. A quote artifact is the ONLY presence
// signal; an absence-breach carries a coverage_proof, a register a register_row, an observation a
// network_event - none of those is a presence-breach.
const QUOTE_ARTIFACT_TYPES = new Set(['quote', 'corpus_quote', 'verbatim_quote']);

// isPresenceBreach(candidate) -> true when the candidate's deterministic artifact is a verbatim quote.
// The artifact is ground truth (Rule 3), exactly as evidence-kind.js trusts artifact.type; a candidate
// with no artifact, or a non-quote artifact, is not a presence-breach and keeps the existing hypothesis.
function isPresenceBreach(candidate) {
  const art = candidate && candidate.artifact;
  const t = art && typeof art.type === 'string' ? art.type.toLowerCase().trim() : '';
  return QUOTE_ARTIFACT_TYPES.has(t);
}

// dutyText(record, candidate) -> the SELECTED catalogue duty prose. Tolerant of BOTH a full compiled
// catalogue record ({ website_obligations:[{duty}] }, the shape eval/e2e/lib/pipeline.js passes, indexed
// by candidate.duty_idx) AND a finding-shaped view ({ description } already carrying the selected duty,
// the shape breach/adjudicator/adjudicate.js passes as both record and candidate). Never invents text
// (Rule 2): an absent duty yields '' and the caller degrades, never fabricates.
function dutyText(record, candidate) {
  const obs = record && Array.isArray(record.website_obligations) ? record.website_obligations : null;
  if (obs) {
    const idx = Number.isInteger(candidate && candidate.duty_idx) ? candidate.duty_idx : 0;
    const duty = obs[idx] && obs[idx].duty;
    if (typeof duty === 'string' && duty) return duty;
  }
  return record && typeof record.description === 'string' ? record.description : '';
}

// firstClause(text) -> the primary clause of a compound duty (up to the first ';'), trimmed. A
// prohibition duty's leading clause is its core "do not X"; later ';'-separated clauses (e.g. "remove
// ... references ...") restate the same prohibition in another shape, so the first clause is the
// cleanest single proposition to invert.
function firstClause(text) {
  const s = String(text == null ? '' : text);
  const semi = s.indexOf(';');
  return (semi === -1 ? s : s.slice(0, semi)).trim();
}

// The two deterministic prohibition phrasings the door inverts to an affirmative breach claim. Both are
// simple literal alternations (no nested quantifiers, so no catastrophic backtracking - C-226) and are
// searched anywhere in the clause (not ^-anchored) so "Do not X", "Firms must not X" and "you may not X"
// all invert. PROHIBIT: "... do not / must not / may not / shall not / never ..." + a bare verb phrase.
const PROHIBIT_OP_RX = /\b(?:do not|do n['’]t|don['’]t|must not|must never|may not|shall not|shall never|never|do no)\b[\s,:.-]*/i;
// REMOVE: an imperative to strip prohibited content ("remove / delete / avoid / omit / exclude Y").
const REMOVE_OP_RX = /\b(?:remove|delete|avoid|omit|exclude)\b[\s,:.-]*/i;

// affirmativeFromDuty(clause) -> { claim, basis } re-framing a prohibition clause as the affirmative
// breach proposition, or null when neither deterministic transform applies. `basis` names which
// transform fired (for the honesty report + tests). The substantive words after the operator are the
// duty's OWN words, verbatim (only a leading operator is removed and a fixed frame prepended), so the
// claim is provably catalogue-derived (F3c).
function affirmativeFromDuty(clause) {
  const c = String(clause == null ? '' : clause).trim();
  const prohibit = PROHIBIT_OP_RX.exec(c);
  if (prohibit) {
    const rest = c.slice(prohibit.index + prohibit[0].length).trim();
    if (rest) return { claim: 'This website does ' + rest, basis: 'prohibition-verb' };
  }
  const remove = REMOVE_OP_RX.exec(c);
  if (remove) {
    const rest = c.slice(remove.index + remove[0].length).trim();
    if (rest) return { claim: "This website's public content includes " + rest, basis: 'removal-verb' };
  }
  return null;
}

// A fixed frame prepended to the fallback so it reads as a presence assertion. Kept as one const so the
// "framing words vs catalogue words" boundary is explicit (tests strip it to prove the remainder is the
// duty verbatim).
const FALLBACK_FRAME = "This website's public content contains material prohibited by this obligation: ";

// fallbackClaim(clause) -> the documented deterministic fallback when a duty matches neither transform
// (an unusually-phrased prohibition). It embeds the duty clause verbatim after a fixed presence frame,
// so the offending quote still has an affirmative "prohibited material is present" proposition to
// entail. Honestly weaker than the operator-inverted forms (it leans on the model connecting the quote
// to the embedded obligation) and reported as such; it invents nothing.
function fallbackClaim(clause) {
  return FALLBACK_FRAME + String(clause == null ? '' : clause).trim();
}

/**
 * atomicClaimFor(record, candidate) -> the Gate-3 NLI hypothesis STRING for one candidate.
 *
 * record     a compiled catalogue record ({ name, website_obligations:[{duty}] }, indexed by
 *            candidate.duty_idx) OR a finding-shaped view carrying the already-selected duty as
 *            `description` (adjudicate.js passes the finding as both record and candidate). Rule 2: the
 *            ONLY source of the duty text; this module reads it, never authors it.
 * candidate  the candidate/finding whose artifact declares the evidence polarity (isPresenceBreach).
 *
 * Presence-breach (a verbatim quote artifact): the affirmative breach claim the quote must ENTAIL,
 * deterministically derived from the record's own duty. Every other kind (absence/coverage_proof, and -
 * were they ever to reach here rather than bypass - register/observed): the existing basis, the duty
 * text unchanged, so no behaviour changes outside the presence-breach path.
 */
function atomicClaimFor(record, candidate) {
  const duty = dutyText(record, candidate);
  if (!isPresenceBreach(candidate)) return duty;
  const clause = firstClause(duty);
  const built = affirmativeFromDuty(clause);
  return built ? built.claim : fallbackClaim(clause);
}

// claimBasisFor(record, candidate) -> which template produced the hypothesis: 'existing-duty' (non
// presence-breach), 'prohibition-verb', 'removal-verb', or 'fallback'. Exported for the honesty report
// and tests (proves WHICH deterministic path a record shape takes), never used to alter a verdict.
function claimBasisFor(record, candidate) {
  if (!isPresenceBreach(candidate)) return 'existing-duty';
  const built = affirmativeFromDuty(firstClause(dutyText(record, candidate)));
  return built ? built.basis : 'fallback';
}

// ── FINAL UNIT iteration 3 (bridge-as-glossary): the Gate-3 SECOND premise is a DEFINITIONAL glossary,
// never the prohibition duty. U1 resume 4 proved the FULL-duty bridge (iteration 2) made the model REASON
// correctly ("the website does advertise such medicine to the public") but then LABEL the relation
// `contradiction` and misquote the affirmative hypothesis as "the hypothesis that it does not". Diagnosis:
// the duty OPENS with the deontic operator "Do not advertise ...", which is the first rule-text the model
// reads and primes a hypothesis-polarity inversion. The fix (an architectural correction, not a
// loosening): the entailment premise carries ONLY the record's DEFINITIONAL/enumerative mapping - which
// page terms count as the regulated thing - stripped of every imperative/prohibition operator. The
// prohibition itself is ADJUDICATION's job (briefOf's duty text), handled correctly there and untouched.

// OPERATOR_RX - the imperative/prohibition operator vocabulary REMOVED from the glossary so it carries no
// deontic priming (the whole iteration-3 point; I2). A removal-superset of the atomic-claim door's
// PROHIBIT_OP_RX/REMOVE_OP_RX (do not / must not / may not / shall not / never / remove / delete / avoid
// ...) plus prohibited / forbidden / banned / restricted. Global (strip EVERY occurrence); simple literal
// alternations only, no nested quantifiers, so no catastrophic backtracking (C-226).
const OPERATOR_RX = /\b(?:do not|do n['’]t|don['’]t|must not|must never|must only|may not|may only|shall not|shall never|should not|never|do no|remove|delete|avoid|omit|exclude|strip|prohibit(?:ed|s|ion)?|forbid(?:den|s)?|ban(?:ned|s)?|restrict(?:ed|s|ion)?)\b/gi;
// stripOperators(text) -> text with every operator token removed and whitespace re-collapsed. The one
// guarantee the glossary carries no deontic priming.
function stripOperators(text) {
  return String(text == null ? '' : text).replace(OPERATOR_RX, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([;,.:])/g, '$1').trim();
}

// ENUM_CUE_RX - the cue that introduces an indirect-reference listing ("... such as 'x', 'y'"). A quoted
// TERM is captured by QUOTED_TERM_RX (straight or curly quotes, 1-80 non-quote chars). Both bounded (C-226).
const ENUM_CUE_RX = /\b(?:such as|e\.?g\.?|for example|for instance|including|includes|namely)\b/i;
const QUOTED_TERM_RX = /['"‘“]([^'"‘’“”\n]{1,80}?)['"’”]/;
// enumeratedTerms(duty) -> the catalogue-verbatim indirect-reference TERMS listed after the enumerative
// cue, in order, de-duplicated. No cue, or no quoted term after it -> [] (the caller yields no glossary).
function enumeratedTerms(duty) {
  const s = String(duty == null ? '' : duty);
  const cue = ENUM_CUE_RX.exec(s);
  if (!cue) return [];
  const rx = new RegExp(QUOTED_TERM_RX.source, 'g');
  const region = s.slice(cue.index);
  const out = [];
  let m;
  while ((m = rx.exec(region)) !== null) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// LEADING_VERB_RX / TRAILING_AUDIENCE_RX - a leading action verb (after the operator strip) and a trailing
// audience adverbial, both dropped so the glossary SUBJECT is the regulated noun phrase, not the imperative
// that governs it (only framing words go; the substantive noun stays, catalogue-preserving).
const LEADING_VERB_RX = /^(?:advertise|promote|market|name|mention|reference|display|depict|use|sell|offer|publish|list|feature|show|make|state|imply|allude to)s?\b[\s,:.-]*/i;
const TRAILING_AUDIENCE_RX = /\s+to (?:the (?:general )?public|consumers|patients|customers|the public|clients)\b.*$/i;
// regulatedSubject(duty) -> the noun phrase the indirect references point to, from the duty's primary
// clause with operators, the leading verb and the trailing audience adverbial removed.
function regulatedSubject(duty) {
  const c = firstClause(String(duty == null ? '' : duty));
  return stripOperators(c).replace(LEADING_VERB_RX, '').replace(TRAILING_AUDIENCE_RX, '').trim();
}

// The fixed, law-free frame the glossary prepends (the "This website does" analogue: framing words the
// door owns, never catalogue content), and a generic subject when the duty yields none.
const GLOSSARY_HEAD = 'The following are indirect references to ';
const GENERIC_SUBJECT = 'the item this obligation governs';
// glossaryFromDuty(duty) -> "The following are indirect references to <subject>: <term>, <term>." (subject
// and terms catalogue-verbatim, operator-stripped; the frame fixed and law-free), or '' when the duty
// enumerates no terms (no enumerable definitional content -> single-premise path).
function glossaryFromDuty(duty) {
  const terms = enumeratedTerms(duty);
  if (terms.length === 0) return '';
  const subject = regulatedSubject(duty) || GENERIC_SUBJECT;
  return GLOSSARY_HEAD + subject + ': ' + terms.join(', ') + '.';
}

// bridgeTextFor(record, candidate) -> the Gate-3 SECOND premise: a DEFINITIONAL GLOSSARY of the record's
// own indirect-reference terms (FINAL UNIT iteration 3), for a PRESENCE-breach ONLY. Deterministic,
// catalogue-verbatim terms, no imperative/prohibition operator, no authored law fact (Rule 2/11); the
// prompt door then DOC-delimits and sanitises it (C-134). Absence/coverage keep the single-premise basis
// (their hypothesis IS the duty); register/observed bypass Gate 3 (C-084). A duty that enumerates no
// indirect-reference terms yields '' (single-premise path, the pre-iteration-2 behaviour).
function bridgeTextFor(record, candidate) {
  if (!isPresenceBreach(candidate)) return '';
  return glossaryFromDuty(dutyText(record, candidate));
}

if (require.main === module) {
  process.stderr.write('breach/adjudicator/claim.js is a library (atomicClaimFor). It makes no network calls and authors no law facts.\n');
  process.exit(2);
}

module.exports = {
  atomicClaimFor,
  claimBasisFor,
  bridgeTextFor,
  isPresenceBreach,
  dutyText,
  firstClause,
  affirmativeFromDuty,
  fallbackClaim,
  FALLBACK_FRAME,
  QUOTE_ARTIFACT_TYPES,
};
