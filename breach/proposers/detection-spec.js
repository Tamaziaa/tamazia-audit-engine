'use strict';
/**
 * detection-spec.js - the detection-spec migration (P3 Wave-2a, breach proposer layer).
 *
 * The compiled catalogue ships DUTIES AS PROSE: every record's website_obligations[] is a list of
 * { duty, elements[], evidence_type } where elements[] are human sentences, not machine patterns
 * (catalogue/README.md: "duties are prose, not regex, until a future detection migration"). This
 * module IS that migration. It reads the compiled catalogue at RUNTIME and derives, IN MEMORY, a
 * machine-checkable DetectionSpec per obligation. The packs are never touched: no pattern is written
 * back, nothing here edits a catalogue file (Constitution Rule 2, catalogue/packs are QA-stamped).
 *
 * A proposer PROPOSES; it never emits a finding. The DetectionSpec is the grammar a proposer runs to
 * turn one obligation into a breach CANDIDATE. propose.js is the only evaluator; the verifier and
 * adjudicator downstream turn a candidate into (or reject it from) a finding.
 *
 * ── The DetectionSpec grammar ────────────────────────────────────────────────────────────────────
 *   {
 *     record_id,        // the catalogue record id (upper-snake) this spec checks
 *     duty_idx,         // index into record.website_obligations[] (which duty)
 *     evidence_type,    // 'presence' | 'absence' | 'behavioural' | 'register' (the obligation's own)
 *     surface,          // 'visible_text' | 'raw_html' | 'footer' | 'register_row' | 'browser_lane'
 *     patterns: [ { kind, value, negation_guarded } ],
 *     page_class,       // the crawl page-class this on-page duty needs (coverage-contract), or null
 *   }
 *
 * evidence_type is the catalogue polarity, verbatim (catalogue/linters/polarity.js SEMANTIC DOCTRINE):
 *   - 'presence'    the duty names REQUIRED content; the site breaches when it is MISSING. propose.js
 *                   runs this as an ABSENCE-breach (required pattern absent across a COVERED surface),
 *                   artifact = coverage_proof. This is the truncation-sensitive, russell-cooke class
 *                   (C-024): it fires only with the coverage interlock proven.
 *   - 'absence'     the duty names PROHIBITED content; the site breaches when it IS PRESENT. propose.js
 *                   runs this as a PRESENCE-breach (prohibited pattern found in visible prose),
 *                   artifact = the verbatim quote. negation_guarded is true so the site's OWN compliant
 *                   self-declaration ("we do not treat under-18s") is not read as the prohibited claim
 *                   (C-048/C-060, the Botox-U18 polarity trap).
 *   - 'register'    proved against a pre-fetched register row (evidence/registers), surface
 *                   'register_row', page_class null: the crawl never gates it.
 *   - 'behavioural' proved by an observed browser action (evidence/browser), surface 'browser_lane',
 *                   page_class null.
 *
 * ── surface = evidence surface, DECLARED per rule (C-035/C-036/C-034) ────────────────────────────
 * A spec's surface is BOTH where propose.js detects AND where it cuts the quote, so a hit and its quote
 * can never disagree (C-035). The C-036 asymmetry is encoded here: a PROHIBITION ('absence') triggers on
 * VISIBLE prose only ('visible_text'), since a forbidden claim inside a <script> is not a public claim;
 * a REQUIRED MECHANISM that legitimately lives in JavaScript (a consent tool, an embedded badge) routes
 * to 'raw_html' so a strict visible check cannot fabricate a "missing" breach on a compliant JS control,
 * and since the pure EvidenceBundle is stripped text only (C-012) propose.js ABSTAINS on 'raw_html'
 * rather than assert what it cannot see. Registration-number / office duties route to 'footer' (C-034).
 *
 * ── Anchoring + negation (C-009/C-019/C-059, ported idea from corpus-index.js) ───────────────────
 * Every derived pattern is word-boundary anchored on every token; a bare prefix/substring is
 * unrepresentable and REJECTED by validateSpec (the "cost"->pricing, /^EU/->EUROPEAN class). Prohibition
 * patterns carry negation_guarded so propose.js skips a negated carrier sentence (ported NEGATION_RX
 * idea, without the blanket-negation false-negative PR #340 removed).
 *
 * Pure and synchronous (no network/clock/env). Holds NO law/fine/regulator literal (Rule 2); every word
 * it patterns on is READ from the catalogue argument at runtime, never authored here.
 */

