'use strict';
// render-proof/truth-pack.js - THE pure render truth-pack (Constitution Rules 2, 3, 7, 10, 17; C-124).
//
// C-124's doctrine: "the browser, not the JSON, defines shipped." A JSON check repeatedly "proved" a render
// that was wrong in the browser, so the render truth-pass asserts every rendered claim exists in the payload
// and NO non-catalogue fine, regulator or law title appears. This module is the pure decision core of that
// pass: given the payload the mint composed and the VISIBLE TEXT of the rendered audit page (the DOM text
// content a browser truth-pass extracts, NOT the HTML), it returns every render/payload disagreement.
//
//   check(payload, renderedText, opts) -> { ok, violations: [{ rule, detail }] }
//
// PURE: no fetch, no fs, NO CLOCK. The catalogue and the clock arrive as injected inputs on `opts`
// (opts.catalogueNames / opts.catalogue, opts.now, opts.generatedAt) so node:test drives every rule with no
// I/O and the freshness clock is never the ambient wall clock (Rule 11 spirit: determinism; no Date.now).
// Never throws: a malformed input becomes a recorded violation, never an exception into the mint (Rule 7).
//
// EVERY RULE FUNCTION IS KEPT SMALL AND NAMED (repo health-gate discipline, CodeScene code-health): each
// top-level `check*` dispatcher is a thin sequence of calls into single-purpose helpers, and any compound
// null-guard / multi-source collection is its own tiny named function rather than an inline chain, so no
// function's cyclomatic complexity nor any single conditional's branch count grows unreadable.
//
// THE SEVEN RULES, each mapped to the caution pointer(s) it distils:
//   notLegalAdvice             the standing not-legal-advice sentence is present VERBATIM (C-200).
//   exposure-headline          the headline exposure figure appears, and the statutory ceiling NEVER appears
//                              as a bare headline figure - every occurrence of the ceiling value sits within
//                              CEILING_PROXIMITY_CHARS of the word 'ceiling' (C-094/C-096; exposure-error).
//   money-provenance           EVERY GBP amount in the render traces to a payload figure (the exposure
//                              headline/full, a waterfall band, the ceiling, or a finding/record penalty or
//                              enforcement amount); an amount with no payload source is a fabrication
//                              (C-112/C-114/C-115; consistency-error).
//   framework-provenance       every violation/needs-review finding's framework name is shown (Rule 10: a
//                              rendered page shows every finding), and NO law-name-shaped string ('... Act',
//                              '... Regulations') appears that matches no payload/catalogue name (Rule 2 /
//                              C-112; consistency-error).
//   voice                      a needs-review framework name never co-occurs (within VOICE_WINDOW chars) with
//                              a confident-breach phrase, and the confirmed exposure figure is withheld from
//                              a review item (Rule 10 / C-111; consistency-error).
//   counts-coherence           the rendered counts show frameworksBinding, frameworksAssessed and
//                              rulesChecked, and the screened label is present (C-117/C-118; coverage-truth).
//                              NOTE (CodeRabbit / honesty): this rule proves the RENDER matches whatever the
//                              PAYLOAD already says; it cannot prove the payload's own counts were correctly
//                              COMPUTED (a coverage count never computed upstream would render-match itself
//                              perfectly and pass here). That production-side correctness is a distinct
//                              concern owned by payload/composer/compose.test.js (see
//                              tools/history-regression/taxonomy.js's coverage-truth row).
//   render-security-freshness  generatedAt is present, parseable and within maxAgeDays of the injected clock;
//                              and, when requireHmac is set, the URL carries sig+exp (C-122;
//                              render-security-freshness). requireHmac STAYS FALSE until the website binds
//                              AUDIT_HMAC_SECRET end-to-end (C-122: dead security code is theatre); the gate
//                              exists so the day the secret lands, turning it on is a one-line opt flip. Until
//                              then the HMAC subcase is NOT enforced in the live mint path - see
//                              tools/history-regression/taxonomy.js's render-security-freshness row.

