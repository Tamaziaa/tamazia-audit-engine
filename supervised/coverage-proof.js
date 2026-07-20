'use strict';
// supervised/coverage-proof.js - builds the ABSENCE-lane commitment (Kimi K3 10Q Q1(a)/Q2): a coverage
// proof artifact whose bytes ARE the absence claim's own basis - "pattern P (hashed), run over subjects
// S1..Sn (hashed each), yielding claimed_count N" - so mint-gate.js can RE-EXECUTE the claim rather than
// merely trust the bytes (Q2's "recompute, never trust" doctrine, generalised to the absence lane).
//
// Two absence-shaped candidates reach this door (breach/artifact-types.js's own closed set):
//   COVERAGE_PROOF   - a required-content ABSENCE-breach (propose.js's evalAbsenceBreach): the candidate's
//                       own artifact ALREADY carries {pages_checked, searched_patterns, page_class,
//                       surface, tier1_fetched, truncated} - the exact claim propose.js made. This module
//                       does not re-run propose.js's own detection-spec matcher (that lives inside
//                       breach/proposers/detection-spec.js, not a standalone door this file can call
//                       without duplicating its compiled-regex internals - a documented scope cut from
//                       Kimi's Q2(b) sketch, which assumed a separable breach/proposers/match.js door that
//                       does not exist in this repo's real propose.js); instead it commits to propose.js's
//                       OWN claimed pages_checked + searched_patterns as the "pattern", and the gate
//                       re-derives the pattern_sha256 and the subject hash set match, which still closes
//                       the two forgeable vectors (a different page set, or a silently different pattern
//                       list, both change the hash).
//   REGISTER_ABSENCE - a definitive register no-match (propose.js's evalRegister): the candidate's own
//                       artifact carries {register, query, lane:'no_match', note}.
//
// Pure and deterministic: no wall-clock inside the committed bytes (only `fetched_at` on the artifact
// record itself, which is never part of the hash).

const { stableStringify, sha256Hex, evidenceIdFor } = require('./capture-index.js');

// claimShapeFor(candidateArtifact) -> the exact sub-object that IS this candidate's absence claim (the
// "pattern" a coverage proof commits to), keyed by artifact type so a COVERAGE_PROOF and a
// REGISTER_ABSENCE candidate over otherwise-identical fields never collide on the same pattern_sha256.
function claimShapeFor(candidateArtifact) {
  const a = candidateArtifact || {};
  if (a.type === 'register_absence') {
    return { kind: 'register_absence', register: a.register || null, query: a.query || null };
  }
  // coverage_proof (the default/only other absence artifact type this door handles)
  return {
    kind: 'coverage_proof',
    page_class: a.page_class || null,
    surface: a.surface || null,
    searched_patterns: Array.isArray(a.searched_patterns) ? a.searched_patterns : [],
  };
}

// patternSha256For(candidateArtifact) -> sha256 of the canonical claim shape - the ONE hash both
// quote-resolver.js (at build time) and mint-gate.js (at re-verify time) must independently reproduce.
function patternSha256For(candidateArtifact) {
  return sha256Hex(Buffer.from(stableStringify(claimShapeFor(candidateArtifact)), 'utf8'));
}

// subjectsFor(candidateArtifact, captureIndex) -> [{evidence_id, sha256}] - the REAL captured artifacts
// this absence claim was searched over. For coverage_proof: the register/page-text artifacts named by
// pages_checked (resolved by URL against the store's own page-lane artifacts). For register_absence: the
// single register-lane artifact this run captured for that register (capture-index.js's registerLaneRows).
// Any subject that cannot be resolved against the live store is DROPPED, never fabricated - an empty
// result here means "no real subject could be named", which the caller must treat as an unresolvable
// candidate (fail closed), not an artifact with fewer, silently-substituted subjects.
function subjectsFor(candidateArtifact, captureIndex) {
  const a = candidateArtifact || {};
  const store = captureIndex;
  if (!store || typeof store.list !== 'function') return [];
  if (a.type === 'register_absence') {
    const found = store.list().find((art) => art.lane === 'register' && art.url === a.register);
    return found ? [{ evidence_id: found.evidence_id, sha256: found.sha256 }] : [];
  }
  const pagesChecked = Array.isArray(a.pages_checked) ? a.pages_checked : [];
  const out = [];
  for (const url of pagesChecked) {
    const found = store.list().find((art) => art.lane === 'static' && art.url === url);
    if (found) out.push({ evidence_id: found.evidence_id, sha256: found.sha256 });
  }
  return out;
}

// buildCoverageArtifact({candidateArtifact, captureIndex, fetchedAt}) -> a frozen single-line derived
// artifact whose bytes ARE the absence claim's basis, or null when no real subject could be resolved (the
// caller treats null as "this absence candidate could not be anchored", fail-closed).
function buildCoverageArtifact({ candidateArtifact, captureIndex, fetchedAt }) {
  const subjects = subjectsFor(candidateArtifact, captureIndex);
  if (!subjects.length) return null;
  const pattern_sha256 = patternSha256For(candidateArtifact);
  const claimedCount = 1; // every candidate reaching this door already IS one absence observation (C-004)
  const line = { pattern_sha256, claimed_count: claimedCount, subjects };
  const bytes = Buffer.from(stableStringify(line), 'utf8');
  const key = (candidateArtifact.type || 'coverage') + '|' + pattern_sha256;
  return Object.freeze({
    evidence_id: evidenceIdFor(key, 'coverage'), url: key, lane: 'coverage',
    sha256: sha256Hex(bytes), length: bytes.length, fetched_at: fetchedAt, bytes,
    rawAvailable: false, rawBytes: null, rawSha256: null, rawLength: null, boundaries: [],
    origin: 'derived', derived: true,
    derivedFrom: Object.freeze(subjects.map((s) => Object.freeze({ evidence_id: s.evidence_id, sha256: s.sha256 }))),
  });
}

module.exports = { buildCoverageArtifact, patternSha256For, claimShapeFor, subjectsFor };
