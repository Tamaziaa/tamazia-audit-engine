#!/usr/bin/env node
'use strict';
/**
 * breach/verifiers/quote-match.js - THE constitutionally-named enforcement point for Rule 3 ("no
 * artifact, no breach") and Rule 12 Gate 2 ("verbatim-quote exact re-match"). Named explicitly in
 * CONSTITUTION.md (Rule 3, Rule 12 Gate 2, the Part III gate map) and in GAPS.md's `breach-artifact`
 * row as the planned gate for the whole no-artifact-no-breach class.
 *
 * This file is the ONLY path from a proposer's candidate to the adjudicator (breach/proposers/ and
 * breach/adjudicator/ are Wave-2 modules that do not exist yet; this directory is their shared
 * choke point, built first because Rule 3 is the enforcement point both sides must pass through).
 * It hosts the quote-artifact gate directly (Gate 2's specific, named concern) and dispatches the
 * other three artifact classes to their sibling modules:
 *
 *   quote artifact            -> verifyQuote (this file)
 *   network_event artifact    -> breach/verifiers/network-event.js
 *   register_row artifact     -> breach/verifiers/register-row.js
 *   register_absence artifact -> breach/verifiers/register-absence.js
 *   coverage_proof artifact   -> breach/verifiers/coverage-proof.js
 *
 * The artifact.type vocabulary is the single closed enum in breach/artifact-types.js (Rule 1, one
 * door): this dispatcher keys its verifier table off those canonical constants, never bare literals.
 *
 * ── the candidate/artifact contract (this module's own; breach/proposers/ must produce it) ────────
 *
 *   candidate = {
 *     rule_id: string,          // the catalogue rule this candidate proposes evidence for (pass
 *                                // through untouched; never read or judged by this directory)
 *     artifact: {
 *       type: 'quote' | 'network_event' | 'register_row' | 'register_absence' | 'coverage_proof',
 *       ... type-specific fields, see the sibling module or verifyQuote below ...
 *     },
 *   }
 *
 * A candidate with no artifact, or an artifact of an unrecognised type, is REJECTED, never passed
 * through (Rule 4: fail closed on malformed input). A verifier only ever narrows the candidate set;
 * it never creates, upgrades or edits a candidate (mirrors the adjudicator's filter-only contract,
 * Rule 11) - verifyAll wraps a reference to the ORIGINAL candidate object in a new result envelope
 * and never writes to the candidate itself.
 *
 * ── the ONE documented quote normalisation (Gate 2) ─────────────────────────────────────────────────
 *
 * Every run of whitespace characters (space, tab, newline, CR, form feed, vertical tab, and any
 * mixture of them) collapses to a single ASCII space. Nothing else: no case folding, no punctuation
 * stripping, no unicode normalisation, no trimming beyond what a whitespace-run collapse already does
 * at a string's edge. This is deliberately the SAME normalisation on both sides (the candidate's
 * quote and the bundle page's declared-surface text) and nothing more, because a second silent
 * transformation is exactly how Gate 2 could be weakened without anyone noticing: the whole point of
 * an "exact" re-match is that there is only one documented rule standing between "verified" and
 * "fabricated". Whitespace-only collapsing is necessary because the crawler's stripHtml()
 * (evidence/crawler/extract.js) turns block-level HTML boundaries into newlines while a proposer's
 * candidate quote is typically authored as a single line; without this one normalisation, a
 * genuinely-quoted sentence spanning a paragraph break would be rejected as a false mismatch. No
 * other drift (a changed word, a changed character, a re-cased letter) is tolerated: that is
 * precisely the class Gate 2 exists to catch (caution.md C-032 - models paraphrase inside quotation
 * marks).
 *
 * ── the detection-surface doctrine (caution.md C-035) ───────────────────────────────────────────────
 *
 * "Detection surface = evidence surface": a candidate declares which surface it detected the quote on
 * (`visible_text`, the stripped text every EvidenceBundle page carries per facts/README.md, or
 * `raw_html`, an optional richer surface some rules legitimately need per caution.md C-036's
 * trigger/mechanism asymmetry - e.g. proving a consent-manager script TAG is present, which stripHtml
 * deliberately removes from visible_text). This module matches the quote against EXACTLY the
 * declared surface and no other: a raw_html-only string can never satisfy a visible_text candidate,
 * and vice versa. The canonical EvidenceBundle.corpus.pages shape (facts/README.md) does not
 * currently carry a raw_html field - only evidence/crawler/'s own future work can add it - so a
 * raw_html candidate against a bundle page with no such field is honestly UNVERIFIABLE (rejected,
 * never assumed true).
 */
