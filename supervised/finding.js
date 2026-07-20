'use strict';
// supervised/finding.js - THE typed finding schema v1.2-lite (Kimi K3 round-3 spec section 2, and the
// KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md section 2.2 Verdict/Quote types this factory is a faithful,
// additive subset of). "v1.2-lite" because the full WS0 payload v1.2 finding schema has not merged into
// this repo yet (facts tiers, CoverageManifest, LawRef/PenaltyRef catalogue-validated types); this module
// defines the minimal superset-compatible shape needed for Mint Gate v0, with every field name chosen to
// migrate onto the full schema without a rename when WS0 lands (documented per field below).
//
// THE LOAD-BEARING RULE: a Finding is UNCONSTRUCTIBLE without a resolvable quote. createFinding() is the
// ONLY way to produce a Finding object in this codebase (one door, Constitution Rule 1); it throws
// FindingConstructionError on any missing/malformed required field, so "a finding with no real quote"
// cannot exist as a value anywhere downstream - never merely a convention future code might skip.
//
//   Finding = {
//     finding_id       string, stable id (sha256 of rule_id + quote, so a REPLAY that reproduces the same
//                       quote reproduces the same id - see replay.js).
//     rule_id          string, the catalogue record id this finding proposes evidence against (full
//                       schema: `law_id`; kept as `rule_id` here because that is the field name
//                       breach/proposers/propose.js and applicability/connect.js already use throughout
//                       this repo - Rule 1, no second name for the same fact).
//     catalogue_hash   string, the compiled catalogue's content_hash at the time this finding was made
//                       (catalogue/dist/catalogue.v1.json's own content_hash - NEVER invented, always
//                       copied from the loaded catalogue object handed to the harness).
//     quote            { evidence_id, byte_start, byte_end, span_sha256 } - NEVER a raw string (see
//                       capture-index.js and verify-quote.js for what evidence_id resolves to and how the
//                       range is checked). span_sha256 is a one-way commitment to the exact bytes at
//                       [byte_start, byte_end) in the captured artifact (supervised/quote-resolver.js
//                       computes it at construction; verify-quote.js re-derives and compares it). Without
//                       this commitment a well-formed, in-bounds range can still be DRIFTED to point at
//                       different, innocuous bytes on the same real artifact and pass a bounds+hash-of-
//                       artifact check - the span_sha256 binds a Quote to the SPECIFIC bytes it claims,
//                       not merely to "some real bytes somewhere in this real page" (found live during the
//                       Mint Gate v0 dress rehearsal; see verify-quote.js's own header for the full account).
//     jurisdiction      string, the jurisdiction axis this finding is scoped to (copied from the catalogue
//                       record's own `jurisdiction` field, e.g. 'UK'/'US' - never invented here).
//     class             one of CONFIRMED | LIKELY | NEEDS_HUMAN (the closed enum; see FINDING_CLASS).
//     engine_version    string, defaults to mint/version.js's ENGINE_VERSION when not supplied.
//     mitigation_log    array, defaults to []. Every Claude adversarial-review verdict (stage 6, suppress-
//                       only) that touched this finding is APPENDED here, never overwritten (an audit
//                       trail of every downgrade attempt and its verified/unverifiable outcome).
//   }
//
// Pure: no I/O, no clock (a caller supplies createdAt only if it wants one recorded on the manifest entry,
// not on the Finding itself - the Finding is a fact about evidence, not about wall-clock time).

const crypto = require('crypto');
const { FindingConstructionError } = require('./errors.js');

// FINDING_BRAND: a private WeakSet marking every object createFinding()/withMitigation() actually returned
// (Kimi K3 finding E4, live audit 2026-07-20; mirrors payload/contract/v1_2/core.js's own brands-WeakSet
// idiom, reimplemented locally here rather than imported - Rule 1 does not require sharing a door across
// architecturally separate layers, the same judgement call mint-gate.js's own header already makes for its
// import surface). Without a brand, a hand-built plain object carrying every right-looking field
// (finding_id, rule_id, quote, class, ...) is INDISTINGUISHABLE from a real Finding to any field-level check
// - a look-alike could be fed straight to mint-gate.js and pass every structural test without ever having
// gone through createFinding()'s validation. isFinding(v) is the one way to ask "is this a REAL Finding",
// and mint-gate.js requires it before minting anything.
const FINDING_BRAND = new WeakSet();
function isFinding(v) {
  return typeof v === 'object' && v !== null && FINDING_BRAND.has(v);
}

