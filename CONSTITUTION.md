# CONSTITUTION: tamazia-audit-engine

These are the mechanically enforced rules of this repository. Every rule exists because the old estate broke it and shipped a false legal claim, a phantom mint, or a confident zero. A rule with no enforcing gate is theatre, so every rule below names the CI gate or tool that enforces it. If a gate cannot fire, the rule does not exist: fix the gate before writing code that depends on the rule.

Enforcement-file status: this repo is at P0, so some named enforcing files are the committed names later phases must land, not files in the tree today. The Part III gate map marks every file **live** or **planned (Pn)**; a prose "Enforced by" reference to a file not yet in the tree means the planned file in that map.

This repository is PUBLIC. No secret, token, key, password or connection string may ever appear in any file. This document is not legal advice and the engine's output is not legal advice; a standing not-legal-advice line ships on every rendered audit.

Sources: docs/PRD.md §3, docs/discovery/digest-research-llm-agents.md, docs/discovery/digest-research-compliance.md, docs/discovery/digest-claude-ledger-forensic.md, docs/discovery/digest-findings-bible.md.

---

## Part I: The constitutional rules

### Rule 1: One door per fact
Every client-facing fact (legal name, jurisdiction, sector, regulator, fine, law name, host, element checklist) has exactly ONE producer module. Consumers read the fact; they never re-derive it. The renderer introduces no facts.

**Why:** the old estate had 10 producers of jurisdiction, 8 of host, 6 of sector, 5 of regulator; the stale door is the one the client sees. This class shipped a P0 three times: the ghost jurisdiction, "Sector regulator" printed on 51% of the catalogue, and the £17.5M fine fixed in the DB that never reached the client because three code files kept their own copy (digest-findings-bible §B1).

