# Tamazia Audit Engine — Fresh-Repo Rebuild: PRD, Phases, Rob Agent System

## 1. Context

The audit engine (`Tamaziaa/tamazia-cowork-os`) and renderer (`Tamaziaa/tamazia-website`) shipped inaccurate legal claims for months. A 12-tool sweep (2026-07-14, 1,386 raw findings / 256 distinct defects) + a 2-month forensic identified one disease with four faces: **nothing asserts a thing is actually reached** — built-but-never-called, fixed-in-one-door-shipped-from-another, confident-zero gates, failures that report success. Aman wants a fresh single-purpose audit-engine repo with zero-false-claim accuracy across ~10-15 sectors × sub-sectors × UK/EU/US/Middle East, a Rob master-agent build system, the 12 sweep tools + 10 new gates running continuously, caution.md (150-200 pointers re-checked per phase), restored mint speed (~3 parallel/45s), a converting report journey (download/share, better left rail + landing), and LLM usage that makes fabrication structurally impossible. SEO/GEO findings structure unchanged.

**Discovery correction that reshapes the work:** the engine at HEAD (v25.14) is far beyond the user's mental model. Already shipped and live-proven: the breach adjudicator (v23.0, FILTER-ONLY safety contract, dropped 2 false positives on mills-reeve live), the LLM gate (deterministic rubrics, escalating protocols, quorum), ICO register join (1.42M controllers), citation coverage 696/696 rules, DB-level engine-version gate, dead-link refusal (queue shows 0 done-without-page; the 1,004-phantom class is fixed), stage-manifest contract, DORMANT.md + reachability CI, one-door/domain-gate tooling (PR #342), crawl speed fix measured 43s→6.9s. **So the rebuild is a disciplined STRANGLER PORT of proven organs into a clean constitution-enforced skeleton — not a rewrite of logic that took 2 months of forensics to harden.** What gets left behind: the 480-unreviewed-PR sediment, the three rotten hotspot files (health 1.30-2.08), the agency/lead-gen entanglement, and every second door.

## 2. Discovery artifacts (inputs for execution — preserve first)

