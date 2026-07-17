# GAPS.md - historical failure classes not yet guarded by a live gate

This file ranks the historical failure classes from the old estate that have **no live guarding gate
yet**, by the phase that must close each one. It is the honest counterpart to
`docs/failure-ledger/crossref.json`: `tools/history-regression/check.js` prints these same classes
loudly on every run (the "NOT YET GUARDED" block) so a gap can never be quietly forgotten, and Rule 4
of the Constitution forces the ledger to flip a class to `guarded` the moment its planned gate lands.

A gap is honest; a **wrong guard is worse than an owned hole** (a class that falsely claims live
protection ships a false "we cover this"). When a class cannot yet be policed by a real gate, it is
marked `status=gap` with the phase that will build the gate - never force-fitted to an unrelated file.

## The host-substring gap (reclassified in PR #3)

`host-substring` (host/URL compared by substring or token without parsing:
`sharesTokenWithDomain` one-sided, the `hasLinkedin` persisted-socials bypass, ACT F-0004) was
previously marked `guarded` by `tools/lib/safe-path.js`. That was **wrong**: `safe-path.js` guards
FILESYSTEM path traversal, not URL-host comparison, and there is **no parsed-host comparison gate in
`facts/` yet** (only a single `new URL(...)` call site in `facts/identity.js`, not a gate). It is now
an honest **P3 gap** owned by the planned `tools/domain-gates/host-parse.js`, which must flag any
engine-side host comparison done by substring instead of a parsed-host equality check.

## Phase-owned gaps (rebuild the ranked list with `node tools/history-regression/check.js`)

| Phase | Class | Planned gate | Past severity |
|---|---|---|---|
| P2 | applicability-leak | applicability/attach.js | P0 |
| P3 | host-substring | tools/domain-gates/host-parse.js | P0 |
| P3 | crawl-poverty | evidence/crawler/coverage-contract.js | P0 |
| P3 | deadline-hang | tools/domain-gates/deadline-audit.js | P0 |
| P3 | evidence-lane-silent | evidence/browser/observe.js | P0 |
| P3 | breach-artifact | breach/verifiers/quote-match.js | P0 |
| P3 | absence-vs-observation | breach/adjudicator/evidence-kind.js | P0 |
| P3 | adjudication-abstention | breach/adjudicator/verdict.js | P0 |
| P3 | llm-unverified | llm/gate.js | P0 |
| P3 | module-scope-state | tools/no-module-state/check.js | P0 |
| P3 | budget-floor | tools/domain-gates/budget-caps.js | P1 |
| P4 | exposure-error | render-proof/truth-pack.spec.js | P0 |
| P4 | consistency-error | render-proof/truth-pack.spec.js | P0 |
| P4 | render-security-freshness | render-proof/truth-pack.spec.js | P0 |
| P4 | phantom-data | mint/post-write-assertions.js | P0 |
| P4 | cache-version | .github/workflows/engine-version-guard.yml | P0 |
| P4 | coverage-truth | render-proof/truth-pack.spec.js | P1 |

This table is derived from the ledger; the checker is the source of truth. If a planned gate above
now exists, the checker fails with `gap-gate-landed` until the class is flipped to `guarded`.
