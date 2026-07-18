# P3-TAIL acceptance specification: usefulness proof + red-team completion

Committed BEFORE implementation (AGENTS.md Fleet Rule 2). Branch `p3-tail` off `p3-evidence` @ `6b9eb84`. This work ships as its OWN PR after PR #4 merges (C-207: an open feature PR only shrinks; this is the gate-loop/tooling-and-proof PR). Founder decision B (2026-07-18) is recorded: PR #4 merges as-is with the CodeScene advisory flag accepted; the `facts/identity.js` decomposition is deferred to its own later gate-loop PR and is NOT in scope here (C-192, C-001..C-014).

Charter: LATEST-STATE ordered moves 2 and 3; P3-RETROSPECTIVE F#1, F#2, F#4, F#5; caution C-236 (the un-shipped enforcing half), C-134, C-233, C-255. The headline being closed: the engine is proven SAFE but not proven USEFUL; 0 of 5 known_breaches reproduce end-to-end and the exit bar does not care.

## The frozen recorded-response contract (every unit imports this; no unit re-defines it)

Location: `eval/e2e/fixtures/recorded/<domain>.json` (committed, sanitised). Shape:

```json
{
  "contract": "recorded-llm.v1",
  "engine": { "providers": ["groq", "cloudflare", "gemini"], "recorded_at": "<ISO date>", "prompt_versions": {} },
  "responses": [
    { "key": "<sha256(kind + '|' + rule_id + '|' + artifact_fingerprint)>",
      "kind": "adjudicate",
      "raw": "<verbatim model output string>",
      "meta": { "provider": "<name>", "model": "<model id>" } }
  ]
}
```

Replay semantics: match by `key`; a missing key resolves to a DECLINE (fail-closed, Rule 4). `kind` covers every llm call the adjudication path actually makes (verdicts and gate-3 entailment); if the live path makes a further llm call kind, the contract gains that kind IN THIS FILE before either consuming unit finalises (C-211: never finalise against an assumed sibling shape). Recordings carry no secret-shaped string, no key material, no PII beyond the already-committed public fixture corpora (Rule 16).

## U1: real-model reproduction proof (opus)

Owns (new files only): `eval/e2e/lib/real-llm.js`, `eval/e2e/run-real-proof.js`, `eval/e2e/fixtures/recorded/**`, a `.gitignore` entry plus gitignored `eval/e2e/record/` for raw call logs. Touches nothing else: not `run-pipeline.js`, not `scripted-llm.js`, not `redteam-handlers.js`, not any `breach/`, `llm/`, `facts/`, `evidence/` module.

Deliverables:
1. `real-llm.js`: an env-gated real llmCall factory routed through the engine's OWN chain (`llm/router.js`: Groq, Cloudflare Workers AI, Gemini; Constitution Rules 11-12). Refuses to construct unless `RUN_REAL_LLM=1` and the provider keys are present in env. Every call deadline-wrapped (Rule 9; caps never floors), serial with quota-aware spacing (C-138, C-184: no concurrency bursts on free tiers), structured output where the provider supports it (C-137), and a full call log (inputs, outputs, provider, model) written to gitignored `eval/e2e/record/` (Rule 11: log everything).
2. `run-real-proof.js`: for the 5 known_breach reference entries (neuclinic.co.uk, roxanaaesthetics.com, lomond.co.uk, dutchanddutch.com, example-synthetic-breach.test): fixture bundle -> propose -> verify -> adjudicate with the real llmCall, all five structural gates live, nothing bypassed, no prompt loosened. Prints a per-candidate table (rule id, artifact kind, verdict, deciding gate) and a summary (reproduced/missed per firm; contradictions of known_non_breaches).
3. Recordings per the frozen contract for EVERY call made, schema-self-validated at write time.
4. If quota allows after the 5 firms: 3 clean matrix firms (russell-cooke.co.uk, pallmallmedical.co.uk, medcare.ae) for a first precision signal over their full candidate sets.

