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
`facts/` yet** (only a single `new URL(...)` call site in `facts/identity.js`, not a gate). It was
an honest **P3 gap** owned by the planned `tools/domain-gates/host-parse.js`, which must flag any
engine-side host comparison done by substring instead of a parsed-host equality check.

**Update (P3 Wave-2e, 2026-07-18): CLOSED.** `tools/domain-gates/host-parse.js` has landed for real; see
"Closed this phase" below.

## Closed this phase (P3 Wave-2e, 2026-07-18)

Four rows below flip from `gap` to `guarded` this pass. Each was verified before flipping (file exists,
exports the real logic, self-test/behavioural check run by hand), never taken on faith:

- **host-substring -> `tools/domain-gates/host-parse.js`.** File exists; `selfTest()` returns
  `pass:true` (catches `.includes`/`.indexOf`/`.endsWith`/`.startsWith` against a host identifier,
  clears parsed/scheme/dot/path checks). `node tools/domain-gates/host-parse.js --calibrate` catches
  all 3 seeded traps in `p3-crawl-host-substring.js` (lines 10, 15, 20). Now wired into
  `eval/calibration-known-bad/run.js` as the `host-substring` CALIBRATIONS entry; `--strict` run
  confirmed green. Fully CI-repeatable.
- **budget-floor -> `tools/domain-gates/budget-caps.js`.** File exists; `selfTest()` returns
  `pass:true` (catches `Math.max` floors by binding name and by referenced identifier, and
  oversize `setTimeout`/`AbortSignal`/budget-constant literals above the 120s cap; clears `Math.min`
  caps and in-budget values). `node tools/domain-gates/budget-caps.js --calibrate` catches all 3
  seeded traps in `p3-crawl-floor.js` (lines 10, 14, 18). Now wired into
  `eval/calibration-known-bad/run.js` as the `budget-floor` CALIBRATIONS entry; `--strict` run
  confirmed green. Fully CI-repeatable.
- **evidence-lane-silent -> `evidence/browser/observe.js`.** File exists and exports `observe()`.
  No standalone self-test, but its dedicated suite (`evidence/browser/observe.test.js`, 14 tests)
  passes in full, including the hanging-goto and hanging-launch deadline cases and the
  missing-Playwright-driver case (logged loudly, recorded on the lane, never silent - C-041). Both
  calibration fixtures run standalone and catch their planted disease
  (`p3-browser-deadline.js` = the 752s hang class, C-040; `p3-browser-preconsent-breach.js` = the PECR
  pre-consent cookie/tracker class, C-039) and are now wired into
  `eval/calibration-known-bad/run.js` as self-driving CALIBRATIONS entries; `--strict` run confirmed
  green. Fully CI-repeatable (via `npm test` + `npm run calibrate`).
- **crawl-poverty -> `evidence/crawler/coverage-contract.js`.** File exists, exports `classify`,
  `computeCoverage`, `coverageFor`, `isScreened`, `applyCoverage`, and is genuinely load-bearing
  (`evidence/crawler/crawl.js` requires it and calls it in `buildCoverage()` on every real crawl, so
  this is not dormant/orphaned code). No `selfTest()` export and no `--calibrate` CLI, so it cannot be
  wired into `eval/calibration-known-bad/run.js`'s CALIBRATIONS registry (that pattern needs an
  external checker with a `--calibrate` contract). Verified instead by directly requiring the module
  and running it against the real fixture and the core poverty scenario: all 10 cases in
  `p3-crawl-substring-classify.json` classify correctly (the `cost-of-living` / `feedback` / `returning-customers`
  / `termination-of-employment` substring traps are all resisted, C-044), an empty/unreachable crawl
  correctly screens (`render_class: 'screened'`) and `applyCoverage()` correctly drops `miss` findings
  on a screened site (the crawl-poverty guard itself, C-029/C-037/C-038), and a fully-covered crawl
  correctly reports `assessable`. **Caveat, flagged honestly rather than papered over:**
  `evidence/crawler/coverage-contract.test.js` does not exist yet (no `evidence/crawler/*.test.js`
  files exist at all - a W1a session-limit casualty), so this verification was a one-off manual check,
  not a standing regression lock; nothing in the automated fleet would currently catch a future
  regression here. Flipped because the code is real, reachable and verified correct today; the missing
  test file is tracked separately as an open risk, not as a reason to leave this row marked `gap`.

## Also closed this phase (landed mid-run, beyond the original 4-item brief)

Parallel wave-2 builders landed `llm/` and `breach/` content while this pass was in progress (this file's
brief named only the 4 rows above). The other 4 below were discovered and verified using the identical
standard - a real, working, repeatable proof, never mere file existence - before being flipped, so GAPS.md
does not go stale the moment this pass ends:

- **llm-unverified -> `llm/gate.js`.** File exists, exports `validateResponse` (Constitution Rule 12
  gates 1+2: retrieval-gated emission, verbatim quote re-match). No standalone `selfTest()`, but the
  module IS its own checker (the `facts/identity.js` / `evidence/registers/registers.js` pattern):
  `node llm/gate.js --calibrate` scans every `p3-llm-*.json` fixture and correctly HARD-REJECTS both
  seeded poisons (`p3-llm-outofset-citation.json` -> `out_of_set_source_id`; `p3-llm-quote-drift.json`
  -> `quote_drift`). Its own dedicated suite (`llm/gate.test.js`) passes in full. Now wired into
  `eval/calibration-known-bad/run.js` as the `llm-gate` CALIBRATIONS entry; `--strict` run confirmed
  green. Fully CI-repeatable.
