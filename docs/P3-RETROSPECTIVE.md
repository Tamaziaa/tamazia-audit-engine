# P3 retrospective and gap audit: tamazia-audit-engine

Auditor: retrospective agent, reporting to Rob (Fable). Read-only pass; the only file this
audit wrote is this document.

Repo: `/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine`, branch `p3-evidence`,
committed HEAD `f0333b0` (26 commits on `main..HEAD`, of which about 18 are "P3 CHECKPOINT N"
saves). Scope note honoured: the free-model / external-delegation thread is deliberately
excluded from this document per founder instruction; this retrospective covers only the P3
engine work (evidence + breach, the five gates, the e2e / reference-set harness, the fix wave,
the agent failures, and the genuine engine gaps).

## Meta caveat: the tree moved under this audit (C-208 / C-218, observed live)

At the start of this audit the working tree was clean at `f0333b0`. Part-way through, a
parallel CodeScene builder began editing seven files in place
(`breach/proposers/propose.js`, `evidence/crawler/coverage-contract.js`, `llm/entailment.js`,
`llm/evals/run.js`, `llm/gate.js`, `llm/router.js`, `tools/no-module-state/check.js`). A full
`node --test` on that dirty tree failed 27 tests (all in `llm/entailment.test.js` /
`llm/evals/run.test.js`), which is the builder's in-flight state, not committed HEAD. Every
load-bearing claim below was therefore re-checked against the committed blob via
`git archive f0333b0` into a clean tree. This is itself the "verification on a moving tree"
mistake the phase already codified (C-208), experienced first-hand.

Authoritative committed-HEAD result: `git archive f0333b0` into a fresh tree, `npm run catalogue`
(the CI-required compile step), then `node --test` gives **1081 pass / 0 fail, exit 0**. The
"1081 tests green" checkpoint claim holds against the real CI invocation. A fresh archive
WITHOUT the compile step fails 11 catalogue-consumer tests, which is the gitignored-built-artifact
dependency (C-240) that `ci.yml` handles by compiling before the suites.

## Verification runs executed this session (read-only)

| Gate | Result | Note |
|---|---|---|
| `node eval/e2e/run-pipeline.js --breach-inline` | RESULT OK, exit 0 | but 0/5 known_breaches reproduced, 5 MISSED; 6/9 red-team CAUGHT, 3 SKIPPED |
| `node tools/health-gate/check.js` | 30 violations, exit 0 (advisory) | ALL in `facts/*` (P2) + `tools/sweep` + `tools/swallow-gate`; ZERO in P3 files |
| `node tools/history-regression/check.js` | exit 0 | 36 guarded, 7 gap (1 P2 + 6 P4); the 8-class taxonomy flip landed |
| `node tools/sweep/run.js` | GREEN, exit 0 | ACT 0, 3 single-tool jscpd leads; deadline-audit 0, no-module-state 0 |
| `node llm/evals/run.js` | precision 1.000, exit 0 | scripted model; 3 known-breach positive controls ship `violation` |
| `node --test` (clean HEAD, post-compile) | 1081 pass / 0 fail | the backbone of every PROVEN claim below |

Headline: every structural gate is green, but the one criterion that proves the engine can
actually find a breach is unmet, and the exit bar is written so it does not care.

---

## A. DONE

### A.1 PROVEN (a passing test or gate demonstrates it)

Each item names the artefact that proves it; all pass in the clean-HEAD suite.

1. **Crawler E-236 parallelism, Tier-1-before-cap, pool deadline-as-cap, documents no-parser
   interlock.** `evidence/crawler/crawl.test.js` (Tier-1 legal page discovered last still beats
   commercial pages before the cap), `evidence/crawler/pool.test.js` (two deadline-as-cap tests,
   past-deadline items yield null, never floored), `evidence/documents/documents.test.js:89`
   (an unread footer PDF demotes the privacy obligation to needs-review). The prior 3-source
   completeness audit graded all four PROVEN and the suite still passes.
