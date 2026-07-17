'use strict';
/**
 * breach/verifiers/register-row.js - verifies a `register_row` artifact (Constitution Rule 3: "a
 * register row" is one of the four things a breach finding may carry as its deterministic artifact).
 *
 * Contract (candidate.artifact when type === 'register_row'):
 *   { type: 'register_row', register: 'companiesHouse'|'gleif'|'sra'|'cqc'|'fca'|'ico', row: {...} }
 *
 * `register` names the key on EvidenceBundle.registers (facts/README.md); `row` is the EXACT row
 * object the candidate is citing as its evidence, copied verbatim from what the candidate read off
 * the bundle. verifyRegisterRow does not re-run the name-match gate (caution.md C-004: that is
 * evidence/registers/'s one door, already applied before the row ever reached the bundle) - it proves
 * only that the cited row is not a paraphrase or an invention: it deep-equals the row actually present
 * on bundle.registers[register]. This directory never hardcodes the six register keys itself (that
 * enumeration belongs to evidence/registers/registers.js, Rule 1's one-door doctrine): an unknown or
 * misspelt register key simply has no bundle row to match, so it is rejected by the same absence path
 * as a genuinely missing register, with no separate allow-list to keep in sync.
 */
const { isDeepStrictEqual } = require('util');
const { CODES, accepted, rejected } = require('./result');

// verifyRegisterRow(artifact, bundle) -> {verified, code, reason}. Fails closed on: a missing
// register/row field, a register key absent from bundle.registers, or a cited row whose content
// differs from the bundle's row in any field (an altered figure, a fabricated number, a dropped
// provenance field - all count as a mismatch; Rule 12 Gate 2's "exact re-match" ethos applied to
// structured data, not just prose).
function verifyRegisterRow(artifact, bundle) {
  if (typeof artifact.register !== 'string' || !artifact.register) {
    return rejected(CODES.REGISTER_ROW_MISSING_FIELDS, 'artifact.register is required');
  }
  if (!artifact.row || typeof artifact.row !== 'object' || Array.isArray(artifact.row)) {
    return rejected(CODES.REGISTER_ROW_MISSING_FIELDS, 'artifact.row is required (the exact row object the candidate cites)');
  }
  const registers = (bundle && bundle.registers) || {};
  const actual = registers[artifact.register];
  if (!actual || typeof actual !== 'object') {
    return rejected(CODES.REGISTER_ROW_ABSENT, 'bundle.registers has no row for ' + JSON.stringify(artifact.register));
  }
  if (!isDeepStrictEqual(actual, artifact.row)) {
    return rejected(
      CODES.REGISTER_ROW_MISMATCH,
      'the cited row does not exactly match bundle.registers.' + artifact.register
    );
  }
  return accepted(CODES.REGISTER_ROW_VERIFIED, 'row exact-matched bundle.registers.' + artifact.register);
}

module.exports = { verifyRegisterRow };
