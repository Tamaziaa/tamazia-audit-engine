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
// MEDIUM-15 FIX: cookie_pre_consent used to include 'marketing'/'analytics', so ANY behavioural
// obligation whose own prose merely mentioned marketing or analytics (a wholly unrelated duty) could
// claim a pre-consent-cookie observation as its artifact - the wrong law bound to a real event. Narrowed
// to cookie/tracker/consent terms; obligationConcerns additionally requires a distinctive 'cookie' token
// before this concept ever binds (see obligationConcerns below), so 'consent' alone is not enough either.
const OBSERVATION_CONCEPTS = Object.freeze({
  cookie_pre_consent: ['cookie', 'cookies', 'tracker', 'trackers', 'tracking', 'consent'],
  consent_control_broken: ['cookie', 'cookies', 'consent', 'banner', 'preferences'],
});

// DOM_NODE_CONCEPTS (T2a) - the dom_node analogue of OBSERVATION_CONCEPTS. OBSERVATION_CONCEPTS keys by
// the network-event observation KIND; the axe-style DOM lane instead maps each dom-assert rule_id to a
// generic web-behaviour CONCEPT (below), then routes a failing DOM node to a behavioural obligation only
// when the obligation's own tokens concern that concept. A SEPARATE constant, not an OBSERVATION_CONCEPTS
// entry, because the two lanes key on different axes (observation-kind vs check-rule-id). Rule 2 safe: no
// law/regulator name. consent_control + chatbot_disclosure carry no rule_id yet (no dom-assert check emits
// them); they are kept so the lane is GENERIC and those families activate the moment a rule maps to them.
const DOM_NODE_CONCEPTS = Object.freeze({
  accessibility: ['accessible', 'accessibility', 'wcag', 'disability', 'impairment', 'screen', 'reader', 'alt'],
  consent_control: ['consent', 'cookie', 'banner', 'preferences', 'withdraw'],
  insecure_form: ['secure', 'security', 'encryption', 'transport'],
  pre_ticked_consent: ['consent', 'pre-ticked', 'opt-in', 'checkbox', 'marketing'],
  chatbot_disclosure: ['chatbot', 'ai', 'automated', 'bot', 'disclosure'],
});
// DOM_RULE_TO_CONCEPT - the one door mapping a dom-assert rule_id to the obligation-concept a failing node
// of that rule can prove (frozen). The six accessibility checks -> accessibility; insecure-form and
// pre-ticked-consent to their own concepts. A rule_id absent here proposes nothing (fail-closed routing).
const DOM_RULE_TO_CONCEPT = Object.freeze({
  'image-alt': 'accessibility',
  'label': 'accessibility',
  'html-has-lang': 'accessibility',
  'link-name': 'accessibility',
  'button-name': 'accessibility',
  'color-contrast': 'accessibility',
  'insecure-form': 'insecure_form',
  'pre-ticked-consent': 'pre_ticked_consent',
});