// page-class resolution is ONE door (Rule 1): the spec's page_class and the coverage verdict propose.js
// consumes must be the SAME function, or an on-page duty could be checked on a surface coverage never
// judged (C-035). It lives in evidence/crawler/coverage-contract.js; this module imports it rather than
// keeping a second copy (the cross-wave clone the reconciliation pass deletes).
const coverageContract = require('../../evidence/crawler/coverage-contract.js');

// ── frozen vocabularies (the closed sets validateSpec enforces) ──────────────────────────────────
const EVIDENCE_TYPES = Object.freeze(['presence', 'absence', 'behavioural', 'register']);
const SURFACES = Object.freeze(['visible_text', 'raw_html', 'footer', 'register_row', 'browser_lane']);
const PATTERN_KINDS = Object.freeze(['anchored-regex', 'token-set', 'url-path']);

const MIN_TOKEN_LEN = 3;      // a token shorter than this is too generic to anchor a legal claim on
const MAX_TOKENS = 4;         // a derived token-set is capped so one long element cannot over-specify
const MIN_PHRASE_WORDS = 2;   // a quoted phrase under this is treated as a single token, not a phrase

// Generic obligation/boilerplate words dropped before deriving a token-set: patterning on these would
// match any page (the C-049/C-059 over-broad-trigger class). This is a STOPWORD list, not a legal
// vocabulary - it names no law, regulator or fact (Rule 2).
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'their', 'have', 'has', 'are', 'was',
  'page', 'pages', 'website', 'websites', 'site', 'sites', 'online', 'web', 'published', 'publish',
  'display', 'displayed', 'show', 'shown', 'state', 'stated', 'provide', 'provided', 'include',
  'included', 'including', 'required', 'require', 'must', 'may', 'not', 'clear', 'clearly',
  'statement', 'reference', 'where', 'near', 'listed', 'every', 'should', 'obligation', 'obligations',
  'available', 'relevant', 'visible', 'prominent', 'prominently', 'each', 'any', 'all', 'its', 'his',
  'her', 'they', 'them', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'is', 'be', 'as', 'at', 'by',
  'findable', 'named', 'wording', 'present', 'content', 'copy', 'text', 'section', 'link', 'links',
]);

