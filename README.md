# tamazia-audit-engine

Fresh, single-purpose rebuild of the Tamazia compliance/SEO/GEO audit engine. It replaces the audit path of `tamazia-cowork-os` with a constitution-enforced skeleton into which the proven organs of the old engine are ported module by module (a strangler port, not a rewrite). The goal is zero-false-claim accuracy: every law name, fine, regulator and citation comes from a compiled catalogue; every breach claim is backed by a verifiable artifact; anything uncertain ships as needs-review or not at all.

**Proprietary code, all rights reserved.** This repository is public purely so the free tiers of the CI tool fleet (CodeQL, Semgrep, CodeScene, CodeRabbit and friends) can run against it. There is deliberately no OSS licence file. Public visibility is not a grant of any right to use, copy or redistribute.

## Architecture (one diagram)

```
LAW REGISTRY (Neon-authored; compiled, versioned, linted catalogue artifact)
 law = {id, citation(act/section/url), jurisdiction, sub_jurisdiction,
        sector[], sub_sector[], activity_tags(b2c, cookies, ads, ai, payments...),
        required_nexus, applies_when/excluded_when, elements[](element_checklist),
        penalty(typical band + statutory max + currency), regulator, enforcement[],
        provenance(source, last_synced) -- never render a law without provenance}
        |  the ONLY source of law names, fines, regulators, citations
        v
URL -> EVIDENCE (artifacts)
    -> FACTS (one door each: identity, jurisdiction, sector, capabilities)
    -> APPLICABILITY (pure function over catalogue tags)
    -> BREACH (propose -> verify -> adjudicate; violation / needs-review / pass)
    -> PAYLOAD (shared contract: @tamazia/audit-contract)
    -> RENDER (pure, word-by-word proven by Playwright)
```

Laws are data with applicability tags. The engine is a chain of pure, individually auditable functions. One producer per fact. The LLM selects and judges inside the catalogue's closed world, quotes verbatim or abstains — it never authors a fact.

## The constitution (one-liners)

Full text and enforcement mechanics live in [CONSTITUTION.md](CONSTITUTION.md). The rules, each mechanically enforced in CI:

- One door per fact (blocking CI gate).
- Catalogue-only fines, regulators and law names — a literal in code fails CI.
- No artifact, no breach.
- Every gate fails closed and is calibrated against a known-bad fixture.
- Reachable-or-DORMANT: no code exists that nothing calls.
- Below-confidence output is quarantined, never shipped.
- A mint is done only when row + HTTP 200 + Playwright word-by-word truth pass.
- Budgets are caps, never floors; every external step has a hard deadline.
- Findings are evidence-quoted factual observations plus risk indicators, never adjudicated legal conclusions, with a standing not-legal-advice line.

The five structural-impossibility LLM gates (fail-closed AND-chain): retrieval-gated emission, verbatim-quote exact re-match, NLI entailment per claim, abstain-by-default confidence floor, diverse jury with veto-to-reject.

## Repo map

| Path | What it is |
|---|---|
| `CONSTITUTION.md` | The mechanically enforced rules above, in full |
| `caution.md` | 150-200 "what went wrong -> the rule that prevents it" pointers, re-checked every phase |
| `DORMANT.md` | Register of intentionally unreached code (reachability CI enforces the rest) |
| `AGENTS.md` | The Rob agent operating system: orchestrator, specialists, handoff rules |
| `docs/` | [PRD.md](docs/PRD.md), [FOUNDER-ACTIONS.md](docs/FOUNDER-ACTIONS.md), [discovery/](docs/discovery/) (10 forensic digests) |
| `catalogue/` | Law-registry loaders, linter suite (regex-health, polarity, prohibition-calibration, citation-completeness, enforcement-crossval), compiled artifact, versioning |
| `evidence/` | Crawler, browser observation lane, register clients, document extraction |
| `facts/` | Single-door fact producers: `identity.js`, `jurisdiction.js`, `sector.js`, `capabilities.js` |
| `applicability/` | Pure connect function (ported resolver rigour), conflicts, sub-jurisdiction |
| `breach/` | Proposers (regex/DOM/register), deterministic verifiers, LLM adjudicator |
| `llm/` | `gate.js`, `router.js` (free-first provider chain), versioned prompts, evals |
| `payload/` | Payload schema (source of the `@tamazia/audit-contract` package), composer |
| `mint/` | Worker, queue, post-write assertions |
| `render-proof/` | Playwright word-by-word truth lane |
| `eval/` | Golden audits, known-bad calibration corpus, reference set, mutation testing |
| `tools/` | Sweep (SARIF fan-in, fingerprint dedupe, DSU clustering, ledger), one-door gate, fact-lineage tracer, silent-swallow AST gate |
| `.github/` | CI workflows — the whole tool fleet runs from commit 1 |