// N: how close (in characters, either side) the formatted statutory-ceiling figure must sit to the word
// 'ceiling'. A ceiling figure further than this from any 'ceiling' label reads to the client as a bare
// headline exposure, which is exactly the C-094/C-096 disease (a raw statutory cap headlining an audit).
// FAIL CLOSED: no nearby 'ceiling' word => the occurrence is a bare-headline violation.
const CEILING_PROXIMITY_CHARS = 60;

// VOICE_WINDOW: the character radius around a needs-review framework name within which a confident-breach
// phrase (or the withheld confirmed-exposure figure) is treated as attached to that review item (C-111).
const VOICE_WINDOW = 200;

// The confident-breach phrases a review-band finding must never be rendered next to (C-111: review-band
// items render DISTINCTLY from confirmed breaches). Lower-cased; the render text is lower-cased to compare.
const CONFIDENT_BREACH_TOKENS = ['in breach', 'violation confirmed', 'confirmed breach', 'breach confirmed', 'is in violation'];

// DEFAULT_MAX_AGE_DAYS: a render older than this (generatedAt vs the injected clock) is stale (C-122/C-123:
// a superseded page must not serve as current). The engine keeps no scan cache (Rule 15); 90 days is the
// standing freshness cap, overridable via opts.maxAgeDays.
const DEFAULT_MAX_AGE_DAYS = 90;

const MS_PER_DAY = 86400000;

// ENFORCEMENT_MONEY_FIELDS: the ONLY field an enforcement row is permitted to contribute a money figure from
// (the fine/penalty amount the row quotes). `enforcement` is an optional, shape-unconstrained contract field
// (payload/schema/payload.schema.json marks it "$comment: optional"); iterating every key on the row would
// treat incidental numeric metadata (a year, a count) as a legitimate GBP source (CodeRabbit finding on
// truth-pack.js:206). Whitelisting to the money field the catalogue actually populates closes that hole.
const ENFORCEMENT_MONEY_FIELDS = ['amount'];

// The law-name shape: a Title-cased phrase ending in the statute suffixes the task names ('Act',
// 'Regulations'/'Regulation'), an optional trailing year. Connectors are short lowercase words (of, and,
// from, ...) or further Title-cased tokens. The reps are BOUNDED ({0,10}) so an adversarial render can never
// drive catastrophic backtracking (ReDoS); the render text is our own page, but a bounded pattern is the
// honest cap (Rule 8 spirit). Used ONLY to FIND candidates in the render; membership is then decided against
// the payload/catalogue name set, so this heuristic never itself asserts a law.
const LAW_NAME_SHAPE = /\b[A-Z][A-Za-z&'’.-]*(?:\s+(?:[a-z]{1,5}|[A-Z0-9][A-Za-z&'’.-]*)){0,10}?\s+(?:Act|Regulations?)\b(?:\s+(?:19|20)\d{2})?/g;

// ── tiny pure helpers (self-contained; the checker requires nothing) ──────────────────────────────────────
function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function numOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}
// normaliseWs(s) -> whitespace runs collapsed to a single space, trimmed. Lets a VERBATIM-presence check
// survive the line wrapping / indentation a DOM text extraction introduces without weakening it to a fuzzy
// match (the words and their order still have to be exactly right).
function normaliseWs(s) { return str(s).replace(/\s+/g, ' ').trim(); }
// groupThousands(n) -> the integer part of n grouped in threes with commas ("500000" -> "500,000"). Manual,
// so the GBP formatting is deterministic and never depends on ICU/locale data being present.
function groupThousands(n) {
  const neg = n < 0;
  const digits = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return (neg ? '-' : '') + out;
}
// formatGBP(n) -> the canonical rendered GBP string for a number ("£12,500"). Grouped INTEGER pounds, never
// an abbreviated thousands/millions form (an abbreviated cap is a C-094 headline shape); the render contract
// shows the full grouped figure. The pure checker and the reference renderer share this one formatter.
function formatGBP(n) { return '£' + groupThousands(n); }