const { CODES, accepted, rejected } = require('./result');
const { ARTIFACT_TYPES } = require('../artifact-types');
const { verifyNetworkEvent } = require('./network-event');
const { verifyRegisterRow } = require('./register-row');
const { verifyRegisterAbsence } = require('./register-absence');
const { verifyCoverageProof } = require('./coverage-proof');

const VALID_SURFACES = new Set(['visible_text', 'raw_html']);

// normaliseWhitespace(s) -> s with every run of whitespace collapsed to a single space. THE one
// documented normalisation Gate 2 permits (see header). Applied identically to the candidate's quote
// and to the bundle page's declared-surface text before the exact-substring check.
function normaliseWhitespace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ');
}

// surfaceText(page, surface) -> the declared surface's text on this bundle page, or null when that
// surface is not present (an honest "cannot verify", never a silent fallback to the other surface).
function surfaceText(page, surface) {
  if (surface === 'visible_text') return typeof page.text === 'string' ? page.text : null;
  if (surface === 'raw_html') return typeof page.rawHtml === 'string' ? page.rawHtml : null;
  return null;
}

function findPage(bundle, pageUrl) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return pages.find((p) => p && p.url === pageUrl) || null;
}

// verifyQuote(artifact, bundle) -> {verified, code, reason}. Gate 2 itself: fails closed on missing
// fields, an unrecognised surface, a page absent from the bundle, a declared surface absent from
// that page, or (after the one whitespace normalisation) a quote that is not an exact substring of
// the declared surface's text.
// Each named predicate below owns exactly one field-shape check, so verifyQuote's own guard-clause
// chain stays a flat sequence of single-call ifs rather than folding a multi-term boolean into any one
// of them (the health-gate "Complex Conditional" cap).
function missingPageUrl(artifact) {
  return typeof artifact.page_url !== 'string' || !artifact.page_url;
}
function missingQuote(artifact) {
  return typeof artifact.quote !== 'string' || !artifact.quote || !artifact.quote.trim();
}
function invalidSurfaceDeclared(artifact) {
  return !VALID_SURFACES.has(artifact.surface);
}
function quoteNotOnSurface(quoteNormalised, surfaceNormalised) {
  return !surfaceNormalised.includes(quoteNormalised);
}

function verifyQuote(artifact, bundle) {
  if (missingPageUrl(artifact)) {
    return rejected(CODES.QUOTE_MISSING_FIELDS, 'artifact.page_url is required');
  }
  if (missingQuote(artifact)) {
    return rejected(CODES.QUOTE_MISSING_FIELDS, 'artifact.quote is required and must not be empty or whitespace-only');
  }
  if (invalidSurfaceDeclared(artifact)) {
    return rejected(
      CODES.QUOTE_INVALID_SURFACE,
      'artifact.surface must be "visible_text" or "raw_html", got ' + JSON.stringify(artifact.surface)
    );
  }
  const page = findPage(bundle, artifact.page_url);
  if (!page) {
    return rejected(CODES.QUOTE_PAGE_NOT_FOUND, 'no bundle page at ' + JSON.stringify(artifact.page_url));
  }
  const rawSurfaceText = surfaceText(page, artifact.surface);
  if (rawSurfaceText === null) {
    return rejected(
      CODES.QUOTE_SURFACE_UNAVAILABLE,
      'the "' + artifact.surface + '" surface is not present on this bundle page '
        + '(C-035: detection surface and evidence surface must be the same corpus)'
    );
  }
  const quoteNormalised = normaliseWhitespace(artifact.quote);
  const surfaceNormalised = normaliseWhitespace(rawSurfaceText);
  if (quoteNotOnSurface(quoteNormalised, surfaceNormalised)) {
    return rejected(
      CODES.QUOTE_MISMATCH,
      'quote does not exact-match (after whitespace-run normalisation) the "' + artifact.surface
        + '" surface of ' + JSON.stringify(artifact.page_url)
    );
  }
  return accepted(
    CODES.QUOTE_VERIFIED,
    'quote exact-matched the declared "' + artifact.surface + '" surface of ' + JSON.stringify(artifact.page_url)
  );
}

