'use strict';
// evidence/registers/lib/notes.js: the shared notes[] entry shape every register module in this
// directory uses when a field is absent (C-041 doctrine, ported from the browser evidence lane's own
// rule in docs/P3-ACCEPTANCE.md: a missing evidence-lane dependency is logged loudly and recorded,
// never silently skipped). `kind` is one of:
//   'skipped'  : a register was correctly judged not applicable (e.g. SRA on a hospitality site);
//                this is a budget decision (Rule 8), not a gap.
//   'degraded' : a register SHOULD have been checked but could not be: a missing key/config, a fetch
//                error, or a timeout. This is the founder-blocked / infra-gap class.
//   'no_match' : the register answered but no candidate cleared the name-match threshold (C-004), or
//                answered with zero candidates at all.

// makeNote({ register, kind, reason, detail, log }) -> the shared notes[] entry. An options object (the
// <=4-positional-arg house style; five distinct inputs). `log` is an optional best-effort side channel.
function makeNote({ register, kind, reason, detail, log }) {
  const note = { register, kind, reason, detail: detail || null };
  if (typeof log === 'function') {
    try {
      log({ level: 'warn', source: 'evidence/registers', ...note });
    } catch (_err) {
      // FAIL-OPEN: an injected logger throwing must never break the lookup itself. The note object
      // returned to the caller (and pushed onto bundle.notes[]) IS the durable record of this event;
      // the logger call above is a best-effort side channel on top of it, not the record itself.
    }
  }
  return note;
}

module.exports = { makeNote };