- **breach-artifact -> `breach/verifiers/quote-match.js`.** File exists, exports `verifyCandidate` /
  `verifyAll` (Constitution Rule 3: no artifact, no breach). Same self-checking pattern:
  `node breach/verifiers/quote-match.js --calibrate` scans every `p3-verifier-*.json` fixture and
  correctly refuses all 4 seeded poisons across every artifact kind Rule 3 names - a one-character-drifted
  quote (`quote_mismatch`), a network event never actually observed (`network_event_not_found`), a
  register row that does not match the cited one (`register_row_mismatch`), and coverage that is
  truncated so an absence claim cannot be proven (`coverage_proof_truncated`). Its own dedicated suite
  (`breach/verifiers/quote-match.test.js`) passes in full. Now wired into
  `eval/calibration-known-bad/run.js` as the `breach-artifact-rejected` CALIBRATIONS entry; `--strict`
  run confirmed green. Fully CI-repeatable.
- **absence-vs-observation -> `breach/adjudicator/evidence-kind.js`.** File exists, exports
  `classifyEvidenceKind` (C-085: `_kindOf()` once mapped every compliance finding to absence, so browser
  observations could never confirm). Landed with its own dedicated suite
  (`breach/adjudicator/evidence-kind.test.js`, run in isolation: 100% pass), including a test named
  exactly for the disease it closes: "MASQUERADE the other way (C-085): a real observation mislabelled
  absence is REJECTED, never silently dropped." No `p3-adjudicator-*` fixture targets this file
  specifically (the one that landed, below, targets `adjudicate.js`), but the dedicated suite is real,
  passing, and CI-repeatable via `npm test` - a stronger proof than a bare `--calibrate` CLI with no
  fixture would be.
- **adjudication-abstention -> `breach/adjudicator/verdict.js`.** File exists, exports `parseVerdict`
  (Rule 6 / Rule 12 gate 4: the abstain-by-default confidence floor; C-082/C-086/C-092: an ambiguous
  "unclear, leaning no" once stayed CONFIRMED with its fine). `breach/adjudicator/verdict.test.js`
  directly consumes the real seeded fixture `p3-adjudicator-unparseable-verdict.json` (13 malformed/
  unprovable verdict shapes, all asserted to `needs_review`, plus 2 clean controls proving the gate does
  not just abstain on everything) as one of its 49 tests; run in isolation, all 49 pass. Fully
  CI-repeatable via `npm test`.

`breach/adjudicator/adjudicate.js` (the orchestrator both of the above feed into) also landed with its
own suite (`adjudicate.test.js`) and a self-driving calibration fixture,
`p3-adjudicator-invented-finding.js` (Rule 11 / C-083: the adjudicator is filter-only - a hostile
`llmCall` that tries to inject a fabricated finding and clear a real one with an unproven `no_breach`
must be structurally incapable of either). It catches its trap standalone and is now wired into
`eval/calibration-known-bad/run.js` as the self-driving `p3-adjudicator-invented-finding` entry. This is
supporting evidence for the two rows above rather than its own GAPS.md row (no row named `adjudicate.js`
exists in the table below).

## Phase-owned gaps (rebuild the ranked list with `node tools/history-regression/check.js`)

9 of the original 17 phase-owned gap classes remain; 8 closed this phase (4 from the explicit brief + 4
discovered mid-run, as parallel wave-2 builders landed `llm/` and `breach/` while this pass was running).

| Phase | Class | Planned gate | Past severity |
|---|---|---|---|
| P2 | applicability-leak | applicability/attach.js | P0 |
| P3 | deadline-hang | tools/domain-gates/deadline-audit.js | P0 |
| P3 | module-scope-state | tools/no-module-state/check.js | P0 |
| P4 | exposure-error | render-proof/truth-pack.spec.js | P0 |
| P4 | consistency-error | render-proof/truth-pack.spec.js | P0 |
| P4 | render-security-freshness | render-proof/truth-pack.spec.js | P0 |
| P4 | phantom-data | mint/post-write-assertions.js | P0 |
| P4 | cache-version | .github/workflows/engine-version-guard.yml | P0 |
| P4 | coverage-truth | render-proof/truth-pack.spec.js | P1 |

This table is derived from the ledger; the checker is the source of truth. If a planned gate above
now exists, the checker fails with `gap-gate-landed` until the class is flipped to `guarded`.

**Open handoff (not this file's ownership):** `docs/failure-ledger/crossref.json` and
`tools/history-regression/taxonomy.js` still mark all 8 closed classes above (`host-substring`,
`budget-floor`, `evidence-lane-silent`, `crawl-poverty`, `llm-unverified`, `breach-artifact`,
`absence-vs-observation`, `adjudication-abstention`) as `status: "gap"`.
`tools/history-regression/taxonomy.js` lives under `tools/`, out of scope for this pass, so it was not
edited here. As a result `node tools/history-regression/check.js` currently exits 1 with 8
`gap-gate-landed` violations, one per class closed above - this is expected and is the checker correctly
doing its job (Rule 4: it will keep failing until the taxonomy is flipped and the crossref is rebuilt).
It is not wired into `npm run sweep` or any CI workflow today (checked: no reference in `tools/sweep/`
or `.github/workflows/`), so none of this currently blocks the sweep or CI. Whoever owns
`tools/history-regression/taxonomy.js` should flip these 8 classes' `status` to `guarded` and run
`node tools/history-regression/build-crossref.js --sweep <sweep-findings-path>` to rebuild
`crossref.json` so the two ledgers agree again.
