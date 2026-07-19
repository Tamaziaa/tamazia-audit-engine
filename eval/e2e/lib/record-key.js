'use strict';
// eval/e2e/lib/record-key.js - THE ONE shared derivation for the frozen recorded-response contract's
// key (docs/P3-TAIL-ACCEPTANCE.md "The frozen recorded-response contract"; caution.md C-211, C-222,
// C-216). Before this module existed, eval/e2e/lib/real-llm.js (the recorder, U1) and
// eval/e2e/lib/replay-llm.js (the replayer, U2) each carried their OWN copy of "hash an artifact into a
// recording key" - two independent guesses that could drift (and did: see replay-llm.js's own header,
// which documents its prior law+hash(evidence+page) derivation as an "independent guess" the recorder
// never made). This file is adopted from eval/e2e/lib/real-llm.js's ORIGINAL implementation (read
// verbatim before this file was written, C-211) as the base: it is the semantics run-real-proof.js's
// recorder actually uses when it writes a committed recording, so it is the side that must win.
//
// THE KEY, exactly as docs/P3-TAIL-ACCEPTANCE.md's frozen contract states it:
//   key = sha256(kind + '|' + rule_id + '|' + artifact_fingerprint)
//   artifact_fingerprint = sha256(stableStringify(artifact))
// where `artifact` is the CANDIDATE's own deterministic Rule-3 artifact object (a verbatim quote, a
// network event, a register row, or a failing DOM node) - the same object breach/proposers/propose.js
// attaches to every candidate and breach/adjudicator/adjudicate.js reads as `finding.artifact`, never a
// text string reconstructed from what a prompt happens to show a model. `stableStringify` sorts object
// keys recursively so the fingerprint is stable regardless of key insertion order (a real concern: the
// same logical artifact can arrive with its fields in different orders from different producers).
//
// eval/e2e/lib/real-llm.js and eval/e2e/lib/replay-llm.js BOTH import this module and carry no local
// re-implementation of stableStringify/artifactFingerprint/recordingKey/CONTRACT (C-216: a cross-wave
// clone of a helper is a one-door violation). Each may still derive its OWN (rule_id, artifact) pair
// from whatever its own side of the recorder/replay boundary actually exposes - that per-call-kind
// derivation is NOT this file's job and stays local to each consumer - but the HASH FORMULA itself is
// single-sourced here.

const crypto = require('crypto');

// The frozen recorded-response contract's version id (docs/P3-TAIL-ACCEPTANCE.md). Single-sourced here
// so real-llm.js and replay-llm.js validate against the identical literal, never two copies that could
// drift on a future contract bump.
const CONTRACT = 'recorded-llm.v1';

// sha256Hex(s) -> the lower-case hex sha256 digest of a value coerced to a string. Never throws: a
// null/undefined input coerces to the string 'null'/'' (String(null) === 'null'; the callers below
// guard the null case explicitly before this is reached, but this primitive itself never refuses).
function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex');
}

// stableStringify(v) -> deterministic JSON with every object's keys sorted recursively, so two
// structurally-identical values serialise byte-identically regardless of key insertion order. This is
// the one thing a plain JSON.stringify cannot guarantee and the one property an artifact fingerprint
// needs (the SAME candidate artifact must fingerprint the same whether its producer built
// {type,quote,page_url} or {page_url,type,quote}).
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// artifactFingerprint(artifact) -> sha256(stableStringify(artifact)). `artifact` is typically a Rule-3
// deterministic artifact OBJECT ({type, quote|text, page_url, ...}); a null/undefined artifact
// fingerprints the stable string for `null` rather than throwing, so a candidate with no artifact still
// yields a real (if never-matching) key instead of blowing up the caller.
function artifactFingerprint(artifact) {
  return sha256Hex(stableStringify(artifact == null ? null : artifact));
}

// recordingKey(kind, ruleId, artifactFp) -> the frozen contract's key: sha256(kind|rule_id|artifact_fp).
// `artifactFp` is expected to already be a fingerprint (typically this module's own artifactFingerprint
// output), not a raw artifact - callers compose the two functions explicitly so the two hashing steps
// stay visible at each call site.
function recordingKey(kind, ruleId, artifactFp) {
  return sha256Hex(String(kind == null ? '' : kind) + '|' + String(ruleId == null ? '' : ruleId) + '|' + String(artifactFp == null ? '' : artifactFp));
}

if (require.main === module) {
  process.stderr.write('eval/e2e/lib/record-key.js is a library (stableStringify, artifactFingerprint, recordingKey). It makes no network calls and reads no files.\n');
  process.exit(2);
}

module.exports = {
  CONTRACT,
  sha256Hex,
  stableStringify,
  artifactFingerprint,
  recordingKey,
};