// parseGBPAmounts(text) -> [{ value, index }] for every GBP-formatted amount in the render. Matches a '£'
// (optional single space) then a grouped-or-plain integer with an optional 2-dp tail; commas are stripped
// before the value is parsed, so "£12,500" and "£12,500.00" both parse to 12500 / 12500. index is the offset
// of the '£' so proximity rules (ceiling, voice) can measure distance to a label.
function parseGBPAmounts(text) {
  const out = [];
  const rx = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of str(text).matchAll(rx)) {
    const whole = Number(m[1].replace(/,/g, ''));
    const frac = m[2] ? Number('0.' + m[2]) : 0;
    if (Number.isFinite(whole)) out.push({ value: whole + frac, index: m.index });
  }
  return out;
}
// allIndexOf(hay, needle) -> every start offset of needle in hay (both already lower-cased by the caller
// where case-insensitivity is wanted). A empty needle yields no offsets (never every position).
function allIndexOf(hay, needle) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}
// nearWord(text, index, word, radius) -> true when `word` (case-insensitive) appears within `radius` chars
// either side of `index` in `text`.
function nearWord(text, index, word, radius) {
  const from = Math.max(0, index - radius);
  const to = Math.min(text.length, index + radius);
  return text.slice(from, to).toLowerCase().indexOf(word.toLowerCase()) !== -1;
}
// textIncludes(text, phrase) -> whitespace-normalised, case-insensitive substring presence.
function textIncludes(text, phrase) {
  return normaliseWs(text).toLowerCase().indexOf(normaliseWs(phrase).toLowerCase()) !== -1;
}
// isDigitChar(ch) -> true for a single ASCII digit character (used by containsNumberToken's boundary check).
function isDigitChar(ch) { return ch >= '0' && ch <= '9'; }
// boundaryDigit(s, i) -> true when s[i] exists AND is a digit. Out-of-range (negative or past the end) is
// treated as "not a digit", matching a regex boundary's `^`/end-of-string alternatives.
function boundaryDigit(s, i) { return i >= 0 && i < s.length && isDigitChar(s[i]); }
// containsNumberToken(text, n) -> true when the integer n appears as a standalone token in the render
// (commas stripped first), so binding=2 is not "found" inside "2026" or "£20,000". Deliberately built from
// String#indexOf + a manual boundary check rather than `new RegExp(String(n))`: a RegExp constructed from a
// variable is a Semgrep detect-non-literal-regexp finding (CWE-1333 ReDoS surface), even though `n` here is
// always a validated number - the fix removes the dynamic RegExp entirely rather than justify it.
function containsNumberToken(text, n) {
  const bare = str(text).replace(/,/g, '');
  const token = String(n);
  if (!token) return false;
  let from = 0;
  for (;;) {
    const i = bare.indexOf(token, from);
    if (i === -1) return false;
    const precededByDigit = boundaryDigit(bare, i - 1);
    const followedByDigit = boundaryDigit(bare, i + token.length);
    if (!precededByDigit && !followedByDigit) return true;
    from = i + 1;
  }
}
// parseTimeMs(v) -> epoch ms for a number (already ms) or a Date-parseable string, else null. Date.parse of
// an INJECTED value is pure (it reads no ambient clock); the checker never calls Date.now.
function parseTimeMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}
// urlParams(url) -> the URLSearchParams of url, or null when url is missing/unparseable.
function urlParams(url) {
  if (typeof url !== 'string' || url === '') return null;
  try { return new URL(url).searchParams; }
  catch { /* FAIL-OPEN: an unparseable URL yields null, which the security rule records as a violation; it never throws into check(). */ return null; }
}