// Element wording that means "a page/section of this class exists" rather than "this phrase appears":
// such an element is satisfiable by a crawled page of the right class, so it also gets a url-path pattern.
const FINDABILITY_RX = /\b(findable|available on the website|on the website|link(?:s|ed|ing)?|page|section|procedure)\b/i;
// Required-mechanism wording that legitimately lives in JavaScript (route to raw_html; propose abstains
// rather than fabricate a missing-mechanism breach, C-036/C-032). Deliberately NARROW: bare "widget",
// "tool" and "banner" are ordinary disclosure words and would over-abstain, so only unambiguously
// JS-embedded controls qualify (an SRA-style clickable embedded badge, a script/plugin, a consent tool).
const MECHANISM_RX = /\b(badge|embedded|embed|script|plugin|clickable|consent[- ]?(?:tool|manager|management)|(?:cookie|consent)[- ]?banner)\b/i;
// Footer-surface duties: a company/registration number or registered office (C-034/C-072).
const FOOTER_RX = /\b(company number|registration number|registered office|firm(?:'s)? (?:sra|number)|number shown|registered number)\b/i;

// ── anchoring primitives ─────────────────────────────────────────────────────────────────────────
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// anchorToken(word) -> a word-boundary-anchored regex SOURCE for one token (C-059). An internal hyphen
// is preserved ("under-18" -> \bunder-18\b); a bare token can never leak into a substring match.
function anchorToken(word) {
  return '\\b' + escapeRegex(String(word)) + '\\b';
}

// buildAnchoredRegex(phrase) -> a single anchored-regex SOURCE for a multi-word phrase: each word
// escaped, joined by \W+ (run of non-word chars), the whole bounded by \b on both ends. Whitespace and
// punctuation between the client's words is tolerated; the phrase can never match as a bare substring.
function buildAnchoredRegex(phrase) {
  const words = String(phrase).trim().split(/\s+/).map(escapeRegex).filter(Boolean);
  if (!words.length) return null;
  return '\\b' + words.join('\\W+') + '\\b';
}

// compileRegex(pattern) -> a case-insensitive RegExp for a pattern, or null if it cannot compile. The
// matcher (propose.js) calls this; a null here is surfaced by validateSpec as a rejected spec, never
// swallowed (the C-050 dead-regex class: a pattern that does not compile is not a silent no-op).
function compileRegex(pattern) {
  const src = regexSourceOf(pattern);
  if (src == null) return null;
  try {
    return new RegExp(src, 'i');
  } catch (_err) {
    // FAIL-OPEN: recorded as null and reported by validateSpec's does-not-compile branch (Rule 4).
    return null;
  }
}

// regexSourceOf(pattern) -> the regex source a pattern compiles to: an anchored-regex is its value; a
// token-set becomes an AND/OR of anchored tokens via lookahead ('all') or alternation ('any'); a
// url-path is compiled by matchUrlPath, not here (returns null).
function regexSourceOf(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  if (pattern.kind === 'anchored-regex') return typeof pattern.value === 'string' ? pattern.value : null;
  if (pattern.kind === 'token-set') return tokenSetSource(pattern.value);
  return null;
}

function tokenSetSource(value) {
  const tokens = value && Array.isArray(value.tokens) ? value.tokens : null;
  if (!tokens || !tokens.length) return null;
  const anchored = tokens.map(anchorToken);
  if (value.mode === 'any') return '(?:' + anchored.join('|') + ')';
  // 'all': every token must occur somewhere in the surface, order-independent (lookahead per token).
  return anchored.map((a) => '(?=[\\s\\S]*' + a + ')').join('') + '[\\s\\S]';
}

// ── negation guard (ported from corpus-index.js NEGATION_RX; PR #340 blanket-negation fix kept) ───
// A prohibition ('absence') fires when the firm MAKES the forbidden claim. A sentence that NEGATES the
// claim ("we do not offer ... to under-18s", "must be 18 or over") is a compliance statement, not the
// prohibited claim; propose.js skips it. Blanket "prohibited/illegal/we comply" negations are NOT here:
// a negation must negate THE CLAIM, not merely mention that the law exists.
const NEGATION_RX = /\b(?:do not|don't|does not|doesn't|did not|never|cannot|can't|will not|won't|no longer|not (?:offer|available|suitable|permitted|provide)|must be (?:over|aged|18)|18\s*(?:years\s*)?(?:and|or)\s*(?:over|older|above)|over[- ]?18s?\s*only|strictly\s*18)\b/i;
function isNegated(sentence) {
  return NEGATION_RX.test(String(sentence || ''));
}

// A customer-review sentence must never be read as the FIRM'S own prohibited claim (C-090). The pure
// EvidenceBundle is stripped visible text with no DOM containers, so this is a lightweight review-framing
// heuristic (star runs, first-person praise), not full segmentation; the honest limit is flagged to the
// caller. propose.js drops a prohibited-claim hit whose carrier sentence looks like a review.
const REVIEW_RX = /(★|\bfive[- ]stars?\b|\b\d(?:\.\d)?\s*(?:\/\s*5|stars?)\b|\bwould (?:highly )?recommend\b|\bhighly recommend(?:ed)?\b|\bbest (?:clinic|firm|service|experience)\b)/i;
function looksLikeReview(sentence) {
  return REVIEW_RX.test(String(sentence || ''));
}

// splitSentences(text) -> sentence-ish segments bounded by . ! ? bullet or newline. Pure; used to bound
// a quote to one sentence (C-089) and to run the negation/review guards per carrier sentence.
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?•\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// isProse(sentence) -> true when a sentence is genuine client copy, not a nav/footer Title-Case link run
// (C-089: never quote boilerplate). Deterministic and conservative.
function isProse(sentence) {
  const s = String(sentence || '').trim();
  if (s.length < 25) return false;                 // C-089 minimum evidence length
  const words = s.split(/\s+/);
  if (words.length < 4) return false;
  const titleish = words.filter((w) => /^[A-Z][a-zA-Z'']+$/.test(w)).length;
  if (titleish / words.length > 0.7) return false; // mostly Title-Case tokens => a menu/link run
  return /[a-z]/.test(s);
}

// ── surface + page-class routing ─────────────────────────────────────────────────────────────────
function obligationText(obligation) {
  const elems = Array.isArray(obligation.elements) ? obligation.elements.join(' ') : '';
  return ((obligation.duty || '') + ' ' + elems);
}

// pageClassFor(obligation) -> the crawl page-class an on-page presence/absence duty needs ('any' for a
// general on-page duty; null for register/behavioural non-crawl lanes). This IS coverage-contract's
// pageClassForObligation (one door, one meaning): binding the name to the imported function guarantees
// the spec's page_class and the coverage verdict can never disagree, and deletes the copy that drifted.
const pageClassFor = coverageContract.pageClassForObligation;

// surfaceFor(obligation) -> the declared detection/evidence surface (C-035/C-036/C-034).
function surfaceFor(obligation) {
  const et = obligation && obligation.evidence_type;
  if (et === 'register') return 'register_row';
  if (et === 'behavioural') return 'browser_lane';
  const text = obligationText(obligation);
  if (et === 'presence' && FOOTER_RX.test(text)) return 'footer';
  if (et === 'presence' && MECHANISM_RX.test(text)) return 'raw_html'; // JS-embeddable mechanism (C-036)
  return 'visible_text'; // prohibitions and prose disclosures both detect on visible prose (C-036)
}

// ── pattern derivation (prose element -> anchored patterns) ──────────────────────────────────────
function quotedSpans(text) {
  const out = [];
  const rx = /['"‘’“”]([^'"‘’“”]{3,})['"‘’“”]/g;
  let m;
  while ((m = rx.exec(String(text || ''))) !== null) {
    const phrase = m[1].trim();
    if (phrase.split(/\s+/).length >= MIN_PHRASE_WORDS) out.push(phrase);
  }
  return out;
}

// salientTokens(text) -> up to MAX_TOKENS distinctive content tokens (>= MIN_TOKEN_LEN, minus STOPWORDS),
// in first-seen order (deterministic). Digits-with-a-word like "18" are kept only when >= MIN_TOKEN_LEN
// so a bare short number never becomes a pattern.
function salientTokens(text) {
  const raw = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]*[a-z0-9]|[a-z0-9]/g) || [];
  const out = [];
  const seen = new Set();
  for (const w of raw) {
    if (w.length < MIN_TOKEN_LEN || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

// topDistinctive(tokens, n) -> up to n most distinctive tokens (>= 4 chars) by length descending, a
// stable sort keeping first-seen order on ties (deterministic). The distinctiveness floor drops the
// short common words a legal claim must never hinge on (C-059).
function topDistinctive(tokens, n) {
  return tokens
    .filter((t) => t.length >= 4)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (b.t.length - a.t.length) || (a.i - b.i))
    .slice(0, n)
    .map((x) => x.t);
}

// patternsFromElement(elementText, evidenceType, pageClass) -> { patterns, unpatternable }.
//
// THE POLARITY OF STRICTNESS (the C-024-vs-C-078 balance, the single most important choice here).
// The two evidence types fail in OPPOSITE directions, so their derived matchers must be strict in
// opposite directions:
//   - 'absence' (a PROHIBITION; propose fires when the pattern IS FOUND): a loose matcher over-accuses
//     (C-078, the defamation-adjacent false hack accusation). So a prohibited element is matched
//     STRICTLY - the exact quoted phrase, or the FULL token-set co-occurring (mode 'all'). A near miss
//     abstains. Precision beats recall: a missed prohibited claim is recoverable, a false accusation is
//     not (C-082).
//   - 'presence' (a REQUIREMENT; propose fires when the pattern is ABSENT): a strict matcher over-
//     accuses in reverse - it reads a compliant-but-differently-worded page as "missing" (C-024, the
//     russell-cooke SRA-string-past-the-cut class; C-093 presence-but-thin). So the "present" signal is
//     made EASY to satisfy - the exact quoted phrase, OR a DISTINCTIVE token pair co-occurring, OR a
//     findability page of the right class exists - and propose fires the absence-breach only when NONE
//     of these hold across the covered surface (total silence). A partially-present disclosure abstains.
//   - 'behavioural' / 'register': the tokens do not scan the site; they route the obligation to the
//     right observation/register in propose.js, so a lenient 'any' set is correct.
// An element that reduces to nothing distinctive is returned as unpatternable: propose.js abstains
// rather than fire a low-precision pattern (the C-049 "mute or over-broad" trap - refuse to guess).
function patternsFromElement(elementText, evidenceType, pageClass) {
  const phrases = quotedSpans(elementText);
  const tokens = salientTokens(elementText);
  const patterns = phrases
    .map((p) => buildAnchoredRegex(p))
    .filter(Boolean)
    .map((src) => ({ kind: 'anchored-regex', value: src, negation_guarded: evidenceType === 'absence' }));
  addDerivedTokenPattern(patterns, phrases, tokens, evidenceType);
  if (evidenceType === 'presence' && pageClass && pageClass !== 'any' && FINDABILITY_RX.test(elementText)) {
    patterns.push({ kind: 'url-path', value: '/' + pageClass, negation_guarded: false });
  }
  return { patterns, unpatternable: patterns.length === 0 };
}

// addDerivedTokenPattern(patterns, phrases, tokens, evidenceType) -> pushes the one token-set this
// element contributes, polarity-aware per the doctrine above. Kept separate so patternsFromElement
// stays within the health-gate function-length cap.
function addDerivedTokenPattern(patterns, phrases, tokens, evidenceType) {
  if (evidenceType === 'absence') {
    // A quoted prohibited phrase is the precise matcher; do not dilute it with a token-set. Without a
    // quote, only a DISTINCTIVE multi-token set (matched later within ONE sentence) is safe enough to
    // pattern a prohibition on; a single or generic token is refused (C-059/C-078). Recall is
    // deliberately traded for precision here - a missed prohibition is recoverable, a false accusation
    // is not.
    if (phrases.length) return;
    const distinctive = topDistinctive(tokens, 3);
    if (distinctive.length >= 2) patterns.push({ kind: 'token-set', value: { tokens: distinctive, mode: 'all' }, negation_guarded: true });
    return;
  }
  if (evidenceType === 'presence') {
    const distinctive = topDistinctive(tokens, 2);
    if (distinctive.length >= 2) patterns.push({ kind: 'token-set', value: { tokens: distinctive, mode: 'all' }, negation_guarded: false });
    return;
  }
  // behavioural | register: lane-routing tokens, matched leniently in propose.js against the observation
  // kind / register, never against site prose.
  if (tokens.length) patterns.push({ kind: 'token-set', value: { tokens, mode: 'any' }, negation_guarded: false });
}

// dedupePatterns(patterns) -> patterns unique by (kind + normalised value), preserving order.
function dedupePatterns(patterns) {
  const seen = new Set();
  const out = [];
  for (const p of patterns) {
    const key = p.kind + '|' + (p.kind === 'token-set' ? (p.value.mode + ':' + p.value.tokens.join(',')) : p.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// specForObligation(record, obligation, dutyIdx) -> one DetectionSpec, or null when the obligation has
// no id/record to bind to. Patterns are derived from the duty + every element; an obligation that yields
// no anchored pattern still produces a spec (with empty patterns) so it is VISIBLE as an honest
// coverage gap, never silently dropped - propose.js treats an empty-pattern spec as inert (abstains).
function specForObligation(record, obligation, dutyIdx) {
  if (!record || typeof record.id !== 'string' || !obligation) return null;
  const evidenceType = obligation.evidence_type;
  const pageClass = pageClassFor(obligation);
  const surface = surfaceFor(obligation);
  const sources = [obligation.duty, ...(Array.isArray(obligation.elements) ? obligation.elements : [])];
  let patterns = [];
  const unpatternable = [];
  for (const src of sources) {
    if (!src) continue;
    const r = patternsFromElement(src, evidenceType, pageClass);
    if (r.unpatternable) unpatternable.push(String(src));
    patterns = patterns.concat(r.patterns);
  }
  return {
    record_id: record.id,
    duty_idx: dutyIdx,
    evidence_type: evidenceType,
    surface,
    patterns: dedupePatterns(patterns),
    page_class: pageClass,
    unpatternable_elements: unpatternable,
  };
}

// compileRecordSpecs(record) -> the DetectionSpec[] for one record's website_obligations[].
function compileRecordSpecs(record) {
  const obligations = (record && Array.isArray(record.website_obligations)) ? record.website_obligations : [];
  const specs = [];
  for (let i = 0; i < obligations.length; i++) {
    const spec = specForObligation(record, obligations[i], i);
    if (spec) specs.push(spec);
  }
  return specs;
}

// recordsOf(catalogue) -> the records array from a compiled catalogue artifact ({records:[...]}) or a
// bare array; anything else is []. Tolerant so a caller may pass either shape.
function recordsOf(catalogue) {
  if (Array.isArray(catalogue)) return catalogue;
  if (catalogue && Array.isArray(catalogue.records)) return catalogue.records;
  return [];
}

// compileCatalogue(catalogue) -> { specs, rejected }. Every obligation of every record becomes a spec;
// each spec is validated at the source (C-009/C-019), and any spec carrying an unanchored/bare pattern
// is REJECTED here with its reasons rather than shipped - an unanchored pattern is unrepresentable in
// what propose.js consumes.
function compileCatalogue(catalogue) {
  const specs = [];
  const rejected = [];
  for (const record of recordsOf(catalogue)) {
    for (const spec of compileRecordSpecs(record)) {
      const v = validateSpec(spec);
      if (v.valid) specs.push(spec);
      else rejected.push({ record_id: spec.record_id, duty_idx: spec.duty_idx, errors: v.errors });
    }
  }
  return { specs, rejected };
}

// ── validation (the C-009/C-019 anchoring gate; the p3-proposer-unanchored-pattern fixture drives it) ──
// isAnchoredPatternValue(pattern) -> { ok, reason }. A pattern is REJECTED when it is bare/unanchored:
//   - anchored-regex: source must contain a \b word boundary or a ^/$ anchor AND must compile; a bare
//     alternation like "EU" or a bare substring like "cost" (no \b, no ^/$) is rejected (C-019/C-044/C-059).
//   - token-set: non-empty; every token >= MIN_TOKEN_LEN and a clean word (a 1-2 char or punctuation
//     token would substring-match, the "post"->postcode class C-059).
//   - url-path: a rooted single path segment ('/xxx'), never a bare word (the /cost-of-living class C-044).
function isAnchoredPatternValue(pattern) {
  if (!pattern || typeof pattern !== 'object') return { ok: false, reason: 'pattern is not an object' };
  if (!PATTERN_KINDS.includes(pattern.kind)) return { ok: false, reason: 'unknown pattern kind ' + JSON.stringify(pattern.kind) };
  if (pattern.kind === 'anchored-regex') return anchoredRegexOk(pattern.value);
  if (pattern.kind === 'token-set') return tokenSetOk(pattern.value);
  return urlPathOk(pattern.value);
}

function anchoredRegexOk(value) {
  if (typeof value !== 'string' || !value.length) return { ok: false, reason: 'anchored-regex value must be a non-empty string' };
  if (!/\\b|\^|\$/.test(value)) return { ok: false, reason: 'anchored-regex is not anchored (no \\b, ^ or $): a bare pattern substring-matches (C-019/C-059)' };
  try {
    new RegExp(value, 'i');
  } catch (err) {
    // FAIL-OPEN: the error is RECORDED verbatim in the returned reason; validateSpec surfaces it (C-050).
    return { ok: false, reason: 'anchored-regex does not compile (C-050): ' + err.message };
  }
  return { ok: true, reason: null };
}

function tokenSetOk(value) {
  const tokens = value && Array.isArray(value.tokens) ? value.tokens : null;
  if (!tokens || !tokens.length) return { ok: false, reason: 'token-set has no tokens' };
  if (value.mode !== 'all' && value.mode !== 'any') return { ok: false, reason: 'token-set mode must be "all" or "any"' };
  for (const t of tokens) {
    if (typeof t !== 'string' || t.length < MIN_TOKEN_LEN) return { ok: false, reason: 'token ' + JSON.stringify(t) + ' is shorter than the ' + MIN_TOKEN_LEN + '-char floor (a bare short token substring-matches, C-059)' };
    if (!/[a-z0-9]/i.test(t)) return { ok: false, reason: 'token ' + JSON.stringify(t) + ' has no word character' };
  }
  return { ok: true, reason: null };
}

function urlPathOk(value) {
  if (typeof value !== 'string' || value[0] !== '/') return { ok: false, reason: 'url-path must be a rooted path segment ("/xxx"), never a bare word (C-044)' };
  if (!/^\/[a-z0-9][a-z0-9/-]*$/i.test(value)) return { ok: false, reason: 'url-path ' + JSON.stringify(value) + ' is not a clean path segment' };
  return { ok: true, reason: null };
}

// validateSpec(spec) -> { valid, errors }. Shape gate + the anchoring gate on every pattern. A
// register/behavioural spec must carry page_class null (the crawl never gates a non-crawl lane); a
// presence/absence spec must carry a page_class string. Any bad pattern makes the whole spec invalid.
function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { valid: false, errors: ['spec is not an object'] };
  if (typeof spec.record_id !== 'string' || !spec.record_id) errors.push('record_id must be a non-empty string');
  if (!Number.isInteger(spec.duty_idx) || spec.duty_idx < 0) errors.push('duty_idx must be a non-negative integer');
  if (!EVIDENCE_TYPES.includes(spec.evidence_type)) errors.push('evidence_type ' + JSON.stringify(spec.evidence_type) + ' is not one of ' + EVIDENCE_TYPES.join('/'));
  if (!SURFACES.includes(spec.surface)) errors.push('surface ' + JSON.stringify(spec.surface) + ' is not one of ' + SURFACES.join('/'));
  validatePageClass(spec, errors);
  validatePatterns(spec, errors);
  return { valid: errors.length === 0, errors };
}

function validatePageClass(spec, errors) {
  const laneOnly = spec.evidence_type === 'register' || spec.evidence_type === 'behavioural';
  if (laneOnly && spec.page_class !== null) errors.push('a ' + spec.evidence_type + ' spec must have page_class null (its evidence is a non-crawl lane)');
  if (!laneOnly && typeof spec.page_class !== 'string') errors.push('a ' + spec.evidence_type + ' spec must declare a page_class string');
}

function validatePatterns(spec, errors) {
  if (!Array.isArray(spec.patterns)) { errors.push('patterns must be an array'); return; }
  for (let i = 0; i < spec.patterns.length; i++) {
    const p = spec.patterns[i];
    if (typeof p.negation_guarded !== 'boolean') errors.push('patterns[' + i + '].negation_guarded must be a boolean');
    const v = isAnchoredPatternValue(p);
    if (!v.ok) errors.push('patterns[' + i + '] rejected: ' + v.reason);
  }
}

module.exports = {
  EVIDENCE_TYPES,
  SURFACES,
  PATTERN_KINDS,
  MIN_TOKEN_LEN,
  // compilation
  compileCatalogue,
  compileRecordSpecs,
  specForObligation,
  patternsFromElement,
  pageClassFor,
  surfaceFor,
  salientTokens,
  quotedSpans,
  // anchoring primitives + matcher helpers (one door, shared with propose.js so no second matcher drifts)
  anchorToken,
  buildAnchoredRegex,
  compileRegex,
  NEGATION_RX,
  isNegated,
  looksLikeReview,
  splitSentences,
  isProse,
  // validation
  validateSpec,
  isAnchoredPatternValue,
};