const FINDING_CLASS = Object.freeze({
  CONFIRMED: 'confirmed',
  LIKELY: 'likely',
  NEEDS_HUMAN: 'needs_human',
});
const FINDING_CLASS_SET = new Set(Object.values(FINDING_CLASS));

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

// SPAN_HASH_RE: a span_sha256 must be a 64-char lowercase-hex string (the crypto.digest('hex') shape).
const SPAN_HASH_RE = /^[0-9a-f]{64}$/;

// Each assertXxx() below owns exactly ONE structural rule and throws FindingConstructionError on its
// own defect, never anyone else's (kept as separate single-purpose functions, rather than one long
// if-chain, purely for readability/reviewability - validateQuote()'s own job is just to call them in
// order, so a reader can see the whole shape contract as a short list of named rules).

// isPlainObject(v) -> true for a real, non-null, non-array object (never a string/array/primitive).
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  return !Array.isArray(v);
}
// assertQuotePlainObject(quote) -> throws unless quote is a plain, non-array object.
function assertQuotePlainObject(quote) {
  if (!isPlainObject(quote)) {
    throw new FindingConstructionError('quote', 'quote is required and must be an object {evidence_id, byte_start, byte_end}, never a raw string');
  }
}
// assertQuoteHasNoRawText(quote) -> throws if a raw quote_text/text field is present (Kimi blueprint
// section 2.2: the quote IS the byte range, never a copy of the words).
function assertQuoteHasNoRawText(quote) {
  // Kimi K3 R2 sniper #35 (live audit 2026-07-20): the guard checked `typeof === 'string'` only, so a
  // non-string raw-text smuggle (`quote_text: 123`, `text: {...}`, `quote_text: null`) slipped straight
  // past it - the presence of the KEY AT ALL is the defect (a Quote is the byte range, it may never carry
  // its own words under any type), so the check is on key presence, not value type.
  if ('quote_text' in quote || 'text' in quote) {
    throw new FindingConstructionError('quote', 'quote must never carry a raw text field (quote_text/text) under any type - the quote IS the byte range, never a copy of the words (Kimi blueprint section 2.2)');
  }
}
// assertQuoteEvidenceId(quote) -> throws unless evidence_id is a non-empty string.
function assertQuoteEvidenceId(quote) {
  if (!isNonEmptyString(quote.evidence_id)) {
    throw new FindingConstructionError('quote.evidence_id', 'quote.evidence_id is required and must be a non-empty string naming a captured artifact');
  }
}
// assertQuoteByteRange(quote) -> throws unless byte_start/byte_end are non-negative integers with
// byte_end strictly greater than byte_start.
function assertQuoteByteRange(quote) {
  if (!isNonNegativeInt(quote.byte_start)) {
    throw new FindingConstructionError('quote.byte_start', 'quote.byte_start is required and must be a non-negative integer');
  }
  if (!isNonNegativeInt(quote.byte_end)) {
    throw new FindingConstructionError('quote.byte_end', 'quote.byte_end is required and must be a non-negative integer');
  }
  if (quote.byte_end <= quote.byte_start) {
    throw new FindingConstructionError('quote', 'quote.byte_end (' + quote.byte_end + ') must be strictly greater than quote.byte_start (' + quote.byte_start + ')');
  }
}
// assertQuoteSpanHash(quote) -> throws unless span_sha256 is a 64-char lowercase-hex commitment.
function assertQuoteSpanHash(quote) {
  if (typeof quote.span_sha256 !== 'string' || !SPAN_HASH_RE.test(quote.span_sha256)) {
    throw new FindingConstructionError('quote.span_sha256', 'quote.span_sha256 is required and must be a 64-char lowercase-hex commitment to the exact bytes at the offsets (a hash, never the words - computed by quote-resolver.js and re-checked by verify-quote.js so a drifted/fabricated span is refused)');
  }
}