// ── rule 1: notLegalAdvice (C-200) ────────────────────────────────────────────────────────────────────────
function checkNotLegalAdvice(payload, text, out) {
  const sentence = normaliseWs(payload && payload.notLegalAdvice);
  if (!sentence) {
    out.push({ rule: 'notLegalAdvice', detail: 'payload.notLegalAdvice is absent or empty; the standing not-legal-advice line cannot be proven present (C-200).' });
    return;
  }
  if (!textIncludes(text, sentence)) {
    out.push({ rule: 'notLegalAdvice', detail: 'the standing not-legal-advice line is not present VERBATIM in the render (C-200): "' + sentence.slice(0, 80) + (sentence.length > 80 ? '...' : '') + '"' });
  }
}

// ── rule 2: exposure-headline (C-094 / C-096; exposure-error) ─────────────────────────────────────────────
// checkExposureHeadlinePresence(payload, amounts, out) -> the headline exposure figure must be SHOWN.
function checkExposureHeadlinePresence(payload, amounts, out) {
  const headline = numOrNull(payload && payload.exposure && payload.exposure.value);
  if (headline == null) return;
  if (headline <= 0) return;
  if (amounts.some((a) => a.value === headline)) return;
  out.push({ rule: 'exposure-headline', detail: 'the headline exposure figure ' + formatGBP(headline) + ' (payload.exposure.value) does not appear in the render; the headline exposure must be shown (C-096).' });
}
// checkExposureCeilingNotBare(payload, text, amounts, out) -> the single statutory ceiling must never render
// as a bare headline figure: every occurrence sits within CEILING_PROXIMITY_CHARS of the word 'ceiling'.
function checkExposureCeilingNotBare(payload, text, amounts, out) {
  const wf = payload && payload.exposureWaterfall;
  const ceiling = numOrNull(wf && wf.ceiling && wf.ceiling.value);
  if (ceiling == null) return;
  for (const occ of amounts) {
    if (occ.value !== ceiling) continue;
    if (nearWord(text, occ.index, 'ceiling', CEILING_PROXIMITY_CHARS)) continue;
    out.push({ rule: 'exposure-headline', detail: 'the statutory ceiling figure ' + formatGBP(ceiling) + ' appears as a bare headline figure (not within ' + CEILING_PROXIMITY_CHARS + ' chars of the word "ceiling"); a raw statutory cap must never headline (C-094/C-096).' });
    return; // one occurrence is enough to prove the disease
  }
}
function checkExposureHeadline(payload, text, amounts, out) {
  checkExposureHeadlinePresence(payload, amounts, out);
  checkExposureCeilingNotBare(payload, text, amounts, out);
}

