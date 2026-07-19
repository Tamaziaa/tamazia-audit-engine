'use strict';
// mint/quote-verify-refs.js - catalogue-ref resolution for the mint-time quote-verification gate (Kimi
// WS0, blueprint 2.2 / P0-2). Resolves the catalogue index a v1.2 breach's law/penalty are checked
// against, and re-constructs the LawRef/PenaltyRef through v1_2.js so the SAME one-door resolution rule
// runs (an unknown law_id or an absent penalty throws there; the throw becomes a mint refusal upstream).

const v1_2 = require('../payload/contract/v1_2.js');

// hasInjectedIndex(opts) / resolveIndex(opts): the catalogue index to resolve law/penalty refs against. An
// injected index (tests) wins, else one is built from an injected compiled catalogue; a v1.2 payload with
// breach verdicts and no catalogue to pin against cannot be verified, so the caller must supply one.
function hasInjectedIndex(opts) {
  if (!opts || !opts.catalogueIndex) return false;
  return typeof opts.catalogueIndex.hasLaw === 'function';
}
function resolveIndex(opts) {
  if (hasInjectedIndex(opts)) return opts.catalogueIndex;
  if (opts && opts.catalogue) return v1_2.buildCatalogueIndex(opts.catalogue);
  return null;
}

// assertRefsResolvable(vd, i, idx): re-construct the LawRef and PenaltyRef through v1_2.js. Returns the
// number of refs checked (2 per breach: law + penalty); throws when there is no catalogue to pin against.
function assertRefsResolvable(vd, i, idx) {
  if (!idx) throw new Error('quote-verify-gate: verdicts[' + i + '] is a Breach but no catalogue was supplied to resolve its law_id/penalty against (fail closed; a claim needs a hash-pinned catalogue)');
  v1_2.LawRef(vd.law, idx);
  v1_2.PenaltyRef(vd.penalty, idx);
  return 2;
}

module.exports = { resolveIndex, assertRefsResolvable };