2. **Register no-match name-match (C-004).** `evidence/registers/registers.test.js` (57 tests)
   plus calibration fixtures `p3-register-http200-nonmatch.json` /
   `p3-register-multi-register-nonmatch.json`, wired into `--strict` as `register-nonmatch-rejected`.
   A HTTP-200 register response that is not a real name match yields no row.
3. **Browser PECR pre-consent lane, hard outer deadline (the 752s class, C-040).**
   `evidence/browser/observe.test.js` (36 tests, fake-browser injected), a hanging goto and a
   hanging launch both return in bounded wall time and force-close; calibration fixtures
   `p3-browser-deadline.js` and `p3-browser-preconsent-breach.js` are self-driving.
4. **Adjudicator is filter-only and cannot invent a finding (Rule 11).**
   `breach/adjudicator/adjudicate.test.js` with `p3-adjudicator-invented-finding.js` proves
   `|output| == |input|`; a hostile `llmCall` that tries to inject a fabricated finding or clear
   a real one cannot do either.
5. **Abstain-by-default verdict floor (Rule 6 / gate 4).** `breach/adjudicator/verdict.test.js`
   consumes `p3-adjudicator-unparseable-verdict.json` (13 malformed verdict shapes plus 2 clean
   controls); all resolve to `needs_review`.
6. **Observed facts bypass the model (C-084/C-085).** `breach/adjudicator/evidence-kind.test.js`
   including the test named for the disease it closes (a real observation mislabelled as absence
   is rejected, never silently dropped).
7. **Gate 3 (NLI entailment) is a real executing module, wired into adjudicate, with fixtures
   (C-234 closed).** `llm/entailment.js` (`checkEntailment`) is imported by
   `breach/adjudicator/adjudicate.js:30` and called by `gateEntailment` on every `breach` verdict
   before it may become a `violation` (`adjudicate.js:312`). Proof: `llm/entailment.test.js`,
   `llm/evals/fixtures/ent-*.json` (contradiction / entailed / neutral / garbage / out-of-set),
   and adjudicate.test.js GATE-3 cases (a breach whose verified quote does not entail the claim
   demotes to `needs_review`). This was comment-only before P3; it is now real.
8. **llm-eval is a blocking precision gate.** `llm/evals/run.js` exits 1 when precision drops
   below 1.0 or an immunity veto fires; wired into `.github/workflows/llm-eval.yml`. Ran this
   session: precision 1.000 (TP=4, FP=0, FN=0), and the three positive controls
   (`adj-known-breach-cookie/register/text`) each ship `states=[violation]`.
9. **Detection-spec migration compiles cleanly and matches real corpora.** 92 catalogue records
   compile to **145 DetectionSpecs, 0 rejected** (`breach/proposers/detection-spec.js`
   `compileCatalogue`). On the real crawled fixtures the proposer emits 121-131 candidates per
   firm, so the specs demonstrably match real text, not only compile. `detection-spec.test.js`
   and `pattern-match.test.js` back the grammar.
10. **The detection-spec ReDoS P0 is killed (C-226/C-227).** Token-by-token matching in JS plus a
    child-process hard kill (`eval/e2e/lib/breach-worker.js`); the 45s CA_RPC hang is gone.
11. **RT-F contradictory-entity escape closed (C-232).** `facts/identity.js` now abstains a
    register row contradicted by an on-page company number; `facts/identity.test.js` and the e2e
    red-team lane report RT-F CAUGHT.
12. **Fresh-clone catalogue-compile-before-tests (C-240/C-201).** `.github/workflows/ci.yml`
    compiles the catalogue before the unit suites (commit `1ad904d`). Reproduced both states this
    session: archive without compile fails 11 catalogue tests, with compile passes 1081.
13. **The two open P3 failure-class gates landed.** `tools/domain-gates/deadline-audit.js`
    (deadline-hang, 0 undeadlined external-call sites) and `tools/no-module-state/check.js`
    (module-scope-state, 0 violations), both "self-test earned"; both flipped out of the
    history-regression gap list.
