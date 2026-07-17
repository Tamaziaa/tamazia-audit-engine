'use strict';
/**
 * tools/health-gate/heuristic.js - the EXPLICIT-REFUSAL fallback for tools/health-gate/check.js.
 *
 * There used to be a brace/indent approximation engine here. It was removed on purpose (PR #3): a
 * regex/brace approximation of JavaScript structure cannot see code inside template-literal ${...}
 * expressions, mis-reads regex-literal braces like /}/ as block structure, and cannot count braceless
 * control nesting (`if (a) if (b) if (c) ...`). Every one of those is a CONFIDENT ZERO - the gate
 * reports "clean" on exactly the complexity it exists to catch. Under-reporting is an unearned zero,
 * and an unearned zero is worse than no gate at all (Constitution Rule 4).
 *
 * acorn is therefore MANDATORY. It is always present in this repo as a transitive devDependency of
 * eslint, so the real engine is always available. When acorn genuinely cannot be required (or when
 * HEALTH_GATE_ENGINE=heuristic forces this path so the fallback's fail-closed behaviour is exercised
 * in CI, mirroring SWALLOW_GATE_ENGINE=regex), this module REFUSES rather than approximates: it throws,
 * check.js surfaces that as exit 2 (a broken tool), and no green is ever reported from an engine that
 * could not actually parse the source.
 */

// refuseHeuristicScan(relPath) -> never returns; always throws. This IS the fallback: refuse, do not
// approximate. The thrown error is the typed failure state (not a swallow) check.js turns into exit 2.
function refuseHeuristicScan(relPath) {
  throw new Error(
    'health-gate: the heuristic fallback REFUSES to scan ' + relPath + ' - a brace/indent approximation '
    + 'under-reports template ${} code, regex-literal braces and braceless nesting (all confident zeros). '
    + 'acorn is mandatory (it ships via eslint); install dependencies so the real parser is available. '
    + 'Under-reporting is an unearned zero, which is worse than no gate (Constitution Rule 4).'
  );
}

module.exports = { refuseHeuristicScan };
