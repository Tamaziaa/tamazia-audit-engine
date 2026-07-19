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
// finding_id (16 hex chars, this repo's deriveFindingId() output length) or an evidence_id/artifact hash of
// the same general shape, OR the literal word "Finding" / "Evidence" followed by an id-looking token.
// Deliberately liberal (this lint's job is to catch a sentence with NO citation at all, not to police
// citation formatting).
//
// Kimi K3 finding O3 (live audit 2026-07-20): this module's own header promises a citation is a finding_id
// OR AN ARTIFACT, but the old bounds (CITATION_RE capped at 32 hex chars, BARE_ID_RE required EXACTLY 16)
// could never match a full 64-char sha256 artifact hash (capture-index.js's own `sha256` field on every
// captured artifact) - a report citing an artifact by its real hash was unmatchable by either regex, and
// hasCitation() only ever checked finding_ids in the first place (see its own doc below). Both bounds now
// run up to 64 hex chars (finding_id=16, evidence_id=16, sha256=64 - one shared upper bound covers all
// three without narrowing what still counts as "an id-shaped token"), and hasCitation() accepts a caller-
// supplied artifact id set alongside finding ids.
const CITATION_RE = /\b(?:finding|evidence)[\s:#-]*([a-f0-9]{6,64})\b/i;
const BARE_ID_RE = /\b[a-f0-9]{6,64}\b/i;

// LIST_MARKER_BREAK_RE: a single newline is a real sentence boundary when the NEXT line opens with a list
// marker ('-', '*', '•', or a numbered/lettered marker like '1.'/'2)') - Kimi K3 finding HIGH-6, live audit
// 2026-07-20: the old split only broke on '\n\n' or on '. '+capital, so two bullet lines separated by ONE
// newline (a normal Markdown-style list, e.g. a drafted report's own bullet findings) were glued into a
// SINGLE "sentence" for citation purposes - a citation on the FIRST bullet made hasCitation() see it
// anywhere in the glued blob and silently cover an UNCITED second bullet's claim right beside it.
const LIST_MARKER_BREAK_RE = '\\n(?=\\s*(?:[-*•]|\\d+[.)])\\s)';

// splitSentences(text) -> a naive but adequate sentence split for a compliance-report draft: splits on
// '. '/'.\n'/'!'/'?' followed by whitespace+capital/digit/quote, on a blank line ('\n\n'+), OR on a single
// newline immediately before a list-marker-opened line (see LIST_MARKER_BREAK_RE above) - keeps the
// terminator on the sentence.
function splitSentences(text) {
  const re = new RegExp('(?<=[.!?])\\s+(?=[A-Z0-9"\'])|\\n{2,}|' + LIST_MARKER_BREAK_RE);
  return String(text || '')
    .split(re)
    .map((s) => s.trim())
    .filter(Boolean);
}

// isFactualSentence(sentence) -> a light heuristic: a sentence is treated as a FACTUAL CLAIM (and thus
// required to carry a citation) when it contains a verb suggesting an assertion about the audited site
// ('found', 'detected', 'shows', 'displays', 'fails to', 'does not', 'breaches', 'lacks', 'missing',
// 'observed', 'promises', 'claims', 'states', 'advertises', 'guarantees', 'offers', 'asserts',
// 'represents') rather than pure scaffolding prose ('This report covers...', headings, boilerplate). A
// deliberately conservative heuristic: it is meant to catch orphaned accusations, not to police every
// sentence in the document; a false "needs citation" is a cheaper failure mode than a false "this is fine".
//
// Kimi K3 finding HIGH-6 (live audit 2026-07-20): the original verb list had no MARKETING/PROMISE verbs at
// all, so a factual claim about the audited site's own content phrased as "Your homepage promises
// guaranteed returns." - the exact class of sentence a fin-promo/consumer-protection finding would need to
// cite - required no citation whatsoever and slipped past the lint entirely.
const CLAIM_VERBS = /\b(found|detected|shows?|displays?|fails? to|does not|breaches?|lacks?|missing|observed|is regulated|does provide|has published|promises?|claims?|states?|advertises?|guarantees?|offers?|asserts?|represents?)\b/i;
function isFactualSentence(sentence) {
  return CLAIM_VERBS.test(sentence);
}

// hasCitation(sentence, knownIds) -> true when `sentence` names a REAL id from `knownIds` - either a
// finding_id (via createFinding()'s output) or an artifact id (evidence_id/sha256, Kimi K3 finding O3: the
// module's own header promises "finding_id OR an artifact", so `knownIds` is the UNION of both sets, built
// once by lintNoOrphanClaims() below, never finding_ids alone).
function hasCitation(sentence, knownIds) {
  const m = sentence.match(CITATION_RE);
  if (m && knownIds.has(m[1].toLowerCase())) return true;
  const bare = sentence.match(BARE_ID_RE);
  if (bare && knownIds.has(bare[0].toLowerCase())) return true;
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

// citedFindingIdIn(sentence) -> the lowercased finding/evidence id a sentence cites, via either the
// "Finding <id>" phrasing or a bare 16-hex token, or null when it cites nothing id-shaped.
function citedFindingIdIn(sentence) {
  const m = sentence.match(CITATION_RE) || sentence.match(BARE_ID_RE);
  return m ? (m[1] || m[0]).toLowerCase() : null;
}

// bannedPhraseViolation(sentence, findingsById) -> a violation object when `sentence` uses a banned
// phrase without a CONFIRMED-tier citation backing it, else null. A citation to a real but non-CONFIRMED
// finding is `banned_phrase_wrong_tier`; no citation at all is the plain `banned_phrase` type.
function bannedPhraseViolation(sentence, findingsById) {
  const banned = lintBannedPhrases(sentence);
  if (!banned) return null;
  const citedId = citedFindingIdIn(sentence);
  const tier = citedId ? findingTierOf(citedId, findingsById) : null;
  if (tier === 'confirmed') return null;
  return Object.assign({}, banned, { type: citedId ? 'banned_phrase_wrong_tier' : 'banned_phrase', cited_tier: tier });
}

// violationForSentence(sentence, findingsById, knownIds) -> the ONE violation (if any) a single sentence
// produces. An orphaned factual claim is reported once and never ALSO checked for a banned phrase (an
// uncited sentence is already the worse finding; double-counting it would just be noise).
function violationForSentence(sentence, findingsById, knownIds) {
  if (isFactualSentence(sentence) && !hasCitation(sentence, knownIds)) {
    return { type: 'orphan_claim', sentence, reason: 'factual sentence cites no finding_id or artifact' };
  }
  return bannedPhraseViolation(sentence, findingsById);
}

// lintNoOrphanClaims(reportText, findings, artifactIds) -> { ok, violations: [{type, sentence, ...}] }.
//   - orphan_claim: a factual sentence with no finding/evidence citation at all.
//   - banned_phrase: a top-tier phrase used without a CONFIRMED-class citation backing it.
//   - banned_phrase_wrong_tier: a top-tier phrase citing a real finding that is NOT class CONFIRMED.
//
// `artifactIds` (Kimi K3 finding O3, live audit 2026-07-20) is an OPTIONAL iterable of real artifact ids
// (e.g. every captured artifact's evidence_id/sha256 for this run - bin/engine.js's `cmdPacket` wires the
// run's own ArtifactStore through here) - a citation to a real artifact satisfies hasCitation() exactly like
// a citation to a real finding_id, matching this module's own documented promise ("cite a finding_id or an
// artifact"). Omitting it preserves the OLD (finding-ids-only) behaviour for any caller that has no
// artifact set to hand - this is purely additive, never a narrowing of what already passed.
function lintNoOrphanClaims(reportText, findings, artifactIds) {
  const list = Array.isArray(findings) ? findings : [];
  const findingsById = new Map(list.map((f) => [String(f.finding_id).toLowerCase(), f]));
  const knownIds = new Set(findingsById.keys());
  for (const id of (artifactIds || [])) knownIds.add(String(id).toLowerCase());
  const violations = splitSentences(reportText)
    .map((sentence) => violationForSentence(sentence, findingsById, knownIds))
    .filter(Boolean);
  return { ok: violations.length === 0, violations };
}

module.exports = { lintNoOrphanClaims, BANNED_PHRASES, SOFTENED_EQUIVALENT, splitSentences };