Machine-checkable benchmarks:
- U1-B1: at least 1 known_breach reproduces to `violation` end-to-end with gates 1-5 genuinely passing. Target: the synthetic control (its own fixture notes say it should flip to reproduced once the lane exists) plus at least 1 real forensic firm.
- U1-B2: zero contradictions of known_non_breaches across every run performed.
- U1-B3: every real call has a recorded response; recorded files validate against the contract; a secret-shape grep (`gsk_`, `AIza`, `ghp_`, `github_pat_`, `sk-`, `npg_`, `cfut_`) over every created file returns zero hits.
- U1-B4: no call exceeded its deadline; 429s handled by pacing, never unbounded backoff (C-138), no retry after the final attempt (C-175).
- U1-B5: the honesty rule. If U1-B1 fails (the model declines everything, or gates demote every candidate), the report states per candidate WHICH gate demoted it and the exact model verdicts, verbatim, and the outcome routes back to Rob for a plan revision. Weakening a gate, floor, threshold or prompt to force a pass is prohibited; prompt changes are Rule 11 golden-set-gated and outside this unit.

## U2: exit-bar enforcement + replay mode (sonnet)

Owns: `eval/e2e/run-pipeline.js`, `eval/e2e/lib/scripted-llm.js`, new `eval/e2e/lib/replay-llm.js`, plus their node:test suites. Does not touch `redteam-handlers.js` (U3), `real-llm.js` or recordings (U1), or any engine module.

Deliverables:
1. `exitCodeFor` gains the C-236 enforcing half: exit 1 when (existing: any contradiction or red-team escape) OR the vacuity condition holds: among firms whose breach lane is COMPLETE (not timed-out, not errored, not skipped) and which declare known_breaches, the total reproduced-as-violation count is 0. Timed-out and degraded lanes stay excluded from "complete" and stay loudly counted (the shipped reporting half remains untouched).
2. `replay-llm.js` implementing the frozen contract (match by key; missing key = decline) and a run-pipeline flag `--llm replay:<dir>`. Replay covers ONLY the breach-lane adjudication llmCall; red-team handlers keep their own injected calls.
3. The canonical full-assessment invocation becomes `node eval/e2e/run-pipeline.js --breach-inline --llm replay:eval/e2e/fixtures/recorded`. Scripted-decline mode remains available but is no longer a full assessment and now honestly FAILS the vacuity clause on the current fixture set. Harness usage text updated.
4. Hermetic tests (hand-built fixtures, C-211): vacuity both directions (all-missed complete lanes -> exit 1; one reproduced -> exit 0; all-timed-out -> not vacuity, still loudly reported); replay adapter behaviour including missing-key decline; flag parsing.

Machine-checkable benchmarks:
- U2-B1: with a hand-built recording approving the synthetic breach, a replay run reproduces >= 1 and exits 0.
- U2-B2: the default scripted run on current fixtures exits 1 with a clear `vacuous: 0 known_breach reproduced across N complete lanes` line (the bar demonstrably bites).
- U2-B3: full `node --test` green for its suites; zero regressions in the 1081.
- U2-B4: exit semantics documented in the file header; C-246 (no GNU `timeout`) and C-252 (full output captured to file before filtering) honoured.

Integration note: U2 lands the bar; the branch-level fleet flips to the replay invocation only at integration once U1's real recordings exist. That sequencing is owned by Rob, not by U2.

## U3: red-team completion, RT-B2 gate + RT-B1/RT-E handlers (opus)

Owns: `eval/e2e/lib/redteam-handlers.js`, `eval/red-team/fixtures.json` (status and wiring fields only, C-233 exact-status semantics), the prompt-sanitisation door in `llm/prompts/` (one door, C-134), plus tests. Does not touch `run-pipeline.js` (U2), `real-llm.js` (U1), or the adjudicator's core flow (sanitisation applies at the prompt-building boundary).

