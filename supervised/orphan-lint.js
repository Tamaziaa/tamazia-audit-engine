'use strict';
// supervised/orphan-lint.js - THE no-orphan-claims lint (Kimi K3 round-3 spec section 2 row 7, section 5
// item 5): given a drafted report (Claude's stage-7 output) and the payload of shipped findings, fail if
// any factual sentence does not cite a finding_id or an artifact. Also enforces the banned-phrase list:
// the strongest accusatory phrasing is reserved for the top verdict tier (CONFIRMED); everything else must
// render in the softened, observational voice the Constitution's Rule 10 already names ("evidenced on your
// live site" is earned voice; a needs-review/likely finding gets "potential issue identified by automated
// analysis" or equivalent).
//
// This is a LINT, not a rewriter: it never edits the drafted text, it only reports violations with enough
// detail (sentence, reason) for the orchestrator (or a human) to fix the draft before the packet step runs.

// BANNED_PHRASES: reserved for CONFIRMED-tier findings only. Case-insensitive whole-phrase match.
const BANNED_PHRASES = Object.freeze([
  'illegal', 'in breach', 'is breaking the law', 'you are breaking the law', 'unlawful', 'criminal offence',
]);

// SOFTENED_EQUIVALENT: the required substitute phrasing for a lower tier (used only to illustrate the fix
// in a violation's `suggestion` field - the lint never rewrites text itself).
const SOFTENED_EQUIVALENT = 'potential issue identified by automated analysis';

// FINDING_ID_RE / ARTIFACT_ID_RE: a citation is any bracketed or parenthetical token that names a
// finding_id (16 hex chars, this repo's deriveFindingId() output length) or an evidence_id of the same
// shape, OR the literal word "Finding" / "Evidence" followed by an id-looking token. Deliberately liberal
// (this lint's job is to catch a sentence with NO citation at all, not to police citation formatting).
const CITATION_RE = /\b(?:finding|evidence)[\s:#-]*([a-f0-9]{6,32})\b/i;
const BARE_ID_RE = /\b[a-f0-9]{16}\b/i;

// splitSentences(text) -> a naive but adequate sentence split for a compliance-report draft (splits on
// '. '/'.\n'/'!'/'?' followed by whitespace or end of string; keeps the terminator on the sentence).
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// isFactualSentence(sentence) -> a light heuristic: a sentence is treated as a FACTUAL CLAIM (and thus
// required to carry a citation) when it contains a verb suggesting an assertion about the audited site
// ('found', 'detected', 'shows', 'displays', 'fails to', 'does not', 'breaches', 'lacks', 'missing',
// 'observed') rather than pure scaffolding prose ('This report covers...', headings, boilerplate). A
// deliberately conservative heuristic: it is meant to catch orphaned accusations, not to police every
// sentence in the document; a false "needs citation" is a cheaper failure mode than a false "this is fine".
const CLAIM_VERBS = /\b(found|detected|shows?|displays?|fails? to|does not|breaches?|lacks?|missing|observed|is regulated|does provide|has published)\b/i;
function isFactualSentence(sentence) {
  return CLAIM_VERBS.test(sentence);
}

function hasCitation(sentence, knownFindingIds) {
  const m = sentence.match(CITATION_RE);
  if (m && knownFindingIds.has(m[1].toLowerCase())) return true;
  const bare = sentence.match(BARE_ID_RE);
  if (bare && knownFindingIds.has(bare[0].toLowerCase())) return true;
  return false;
}

function findingTierOf(findingId, findingsById) {
  const f = findingsById.get(String(findingId || '').toLowerCase());
  return f ? f.class : null;
}

// lintBannedPhrases(sentence, findingsById) -> violation|null. A banned phrase is only ever legitimate when
// the sentence cites a CONFIRMED-class finding; anywhere else (no citation, or a likely/needs_human
// citation) it is a violation.
function lintBannedPhrases(sentence) {
  const lower = sentence.toLowerCase();
  const hit = BANNED_PHRASES.find((p) => lower.includes(p));
  if (!hit) return null;
  return { type: 'banned_phrase', phrase: hit, sentence, suggestion: 'reserve "' + hit + '" for a CONFIRMED-tier citation only; otherwise use "' + SOFTENED_EQUIVALENT + '"' };
}

// lintNoOrphanClaims(reportText, findings) -> { ok, violations: [{type, sentence, ...}] }.
//   - orphan_claim: a factual sentence with no finding/evidence citation at all.
//   - banned_phrase: a top-tier phrase used without a CONFIRMED-class citation backing it.
//   - banned_phrase_wrong_tier: a top-tier phrase citing a real finding that is NOT class CONFIRMED.
function lintNoOrphanClaims(reportText, findings) {
  const list = Array.isArray(findings) ? findings : [];
  const findingsById = new Map(list.map((f) => [String(f.finding_id).toLowerCase(), f]));
  const knownFindingIds = new Set(findingsById.keys());
  const violations = [];

  for (const sentence of splitSentences(reportText)) {
    if (isFactualSentence(sentence) && !hasCitation(sentence, knownFindingIds)) {
      violations.push({ type: 'orphan_claim', sentence, reason: 'factual sentence cites no finding_id or artifact' });
      continue; // an orphaned sentence is reported once; do not double-count the banned-phrase check on it
    }
    const banned = lintBannedPhrases(sentence);
    if (banned) {
      const m = sentence.match(CITATION_RE) || sentence.match(BARE_ID_RE);
      const citedId = m ? (m[1] || m[0]).toLowerCase() : null;
      const tier = citedId ? findingTierOf(citedId, findingsById) : null;
      if (tier !== 'confirmed') {
        violations.push(Object.assign({}, banned, { type: citedId ? 'banned_phrase_wrong_tier' : 'banned_phrase', cited_tier: tier }));
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

module.exports = { lintNoOrphanClaims, BANNED_PHRASES, SOFTENED_EQUIVALENT, splitSentences };