// ── rule 3: money-provenance (C-112 / C-114 / C-115; consistency-error) ───────────────────────────────────
// addNumbersFrom(node, keys, add) -> add each named numeric field of node.
function addNumbersFrom(node, keys, add) {
  if (!node || typeof node !== 'object') return;
  for (const k of keys) add(node[k]);
}
// addEnforcementNumbers(entries, add) -> add the money figure each enforcement entry carries. Object entries
// are limited to ENFORCEMENT_MONEY_FIELDS (never every key: a year or count is not a legitimate GBP source,
// CodeRabbit truth-pack.js:206); a non-object entry (defensive: malformed input) is added directly, matching
// the "the entry itself IS the figure" shape the pure checker never assumes cannot occur.
function addEnforcementNumbers(entries, add) {
  for (const e of arr(entries)) {
    if (!e || typeof e !== 'object') { add(e); continue; }
    addNumbersFrom(e, ENFORCEMENT_MONEY_FIELDS, add);
  }
}
// addRecordAmounts(rec, add) -> the penalty band (typical low/high plus the statutory maximum) and
// enforcement amounts a finding or a framework card carries. It reads them through dot access on the injected
// payload node, never as an assignment or object-literal key, so this consumer stays a consumer and is
// invisible to the one-door fine-literal scan (Rule 2: fines have one door, the catalogue).
function addRecordAmounts(rec, add) {
  if (!rec || typeof rec !== 'object') return;
  addNumbersFrom(rec.penalty, ['typical_low', 'typical_high', 'statutory_max', 'amount'], add);
  addEnforcementNumbers(rec.enforcement, add);
}
// addHeadlineAmounts(payload, add) -> the exposure headline/full figures and the single statutory ceiling.
function addHeadlineAmounts(payload, add) {
  add(payload.exposure && payload.exposure.value);
  add(payload.exposureFull && payload.exposureFull.value);
  const wf = payload.exposureWaterfall || {};
  add(wf.ceiling && wf.ceiling.value);
}
// addWaterfallStepAmounts(payload, add) -> every per-family band bound and ceiling in the exposure waterfall.
function addWaterfallStepAmounts(payload, add) {
  const wf = payload.exposureWaterfall || {};
  for (const s of arr(wf.steps)) addNumbersFrom(s, ['typical_low', 'typical_high', 'familyCeiling'], add);
}
// collectAllowedAmounts(payload) -> the Set of every GBP figure the render is PERMITTED to show: the exposure
// headline and full figures, every waterfall band bound and per-family ceiling, the single statutory ceiling,
// and every penalty/enforcement amount carried by a finding or a framework card (the applicable-record
// projection). Any rendered amount outside this set has no payload source and is a fabrication.
function collectAllowedAmounts(payload) {
  const set = new Set();
  const add = (v) => { const n = numOrNull(v); if (n != null) set.add(n); };
  const p = payload || {};
  addHeadlineAmounts(p, add);
  addWaterfallStepAmounts(p, add);
  for (const f of arr(p.findings)) addRecordAmounts(f, add);
  for (const c of arr(p.frameworks)) addRecordAmounts(c, add);
  return set;
}
function checkMoneyProvenance(payload, amounts, out) {
  const allowed = collectAllowedAmounts(payload);
  const flagged = new Set();
  for (const a of amounts) {
    if (allowed.has(a.value) || flagged.has(a.value)) continue;
    flagged.add(a.value);
    out.push({ rule: 'money-provenance', detail: 'the rendered amount ' + formatGBP(a.value) + ' has no source in the payload (not the exposure headline/full, a waterfall band, the ceiling, or any finding/record penalty or enforcement figure); a rendered figure with no payload provenance is a fabrication (C-112/C-114/C-115).' });
  }
}

