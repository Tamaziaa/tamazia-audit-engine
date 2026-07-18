'use strict';
/**
 * pattern-match.js - the anchoring + matching primitives for the breach proposer layer.
 *
 * A DetectionSpec (detection-spec.js) carries patterns as plain data ({kind, value}); this module is
 * how those patterns are ANCHORED (compiled to \b-bounded regex sources) and MATCHED against text.
 * Extracted from detection-spec.js so the pattern grammar and the matcher are separate, focused units.
 *
 * LINEAR-TIME by construction (Rob P0: the old 'all' token-set compiled to
 * `(?=[\s\S]*t1)(?=[\s\S]*t2)...[\s\S]`, which backtracked catastrophically on real corpora -
 * NY_RPC_7_3_7_4 hung, CA_RPC_CH7 / IL_RPC_7 ~6-8s). No matcher here ever builds a co-occurrence
 * mega-regex: a token-set is tested token by token (each `\bword\b` is a bounded literal, no
 * backtracking blowup), combined by some()/every(); an anchored-regex is a `\b`-bounded word run
 * joined by `\W+` (linear). validateSpec's ReDoS guard (detection-spec.js) rejects any stored
 * anchored-regex that reintroduces a lookaround or an unbounded .* / [\s\S]* star.
 *
 * Pure and synchronous (no network/clock/env). Holds NO law/fine/regulator literal (Rule 2).
 */

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

// compileRegex(pattern) -> a case-insensitive RegExp for a pattern, or null if it cannot compile. A null
// here is surfaced by validateSpec as a rejected spec, never swallowed (the C-050 dead-regex class).
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

// regexSourceOf(pattern) -> the single-regex source a pattern compiles to: an anchored-regex is its
// value; a token-set 'any' is an anchored alternation; a token-set 'all' has no safe single-regex form
// (returns null, matched linearly in matchesText); a url-path is matched by propose.js, not here.
function regexSourceOf(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  if (pattern.kind === 'anchored-regex') return typeof pattern.value === 'string' ? pattern.value : null;
  if (pattern.kind === 'token-set') return tokenSetSource(pattern.value);
  return null;
}

// tokenSetSource(value) -> a SINGLE-regex source for a token-set, or null when there is no linear-time
// single-regex form. 'any' is a plain anchored alternation (linear). 'all' (co-occurrence, any order)
// has NO safe single-regex form - the old lookahead-with-[\s\S]* backtracked catastrophically (Rob P0)
// and a permutation alternation is exponential - so it returns null and is matched token-by-token in
// matchesText(). No derived pattern ever contains an unbounded lookahead-dot-star again.
function tokenSetSource(value) {
  const tokens = value && Array.isArray(value.tokens) ? value.tokens : null;
  if (!tokens || !tokens.length) return null;
  if (value.mode === 'any') return '(?:' + tokens.map(anchorToken).join('|') + ')';
  return null; // 'all' co-occurrence is matched linearly in matchesText, never as a mega-regex
}

// tokenContains(text, token) -> is the single anchored token present in text. LINEAR: `\bword\b` is a
// literal with boundaries and has no backtracking blowup.
function tokenContains(text, token) {
  let re;
  try { re = new RegExp(anchorToken(token), 'i'); }
  catch (_err) {
    // FAIL-OPEN: a token that cannot compile to a RegExp is treated as NO-MATCH (the fail-closed
    // direction: never a false breach match). Not swallowed silently - validateSpec's does-not-compile
    // check rejects the spec that produced such a token (C-050), so the real defect surfaces there.
    return false;
  }
  return re.test(text);
}

// matchesText(pattern, text) -> does a pattern match `text`, in GUARANTEED LINEAR time. THE one text
// matcher propose.js calls (one door): a token-set is tested token by token, combined by some() ('any')
// or every() ('all') - NEVER a co-occurrence mega-regex (the ReDoS Rob P0 fixed). An anchored-regex is
// a `\b`-bounded word run (linear). A url-path is matched by propose.js against page URLs, not here.
function matchesText(pattern, text) {
  if (!pattern || typeof pattern !== 'object') return false;
  const hay = String(text == null ? '' : text);
  if (pattern.kind === 'token-set') {
    const tokens = pattern.value && Array.isArray(pattern.value.tokens) ? pattern.value.tokens : [];
    if (!tokens.length) return false;
    const hit = (t) => tokenContains(hay, t);
    return pattern.value.mode === 'any' ? tokens.some(hit) : tokens.every(hit);
  }
  if (pattern.kind === 'anchored-regex') {
    const re = compileRegex(pattern);
    return re ? re.test(hay) : false;
  }
  return false;
}

module.exports = {
  escapeRegex,
  anchorToken,
  buildAnchoredRegex,
  compileRegex,
  regexSourceOf,
  tokenSetSource,
  tokenContains,
  matchesText,
};