// ── bundle readers (tolerant; the pure EvidenceBundle shape from facts/README.md) ─────────────────
function pagesOf(bundle) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return pages.filter((p) => p && typeof p.text === 'string');
}
function footerOf(bundle) {
  return bundle && bundle.corpus && typeof bundle.corpus.footerText === 'string' ? bundle.corpus.footerText : '';
}
// truncatedFlagFrom(container): the boolean `truncated` field read off ONE candidate container, or
// undefined when that container is absent or does not carry a real boolean there (undefined is the
// not-found sentinel, distinct from a legitimate `false`). Split out so truncationState reads as a
// flat "try each spot in order" list rather than three independent nested guards (the health-gate
// Complex Method cap).
function truncatedFlagFrom(container) {
  return container && typeof container.truncated === 'boolean' ? container.truncated : undefined;
}
// truncationState(bundle): the crawler flags a page past the corpus cap (C-024). Read defensively from
// the spots the crawl telemetry may surface it on, tried in order, first found wins. Returns a BOOLEAN
// when truncation is known, or null when NO truncation telemetry was surfaced at all: a missing flag is
// UNKNOWN, never a silent false. The crawler always sets bundle.corpus.truncated, so null means the
// bundle assembler dropped the field.
function truncationState(bundle) {
  if (!bundle) return null;
  const fromCorpus = truncatedFlagFrom(bundle.corpus);
  if (fromCorpus !== undefined) return fromCorpus;
  const fromBundle = truncatedFlagFrom(bundle);
  if (fromBundle !== undefined) return fromBundle;
  const fromTelemetry = truncatedFlagFrom(bundle.telemetry);
  if (fromTelemetry !== undefined) return fromTelemetry;
  return null;
}
// isUnreadable(bundle): a bot-walled or SPA-shell bundle carries no readable page (C-038). Nothing is
// ever asserted about content that was not read; propose returns [] on it.
function isUnreadable(bundle) {
  return pagesOf(bundle).length === 0;
}
// isNonEnglishGated(bundle): the facts layer gates a non-English corpus to compliance_unassessed before
// any rule runs (C-022). If the bundle carries that gate, propose asserts nothing.
// HIGH-9 FIX: the old `/^en\b/i` test required a NON-WORD character right after "en", so 'English'
// (next char 'g', a word char) and 'en_US' (next char '_', a word char under \b's definition) both
// FAILED the test and were wrongly gated - silently zeroing an entire English audit. 'en-GB' happened
// to pass only because '-' is a non-word char. Fixed to accept the literal word "english" or any "en"
// tag followed by a hyphen/underscore separator or end-of-string (en, en-GB, en_US, en-us all pass).
function isNonEnglishGated(bundle) {
  if (!bundle) return false;
  if (bundle.compliance_unassessed === true) return true;
  const lang = bundle.corpus && bundle.corpus.language;
  if (typeof lang !== 'string' || lang.trim() === '') return false;
  const l = lang.trim().toLowerCase();
  return !(l === 'english' || /^en([-_]|$)/.test(l));
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
// pathHasSegment(url, seg) -> true when the url path contains seg as a WHOLE WORD TOKEN (anchored, never
// a substring - C-044). matchUrlPath scans every page for the url-path pattern.
// HIGH-5 FIX: the old `norm.includes(seg+'/') || norm.includes(seg+'-')` substring check missed a
// concatenated/underscore slug (/complaints_policy - '_' satisfied neither '/' nor '-') so a real
// disclosure at that path was judged ABSENT and could fire a fabricated "missing complaints procedure"
// absence-breach. Fixed to tokenise the whole path on any non-alphanumeric run and require the target
// segment to appear as one of those tokens (whole-token membership, never a substring test).
function pathHasSegment(url, seg) {
  let path;
  try { path = new URL(url).pathname; }
  catch (_err) {
    // FAIL-OPEN: a non-URL is matched as a raw path, never crashes the scan.
    path = String(url || '');
  }
  const tokens = path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes(String(seg).replace(/^\/+/, '').toLowerCase());
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
// patternSatisfiesPresence(pattern, surfaceText, pages) -> does this ONE pattern count as "present": a
// url-path pattern checks page paths, every other kind checks the surface text. Split out so the loop
// below is a plain existence check, not a nested if-with-continue (the health-gate Deep Nesting cap).
function patternSatisfiesPresence(pattern, surfaceText, pages) {
  if (pattern.kind === 'url-path') return matchUrlPath(pattern.value, pages);
  return patternMatchesText(pattern, surfaceText);
}
// requiredContentPresent(detectionSpec, surfaceText, pages) -> is ANY pattern satisfied (the lenient
// "present" check for a REQUIRED disclosure: a partial or differently-worded disclosure still counts as
// present, so the absence-breach fires only on total silence - the C-024 false-missing guard).
function requiredContentPresent(detectionSpec, surfaceText, pages) {
  return detectionSpec.patterns.some((pattern) => patternSatisfiesPresence(pattern, surfaceText, pages));
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

// CLAUSE_SPLIT_RX / splitClauses(sentence) -> HIGH-7: the negation/review guard used to run over the
// WHOLE carrier sentence, so a negation three clauses away from the actual hit ("We never charge admin
// fees, and your returns are guaranteed.") demoted a real violation to a suppression. splitClauses
// breaks a sentence on [,;-—–] and coordinating conjunctions (and/but/or), giving
// sentenceVerdict a clause-scoped unit to test the guard against, independent of the whole-sentence test
// still used to detect a guard living in a DIFFERENT clause (below).
const CLAUSE_SPLIT_RX = /[,;—–-]|\b(?:and|but|or)\b/i;
function splitClauses(sentence) {
  return String(sentence || '').split(CLAUSE_SPLIT_RX).map((c) => c.trim()).filter(Boolean);
}
// clauseContainingHit(sentence, hit) -> the single clause of `sentence` that carries the winning
// pattern, or the whole sentence when there is only one clause or no single clause carries the pattern
// (a token-set scattered across clauses is treated conservatively as one unit).
function clauseContainingHit(sentence, hit) {
  const clauses = splitClauses(sentence);
  if (clauses.length <= 1) return sentence;
  return clauses.find((c) => patternMatchesText(hit, c)) || sentence;
}

// sentenceVerdict(detectionSpec, sentence) -> 'hit' | 'needs_human' | 'guarded' | 'nonprose' | 'skip'.
// Named so the per-sentence scan below is a single dispatch rather than several inline nested ifs (the
// health-gate Deep Nesting cap).
// THE NEGATION/REVIEW GUARD IS UNCONDITIONAL (C-048/C-060/C-090): a compliant self-declaration ("we do
// NOT charge admin fees", "we do not offer guarantees") or a customer testimonial is guarded away for
// EVERY prohibition pattern, curated or derived - the false-accusation direction is never relaxed. HIGH-7
// FIX: the guard is now CLAUSE-SCOPED - it fires 'guarded' only when the negation/review marker sits in
// the SAME clause as the hit. When the marker sits in a DIFFERENT clause of the same sentence, the
// candidate is neither confidently a hit nor safely suppressed, so it is downgraded to 'needs_human'
// (propose.js still FIRES a candidate, carrying the quote, at reduced 'weak' confidence - never a silent
// suppression of a real violation, C-037).
// THE isProse GATE IS SKIPPED FOR A CURATED PROHIBITED-PHRASE PATTERN (prose_exempt): a real violation
// lives in a Title-Case hero heading or a short CTA ("Book your Botox treatment", "Guaranteed Results"),
// exactly the strings isProse rejects (>=25 chars, >=4 words, <=70% Title-Case - hidden-defects.md RANK 2).
// The curated phrase is itself the precision guarantee, so the heading it sits in IS admissible evidence;
// a bare law-prose-derived pattern (not prose_exempt) still needs genuine prose so it never quotes a nav
// run as evidence (C-089). HIGH-8 FIX: failing that prose gate used to `return 'skip'`, recording nothing
// (unlike 'guarded', which records an abstention) - a silent suppression violating "suppression is
// first-class and visible". It is now its own 'nonprose' verdict so the abstention can be recorded.
function sentenceVerdict(detectionSpec, sentence) {
  const hit = prohibitedHitInSentence(detectionSpec, sentence);
  if (!hit) return 'skip';
  const carrierClause = clauseContainingHit(sentence, hit);
  if (spec.isNegated(carrierClause) || spec.looksLikeReview(carrierClause)) return 'guarded';
  if (spec.isNegated(sentence) || spec.looksLikeReview(sentence)) return 'needs_human';
  if (!hit.prose_exempt && !spec.isProse(sentence)) return 'nonprose';
  return 'hit';
}
// findProhibitedQuoteOnPage(detectionSpec, page) -> { quote, guarded, needsHuman, sawNonProse } for ONE
// page: the first confidently-hitting sentence (guarded:false, needsHuman:false) wins outright; absent
// that, the first needs_human sentence (a cross-clause guard) is kept as a fallback FIRED quote at
// reduced confidence; guarded/nonprose are recorded as flags for the caller's suppression reasons.
function findProhibitedQuoteOnPage(detectionSpec, page) {
  let guarded = false;
  let sawNonProse = false;
  let needsHuman = null;
  for (const sentence of spec.splitSentences(page.text)) {
    const verdict = sentenceVerdict(detectionSpec, sentence);
    if (verdict === 'hit') return { quote: sentence, guarded: false, needsHuman: false, sawNonProse: false };
    if (verdict === 'guarded') guarded = true;
    else if (verdict === 'nonprose') sawNonProse = true;
    else if (verdict === 'needs_human' && !needsHuman) needsHuman = sentence;
  }
  if (needsHuman) return { quote: needsHuman, guarded: false, needsHuman: true, sawNonProse: false };
  return { quote: null, guarded, needsHuman: false, sawNonProse };
}
// findProhibitedQuote(detectionSpec, pages) -> { page_url, quote, guardedOnly, needsHuman, sawNonProse }.
// Scans visible prose sentence by sentence; a carrier sentence must be genuine prose (C-089), not negated
// in its own clause (C-048) and not a customer review (C-090). guardedOnly signals a match existed but
// every carrier was guarded away (a compliant self-declaration); sawNonProse signals a match existed only
// in a non-quotable nav/heading carrier (HIGH-8) - both abstentions are recorded, never silent (C-037).
function findProhibitedQuote(detectionSpec, pages) {
  let sawGuarded = false;
  let sawNonProse = false;
  let needsHumanFound = null;
  for (const page of pages) {
    const found = findProhibitedQuoteOnPage(detectionSpec, page);
    if (found.quote && !found.needsHuman) return { page_url: page.url, quote: found.quote, guardedOnly: false, needsHuman: false, sawNonProse: false };
    if (found.quote && found.needsHuman && !needsHumanFound) needsHumanFound = { page_url: page.url, quote: found.quote };
    if (found.guarded) sawGuarded = true;
    if (found.sawNonProse) sawNonProse = true;
  }
  if (needsHumanFound) return { page_url: needsHumanFound.page_url, quote: needsHumanFound.quote, guardedOnly: false, needsHuman: true, sawNonProse: false };
  return { page_url: null, quote: null, guardedOnly: sawGuarded, needsHuman: false, sawNonProse };
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
// A1 POLARITY SCOPING (C-238): the verbatim prohibited quote is self-sufficient Rule 3 evidence, valid
// regardless of corpus size or truncation (a cut only removes text, never invents a claim). This path
// DELIBERATELY never consults absenceInterlock - neither the MIN_PAGES_FOR_ABSENCE floor nor the C-024
// truncation guard gates a presence-breach; those protect the OPPOSITE polarity (evalAbsenceBreach,
// C-024/C-025/C-026) and stay untouched. Do not add a corpus-size/truncation guard here.
function evalPresenceBreach(detectionSpec, pages) {
  // MEDIUM-14 FIX: a record whose prose compiled to zero patterns used to `return null`, indistinguishable
  // from a genuine compliant clean pass. It is now a recorded suppression - the coverage gap is visible.
  if (!detectionSpec.patterns.length) return suppressed(detectionSpec, KIND.PRESENCE_BREACH, 'no detection patterns compiled for this obligation');
  const found = findProhibitedQuote(detectionSpec, pages);
  if (found.quote) {
    const artifact = { type: ARTIFACT_TYPES.QUOTE, text: found.quote, surface: detectionSpec.surface };
    // HIGH-7: a cross-clause negation/review guard fires the candidate at reduced ('weak') confidence
    // rather than silently suppressing it - a real violation is never dropped for an unrelated clause.
    const confidence = found.needsHuman ? 'weak' : 'strong';
    return candidate({ detectionSpec, kind: KIND.PRESENCE_BREACH, artifact, pageUrl: found.page_url, confidence });
  }
  if (found.guardedOnly) return suppressed(detectionSpec, KIND.PRESENCE_BREACH, 'all-matches-negated-or-review (compliant self-declaration or testimonial, C-048/C-090)');
  // HIGH-8 FIX: a match that only ever appeared in a non-prose carrier (nav/heading run) used to vanish
  // via a bare 'skip' with nothing recorded; now the abstention is visible.
  if (found.sawNonProse) return suppressed(detectionSpec, KIND.PRESENCE_BREACH, 'match found only in a non-prose carrier (nav/heading run); not admissible quotable evidence (C-089)');
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
  // MEDIUM-14 FIX: see evalPresenceBreach's identical fix - a zero-pattern spec is now a recorded
  // suppression, never a clean pass indistinguishable from real compliance.
  if (!detectionSpec.patterns.length) return suppressed(detectionSpec, KIND.ABSENCE_BREACH, 'no detection patterns compiled for this obligation');
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

// tokensOf(pattern) -> the lowercase token list a token-set pattern carries, or [] for any other kind.
// Split out so specTokens holds no nested if-inside-for (the health-gate Deep Nesting cap).
function tokensOf(pattern) {
  if (pattern.kind !== 'token-set') return [];
  return pattern.value.tokens.map((t) => String(t).toLowerCase());
}
// specTokens(detectionSpec) -> the flat set of lane-routing tokens a behavioural/register spec carries.
function specTokens(detectionSpec) {
  const out = new Set();
  for (const p of detectionSpec.patterns) for (const t of tokensOf(p)) out.add(t);
  return out;
}
// KNOWN_CONCEPT_WORDS: every word literally authored in OBSERVATION_CONCEPTS/DOM_NODE_CONCEPTS (a small,
// closed, hand-authored vocabulary - Rule 2 safe, no law/regulator name). singularise (below) uses this
// as its O5 safety fence: stripping a token's trailing 's' is worthless unless it lands on a WORD THIS
// FILE ACTUALLY KNOWS ABOUT, so it can never be used to test two arbitrary unrelated tokens for equality.
const KNOWN_CONCEPT_WORDS = new Set(
  [...Object.values(OBSERVATION_CONCEPTS), ...Object.values(DOM_NODE_CONCEPTS)].flat().map((w) => String(w).toLowerCase())
);
// singularise(token) -> the token with a single trailing regular-plural 's' removed, for a SAFE
// whole-token morphological match (cookie<->cookies, tracker<->trackers, disclosure<->disclosures).
// Guard-claused so it can NEVER unify two distinct stems the way a substring match did: a trailing
// 'ss' ('access', 'address') is preserved (not a plural), and a token of <=4 chars is returned
// verbatim so a short concept token ('alt', 'wcag', 'bot') only ever matches EXACTLY. This strips at
// most one character, so the result always shares the token's full stem: 'health' can never collapse
// onto 'alt' (C-059: the "post"->postcode / "health".includes("alt") substring class is unrepresentable).
// O5 FIX: the strip used to fire unconditionally, so an unrelated word ending in a bare 's' could
// collapse onto a totally different stem ('alias'->'alia'; a stray 4-char'ish word like 'news' happened
// to dodge it only via the <=4 floor, not by design). It now strips ONLY when the resulting stem is
// itself a word this file's concept vocabulary actually knows (KNOWN_CONCEPT_WORDS) - so stripping can
// only ever HELP a real cookie/tracker/reader-class plural match a concept, never manufacture a false
// unification between two words neither of which the stripped form recognises.
function singularise(token) {
  const s = String(token).toLowerCase();
  if (s.length <= 4) return s;
  if (s.endsWith('ss') || !s.endsWith('s')) return s;
  const stem = s.slice(0, -1);
  return KNOWN_CONCEPT_WORDS.has(stem) ? stem : s;
}
// tokenMatchesConcept(t, c) -> does obligation token `t` match concept token `c` as a WHOLE TOKEN:
// exact equality, or equal after stripping one regular-plural 's' from each. NEVER an infix/substring
// containment (C-059: word-boundary anchored, substring matching against a rule pattern string is banned;
// the "health".includes("alt")==true false accusation of US_FTC_HBNR, healthcare-us.md defect B).
function tokenMatchesConcept(t, c) {
  if (t === c) return true;
  return singularise(t) === singularise(c);
}
// tokensIntersectConcepts(tokens, conceptTokens) -> does the obligation's token SET intersect a concept's
// generic token list, matched WHOLE TOKEN to WHOLE TOKEN (never by substring containment). The ONE
// token-intersection door, reused by the network-observation router (obligationConcerns) and the dom_node
// router (obligationConcernsDom) so the two lanes share one rule. A plural obligation token still concerns
// its singular concept ('cookies' -> 'cookie') via singularise, but no token ever matches a concept it
// merely CONTAINS as a substring - so 'health' never routes a DOM node to an accessibility 'alt' concept.
function tokensIntersectConcepts(tokens, conceptTokens) {
  return (conceptTokens || []).some((c) => [...tokens].some((t) => tokenMatchesConcept(t, c)));
}
// obligationConcerns(detectionSpec, obsKind) -> does this behavioural obligation concern an observation
// of this kind (token intersection with the generic concept set); gates C-039/C-042 to consent duties.
// MEDIUM-15 FIX: cookie_pre_consent additionally requires a DISTINCTIVE 'cookie'/'cookies' token in the
// obligation's own words, so a duty whose tokens only intersect on 'consent'/'tracking' (a broader,
// non-cookie-specific behavioural obligation) never claims a pre-consent-cookie observation as its
// artifact - the wrong-law-bound-to-a-real-event class this finding flagged.
function obligationConcerns(detectionSpec, obsKind) {
  const tokens = specTokens(detectionSpec);
  if (!tokensIntersectConcepts(tokens, OBSERVATION_CONCEPTS[obsKind] || [])) return false;
  if (obsKind === 'cookie_pre_consent') return tokensIntersectConcepts(tokens, ['cookie', 'cookies']);
  return true;
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

// ── dom_node lane (T2a): a failing DOM node the axe-style lane (evidence/browser/dom-assert.js) observed
// as a VIOLATION is an observed breach for a behavioural obligation whose tokens concern the node's concept
// (accessibility, insecure form, pre-ticked consent, ...). A state 'incomplete' node is needs-review and
// NEVER becomes a candidate (Rule 10). The DOM lane not running is a recorded suppression (C-041), exactly
// as evalBehavioural records the PECR lane's absence. ─────────────────────────────────────────────────
function domLaneRan(browser) {
  return Boolean(browser && browser.domLane && browser.domLane.ran === true);
}
function domLaneReason(browser) {
  return (browser && browser.domLane && browser.domLane.reason) || 'dom lane did not run';
}
// obligationConcernsDom(detectionSpec, concept) -> does this behavioural obligation concern a dom concept
// (the same token-intersection door the network lane uses, keyed on DOM_NODE_CONCEPTS).
function obligationConcernsDom(detectionSpec, concept) {
  return tokensIntersectConcepts(specTokens(detectionSpec), DOM_NODE_CONCEPTS[concept] || []);
}
// isDomViolationForObligation(detectionSpec, node) -> true when node is a real VIOLATION whose rule maps to
// a concept this obligation concerns. Named so domNodeCandidates' loop is a plain existence check, never a
// nested if-with-continue (the health-gate Deep Nesting cap).
function isDomViolationForObligation(detectionSpec, node) {
  if (!node || node.state !== 'violation') return false;
  const concept = DOM_RULE_TO_CONCEPT[node.rule_id];
  return Boolean(concept) && obligationConcernsDom(detectionSpec, concept);
}
// domNodeCandidates(detectionSpec, domNodes) -> a candidate per observed DOM violation this obligation
// concerns, carrying the node as its dom_node artifact. The spread precedes the discriminator so a stray
// node.type can never overwrite the canonical dom_node type (ledger decision 1: the artifact-type enum is
// the one door). The candidate shape is candidate()'s, identical to every other observed-lane candidate.
// W6: a RISK-tier node (insecure-form, pre-ticked-consent) STILL becomes a candidate here exactly like a
// deterministic one - the finding tier is a downstream routing concern, not a proposal filter. The `tier`
// the DOM lane stamped (evidence/browser/dom-assert.js) rides straight onto the artifact through the
// `...node` spread, so the adjudicator's evidence-kind classifier can route a confirmed risk node to
// needs-review rather than a hard violation. The risk tier must never fall through to nothing here: an
// under-reported insecure form is the opposite (silent) error to the false accusation W6 fixes.
function domNodeCandidates(detectionSpec, domNodes) {
  const out = [];
  for (const node of (Array.isArray(domNodes) ? domNodes : [])) {
    if (!isDomViolationForObligation(detectionSpec, node)) continue;
    out.push(candidate({
      detectionSpec, kind: KIND.BEHAVIOURAL, artifact: { ...node, type: ARTIFACT_TYPES.DOM_NODE },
      pageUrl: node.page_url || null, confidence: 'strong',
    }));
  }
  return out;
}
// evalDomNode(detectionSpec, bundle) -> dom_node candidates, or a recorded suppression when the DOM lane
// did not run (C-041: an un-run lane cannot silently back-fill nor silently vanish).
function evalDomNode(detectionSpec, bundle) {
  const browser = bundle && bundle.browser;
  if (!domLaneRan(browser)) return [suppressed(detectionSpec, KIND.BEHAVIOURAL, 'dom lane unavailable: ' + domLaneReason(browser) + ' (C-041)')];
  return domNodeCandidates(detectionSpec, browser.domNodes);
}
// hasDomEvidence(bundle) -> the bundle actually carries the DOM lane's evidence surface (domNodes[] or a
// domLane record). The dom_node path only runs when the DOM lane was ENGAGED for this bundle, so a bundle
// that never invoked it (the register/PECR-only bundles the existing suite uses) proposes exactly as
// before - no dom suppression is fabricated for a lane the bundle never ran (the optional-lane pattern,
// mirroring how a non-register obligation never emits a register suppression). This keeps every existing
// propose path byte-identical.
function hasDomEvidence(bundle) {
  const browser = bundle && bundle.browser;
  return Boolean(browser) && (Array.isArray(browser.domNodes) || (Boolean(browser.domLane) && typeof browser.domLane === 'object'));
}
// behaviouralCandidates(detectionSpec, bundle) -> the network-observation candidates PLUS, when the DOM
// lane was engaged for this bundle, the dom_node candidates. Two independent observation lanes feed one
// behavioural obligation; each reports its own availability (C-041).
function behaviouralCandidates(detectionSpec, bundle) {
  const out = evalBehavioural(detectionSpec, bundle);
  if (hasDomEvidence(bundle)) for (const c of evalDomNode(detectionSpec, bundle)) out.push(c);
  return out;
}

// urlTokens(urlStr) -> the lowercase alphanumeric tokens of a URL's host + path (never its query string,
// which can carry arbitrary third-party text). Falls back to tokenising the raw string when it does not
// parse as a URL, so a bare host-like value still tokenises rather than being silently dropped.
function urlTokens(urlStr) {
  try {
    const u = new URL(String(urlStr));
    return (u.hostname + '/' + u.pathname).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  } catch (_err) {
    // FAIL-OPEN: a non-URL value is tokenised as a raw string rather than crashing the scan; this is a
    // pure data-derivation helper with no security/finding decision riding on the parse outcome.
    return String(urlStr || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }
}
// recordIdTokens(id) -> the lowercase alphanumeric tokens of a catalogue record id.
function recordIdTokens(id) {
  return String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
// registerTargetFor(detectionSpec, record, keys) -> the bundle register key this record's register duty
// checks, derived from the record's OWN id/citation/register_url tokens against the bundle's OWN register
// keys (data-driven; no regulator name is authored here - Rule 2), or null when unresolved.
// MEDIUM-11 FIX (C-059's own substring-match class, ironically resurrected here): `blob.includes(key)`
// matched a key that was merely a SUBSTRING of an unrelated word - 'asa' inside 'asbestos', 'ico' inside
// 'silicon' - routing a record to the wrong register lane entirely. Now matched WHOLE TOKEN against the
// register/citation URL's host+path tokens and the record id's own tokens - never a substring test.
function registerTargetFor(record, keys) {
  const urls = [record && record.regulator && record.regulator.register_url, record && record.citation && record.citation.url].filter(Boolean);
  const tokenSet = new Set([...urls.flatMap(urlTokens), ...recordIdTokens(record && record.id)]);
  return keys.find((k) => tokenSet.has(String(k).toLowerCase())) || null;
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
// registerNoMatchOutcome(detectionSpec, target, note) -> a weak register_absence candidate when the lane
// definitively RAN and returned no name-match (note.kind === 'no_match'), else a recorded suppression
// (a no-match is required before any non-appearance claim, C-004). Split out so evalRegister carries no
// note-classification branch of its own (the Complex Method cap).
function registerNoMatchOutcome(detectionSpec, target, note) {
  if (note && note.kind === 'no_match') {
    return candidate({ detectionSpec, kind: KIND.REGISTER, artifact: noMatchArtifact(target, note), pageUrl: null, confidence: 'weak' });
  }
  return suppressed(detectionSpec, KIND.REGISTER, 'register "' + target + '" not definitively checked (' + ((note && note.kind) || 'no note') + '); a no-match is required before a non-appearance claim (C-004)');
}
// isMatchedRegisterRow(row) -> true only for a genuine matched-entity row shape: a non-array object
// carrying at least one non-empty *_name (or bare 'name') string field (company_name, provider_name,
// firm_name, entity_name, organisation_name, name, ...: the field every real register lookup in
// evidence/registers/ actually returns for a matched candidate).
// HIGH-10 FIX: `if (registers[target])` treated ANY truthy value as a compliant matched row, including a
// degraded-lane placeholder object (e.g. `{error:'timeout'}`) that carries no entity at all - a clean
// pass with no suppression, silently missing a real non-registration. Anything that is not a genuine
// matched-row shape now falls through to registerNoMatchOutcome, which requires a definitive no_match
// note before any non-appearance claim (else it suppresses, visibly, per C-004).
function isMatchedRegisterRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return Object.keys(row).some((k) => /(^|_)name$/.test(k) && typeof row[k] === 'string' && row[k].trim() !== '');
}
function evalRegister(detectionSpec, bundle, record) {
  const registers = (bundle && bundle.registers) || {};
  const notes = registerNotesOf(registers);
  const target = registerTargetFor(record, allRegisterKeys(registers, notes));
  if (!target) return suppressed(detectionSpec, KIND.REGISTER, 'no register lane resolvable for this record (unregistered lane / no lookup)');
  if (isMatchedRegisterRow(registers[target])) return null; // a matched row is present -> compliant on this duty
  return registerNoMatchOutcome(detectionSpec, target, noteForRegister(notes, target));
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
  // Polarity split (A1, C-238): 'absence' (PROHIBITION) -> presence-breach path (found quote, never
  // floor/truncation gated); 'presence' (REQUIREMENT) -> absence-breach path (IS, via absenceInterlock).
  if (detectionSpec.evidence_type === 'absence') return listOf(evalPresenceBreach(detectionSpec, pagesOf(bundle)));
  if (detectionSpec.evidence_type === 'presence') return listOf(evalAbsenceBreach(detectionSpec, bundle, coverageState));
  if (detectionSpec.evidence_type === 'behavioural') return behaviouralCandidates(detectionSpec, bundle);
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
// DetectionSpecs in memory, then evaluates each. An unreadable (C-038) bundle carries no page to point
// evidence at, so it asserts nothing at all (a bare [] is honest there: there is no record-scoped
// abstention to attach to unread content). A non-English-gated (C-022) bundle DID get read; HIGH-9 fix:
// the abstention is now a VISIBLE suppression per compiled spec, never a bare [] (suppression is
// FIRST-CLASS per this module's own doctrine) - no candidate ever FIRES from it (fired = quotable
// evidence), only recorded abstentions.
function propose(bundle, catalogue, coverage) {
  if (isUnreadable(bundle)) return [];
  const { specs } = spec.compileCatalogue(catalogue);
  if (isNonEnglishGated(bundle)) {
    return specs.map((s) => suppressed(s, kindForType(s.evidence_type), 'non-English corpus gated before any rule ran (C-022); no claim can be asserted on unreadable-language content'));
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
  // dom_node lane (T2a), exported for direct testing + reuse
  evalDomNode,
  DOM_NODE_CONCEPTS,
  DOM_RULE_TO_CONCEPT,
  OBSERVATION_CONCEPTS,
  obligationConcerns,
  // exported for direct unit testing of the QA-cluster fixes (2026-07-20)
  isNonEnglishGated,
  pathHasSegment,
  matchUrlPath,
  isMatchedRegisterRow,
  singularise,
  tokenMatchesConcept,
  sentenceVerdict,
};
