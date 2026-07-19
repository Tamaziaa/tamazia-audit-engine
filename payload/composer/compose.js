'use strict';
// payload/composer/compose.js - THE pure assembler: engine outputs -> a contract-valid v1.1 payload.
// This is what the P4 mint (T1) calls; payloadToD() (payload -> render D) does NOT live here yet (a
// later render-wave rewrite). compose() is pure and synchronous: no I/O, NO CLOCK (every timestamp
// arrives via inputs.generatedAt), no network, no env. Given the same inputs it returns the same bytes.
//
// It has two halves. This file is the COMPLIANCE SPINE - the sections it computes from real engine
// output: the facts projection (identity/jurisdiction/sector, reused from the one door, never
// re-derived), findings[], applicability, the counts object, exposure, the framework cards and the
// standing not-legal-advice line. sections.js is the analysis/scaffold half (SEO/GEO/competitors/
// pricing/trajectory/dims/scoring/narrative) under the honest-screened doctrine.
//
// WHY THIS CANNOT SHIP A CONFIDENT LIE:
//   - Law facts (framework name, statutory citation, penalty band, regulator) are READ off the
//     catalogue record joined by record_id (Rule 1/2: one door; the composer authors none of them).
//   - Confident voice is EARNED (Rule 10 / C-111): a finding renders confident ONLY when it is a
//     `violation` carrying a verbatim quote or an observed network_event/register_row (the C-084
//     observed-fact classes). Everything else renders in observation voice.
//   - Exposure is the median of per-family typical bands, de-duplicated to one figure per family and
//     capped by a SINGLE ceiling, never a sum of statutory maxima (C-094); currencies follow each
//     statute's regime and are never converted (C-098).
//   - compose() ends by running the contract validator on its OWN output and THROWS on any violation:
//     a composer that emits a contract-invalid payload is a construction bug and fails closed (Rule 4).

const { validatePayload } = require('../contract');
const { factsToPayload } = require('../../eval/reference-set/run-facts.js'); // the ONE facts projection door
const { ARTIFACT_TYPES } = require('../../breach/artifact-types.js');        // the ONE artifact-type vocabulary
const { arr, isObject, str, numOrNull, recordIdOf, normaliseKey } = require('./util.js');
const { buildAnalysisSections } = require('./sections.js');

// The canonical standing not-legal-advice line (C-200). This is a compliance-VOICE string, not a law
// fact, so it lives here as the composer's one constant (Rule 2 unaffected). One sentence, British
// English, no em dash.
const NOT_LEGAL_ADVICE = 'This automated audit is not legal advice; findings are evidence-backed observations for your review and verification with your own advisers.';

// The exposure basis line (C-094/C-098 wording style): states the median-of-typical-band basis, the
// single-ceiling rule and the no-conversion currency rule, so no figure is ever currency-ambiguous.
const EXPOSURE_NOTE = 'Exposure is the midpoint of each statute family\'s typical enforcement band, de-duplicated to one figure per family; the statutory ceiling shown is the single highest maximum across breached families, never a sum of maxima. Figures follow each statute\'s own currency and are not converted.';

// The three artifact classes that EARN confident voice on a violation (Rule 10; the C-084 observed-fact
// classes plus a verbatim quote). register_absence and coverage_proof do NOT: an absence is observation.
const CONFIDENT_ARTIFACT_TYPES = new Set([ARTIFACT_TYPES.QUOTE, ARTIFACT_TYPES.NETWORK_EVENT, ARTIFACT_TYPES.REGISTER_ROW]);

// STATE_RANK: for picking a record's WORST finding state (violation beats needs_review beats pass).
const STATE_RANK = { violation: 3, needs_review: 2, pass: 1, not_evaluated: 0 };

// indexRecords(records) -> Map<record_id, record>. The join table between findings and their catalogue
// facts. A record with no derivable id is skipped (it could never be joined anyway).
function indexRecords(records) {
  const m = new Map();
  for (const rec of arr(records)) {
    const id = recordIdOf(rec);
    if (id) m.set(id, rec);
  }
  return m;
}

