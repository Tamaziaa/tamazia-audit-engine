'use strict';
/**
 * propose.js - the breach PROPOSER (P3 Wave-2a). The ONLY producer of breach CANDIDATES.
 *
 * propose(bundle, catalogue, coverage) -> candidates[]. It compiles the catalogue's prose obligations
 * into DetectionSpecs (detection-spec.js), then evaluates each against the pure EvidenceBundle and the
 * per-rule coverage verdict. A proposer PROPOSES; it NEVER emits a finding (Constitution: propose ->
 * verify -> adjudicate; C-079). Every candidate it emits carries a deterministic artifact (Rule 3): a
 * verbatim quote string-matched to the corpus, a captured browser event, a definitive register-lane
 * fact, or a coverage proof. No artifact, no candidate.
 *
 * ── how each evidence_type routes ────────────────────────────────────────────────────────────────
 *   presence   (REQUIRED content)  -> ABSENCE-breach: the required pattern is ABSENT across the covered,
 *                                     declared surface. Fires only with the coverage interlock proven
 *                                     (record covered, corpus not truncated, >= the min-pages floor,
 *                                     surface readable). Artifact: coverage_proof. confidence: moderate.
 *   absence    (PROHIBITED content)-> PRESENCE-breach: the prohibited pattern is FOUND inside one visible
 *                                     prose sentence that is neither negated (the site's own compliant
 *                                     self-declaration, C-048) nor a customer review (C-090). Artifact:
 *                                     the verbatim quote. confidence: strong.
 *   behavioural                    -> consume bundle.browser.observed (C-039 pre-consent cookie set as a
 *                                     completed observed breach; C-042 broken consent control). Artifact:
 *                                     the captured network/observation event. confidence: strong.
 *   register                       -> consume bundle.registers: a DEFINITIVE no-match note for the
 *                                     record's register (C-004) is a candidate; a present row is
 *                                     compliant (no candidate); a degraded lane suppresses. confidence:
 *                                     weak (a no-match is not proof of non-registration; the adjudicator
 *                                     quarantines it, Rule 6).
 *
 * ── suppression is FIRST-CLASS and VISIBLE (C-029/C-024/C-026/C-037/C-041) ────────────────────────
 * A would-be candidate withheld by an evidence-quality gate is returned as a candidate carrying
 * suppressed_reason and a null artifact, so the abstention is recorded, never silent. A rule whose
 * page-class coverage is 'screened' NEVER proposes (C-029). A clean non-breach (prohibited content
 * simply absent, or required content present, or a matched register row) returns NOTHING - only real
 * breach signals and real evidence-quality abstentions appear in the output.
 *
 * Pure and synchronous over the bundle: no network, no clock, no env. Holds NO law/fine/regulator
 * literal (Rule 2); every word it scans for is compiled from the catalogue argument at runtime.
 */
const spec = require('./detection-spec.js');
const coverageContract = require('../../evidence/crawler/coverage-contract.js');
const { ARTIFACT_TYPES } = require('../artifact-types.js');

// MIN_PAGES_FOR_ABSENCE: the code-clamped floor for any absence claim (C-025: a safety floor lives in
// code and cannot be forced below itself; matches facts/capabilities.js's own MIN_PAGES_FOR_ABSENCE).
const MIN_PAGES_FOR_ABSENCE = 3;

const KIND = Object.freeze({
  PRESENCE_BREACH: 'presence-breach',   // prohibited content FOUND (from an 'absence' obligation)
  ABSENCE_BREACH: 'absence-breach',     // required content MISSING (from a 'presence' obligation)
  BEHAVIOURAL: 'behavioural',
  REGISTER: 'register',
});

// Generic web-behaviour concepts an observed browser event implies (Rule 2 safe: no law/regulator name).
// A behavioural obligation only consumes an observation when the obligation's own tokens intersect the
// concept set for that observation kind, so a non-consent behavioural duty never claims the cookie event.
const OBSERVATION_CONCEPTS = Object.freeze({
  cookie_pre_consent: ['cookie', 'cookies', 'consent', 'tracking', 'tracker', 'marketing', 'analytics'],
  consent_control_broken: ['cookie', 'cookies', 'consent', 'banner', 'preferences'],
});