const VERIFIERS_BY_TYPE = {
  [ARTIFACT_TYPES.QUOTE]: verifyQuote,
  [ARTIFACT_TYPES.NETWORK_EVENT]: verifyNetworkEvent,
  [ARTIFACT_TYPES.REGISTER_ROW]: verifyRegisterRow,
  [ARTIFACT_TYPES.REGISTER_ABSENCE]: verifyRegisterAbsence,
  [ARTIFACT_TYPES.COVERAGE_PROOF]: verifyCoverageProof,
};

// resolveQuoteArtifact(candidate, artifact) -> an effective quote artifact with real-proposer shape
// variance absorbed. Confirmed by direct integration probing against the landed breach/proposers/
// propose.js (evalPresenceBreach): it emits `artifact.text` rather than `artifact.quote`, and puts
// `page_url` on the CANDIDATE rather than on the artifact (`candidate(detectionSpec,
// KIND.PRESENCE_BREACH, {type:'quote', text, surface}, found.page_url, ...)` in propose.js). Both this
// module's originally-specified field names (artifact.page_url, artifact.quote) and propose.js's
// actual field names are accepted; an artifact-level field always wins when present, so nothing that
// already worked stops working - this only widens what verifyQuote can read. Only 'quote' artifacts
// are touched; every other type passes through unchanged. This is a narrow, additive compatibility
// seam, not a redesign of the artifact contract: it does not relax WHAT is verified (the exact-match
// check in verifyQuote is unchanged), only WHERE the same two facts (which page, what quote) may be
// read from on the way in.
function resolveQuoteArtifact(candidate, artifact) {
  if (!artifact || artifact.type !== ARTIFACT_TYPES.QUOTE) return artifact;
  const pageUrl = artifact.page_url == null ? (candidate && candidate.page_url) : artifact.page_url;
  const quote = artifact.quote == null ? artifact.text : artifact.quote;
  if (pageUrl === artifact.page_url && quote === artifact.quote) return artifact;
  return Object.assign({}, artifact, { page_url: pageUrl, quote });
}

// verifyCandidate(candidate, bundle) -> {verified, code, reason}. The fail-closed dispatcher: an
// unknown artifact.type is REJECTED, never passed through untested (Rule 4). Never mutates
// `candidate`.
function isInvalidCandidate(candidate) {
  return !candidate || typeof candidate !== 'object';
}
// hasNoArtifactType(artifact) -> true when there is no usable artifact.type at all. Named so the 3-term
// disjunction is not its own "Complex Conditional" inline in verifyCandidate.
function hasNoArtifactType(artifact) {
  return !artifact || typeof artifact !== 'object' || typeof artifact.type !== 'string' || !artifact.type;
}
function verifyCandidate(candidate, bundle) {
  if (isInvalidCandidate(candidate)) {
    return rejected(CODES.INVALID_CANDIDATE, 'candidate must be a non-null object');
  }
  const artifact = candidate.artifact;
  if (hasNoArtifactType(artifact)) {
    return rejected(CODES.MISSING_ARTIFACT, 'candidate.artifact.type is required (Rule 3: no artifact, no breach)');
  }
  const verify = VERIFIERS_BY_TYPE[artifact.type];
  if (!verify) {
    return rejected(
      CODES.UNKNOWN_ARTIFACT_TYPE,
      'unrecognised artifact.type ' + JSON.stringify(artifact.type) + '; unknown artifact types fail closed, never pass through'
    );
  }
  return verify(resolveQuoteArtifact(candidate, artifact), bundle);
}