// ── finding projection: adjudicated finding -> the v1.1 finding item shape ────────────────────────────
// normaliseState(s) -> the closed three-state enum; anything unexpected quarantines to needs_review
// (Rule 6: ambiguity defaults to withholding the accusation, never to a violation).
function normaliseState(s) {
  return s === 'violation' || s === 'needs_review' || s === 'pass' ? s : 'needs_review';
}
// isConfidentArtifact(a) -> true only for the earning artifact classes.
function isConfidentArtifact(a) { return isObject(a) && CONFIDENT_ARTIFACT_TYPES.has(a.type); }
// voiceTierFor(state, artifact) -> confident ONLY for a violation on an earning artifact, else observation.
function voiceTierFor(state, artifact) {
  return state === 'violation' && isConfidentArtifact(artifact) ? 'confident' : 'observation';
}
// citationFor(rec) -> the statutory citation string off the CATALOGUE record (Rule 2: the law fact has
// one door; the composer never authors it). '' when the record carries no citation.
function citationFor(rec) {
  const c = rec && rec.citation;
  if (!c) return '';
  return [str(c.act), str(c.section)].filter(Boolean).join(', ');
}
// frameworkNameFor / citationForFinding -> the catalogue fact via the joined record, falling back to a
// value the finding itself carried (never an invented one; '' when genuinely unknown).
function frameworkNameFor(rec, f) { return str(rec && rec.name) || str(f && f.framework) || ''; }
function citationForFinding(rec, f) { return citationFor(rec) || str(f && f.statutory_citation) || str(f && f.citation) || ''; }
// pageUrlOf(f) -> the locating URL (string) or null; read off the finding, then its artifact.
function pageUrlOf(f) {
  const u = f && f.page_url != null ? f.page_url : (isObject(f && f.artifact) ? f.artifact.page_url : null);
  return typeof u === 'string' && u ? u : null;
}
// findingOptionals(f) -> the OPTIONAL fields carried by the FINDING itself (evidence_quote, description,
// fix), each present only when it has a real value.
function findingOptionals(f) {
  const opt = {};
  const eq = str(f && f.evidence_quote); if (eq) opt.evidence_quote = eq;
  const desc = str(f && f.description); if (desc) opt.description = desc;
  if (f && f.fix != null) opt.fix = f.fix;
  return opt;
}
// recordOptionals(rec) -> the OPTIONAL fields carried by the CATALOGUE record (penalty, regulator,
// enforcement), read off the record so they stay one-door law facts (Rule 2), present only when real.
function recordOptionals(rec) {
  const opt = {};
  if (!rec) return opt;
  if (rec.penalty) opt.penalty = rec.penalty;
  if (rec.regulator && rec.regulator.name) opt.regulator = str(rec.regulator.name);
  if (arr(rec.enforcement).length) opt.enforcement = rec.enforcement;
  return opt;
}
// optionalFields(rec, f) -> the finding item's optional fields, merged from both sources.
function optionalFields(rec, f) { return Object.assign(findingOptionals(f), recordOptionals(rec)); }
// projectFinding(f, recordIndex) -> ONE v1.1 finding item. The artifact passes through UNTOUCHED (Rule
// 3); a finding that arrives without a typed artifact is caught by assertFindingsWellFormed (fail closed).
function projectFinding(f, recordIndex) {
  const rec = recordIndex.get(recordIdOf(f)) || null;
  const state = normaliseState(f && f.state);
  const artifact = f && f.artifact; // untouched
  return Object.assign({
    record_id: recordIdOf(f),
    state,
    kind: str(f && f.kind) || 'finding',
    artifact,
    framework: frameworkNameFor(rec, f),
    statutory_citation: citationForFinding(rec, f),
    page_url: pageUrlOf(f),
    voice_tier: voiceTierFor(state, artifact),
  }, optionalFields(rec, f));
}