// ── bundle readers (tolerant; the pure EvidenceBundle shape from facts/README.md) ─────────────────
function pagesOf(bundle) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return pages.filter((p) => p && typeof p.text === 'string');
}
function footerOf(bundle) {
  return bundle && bundle.corpus && typeof bundle.corpus.footerText === 'string' ? bundle.corpus.footerText : '';
}
// truncationState(bundle): the crawler flags a page past the corpus cap (C-024). Read defensively from
// the spots the crawl telemetry may surface it on. Returns a BOOLEAN when truncation is known, or null
// when NO truncation telemetry was surfaced at all: a missing flag is UNKNOWN, never a silent false.
// The crawler always sets bundle.corpus.truncated, so null means the bundle assembler dropped the field.
function truncationState(bundle) {
  if (bundle && bundle.corpus && typeof bundle.corpus.truncated === 'boolean') return bundle.corpus.truncated;
  if (bundle && typeof bundle.truncated === 'boolean') return bundle.truncated;
  if (bundle && bundle.telemetry && typeof bundle.telemetry.truncated === 'boolean') return bundle.telemetry.truncated;
  return null;
}
// isUnreadable(bundle): a bot-walled or SPA-shell bundle carries no readable page (C-038). Nothing is
// ever asserted about content that was not read; propose returns [] on it.
function isUnreadable(bundle) {
  return pagesOf(bundle).length === 0;
}
// isNonEnglishGated(bundle): the facts layer gates a non-English corpus to compliance_unassessed before
// any rule runs (C-022). If the bundle carries that gate, propose asserts nothing.
function isNonEnglishGated(bundle) {
  if (!bundle) return false;
  if (bundle.compliance_unassessed === true) return true;
  const lang = bundle.corpus && bundle.corpus.language;
  return typeof lang === 'string' && lang !== '' && !/^en\b/i.test(lang);
}

// coverageStateFor(coverage, recordId) -> 'covered' | 'screened' | 'unknown'. 'unknown' (the record is
// absent from the coverage report) is treated fail-closed as no-coverage-proof by the absence interlock.
function coverageStateFor(coverage, recordId) {
  const rules = coverage && Array.isArray(coverage.rules) ? coverage.rules : null;
  if (!rules) return 'unknown';
  const row = rules.find((r) => r && r.id === recordId);
  return row ? row.state : 'unknown';
}

// ── surface selection ─────────────────────────────────────────────────────────────────────────────
// pagesOfClass(pages, pageClass) -> the pages whose path classifies to pageClass; all pages for 'any'.
// Uses coverage-contract.classify (anchored path segments, never substrings - C-044), the one door for
// page-class so the surface propose scans matches the surface coverage judged (C-035).
function pagesOfClass(pages, pageClass) {
  if (!pageClass || pageClass === 'any') return pages;
  return pages.filter((p) => coverageContract.classify(p.url) === pageClass);
}
// surfaceTextForPresence(spec, pages, footer) -> the surface text a REQUIRED-content check scans, plus
// the REAL crawled page URLs it covers. The footer is ALWAYS included in the scanned TEXT, never scanned
// exclusively: it is an ADDITIONAL mandatory statutory-disclosure surface (C-034), so a disclosure in
// the body OR the footer counts as present. Scanning the footer alone would read a body disclosure as
// "missing" (the false-positive this fixes). coveredPages carries ONLY real page URLs (never a '(footer)'
// sentinel), because the coverage_proof verifier (breach/verifiers/coverage-proof.js) cross-checks every
// pages_checked entry against bundle.corpus.pages: a sentinel that is not a crawled URL would fail that
// check. The footer is a corpus-wide surface represented by the artifact's own `surface` field, not a
// page. 'raw_html' is unreadable in the stripped bundle; the interlock abstains before reaching here.
function surfaceTextForPresence(detectionSpec, pages, footer) {
  const scoped = pagesOfClass(pages, detectionSpec.page_class);
  const text = scoped.map((p) => p.text).concat(footer ? [footer] : []).join('\n');
  const coveredPages = scoped.map((p) => p.url);
  return { text, coveredPages };
}

