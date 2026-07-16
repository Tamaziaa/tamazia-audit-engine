// dependency-cruiser config for tamazia-audit-engine.
//
// Two blocking concerns, straight from the forensic ("nothing asserts a thing is actually reached"):
//   no-circular - circular requires hide execution order bugs and make one-door impossible to reason about.
//   no-orphans  - a module nobody requires and that requires nothing is built-but-never-called,
//                 the exact disease class this repo exists to kill. Reachable-or-DORMANT.
//
// Entry points (CLI scripts named run.js / check.js, config files) are legitimately "orphan-shaped"
// and are excepted below. Everything else must be reachable.

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependency - refactor to a one-way flow (Resolve -> Classify -> Apply -> Detect).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'Module is not reachable from anything and reaches nothing - built-but-never-called. ' +
        'Wire it in, delete it, or list it in DORMANT.md and add it to the exceptions here with a reason.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs)$', // dot config files
          '[.]config[.](?:js|cjs|mjs)$', // *.config.js
          '(^|/)(run|check|cli|index)[.]js$', // CLI entry points and barrel indexes
          '^tools/sweep/(normalise|ledger|collect-[^/]+)[.]js$', // spawn-invoked by tools/sweep/run.js as child processes, not requires
          '^eval/reference-set/verify[.]js$', // CLI verifier: node eval/reference-set/verify.js <payload.json>
          '(^|/)fixtures?/', // test fixtures are data, loaded dynamically
          '[.]test[.]js$', // node --test discovers these itself
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|docs|reports|coverage|[.]git|[.]jscpd-report|[.]stryker-tmp)($|/)' },
    includeOnly: '^(applicability|breach|catalogue|eval|evidence|facts|llm|mint|payload|render-proof|tools)/',
    moduleSystems: ['cjs', 'es6'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