// verifyAll(candidates, bundle) -> {verified:[{candidate,verified,code,reason}], rejected:[...]}.
// Pure filter: every candidate is judged independently against the SAME bundle, the original
// candidate reference is carried unmodified in the result envelope, and nothing is ever dropped
// silently - a rejected entry always carries its code and reason.
function verifyAll(candidates, bundle) {
  if (!Array.isArray(candidates)) {
    // FAIL-CLOSED (Rule 4): a non-array candidates list is a broken upstream stage, not "zero breaches".
    // Coercing it to [] would return zero verified AND zero rejected - a clean bill of health for a
    // check that never ran. Throw so the caller records an ERRORED verify stage, never a false clean.
    throw new TypeError('breach/verifiers: verifyAll requires an array of candidates; got ' + (candidates === null ? 'null' : typeof candidates));
  }
  const list = candidates;
  const verified = [];
  const rejectedList = [];
  for (const candidate of list) {
    const result = verifyCandidate(candidate, bundle);
    const entry = { candidate, verified: result.verified, code: result.code, reason: result.reason };
    (result.verified ? verified : rejectedList).push(entry);
  }
  return { verified, rejected: rejectedList };
}

// ---------------------------------------------------------------------------------
// Calibration CLI (the earn-your-zero contract, eval/calibration-known-bad/run.js dialect; mirrors
// facts/identity.js and evidence/registers/registers.js's --calibrate convention exactly so a future
// CALIBRATIONS entry in eval/calibration-known-bad/run.js needs no adaptation).
// `node breach/verifiers/quote-match.js --calibrate [--json <path>]` runs every p3-verifier-*.json
// fixture under eval/calibration-known-bad/fixtures/ through verifyCandidate. Each fixture plants a
// candidate that must be REJECTED; a finding is emitted only when the rejection actually happens (and
// matches the fixture's expected_code, when given). Zero findings means this gate is broken.
// ---------------------------------------------------------------------------------
function runOneFixture(file, fixture) {
  const result = verifyCandidate(fixture.candidate, fixture.bundle);
  const poison = fixture.poison || {};
  const expectedCode = poison.expected_code;
  const caught = result.verified === false && (!expectedCode || result.code === expectedCode);
  if (!caught) return [];
  return [{
    file,
    line: 1,
    rule: 'p3-verifier-artifact-rejected',
    message: 'refused the poisoned candidate (' + result.code + '): ' + result.reason,
  }];
}

function runCalibration(fixturesDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = fixturesDir || path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
  const findings = [];
  const files = fs.readdirSync(dir).filter((f) => /^p3-verifier-.*\.json$/.test(f)).sort();
  for (const f of files) {
    if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(f)) {
      throw new Error('unsafe path component: ' + JSON.stringify(f));
    }
    const abs = path.join(dir, f);
    const fixture = JSON.parse(fs.readFileSync(abs, 'utf8'));
    findings.push(...runOneFixture(abs, fixture));
  }
  return findings;
}

function calibrateMain(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  const findings = runCalibration();
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify({ checker: 'breach-verifiers', findings }) + '\n');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--calibrate')) {
    process.exit(calibrateMain(process.argv));
  } else {
    console.error('breach/verifiers/quote-match.js is a library. Only --calibrate is runnable from the CLI.');
    process.exit(2);
  }
}

module.exports = {
  verifyCandidate,
  verifyAll,
  verifyQuote,
  normaliseWhitespace,
  resolveQuoteArtifact,
  CODES,
  runCalibration,
  calibrateMain,
};
