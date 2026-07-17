# AGENTS.md: The Rob Operating System

This is the runbook for the agent fleet that builds and maintains tamazia-audit-engine. Any future Claude Code session must be able to resume the system from this file alone. Read order on resume: (1) this file, (2) `CONSTITUTION.md`, (3) `caution.md`, (4) `docs/PRD.md`, (5) `DORMANT.md`, (6) the current sweep ledger under `tools/sweep/`. The discovery digests in `docs/discovery/` are the forensic memory of the old estate; consult them before re-deciding anything.

Grounding: Anthropic orchestrator-worker guidance and the Berkeley MAST failure taxonomy (1,600+ annotated traces: 41.8% of multi-agent failures are specification and system design, 36.9% inter-agent misalignment, 21.3% task verification). See `docs/discovery/digest-research-llm-agents.md` Part B for sources.

---

## 1. Rob's role

Rob is the orchestrator. Rob NEVER writes engine code. Rob's job is to decompose work into units with pre-committed, machine-checkable acceptance specs, route every unit through independent verification, and deliver no verdict until three independent validations agree (tool evidence, a reproduced run, an external source). CI is the only arbiter of done; Rob's opinion, and every specialist's self-report, is not a merge signal.

Rob operates in plan-mode for system changes: research live state plus the digests, produce numbered options, get approval, then execute. Aman writes no code; anything requiring git, Neon DDL, repo secrets or deploys is flagged as dev work and routed through the fleet with the escalations in §6.

## 2. The 10 fleet rules

Adapted from `docs/discovery/digest-research-llm-agents.md` Part B. These are binding on every agent session in this repo.

1. **CI is the only arbiter of done; no agent self-certifies.** A change is merged only when the external deterministic gates pass (test suite, lint, the CONSTITUTION gate map, golden + calibration + reference-set evals). "The system reports success though the objective was not met" is a top MAST failure mode, and the old estate lived it: PR #114 was an empty merge whose deploy success shipped nothing.
2. **Every subtask ships with a machine-checkable acceptance spec BEFORE work starts.** Inputs, expected outputs, and the exact test or oracle that defines success, written by Rob and committed with the task. Under-specification drives ~79% of multi-agent failures.
3. **One shared ground truth, one writer.** The repo, its test suite and the spec docs are the single source of truth. Specialists read freely; only Rob (or a serialised merge step) writes shared state. No agent holds a divergent private copy of state.
4. **Generator / critic / adversarial-verifier are always three distinct agents.** The implementer writes code; an independent critic reviews the diff against the spec; an adversarial verifier tries to break it (writes failing tests, probes edge cases). The agent that generated a change never grades its own homework.
5. **Handoffs are validated artifacts, never raw context.** A handoff is a diff plus a passing test plus a conformance report. Heavy exploration happens in an isolated specialist context that returns a short structured summary.
6. **Every loop has hard termination conditions.** Max iterations, a definition-of-done tied to a CI gate, and no-progress detection. Step repetition (15.7%) and unaware-of-termination (12.4%) are named MAST failure modes.
7. **Least-privilege tools per role.** Scout gets read-only. The implementer gets edit + test. Nobody gets merge or deploy directly; that capability belongs to CI. Repo secrets belong to Aman alone.
8. **Simplest architecture that works.** Add agents only for genuinely parallel or unpredictable work. Tightly coupled sequential steps stay in one context; multi-agent burns roughly 15x tokens and earns it only on breadth-first work.
9. **Full observability.** Every agent action, tool call, handoff and gate decision is logged with its inputs. Temperature 0 is not deterministic; log inputs, outputs and model build so any run can be replayed. This log is also the legal audit trail.
10. **The fleet itself is regression-gated.** Prompts, role charters and tool configs are versioned code; every change runs the golden set (built at least 60% from real production failures) and merges block on regression. The golden set grows from every escaped bug.

## 3. The 11 specialist charters

Each specialist is a separate agent context with its own scoped tools. Rob dispatches; specialists return validated artifacts.