// ── rule 4: framework-provenance (Rule 10 missing-finding + Rule 2 rogue-name; consistency-error) ─────────
// addFindingNames(payload, addName) -> every finding's framework name.
function addFindingNames(payload, addName) {
  for (const f of arr(payload.findings)) addName(f && f.framework);
}
// addAssessedNames(payload, addName) -> every applicability-assessed record's framework name.
function addAssessedNames(payload, addName) {
  for (const a of arr(payload.applicability && payload.applicability.assessed)) addName(a && a.framework);
}
// addFrameworkCardNames(payload, addName) -> every framework card's name.
function addFrameworkCardNames(payload, addName) {
  for (const c of arr(payload.frameworks)) addName(c && c.name);
}
// addCatalogueNames(opts, addName) -> any injected catalogue name (opts.catalogueNames / opts.catalogue).
function addCatalogueNames(opts, addName) {
  for (const n of arr(opts && opts.catalogueNames)) addName(n);
  for (const rec of arr(opts && opts.catalogue)) addName(rec && rec.name);
}
// allowedLawNames(payload, opts) -> the closed set of names a render may show a statute title for: every
// finding framework, every assessed-record framework, every framework-card name, plus any injected catalogue
// name (opts.catalogueNames: string[]; opts.catalogue: [{name}]). Lower-cased for comparison.
function allowedLawNames(payload, opts) {
  const names = new Set();
  const addName = (v) => { const s = normaliseWs(v).toLowerCase(); if (s) names.add(s); };
  const p = payload || {};
  addFindingNames(p, addName);
  addAssessedNames(p, addName);
  addFrameworkCardNames(p, addName);
  addCatalogueNames(opts, addName);
  return names;
}
// addFindingRows(payload, rows) -> a { name, state } row for every finding.
function addFindingRows(payload, rows) {
  for (const f of arr(payload.findings)) rows.push({ name: normaliseWs(f && f.framework), state: f && f.state });
}
// addAssessedRows(payload, rows) -> a { name, state } row for every applicability-assessed record.
function addAssessedRows(payload, rows) {
  for (const a of arr(payload.applicability && payload.applicability.assessed)) rows.push({ name: normaliseWs(a && a.framework), state: a && a.state });
}
// nameShownFindings(payload) -> [{ name, state }] for every finding AND assessed record whose name the render
// must show (Rule 10: a rendered page shows every finding). De-duped by name+state upstream by the caller.
function nameShownFindings(payload) {
  const p = payload || {};
  const rows = [];
  addFindingRows(p, rows);
  addAssessedRows(p, rows);
  return rows;
}
// isNameableRow(row) -> the row carries a name at all (a nameless row cannot be checked against the render).
function isNameableRow(row) { return Boolean(row && row.name); }
// isFindingWorthyState(state) -> the state the render must show a name for (Rule 10: violation/needs_review).
function isFindingWorthyState(state) { return state === 'violation' || state === 'needs_review'; }
function checkFrameworkMissing(payload, text, out) {
  const seen = new Set();
  for (const row of nameShownFindings(payload)) {
    if (!isNameableRow(row)) continue;
    if (!isFindingWorthyState(row.state)) continue;
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!textIncludes(text, row.name)) {
      out.push({ rule: 'framework-provenance', detail: 'the framework "' + row.name + '" carries a ' + row.state + ' finding but its name is not shown in the render; a rendered page must show every finding (Rule 10).' });
    }
  }
}
// nameMatches(candidateLower, allowedSet) -> true when the candidate overlaps a permitted name in either
// direction (a fragment of a real title, or a real title embedded in a longer capture): substring either way.
function nameMatches(candidateLower, allowedSet) {
  for (const a of allowedSet) { if (a.indexOf(candidateLower) !== -1 || candidateLower.indexOf(a) !== -1) return true; }
  return false;
}
function checkFrameworkRogue(payload, text, opts, out) {
  const allowed = allowedLawNames(payload, opts);
  const seen = new Set();
  for (const m of str(text).matchAll(LAW_NAME_SHAPE)) {
    const cand = normaliseWs(m[0]);
    const key = cand.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!nameMatches(key, allowed)) {
      out.push({ rule: 'framework-provenance', detail: 'the render shows a law-name-shaped string "' + cand + '" that matches no framework in the payload or injected catalogue; no law title may be rendered outside the closed catalogue set (Rule 2 / C-112).' });
    }
  }
}