**Enforced by:** `tools/one-door/check.js` (blocking gate, ported from cowork-os PR #342) run inside the sweep (`.github/workflows/sweep.yml` and `tools/sweep/run.js`, wired into `.github/workflows/ci.yml`) on every PR; `tools/fact-lineage/check.js` asserts a single producer per fact and that the renderer imports facts only through the payload contract (activates fully when `payload/schema/facts-lineage.json` lands in P4).

### Rule 2: Catalogue-only law facts
The compiled catalogue artifact is the ONLY source of law names, citations, fines, penalty bands, regulators and enforcement intel. A literal law name, fine amount or regulator string in engine or renderer code fails CI.

**Why:** hand-maintained copies drifted for months: `FW_NAME_CAT` was a frozen 285-code snapshot rendering "Uae Newcode"; `fineRate` regexes applied wrong ceilings to non-fining bodies; the self-learning loop invented statutes with fake legislation.gov.uk URLs (digest-claude-ledger-forensic b64, b65, b97).

**Enforced by:** `catalogue/lint/no-literal-law-facts.js` (blocking, scans engine + renderer source for law-name/fine/regulator literals outside `catalogue/`) in `.github/workflows/catalogue-lint.yml`; the render truth-pack in `render-proof/truth-pack.spec.js` rejects any rendered fine, regulator or law title not present in the compiled catalogue.

### Rule 3: No artifact, no breach
A breach finding must carry a deterministic artifact: a verbatim quote string-matched to the crawled corpus, a captured network event, a register row, or a failing DOM node. No artifact means the finding cannot exist, whatever a regex or a model said.

**Why:** every breach Tamazia ever sent before v23.0 was an unreviewed regex match no model or artifact ever verified; a bare-word regex over raw HTML accused a real criminal-defence law firm of being hacked ("sex discrimination", `<slot>`) (digest-claude-ledger-forensic b84, e-adjudicator). Pentest doctrine: "a finding with no reproduction steps cannot be trusted" (digest-research-compliance §D).

**Enforced by:** `breach/verifiers/` is the only path from proposer to adjudicator, and the payload schema in `payload/schema/` makes the artifact fields mandatory (missing artifact = schema-invalid payload, mint refused); `render-proof/truth-pack.spec.js` re-matches every rendered quote against the stored corpus word by word in `.github/workflows/render-truth.yml`.

### Rule 4: Every gate fails closed and is calibrated against known-bad input
A gate that errors, times out or receives malformed input must BLOCK, not pass. Every analyser and gate must demonstrably fail on a seeded bad fixture on every run; a gate that has never fired is assumed broken.

**Why:** mandatory audit gates ran AFTER the R2 payload was persisted; `llmPreflight()` failed open; the jurisdiction stage was marked `ran` unconditionally; three evidence layers threw ReferenceErrors on their first line for two whole versions while a fail-open catch shipped every audit as if the model had read the breaches (digest-findings-bible F-0001; digest-claude-ledger-forensic b106).

**Enforced by:** `eval/calibration-known-bad/run.js` in `.github/workflows/ci.yml` feeds every gate a corpus of seeded bad inputs each run and fails CI if any gate passes one; `tools/swallow-gate/check.js` (AST-level, repo-wide, also in `.github/workflows/ci.yml`) blocks any catch block that swallows without recording a typed failure state.

### Rule 5: Reachable or DORMANT
Every module is either provably reachable from the mint entry point or explicitly declared in `DORMANT.md` with a reason. Dead-but-green code is a lie waiting to ship.

**Why:** 13 modules / 691 lines of correct, tested, cited legal logic were unreachable from the mint, including `citation-gate.js`, the gate built to make an unevidenced monetary claim impossible, which had never executed once; `statute-rag.js` was required for months and never called (digest-findings-bible §B6).

**Enforced by:** madge + dependency-cruiser reachability walk in `.github/workflows/reachability.yml`, blocking: any module not reachable from `mint/` and not listed in `DORMANT.md` fails the PR; `tools/domain-gates/reachability.js` additionally asserts every ACTIVE catalogue rule routes to a scanner branch that can actually fire.

### Rule 6: Below-confidence output is quarantined, never shipped
Anything the engine cannot assert with evidence at or above the confidence floor routes to quarantine (`needs-review` or `compliance_unassessed`), never into a shipped claim. Ambiguity defaults to withholding the accusation.

**Why:** ambiguous LLM entailment verdicts ("Unclear, leaning no") matched neither branch and the finding stayed CONFIRMED with its fine; a foreign-language site got a fabricated 16-breach GDPR cascade because English regexes ran on a French corpus; unreadable bot-walled sites were asserted against (digest-claude-ledger-forensic b135, b1, b126).

**Enforced by:** the adjudicator contract in `breach/adjudicator/` (verdict enum has no "maybe ships" branch: only violation / needs-review / pass, unparseable verdict = needs-review); `eval/calibration-known-bad/run.js` includes ambiguous-verdict and non-English fixtures that must land in quarantine; the payload schema rejects findings whose confidence fields are below floor but whose state is `violation`.

### Rule 7: A mint is done only when row + HTTP 200 + truth-pack all pass
"Minted" means: the DB row exists, the live URL answers 200, and the Playwright truth-pass proves the rendered words match the payload. Anything less is not done, whatever the queue says.

**Why:** the old queue reported "done" on 1,004 phantom audits; `ON CONFLICT DO NOTHING` adopted stale rows while the queue said done; a transport failure masqueraded as an idempotent conflict and a row that was never written was hunted for days (digest-claude-ledger-forensic b102, b103; PRD §1).

**Enforced by:** `mint/post-write-assertions.js` runs inside every mint worker (row read-back + live 200 + truth-pack invocation before status flips to done); `tools/mint-reconciler/reconcile.js` in `.github/workflows/mint-reconcile.yml` (scheduled) diffs queue vs audit_pages vs leads and alarms on any done-without-page.

### Rule 8: Budgets are caps, never floors
Every page, token, retry and time budget is an upper bound. No `Math.max` floors, no minimum waits, no "at least N seconds".

**Why:** the SPA-render tail carried a 45-second FLOOR via `Math.max`, so a few shells always cost 45s or more and the ~45s-any-website capability was lost; the measured fix (E-236) restored a 43s crawl to 6.9s with identical accuracy (digest-claude-ledger-forensic §d).

**Enforced by:** `tools/domain-gates/budget-caps.js` (AST scan for floor patterns on budget variables) in `.github/workflows/domain-gates.yml`; the Speed specialist's per-stage latency report in `eval/speed-budget.js` fails CI if any stage's configured budget behaves as a floor on the golden set.

### Rule 9: Every external step has a hard deadline
Every LLM call, browser step, register lookup and fetch is wrapped in a hard `Promise.race` deadline. A slow dependency degrades the mint; it never hangs it.

**Why:** a stuck Chromium held a mint hostage for 752 seconds because the 30s goto timeout did not bound browser launch + networkidle; exhausted free LLM tiers burned 30s × 3 retries × 3 gate attempts waiting for answers that were never coming (digest-claude-ledger-forensic b115, §d E-238).

**Enforced by:** `evidence/` and `llm/router.js` expose only deadline-wrapped call primitives (no raw fetch/browser call exports); `tools/domain-gates/deadline-audit.js` in `.github/workflows/domain-gates.yml` fails CI on any external call site not routed through a deadline wrapper; timeout behaviour is exercised by hang fixtures in `eval/calibration-known-bad/`.

### Rule 10: Three-state findings, and confident voice must be EARNED
Every finding is exactly one of **violation / needs-review / pass** (the axe-core doctrine: anything not assertable with certainty degrades to needs-review, and every false positive is a bug). Voice policy (the punchier hybrid, Aman-decided 2026-07-16): the confident "evidenced on your live site" voice is reserved for register-verified facts and adjudicated findings carrying verbatim quotes; needs-review items render in observation language ("detected X; this may implicate Act §Y, penalty band Z"); a standing not-legal-advice line appears on every audit. No finding is ever phrased as an adjudicated legal conclusion.

**Why:** binary verdicts forced the verifier to call the real Equality Act fabricated because it could not say "unverifiable"; low-confidence attachments rendered as hard breaches; invented enforcement filler printed when no curated intel existed (digest-claude-ledger-forensic b100, b59, b96; digest-research-compliance §A axe-core, lesson 15).

**Enforced by:** the payload schema (`payload/schema/`) types `finding.state` as the closed three-value enum and ties voice tier to state plus evidence fields (confident-voice strings on a needs-review finding = schema-invalid); `render-proof/truth-pack.spec.js` asserts the not-legal-advice line is present and that no needs-review finding renders breach-voice phrasing; `eval/golden/run.js` locks voice regressions.

### Rule 11: The LLM is extraction and selection only; it never authors a fact
The LLM may select among retrieved candidate spans, extract from supplied material, and adjudicate proposed findings as a FILTER (it can remove or downgrade, never invent). It never writes a law name, fine, citation, jurisdiction or breach into existence. All LLM output is structured (schema-enforced), logged in full, and every prompt/model change is gated on a golden set built at least 60% from real production failures. Temperature 0 is not determinism: log inputs, outputs and model build for every call.

**Why:** commercial RAG-backed legal tools still hallucinate in 1 of 6 or more queries (Stanford RegLab); our own self-learning loop invented "Cookies... Regulations 2020" with three different fabricated URLs and resurrected the repealed Disability Discrimination Act 1995 (digest-research-llm-agents Part A; digest-claude-ledger-forensic b97).

**Enforced by:** `llm/gate.js` (ported, proven live: deterministic rubrics, never model self-confidence, three strikes to deterministic fallback) wraps every call; the adjudicator's filter-only contract is tested against a hallucinated-id fixture in `llm/evals/run.js` (`.github/workflows/llm-eval.yml`, blocking on precision and abstain-rate); full call logging asserted by `eval/calibration-known-bad/` replay fixtures.

### Rule 12: The five structural-impossibility LLM gates (fail-closed AND-chain)
Every LLM-touched claim must pass ALL five gates. They compose: gates 1 and 2 are deterministic set/string operations, so fabricated citations and fake quotes have escape probability zero, not merely small. Everything rejected routes to abstention; the failure mode is "refuses to answer", never "confidently wrong".

**Gate 1: Retrieval-gated emission.** A claim may cite only a `source_id` present in the injected retrieval set; a citation to a non-retrieved authority is unrepresentable in the output schema.
*Why:* 13-21% of legal citations across five commercial systems were hallucinated (arXiv 2606.00898). *Enforced by:* structured-output schemas in `llm/prompts/` whose source_id fields are constrained to the injected candidate list, validated post-hoc by `llm/gate.js` (out-of-set id = score 0, reject).

**Gate 2: Verbatim-quote exact re-match.** Every quoted span must survive a normalised exact-substring match against the cited document before the claim may exist.
*Why:* models paraphrase inside quotation marks and fabricate pincites (Stanford HAI); our corpus regex ran on raw HTML while the quote came from stripped text, so hit and quote disagreed (digest-claude-ledger-forensic b32). *Enforced by:* `breach/verifiers/quote-match.js` (deterministic, blocking, one detection surface per rule); re-verified at render by `render-proof/truth-pack.spec.js`.

**Gate 3: NLI entailment per claim.** Each atomic claim is the hypothesis, its cited span the premise; anything not labelled entailment is rejected.
*Why:* fluent-but-neutral sentences are the classic grounded hallucination (Nature 2024 semantic entropy; Google NLI research). *Enforced by:* the entailment step in `breach/adjudicator/` with its verdict rubric scored in `llm/gate.js`; calibration fixtures with known neutral/contradiction pairs in `llm/evals/` must be rejected every run.

**Gate 4: Abstain-by-default confidence floor.** The default output is insufficient-evidence; a claim releases only above a calibrated floor, and abstention is always the cheaper path.
*Why:* forcing an answer on every query "causes confident mistakes and hallucinations" (SelectLLM); ambiguous verdicts defaulting to CONFIRMED kept fines on findings (digest-claude-ledger-forensic b135). *Enforced by:* the floor constant lives in `breach/adjudicator/` and is regression-locked by `llm/evals/run.js` abstain-rate gates; lowering it without updating the eval set fails CI.

**Gate 5: Diverse jury with veto-to-reject.** P0/P1 findings require a quorum of genuinely independent model families; any single veto rejects; the jury may never veto curated catalogue facts (SECTOR_CORE / SECTOR_AGNOSTIC immunity).
*Why:* weak judges have high true-positive but very low true-negative rates, so a rejection is more trustworthy than an approval; our "dual-model" cross-check once hit the same provider twice and was not independent; the LLM was once allowed to veto the SRA off a solicitors' firm (digest-research-llm-agents Pattern 5; digest-claude-ledger-forensic b73, b91). *Enforced by:* `llm/router.js` quorum configuration asserts distinct provider families; immunity sets tested in `llm/evals/run.js`; forked verifier legs share one guarded code path (the b92 lesson) checked by `tools/one-door/check.js`.

### Rule 13: Serves is not bound: the Tier A/B/C jurisdiction matrix
A jurisdiction attaches only on evidence, graded by tier: **Tier A** (register row, regulatory authorisation, registered office) scores 5; **Tier B** (office postcode, local phone, ccTLD/hreflang, local currency) scores 3; **Tier C** (prose mentions, "we serve clients in...") scores 1. Attachment requires one Tier A or two Tier B signals. Tier C NEVER attaches law; at most it feeds an advisory tier. Serving a market is not being bound by its law; law applicability is then a pure set-membership query over the applicability matrix (jurisdiction × sector × activity tags), and the verdict is graded with an evidence chain, KYB-style, never a boolean.

**Why:** `/incorporated in/` anchored to no country judged 6 of 7 real UK/EU/UAE law-firm footers "established in the United States", and Mills & Reeve (UK) was served US ABA rules and ADA law, 4 of 8 findings jurisdictionally void; template hreflang pulled EU law onto a US clinic; a jurisdiction statement told a UAE firm the CCPA applied (digest-findings-bible DG-05; digest-claude-ledger-forensic b55, b128; digest-research-compliance §C).

**Enforced by:** `facts/jurisdiction.js` is the single door for jurisdiction (Rule 1 gate applies); `tools/domain-gates/nexus-anchoring.js` in `.github/workflows/domain-gates.yml` replays the known-bad footer corpus (the Mills & Reeve class) every run; `eval/reference-set/run.js` fails on any jurisdiction contradiction against the hand-verified firms.

### Rule 14: Provenance-mandatory catalogue rows
No catalogue row (law, rule, penalty, enforcement case) exists without provenance: source, official URL verified by FETCHING it and confirming the page IS that law (a 200 with matching content, never a 202 or an unfetched string), and last_synced. Discovered candidates are three-state (verified / rejected / unverifiable); only verified rows are promoted, and promotion of legal judgements is human-gated.

**Why:** the official-URL "gate" checked only that a URL string was present; legislation.gov.uk answers 202-with-empty-body to ANY URL shape, so the status-code gate passed every fabrication; a full discovery run over 151 candidates yielded zero promotable laws (digest-claude-ledger-forensic b97, b98, b99).

**Enforced by:** `catalogue/lint/provenance.js` and `catalogue/lint/citation-completeness.js` (blocking) in `.github/workflows/catalogue-lint.yml`: every row must carry resolvable provenance fields and every ACTIVE rule a citation; the catalogue compiler in `catalogue/` refuses to emit an artifact containing an unverified row; enforcement-intel population is human-gated per `catalogue/lint/enforcement-crossval.js`.

---

## Part II: Supplementary mechanical rules (earned by specific failures)

### Rule 15: No scan cache; the engine version is load-bearing
A legal-evidence engine keeps no scan cache (a day-old scan dated today is not evidence). Any change to scan logic bumps ENGINE_VERSION, the version rides the idempotency key, and the DB-level trigger keyed on `engine_flags.required_engine_version` is the lock every minter must pass.

**Why:** `scanner_cache` replayed pre-fix scans so "it's fixed now" was false four rounds running; a rogue pre-gate Hetzner cron minted on v19 for days; a partial catalogue (290 frameworks, 0 rules) was cached process-wide and connect attached nothing (digest-claude-ledger-forensic §c, b44, b107).

**Enforced by:** `.github/workflows/engine-version-guard.yml` fails any PR touching scan logic without a version bump; the DB gate is ported as part of `mint/`; `tools/mint-reconciler/reconcile.js` alarms on any row minted under a stale version.

### Rule 16: No secrets, ever (public repo)
Nothing matching a credential shape (ghp_*, npg_*, sk-*, cfut_*, xoxb-*, postgres://, or any key/token/password) may appear in any file, fixture, log capture or golden payload. Golden fixtures are structural-only and pseudonymised; raw payloads with prospect PII stay gitignored.

**Why:** a leaked webhook secret persisted verbatim in a harvested review snapshot on the old estate (digest-findings-bible GR-0002/CR-0010); golden fixtures nearly leaked prospect PII into a public repo (digest-claude-ledger-forensic b122).

**Enforced by:** `.github/workflows/secret-scan.yml` (gitleaks, blocking, full history on push) plus GitHub push protection; `eval/golden/` fixture linter rejects email addresses and person names outside the pseudonym dictionary.

### Rule 17: Done means verified against ground truth
No agent, script or session reports a change done until verified at the end against ground truth: the git diff, the DB row, the live minted payload, the deployed asset. In-loop assumptions ("already present, skip") are not verification.

**Why:** a 17-node sector insert was reported done three times while silently skipping; PR #114 on the website was an empty merge whose "deploy success" shipped nothing; a fix merged to one leg while the quorum leg kept the bug (digest-claude-ledger-forensic b117, b118, §c).

**Enforced by:** Rule 7's mint reconciler for engine output; `render-proof/truth-pack.spec.js` for rendered output; CI status on the actual merge commit is the only accepted "done" signal per AGENTS.md Fleet Rule 1.

---

## Part III: The gate map (rule → enforcing file)

**Legend:** files LIVE today: `tools/one-door/check.js`, `tools/swallow-gate/check.js`, `tools/fact-lineage/check.js`, `tools/sweep/*`, `eval/calibration-known-bad/run.js`, `eval/golden/run.js`, `eval/reference-set/verify.js`, `payload/contract/index.js`, `payload/schema/payload.schema.json`, and workflows `ci.yml`, `sweep.yml`, `codeql.yml`, `semgrep.yml`. Every other file in this table is **PLANNED (P1+)**: it is the committed name the owning phase must land, and this table is the contract for it. A planned gate is not an excuse — the rule binds from day one; until its dedicated file lands, the closest live gate (sweep/ci) covers what it can and the rest is enforced in review.

| Rule | Enforcing gate | File |
|---|---|---|
| 1 One door per fact | one-door + fact-lineage | `tools/one-door/check.js` (live, runs in ci/sweep), `tools/fact-lineage/check.js` (live, arms fully in P4) |
| 2 Catalogue-only law facts | catalogue lint + truth-pack | `catalogue/lint/no-literal-law-facts.js` (planned P2), `render-proof/truth-pack.spec.js` (planned P4); today `tools/one-door/check.js` (live) blocks fine/regulator/law-title literals outside `catalogue/` |
| 3 No artifact no breach | payload schema + verifiers | `payload/schema/payload.schema.json` (live), `breach/verifiers/` (planned P3), `.github/workflows/render-truth.yml` (planned P4) |
| 4 Fail-closed calibrated gates | known-bad corpus + silent-swallow AST | `eval/calibration-known-bad/run.js` (live, in ci.yml), `tools/swallow-gate/check.js` (live, in ci.yml + sweep) |
| 5 Reachable-or-DORMANT | reachability walk | `DORMANT.md` (lands with the first module), reachability walk live in `tools/sweep/collect-local.js` (arms when `mint/worker.js` or `mint/index.js` exists); madge + dependency-cruiser live in ci.yml |
| 6 Quarantine below confidence | adjudicator contract + fixtures | `breach/adjudicator/` (planned P3), `eval/calibration-known-bad/run.js` (live) |
| 7 Mint = row+200+truth-pack | post-write assertions + reconciler | `mint/post-write-assertions.js`, `tools/mint-reconciler/reconcile.js`, `.github/workflows/mint-reconcile.yml` (all planned P4) |
| 8 Budgets are caps | budget-caps gate + speed report | `tools/domain-gates/budget-caps.js`, `eval/speed-budget.js`, `.github/workflows/domain-gates.yml` (all planned P3) |
| 9 Hard external deadlines | deadline-audit gate | `tools/domain-gates/deadline-audit.js` (planned P3), hang fixtures in `eval/calibration-known-bad/` |
| 10 Three-state + earned voice | payload schema + truth-pack + golden | `payload/schema/payload.schema.json` (live), `render-proof/truth-pack.spec.js` (planned P4), `eval/golden/run.js` (live) |
| 11 LLM extraction/selection only | gate rubric + LLM eval harness | `llm/gate.js`, `llm/evals/run.js`, `.github/workflows/llm-eval.yml` (all planned P3) |
| 12 The 5 structural gates | schema constraint, quote-match, entailment, floor, quorum | `llm/prompts/` schemas, `breach/verifiers/quote-match.js`, `breach/adjudicator/`, `llm/router.js`, `llm/evals/run.js` (all planned P3) |
| 13 Tier A/B/C jurisdiction | nexus-anchoring + reference set | `facts/jurisdiction.js` (planned P2), `tools/domain-gates/nexus-anchoring.js` (planned P3), `eval/reference-set/verify.js` (live) |
| 14 Provenance-mandatory catalogue | provenance + citation lints | `catalogue/lint/provenance.js`, `catalogue/lint/citation-completeness.js` (all planned P2) |
| 15 No cache + version gate | engine-version guard + DB trigger | `.github/workflows/engine-version-guard.yml` (planned P4), `mint/` DB gate (planned P4) |
| 16 No secrets | secret scan + fixture linter | Semgrep p/secrets pack (live, `.github/workflows/semgrep.yml`); `.github/workflows/secret-scan.yml` gitleaks lane + `eval/golden/` fixture linter (planned P1) |
| 17 Done = ground truth | reconciler + truth-pack + CI status | `tools/mint-reconciler/reconcile.js`, `render-proof/truth-pack.spec.js` (planned P4); CI status on the merge commit (live) |

Also always-on (the 12-tool sweep, per PRD §7): CodeQL (`.github/workflows/codeql.yml`, live), Semgrep (`.github/workflows/semgrep.yml`, live), CodeRabbit and CodeScene (GitHub Apps, least-privilege, cannot write code; founder enables per docs/FOUNDER-ACTIONS.md), madge + dependency-cruiser (live in `.github/workflows/ci.yml`), jscpd and ESLint (live in `.github/workflows/ci.yml`), the sweep orchestrator (`.github/workflows/sweep.yml`, live nightly), the domain gates (`.github/workflows/domain-gates.yml`, planned P3), and the Playwright render lane (`.github/workflows/render-truth.yml`, planned P4). SARIF fan-in, fingerprint dedupe, DSU clustering and the numbered ledger live in `tools/sweep/`. ACT (two or more independent tools agree) blocks all progress until fixed; a single-tool finding is a lead, never auto-fixed.