14. **The 8-class taxonomy flip and ledger reconciliation.** `history-regression/check.js` now
    exits 0 (was exit 1 with 8 `gap-gate-landed`); GAPS.md and `crossref.json` agree.
15. **Caution bible C-208..C-257 plus the index.** 50 new pointers codifying this phase's
    failures (`caution.md`, `docs/caution-index.md`).

### A.2 PRESENT-BUT-WEAK / PRESENT-UNPROVEN

These exist and are green, but the green does not prove the thing that matters.

- **The propose to verify to adjudicate composition on real data never yields a violation in
  CI.** The e2e harness injects `defaultScriptedLlmCall`, which always DECLINES (`{ok:false}`,
  `eval/e2e/lib/scripted-llm.js:33`), so every text-derived candidate abstains to
  `needs_review`. End-to-end breach detection on real corpora is therefore PRESENT-UNPROVEN.
  See section D(i).
- **Gate 3 NLI semantic quality is unproven.** The demote-on-non-entailment behaviour is proven
  structurally, but the actual "does this premise entail this claim" judgement is delegated to an
  injected model that is scripted or absent in every automated test. Real discrimination is
  untested (by the no-network doctrine).
- **Registers CQC / FCA / ICO are inert.** Real code, but CQC and FCA degrade to `missing_key`
  (founder-blocked keys) and ICO to `missing_endpoint` (no free real-time API exists). Only
  Companies House, GLEIF and SRA are live-capable, and even those are network-mocked in every
  test. Three of six register lanes cannot ground a breach today. See D(v).
- **The browser lane is dormant.** Real and tested against fakes, but not wired to any mint entry
  point, and the real Playwright adapter is never exercised in CI (no Chromium). The charter exit
  "PECR pre-consent proven in a minted payload" is formally DEFERRED to P4 in `DORMANT.md`. See
  D(iii).
- **coverage-contract.js.** The earlier missing-test gap (ledger D10) is closed:
  `evidence/crawler/coverage-contract.test.js` now exists and drives the C-044 substring fixture.
  `classify` / `computeCoverage` remain relatively thin but are now under a standing lock.

---

## B. FAILED / COSTLY

Every agent loss below is a real cost. Sources: checkpoint commit messages, the Rob integration
ledger, `caution.md` C-208/C-209, and the transcript tails.

1. **W1a crawler builder, cut #1 (session limit, ~03:40).** Opus builder (`a641e90c`) died mid
   final-verification. Verbatim dying words: "Now let me verify the E-236 Tier-1-first-before-cap
   ordering, the pool deadline-as-cap, and the documents PDF no-parser interlock." Root cause:
   session limit hit during the verification tail. Cost: the lane landed on disk (checkpoint
   `00e4c27`) but unverified; a salvage agent was needed.
2. **SALVAGE-W1a, cut #2 (quota reset, ~08:40, ~95%).** The salvage agent launched to finish W1a
   was itself killed by the 08:40 quota-window reset. This is the "W1a salvage cut twice": the
   lane was cut, then its salvage was cut. Root cause C-209: a long agent launched into the last
   hour of a quota window. Cost: two lost verification passes; Rob hand-finished under the C-204
   salvage doctrine (inventory, read-and-complete, do not rewrite).
3. **The 08:40 quota reset killed all four in-flight agents at ~95%.** salvage-W1a, W2a
   (proposers), W2f (red-team) and W2g (e2e) all died together (checkpoint `376ace1`). Rob
   applied the final fixes by hand, including three FAIL-OPEN swallow markers on W2a, which is
   why W2a reads as "restarted / hand-closed". Cost: four near-complete agents' final
   verification lost; orchestrator hand-finish.
4. **R2 e2e uncovered the detection-spec ReDoS P0.** A prose-derived "all" token-set caused
   catastrophic regex backtracking; CA_RPC hung 45s and the process was killed. Cost: a P0 found
   late in the phase, forcing a new subprocess-guard architecture (`breach-worker.js`, C-227).