// ── rule 5: voice (Rule 10 / C-111; consistency-error) ────────────────────────────────────────────────────
function needsReviewNames(payload) {
  const names = [];
  for (const f of arr(payload && payload.findings)) {
    if (f && f.state === 'needs_review') { const n = normaliseWs(f.framework); if (n) names.push(n); }
  }
  return names;
}
// voiceWindow(at, keyLen, lower) -> the [from, to) character span bracketing one name occurrence, and the
// lower-cased slice of render text within it (VOICE_WINDOW chars either side of the occurrence).
function voiceWindow(at, keyLen, lower) {
  const from = Math.max(0, at - VOICE_WINDOW);
  const to = Math.min(lower.length, at + keyLen + VOICE_WINDOW);
  return { from, to, win: lower.slice(from, to) };
}
// checkVoiceConfidentToken(name, win, out) -> a confident-breach phrase sits inside this occurrence's window.
function checkVoiceConfidentToken(name, win, out) {
  const tok = CONFIDENT_BREACH_TOKENS.find((t) => win.indexOf(t) !== -1);
  if (!tok) return;
  out.push({ rule: 'voice', detail: 'the needs-review framework "' + name + '" renders within ' + VOICE_WINDOW + ' chars of the confident-breach phrase "' + tok + '"; review-band items must render distinctly from confirmed breaches (Rule 10 / C-111).' });
}
// checkVoiceWithheldExposure(ctx, out) -> the confirmed headline exposure sits inside this occurrence's
// window (the confirmed-breach exposure figure must be withheld from a review item, C-111). The `.some(...)`
// membership test is resolved into a plain boolean BEFORE the `if`, so the branch itself stays a single
// checked condition (no compound conditional to flag).
function checkVoiceWithheldExposure(ctx, out) {
  const { name, amounts, confirmedExposure, from, to } = ctx;
  if (confirmedExposure == null) return;
  if (confirmedExposure <= 0) return;
  const withheldFigureShown = amounts.some((a) => a.value === confirmedExposure && a.index >= from && a.index < to);
  if (!withheldFigureShown) return;
  out.push({ rule: 'voice', detail: 'the confirmed headline exposure ' + formatGBP(confirmedExposure) + ' renders attached to the needs-review framework "' + name + '" (within ' + VOICE_WINDOW + ' chars); the confirmed-breach exposure figure is withheld from a review item (C-111).' });
}
// checkVoiceOccurrence(ctx, out) -> both voice checks for ONE occurrence of ONE needs-review name.
function checkVoiceOccurrence(ctx, out) {
  const { at, keyLen, lower } = ctx;
  const { from, to, win } = voiceWindow(at, keyLen, lower);
  checkVoiceConfidentToken(ctx.name, win, out);
  checkVoiceWithheldExposure(Object.assign({}, ctx, { from, to }), out);
}
function checkVoice(payload, text, amounts, out) {
  const lower = str(text).toLowerCase();
  const confirmedExposure = numOrNull(payload && payload.exposure && payload.exposure.value);
  const seen = new Set();
  for (const name of needsReviewNames(payload)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const at of allIndexOf(lower, key)) {
      checkVoiceOccurrence({ name, at, keyLen: key.length, lower, amounts, confirmedExposure }, out);
    }
  }
}

// ── rule 6: counts-coherence (C-117 / C-118; coverage-truth) ──────────────────────────────────────────────
// checkCoherenceCount(text, value, label, out) -> one counts-object figure must appear as a standalone
// token in the render, or the coverage copy has drifted from the counts it claims to state (C-117).
function checkCoherenceCount(text, value, label, out) {
  if (value == null) return;
  if (containsNumberToken(text, value)) return;
  out.push({ rule: 'counts-coherence', detail: 'the render does not show ' + label + ' (' + value + '); every displayed count derives from the one counts object (C-117).' });
}
function checkCountsCoherence(payload, text, out) {
  const p = payload || {};
  checkCoherenceCount(text, numOrNull(p.frameworksBinding), 'frameworksBinding', out);
  checkCoherenceCount(text, numOrNull(p.frameworksAssessed), 'frameworksAssessed', out);
  checkCoherenceCount(text, numOrNull(p.rulesChecked), 'rulesChecked', out);
  const label = normaliseWs(p.screenedLabel);
  if (!label) return;
  if (textIncludes(text, label)) return;
  out.push({ rule: 'counts-coherence', detail: 'the screened-coverage label ("' + label + '") is not present; coverage copy must state the screened label from live counts, never a magic total (C-118).' });
}

