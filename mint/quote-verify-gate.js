'use strict';
// mint/quote-verify-gate.js - the mint-time quote-verification gate (Kimi WS0, blueprint 2.2 / P0-2, the
// choke point). Defence-in-depth ADDITIVE to mint/post-write-assertions.js: those assert AFTER the write
// that the row/URL/render are real; THIS asserts BEFORE the write that a v1.2 payload contains no
// unverifiable quote, no unresolvable law_id, and no penalty absent from the hash-pinned catalogue. The
// fabrication was already made a type error upstream (payload/contract/v1_2.js constructors); this is the
// final gate for a payload that arrived as plain JSON (composed, replayed, or hand-assembled) and never
// went through those constructors. The per-verdict checks live in mint/quote-verify-checks.js.
//
// It is version-aware and STRICTLY ADDITIVE: a v1.1 render-contract payload (everything the mint emits
// today) passes straight through unchanged, so the existing mint path is untouched. Only a payload that
// explicitly declares payload_version '1.2' is held to the lattice checks.
//
//   assertMintablePayload(payload, opts) -> { ok, version, checkedQuotes, checkedRefs }
//     opts = { catalogue?, catalogueIndex?, evidenceStore? }
//   THROWS (mint refused) on any unverifiable quote / unresolvable law / absent penalty / structural error.

const decode = require('../payload/contract/decode.js');
const { PAYLOAD_V1_2_VERSION } = require('../payload/contract/v1_2.js');
const { verifyBreachVerdicts } = require('./quote-verify-checks.js');

// MAX_VERDICTS: a hard iteration budget on the verdict traversal (Rule 8: budgets are caps). A payload
// carrying more than this many verdicts is rejected rather than letting a legal-claim gate run unbounded.
const MAX_VERDICTS = 5000;

// assertVerdictBudget(verdicts): a hard cap on the traversal (Rule 8), refusing an oversized payload.
function assertVerdictBudget(verdicts) {
  if (verdicts.length > MAX_VERDICTS) throw new Error('quote-verify-gate: payload carries ' + verdicts.length + ' verdicts, over the MAX_VERDICTS cap of ' + MAX_VERDICTS + ' (Rule 8: budgets are caps; refusing an oversized payload rather than running unbounded)');
}

/**
 * assertMintablePayload(payload, opts) -> { ok:true, version, checkedQuotes, checkedRefs }. For a v1.1
 * payload it is a pass-through ({ version:'1.1', checkedQuotes:0, checkedRefs:0 }). For a v1.2 payload it
 * (1) rejects a payload whose verdict count exceeds MAX_VERDICTS (Rule 8: the budget cap must gate BEFORE
 * any unbounded traversal runs over the payload, including the structural decoder itself - Kimi K3 R2
 * #32), (2) structurally validates via the versioned decoder, then (3) for every Breach verdict resolves
 * its law/penalty against the hash-pinned catalogue and verifies its quote against the evidence store (and,
 * when the payload declares its own evidence, against that record set). THROWS on the first failure so the
 * mint never persists an unverifiable v1.2 payload.
 */
function assertMintablePayload(payload, opts) {
  const o = opts || {};
  if (decode.payloadVersionOf(payload) !== PAYLOAD_V1_2_VERSION) {
    return { ok: true, version: '1.1', checkedQuotes: 0, checkedRefs: 0 };
  }
  // Kimi K3 R2 #32: budget-check the raw verdicts array BEFORE the structural decoder walks it, so an
  // oversized payload is refused by the cheap length check rather than by an unbounded validator pass.
  assertVerdictBudget(Array.isArray(payload.verdicts) ? payload.verdicts : []);
  const structural = decode.validateV1_2(payload) || ['decoder returned no result array'];
  if (structural.length) throw new Error('quote-verify-gate: v1.2 payload is structurally invalid, refusing to mint: ' + structural.join('; '));
  const verdicts = Array.isArray(payload.verdicts) ? payload.verdicts : [];
  const counts = verifyBreachVerdicts(verdicts, o, payload);
  return { ok: true, version: PAYLOAD_V1_2_VERSION, checkedQuotes: counts.checkedQuotes, checkedRefs: counts.checkedRefs };
}

module.exports = { assertMintablePayload, MAX_VERDICTS };