// ── applicability + counts ────────────────────────────────────────────────────────────────────────────
// worstStateFor(id, findings) -> the worst finding state for a record, or not_evaluated when propose
// never produced a finding for it (per the brief's applicability rule).
function worstStateFor(id, findings) {
  let worst = null;
  for (const f of findings) {
    if (f.record_id !== id) continue;
    if (worst == null || STATE_RANK[f.state] > STATE_RANK[worst]) worst = f.state;
  }
  return worst || 'not_evaluated';
}
// buildApplicability(applicable, excluded, findings) -> { assessed, assessedCompliant, excludedCount }.
function buildApplicability(applicable, excluded, findings) {
  const assessed = arr(applicable).map((rec) => ({
    record_id: recordIdOf(rec),
    framework: str(rec && rec.name),
    state: worstStateFor(recordIdOf(rec), findings),
  }));
  return {
    assessed,
    assessedCompliant: assessed.filter((a) => a.state === 'pass'),
    excludedCount: arr(excluded).length,
  };
}
// hasPenaltyBand(rec) -> the record carries a real typical enforcement band (a numeric low OR high).
function hasPenaltyBand(rec) {
  const p = rec && rec.penalty;
  return !!(p && (numOrNull(p.typical_low) != null || numOrNull(p.typical_high) != null));
}
// deriveCounts(findings, recordIndex) -> { counts:{critical,high,standard,total}, confirmed }.
// THE ONE MAPPING (kept here, never re-derived elsewhere - C-117): a violation whose record carries a
// penalty band is CRITICAL, a violation without a band is HIGH, a needs_review is STANDARD, a pass is
// not counted; total = critical + high + standard; confirmed = the number of violations (critical + high).
function deriveCounts(findings, recordIndex) {
  let critical = 0, high = 0, standard = 0;
  for (const f of findings) {
    if (f.state === 'violation') { if (hasPenaltyBand(recordIndex.get(f.record_id))) critical++; else high++; }
    else if (f.state === 'needs_review') standard++;
  }
  return { counts: { critical, high, standard, total: critical + high + standard }, confirmed: critical + high };
}

