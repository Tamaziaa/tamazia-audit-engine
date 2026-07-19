# DORMANT.md - register of intentionally unreached code

Constitution Rule 5: every module is either provably reachable from the mint entry point or explicitly
declared here with a reason. Dead-but-green code is a lie waiting to ship (caution.md C-154: 13 modules /
691 lines of correct, tested, cited legal logic were merged and never called on the old estate, including
the gate built to make an unevidenced monetary claim impossible). The reachability walk
(`tools/sweep/collect-local.js`) parses this file for exactly this table: a module not reachable from
`mint/worker.js` or `mint/index.js` AND not listed here (by its exact repo-relative path, one row per
file) fails the sweep.

**The walk is now ARMED (P4 T1).** `ENTRIES = ['mint/worker.js', 'mint/index.js']` in
`tools/sweep/collect-local.js`; BOTH now exist (T1 landed the live mint), so `reachability()` runs the full
require-graph walk and prints `reachable from the mint entrypoints: N modules` (N > 0). Every module in
`catalogue`, `evidence`, `facts`, `applicability`, `breach`, `llm` and `payload` is now either reached from
the mint or declared below with a reason (C-249: the register is refreshed against the ACTUAL tree, and a
stale DORMANT line - claiming a reached module is dormant - is itself a dormancy-honesty defect).

## Charter-exit condition DISCHARGED at the structural level (P4 T1)

The P3 charter exit **"PECR pre-consent proven in a minted payload"** was formally deferred to P4 mint
wiring; it is now **discharged at the structural level** by the live mint. `mint/index.js` assembles the
EvidenceBundle (`mint/compose-bundle.js`), runs the whole chain and persists the payload; `mint/mint-e2e.js`
(`mint/mint-e2e.test.js`) proves it in one process over injected fakes: a pre-consent tracking cookie is
observed, wrapped as a `network_event` candidate, verified against `bundle.browser.observed`, and adjudicated
to a `violation` via the observed-fact bypass (C-084), then composed into a contract-valid payload and
persisted (idempotency key carrying `ENGINE_VERSION`, Rule 15). The LIVE-infrastructure run (a real crawl +
real Neon/R2 write) is the orchestrator's post-merge step; `done` stays false as `minted_pending_render` until
the render truth-pack lands (T3b) and proves the rendered words match the payload (Rule 7).

## Reachable now - the P3/P4 evidence, facts, applicability, breach and llm modules

Every module the T1 mint requires - the crawler (`evidence/crawler/*`), the PECR + DOM browser lanes
(`evidence/browser/*`), the document lane (`evidence/documents/*`), the register lanes
(`evidence/registers/*`), the facts doors (`facts/*`), the applicability door (`applicability/*`), the
propose -> verify -> enrich -> adjudicate breach chain (`breach/*`) and the LLM routing/gate/entailment/jury
seam (`llm/router.js`, `llm/gate.js`, `llm/entailment.js`, `llm/providers/*`, `llm/prompts/entailment.js`,
`llm/prompts/sanitise.js`) - is now REACHABLE from `mint/index.js` / `mint/worker.js` and has been REMOVED
from this register (its P3-era "no mint entry point exists yet" reason no longer holds). Only the modules
below remain genuinely unreached.

## Rule 12 Gate 5 (diverse-jury quorum) is now ENGAGED at the mint seam (was FOUNDER-DEFERRED)

The P3 deferral recorded here - "Gate 5 is NOT wired into the live adjudication path" - is **closed by T1**.
`mint/index.js` calls `breach/adjudicator/adjudicate.js` with `{ jury: true, providers }` (the founder-locked
decision, 2026-07-19): a would-ship text `violation` that passes Gate 3 (NLI) must then pass the Gate-5
diverse jury, anchored on Ministral (`llm/providers/openrouter.js`, family `mistral`), veto-to-reject, or it
demotes to needs_review (`breach/adjudicator/jury.js` + `llm/router.js` `quorum()`). The founder constraint
("P0/P1 must not ship on single-family routing") is therefore satisfied at the seam; an OBSERVED/register
fact (the PECR pre-consent breach) still bypasses the model and the jury entirely (C-084/C-131 immunity), as
it is a fact, not a model judgement.