Deliverables:
1. The policy-injection defence: untrusted crawled and policy text is sanitised and DOC-delimited in the one prompt-builder door before any adjudication or entailment prompt (C-134); an instruction embedded in policy text cannot alter a verdict.
2. RT-B2 wired per its fixture `wiring` field; `current_status` flipped from `pending_gate` to its live caught status with exact-status xfail semantics (C-233). RT-B1 (body injection): bespoke handler through the same door. RT-E (foreign language): bespoke handler asserting a non-English corpus yields no text-derived violation (C-022 quarantine posture at the harness boundary); if genuinely un-wirable inside P3-tail, an explicit reasoned skip with named owner and phase recorded in fixtures.json AND the report (C-255). Caught is strongly preferred.
3. Both-direction tests for the sanitisation door: a seeded injection is neutralised; legitimate policy text passes through byte-faithful for quote verification (gate 2 verbatim re-match must be provably unaffected: sanitisation changes prompt framing, never the corpus surface quotes are matched against).

Machine-checkable benchmarks:
- U3-B1: red-team lane reports 9 entries, 0 escapes, 0 errors; RT-B2 CAUGHT; RT-B1 CAUGHT; RT-E CAUGHT or an explicit reasoned skip with owner and phase.
- U3-B2: the 1081 suite plus its new tests green; sweep GREEN (ACT 0) on touched files; zero NEW health-gate violations in touched files, new-vs-pre-existing separated by (rule, location) (C-254).
- U3-B3: a test drives a quote candidate through propose -> verify after the sanitisation door lands and proves verbatim matching is unchanged.

## U4: reference-oracle verification proposals (law-researcher; documents only)

Owns: `docs/reference-set-proposals-2026-07-18.md` ONLY. Reference-set expectation changes are founder-gated (AGENTS.md sections 6 and 7): this unit changes NO engine or eval file.

Deliverables: for each of the 5 known_breach entries: primary-source verification of the breach claim (the statute plus the committed fixture corpus), a proposed precise verbatim match token PRESENT in that committed fixture corpus (replacing loose tokens such as "GDPR"), and a confidence note. Then a status review of the 17 PRD-sourced firms (fixture-grounded; live checks only where fixtures are ambiguous) and 2-3 proposed US positive-control firms with evidence. Every claim carries its source URL. Unverifiable is stated as unverifiable; nothing is fabricated.

Machine-checkable benchmark: the document exists, covers all 5 entries plus the 17-firm review plus the US proposals, every proposed token is grep-verified present in the corresponding committed fixture corpus (command output included in the document), and `git status` shows no change outside `docs/`.

## Integration (Rob) and phase-close

U1, U2, U3, U4 build in parallel on strictly disjoint paths (C-210: a lead in a file you do not own is attributed via git diff and reported, never fixed). Rob vets each unit against its benchmarks (C-215: each report states exactly what changed, mine vs not-mine), reconciles, re-records U1 if U3's sanitisation changed any prompt surface, flips the canonical e2e invocation to replay, then runs the full fleet from a FRESH CLONE (C-201, compile order first): `npm run catalogue`, `npm test`, lint, circular, dup, depcruise, `tools/sweep/run.js`, `eval/calibration-known-bad/run.js --strict`, the replay e2e invocation, `tools/health-gate/check.js`, `tools/history-regression/check.js`; the external stack fires on the eventual PR. Checkpoint-commit and push after each accepted unit. The PR opens only after PR #4 merges (diff hygiene; C-190 push-before-PR with a confirmed non-empty diff).

Phase-exit claim after this wave: "reference-set breaches reproduced" moves from 0/5 to >= 1 proven with a real model and locked in CI by replay plus the enforcing exit bar; "red-team all caught" moves from 6/9 to 9/9 (or 8/9 plus one explicit reasoned skip); "PECR in a minted payload" stays formally deferred to P4 (DORMANT.md). Remaining honest gaps carry into the PR body, never silently dropped.