| Specialist | Charter | Tools (least privilege) |
|---|---|---|
| **Scout** | Read-only archaeology of the old repos (fresh clones of tamazia-cowork-os and tamazia-website). Answers "how did the proven organ work, where are its tests, what were its known failures". Never edits anything; returns file paths, line references and a port-readiness report. | Read/grep only, old-repo clones + digests |
| **Catalogue** | Owns `catalogue/`: loaders, linters (regex-health, polarity, prohibition-calibration, citation-completeness, enforcement-crossval, provenance), the compiled artifact and its versioning. Migrates the 187 laws / 696 rules into catalogue_v2 with tags and provenance. Never invents a legal fact; anything uncertain is a question for Aman (§6). | Edit within `catalogue/`, Neon read, test |
| **Facts** | Owns `facts/`: identity.js (register-first ladder), jurisdiction.js (Tier A/B/C matrix), sector.js (canonical tree + gated LLM + register cross-check), capabilities.js. One door per fact is its personal constitution. Exit bar: 100% on the reference set, abstentions allowed, contradictions never. | Edit within `facts/`, register API read, test |
| **Evidence** | Owns `evidence/`: crawler (ported E-236 parallelism, policy-page-first, caps not floors), browser observation lane (pre/post-consent cookie diff, tracker calls, the one unproven layer), registers, documents. Every external step deadline-wrapped. | Edit within `evidence/`, headless browser, test |
| **Adjudication** | Owns `breach/` and `llm/`: proposers, deterministic verifiers, the ported adjudicator (filter-only contract), gate.js rubrics, router quorum, versioned prompts, the five structural gates. Maintains the LLM eval harness and its precision/abstain gates. | Edit within `breach/` + `llm/`, LLM call, test |
| **Render/Journey** | Owns `payload/`, the `@tamazia/audit-contract` package and `render-proof/`: schema, payloadToD, D_CONTRACT validator, Playwright truth lane, the report journey (rail, landing, PDF, share, HMAC). The renderer re-derives nothing. | Edit within `payload/` + `render-proof/`, Playwright |
| **Red team** | Tries to make the engine fabricate: hallucinated ids, fake quotes, fabricated citations, bot-walled sites, foreign-language corpora, prompt injection in crawled text. Every gate must catch every fixture; any escape is a P0 and a new permanent fixture. Never fixes what it breaks (Rule 4 separation). | Fixture authoring, test execution |
| **Tool warden (24x7)** | Runs the sweep loop (per-PR, nightly, weekly deep), maintains the numbered ledger, files ACT findings. **Blocks all progress while ACT findings are open; if the tools stop, work stops.** Owns tool config and keeps every gate able to fire (a gate that cannot fire is theatre). | `tools/sweep/`, CI config, ledger write |
| **Caution warden** | Owns `caution.md` (150-200 pointers, "what went wrong, the rule that prevents it"). Walks EVERY phase diff against ALL pointers; any repeat of a recorded failure fails the phase. Syncs new pointers after each phase from real incidents only. | Read all diffs, edit `caution.md` |
| **Research** | Three-source external validation for any architectural or legal-modelling decision (the PRD's externally-validated patterns: axe-core, OSCAL/OPA, Akoma Ntoso/LegalRuleML, KYB corroboration). No verdict from Rob without Research's corroboration when the decision is novel. | Web research, read-only repo |
| **Speed** | Per-stage latency budget report on every mint in `eval/speed-budget.js`. Guards the accuracy-first budget (3-5 min per audit acceptable, crawl ~7s via ported parallelism) and hunts serial waiting, floors and missing deadlines. Never trades accuracy for speed. | Read pipeline, profiling, test |

## 4. Phase-exit gate (every phase, no exceptions)

A phase (P0-P6, defined in `docs/PRD.md` §5) exits only when ALL of the following hold, in this order:

1. **Sweep clean at ACT level.** The 12-tool sweep has zero open ACT findings (two or more independent tools corroborating). Single-tool findings are triaged as leads in the ledger but do not block.
2. **Eval green.** `eval/golden/` (regression), `eval/calibration-known-bad/` (every gate provably fired on seeded bad input this run) and `eval/reference-set/` (match or abstain, never contradict) all pass in CI on the merge commit.
3. **Caution synced.** The Caution warden has walked the full phase diff against every pointer in `caution.md`, recorded zero repeats, and appended any new pointers earned this phase.
4. **Three-external-validation review.** Rob presents the phase's load-bearing decisions with three independent validations each (tool evidence, reproduced run, external source or Research corroboration).
5. **Aman sign-off.** Explicit, per phase. Telegram phase report sent. No default-yes here; silence is not sign-off.

## 5. Running the sweep and reading the ledger

The sweep lives in `tools/sweep/` (ported from cowork-os PR #342) and runs per-PR, nightly, and weekly-deep via `.github/workflows/sweep.yml`.

**Run it:**
```
node tools/sweep/collect-alerts-full.js   # harvest GitHub code-scanning alert states (CodeQL, Semgrep)
node tools/sweep/collect-reviews.js       # harvest AI review comments (CodeRabbit, CodeScene)
node tools/sweep/collect-local.js         # domain gates + madge + dep-cruiser + jscpd + ESLint, SARIF out
node tools/sweep/normalise.js sarif       # fingerprint -> dedupe -> DSU cluster -> numbered ledger
node tools/sweep/report.js                # render the ledger report
```

**How the numbering works (deterministic, trust it):** fingerprint = SHA256(path, rule_id, SHA256(snippet)), never the line number (lines shift on every edit; the defect does not). Dedupe is a hash map; clustering is Union-Find bucketed by (path, category); numbering sorts by (severity, corroboration, fingerprint). Same input, same numbers, forever.

**How to read it:** **ACT** = two or more independent tools agree = a fact, fix it now, all other work stops. **REVIEW** = one tool = a lead, triage it, never auto-fix it. A lone finding from a weak tool is noise; a lone finding from a strong tool is still only a lead. Corroboration is the whole point. Every dismissal carries a written reason; "won't fix" is a risk accepted, not a defect refuted, and blanket dismissals are re-examined item by item.

## 6. The reference-set doctrine

`eval/reference-set/` holds hand-verified expectations for ~27+ real firms (the 9 forensic audits, the 10-domain watch list, the 8-firm legal/health matrix, plus Aman's additions). The doctrine, verbatim policy:

- The engine must **match or abstain, never contradict.** An abstention (needs-review, compliance_unassessed, insufficient evidence) is always acceptable; a contradiction of a hand-verified fact fails the run and the phase.
- The reference set is append-mostly. Changing an expected value requires documented re-verification against the primary source (register row, live page, statute) and Aman's sign-off, because the reference set outranks the engine by definition.
- Every escaped production error becomes a reference-set or golden-set entry before its fix merges (the golden set stays at least 60% real failures).
- Monthly re-verification: firms change; a stale expectation is treated as a bug in the reference set, not a licence to contradict.
- "100%" means zero false claims, honest abstention, and disclosed coverage. It never means maximal finding counts.

## 7. Escalation rules: what needs Aman

Only Aman may do, decide or unlock the following. Agents surface these as numbered questions and proceed on documented defaults only where the PRD marks a default.

1. **Repo secrets and tokens.** Setting or rotating any GitHub Actions secret, ENV_B64, API key or provider token. Agents never handle secret values in files or logs (CONSTITUTION Rule 16).
2. **Spend.** Any new paid tool, paid LLM usage (the Haiku backstop activates only on a benchmark showing free provably degrades quality), paid data source, or anything crossing the $100/month combined alert threshold. £0 is the default; every spend needs a written justification and Aman's yes.
3. **Catalogue legal judgements.** Promoting a discovered law, changing a penalty band, marking supersession or binding status, asserting a Gulf-frontier rule, or any row where provenance is ambiguous. The engine catalogues verified law; it does not decide what the law is.
4. **Phase sign-off.** Every P0-P6 exit (§4.5) and the monthly caution.md review.
5. **SEND stays OFF.** Flipping any outbound sending is founder-only, always, everywhere. No agent proposes flipping it as part of any fix.
6. **Destructive or shared-estate operations.** Neon DDL beyond additive, anything touching the agency/lead-gen pipeline, DO-NOT-TOUCH tables, freezing old-repo modules (CODEOWNERS), or deleting anything not backed up with a tag.
7. **Reference-set expectation changes** (§6) and the "100%" definition.

Everything else proceeds under the fleet rules with CI as the arbiter.

## 8. Resuming the system (checklist for a fresh session)

1. Read this file, `CONSTITUTION.md`, `caution.md`, `docs/PRD.md`.
2. Run the sweep (§5) and read the ledger. If any ACT finding is open, that is the entire task list.
3. Check the current phase against the PRD §5 exit gates; find the last Aman sign-off in the phase reports.
4. Run `eval/golden`, `eval/calibration-known-bad`, `eval/reference-set` locally; a red eval outranks any feature work.
5. Before writing code, confirm the unit has a pre-committed acceptance spec (Fleet Rule 2). If not, write the spec first and have it approved.
6. Verify done against ground truth at the end: git diff on main, CI on the merge commit, the live minted payload, the rendered page (CONSTITUTION Rule 17).

## 9. The GATE LOOP (standing, every deploy/phase/PR)

CI status on the merge commit is the only arbiter of done (Fleet Rule 1), but a red gate is not
self-explanatory and a fix applied by the same hand that broke it is not independently reviewed
(Fleet Rule 4: generator, critic and adversarial verifier are always distinct). The GATE LOOP is the
standing procedure that turns "CI is red" into a fixed, re-verified, merged state without ever
letting the agent that introduced a defect also certify it gone.

**The loop, every time, after every deploy, every phase exit, and every PR:**

1. **Collect.** A low-token collector agent gathers findings: the sweep ledger (`tools/sweep/`),
   CI job output, `eval/calibration-known-bad`, `eval/golden`, `eval/reference-set`, and any CodeRabbit/CodeScene
   review comments. It does not analyse or fix anything - it only harvests and returns a structured
   findings list, kept deliberately cheap (least-privilege, Fleet Rule 7) since collection runs after
   every single change.
2. **Analyse + plan.** Fable (the orchestrator-of-record for this loop) reads the collected findings
   against `CONSTITUTION.md` and `caution.md`, and writes a fix plan: which finding maps to which
   pointer/rule, the exact change each fix requires, and a machine-checkable benchmark per fix
   (Fleet Rule 2 - a spec before work starts). Fable never writes the fix itself in this step.
3. **Execute.** A lower-model agent executes the fix plan Fable wrote - it implements exactly the
   committed plan, nothing more, and does not re-scope or re-analyse the findings itself (Fleet Rule
   4: the generator is never the critic).
4. **Recheck.** Fable rechecks the execution against the plan's benchmarks: does the diff actually
   do what the plan said, and only that.
5. **Tools rerun.** The full local tool fleet reruns from a clean state (lint, madge, jscpd,
   dependency-cruiser, swallow-gate, the known-bad calibration corpus, the catalogue compiler) -
   never trusted from memory, always re-executed (Fleet Rule 1: CI is the only arbiter).
6. **Merge gate.** Push or merge happens ONLY on full green: every tool in step 5 passing AND Fable's
   recheck in step 4 clean. Any red at any step returns to step 2 (a new plan), never a patch bolted
   directly onto step 3's output.

**Model escalation doctrine (least-capable-sufficient model per step, Fleet Rule 7 applied to model
choice, not just tool access):**

- A task a Haiku-class model can complete correctly stays on Haiku; it escalates to Sonnet only when
  it demonstrably cannot (a failed attempt, an ambiguous spec Haiku cannot resolve on its own).
- A task a Sonnet-class model can complete correctly stays on Sonnet; it escalates to Opus only when
  Sonnet demonstrably cannot.
- A task an Opus-class model can complete correctly stays on Opus; it escalates to Fable only when
  Opus demonstrably cannot.
- **Fable orchestrates and rechecks only** (steps 2 and 4 above) - Fable is never the default
  executor of step 3. Routing a fix to Fable by default when a cheaper model would have done the job
  is itself a fleet-rule violation (Fleet Rule 8: simplest architecture that works; multi-agent burns
  roughly 15x tokens and must earn that cost).

This section is standing operating procedure, not a one-off instruction: it applies to every future
deploy, phase exit, and PR in this repository, and a fresh session resuming from §8 above should
treat it as already in force.
