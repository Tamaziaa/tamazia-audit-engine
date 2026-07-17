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
// isTruncated(bundle): the crawler flags a page past the corpus cap (C-024). Read defensively from the
// spots the crawl telemetry may surface it on; a missing flag is treated as NOT truncated, and that
// dependency on the bundle assembler propagating truncation is flagged honestly to the caller.
function isTruncated(bundle) {
  if (!bundle) return false;
  if (bundle.corpus && typeof bundle.corpus.truncated === 'boolean') return bundle.corpus.truncated;
  if (typeof bundle.truncated === 'boolean') return bundle.truncated;
  return Boolean(bundle.telemetry && bundle.telemetry.truncated);
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
// the pages it covers. The footer is ALWAYS included, never scanned exclusively: it is an ADDITIONAL
// mandatory statutory-disclosure surface (C-034), so a disclosure in the body OR the footer counts as
// present. Scanning the footer alone would read a body disclosure as "missing" (the false-positive this
// fixes). 'raw_html' is unreadable in the stripped bundle; the interlock abstains before reaching here.
function surfaceTextForPresence(detectionSpec, pages, footer) {
  const scoped = pagesOfClass(pages, detectionSpec.page_class);
  const text = scoped.map((p) => p.text).concat(footer ? [footer] : []).join('\n');
  const coveredPages = scoped.map((p) => p.url).concat(footer ? ['(footer)'] : []);
  return { text, coveredPages };
}

// ── pattern matching ───────────────────────────────────────────────────────────────────────────────
// pathHasSegment(url, seg) -> true when the url path contains seg ('/xxx') as a WHOLE segment (anchored,
// never a substring - C-044). matchUrlPath scans every page for the url-path pattern.
function pathHasSegment(url, seg) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); }
  catch (_err) { path = String(url || '').toLowerCase(); } // FAIL-OPEN: a non-URL is matched as a raw path, never crashes the scan
  const norm = ('/' + path.replace(/^\/+/, '')).replace(/\/+$/, '') + '/';
  return norm.includes(seg.toLowerCase() + '/') || norm.includes(seg.toLowerCase() + '-');
}
function matchUrlPath(value, pages) {
  return pages.some((p) => pathHasSegment(p.url, value));
}
// patternMatchesText(pattern, text) -> does a text pattern (anchored-regex or token-set) match `text`.
function patternMatchesText(pattern, text) {
  const re = spec.compileRegex(pattern);
  return re ? re.test(text) : false;
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
function candidate(detectionSpec, kind, artifact, pageUrl, confidence) {
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
    const artifact = { type: 'quote', text: found.quote, surface: detectionSpec.surface };
    return candidate(detectionSpec, KIND.PRESENCE_BREACH, artifact, found.page_url, 'strong');
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
  if (isTruncated(bundle)) return 'corpus was truncated; the required content may sit past the cut, so the absence claim is demoted (C-024)';
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
  const artifact = {
    type: 'coverage_proof',
    page_class: detectionSpec.page_class,
    surface: detectionSpec.surface,
    pages_checked: surface.coveredPages,
    searched_patterns: detectionSpec.patterns.map(patternSummary),
  };
  return candidate(detectionSpec, KIND.ABSENCE_BREACH, artifact, null, 'moderate');
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
function observedCandidates(detectionSpec, observed) {
  const out = [];
  for (const ev of (Array.isArray(observed) ? observed : [])) {
    if (!ev || !ev.kind || !obligationConcerns(detectionSpec, ev.kind)) continue;
    out.push(candidate(detectionSpec, KIND.BEHAVIOURAL, { type: 'network_event', ...ev }, ev.host || ev.url || null, 'strong'));
  }
  return out;
}
// brokenControlCandidate(detectionSpec, cc) -> a behavioural candidate when a found consent control is
// unhealthy on a consent-concerned obligation (C-042: a broken control is itself a finding class), else null.
function brokenControlCandidate(detectionSpec, cc) {
  if (!cc || cc.found !== true || cc.healthy !== false) return null;
  if (!obligationConcerns(detectionSpec, 'consent_control_broken')) return null;
  const artifact = { type: 'network_event', kind: 'consent_control_broken', url: cc.url || null, healthy: false };
  return candidate(detectionSpec, KIND.BEHAVIOURAL, artifact, cc.url || null, 'strong');
}
// evalBehavioural: consume bundle.browser. The lane not running is a recorded suppression (C-041).
function evalBehavioural(detectionSpec, bundle) {
  const browser = bundle && bundle.browser;
  if (!laneRan(browser)) return [suppressed(detectionSpec, KIND.BEHAVIOURAL, 'browser lane unavailable: ' + laneReason(browser) + ' (C-041)')];
  const out = observedCandidates(detectionSpec, browser.observed);
  const broken = brokenControlCandidate(detectionSpec, browser.consentControl);
  if (broken) out.push(broken);
  return out;
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
// no_match note (C-004) is a weak candidate carrying that note as its register_row artifact. Any other
// state (no target resolvable, a degraded/skipped lane, no note at all) is a recorded suppression.
function evalRegister(detectionSpec, bundle, record) {
  const registers = (bundle && bundle.registers) || {};
  const keys = Object.keys(registers).filter((k) => k !== 'notes');
  const notes = Array.isArray(registers.notes) ? registers.notes : [];
  const noteKeys = notes.map((n) => n && n.register).filter(Boolean);
  const target = registerTargetFor(record, [...new Set([...keys, ...noteKeys])]);
  if (!target) return suppressed(detectionSpec, KIND.REGISTER, 'no register lane resolvable for this record (unregistered lane / no lookup)');
  if (registers[target]) return null; // a matched row is present -> compliant on this duty
  const note = notes.find((n) => n && n.register === target);
  if (note && note.kind === 'no_match') {
    return candidate(detectionSpec, KIND.REGISTER, { type: 'register_row', present: false, register: target, lane: 'no_match', note }, null, 'weak');
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
  const { specs } = spec.compileCatalogue(catalogue);
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
