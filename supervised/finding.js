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

// assertQuotePlainObject(quote) -> throws unless quote is a plain, non-array object.
function assertQuotePlainObject(quote) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    throw new FindingConstructionError('quote', 'quote is required and must be an object {evidence_id, byte_start, byte_end}, never a raw string');
  }
}
// assertQuoteHasNoRawText(quote) -> throws if a raw quote_text/text field is present (Kimi blueprint
// section 2.2: the quote IS the byte range, never a copy of the words).
function assertQuoteHasNoRawText(quote) {
  if (typeof quote.quote_text === 'string' || typeof quote.text === 'string') {
    throw new FindingConstructionError('quote', 'quote must never carry a raw string field (quote_text/text) - the quote IS the byte range, never a copy of the words (Kimi blueprint section 2.2)');
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

// canonicalQuote(quote) -> the exact FOUR fields a Finding's quote may carry, in a fixed key order (used
// both to freeze the stored value and to hash it for finding_id derivation - never trusts extra fields a
// caller might have attached). span_sha256 is the one-way commitment to the exact bytes (see validateQuote).
function canonicalQuote(quote) {
  return { evidence_id: quote.evidence_id, byte_start: quote.byte_start, byte_end: quote.byte_end, span_sha256: quote.span_sha256 };
}

// deriveFindingId(ruleId, quote) -> sha256(rule_id + '|' + evidence_id + '|' + byte_start + '-' + byte_end
// + '|' + span_sha256). Deterministic: the SAME rule bound to the SAME byte range AND the same span bytes
// always yields the SAME id, which is exactly what replay.js needs to recognise "this is the same finding
// reproduced". Including span_sha256 means two findings at identical offsets but over DIFFERENT captured
// bytes (a content change) get distinct ids, never a collision.
function deriveFindingId(ruleId, quote) {
  const basis = ruleId + '|' + quote.evidence_id + '|' + quote.byte_start + '-' + quote.byte_end + '|' + quote.span_sha256;
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

// buildFindingObject(f, quote) -> the plain (not yet frozen) Finding fields, all read straight off the
// already-validated `f` and the canonicalised `quote`.
function buildFindingObject(f, quote) {
  return {
    finding_id: deriveFindingId(f.rule_id, quote),
    rule_id: f.rule_id,
    catalogue_hash: f.catalogue_hash,
    quote,
    jurisdiction: f.jurisdiction,
    class: f.class,
    engine_version: resolvedEngineVersion(f),
    mitigation_log: Array.isArray(f.mitigation_log) ? f.mitigation_log.slice() : [],
  };
}

// createFinding(fields) -> Object.freeze()'d Finding. THE one door (Rule 1); throws
// FindingConstructionError on any structural defect, so a malformed/fabricated finding cannot exist as a
// value - fabrication becomes a type error at construction, mirroring the blueprint's Quote/Verdict design
// (KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md section 2.2).
function createFinding(fields) {
  const f = fields || {};
  assertFindingFields(f);
  return Object.freeze(buildFindingObject(f, canonicalQuote(f.quote)));
}

// withMitigation(finding, entry) -> a NEW frozen Finding with `entry` appended to mitigation_log (never
// mutates the original - findings are immutable values once constructed, per Rule 1 discipline extended to
// this module). `entry` is expected to carry { source:'claude-adversarial', objection, artifact_ref,
// verified, outcome } (stage 6's kill-log shape; see run-harness.js's applyAdversarialReview doc), but this
// function does not itself validate that shape - it is a generic append, the caller owns the entry's fields.
function withMitigation(finding, entry) {
  if (!finding || typeof finding !== 'object') {
    throw new FindingConstructionError('finding', 'withMitigation requires an existing Finding object');
  }
  return Object.freeze(Object.assign({}, finding, { mitigation_log: finding.mitigation_log.concat([entry]) }));
}

module.exports = { createFinding, withMitigation, FINDING_CLASS, deriveFindingId };
