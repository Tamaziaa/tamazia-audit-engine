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
// DOM_NODE_ARTIFACT_TYPES (W6): the dom_node artifact types (the canonical enum value plus the port
// alias). The risk-tier check reads a `tier` ONLY off these: a network_event or register_row carries no
// finding tier and must keep its normal bypass. A dom_node is still an OBSERVED type (above); the tier
// only decides whether a CONFIRMED node bypasses-to-violation or routes to needs-review.
const DOM_NODE_ARTIFACT_TYPES = new Set([ARTIFACT_TYPES.DOM_NODE, 'failing_dom_node']);
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

// isRiskTierDomNode(candidate) -> true when the artifact is a dom_node whose finding tier is exactly
// 'risk' (insecure-form, pre-ticked-consent - the risk-based, non-deterministic rules, W6). ONLY an exact
// tier==='risk' qualifies: a 'deterministic' tier, an absent tier (a legacy/ported dom_node that never
// carried one), or any other value keeps the normal deterministic bypass-to-violation (W6 backward
// safety). The tier is stamped by evidence/browser/dom-assert.js's DOM_RULE_TIER door and ridden onto the
// artifact by breach/proposers/propose.js, so this classifier never re-derives it (Rule 1, one door).
function isRiskTierDomNode(candidate) {
  const a = candidate && candidate.artifact;
  if (!a || typeof a !== 'object') return false;
  const t = typeof a.type === 'string' ? a.type.toLowerCase().trim() : '';
  return DOM_NODE_ARTIFACT_TYPES.has(t) && a.tier === 'risk';
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

// carriesUntypedTextEvidence(candidate) -> true when there is no typed artifact but the candidate still
// carries a verbatim quote or an absence record; named so the untyped-fallback check is not its own
// "Complex Conditional" inline inside artifactKindOf.
function carriesUntypedTextEvidence(candidate) {
  return Boolean(candidate) && Boolean(candidate.evidence_quote || candidate.absence_evidence);
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
  if (carriesUntypedTextEvidence(candidate)) return 'absence';
  return null;
}

// declaredKindOf(candidate) -> the canonical kind the candidate CLAIMS via `evidence_kind`, or null
// when it declares nothing (no claim = nothing to masquerade; the artifact governs).
function declaredKindOf(candidate) {
  const raw = candidate && candidate.evidence_kind;
  if (typeof raw !== 'string') return null;
  return DECLARED_TO_KIND.get(raw.toLowerCase().trim()) || null;
}

function classification(kind, bypass, valid, reason, review) {
  return { kind, bypass, valid, reason: reason || null, review: review === true };
}

/**
 * classifyEvidenceKind(candidate) -> { kind, bypass, valid, reason, review }
 *   kind    'observation' | 'absence' | 'register' - the resolved evidence kind (task contract).
 *   bypass  true for observation + register (skip LLM adjudication, ship as an observed fact);
 *           false for absence (must be adjudicated by the model) AND for a risk-indicator dom_node.
 *   valid   false when the candidate MASQUERADED its kind (declared != artifact) or carries no
 *           deterministic artifact at all - the adjudicator quarantines it to needs-review.
 *   reason  a human-readable cause when valid is false, or the risk-review reason, else null.
 *   review  true (W6) for a RISK-tier dom_node: a confirmed observation whose legal characterisation is
 *           risk-based, not deterministic (insecure-form under UK GDPR Art 32, pre-ticked-consent). It
 *           skips the LLM (there is no text to adjudicate) but routes to needs-review carrying its
 *           dom_node artifact, NEVER a hard violation (Rule 6/Rule 10, the C-048 class). false otherwise.
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
  // W6: a RISK-tier dom_node does NOT take the observed-fact bypass-to-violation. It is a real, confirmed
  // observation (valid, artifact intact) but its legal characterisation is risk-based, so it routes to
  // needs-review (review:true, bypass:false), never a hard accusation (C-048, Rule 6/Rule 10). Reached
  // only for a valid, non-masqueraded observation (the two guards above already returned on a null
  // artifact or a declared-kind mismatch, so a risk dom_node that ALSO masquerades is still rejected
  // first). A deterministic or tier-absent dom_node falls through to the normal bypass below.
  if (artifactKind === 'observation' && isRiskTierDomNode(candidate)) {
    return classification('observation', false, true,
      'risk-indicator dom_node: a confirmed observation with a risk-based (non-deterministic) legal '
      + 'characterisation -> needs-review, never a hard violation (C-048, Rule 6/Rule 10)', true);
  }
  return classification(artifactKind, BYPASS_KINDS.has(artifactKind), true, null);
}

module.exports = {
  classifyEvidenceKind,
  artifactKindOf,
  declaredKindOf,
  isRiskTierDomNode,
  KINDS,
  BYPASS_KINDS,
  OBSERVED_ARTIFACT_TYPES,
  DOM_NODE_ARTIFACT_TYPES,
  REGISTER_ARTIFACT_TYPES,
  TEXT_ARTIFACT_TYPES,
};