10 agent digests in scratchpad (`/private/tmp/claude-501/.../scratchpad/digest-*.md`) — **step 0 of execution copies them into the fresh repo `docs/discovery/`**:
findings-bible (all 1,386 findings; P0/P1 inventory; §13 dismissal verdicts) · plan-docs (6 planning docs) · arch-docs [file: digest-claude-ledger.md] (V1/V2/Spec/V3-bible/Integrity-500/Decision-Graph canon; Compliance Object Model; 300 V3 rules) · claude-ledger forensic [file: digest-engine-llm.md] (version timeline; 100+ caution pointers; speed history; LLM evolution) · engine pipeline map [file: digest-arch-docs.md] · LLM call-site audit [file: digest-engine-pipeline.md] · website-render audit · live-estate (Neon truth 2026-07-16) · research-compliance (16 sourced architecture lessons) · research-llm-agents (DO/DON'T table; 5 structural-impossibility patterns; 10 fleet rules). Plus fresh clones of both repos at scratchpad/engine + scratchpad/website (main @ 2026-07-14).

Key live-estate facts (Neon, 2026-07-16): audit_pages 26 rows (10 live); minting_queue 2,876 (2,858 paused / 8 held UK law firms / 7 done / 3 failed-refusing-dead-links); compliance_laws 187 / compliance_rules 696 (all cited) / framework_versions 300 / statute_chunks 908; leads 10,065 (7 with audit_url, all valid); engine_flags requires v25.14, minters on GH Actions + Oracle VM + Hetzner; verify-backlog job timing out 11×/day (why several live pages sit verified=false); slug pipeline still emits marketing-title slugs with HTML-entity leaks ("…-amp-body", "x27"). Render: contract `_contract.js` exists but is NOT enforced at runtime; HMAC is dead (8-char hash is the only gate); no PDF/share; £495 unlock veils.

## 3. The architecture (the simple shape)

Aman's instinct becomes the constitution: **laws are data with applicability tags; the engine is a chain of pure, individually-auditable functions Resolve → Classify → Apply → Detect; one producer per fact; the LLM selects and judges inside the catalogue's closed world, quotes verbatim or abstains.** (Externally validated: Ascent/Regology applicability matrices; Akoma-Ntoso/LegalRuleML citation-vs-rule two-layer modelling; OSCAL-vs-OPA spec/enforcement split; axe-core's violation/needs-review/pass + zero-false-positive doctrine; Cookiebot/OneTrust resource-fingerprinting + rendered-DOM detection; pentest finding-record norms; KYB corroboration-based entity resolution.)

```
LAW REGISTRY (Neon-authored; compiled, versioned, linted catalogue artifact)
 law = {id, citation(act/section/url), jurisdiction, sub_jurisdiction,
        sector[], sub_sector[], activity_tags(b2c, cookies, ads, ai, payments…),
        required_nexus, applies_when/excluded_when, elements[](element_checklist),
        penalty(typical band + statutory max + currency), regulator, enforcement[],
        provenance(source, last_synced) — never render a law without provenance}
        │  the ONLY source of law names, fines, regulators, citations
        ▼
URL → EVIDENCE (artifacts) → FACTS (one door each) → APPLICABILITY (pure fn) → BREACH (propose→verify→adjudicate) → PAYLOAD (shared contract) → RENDER (pure, word-by-word proven)
```

- **Evidence:** crawler (sitemap-parallel, policy-page-first, footer/PDF following, JS render; budget = CAP never floor); browser observation (pre/post-consent cookie diff [Consent-O-Matic], tracker calls vs EasyPrivacy, TCF-string self-evidence, Blacklight tests); registers (ICO daily ZIP, Companies House, GLEIF/OpenCorporates, SEC EDGAR, SRA, CQC, FCA); documents.
- **Facts (one producer each):** identity (register-first ladder: schema.org legalName/sameAs → og:site_name → register match → title → domain stem; generic-name reject; emits legal_name + company_number + registered_office; ≥2 corroborating identifiers for "confident"); jurisdiction (Tier A register/authorisation/registered-office=5 · Tier B office-postcode/local-phone/ccTLD-hreflang/currency=3 · Tier C prose=1; attach on 1×A or 2×B; Tier C never attaches; serves≠bound; graded KYB-style verdict with evidence chain); sector (canonical tree ported from registry/sector.js; LLM-gated classification + register cross-check); capabilities (evidence-backed predicates).
- **Breach:** regex/DOM/register CHECKS PROPOSE → deterministic artifact VERIFIES (verbatim quote string-matched to corpus; captured network event; register row; failing DOM node) → LLM ADJUDICATES (BREACH/NO_BREACH/INSUFFICIENT; filter-only; catalogue-constrained; gate-scored; quorum on P0/P1) → three output states à la axe-core: **violation / needs-review / pass** — nothing uncertain ever ships as "breach".
- **The 5 structural-impossibility LLM gates (research-validated, fail-closed AND-chain):** (1) retrieval-gated emission — cite only in-set sources, enforced by schema; (2) verbatim-quote exact re-match; (3) NLI-entailment per claim; (4) abstain-by-default confidence floor; (5) diverse jury with veto-to-reject. Fabricated citations/quotes get escape probability zero, not small. Plus: LLM never authors a fact — extraction/selection only; structured outputs enforced; temp-0 ≠ deterministic so log everything; golden set ≥60% from real production failures gates every prompt/model change.

Constitutional rules (mechanically enforced): one door per fact (blocking CI); catalogue-only fines/regulators/law-names (literal in code fails CI); no artifact no breach; every gate fails closed + is calibrated against a known-bad fixture; reachable-or-DORMANT; below-confidence → quarantine, never ship; a mint is done only when row + HTTP 200 + Playwright word-by-word truth pass; budgets are caps, never floors; every external step has a hard deadline; findings phrased as evidence-quoted factual observations + risk indicators ("detected X; this may implicate Act §Y (penalty band Z)"), never adjudicated legal conclusions, with a standing not-legal-advice line.

## 4. Fresh repo — DECIDED with Aman (2026-07-16)

**Aman's decisions:** (1) **Hybrid per-module** — Rob decides per module: PORT what is proven and healthy (adjudicator, llm/gate.js, register-check, sector tree, verify-payload V01-V15, citation-gate, coverage-contract, stage-manifest, one-door/domain-gate tooling, crawl parallelism fix); REWRITE what CodeScene marks rotten (build.js 1.76, compliance.js 2.08, _adapter.js 1.30 — the three hotspot files are rebuilt fresh as small single-purpose modules). (2) Repo **public** (keeps the tool fleet free). (3) LLM: **free-first** (NVIDIA NIM, Groq, Gemini, Cloudflare Workers AI), **Claude Haiku as paid backstop only if free provably degrades quality** — decided by benchmark on the reference set, quality is never compromised. (4) **Accuracy-first**: 3-5 min per audit is acceptable; the 45s target is retired in favour of correctness (crawl stays fast via E-236 parallelism; every external step keeps hard deadline caps). (5) **UK depth first**: UK legal → UK healthcare/aesthetics/dental → UK finance/real-estate/accounting, then widen jurisdictions cell-by-cell. (6) Claim policy: **punchier hybrid** — three-state machinery (violation/needs-review/pass) underneath; the confident "evidenced on your live site" voice is EARNED and reserved for register-verified facts and adjudicated findings with verbatim quotes; needs-review tier renders as observation language; standing not-legal-advice line. (7) Renderer seam: Aman delegated — decision below. (8) **Same Neon DB, new versioned catalogue tables** (additive-only respected; migrate + lint the 187 laws / 696 rules into catalogue_v2 with tags/provenance/versioning).

**Renderer seam (Rob's decision, deepest-accuracy option):** rendering stays deployed from tamazia-website (proven Cloudflare Pages pipeline), but the fresh engine repo owns the ENTIRE payload→render seam as one versioned npm package `@tamazia/audit-contract`: the payload JSON schema + the pure `payloadToD()` transform + the D_CONTRACT validator, tested together in the engine repo against every golden payload. The website imports the package and mounts it (route + shell + assets only); it re-derives NOTHING; the render route validates at runtime fail-closed. Any payload change and its transform change land in the same commit in the same repo — the 61% cross-repo coupling class becomes structurally impossible, and render bugs become engine-repo unit tests instead of production surprises.

```
tamazia-audit-engine/
  CONSTITUTION.md caution.md DORMANT.md docs/discovery/
  catalogue/   loaders + linters (regex-health, polarity, prohibition-calibration,
               citation-completeness, enforcement-crossval) + compiled artifact + versioning
  evidence/    crawler/ browser/ registers/ documents/
  facts/       identity.js jurisdiction.js sector.js capabilities.js
  applicability/  connect (pure; port resolver.js rigor) + conflicts + subjurisdiction
  breach/      proposers/ verifiers/ adjudicator/
  llm/         gate.js router.js prompts/(versioned) evals/
  payload/     schema (source of the shared contract package) composer/
  mint/        worker queue post-write-assertions
  render-proof/  Playwright truth lane
  eval/        golden/ calibration-known-bad/ reference-set/ mutation/
  tools/       sweep (SARIF fan-in, fingerprint dedupe, DSU clustering, ledger),
               one-door, fact-lineage, silent-swallow AST gate
```

## 5. Phases (exit gate for every phase: 12-tool sweep clean at ACT level (≥2-tool corroboration) · eval + golden + calibration green · caution.md synced by the warden · Rob's 3-external-validation review · Aman sign-off)

**P0 — Foundation (harness before engine).** Create repo; wire ALL tools into CI from commit 1; port tools/sweep from PR #342; seed caution.md (~170 pointers ready across the digests); build golden-audit + known-bad-calibration + reference-set harnesses; define shared contract package + publish to both repos; commit CONSTITUTION.md + Rob runbook (AGENTS.md); copy discovery digests into docs/.
**P1 — Facts.** Port + harden identity/jurisdiction/sector/capabilities as single-door modules (identity ladder incl. Companies House/GLEIF; Tier-matrix jurisdiction; sector tree + gated LLM + register cross-check; slug from resolved legal name — kills marketing-title slugs). Exit: 100% on the reference set (abstentions allowed, contradictions not).
**P2 — Catalogue.** Port Neon catalogue through linter suite; complete tag schema (incl. excluded_when turnover thresholds — the Modern-Slavery-on-SMEs class; B2B/B2C; sub_jurisdiction); element_checklist conversion for priority cells (28 UK legal rules first); catalogue compiler + version stamp; enforcement-intel population pipeline (human-gated, provenance-mandatory).
**P3 — Evidence + breach.** Port crawler with E-236 parallelism (6.9s measured) + coverage-contract; browser observation lane (the one unproven layer: PECR pre-consent diff — finish + prove in a minted payload); register binary checks; document element extraction; adjudicator + the 5 structural gates; three-state findings. Exit: reference-set breaches reproduced, zero false accusations, red-team fixtures all caught.
**P4 — Payload + render truth + journey.** Shared contract enforced both ends; renderer consumes payload only (delete re-derivation paths in _adapter.js); fix first-screen contradiction (headline math), category separation (statutory breach ≠ SEO metric), currency-by-binding-regime, three-number doctrine; left rail + landing redesign; evidence-left/fix-right; visual exposure waterfall + risk matrix + register-verified badges (link to gov sources); PDF download + share card (columns already exist); working per-recipient HMAC; kill filler fix-lines; SEO/GEO sections untouched structurally. Playwright word-by-word truth lane on every PR.
**P5 — Scale.** Cell-by-cell rollout UK-depth-first; LLM quota routing free-first (Cloudflare Workers AI 10k neurons/day leads + Groq 8B 500K TPD + gemini-2.5-flash-lite quorum + NVIDIA NIM), with a P5 benchmark on the reference set: free chain vs Haiku on adjudication precision/abstain-rate — Haiku added as paid backstop only if free measurably degrades quality (Aman's rule: no compromise on quality). Accuracy-first budget: 3-5 min/audit acceptable; crawl stays ~7s via ported parallelism; every external step capped with hard deadlines (caps never floors). Re-mint the paused 2,858-row queue through the new engine; monthly reference-set re-verification.
**P6 — Continuous truth.** Nightly gap-finder; weekly audit-of-the-audits; legislation.gov.uk /new/data.feed + EUR-Lex CELLAR + eCFR/Federal Register watchers; re-mint on version bumps; 24x7 sweep loop + ledger; fix verify-backlog timeout (the current 11×/day failure).

## 6. Rob — the agent operating system (per Anthropic orchestrator-worker guidance + Berkeley MAST failure taxonomy)

Rob = orchestrator; never writes engine code; decomposes every unit with a pre-committed machine-checkable acceptance spec; CI is the only arbiter of done; generator/critic/adversarial-verifier are always three distinct agents; handoffs are validated artifacts (diff + passing test + conformance report), never raw context; every loop has hard termination conditions; least-privilege tools per role; full trace logging; the fleet itself is regression-gated on the golden set; Rob delivers no verdict until 3 independent validations agree (tool evidence / reproduced run / external source).

Specialists: Scout (read-only, old repos) · Catalogue · Facts · Evidence · Adjudication · Render/Journey · Red team (tries to make the engine fabricate; every gate must catch it) · **Tool warden (24x7: runs the sweep loop, maintains the ledger, blocks all progress while ACT findings are open — work stops if the tools stop)** · **Caution warden (owns caution.md; walks every phase diff against all pointers; any repeat = phase fails)** · Research (3-source external validation) · Speed (per-stage latency budget report).

## 7. Tools: the 12 continuous + 10 new

Continuous (per-PR + nightly + weekly deep): CodeQL · Semgrep OSS · Semgrep cloud · CodeRabbit (+#335 custom bug-class rules) · CodeScene (project 82581; add fresh repo; PR gate stays) · madge · jscpd · dependency-cruiser · ESLint (no-undef/no-use-before-define) · one-door · domain gates · Playwright render lane. SARIF fan-in → fingerprint dedupe → DSU cross-tool clustering → numbered ledger; ACT = ≥2 tools; single-tool = lead, never auto-fixed. (Greptile: do not pay. Korbit: trial only. Copilot seat: Aman's call.)

New: (1) golden-audit regression harness per cell; (2) render truth-pack (word-by-word payload match + no non-catalogue fine/regulator/law-title); (3) catalogue linter suite as blocking CI; (4) known-bad calibration corpus — every analyser must fail on seeded bad input each run; (5) one-door as blocking gate; (6) fact-lineage tracer (single producer asserted in CI; renderer introduces no facts); (7) Stryker mutation thresholds on scanner/adjudicator/verify; (8) silent-swallow AST gate repo-wide; (9) LLM adjudication eval harness (versioned prompts vs fixture corpus with known verdicts; precision + abstain-rate gates); (10) mint reality reconciler (row + 200 + truth-pack; scheduled queue-vs-pages-vs-leads diff).

## 8. caution.md

150-200 pointers, "what went wrong → the rule that prevents it", grouped: resolution, crawl, applicability, exposure, consistency, LLM, gates, render, data, process. Seeds ready: claude-ledger forensic digest (~100 deduplicated), 9-audit failure catalogue A1-G3, findings-bible classes, DORMANT lessons, edit-plan lessons ("read the live payload before trusting the plan"), the 5 earned rules, live-estate flags. Caution warden syncs post-phase; repeats fail the phase.

## 9. Verification

Reference set (hand-verified expectations for ~27+ real firms: the 9 forensic audits + 10-domain watch list + 8-firm legal/health matrix + Aman's additions) — engine must match or abstain, never contradict; golden + calibration in CI; Playwright truth lane; red-team fabrication fixtures; LLM eval harness; speed budget report per mint; live URL assertions. The browser, not the JSON, defines "shipped".

## 10. Question list for Aman

**Answered 2026-07-16 (interactive):** (1) hybrid per-module port/rewrite; (2) public repo; (3) free-first LLM, Haiku backstop only if benchmarks show free degrades quality; (4) accuracy-first, 3-5 min OK; (5) UK depth first; (6) punchier hybrid claim policy (earned confident voice on verified findings, three-state underneath); (7) renderer seam delegated → engine-owned `@tamazia/audit-contract` package (schema + payloadToD + validator), website mounts it; (8) same Neon, new versioned catalogue tables.

**Remaining — answer before/while executing (defaults proposed, Rob proceeds on defaults unless overridden):**
(9) Exact sector/sub-sector list to commit to — default: the ~24-parent canonical tree, UK priority order legal → healthcare (incl. aesthetics/dental/pharmacy/care-homes) → finance → real-estate → accounting → hospitality → education → ecommerce/retail → charity → marketing.
(10) US states priority — default CA/NY/TX/FL/IL; state privacy law attaches only on observable nexus evidence, else renders in an "advisory / potentially applicable" tier.
(11) EU member states priority — default DE/FR/NL/IE/ES.
(12) Gulf honest-frontier sign-off — hand-curated conservative rules, explicit confidence labels, never assert breaches of provisions whose executive regulations are unissued. Default: yes.
(13) English-only gate stays for v1 — default yes (non-English sites quarantine honestly).
(14) B2B consumer-law suppression default — default yes (consumer law needs B2C evidence).
(15) Name display: legal name in identity block, trading name in headlines — default yes.
(16) Currency doctrine: each regime's fine in its statutory currency, home-currency total with stated basis, no invented FX — default yes.
(17) Reference-set additions beyond the 27 proposed firms (9 forensic + 10 watch + 8 matrix) — send any specific targets.
(18) PDF download + share card — default: build in P4 (columns already exist).
(19) Per-recipient HMAC enforcement + superseded pages redirect-to-latest — default yes/redirect.
(20) £495 unlock + pricing surfaces — default: keep mechanics, restyle only.
(21) PR #342 merge into cowork-os (sweep tooling), #343 stays open as review vehicle — default yes.
(22) After port: audit-path modules in cowork-os frozen (CODEOWNERS + CI guard pointing to new repo); agency pipeline untouched — default yes.
(23) Paused 2,858-row queue: stays paused until the new engine passes P3 exit, then re-mint through it — default yes.
(24) Tools money: CodeScene free tier first, Korbit trial only, no Copilot seat — default yes.
(25) Phase-exit sign-off: Aman signs each phase; caution.md reviewed by Aman monthly — default yes.
(26) Telegram phase reports — default yes (bot exists).
(27) "100%" definition sign-off: zero false claims + honest abstention + coverage disclosure (not maximal finding counts) — default yes.
(28) SEND stays OFF throughout; flipping it is founder-only — default yes.
(29) Combined monthly ceiling for paid tools+LLM backstop — default $100 alert threshold.
(30) Fresh repo name — default `Tamaziaa/tamazia-audit-engine`.
