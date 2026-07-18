'use strict';
// breach/adjudicator/evidence-kind.js - THE absence-vs-observation gate (P3 Wave-2c, GAPS.md P0).
//
// THE DISEASE (caution.md C-084 + C-085), stated plainly:
//   The old `_kindOf()` mapped EVERY compliance finding to `absence`, so a browser-observed fact (a
//   non-essential cookie fired before consent - a completed PECR reg.6 breach) was routed through TEXT
//   adjudication. The model was handed no text quote it could see, correctly returned "insufficient",
//   and our single most un-arguable finding was DROPPED. Every audit shipped with zero compliance
//   findings until the fix (birketts went 0 -> 18). The mirror-image danger is the fabrication vector:
//   an ABSENCE claim ("we did not find X") is the class that hallucinated a 16-breach GDPR cascade; if
//   it MASQUERADES as an observation it would bypass the model entirely and ship as a hard violation
//   with nothing but a regex behind it.
//
// THE RULE THIS ENFORCES:
//   Evidence kind is DECLARED by the artifact, not asserted by a label. The deterministic artifact
//   (Constitution Rule 3) is the ground truth:
//     - observation  a directly-OBSERVED fact: a captured network event, a cookie-jar entry, a failing
//                     DOM node, a link-health probe. BYPASSES LLM adjudication (it is a fact, not a
//                     reading of a page). Ships as an adjudicated violation carrying its artifact.
//     - register     a public-REGISTER row (Companies House / ICO / SRA / ...). BYPASSES adjudication.
//     - absence      the TEXT-DERIVED class (a required disclosure claimed missing, OR a verbatim quote
//                     matched on the page and claimed to breach). This is the fabrication-prone class and
//                     ALWAYS requires LLM adjudication. It never bypasses.
//
//   A candidate may NEVER masquerade its kind. If a candidate DECLARES a kind (`evidence_kind`) that
//   disagrees with the kind its artifact actually establishes, it is REJECTED (valid:false): the
//   adjudicator quarantines it to needs-review rather than trust the label. A candidate with no
//   recognised artifact at all is rejected too (no artifact, no breach - Rule 3).
//
// This module is PURE: a function of one candidate object, no I/O, no network, no module-scope mutation.

const { ARTIFACT_TYPES } = require('../artifact-types.js');

// ── artifact.type families (the ground truth). A candidate BYPASSES only on a genuine observed/register
//    artifact type; everything text-shaped is the adjudicated `absence` class. Each set maps FROM the
//    canonical breach/artifact-types.js enum (the one door the proposer/verifier flow emits) and keeps
//    the old-estate literals as PORT ALIASES so a ported candidate or a legacy calibration fixture still
//    classifies correctly (ledger decision 1: "replace/alias its corpus_quote/network_request/
//    cookie_jar_entry literals"). Before this, the sets held ONLY the port literals, so a real proposer's
//    `network_event`/`coverage_proof`/`register_absence` candidate matched none of them and was silently
//    quarantined - the C-084 disease resurrected through a type-name mismatch. ──────────────────────────
//
// register_absence is deliberately in the TEXT (adjudicated) family, NOT the bypassing register family:
// a register no-match is WEAK (a slightly different registered name can miss the match), so it must be
// quarantined, never bypassed to a hard violation (Rule 6). Only a PRESENT register_row bypasses.
const OBSERVED_ARTIFACT_TYPES = new Set([
  ARTIFACT_TYPES.NETWORK_EVENT,
  'network_request', 'cookie_jar_entry', 'dom_node', 'failing_dom_node', 'link_health', // port aliases
]);
const REGISTER_ARTIFACT_TYPES = new Set([
  ARTIFACT_TYPES.REGISTER_ROW,
  'register_hit', 'register_check', // port aliases
]);
const TEXT_ARTIFACT_TYPES = new Set([
  ARTIFACT_TYPES.QUOTE, ARTIFACT_TYPES.COVERAGE_PROOF, ARTIFACT_TYPES.REGISTER_ABSENCE,
  'corpus_quote', 'verbatim_quote', 'presence', 'absence', 'absence_claim', // port aliases
]);