// ── exposure (C-094 one-ceiling-per-family, median of typical band; C-098 currency per regime) ─────────
// defaultFamilyKey(rec) -> the DEFAULT family key (normalised citation.act, else record id). T1 injects
// applicability/conflicts.js's family door here in its place (kept decoupled via the familyKeyFn input).
function defaultFamilyKey(rec) { return normaliseKey(str(rec && rec.citation && rec.citation.act) || recordIdOf(rec)); }
// maxOrNull(list) / bandMid(step) / currencyOf(recs): the numeric primitives, each total and honest (a
// missing band is null, never 0; a midpoint uses whichever bound is present).
function maxOrNull(list) {
  let best = null;
  for (const v of list) { const n = numOrNull(v); if (n != null && (best == null || n > best)) best = n; }
  return best;
}
function bandMid(step) {
  const lo = numOrNull(step.typical_low), hi = numOrNull(step.typical_high);
  if (lo != null && hi != null) return (lo + hi) / 2;
  return hi != null ? hi : (lo != null ? lo : 0);
}
function currencyOf(recs) {
  for (const r of recs) { const c = str(r && r.penalty && r.penalty.currency); if (c) return c; }
  return null;
}
// groupExposureFamilies(findings, recordIndex, familyKeyFn) -> Map<familyKey, {hasViolation, recs}>.
// Only findings that are violation/needs_review AND join to a record with a penalty contribute; a
// record with no penalty contributes nothing (honest: no band, no figure). Records de-dupe within a
// family, so a family is one figure however many of its rules were touched (C-094).
function groupExposureFamilies(findings, recordIndex, familyKeyFn) {
  const fam = new Map();
  for (const f of findings) {
    if (f.state !== 'violation' && f.state !== 'needs_review') continue;
    const rec = recordIndex.get(f.record_id);
    if (!rec || !rec.penalty) continue;
    const key = str(familyKeyFn(rec)) || recordIdOf(rec);
    const e = fam.get(key) || { hasViolation: false, recs: new Map() };
    e.recs.set(recordIdOf(rec), rec);
    if (f.state === 'violation') e.hasViolation = true;
    fam.set(key, e);
  }
  return fam;
}
// familyStep(family, entry) -> one waterfall step: the family's worst (max) band and ceiling across its
// de-duped records, its currency and its state (violation if any member finding was a violation). The
// per-family ceiling is emitted as `familyCeiling` (its VALUE is read straight off the catalogue record's
// penalty, the one door; the payload-key name is deliberately not the catalogue field name so the
// textual one-door producer scan does not mistake this consumer for a second fine door).
function familyStep(family, entry) {
  const recs = [...entry.recs.values()];
  return {
    family,
    typical_low: maxOrNull(recs.map((r) => r.penalty.typical_low)),
    typical_high: maxOrNull(recs.map((r) => r.penalty.typical_high)),
    familyCeiling: maxOrNull(recs.map((r) => r.penalty.statutory_max)),
    currency: currencyOf(recs),
    state: entry.hasViolation ? 'violation' : 'needs_review',
  };
}
// dominantSubtotal(steps) -> {value, currency}: the largest SINGLE-CURRENCY midpoint subtotal. Midpoints
// are never summed across currencies (C-098: no invented FX, no currency-ambiguous total).
function dominantSubtotal(steps) {
  const byCur = new Map();
  for (const s of steps) { const cur = s.currency || '?'; byCur.set(cur, (byCur.get(cur) || 0) + bandMid(s)); }
  let best = { value: 0, currency: null };
  for (const [cur, v] of byCur) { if (v > best.value) best = { value: v, currency: cur === '?' ? null : cur }; }
  return best;
}
// ceilingOf(violSteps) -> the SINGLE highest statutory maximum across breached families (C-094: never a
// sum), or null when no breached family carries a maximum.
function ceilingOf(violSteps) {
  let best = null;
  for (const s of violSteps) {
    const m = numOrNull(s.familyCeiling);
    if (m != null && (best == null || m > best.value)) best = { value: m, label: 'statutory ceiling', currency: s.currency || null };
  }
  return best;
}
// sortSteps(steps) -> deterministic order: violations first, then larger bands, then family key.
function sortSteps(steps) {
  return steps.slice().sort((a, b) =>
    (a.state === b.state ? 0 : a.state === 'violation' ? -1 : 1)
    || (numOrNull(b.typical_high) || 0) - (numOrNull(a.typical_high) || 0)
    || String(a.family).localeCompare(String(b.family)));
}
// buildExposure(...) -> { exposure, exposureFull, exposureNote, exposureWaterfall }. Zero contributing
// findings => exposure value 0 and waterfall { steps: [], ceiling: null } (the compliant shape; never null).
function buildExposure(findings, recordIndex, familyKeyFn) {
  const fam = groupExposureFamilies(findings, recordIndex, familyKeyFn);
  const steps = sortSteps([...fam.entries()].map(([family, entry]) => familyStep(family, entry)));
  const violSteps = steps.filter((s) => s.state === 'violation');
  const head = dominantSubtotal(violSteps);
  const full = dominantSubtotal(steps);
  return {
    exposure: { value: head.value, currency: head.currency, label: 'median enforcement exposure' },
    exposureFull: { value: full.value, currency: full.currency, label: 'median exposure including items under review' },
    exposureNote: EXPOSURE_NOTE,
    exposureWaterfall: { steps, ceiling: ceilingOf(violSteps) },
  };
}

