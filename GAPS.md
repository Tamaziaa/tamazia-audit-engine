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
  `evidence/crawler/coverage-contract.test.js` still does not exist (unlike its siblings -
  `evidence/crawler/crawl.test.js` and `pool.test.js` landed mid-pass and both pass in full, including
  `crawl.test.js`'s own use of the previously-orphaned `p3-crawl-querystring.json` and
  `p3-crawl-login-reachable.json` fixtures - but `coverage-contract.js` itself has no dedicated suite
  yet), so this verification was a one-off manual check, not a standing regression lock; nothing in the
  automated fleet would currently catch a future regression in `classify()`/`computeCoverage()`
  specifically. Flipped because the code is real, reachable and verified correct today; the missing
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

## Closed this phase (P4 T0, 2026-07-19)

One row flips from `gap` to `guarded` this pass, verified before flipping (file exists, exports the real
logic, calibration + suite run by hand), never taken on faith:

- **applicability-leak -> `applicability/connect.js`.** File exists and exports `connect(facts, catalogue)`,
  the ONE applicability door: a pure, synchronous set-membership filter over the fact envelopes that
  decides which catalogue records bind a firm. `serves[]` never attaches (Constitution Rule 13, the leak
  killer); the six structural gates (jurisdiction, sub-jurisdiction, displacement, sector, activity tags,
  required nexus) are each tested in `applicability/connect.test.js` (42 tests, including an integration
  leg that drives the real facts doors + the compiled catalogue and proves ZERO jurisdiction leak on
  `russell-cooke`/`lomond` plus `russell-cooke` usefulness). Its self-driving calibration fixture
  `eval/calibration-known-bad/fixtures/p4-applicability-leak.js` catches the trap standalone (a US record
  attaching to a UK-bound firm) on a MANDATORY embedded two-record catalogue that runs even before
  `npm run catalogue`, and is wired into `eval/calibration-known-bad/run.js` as the `p4-applicability-leak`
  entry; `--strict` run confirmed green with and without the dist artifact. Fully CI-repeatable.
  `applicability/conflicts.js` (the C-073 family-dedupe door, shared by the counts) landed alongside it.

## Closed this phase (P4 W4, 2026-07-19)

One row flips from `gap` to `guarded` this pass, verified before flipping (file exists, node:test suite
green, selfTest() proven both directions by hand), never taken on faith:

- **cache-version -> `.github/workflows/engine-version-guard.yml`.** The workflow exists (PR-triggered on
  `pull_request` against `main`, full-history checkout so a real `git merge-base` is possible) and invokes
  `tools/engine-version-guard/check.js <base-sha>`, which does the real work: `git diff --name-only` against
  the merge base, classified against the Rule-15 scan-logic surface (`evidence/**`, `facts/**`,
  `applicability/**`, `breach/**`, `llm/**` production `.js` excluding `*.test.js`, plus
  `catalogue/compile.js` and `payload/composer/**`), and a FAIL when any of that surface changed while
  `mint/version.js`'s `ENGINE_VERSION` is byte-identical at the merge base and HEAD. `selfTest()` proves,
  in memory and before any git command runs, that the guard sees bump-missing (fails), bump-present
  (passes) AND a test-only change (passes) - 12 self-test cases including near-miss fixtures for the
  C-019 prefix-without-delimiter class (`evidence-old/` is not `evidence/`). `node --test
  tools/engine-version-guard/` passes in full (17 tests), including three end-to-end cases run against a
  hermetic scratch git repo (real `git merge-base`/`git diff`/`git show`, never mocked) proving each of the
  three directions through the actual git plumbing, not just the pure decision function. Manually verified
  a fourth way: a full scratch clone of this worktree, three temp branches off the same base (scan-logic
  change with no bump / with a bump / test-only), the real CLI invoked in each - exit 1, exit 0, exit 0
  respectively (commands recorded in the W4 self-report). Fully CI-repeatable.

## Closed this phase (P4 T3b, 2026-07-19)

The final four P4 gap classes flip from `gap` to `guarded` this pass, verified before flipping (the gate file
exists, its node:test suite is green, and each rule earns its zero against a seeded known-bad by hand), never
taken on faith:

