'use strict';
/**
 * breach/verifiers/register-absence.js - verifies a `register_absence` artifact: the artifact class
 * for a register NO-MATCH claim ("this firm does not appear on the SRA register"). It is the register
 * mirror of coverage-proof.js: an absence claim has no row to point at by definition, so its
 * deterministic artifact is proof that the lookup ACTUALLY RAN and returned no match (Constitution
 * Rule 3; caution.md C-004: a name-match failure is the only evidence of non-appearance, and a
 * lookup that never ran proves nothing).
 *
 * Contract (candidate.artifact when type === 'register_absence'):
 *   {
 *     type: 'register_absence',
 *     register,   // the key on EvidenceBundle.registers this claim concerns (e.g. 'sra')
 *     query,      // informational: what was looked up (may be null; the verifier does not read it)
 *     lane: 'no_match',
 *     note,       // the registers notes[] entry that recorded the outcome
 *   }
 *
 * verifyRegisterAbsence(artifact, bundle) proves TWO things independently of the artifact's own
 * claims (defence in depth, Rule 4; the proposer's assertion is not trusted alone):
 *   1. There is NO present row on bundle.registers[register] - you cannot claim a firm is absent from
 *      a register that returned a matched row for it.
 *   2. bundle.registers.notes[] carries an entry for THIS register whose kind is 'no_match'. This is
 *      the crux of C-004: a 'skipped' lookup (judged not applicable) or a 'degraded' lookup (a missing
 *      key, a fetch error, a timeout) proves NOTHING about whether the firm is registered; only a
 *      lookup that RAN and returned no name-match is evidence of non-appearance. A degraded/skipped/
 *      absent note is REJECTED (fail closed), never accepted as an absence proof.
 *
 * This directory never re-runs the name-match gate itself (that is evidence/registers/'s one door,
 * caution.md C-004, applied before the note ever reached the bundle): it proves only that the note
 * the candidate leans on genuinely records a ran-and-no-match outcome.
 */
const { CODES, accepted, rejected } = require('./result');

// KIND_PROVES_ABSENCE: the ONLY register-note kind that proves a firm is absent. A skipped or degraded
// lane recorded a note too, but neither ran a real name-match, so neither proves non-appearance (C-004).
const KIND_PROVES_ABSENCE = 'no_match';

// noteForRegister(bundle, register) -> the notes[] entry recording this register's lookup outcome, or
// null when no note exists (the lane never recorded running at all).
function noteForRegister(bundle, register) {
  const registers = (bundle && bundle.registers) || {};
  const notes = Array.isArray(registers.notes) ? registers.notes : [];
  return notes.find((n) => n && n.register === register) || null;
}

// verifyRegisterAbsence(artifact, bundle) -> {verified, code, reason}. Fails closed on: a missing
// register field, a register that actually returned a present row (so an absence claim is false), or a
// lookup that did not definitively run-and-no-match (a skipped/degraded/absent note proves nothing).
function verifyRegisterAbsence(artifact, bundle) {
  if (typeof artifact.register !== 'string' || !artifact.register) {
    return rejected(CODES.REGISTER_ABSENCE_MISSING_FIELDS, 'artifact.register is required');
  }
  const registers = (bundle && bundle.registers) || {};
  const present = registers[artifact.register];
  if (present && typeof present === 'object') {
    return rejected(
      CODES.REGISTER_ABSENCE_ROW_PRESENT,
      'bundle.registers.' + artifact.register + ' carries a present row; a non-appearance claim cannot stand against a matched register row'
    );
  }
  const note = noteForRegister(bundle, artifact.register);
  if (!note || note.kind !== KIND_PROVES_ABSENCE) {
    const seen = note ? note.kind : 'no note';
    return rejected(
      CODES.REGISTER_ABSENCE_NOT_PROVEN,
      'the ' + JSON.stringify(artifact.register) + ' lookup did not definitively run-and-no-match (saw: ' + seen
        + '); only a "no_match" note proves non-appearance (C-004: a skipped or degraded lookup proves nothing)'
    );
  }
  return accepted(
    CODES.REGISTER_ABSENCE_VERIFIED,
    'the ' + artifact.register + ' register lookup ran and returned no name-match (C-004): a definitive non-appearance'
  );
}

module.exports = { verifyRegisterAbsence, noteForRegister };