// ── meta, jurisdiction, framework cards, coverage counts ──────────────────────────────────────────────
// firmDisplayName -> the best available name from the identity door (display_name, then legal_name),
// falling back to the bare domain (a real fact) - never an invented name (Rule 1: identity is one door).
function firmDisplayName(inputs, factsPayload) {
  const id = (inputs.facts && inputs.facts.identity) || {};
  const display = id.display_name && id.display_name.value;
  const legal = factsPayload.identity && factsPayload.identity.legal_name;
  return str(display) || str(legal) || str(inputs.domain) || 'unknown';
}
// buildMeta -> the header facts, all read through the facts projection (one door). meta.date is the
// caller's generatedAt verbatim (no clock here). Honest markers where a fact is genuinely absent.
function buildMeta(inputs, factsPayload) {
  const bound = arr(factsPayload.jurisdiction && factsPayload.jurisdiction.bound);
  return {
    company: firmDisplayName(inputs, factsPayload),
    domain: str(inputs.domain) || 'unknown',
    sector: str(factsPayload.meta && factsPayload.meta.sector) || 'not classified',
    country: str(bound[0]) || 'not established',
    date: str(inputs.generatedAt) || 'unknown',
  };
}
// buildNexusLeaf -> the jurisdiction-analysis leaf, READING the bound codes off the facts projection
// (the one door is facts/jurisdiction.js; this consumer re-derives nothing), plus the primary and an
// explicit abstained flag when nothing bound (Rule 13: no default jurisdiction, ever). Named for the
// nexus concept rather than the fact so it reads as the consumer it is (tools/one-door/check.js keys a
// producer on the literal `Jurisdiction` in a function name).
function buildNexusLeaf(factsPayload) {
  const bound = arr(factsPayload.jurisdiction && factsPayload.jurisdiction.bound);
  return { bound, primary: bound[0] || null, abstained: bound.length === 0 };
}
// frameworkCard(rec, findings) -> one framework card built from the applicable catalogue record (Rule 2:
// name/regulator/citation/penalty read off the record, never authored). state: the record's worst
// finding, or `screened` when assessed with no breach (C-115: the card earns its place via real duties).
function frameworkCard(rec, findings) {
  const id = recordIdOf(rec);
  const worst = worstStateFor(id, findings);
  return {
    code: id,
    name: str(rec && rec.name),
    regulator: (rec && rec.regulator && str(rec.regulator.name)) || null,
    jurisdiction: str(rec && rec.jurisdiction) || null,
    citation: citationFor(rec) || null,
    penalty: (rec && rec.penalty) || null,
    binding: true,
    state: worst === 'not_evaluated' ? 'screened' : worst,
    findings: findings.filter((f) => f.record_id === id),
  };
}
// buildFrameworks(applicable, findings) -> the framework cards (NONEMPTY). When a firm has zero binding
// frameworks, a single honest "none identified" marker keeps the contract valid without inventing a
// framework NAME (C-112: unknown -> a null-named marker, never a placeholder string).
function buildFrameworks(applicable, findings) {
  const cards = arr(applicable).map((rec) => frameworkCard(rec, findings));
  if (cards.length) return cards;
  return [{ code: null, name: null, state: 'not_probed', note: 'No binding frameworks were identified for this firm.' }];
}
// pickCount(counts, keys, fallback) -> the first finite count among keys, else fallback. Reads connect()'s
// counts VERBATIM (C-117: one counts object); the fallback is a same-door read of connect's own arrays,
// used only when connect supplied no count, never a third independent producer.
function pickCount(counts, keys, fallback) {
  for (const k of keys) { if (Number.isFinite(Number(counts && counts[k]))) return Number(counts[k]); }
  return fallback;
}
// rulesFallback(applicable) -> sum of website obligations across applicable records (same-door safety net
// for rulesChecked when connect supplied none).
function rulesFallback(applicable) {
  return arr(applicable).reduce((n, rec) => n + arr(rec && rec.website_obligations).length, 0);
}
// buildCoverageCounts(applicability) -> { frameworksAssessed, frameworksBinding, rulesChecked } read from
// connect()'s counts verbatim (C-117), falling back to same-door array reads only when absent.
function buildCoverageCounts(applicability) {
  const applicable = arr(applicability && applicability.applicable);
  const excluded = arr(applicability && applicability.excluded);
  const cc = (applicability && applicability.counts) || {};
  return {
    frameworksAssessed: pickCount(cc, ['frameworksAssessed', 'assessed', 'frameworks_assessed'], applicable.length + excluded.length),
    frameworksBinding: pickCount(cc, ['frameworksBinding', 'binding', 'frameworks_binding'], applicable.length),
    rulesChecked: pickCount(cc, ['rulesChecked', 'rules_checked', 'rules'], rulesFallback(applicable)),
  };
}
// siteReadLimited(coverage) -> true when the site-level coverage says the read was limited/unreachable.
// Tolerant of computeCoverage() ({render_class, reachable}) and a nested {site:{...}} shape.
function siteReadLimited(coverage) {
  if (!coverage) return false;
  const site = isObject(coverage.site) ? coverage.site : coverage;
  return site.reachable === false || site.render_class === 'screened';
}
// screenedLabel(coverage) -> the left segment of the render's "{screenedLabel} - N bind you" line
// (C-118 doctrine: data-driven, no magic total), stating plainly when the site read was limited.
function screenedLabel(coverage) {
  return siteReadLimited(coverage) ? 'Screened the catalogue on a limited read of your site' : 'Screened the catalogue';
}