// ── pattern matching ───────────────────────────────────────────────────────────────────────────────
// pathHasSegment(url, seg) -> true when the url path contains seg ('/xxx') as a WHOLE segment (anchored,
// never a substring - C-044). matchUrlPath scans every page for the url-path pattern.
function pathHasSegment(url, seg) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); }
  catch (_err) {
    // FAIL-OPEN: a non-URL is matched as a raw path, never crashes the scan.
    path = String(url || '').toLowerCase();
  }
  const norm = ('/' + path.replace(/^\/+/, '')).replace(/\/+$/, '') + '/';
  return norm.includes(seg.toLowerCase() + '/') || norm.includes(seg.toLowerCase() + '-');
}
function matchUrlPath(value, pages) {
  return pages.some((p) => pathHasSegment(p.url, value));
}
// patternMatchesText(pattern, text) -> does a text pattern (anchored-regex or token-set) match `text`.
// Delegates to detection-spec.js's matchesText, the ONE linear-time matcher (a token-set is tested
// token by token, never a co-occurrence mega-regex - Rob P0: the old lookahead form backtracked
// catastrophically on real corpora).
function patternMatchesText(pattern, text) {
  return spec.matchesText(pattern, text);
}
// requiredContentPresent(detectionSpec, surfaceText, pages) -> is ANY pattern satisfied (the lenient
// "present" check for a REQUIRED disclosure: a partial or differently-worded disclosure still counts as
// present, so the absence-breach fires only on total silence - the C-024 false-missing guard).
function requiredContentPresent(detectionSpec, surfaceText, pages) {
  for (const pattern of detectionSpec.patterns) {
    if (pattern.kind === 'url-path') { if (matchUrlPath(pattern.value, pages)) return true; continue; }
    if (patternMatchesText(pattern, surfaceText)) return true;
  }
  return false;
}
// prohibitedHitInSentence(detectionSpec, sentence) -> the first pattern that matches WHOLLY within one
// sentence (a scattered token-set across the page is not a single prohibited claim), or null.
function prohibitedHitInSentence(detectionSpec, sentence) {
  for (const pattern of detectionSpec.patterns) {
    if (pattern.kind === 'url-path') continue;
    if (patternMatchesText(pattern, sentence)) return pattern;
  }
  return null;
}

// findProhibitedQuote(detectionSpec, pages) -> { page_url, quote, guardedOnly }. Scans visible prose
// sentence by sentence; a carrier sentence must be genuine prose (C-089), not negated (C-048) and not a
// customer review (C-090). guardedOnly signals a match existed but every carrier was guarded away (a
// compliant self-declaration), so the abstention can be recorded rather than silent.
function findProhibitedQuote(detectionSpec, pages) {
  let sawGuarded = false;
  for (const page of pages) {
    for (const sentence of spec.splitSentences(page.text)) {
      if (!prohibitedHitInSentence(detectionSpec, sentence)) continue;
      if (spec.isNegated(sentence) || spec.looksLikeReview(sentence)) { sawGuarded = true; continue; }
      if (!spec.isProse(sentence)) continue;
      return { page_url: page.url, quote: sentence, guardedOnly: false };
    }
  }
  return { page_url: null, quote: null, guardedOnly: sawGuarded };
}