5. **R3 reconciliation stalled at ~606k tokens.** The big reconciliation agent (ledger decisions
   1-5, 7, 8, 10 plus lead triage) was cut just as it turned to the last item. Verbatim tail:
   "Rob's final addendum: wire Gate 3 (NLI entailment) into my adjudicate.js. Let me read the
   exact API of the two landed files first." Cost: ~606k tokens, and the Gate-3 wiring had to be
   completed outside R3 (commit `e4807ac`, "Gate-3 wired end-to-end").
6. **The closers died and were salvaged after a process restart (checkpoint 18 / `f0333b0`).**
   The final PR-hardening closers (prototype-pollution guard, CodeQL door fixes, CodeScene
   re-decomposition of the FIX-C-touched llm/gates files) were lost to a process exit / restart;
   Rob salvaged 15 files by hand. This is "the two closers that died / the process-exit that
   killed 3 agents".
7. **The prior completeness audit ran on a moving HEAD (C-218).** HEAD moved `4d40e7c` to
   `88b442a` under it; every finding had to be pinned to a SHA and re-verified. Cost: audit
   rework and reduced confidence in any runtime result taken mid-flight.

Root-cause pattern across all seven: verification-heavy work on a shared, mutating tree, plus
long agents scheduled into quota cliffs. Both are already codified (C-208, C-209, C-210, C-215)
but were learned the expensive way.

---

## C. LEFT IN P3

### In flight now
- **CodeScene re-decomposition of seven llm/breach files.** Observed live this session (the tree
  is dirty on `propose.js`, `coverage-contract.js`, `entailment.js`, `evals/run.js`, `gate.js`,
  `router.js`, `no-module-state/check.js`). The working tree currently fails 27 tests mid-edit;
  committed HEAD is green. This is the CodeScene clearance the brief flagged as in flight.
- **PR #4 tail (ledger R4).** Fresh-clone fleet, external review stack, then founder merge. The
  branch is still `p3-evidence`; nothing is merged to `main`.

### Not delivered against the charter / acceptance spec (measured item by item)
- **Exit criterion "reference-set breaches reproduced": NOT MET.** 0 of 5 known_breaches
  reproduce (section D.i). The exit code does not require it, so the harness reports OK anyway.
- **Exit criterion "red-team fixtures all caught": PARTIAL.** 6 of 9 CAUGHT; RT-B1
  (prompt-inject-body), RT-B2 (prompt-inject-policy, fixture `current_status: pending_gate`) and
  RT-E (foreign-language) are SKIPPED. RT-B2 in particular is a real un-wired gate, not a benign
  skip.
- **Exit criterion "PECR proven in a minted payload": formally DEFERRED to P4** (DORMANT.md).
  Legitimate: no mint entry point exists yet.

### Not started (P4-owned, correctly deferred)
- `mint/` wiring (`mint/worker.js` / `mint/index.js` are `.gitkeep` only), `render-proof`
  truth-pack spec, the payload contract enforced both ends, working per-recipient HMAC. All P4.

---

## D. MISSED / WEAK — the honest gap list

Each candidate confirmed or dismissed with evidence.

**(i) Do known_breaches reproduce end-to-end, or is "zero false accusations" vacuous? CONFIRMED
GAP — this is the single most important finding.**
Across all 31 firms (30 reference + 1 synthetic) there are 5 known_breaches; the e2e harness
reproduces **0**, misses **5**, contradicts **0**, and still returns exit 0 / RESULT OK. The
exit code (`run-pipeline.js` `exitCodeFor`) is `(contradicting || escapes) ? 1 : 0`; a missed
known_breach never fails the run. The default harness `llmCall` always declines, so no
text-derived candidate can ever reach `violation`, which means "zero false accusations" holds by
construction, not by verification. The synthetic fixture `synthetic-quote-breach.json` plants a
blatant guarantee-of-outcome breach ("guarantee you will win every case") and even documents in
its own notes that once the breach lane landed it "should flip to reproduced" and become a
genuine regression check; the lane has landed, and it reports MISSED. C-236 recorded this exact
problem and prescribed a two-part fix: report "N complete / N timed-out" AND require known_breaches
to reproduce. Only the reporting half shipped. The engine is proven SAFE (it will not
false-accuse) but is NOT proven USEFUL (it has never been shown to catch a single real breach
end-to-end).

