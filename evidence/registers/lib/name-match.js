'use strict';
// evidence/registers/lib/name-match.js — the ONE name-match algorithm every register module in this
// directory shares (Constitution C-004): a register row may be returned ONLY on a genuine name match
// against the query, never merely because an API answered HTTP 200 with a non-empty body. Ported and
// strengthened from the old estate's register-check.js / register-grounding.js, which accepted ANY
// non-empty response as establishment evidence, and ico-register.js's SQL prefix match, which had no
// scoring and no rejection of a merely-similar name.
//
// ALGORITHM: normalise both names (lowercase, "&" -> "and", strip legal-entity suffixes via the one
// vocabulary door facts/vocabulary.js, collapse whitespace), tokenise on non-alphanumeric boundaries
// dropping short/connective tokens, then score by Jaccard similarity (shared tokens divided by the
// union of tokens). A match requires the score to clear MATCH_THRESHOLD AND at least one shared
// token. This is deliberately NOT a substring or prefix test (a substring/prefix match on a
// host/name is the C-059 class this codebase bans lint-wide) and deliberately not "any shared word",
// which is exactly what let a register hit attach to an unrelated company in the old estate sharing
// only a generic first word.
//
// THRESHOLD JUSTIFICATION (MATCH_THRESHOLD = 0.6):
//  - An exact or suffix-only-differing name (the overwhelming common case: the query and the register
//    row differ only by a legal suffix such as LLP/Ltd) normalises to identical token sets, so the
//    score is 1.0.
//  - A register variant carrying one extra token the query lacks (a common real shape: the query is a
//    shortened trading name and the register row spells out a fuller form) still clears the threshold
//    with margin: two shared tokens out of a three-token union scores 0.667.
//  - A two-word query sharing only its FIRST word with an unrelated two-word candidate — the
//    "Kingsley Napley LLP" vs "Kingsley Carpets Ltd" class this module exists to reject — scores
//    0.333 (one shared token out of a three-token union), comfortably below the threshold.
//  - 0.6 sits in the gap between these two real shapes with margin on both sides; it is not tuned to
//    a single fixture value. See name-match.test.js and the eval/calibration-known-bad/fixtures/
//    p3-register-*.json fixtures for both directions (true positive still fires, near-miss stays
//    rejected).
//
// A single shared token is required even when the ratio alone would pass, as defence in depth for
// very short names; a one-token query matching a one-token candidate exactly already scores 1.0 and
// satisfies both conditions, so this changes nothing for the common short-name case.

let LEGAL_ENTITY_SUFFIXES;
let PUBLIC_SUFFIX_SECOND_LEVEL;
try {
  ({ LEGAL_ENTITY_SUFFIXES, PUBLIC_SUFFIX_SECOND_LEVEL } = require('../../../facts/vocabulary.js'));
} catch (err) {
  // facts/vocabulary.js is the one door for this word list (Constitution Rule 1); if it is ever
  // absent this module must fail closed and loudly rather than silently matching against an empty
  // suffix list, which would make every legal-suffix token count toward the name score and inflate
  // every match.
  throw new Error(
    'evidence/registers/lib/name-match.js: facts/vocabulary.js is required for LEGAL_ENTITY_SUFFIXES '
    + 'and PUBLIC_SUFFIX_SECOND_LEVEL and could not be loaded: ' + err.message
  );
}

const MIN_TOKEN_CHARS = 3;
const MIN_QUERY_LEN = 4; // a normalised query shorter than this is too ambiguous to search safely
const MATCH_THRESHOLD = 0.6;

const CONNECTIVE_WORDS = new Set(['and', 'the', 'of', 'for']);

const SUFFIX_BODY = '\\b(?:'
  + LEGAL_ENTITY_SUFFIXES.map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  + ')\\b\\.?';
const SUFFIX_RX = new RegExp(SUFFIX_BODY, 'gi');