// ── candidate builders ─────────────────────────────────────────────────────────────────────────────
// candidate({detectionSpec, kind, artifact, pageUrl, confidence}) -> one proposed candidate. An options
// object (health-gate's <=5 param cap; the P2-proven shape) rather than five positional arguments.
function candidate({ detectionSpec, kind, artifact, pageUrl, confidence }) {
  return {
    record_id: detectionSpec.record_id,
    duty_idx: detectionSpec.duty_idx,
    evidence_type: detectionSpec.evidence_type,
    kind,
    artifact,
    page_url: pageUrl,
    confidence_hint: confidence,
    suppressed_reason: null,
  };
}
function suppressed(detectionSpec, kind, reason) {
  return {
    record_id: detectionSpec.record_id,
    duty_idx: detectionSpec.duty_idx,
    evidence_type: detectionSpec.evidence_type,
    kind,
    artifact: null,
    page_url: null,
    confidence_hint: null,
    suppressed_reason: reason,
  };
}

// ── evaluators (one per evidence_type; each returns a candidate, a suppressed record, or null) ──────

// evalPresenceBreach: an 'absence' obligation (PROHIBITED content). A hit in a clean visible sentence is
// a presence-breach with the verbatim quote as artifact (confidence strong). If every hit was negated /
// a review, record the abstention. No hit -> clean pass (null).
function evalPresenceBreach(detectionSpec, pages) {
  if (!detectionSpec.patterns.length) return null;
  const found = findProhibitedQuote(detectionSpec, pages);
  if (found.quote) {
    const artifact = { type: ARTIFACT_TYPES.QUOTE, text: found.quote, surface: detectionSpec.surface };
    return candidate({ detectionSpec, kind: KIND.PRESENCE_BREACH, artifact, pageUrl: found.page_url, confidence: 'strong' });
  }
  if (found.guardedOnly) return suppressed(detectionSpec, KIND.PRESENCE_BREACH, 'all-matches-negated-or-review (compliant self-declaration or testimonial, C-048/C-090)');
  return null;
}

// absenceInterlock(detectionSpec, bundle, coverageState) -> a suppression reason, or null when the
// coverage interlock is fully satisfied (C-024/C-025/C-026/C-036). Fail-closed: any doubt suppresses.
function absenceInterlock(detectionSpec, bundle, coverageState) {
  if (coverageState !== 'covered') return 'coverage ' + coverageState + ' for this rule; an absence claim needs a proven page-class (C-029)';
  if (detectionSpec.surface === 'raw_html') return 'required mechanism lives in raw HTML, unreadable in the stripped corpus; abstained rather than fabricate a missing-mechanism breach (C-036/C-032)';
  if (detectionSpec.surface === 'footer' && !footerOf(bundle)) return 'no footer surface was captured; a registration-disclosure absence cannot be asserted (C-034)';
  if (pagesOf(bundle).length < MIN_PAGES_FOR_ABSENCE) return 'corpus below the ' + MIN_PAGES_FOR_ABSENCE + '-page floor for an absence claim (C-025)';
  const truncated = truncationState(bundle);
  if (truncated !== false) {
    // A truncated corpus (true) OR unknown truncation (null: the assembler surfaced no telemetry) both
    // demote: an absence claim needs PROOF the corpus was complete, and "truncated:false" must never be
    // emitted on a bundle that never told us its truncation state (ledger decision 2, C-024, Rule 4).
    return truncated === null
      ? 'corpus truncation is UNKNOWN (no telemetry surfaced); an absence claim cannot prove the corpus was complete, so it is demoted (C-024)'
      : 'corpus was truncated; the required content may sit past the cut, so the absence claim is demoted (C-024)';
  }
  return null;
}