## catalogue/ (compile-time tooling - NOT a runtime mint dependency)

The compiled artifact `catalogue/dist/catalogue.v1.json` is the ONLY catalogue surface the mint reads at
runtime (`applicability/connect.js`, `breach/proposers/propose.js` and `breach/enrich.js` all consume the
compiled records; Rule 2). The COMPILER, its linters and the QA-approval gate below run at BUILD time (`npm
run catalogue`, `.github/workflows/catalogue-lint.yml`) and are exercised by their own `.test.js` suites and
the compile pipeline; nothing in the mint's runtime require graph calls them, by design - a legal-evidence
mint reads the frozen artifact, it never recompiles the law mid-mint. Declared here per Rule 5 so the armed
walk stays honest (C-249/C-250).

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `catalogue/compile.js` | the catalogue compiler (`npm run catalogue`): prose packs -> `catalogue/dist/catalogue.v1.json`. A build-time tool; the mint reads the frozen artifact, never the compiler | Aman | never from `mint/` (by design); it stays a build/CI step. Reached by `catalogue/compile.test.js` + the `catalogue` npm script |
| `catalogue/compile-args.js` | the compiler's CLI-arg + stamp-file parsing, consumed only by `compile.js` | Aman | same as `compile.js` |
| `catalogue/qa-approval.js` | the human-gated QA-approval promotion gate (Rule 14): promotes verified candidate rows; a build/curation-time tool, never a mint step | Aman | never from `mint/`; it stays a curation/CI gate |
| `catalogue/linters/citation-completeness.js` | catalogue-lint: every ACTIVE rule carries a resolvable citation (Rule 14), run at build time by `catalogue-lint.yml`, not the mint | Aman | never from `mint/`; a build/CI lint |
| `catalogue/linters/polarity.js` | catalogue-lint: obligation polarity (presence vs prohibition) sanity, build-time only | Aman | same as above |
| `catalogue/linters/regex-health.js` | catalogue-lint: detection-pattern ReDoS/health check, build-time only | Aman | same as above |
| `catalogue/linters/threshold-guard.js` | catalogue-lint: penalty/threshold sanity guard, build-time only | Aman | same as above |
| `catalogue/linters/lib.js` | shared helpers for the catalogue linters, consumed only by the linters above | Aman | same as above |
| `catalogue/linters/test-helpers.js` | shared test fixtures/helpers for the catalogue-linter suites, consumed only by their `.test.js` files | Aman | never from `mint/`; a test-support module |

(The two `catalogue/schema.js` / `catalogue/valid-date.js` rows are deliberately NOT listed: they ARE reached
at runtime via `applicability/connect.js` and the schema chain, so declaring them would be a stale line.)

## llm/ (CI gate + an unused prompt builder, not on the mint path)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `llm/evals/run.js` | the blocking LLM-eval harness (precision/abstain-rate over `llm/evals/fixtures/`); a gate CI drives (`.github/workflows/llm-eval.yml`), never a mint step - the mint never calls the eval harness | Aman | it stays a CI gate; the mint never calls it, so it remains dormant to `mint/` by design |
| `llm/prompts/adjudicate.js` | a prompt/schema builder (`buildAdjudicationPrompt`) whose verdict enum imports the one door `breach/adjudicator/verdict.js`; the LIVE adjudicator builds its prompt from `breach/adjudicator/prompt.js`, not this module, so nothing on the mint path requires it. Tested (`adjudicate.test.js`) | Aman | a future adjudicator prompt consolidation onto this builder, or its removal if the two prompt surfaces are unified onto `breach/adjudicator/prompt.js` |