function tidy(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function stripLegalSuffixes(s) {
  return tidy(String(s || '').replace(SUFFIX_RX, ' '));
}

function normaliseName(name) {
  const lowered = String(name || '').toLowerCase().replace(/&/g, ' and ');
  return stripLegalSuffixes(lowered);
}

function tokensOf(name) {
  return normaliseName(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_CHARS && !CONNECTIVE_WORDS.has(t));
}

// queryTooShort(name) -> true when the normalised query carries too little signal to search a
// register safely (mirrors the port source's MIN_CONFIDENT_LEN doctrine: a name stem shorter than
// this matches too many candidates to be evidence).
function queryTooShort(name) {
  return normaliseName(name).replace(/[^a-z0-9]/g, '').length < MIN_QUERY_LEN;
}

// scoreMatch(queryName, candidateName) -> {score, sharedTokens, queryTokens, candidateTokens}. Pure;
// never throws. An empty token set on either side scores 0 (nothing safe to compare).
function scoreMatch(queryName, candidateName) {
  const q = new Set(tokensOf(queryName));
  const c = new Set(tokensOf(candidateName));
  if (q.size === 0 || c.size === 0) {
    return { score: 0, sharedTokens: [], queryTokens: [...q], candidateTokens: [...c] };
  }
  const shared = [...q].filter((t) => c.has(t));
  const union = new Set([...q, ...c]);
  return { score: shared.length / union.size, sharedTokens: shared, queryTokens: [...q], candidateTokens: [...c] };
}

function isNameMatch(queryName, candidateName) {
  const { score, sharedTokens } = scoreMatch(queryName, candidateName);
  return score >= MATCH_THRESHOLD && sharedTokens.length >= 1;
}

// bestCandidate(queryName, candidates, nameOf) -> {candidate, score, matched, nameQueried, nameMatched}
// or null when the candidate list is empty / carries no usable name. Picks the single highest-scoring
// candidate; `matched` tells the caller whether it clears MATCH_THRESHOLD. Callers decide what "no
// acceptable candidate" means for their own row-absence note (C-004: never fabricate a partial row).
function bestCandidate(queryName, candidates, nameOf) {
  let best = null;
  for (const cand of candidates || []) {
    const candName = nameOf(cand);
    if (!candName) continue;
    const { score } = scoreMatch(queryName, candName);
    if (!best || score > best.score) best = { candidate: cand, score, name: candName };
  }
  if (!best) return null;
  return {
    candidate: best.candidate,
    score: best.score,
    matched: best.score >= MATCH_THRESHOLD,
    nameQueried: tidy(queryName),
    nameMatched: best.name,
  };
}

// A minimal, LOCAL, non-authoritative fallback query seed derived from a domain — NOT the identity
// fact (facts/identity.js is the one door for display_name/legal_name, Constitution Rule 1; this
// module never calls it, avoiding an evidence-to-facts-module dependency). Used only to give a
// register search something to query when no company-name hint exists yet: P3 evidence collection
// runs BEFORE identity resolution, not after. Shares its two-level-suffix handling (co.uk, org.uk,
// ...) with facts/identity.js's own domainStem by reading the SAME vocabulary door
// (facts/vocabulary.js's PUBLIC_SUFFIX_SECOND_LEVEL) rather than re-declaring a second copy of that
// list — the list has one door; this is a second, independent algorithm over it, not a second door
// for a fact.
const PUB2 = new Set((PUBLIC_SUFFIX_SECOND_LEVEL || []).map((x) => String(x).toLowerCase()));
function domainStemFallback(domain) {
  let d = String(domain || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
  if (!d) return '';
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length >= 3 && PUB2.has(parts.slice(-2).join('.'))) return parts[parts.length - 3];
  return parts[parts.length - 2];
}

module.exports = {
  MIN_TOKEN_CHARS,
  MIN_QUERY_LEN,
  MATCH_THRESHOLD,
  normaliseName,
  tokensOf,
  queryTooShort,
  scoreMatch,
  isNameMatch,
  bestCandidate,
  domainStemFallback,
};