// evalAbsenceBreach: a 'presence' obligation (REQUIRED content). If the content is present -> clean pass.
// If absent, the interlock decides: satisfied -> an absence-breach with a coverage_proof artifact
// (confidence moderate); unsatisfied -> a recorded suppression.
function evalAbsenceBreach(detectionSpec, bundle, coverageState) {
  if (!detectionSpec.patterns.length) return null;
  const pages = pagesOf(bundle);
  const surface = surfaceTextForPresence(detectionSpec, pages, footerOf(bundle));
  if (requiredContentPresent(detectionSpec, surface.text, pages)) return null; // present -> no breach
  const block = absenceInterlock(detectionSpec, bundle, coverageState);
  if (block) return suppressed(detectionSpec, KIND.ABSENCE_BREACH, block);
  // tier1_fetched + truncated ride the artifact at emit (D2, ledger decision 2): the coverage_proof
  // verifier re-checks them independently (defence in depth, Rule 3/4). tier1_fetched is TRUE here
  // because absenceInterlock only reaches this point when coverageState==='covered' - the crawler's
  // proof the needed page-class was fetched before any cap (C-026); truncated is read straight off the
  // bundle and is FALSE here because the interlock demotes a truncated corpus above (C-024).
  const artifact = {
    type: ARTIFACT_TYPES.COVERAGE_PROOF,
    page_class: detectionSpec.page_class,
    surface: detectionSpec.surface,
    pages_checked: surface.coveredPages,
    searched_patterns: detectionSpec.patterns.map(patternSummary),
    tier1_fetched: true,
    // Always false here by construction: absenceInterlock above demotes on both a truncated (true) AND an
    // unknown (null) corpus, so this emit is only ever reached with a proven-complete corpus (C-024).
    truncated: false,
  };
  return candidate({ detectionSpec, kind: KIND.ABSENCE_BREACH, artifact, pageUrl: null, confidence: 'moderate' });
}
function patternSummary(pattern) {
  if (pattern.kind === 'token-set') return { kind: pattern.kind, tokens: pattern.value.tokens, mode: pattern.value.mode };
  return { kind: pattern.kind, value: pattern.value };
}

// specTokens(detectionSpec) -> the flat set of lane-routing tokens a behavioural/register spec carries.
function specTokens(detectionSpec) {
  const out = new Set();
  for (const p of detectionSpec.patterns) {
    if (p.kind === 'token-set') for (const t of p.value.tokens) out.add(String(t).toLowerCase());
  }
  return out;
}
// obligationConcerns(detectionSpec, obsKind) -> does this behavioural obligation concern an observation
// of this kind (token intersection with the generic concept set); gates C-039/C-042 to consent duties.
function obligationConcerns(detectionSpec, obsKind) {
  const concepts = OBSERVATION_CONCEPTS[obsKind] || [];
  const tokens = specTokens(detectionSpec);
  return concepts.some((c) => tokens.has(c) || [...tokens].some((t) => t.includes(c)));
}

// laneRan(browser) -> true only when the browser lane definitively ran; laneReason gives the recorded
// non-run reason (C-041: an evidence lane's absence is visible, never silent).
function laneRan(browser) {
  return Boolean(browser && browser.lane && browser.lane.ran === true);
}
function laneReason(browser) {
  return (browser && browser.lane && browser.lane.reason) || 'browser lane did not run';
}
// observedCandidates(detectionSpec, observed) -> a behavioural candidate per observation this obligation
// concerns (C-039: a pre-consent cookie set is a completed observed breach with the event as artifact).
// This is the SINGLE door for every browser observation, INCLUDING a broken consent control (C-042):
// evidence/browser/observe.js pushes a `consent_control_broken` entry into bundle.browser.observed[]
// with its host derived through the tools/lib/safe-fetch.js parsed-host door (never substring-matched),
// so wrapping that entry here as a network_event REUSES the observed-entry shape verbatim and verifies
// unchanged against breach/verifiers/network-event.js (D4, ledger decision 4). There is deliberately no
// second broken-control path off bundle.browser.consentControl: a divergent path would double-count the
// same breach (the summary and observed[] both carry it) and its bespoke shape lacked the host/name
// verifyNetworkEvent matches on, so it could never verify.
// isRelevantObservation(detectionSpec, ev) -> true when ev is a real, kinded event this obligation
// concerns. Named so the 3-term disjunction is not its own "Complex Conditional" inline in the loop.
function isRelevantObservation(detectionSpec, ev) {
  return Boolean(ev) && Boolean(ev.kind) && obligationConcerns(detectionSpec, ev.kind);
}
function observedCandidates(detectionSpec, observed) {
  const out = [];
  for (const ev of (Array.isArray(observed) ? observed : [])) {
    if (!isRelevantObservation(detectionSpec, ev)) continue;
    out.push(candidate({
      // The spread comes BEFORE the discriminator so a stray `ev.type` can never overwrite the canonical
      // network_event type (ledger decision 1: the artifact-type enum is the one door). A clobbered
      // discriminator would quarantine or misroute a genuine observed pre-consent event.
      detectionSpec, kind: KIND.BEHAVIOURAL, artifact: { ...ev, type: ARTIFACT_TYPES.NETWORK_EVENT },
      pageUrl: ev.host || ev.url || null, confidence: 'strong',
    }));
  }
  return out;
}
// evalBehavioural: consume bundle.browser. The lane not running is a recorded suppression (C-041).
function evalBehavioural(detectionSpec, bundle) {
  const browser = bundle && bundle.browser;
  if (!laneRan(browser)) return [suppressed(detectionSpec, KIND.BEHAVIOURAL, 'browser lane unavailable: ' + laneReason(browser) + ' (C-041)')];
  return observedCandidates(detectionSpec, browser.observed);
}