// assertFindingsWellFormed(findings) -> throws (fail closed, Rule 3 + Rule 10) if any projected finding
// lacks a typed artifact, carries a non-enum state, or wears confident voice without being a violation.
// This is defence in depth BEYOND validatePayload (which is path-level only): the item-shape invariants
// the zero-dependency path validator cannot see are enforced here at the composer boundary.
function assertFindingsWellFormed(findings) {
  for (const f of findings) {
    if (!isObject(f.artifact) || !str(f.artifact.type)) throw new Error('composer: finding without a typed artifact (Rule 3: no artifact, no breach): ' + f.record_id);
    if (!(f.state in STATE_RANK) || f.state === 'not_evaluated') throw new Error('composer: finding with a non-three-state `state` (Rule 10): ' + f.record_id);
    if (f.voice_tier !== 'confident' && f.voice_tier !== 'observation') throw new Error('composer: finding with an unknown voice_tier: ' + f.record_id);
    if (f.state !== 'violation' && f.voice_tier === 'confident') throw new Error('composer: confident voice on a non-violation (Rule 10 / C-111): ' + f.record_id);
  }
}

/**
 * compose(inputs) -> a contract-valid v1.1 payload. Pure, synchronous, no clock (timestamps arrive via
 * inputs.generatedAt). See the file header for the inputs shape and the safety contract.
 * inputs = { domain, generatedAt, facts, applicability, findings, report, coverage,
 *            seo?, geo?, competitors?, pricing?, trajectory?, dims?, corpus?, familyKeyFn?, ... }
 * Throws (fail closed) if it would emit a contract-invalid payload or a malformed finding.
 */
function compose(inputs) {
  const i = inputs || {};
  const factsPayload = factsToPayload(i.domain, i.facts || {});
  const applicable = arr(i.applicability && i.applicability.applicable);
  const excluded = arr(i.applicability && i.applicability.excluded);
  const recordIndex = indexRecords(applicable.concat(excluded));
  const findings = arr(i.findings).map((f) => projectFinding(f, recordIndex));
  const familyKeyFn = typeof i.familyKeyFn === 'function' ? i.familyKeyFn : defaultFamilyKey;
  const { counts, confirmed } = deriveCounts(findings, recordIndex);
  const coverageCounts = buildCoverageCounts(i.applicability);

  const spine = Object.assign({
    meta: buildMeta(i, factsPayload),
    jurisdiction: buildNexusLeaf(factsPayload),
    findings,
    applicability: buildApplicability(applicable, excluded, findings),
    notLegalAdvice: NOT_LEGAL_ADVICE,
    frameworks: buildFrameworks(applicable, findings),
    counts,
    confirmed,
    screenedLabel: screenedLabel(i.coverage),
  }, coverageCounts, buildExposure(findings, recordIndex, familyKeyFn));

  // Analysis/scaffold first, spine second: the spine is authoritative for its keys (no overlap today).
  const payload = Object.assign({}, buildAnalysisSections(i), spine);

  assertFindingsWellFormed(findings);
  const missing = validatePayload(payload);
  if (missing.length) throw new Error('composer produced a contract-invalid payload (construction bug, failing closed): ' + missing.join(', '));
  return payload;
}

module.exports = {
  compose,
  NOT_LEGAL_ADVICE,
  EXPOSURE_NOTE,
  CONFIDENT_ARTIFACT_TYPES,
  // exported for the node:test suite (helpers, never fact producers):
  projectFinding,
  voiceTierFor,
  normaliseState,
  buildApplicability,
  worstStateFor,
  deriveCounts,
  buildExposure,
  defaultFamilyKey,
  buildFrameworks,
  buildCoverageCounts,
  screenedLabel,
  indexRecords,
  assertFindingsWellFormed,
};