## How to run

```
npm ci             # install exact dependencies
npm run lint       # ESLint + the repo gates (one-door, silent-swallow, domain gates)
npm run sweep      # the multi-tool sweep: fan-in, dedupe, cluster, ledger
npm run calibrate  # every analyser must fail on its seeded known-bad fixture
```

## Phase plan

Every phase shares the same exit gate: 12-tool sweep clean at ACT level (>=2-tool corroboration) · eval + golden + calibration green · caution.md synced by the warden · Rob's 3-external-validation review · Aman sign-off.

| Phase | Scope | Exit gate (in addition to the shared gate) |
|---|---|---|
| P0 | Foundation: repo, all tools wired into CI from commit 1, sweep port, caution.md seeded (~170 pointers), golden/known-bad/reference harnesses, shared contract package published, CONSTITUTION.md + AGENTS.md, discovery digests in docs/ | Harness exists before engine code; calibration proves every gate can fail |
| P1 | Facts: identity ladder (register-first), tier-matrix jurisdiction, sector tree + gated LLM + register cross-check, slug from resolved legal name | 100% on the reference set — abstentions allowed, contradictions not |
| P2 | Catalogue: Neon 187 laws / 696 rules migrated through the linter suite into versioned catalogue_v2; full tag schema incl. excluded_when thresholds; element checklists for the 28 UK legal rules first; enforcement-intel pipeline (human-gated, provenance-mandatory) | Catalogue compiles, lints clean, version-stamped |
| P3 | Evidence + breach: crawler with proven parallelism (~7s) + coverage contract; browser observation lane (PECR pre-consent diff proven in a minted payload); register checks; adjudicator + the 5 structural gates; three-state findings | Reference-set breaches reproduced, zero false accusations, all red-team fixtures caught |
| P4 | Payload + render truth + journey: shared contract enforced both ends, renderer re-derives nothing, first-screen contradiction fixed, category separation, PDF download + share card, working per-recipient HMAC, left rail + landing redesign | Playwright word-by-word truth lane green on every PR |
| P5 | Scale: cell-by-cell rollout UK-depth-first; free-first LLM routing benchmarked against Haiku backstop; re-mint the paused 2,858-row queue through the new engine | Benchmark decides the backstop; monthly reference-set re-verification in place |
| P6 | Continuous truth: nightly gap-finder, weekly audit-of-the-audits, legislation.gov.uk / EUR-Lex / eCFR watchers, re-mint on version bumps, 24x7 sweep loop, verify-backlog timeout fixed | The watchers and the sweep loop run unattended |

## Read next

- [docs/PRD.md](docs/PRD.md) — the full PRD: context, architecture, decisions with Aman, phases, Rob system, open questions
- [AGENTS.md](AGENTS.md) — the Rob runbook (orchestrator-worker rules, specialists, handoff contracts)
- [caution.md](caution.md) — the failure-pointer ledger every phase is walked against
- [docs/FOUNDER-ACTIONS.md](docs/FOUNDER-ACTIONS.md) — the founder-click checklist (tool wiring, repo settings, secrets, open decisions)
- [docs/discovery/](docs/discovery/) — the 10 discovery digests the rebuild is grounded in