// registerTargetFor(detectionSpec, record, keys) -> the bundle register key this record's register duty
// checks, derived from the record's OWN id/citation/register_url tokens against the bundle's OWN register
// keys (data-driven; no regulator name is authored here - Rule 2), or null when unresolved.
function registerTargetFor(record, keys) {
  const blob = [record && record.id, record && record.regulator && record.regulator.register_url,
    record && record.citation && record.citation.url].filter(Boolean).join(' ').toLowerCase();
  return keys.find((k) => blob.includes(String(k).toLowerCase())) || null;
}
// evalRegister: consume bundle.registers. A present matched row is compliant (no candidate). A DEFINITIVE
// no_match note (C-004) is a weak candidate carrying a `register_absence` artifact (its own artifact
// class, distinct from a register_row which cites a row that is PRESENT - ledger decision 3): the
// register lane RAN and returned no name-match. Any other state (no target resolvable, a degraded/skipped
// lane, no note at all) is a recorded suppression. The candidate is WEAK: a no-match is not proof of
// non-registration (a slightly different registered name can miss the match), so the adjudicator
// quarantines it to needs_review rather than shipping a hard violation (Rule 6).
function registerNotesOf(registers) {
  return Array.isArray(registers.notes) ? registers.notes : [];
}
// allRegisterKeys(registers, notes) -> every register key the bundle knows about (direct rows + note
// entries), deduped. Split out so evalRegister's own decision count stays low.
function allRegisterKeys(registers, notes) {
  const keys = Object.keys(registers).filter((k) => k !== 'notes');
  const noteKeys = notes.map((n) => n && n.register).filter(Boolean);
  return [...new Set([...keys, ...noteKeys])];
}
function noteForRegister(notes, target) {
  return notes.find((n) => n && n.register === target) || null;
}
function noMatchArtifact(target, note) {
  return { type: ARTIFACT_TYPES.REGISTER_ABSENCE, register: target, query: note.query || note.detail || null, lane: 'no_match', note };
}
function evalRegister(detectionSpec, bundle, record) {
  const registers = (bundle && bundle.registers) || {};
  const notes = registerNotesOf(registers);
  const target = registerTargetFor(record, allRegisterKeys(registers, notes));
  if (!target) return suppressed(detectionSpec, KIND.REGISTER, 'no register lane resolvable for this record (unregistered lane / no lookup)');
  if (registers[target]) return null; // a matched row is present -> compliant on this duty
  const note = noteForRegister(notes, target);
  if (note && note.kind === 'no_match') {
    return candidate({ detectionSpec, kind: KIND.REGISTER, artifact: noMatchArtifact(target, note), pageUrl: null, confidence: 'weak' });
  }
  return suppressed(detectionSpec, KIND.REGISTER, 'register "' + target + '" not definitively checked (' + ((note && note.kind) || 'no note') + '); a no-match is required before a non-appearance claim (C-004)');
}