// Declared `evidence_kind` synonyms -> the canonical three. Presence and absence both canonicalise to
// `absence` (the adjudicated text class): a matched quote still needs the model to rule out the "firm
// writing ABOUT a topic is not committing it" false positive, exactly as an absence claim does.
const DECLARED_TO_KIND = new Map([
  ['observation', 'observation'], ['observed', 'observation'], ['observed_fact', 'observation'],
  ['observed-behaviour', 'observation'], ['observed_behaviour', 'observation'], ['observed_in_browser', 'observation'],
  ['behaviour', 'observation'], ['browser', 'observation'],
  ['register', 'register'], ['register-fact', 'register'], ['register_fact', 'register'],
  ['public_register_checked', 'register'], ['register_row', 'register'],
  ['absence', 'absence'], ['document-absence', 'absence'], ['document_absence', 'absence'],
  ['presence', 'absence'], ['document-presence', 'absence'], ['document_presence', 'absence'],
  ['text', 'absence'], ['text-derived', 'absence'],
]);

const KINDS = new Set(['observation', 'absence', 'register']);
const BYPASS_KINDS = new Set(['observation', 'register']); // observations + register rows skip the LLM

function artifactTypeOf(candidate) {
  const a = candidate && candidate.artifact;
  return a && typeof a.type === 'string' ? a.type.toLowerCase().trim() : '';
}

// Port-compat: the old estate carried the observed/register signal inside `absence_evidence.state`
// (E-272 `_observedFact`). We still honour that shape so a ported candidate is classified correctly.
function legacyObservedKind(candidate) {
  const ae = candidate && candidate.absence_evidence;
  const st = ae && typeof ae.state === 'string' ? ae.state.toLowerCase().trim() : '';
  if (st === 'observed_in_browser') return 'observation';
  if (st === 'public_register_checked') return 'register';
  return null;
}

// artifactKindOf(candidate) -> the kind the ARTIFACT establishes, or null when no artifact is
// recognisable (a Rule-3 reject: no artifact, no breach). Never throws.
function artifactKindOf(candidate) {
  const t = artifactTypeOf(candidate);
  if (OBSERVED_ARTIFACT_TYPES.has(t)) return 'observation';
  if (REGISTER_ARTIFACT_TYPES.has(t)) return 'register';
  if (TEXT_ARTIFACT_TYPES.has(t)) return 'absence';
  const legacy = legacyObservedKind(candidate);
  if (legacy) return legacy;
  // No typed artifact: a verbatim quote or an absence record is still the adjudicated text class.
  if (candidate && (candidate.evidence_quote || candidate.absence_evidence)) return 'absence';
  return null;
}

// declaredKindOf(candidate) -> the canonical kind the candidate CLAIMS via `evidence_kind`, or null
// when it declares nothing (no claim = nothing to masquerade; the artifact governs).
function declaredKindOf(candidate) {
  const raw = candidate && candidate.evidence_kind;
  if (typeof raw !== 'string') return null;
  return DECLARED_TO_KIND.get(raw.toLowerCase().trim()) || null;
}

function classification(kind, bypass, valid, reason) {
  return { kind, bypass, valid, reason: reason || null };
}

/**
 * classifyEvidenceKind(candidate) -> { kind, bypass, valid, reason }
 *   kind    'observation' | 'absence' | 'register' - the resolved evidence kind (task contract).
 *   bypass  true for observation + register (skip LLM adjudication, ship as an observed fact);
 *           false for absence (must be adjudicated by the model).
 *   valid   false when the candidate MASQUERADED its kind (declared != artifact) or carries no
 *           deterministic artifact at all - the adjudicator quarantines it to needs-review.
 *   reason  a human-readable cause when valid is false (for the report + stage manifest), else null.
 *
 * The artifact is ground truth. A declared kind is only ever a cross-check against it; on any
 * disagreement the candidate is rejected (never silently trusted, never allowed to bypass).
 */
function classifyEvidenceKind(candidate) {
  const artifactKind = artifactKindOf(candidate);
  const declared = declaredKindOf(candidate);
  // Rule 3: no recognised artifact means this cannot be a breach input. Quarantine (never bypass).
  if (artifactKind === null) {
    const reason = declared
      ? ('declared "' + declared + '" but no deterministic artifact backs it (Rule 3)')
      : 'no deterministic artifact - no artifact, no breach (Rule 3)';
    return classification('absence', false, false, reason);
  }
  // Anti-masquerade (C-084 / C-085): the artifact wins; a declared kind that disagrees is rejected.
  if (declared && declared !== artifactKind) {
    return classification(artifactKind, false, false,
      'kind mismatch: declared "' + declared + '" but the artifact establishes "' + artifactKind + '"');
  }
  return classification(artifactKind, BYPASS_KINDS.has(artifactKind), true, null);
}

module.exports = {
  classifyEvidenceKind,
  artifactKindOf,
  declaredKindOf,
  KINDS,
  BYPASS_KINDS,
  OBSERVED_ARTIFACT_TYPES,
  REGISTER_ARTIFACT_TYPES,
  TEXT_ARTIFACT_TYPES,
};