// validateQuote(quote) -> throws FindingConstructionError on the first structural defect found (in the
// order above), else returns nothing. This is SHAPE validation only (a quote must name a real-looking
// evidence artifact and a well-ordered, non-negative byte range) - it does NOT reach into an artifact
// store to confirm the bytes really exist; that deeper reality check is verify-quote.js's job, run over
// the artifact store before a finding may ship (section 3/7). Keeping the two separate lets
// createFinding() stay a PURE constructor (no store dependency) while still making "missing or
// malformed" quotes structurally impossible.
function validateQuote(quote) {
  assertQuotePlainObject(quote);
  assertQuoteHasNoRawText(quote);
  assertQuoteEvidenceId(quote);
  assertQuoteByteRange(quote);
  assertQuoteSpanHash(quote);
}

// canonicalQuote(quote) -> the exact FOUR fields a Finding's quote may carry, in a fixed key order,
// FROZEN (CodeRabbit review, PR #36: Object.freeze(finding) is shallow - without freezing the quote
// itself too, a caller could mutate finding.quote.byte_start/byte_end/span_sha256 AFTER finding_id was
// derived from the original values, leaving a Finding whose id no longer matches its own quote while
// every signature/mint-gate check that trusts finding_id as the integrity key stays none the wiser).
// Never trusts extra fields a caller might have attached. span_sha256 is the one-way commitment to the
// exact bytes (see validateQuote).
function canonicalQuote(quote) {
  return Object.freeze({ evidence_id: quote.evidence_id, byte_start: quote.byte_start, byte_end: quote.byte_end, span_sha256: quote.span_sha256 });
}

// deriveFindingId(ruleId, quote, findingClass, jurisdiction) -> sha256(rule_id + '|' + class + '|' +
// jurisdiction + '|' + evidence_id + '|' + byte_start + '-' + byte_end + '|' + span_sha256). Deterministic:
// the SAME rule bound to the SAME byte range AND the same span bytes AND the same class/jurisdiction always
// yields the SAME id, which is exactly what replay.js needs to recognise "this is the same finding
// reproduced". Including span_sha256 means two findings at identical offsets but over DIFFERENT captured
// bytes (a content change) get distinct ids, never a collision.
//
// class and jurisdiction are IN THE BASIS (Kimi K3 finding E1, live audit 2026-07-20): a mint-gate sign-off
// is recorded PER finding_id (mint-gate.js's checkSignature keys a 'ship' decision to finding_id, and
// orphan-lint.js's banned-phrase licence keys off a cited finding's OWN f.class read back off the SAME
// finding_id at render time). Before this fix the basis carried only rule_id/quote, so a needs_human finding
// could be signed, then REBUILT with class:'confirmed' (or a flipped jurisdiction) over the exact same
// quote, and land on the IDENTICAL id - the old signature's 'ship' decision would silently cover the new,
// never-reviewed, stronger-voice finding, and a jurisdiction flip would be invisible to any id-keyed check.
// With class/jurisdiction in the basis, EITHER change mints a DIFFERENT finding_id, which has no recorded
// signature decision, so mint-gate.js's checkSignature refuses it as UNDECIDED_FINDING - never silently
// inherits an older, differently-scoped sign-off. A legitimate stage-6 downgrade never hits this: Claude's
// suppress-only review (run-harness.js's own doc) never re-derives a Finding with a different class over the
// same quote - it only appends a mitigation_log entry via withMitigation() below, which never touches
// finding_id.
//
// catalogue_hash and engine_version are ALSO in the basis (Kimi K3 R2 finding A5/#7, live audit
// 2026-07-20): the mint-gate's catalogue check compares a finding's catalogue_hash to the CURRENTLY loaded
// catalogue, and a per-finding_id 'ship' decision is what licenses a mint. Before this, a finding rebuilt
// under a NEW catalogue (same rule_id/quote/class/jurisdiction, but different law text at that id) or under
// NEW engine detection logic kept the identical finding_id, so the founder's earlier per-id sign-off - made
// reading the OLD law text - silently covered the never-reviewed rebuild. With catalogue_hash and
// engine_version in the basis, either change mints a DIFFERENT finding_id with no recorded decision, which
// mint-gate.js refuses as UNDECIDED_FINDING.
function deriveFindingId(ruleId, quote, findingClass, jurisdiction, catalogueHash, engineVersion) {
  const basis = ruleId + '|' + findingClass + '|' + jurisdiction + '|' + catalogueHash + '|' + engineVersion + '|' + quote.evidence_id + '|' + quote.byte_start + '-' + quote.byte_end + '|' + quote.span_sha256;
  return crypto.createHash('sha256').update(basis, 'utf8').digest('hex').slice(0, 16);
}