// ── rule 7: render-security-freshness (C-122; render-security-freshness) ──────────────────────────────────
function checkFreshness(opts, out) {
  const maxAgeDays = Number.isFinite(opts.maxAgeDays) ? opts.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
  if (opts.generatedAt == null) {
    out.push({ rule: 'render-security-freshness', detail: 'opts.generatedAt was not supplied; render freshness cannot be proven, so it is not fresh (fail closed, C-122/Rule 15).' });
    return;
  }
  const gen = parseTimeMs(opts.generatedAt);
  const now = parseTimeMs(opts.now);
  if (gen == null) {
    out.push({ rule: 'render-security-freshness', detail: 'opts.generatedAt ("' + str(opts.generatedAt).slice(0, 40) + '") is not a parseable timestamp; freshness cannot be proven (fail closed).' });
    return;
  }
  if (now == null) {
    out.push({ rule: 'render-security-freshness', detail: 'opts.now (the injected clock) was not supplied or not parseable; the pure checker reads no ambient clock, so freshness cannot be evaluated without it.' });
    return;
  }
  const ageDays = (now - gen) / MS_PER_DAY;
  if (ageDays > maxAgeDays) {
    out.push({ rule: 'render-security-freshness', detail: 'the render is ' + Math.floor(ageDays) + ' days old (generatedAt ' + str(opts.generatedAt).slice(0, 20) + '), over the ' + maxAgeDays + '-day freshness cap; a superseded page must not serve as current (C-122/C-123).' });
  } else if (ageDays < -1) {
    out.push({ rule: 'render-security-freshness', detail: 'the render is dated ' + Math.abs(Math.floor(ageDays)) + ' days in the FUTURE relative to the injected clock (generatedAt ' + str(opts.generatedAt).slice(0, 20) + '); a future-dated render is not a fresh one (fail closed).' });
  }
}
function checkSecurity(opts, out) {
  if (!opts.requireHmac) return; // STAYS FALSE until the website binds AUDIT_HMAC_SECRET end-to-end (C-122).
  const params = urlParams(opts.url);
  if (!params) {
    out.push({ rule: 'render-security-freshness', detail: 'opts.requireHmac is set but opts.url is missing or unparseable; the per-recipient HMAC access gate cannot be verified (C-122).' });
    return;
  }
  const missing = ['sig', 'exp'].filter((k) => !params.has(k));
  if (missing.length) {
    out.push({ rule: 'render-security-freshness', detail: 'opts.requireHmac is set but the URL lacks the ' + missing.join(' and ') + ' parameter(s); the HMAC gate must be enforced end-to-end, never left as theatre (C-122).' });
  }
}

/**
 * check(payload, renderedText, opts) -> { ok, violations: [{ rule, detail }] }. PURE. Runs all seven render
 * truth-pack rules against the payload the mint composed and the visible text of the rendered page. `ok` is
 * true only when zero rules fired. Never throws.
 *   opts = { catalogueNames?, catalogue?, now?, generatedAt?, maxAgeDays?, requireHmac?, url? }
 */
function check(payload, renderedText, opts) {
  const o = opts || {};
  const text = typeof renderedText === 'string' ? renderedText : '';
  const amounts = parseGBPAmounts(text);
  const violations = [];
  checkNotLegalAdvice(payload, text, violations);
  checkExposureHeadline(payload, text, amounts, violations);
  checkMoneyProvenance(payload, amounts, violations);
  checkFrameworkMissing(payload, text, violations);
  checkFrameworkRogue(payload, text, o, violations);
  checkVoice(payload, text, amounts, violations);
  checkCountsCoherence(payload, text, violations);
  checkFreshness(o, violations);
  checkSecurity(o, violations);
  return { ok: violations.length === 0, violations };
}

module.exports = {
  check,
  // exported for the spec harness (pure helpers + the render contract's shared formatter; never fact producers):
  formatGBP,
  parseGBPAmounts,
  collectAllowedAmounts,
  allowedLawNames,
  containsNumberToken,
  CEILING_PROXIMITY_CHARS,
  VOICE_WINDOW,
  DEFAULT_MAX_AGE_DAYS,
  CONFIDENT_BREACH_TOKENS,
  LAW_NAME_SHAPE,
};