- **exposure-error, consistency-error, render-security-freshness, coverage-truth ->
  `render-proof/truth-pack.spec.js`.** The gate file exists, backed by the pure checker
  `render-proof/truth-pack.js` (`check(payload, renderedText, opts) -> {ok, violations}`, zero I/O, injected
  catalogue + clock, never a Date.now). Seven rules, each mapped to its caution pointer and each earned by a
  seeded known-bad in the spec: notLegalAdvice (C-200), exposure-headline (C-094/C-096 -> **exposure-error**),
  money-provenance + framework-provenance + voice (C-111/C-112/C-114/C-115 -> **consistency-error**),
  counts-coherence (C-117/C-118 -> **coverage-truth**) and render-security-freshness (C-122 ->
  **render-security-freshness**). The golden render - a REAL composed v1.1 payload recorded as a fixture -
  passes every rule with zero violations; each seeded known-bad (a fabricated GBP amount, a stripped
  not-legal-advice line, the ceiling as a bare headline, a confident-voiced needs_review name, a dropped
  counts line, a stale generatedAt, a missing-sig HMAC URL) trips exactly its named rule and only it. `node
  --test render-proof/truth-pack.spec.js` passes in full (20 tests); it also runs under `npm test` via the
  `render-proof/truth-pack.test.js` discovery shim (Node's default runner discovers `*.test.js`, not
  `*.spec.js`, so the named-gate `.spec.js` would otherwise be a hollow green). Wired into the mint done-gate:
  `mint/post-write-assertions.js` now runs the REAL pack when the caller supplies `opts.renderedText` and,
  absent both a `truthPackFn` and `renderedText`, stays honestly not-run so the mint withholds `done` (Rule 7).
  requireHmac stays FALSE until the website binds `AUDIT_HMAC_SECRET` end-to-end (C-122: dead security code is
  theatre; the gate exists so turning it on is a one-flag change). **Honest deviation, recorded once:** the
  task's canonical fixture source (the website lux renderer `public/audit/audit-lux.js` + `functions/audit/
  _lux.js` + `_qa/qa_lux.mjs`, the v11 golden, and jsdom) does not exist at this commit - the p4-t4 lux
  renderer is a separate in-flight prototype and jsdom, though declared in the website devDependencies, is not
  installed - so the recorded render is produced by a committed faithful reference renderer
  (`render-proof/fixtures/reference-render.js`) via `node render-proof/fixtures/gen-fixtures.js`; the checker
  is renderer-AGNOSTIC (it reads visible text), so re-recording from the lux renderer when it lands changes no
  rule. The golden firm is pseudonymous and the law names are illustrative fixtures, never a claim about a
  real firm or live law (Rule 16 / the compose.test.js tradition).

## Phase-owned gaps (rebuild the ranked list with `node tools/history-regression/check.js`)

**ZERO phase-owned gap classes remain (P4 T3b, 2026-07-19).** Every historical failure class now names a LIVE
guarding gate. `applicability-leak` closed in P4 T0, `phantom-data` in P4 T1, `cache-version` in P4 W4, and
the final four render classes (`exposure-error`, `consistency-error`, `render-security-freshness`,
`coverage-truth`) in P4 T3b (above), all `render-proof/truth-pack.spec.js`-gated. The P3 wave had already
closed `deadline-hang` and `module-scope-state`. `node tools/history-regression/check.js` exits 0 with
**43 guarded classes, 0 gap classes**, 0 integrity violations - the "NOT YET GUARDED" block is now empty.

| Phase | Class | Planned gate | Past severity |
|---|---|---|---|
| - | (none - every class is guarded) | - | - |

This table is derived from the ledger; the checker is the source of truth. If a future gap class is added it
reappears here, and the checker fails with `gap-gate-landed` the moment its planned gate file lands, until the
class is flipped to `guarded`.

**Handoff resolved (P4 T0, 2026-07-19):** the eight P3-closed classes above (`host-substring`,
`budget-floor`, `evidence-lane-silent`, `crawl-poverty`, `llm-unverified`, `breach-artifact`,
`absence-vs-observation`, `adjudication-abstention`) and `applicability-leak` are all now
`status: "guarded"` in `tools/history-regression/taxonomy.js`, and `docs/failure-ledger/crossref.json`
was rebuilt with `node tools/history-regression/build-crossref.js` so the two ledgers agree.
`node tools/history-regression/check.js` exits 0 (37 guarded classes, 6 gap classes, 0 integrity
violations); the six remaining gaps at that point were the P4 render/mint/version classes.

**Update (P4 W4, 2026-07-19):** `phantom-data` was also closed in the same-day P4 T1 pipeline commit
(`mint/post-write-assertions.js` landed) but this table was not updated then - a stale row corrected here
rather than left to mislead the next reader (this table's own header names the checker, not this file, as
the source of truth; the row was documentation drift, not a ledger error, and `tools/history-regression/
check.js` was green throughout because it reads `docs/failure-ledger/crossref.json`, not this table). With
`cache-version` now also closed, `node tools/history-regression/check.js` exits 0 with **39 guarded
classes, 4 gap classes**, 0 integrity violations; the four remaining gaps are exactly the render-proof
classes listed above, all T3b-owned.

**Update (P4 T3b, 2026-07-19):** the four render classes (`exposure-error`, `consistency-error`,
`render-security-freshness`, `coverage-truth`) closed with `render-proof/truth-pack.spec.js`.
`docs/failure-ledger/crossref.json` was flipped surgically (the four class rows + the one `exposure-error`
defect entry: status `gap` -> `guarded`, phase `P4` -> `null`, totals recomputed to 43 guarded / 0 gap) to
agree with `tools/history-regression/taxonomy.js`, following the W4/T1 precedent. `node
tools/history-regression/check.js` now exits 0 with **43 guarded classes, 0 gap classes**, 0 integrity
violations - no P4 gap rows remain.

**Update (P4 T3b CodeRabbit pass, 2026-07-19): two rows corrected for honesty, still 0 gap.** CodeRabbit
review on PR #20 found the T3b entry above overstated what `render-proof/truth-pack.spec.js` alone proves,
for two rows:

- **`exposure-error` and `coverage-truth` re-attributed to `payload/composer/compose.test.js`.** The render
  truth-pack can only prove the RENDER matches whatever the PAYLOAD already says; it cannot prove the
  payload's own exposure maths or coverage counts were correctly COMPUTED - a wrong figure computed upstream
  (statutory maxima summed, a coverage count never read) would render-match itself perfectly and pass
  truth-pack cleanly. The gate that actually proves the computation right is `payload/composer/compose.js`'s
  dedicated tests in `compose.test.js` ("exposure never sums statutory maxima...", "exposure de-dupes to one
  figure per family...", "the three framework counts read connect() counts VERBATIM...",
  "screenedLabel reflects the site-level coverage state..."). Both classes stay `guarded` (a real, passing,
  on-point gate exists for each), only the `catching_gate` pointer moves to the file that actually earns the
  claim; `render-proof/truth-pack.spec.js` remains a real, additional, but DISTINCT render-drift guard for
  both classes (its exposure-headline and counts-coherence rules), not the producer-correctness gate the row
  used to claim.
- **`render-security-freshness` narrowed to the freshness subcase only.** The class's own description names
  "HMAC gated on an unbound secret" as a historical failure mode; `render-proof/truth-pack.js`'s HMAC check
  (`checkSecurity()`) only runs when `opts.requireHmac` is true, and requireHmac stays FALSE everywhere in
  the live mint path until the website binds `AUDIT_HMAC_SECRET` end-to-end (still true today - see
  `docs/discovery/digest-website-render.md`: the HMAC block is currently inert, the only live access barrier
  is the 8-char hash). The row stays `guarded` because the freshness half (generatedAt vs the injected clock)
  is genuinely unconditional and live on every mint, but the taxonomy.js comment now says explicitly that the
  HMAC subcase is NOT covered by this "guarded" claim until the secret binds and a deterministic CI test
  exercises the mint with `requireHmac: true` actually turned on - "dead security code is theatre" (C-122)
  applies to a disabled check exactly as much as to a missing one.

Both `payload/composer/compose.test.js` and `render-proof/truth-pack.spec.js` are live files, so this is a
same-status re-attribution and an honesty narrowing, not a new gap: `node tools/history-regression/check.js`
still exits 0 with **43 guarded classes, 0 gap classes**, 0 integrity violations after
`docs/failure-ledger/crossref.json` was rebuilt from the corrected `taxonomy.js`
(`node tools/history-regression/build-crossref.js --sweep tools/sweep/out/ledger.json`).