// assertRuleId(f) / assertCatalogueHash(f) / assertJurisdiction(f) / assertFindingClass(f) /
// assertMitigationLogShape(f) -> each owns exactly ONE top-level Finding field's structural rule (the
// same single-purpose-function discipline as finding.js's own assertQuoteXxx() helpers above).
function assertRuleId(f) {
  if (!isNonEmptyString(f.rule_id)) {
    throw new FindingConstructionError('rule_id', 'rule_id is required and must be a non-empty string (the catalogue record id this finding proposes evidence against)');
  }
}
function assertCatalogueHash(f) {
  if (!isNonEmptyString(f.catalogue_hash)) {
    throw new FindingConstructionError('catalogue_hash', 'catalogue_hash is required and must be a non-empty string (copied verbatim from the loaded compiled catalogue, never invented)');
  }
}
function assertJurisdiction(f) {
  if (!isNonEmptyString(f.jurisdiction)) {
    throw new FindingConstructionError('jurisdiction', 'jurisdiction is required and must be a non-empty string (copied from the catalogue record, never invented)');
  }
}
function assertFindingClass(f) {
  if (!FINDING_CLASS_SET.has(f.class)) {
    throw new FindingConstructionError('class', 'class must be one of ' + Array.from(FINDING_CLASS_SET).join('|') + ', got ' + JSON.stringify(f.class));
  }
}
function assertMitigationLogShape(f) {
  if (f.mitigation_log !== undefined && !Array.isArray(f.mitigation_log)) {
    throw new FindingConstructionError('mitigation_log', 'mitigation_log must be an array when supplied');
  }
}
// assertFindingFields(f) -> runs every top-level structural rule in order, throwing on the first defect.
function assertFindingFields(f) {
  assertRuleId(f);
  assertCatalogueHash(f);
  validateQuote(f.quote);
  assertJurisdiction(f);
  assertFindingClass(f);
  assertMitigationLogShape(f);
}

// resolvedEngineVersion(f) -> f.engine_version when supplied, else mint/version.js's own ENGINE_VERSION.
function resolvedEngineVersion(f) {
  return isNonEmptyString(f.engine_version) ? f.engine_version : require('../mint/version.js').ENGINE_VERSION;
}

// frozenMitigationLog(f) -> a FROZEN copy of f.mitigation_log (or a frozen [] when none was supplied) -
// the array itself is frozen, not just the Finding that carries it (same shallow-freeze gap as the quote:
// Object.freeze(finding) alone does not stop finding.mitigation_log.push(...) mutating the array in place).
//
// Kimi K3 R2 finding A12/#17 (live audit 2026-07-20): the initial mitigation_log was only SHALLOW-frozen
// (the array froze, its entry objects did not), so `finding.mitigation_log[0].outcome = 'promoted'` mutated
// a recorded verdict post-construction on a branded, frozen Finding - the same tamper hole withMitigation()
// already closed for appended entries. Each initial entry is now deep-frozen (via a structuredClone,
// severing it from the caller's own reference), exactly as withMitigation() does.
function frozenMitigationLog(f) {
  const entries = Array.isArray(f.mitigation_log) ? f.mitigation_log : [];
  return Object.freeze(entries.map((e) => deepFreezeClone(e)));
}