**(ii) Gate 3 NLI: real or comment-deep, wired and tested? CONFIRMED REAL AND WIRED; semantic
quality unproven.** `llm/entailment.js` is a genuine deterministic shell, imported and called by
`adjudicate.js` before any `breach` becomes a `violation`, with unit tests and eval fixtures
(C-234 closed). Caveat: the entailment judgement itself is delegated to an injected model that is
scripted or absent in CI, so the gate's real discrimination is untested. Present and structurally
proven; semantically unproven.

**(iii) Is any P3 lane exercised on a real site, or only fixtures? CONFIRMED FIXTURES-ONLY.**
Every lane is network-mocked by design (the no-network-in-CI doctrine). The crawler, registers
and browser never touch a live site in any test; the real Playwright adapter has no test at all;
the mint that would wire them to a live site is P4. No part of P3 has been run against a real
website end-to-end.

**(iv) Do the 145 detection specs detect real breaches, or just compile? PARTIALLY CONFIRMED.**
They compile (0 rejected) and they match real corpora (121-131 candidates per firm), so they
detect at the propose layer. But 51 of 145 are behavioural / browser_lane (a dormant lane) and 9
are register (no fixture carries register rows), leaving 85 text-surface specs; and no proposed
candidate reaches a violation in the harness. So "detect a real breach end-to-end" is unproven,
and the heavy over-proposal (about 130 candidates per firm) means the entire precision burden
falls on the LLM adjudicator plus Gate 3, neither of which is exercised with a real model.

**(v) Registers CQC / FCA / ICO: real or stubbed? CONFIRMED PART-INERT.** Real code, but CQC and
FCA degrade to `missing_key` (founder-blocked) and ICO to `missing_endpoint` (no free API). Only
Companies House, GLEIF and SRA can ground a breach, and only against mocks in CI.

**(vi) Modules with no dedicated test? CONFIRMED, small set.**
`evidence/registers/lib/lookup-runner.js` (the load-bearing shared register execution path:
guard, key-check, deadline-fetch, C-004 judge) and `evidence/registers/lib/notes.js` have no
dedicated test; `evidence/browser/playwright-adapter.js` is untested by design. lookup-runner is
the meaningful gap: the one path every register lookup runs through has no direct suite.

**(vii) The 21 out-of-scope security alerts: closed or open? MOSTLY CLOSED, one open.** The 47
path-traversal alerts were absorbed into the one `tools/lib/safe-path.js` door (4 residual-by-design
inside the door itself, documented not dismissed); the prototype-pollution guard and CodeQL door
fixes landed in checkpoint 18. OPEN: GitHub Actions are pinned to mutable version tags (`@v4`),
not commit SHAs, so actions-tag-pinning is unaddressed. Low severity, but genuinely open.

**(viii) Is the 30-firm reference oracle strong enough to trust the exit bar? CONFIRMED WEAK.**
All 30 firms are `needs_verification: true`; 17 of 30 are sourced from the PRD rather than an
independent hand-verification; only 9 come from hand-verified forensic audits. Only 4 firms carry
known_breaches, with loose match tokens ("GDPR", "Modern Slavery", link/anchor). The 4 US firms
carry zero breaches. As a positive-control oracle the set is thin, which compounds gap (i): even
if the exit bar required reproduction, there is little to reproduce and the match tokens are
imprecise.

