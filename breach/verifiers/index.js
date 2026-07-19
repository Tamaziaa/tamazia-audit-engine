'use strict';
// breach/verifiers/index.js - the public verifier dispatch door. Every consumer of the proposer->verify
// seam requires the verifier API through THIS file (eval/e2e/lib/breach-stages.js wires verifyAll from
// 'breach/verifiers/index.js'; eval/e2e/run-real-proof.js and redteam-handlers.js require verifyAll /
// verifyQuote from here), so this is where the artifact-type routing lives.
//
// quote-match.js hosts the quote gate directly and dispatches quote/network_event/register_row/
// register_absence/coverage_proof to their sibling verifiers via its own VERIFIERS_BY_TYPE table. The
// dom_node artifact (T2a) is verified against a DIFFERENT bundle surface (bundle.browser.domNodes, not the
// corpus/registers quote-match knows), so it is routed HERE, ADDITIVELY: a dom_node candidate goes to
// breach/verifiers/dom-node.js; everything else delegates UNCHANGED to quote-match.js's dispatcher. Every
// other quote-match export (verifyQuote, normaliseWhitespace, CODES, ...) is re-exported verbatim, so no
// existing caller sees a shape change. This keeps quote-match.js byte-identical (Rule 1: one door per
// artifact type; the dispatcher merely gains one more door without editing the frozen sibling contract).

const quoteMatch = require('./quote-match.js');
const { verifyDomNode } = require('./dom-node.js');
const { ARTIFACT_TYPES } = require('../artifact-types.js');

// isDomNodeCandidate(candidate) -> true when the candidate's artifact is the dom_node type this door owns.
function isDomNodeCandidate(candidate) {
  const artifact = candidate && candidate.artifact;
  return Boolean(artifact) && typeof artifact === 'object' && artifact.type === ARTIFACT_TYPES.DOM_NODE;
}

// verifyCandidate(candidate, bundle) -> {verified, code, reason}. Routes dom_node to its verifier and
// everything else to quote-match's fail-closed dispatcher (an unknown type still fails closed there).
function verifyCandidate(candidate, bundle) {
  if (isDomNodeCandidate(candidate)) return verifyDomNode(candidate, bundle);
  return quoteMatch.verifyCandidate(candidate, bundle);
}

// envelope(candidate, result) -> the pure result envelope verifyAll carries per candidate (the ORIGINAL
// candidate reference, unmodified - the verifier is filter-only, Rule 11).
function envelope(candidate, result) {
  return { candidate, verified: result.verified, code: result.code, reason: result.reason };
}

// verifyAll(candidates, bundle) -> {verified:[...], rejected:[...]}. The same pure-filter aggregation as
// quote-match's, but keyed off the dom_node-aware verifyCandidate above. A non-array candidates list is a
// broken upstream stage, not "zero breaches", so it throws rather than returning a false clean (Rule 4).
function verifyAll(candidates, bundle) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('breach/verifiers: verifyAll requires an array of candidates; got ' + (candidates === null ? 'null' : typeof candidates));
  }
  const verified = [];
  const rejected = [];
  for (const candidate of candidates) {
    const entry = envelope(candidate, verifyCandidate(candidate, bundle));
    (entry.verified ? verified : rejected).push(entry);
  }
  return { verified, rejected };
}

// Re-export every quote-match member verbatim, then override the two dispatch entry points and add the
// dom_node verifier. Object.assign order matters: the overrides win over the re-exported originals.
module.exports = Object.assign({}, quoteMatch, { verifyCandidate, verifyAll, verifyDomNode });