// ── the router ──────────────────────────────────────────────────────────────────────────────────────
function recordsForIndex(catalogue) {
  if (Array.isArray(catalogue)) return catalogue;
  if (catalogue && Array.isArray(catalogue.records)) return catalogue.records;
  return [];
}
function recordIndex(catalogue) {
  const map = new Map();
  for (const r of recordsForIndex(catalogue)) if (r && r.id) map.set(r.id, r);
  return map;
}

// evaluateSpec(detectionSpec, bundle, coverage, record) -> candidate[] for one spec (0..n). Exported for
// unit tests. A page-class-bearing spec whose coverage is 'screened' NEVER proposes (C-029), the hard
// block applied before any evidence is read.
function evaluateSpec(detectionSpec, bundle, coverage, record) {
  const coverageState = coverageStateFor(coverage, detectionSpec.record_id);
  if (detectionSpec.page_class !== null && coverageState === 'screened') {
    return [suppressed(detectionSpec, kindForType(detectionSpec.evidence_type), 'page-class coverage screened; a screened rule never proposes (C-029)')];
  }
  if (detectionSpec.evidence_type === 'absence') return listOf(evalPresenceBreach(detectionSpec, pagesOf(bundle)));
  if (detectionSpec.evidence_type === 'presence') return listOf(evalAbsenceBreach(detectionSpec, bundle, coverageState));
  if (detectionSpec.evidence_type === 'behavioural') return evalBehavioural(detectionSpec, bundle);
  if (detectionSpec.evidence_type === 'register') return listOf(evalRegister(detectionSpec, bundle, record));
  return [];
}
function kindForType(evidenceType) {
  if (evidenceType === 'absence') return KIND.PRESENCE_BREACH;
  if (evidenceType === 'presence') return KIND.ABSENCE_BREACH;
  if (evidenceType === 'behavioural') return KIND.BEHAVIOURAL;
  return KIND.REGISTER;
}
function listOf(x) { return x ? [x] : []; }

// propose(bundle, catalogue, coverage) -> candidates[]. The public entry. Compiles the catalogue to
// DetectionSpecs in memory, then evaluates each. An unreadable (C-038) or non-English-gated (C-022)
// bundle asserts nothing at all.
function propose(bundle, catalogue, coverage) {
  if (isUnreadable(bundle) || isNonEnglishGated(bundle)) return [];
  const { specs, rejected } = spec.compileCatalogue(catalogue);
  // FAIL-CLOSED (Rule 4): a READABLE bundle whose catalogue compiled to ZERO detection specs while
  // REJECTING obligations is a malformed/unavailable catalogue, not a clean site. Returning [] here would
  // be a confident empty result - no breaches proposed because no legal inputs compiled at all - which is
  // exactly the "partial catalogue attached nothing" class (caution.md b107). Throw so the caller records
  // an ERRORED propose stage rather than shipping a clean bill of health for a check that never ran. (A
  // PARTIAL compile - some specs valid, some rejected - is a per-obligation coverage gap for the stage
  // manifest to surface in P4, not a reason to fail the whole mint.)
  if (specs.length === 0 && rejected.length > 0) {
    throw new Error('breach/proposers: catalogue compiled to ZERO detection specs while rejecting '
      + rejected.length + ' obligation(s); a malformed catalogue must not yield a confident empty result: '
      + JSON.stringify(rejected.slice(0, 3)));
  }
  const records = recordIndex(catalogue);
  const out = [];
  for (const detectionSpec of specs) {
    const record = records.get(detectionSpec.record_id) || null;
    for (const c of evaluateSpec(detectionSpec, bundle, coverage, record)) out.push(c);
  }
  return out;
}

module.exports = {
  propose,
  evaluateSpec,
  KIND,
  MIN_PAGES_FOR_ABSENCE,
  // exported for tests + reuse (one door for the matchers)
  requiredContentPresent,
  findProhibitedQuote,
  registerTargetFor,
  coverageStateFor,
  absenceInterlock,
};