**(ix) Anything in caution.md that P3 should have guarded but did not? YES — C-236.** It is logged
as a lesson and its reporting half is implemented, but the exit-bar half ("also requires
known_breaches to reproduce as violations") is not enforced in `exitCodeFor`. The guard exists in
prose, not in code. This is the honest counter-example to the phase's own "a wrong guard is worse
than an owned hole" doctrine: here the hole is owned in a caution entry but the code still passes
green over it.

---

## E. OBVIOUS MISTAKES

Each with the one-line prevention (already codified unless marked NEW).

1. **Verification on a moving tree.** Salvage, the completeness audit, and this retrospective all
   ran while builders mutated the shared tree; endless re-attribution. Prevention: a quiet tree
   for verification, sequenced after the build fleet lands (C-208).
2. **Launching long agents into a quota cliff.** Four agents lost at the 08:40 reset. Prevention:
   the quota window is a scheduling input; do not start a long agent in its last hour (C-209).
3. **Parallel builders assuming each other's shapes.** A verifier built to an assumed sibling
   shape rejected 100% of real output; evidence-kind literals mismatched the artifact-type set and
   quarantined every observed candidate. Prevention: one frozen artifact-type enum all three
   import; re-probe the producer's landed shape and lock it in a hermetic test (C-211, C-222,
   C-223, C-224).
4. **The ci.yml compile-order miss.** A gitignored built catalogue failed a fresh clone.
   Prevention: CI compiles consumed artefacts before the suites that load them (C-240/C-201).
   Reproduced both ways this session.
5. **STAGE_CONTRACT pointing at barrels the modules never exported.** The e2e lane reported
   NOT-WIRED and silently did nothing while looking green. Prevention: a wiring contract names the
   real entrypoint and arity, a runtime probe is authoritative, and a NOT-WIRED stage FAILS the
   harness (C-235).
6. **The vacuous exit bar.** "Zero false accusations" read green on zero findings; the reporting
   half of the fix shipped but the exit-bar half did not, so the phase still passes with 0/5
   breaches reproduced (C-236). NEW emphasis: the exit code must fail when a complete breach lane
   reproduces no known_breach.
7. **GNU `timeout(1)` absent on macOS.** A subprocess bounded with `timeout` read exit 127 as "no
   failures". Prevention: bound subprocesses with node timers / child kill; 127 is a harness
   failure (C-246). Hit live this session when a sweep wrapper used `timeout`.
8. **Small correctness traps codified in passing.** `Object.freeze` on a Set does not block
   `.add` (C-237); control-char regex literals mangle source (C-247); swallow-gate justifications
   the gate cannot see (C-248). Each now has a guard or a test.

---

## F. TOP-10 FOR A PERFECT ENGINE

Ranked. "Quality-critical" means it bears directly on never false-accusing or on proving the
engine works; "phase" states where it honestly belongs.

