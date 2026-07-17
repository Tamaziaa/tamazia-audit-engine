'use strict';
/**
 * breach/verifiers/coverage-proof.js - verifies a `coverage_proof` artifact: the artifact class for
 * ABSENCE claims ("no complaints procedure was found", "no cookie banner present"). Constitution
 * Rule 3 lists a verbatim quote, a network event and a register row as artifacts for something
 * PRESENT; an absence claim has no quote to point at by definition, so its deterministic artifact is
 * proof that the relevant surface was actually, sufficiently crawled (caution.md C-029: coverage as
 * BLOCKING data, not reporting theatre; C-037: every fabrication-prone absence is gated behind a real
 * live-read guard).
 *
 * Contract (candidate.artifact when type === 'coverage_proof'):
 *   {
 *     type: 'coverage_proof',
 *     page_class,           // informational: which page-class the absence claim concerns
 *     coverage: {
 *       pages: [url, ...],   // the pages examined for this class; MUST be non-empty
 *       tier1_fetched,       // true only if Tier-1 legal pages were fetched before any cap (C-026)
 *       truncated,           // must be false: a truncated corpus cannot honestly ground an absence
 *                            // claim (C-024/C-025 - russell-cooke's SRA string sat at char 11,080)
 *     },
 *   }
 *
 * This module never re-derives the coverage computation itself (that stays evidence/crawler/
 * coverage-contract.js's one door): it checks structural presence and cross-checks the claimed pages
 * against bundle.corpus.pages, so a coverage_proof cannot invent pages nobody actually crawled.
 */
const { CODES, accepted, rejected } = require('./result');

// bundlePageUrlSet(bundle) -> the Set of page URLs actually present on the bundle's corpus. Empty
// when the bundle carries no corpus at all (an unreachable/bot-walled bundle, caution.md C-038).
function bundlePageUrlSet(bundle) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return new Set(pages.map((p) => p && p.url));
}

// verifyCoverageProof(artifact, bundle) -> {verified, code, reason}. Fails closed on: a missing
// coverage object, an empty/absent pages list, a claimed page not actually present in the bundle's
// corpus, tier1_fetched not literally true, or truncated not literally false.
function verifyCoverageProof(artifact, bundle) {
  const coverage = artifact.coverage;
  if (!coverage || typeof coverage !== 'object') {
    return rejected(CODES.COVERAGE_PROOF_MISSING_FIELDS, 'artifact.coverage is required');
  }
  if (!Array.isArray(coverage.pages) || coverage.pages.length === 0) {
    return rejected(CODES.COVERAGE_PROOF_NO_PAGES, 'artifact.coverage.pages must be a non-empty list of crawled page URLs');
  }
  const provenUrls = bundlePageUrlSet(bundle);
  const unproven = coverage.pages.filter((url) => !provenUrls.has(url));
  if (unproven.length > 0) {
    return rejected(
      CODES.COVERAGE_PROOF_PAGES_NOT_IN_BUNDLE,
      'coverage.pages lists page(s) absent from bundle.corpus.pages: ' + unproven.join(', ')
    );
  }
  if (coverage.tier1_fetched !== true) {
    return rejected(
      CODES.COVERAGE_PROOF_TIER1_NOT_FETCHED,
      'coverage.tier1_fetched must be true (C-026: Tier-1 legal pages fetched before any commercial page or cap)'
    );
  }
  if (coverage.truncated !== false) {
    return rejected(
      CODES.COVERAGE_PROOF_TRUNCATED,
      'coverage.truncated must be false (C-024/C-025: an absence claim on a truncated corpus is not provable)'
    );
  }
  return accepted(
    CODES.COVERAGE_PROOF_VERIFIED,
    'coverage report proves the surface was crawled: ' + coverage.pages.length + ' page(s), Tier-1 fetched, not truncated'
  );
}

module.exports = { verifyCoverageProof, bundlePageUrlSet };
