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
 * Contract (candidate.artifact when type === 'coverage_proof'), the FLAT shape the proposer emits
 * (breach/proposers/propose.js evalAbsenceBreach):
 *   {
 *     type: 'coverage_proof',
 *     page_class,           // informational: which page-class the absence claim concerns
 *     surface,              // informational: the declared detection/evidence surface
 *     pages_checked: [url], // the crawled pages examined for this class; MUST be non-empty AND every
 *                           // entry MUST be a URL actually present in bundle.corpus.pages
 *     searched_patterns: [],// informational: what was searched for
 *     tier1_fetched,        // must be literally true: Tier-1 legal pages were fetched before any cap (C-026)
 *     truncated,            // must be literally false: a truncated corpus cannot honestly ground an
 *                           // absence claim (C-024/C-025 - russell-cooke's SRA string sat at char 11,080)
 *   }
 *
 * DEFENCE IN DEPTH (Constitution Rule 3 + Rule 4, caution.md C-024/C-026): the proposer already runs
 * its own absenceInterlock before emitting, but the verifier does NOT trust that interlock alone. It
 * INDEPENDENTLY re-derives the same guarantees off the bundle: pages_checked non-empty, every entry
 * present in bundle.corpus.pages, tier1_fetched===true, truncated===false. A fabricated or drifted
 * coverage_proof (a page nobody crawled, a tier1_fetched:false, a truncated:true) is refused here even
 * if a proposer somewhere claimed it clean. This module never re-derives the coverage COMPUTATION
 * itself (that stays evidence/crawler/coverage-contract.js's one door): it checks structural presence
 * and cross-checks the claimed pages against bundle.corpus.pages.
 */
const { CODES, accepted, rejected } = require('./result');

// bundlePageUrlSet(bundle) -> the Set of page URLs actually present on the bundle's corpus. Empty
// when the bundle carries no corpus at all (an unreachable/bot-walled bundle, caution.md C-038).
function bundlePageUrlSet(bundle) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return new Set(pages.map((p) => p && p.url));
}

// verifyCoverageProof(artifact, bundle) -> {verified, code, reason}. Fails closed on: an empty/absent
// pages_checked list, a claimed page not actually present in the bundle's corpus, tier1_fetched not
// literally true, or truncated not literally false.
function verifyCoverageProof(artifact, bundle) {
  if (!Array.isArray(artifact.pages_checked) || artifact.pages_checked.length === 0) {
    return rejected(CODES.COVERAGE_PROOF_NO_PAGES, 'artifact.pages_checked must be a non-empty list of crawled page URLs');
  }
  const provenUrls = bundlePageUrlSet(bundle);
  const unproven = artifact.pages_checked.filter((url) => !provenUrls.has(url));
  if (unproven.length > 0) {
    return rejected(
      CODES.COVERAGE_PROOF_PAGES_NOT_IN_BUNDLE,
      'pages_checked lists page(s) absent from bundle.corpus.pages: ' + unproven.join(', ')
    );
  }
  if (artifact.tier1_fetched !== true) {
    return rejected(
      CODES.COVERAGE_PROOF_TIER1_NOT_FETCHED,
      'tier1_fetched must be true (C-026: Tier-1 legal pages fetched before any commercial page or cap)'
    );
  }
  if (artifact.truncated !== false) {
    return rejected(
      CODES.COVERAGE_PROOF_TRUNCATED,
      'truncated must be false (C-024/C-025: an absence claim on a truncated corpus is not provable)'
    );
  }
  return accepted(
    CODES.COVERAGE_PROOF_VERIFIED,
    'coverage proves the surface was crawled: ' + artifact.pages_checked.length + ' page(s), Tier-1 fetched, not truncated'
  );
}

module.exports = { verifyCoverageProof, bundlePageUrlSet };