| # | What | Why it matters | Phase | Effort | Class |
|---|---|---|---|---|---|
| 1 | Prove reference-set breaches reproduce end-to-end with a real (or recorded) adjudicator model, and make the exit bar FAIL when a complete lane reproduces no known_breach (finish C-236). | Today 0/5 reproduce and the bar ignores it. This is the only proof the engine is more than an always-clean machine. | P3-tail | High | Quality-critical |
| 2 | Run a false-accusation stress test with a real model over the ~130-candidate-per-firm propose output. | Precision is proven only for the degenerate "LLM declines everything" case; the real false-accuse risk lives in adjudicating 130 candidates live and is never exercised. | P3-tail | High | Quality-critical |
| 3 | Wire `mint/` and drive ONE real website through crawl to payload. | Everything in P3 is fixtures-only; no lane has met a live site. | P4 by design | High | Quality-critical |
| 4 | Close the 3 skipped red-team fixtures (RT-B1, RT-B2 pending_gate, RT-E) with bespoke handlers. | "Red-team all caught" is 6/9; RT-B2 (policy prompt-injection) is a real un-wired gate. | P3-tail | Medium | Quality-critical |
| 5 | Strengthen the reference oracle: hand-verify the 17 PRD-sourced firms, add precise-token known_breaches, add US positive controls. | A weak oracle makes even a correct exit bar weak; loose tokens like "GDPR" cannot discriminate. | P3-tail / P4 | Medium-High | Quality-critical |
| 6 | Put a real NLI model behind Gate 3 and add a labelled entailment eval set. | The demote logic is proven; the semantic discrimination is delegated to a never-real model. | P4 by design | Medium | Nice-to-have trending quality |
| 7 | Unblock CQC / FCA keys and add an ICO endpoint seam. | Three of six registers are inert; register-grounded breaches cannot fire without them. | Founder-blocked | Low (founder) | Quality-critical |
| 8 | Dedicated tests for `lib/lookup-runner.js` and `lib/notes.js`. | The shared path every register lookup runs through has no direct suite. | P3-tail | Low | Nice-to-have |
| 9 | SHA-pin GitHub Actions and land the in-flight CodeScene re-decomposition cleanly. | actions-tag-pinning is open (`@v4`); the dirty tree must converge without breaking the 1081. | P3-tail | Low | Nice-to-have |
| 10 | A live-Playwright smoke lane behind a flag (not CI-default). | The real browser adapter's DOM / consent heuristics are entirely untested against real sites. | P4 | Medium | Nice-to-have |

Honest split: #3, #6, #10 are P4-by-design and not failures of P3. #7 is founder-blocked. #1,
#2, #4, #5, #8, #9 are things P3 could have strengthened and did not; #1 and #2 are the ones that
keep the engine from being a proven, false-accusation-proof product.

---

## Executive summary (for Rob)

1. Committed HEAD `f0333b0` is genuinely green: 1081 tests pass, sweep GREEN, health-gate clean
   on all P3 files, history-regression exit 0. The structural engineering is solid and well
   tested.
2. 9 of the prior completeness audit's top-10 must-fixes are closed on current code. The one that
   is not is the one that matters most.
3. **Single most important gap:** the engine has never been shown to catch a real breach.
   End-to-end, 0 of 5 known_breaches reproduce; all 5 are MISSED. The e2e harness injects an
   LLM that always declines, so no text breach can ever reach a violation, and the exit code
   fails only on contradictions or red-team escapes. "Zero false accusations" is therefore true
   by construction, not by verification. The engine is proven safe, not proven useful.
4. **Worst mistake:** the vacuous exit bar (C-236). The team spotted it, wrote the caution,
   shipped the reporting half, and left the enforcing half undone, so the phase can pass green
   with zero breaches reproduced. The runner-up mistakes are all orchestration: four agents lost
   to a quota-reset cliff and repeated verification on a mutating tree (which I hit again live
   during this audit).
5. Gate 3 NLI is real and wired (not comment-deep), the ReDoS is killed, RT-F is closed, the five
   structural gates are present, and the 145 detection specs compile and match real text. The
   weaknesses are that every lane is fixtures-only, the NLI and adjudicator are never run with a
   real model, three of six registers are inert, and the 30-firm oracle is thin (all
   needs_verification, only 4 with breaches).
6. **The three things most needed for a false-accusation-proof engine:** (a) make the exit bar
   fail when a complete breach lane reproduces no known_breach, and prove at least one lane to a
   violation on real corpora with a real model; (b) stress-test precision with a real model over
   the ~130 candidates per firm the proposer actually emits, since that is where a false
   accusation would really be born; (c) strengthen the oracle (hand-verify the PRD-sourced firms,
   precise breach tokens, US positive controls) so the exit bar has something real to check.
7. Charter status: of the three P3 exit criteria, "red-team all caught" is partial (6/9),
   "breaches reproduced" is unmet (0/5), and "PECR in a minted payload" is legitimately deferred
   to P4. On a strict reading, P3 exit is not met; on a "safe but unproven" reading, the safety
   half is done and the usefulness half is not.