// buildFindingObject(f, quote) -> the plain (not yet frozen) Finding fields, all read straight off the
// already-validated `f` and the canonicalised (already-frozen) `quote`. engine_version is resolved ONCE
// here and fed into BOTH the finding_id basis and the finding's own engine_version field, so the two can
// never disagree (Rule 1: one door for the value).
function buildFindingObject(f, quote) {
  const engineVersion = resolvedEngineVersion(f);
  return {
    finding_id: deriveFindingId(f.rule_id, quote, f.class, f.jurisdiction, f.catalogue_hash, engineVersion),
    rule_id: f.rule_id,
    catalogue_hash: f.catalogue_hash,
    quote,
    jurisdiction: f.jurisdiction,
    class: f.class,
    engine_version: engineVersion,
    mitigation_log: frozenMitigationLog(f),
  };
}

// createFinding(fields) -> Object.freeze()'d Finding. THE one door (Rule 1); throws
// FindingConstructionError on any structural defect, so a malformed/fabricated finding cannot exist as a
// value - fabrication becomes a type error at construction, mirroring the blueprint's Quote/Verdict design
// (KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md section 2.2).
function createFinding(fields) {
  const f = fields || {};
  assertFindingFields(f);
  const finding = Object.freeze(buildFindingObject(f, canonicalQuote(f.quote)));
  FINDING_BRAND.add(finding);
  return finding;
}

// withMitigation(finding, entry) -> a NEW frozen Finding with `entry` appended to mitigation_log (never
// mutates the original - findings are immutable values once constructed, per Rule 1 discipline extended to
// this module). `entry` is expected to carry { source:'claude-adversarial', objection, artifact_ref,
// verified, outcome } (stage 6's kill-log shape; see run-harness.js's applyAdversarialReview doc), but this
// function does not itself validate that shape - it is a generic append, the caller owns the entry's fields.
// deepFreezeClone(entry) -> a structuredClone of `entry`, deep-frozen (every nested plain object/array
// frozen too, not just the top level - the same shallow-freeze gap CodeRabbit flagged for Finding.quote
// applies here: Object.freeze(logEntry) alone would not stop a caller mutating a NESTED field of a recorded
// verdict, e.g. entry.artifact_ref.byte_start, after it was appended to mitigation_log). structuredClone
// severs the entry from whatever mutable object the caller still holds a reference to, so freezing the
// clone can never be defeated by the caller mutating their own original object post-append (Kimi K3
// finding E4).
function deepFreezeClone(entry) {
  const clone = structuredClone(entry === undefined ? null : entry);
  return deepFreeze(clone);
}
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// withMitigation(finding, entry) -> a NEW frozen, branded Finding with a deep-frozen CLONE of `entry`
// appended to mitigation_log (never mutates the original - findings are immutable values once constructed,
// per Rule 1 discipline extended to this module). `entry` is expected to carry { source:'claude-adversarial',
// objection, artifact_ref, verified, outcome } (stage 6's kill-log shape; see run-harness.js's
// applyAdversarialReview doc), but this function does not itself validate that shape - it is a generic
// append, the caller owns the entry's fields. `finding` must be a REAL Finding produced by createFinding()
// or a prior withMitigation() call (FINDING_BRAND-checked, Kimi K3 finding E4) - a field-correct look-alike
// is refused here, the same discipline mint-gate.js enforces before minting.
function withMitigation(finding, entry) {
  if (!isFinding(finding)) {
    throw new FindingConstructionError('finding', 'withMitigation requires a REAL Finding produced by createFinding() (or a prior withMitigation() call), not a look-alike object');
  }
  const next = Object.freeze(Object.assign({}, finding, { mitigation_log: Object.freeze(finding.mitigation_log.concat([deepFreezeClone(entry)])) }));
  FINDING_BRAND.add(next);
  return next;
}

module.exports = { createFinding, withMitigation, FINDING_CLASS, deriveFindingId, isFinding };
