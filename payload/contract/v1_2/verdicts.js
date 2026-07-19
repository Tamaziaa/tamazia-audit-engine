'use strict';
// payload/contract/v1_2/verdicts.js - Fact and the Breach | Clean | Unknown verdict lattice (Kimi WS0,
// blueprint 2.2). These are the ONLY constructors of a verdict. Clean requires a real CoverageManifest
// (invariant a); an under-proven absence Breach refuses and returns Unknown{coverage_incomplete}
// (invariant b); a violation/behavioural Breach requires a real Quote (Rule 3).

const core = require('./core.js');
const { LawRef, PenaltyRef } = require('./catalogue.js');
const { certificateProvesAbsence } = require('./coverage.js');

const { brands, freeze, reqString, isLawRef, isPenaltyRef, isQuote, isCoverageManifest } = core;

// Fact<T> - a value with a tier, signals, confidence and conflicts.
function isValidConfidence(c) { return typeof c === 'number' && c >= 0 && c <= 1; }
function frozenArrayCopy(a) { return freeze(Array.isArray(a) ? a.slice() : []); }
function assertFactSpec(s) {
  if (!('value' in s)) throw new Error('Fact: value is required');
  if (!core.FACT_TIER_SET.has(s.tier)) throw new Error('Fact: tier must be one of ' + core.FACT_TIERS.join('|') + ' (got ' + JSON.stringify(s.tier) + ')');
  if (!isValidConfidence(s.confidence)) throw new Error('Fact: confidence must be a number in [0,1] (got ' + JSON.stringify(s.confidence) + ')');
}
function Fact(spec) {
  const s = spec || {};
  assertFactSpec(s);
  return freeze({
    value: s.value, tier: s.tier, confidence: s.confidence,
    signals: frozenArrayCopy(s.signals), conflicts: frozenArrayCopy(s.conflicts),
  }, brands.fact);
}

// Unknown(spec) -> a frozen Unknown verdict. R21: reason_code AND missing (the resolution path) are both
// required. coverage is an OPTIONAL CoverageManifest: a top-level audit Unknown carries the site manifest;
// a per-verdict Unknown (an under-proven absence breach) may carry none and names the gap in `missing`.
// badOptionalCoverage(cov) -> true when a supplied (non-null) coverage is not a real CoverageManifest.
function badOptionalCoverage(cov) {
  if (cov == null) return false;
  return !isCoverageManifest(cov);
}
function Unknown(spec) {
  const s = spec || {};
  reqString(s.reason_code, 'reason_code', 'Unknown');
  reqString(s.missing, 'missing', 'Unknown'); // the resolution path: what fact/coverage would resolve it
  if (badOptionalCoverage(s.coverage)) {
    throw new Error('Unknown: coverage, when present, must be a CoverageManifest built by CoverageManifest() (got a non-manifest object)');
  }
  return freeze({ kind: 'Unknown', reason_code: s.reason_code, missing: s.missing, coverage: s.coverage == null ? null : s.coverage }, brands.verdict);
}

// Clean(spec) -> a frozen Clean verdict. THE ONLY constructor of clean (invariant a): it REQUIRES a real
// CoverageManifest, which already proved checks_run union checks_unrun == checks_planned. Incapacity is no
// longer representable as health.
function Clean(spec) {
  const s = spec || {};
  if (!isCoverageManifest(s.coverage)) {
    throw new Error('Clean: coverage MUST be a CoverageManifest built by CoverageManifest() (invariant a: a clean verdict requires a complete, reasoned coverage manifest; incapacity is never representable as health).');
  }
  return freeze({ kind: 'Clean', coverage: s.coverage }, brands.verdict);
}

// requireBreachRefs(s, opts) -> { law, penalty } as branded refs (accepts already-branded refs or plain
// specs plus a catalogue index in opts). Also validates class. Throws on anything unresolvable.
function requireBreachRefs(s, opts) {
  const idx = opts && opts.catalogueIndex;
  const law = isLawRef(s.law) ? s.law : LawRef(s.law, idx);
  const penalty = isPenaltyRef(s.penalty) ? s.penalty : PenaltyRef(s.penalty, idx);
  // the penalty must belong to the breached law: individually-valid refs must not be combined across two
  // different laws (CodeRabbit PR #33; a penalty for law B attached to a breach of law A is a fabrication).
  if (penalty.law_id !== law.law_id) throw new Error('Breach: penalty.law_id ' + JSON.stringify(penalty.law_id) + ' does not belong to the breached law.law_id ' + JSON.stringify(law.law_id) + ' (a penalty is copied from its own law, never cross-attached)');
  if (!core.BREACH_CLASS_SET.has(s.class)) throw new Error('Breach: class must be one of ' + core.BREACH_CLASSES.join('|') + ' (got ' + JSON.stringify(s.class) + ')');
  return { law, penalty };
}
// buildAbsenceBreach(s, law, penalty) -> a frozen absence Breach, OR Unknown{coverage_incomplete} when the
// certificate does not prove absence (invariant b).
function buildAbsenceBreach(s, law, penalty) {
  if (!certificateProvesAbsence(s.certificate)) {
    return Unknown({
      reason_code: 'coverage_incomplete',
      missing: 'an absence breach requires a CoverageCertificate with threshold_met true and >= 2 independent discovery methods; the supplied certificate does not prove the item is absent',
    });
  }
  return freeze({ kind: 'Breach', breach_kind: 'absence', law, penalty, class: s.class, quote: null, certificate: s.certificate }, brands.verdict);
}
// buildQuoteBreach(s, breach_kind, law, penalty) -> a frozen violation/behavioural Breach; throws when the
// proof quote is not a real Quote (Rule 3).
function buildQuoteBreach(s, breach_kind, law, penalty) {
  if (!isQuote(s.quote)) throw new Error('Breach(' + breach_kind + '): quote MUST be a Quote built by Quote({ evidence_id, byte_start, byte_end }) - a breach with no resolvable on-page quote is unrepresentable (Rule 3 / blueprint 2.2)');
  return freeze({ kind: 'Breach', breach_kind, law, penalty, class: s.class, quote: s.quote, certificate: null }, brands.verdict);
}
// Breach(spec, opts) -> a frozen Breach verdict, OR (for an under-proven absence breach) Unknown. breach_kind
// selects the proof standard (blueprint B4): violation/behavioural require a Quote; absence requires a
// CoverageCertificate that proves absence. Every breach carries a resolvable LawRef, a class and a PenaltyRef.
function Breach(spec, opts) {
  const s = spec || {};
  const breach_kind = s.breach_kind == null ? 'violation' : s.breach_kind;
  if (!core.BREACH_KIND_SET.has(breach_kind)) throw new Error('Breach: breach_kind must be one of ' + core.BREACH_KINDS.join('|') + ' (got ' + JSON.stringify(breach_kind) + ')');
  const { law, penalty } = requireBreachRefs(s, opts);
  if (breach_kind === 'absence') return buildAbsenceBreach(s, law, penalty);
  return buildQuoteBreach(s, breach_kind, law, penalty);
}

module.exports = { Fact, Unknown, Clean, Breach };
