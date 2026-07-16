# Tamazia Audit Engine — Consolidated Digest of Six Documents

## Orientation

These six documents describe one system: the **Tamazia compliance audit engine**, which crawls a professional-services firm's website (law firms, healthcare/clinics, etc.), matches it against a catalogue of legal obligations, decides which laws bind the firm, detects breaches, attaches fines, and mints a client-facing audit page. Two public GitHub repos hold it: `Tamaziaa/tamazia-cowork-os` (the engine — 341 PRs) and `Tamaziaa/tamazia-website` (the renderer — 184 PRs), 525 PRs total. The documents span 12–14 July 2026 and fall into two waves: a **12 July accuracy/completion pair** (what the engine gets right and wrong, and what was fixed in v23.1) and a **14 July tooling/planning trio plus a generated ledger** (a full static-analysis sweep of the codebase and a scoped edit plan). The user email context (realfamemedia@gmail.com) and today's date (2026-07-16) are not load-bearing here.

---

## PER-DOCUMENT DIGESTS

### 1. AUDIT-ENGINE-FINDINGS-LEDGER.md (generated 2026-07-14)

**Purpose.** The single machine-generated exit point of the full-estate tool sweep. Header explicitly says "do not hand-edit; regenerate with `node tools/sweep/ledger.js`." It ranks every static-analysis finding by corroboration.

**The gate (its governing rule).** `ACT` = two or more independent tools agree (a fact, fix it). `REVIEW` = one tool only (a lead, never auto-fixed). Justification given: Greptile found 2 issues where CodeRabbit found 51 on the same diff, so a lone finding is noise.

**The numbers.** 318 raw findings ingested → 281 after fingerprint dedupe → 206 distinct clustered defects. Of those, **only 6 are ACT (≥2 tools)**; 200 are REVIEW. By tool: coderabbitai 119, Semgrep OSS 78, one-door 36, CodeQL 27, dependency-cruiser 14, jscpd 4, greptile-apps 3. By clustered severity: P0 78, P1 101, P2 27, P3 0.

**Key findings (the 6 ACT items, all OPEN, all fix = _TBD_):**
- **F-0001 · P0 · ×3** (CodeQL, coderabbitai, one-door) — `src/skills/S025-audit-page-builder/scripts/build.js:1270`: make mandatory audit gates fail closed. This cluster aggregates a huge number of coderabbit sub-findings: jurisdiction stage marked `ran` unconditionally (can never fail), `llmPreflight()` not failing closed, module-scope `_WARN` singleton never reset between builds (so persisted warning counts are wrong for every audit after the first), payload uploaded to R2 before gates run, `firm_identity` stage reading `comp.firm_profile` instead of resolver output. one-door flags it as a "two doors" multiple-producer defect for REGULATOR NAME (5 producers), JURISDICTION→FAMILY (5), ELEMENT-CHECKLIST (2).
- **F-0002 · P0 · ×2** (coderabbitai, one-door) — `S008-personalisation-engine/scanners/compliance.js:1218`: keep `_N2C` aligned with `detectMarkets().bound`; per-scan warning state; multiple two-doors producers (sector normalisation 6, host anchoring 8, jurisdiction nexus 5).
- **F-0003 · P0 · ×2** — `src/lib/audit/payload-schema.js:51`: anchor the engine-version format; enforce the draft gate.
- **F-0004 · P0 · ×2** — `src/lib/util/url-safe.js:68`: parse inputs before comparing hosts; keep `^` anchor on scheme strip.
- **F-0005 · P0 · ×2** — `src/lib/compliance/signals.js:155`: freeze `NEXUS_PROFILE` before export; "protected compliance library change needs Aman sign-off."
- **F-0079 · P1 · ×2** (CodeQL, greptile-apps) — `src/lib/enrich/lead-quality.js:521`: persisted socials bypass anchor.

**REVIEW bucket (200 items, F-0006–F-0206).** Dominated by: coderabbitai workflow/eval-test findings (credential persistence in `.github/workflows/*`, `npm ci` fallbacks, secret-mutation flags needing "Aman" sign-off, tests that assert source text rather than behaviour); Semgrep OSS ReDoS warnings on `RegExp()` called with function args (dozens, concentrated in `compliance.js`, `rank-insight.js`, `markets.js`, feeds), path-traversal `path.join/resolve` warnings, http-instead-of-https, `urllib` file:// scheme in `mcp/tamazia-ops/server.py`, SQL string concatenation in `ops/infra/hetzner-verify.js`, curl-piped-to-bash in `ops/infra/setup.sh`; one-door two-doors entries for each producer file; dependency-cruiser circular deps (mostly in node_modules) and orphan modules (`S052-gdpr-request-handler/handle.js`, `applicability.js`, `obligations.js`, `subjurisdiction.js`, `timezone-router.js`, `mystrika/client.js`); jscpd clones; CodeQL unused-variable findings in `website/dist/audit/audit-app.js`.

**Proposed vs executed / open.** The ledger is a status board — every ACT fix is `_TBD`/`OPEN`. Nothing in this document is executed; it is the input queue for the change plans below.

---

### 2. AUDIT-ENGINE-FULL-TOOL-SWEEP-PLAN.md (14 July)

**Purpose.** The design of the sweep that produced the ledger — "every tool, every repo, one entry point, one exit point."

**Key decisions.**
- **Tool triage (verified, not assumed).** Worth running: CodeQL (£0 public), Semgrep OSS + Semgrep cloud (£0 OSS tier), CodeRabbit (already paid Pro Plus, strongest), CodeScene (git history/hotspots/change coupling, free OSS tier), Korbit AI (14-day trial), GitHub Copilot review (needs seat). Miscategorised: Playwright (belongs in render lane, not code-review), ForgeDock (prompt specs running inside Claude Code — "it is me, in a wrapper" — violates the "no Claude, tools only" constraint, rejected). Could-not-verify: BugFixer AI, ProductLens, Revibe Codes (not on Marketplace). **Greptile: settled, do not pay** (credit-blocked; 2 vs CodeRabbit's 51).
- **The cost-collapsing insight.** Do NOT replay 525 PRs. Whole-tree analysers (CodeQL, Semgrep) run **once on `main`**. Diff-based AI reviewers get **one synthetic PR**: `git checkout --orphan full-sweep-base`, `git rm -rf .`, empty commit, push, then open `main → full-sweep-base` so the diff is the entire repo (all 428 files reviewed as "new code" in one pass). History analysis is CodeScene-only.
- **Architecture — one entry, one exit.** Fan-out (parallel) → every tool emits or is adapted to **SARIF** (the lingua franca) → NORMALISE → FINGERPRINT → DEDUPE → CLUSTER → single exit: `findings` Neon table → `AUDIT-ENGINE-FINDINGS-LEDGER.md` + GitHub code scanning + one CI gate.
- **Algorithm.** Canonical `Finding` record fingerprinted as `SHA256(normalise(path) ‖ rule_id ‖ SHA256(strip_ws(snippet)))` — **never on line number** (lines shift, defect doesn't; SARIF `partialFingerprints`). Hash-map dedupe O(1). Cross-tool clustering via **Union-Find (DSU, path compression + union by rank)**: union iff same path AND overlapping/within-N-lines regions AND matching semantic category. `corroboration = distinct tools in cluster`. Stable numbering: sort by (severity DESC, corroboration DESC, fingerprint ASC) → F-0001… deterministic.
- **Honest "no" on SIMD and e-graphs.** The rule sweep is 847 ms out of a 720,000 ms build budget (~0.1%) — I/O and LLM bound, so SIMD optimises the free part. E-graphs solve expression-tree rewriting; there is no expression tree here. The *real* underlying goal is "one producer per fact" — the **two-doors disease**, measured as 8 facts with more than one producer (HOST anchoring 8 files, SECTOR 6, JURISDICTION→FAMILY 5, JURISDICTION NEXUS 5, REGULATOR NAME 5, FINE AMOUNT 4, LAW TITLE 2, ELEMENT-CHECKLIST 2). jscpd can't see this — the duplication is semantic.
- **Render lane.** Playwright mints 4 cells (UK/US × legal/healthcare), expands every collapsible, asserts every rendered claim exists verbatim in `payload_json` and that no fine/regulator/law appears that isn't in the catalogue; fails the build on divergence. Closes #20/#22/#23.

**Executed vs open.** This is a plan; the ledger shows the sweep actually ran (318 findings ingested). Order of execution (§9): install apps → fan-out on main → synthetic PR → ingest/cluster → fix in corroboration order → Playwright render-proof → loop until ledger empty. Steps 5–7 are not yet done (ledger is full of OPEN items).

---

### 3. AUDIT-ENGINE-CHANGE-PLAN-2026-07-14.md

**Purpose.** A scoped change plan grounded in the live code, mapping 96 defects (E01–E56 audit-side, W01–W40 website-side) to what the user authorised.

**Part 0 — how the pipeline actually works (9 stages):** `mint-worker.js` claims a `minting_queue` row (concurrency 1, 12-min budget) → `S025-audit-page-builder/build.js buildPayload()` orchestrates → `site-scan.js` crawls → `markets.js detectMarkets()` infers markets (weight ≥3 = strong) → `compliance.js scan()` gates each framework on jurisdiction × sector × nexus × capability × trigger then `ruleCheck()` → `breach-adjudicator.js` (LLM) reviews text-derived findings (browser/register facts bypass) → `llm-verify.js` cross-verifies attached law (no `llm_verify` → DB trigger rejects) → Neon `audit_pages` → website is a **pure client-side renderer** (`_adapter.js payloadToD()` → `audit-app.js`). Governing consequence: every defect is either a **generator** defect or a **render** defect; fixing the wrong layer only looks like a fix.

**Four root causes.**
- **RC-1 (firm name, GENERATOR).** No firm-name resolver; name derived from domain stem in **7 call sites** (`domain.replace(/^www\./,'').split('.')[0]`) — the origin of "Kingsleynapley" and "Bristol Office." A renderer guard (NAME-01) was shipped yesterday as a symptom patch. Real fix: new `src/lib/audit/firm-identity.js` with a resolution ladder (schema.org Organization JSON-LD → og:site_name → Companies House API → `<title>` → domain stem), rejecting generic tokens, emitting `firm_profile.display_name/legal_name/company_number/registered_office`.
- **RC-2 (jurisdiction, GENERATOR).** `detectMarkets()` single threshold (weight ≥3) produced a phantom UAE market for London-only Kingsley Napley (E17). Fix: a tiered signal matrix (Tier A dispositive =5, Tier B strong =3, Tier C weak =1); a jurisdiction attaches only on one Tier-A or two independent Tier-B signals; Tier-C never attaches alone; `serves` (marketing reach) and `bound` (legal nexus) become separate fields (learned via E-228).
- **RC-3 (currency, RENDERER).** `_adapter.js moneySymbol()` supports only £ and $. Fix: currency follows the **binding jurisdiction of the fine** (UK→£, EU→€, US→$, UAE/DIFC/ADGM→AED/$/$, Saudi→SAR, Qatar→QAR); **no FX conversion** — quote each regime in its statutory currency.
- **RC-4 (framework counts, BOTH).** `_adapter.js:2309` sets `frameworksTotal = frameworks.length = frameworksBinding`, erasing the screening story ("15 screened · 15 bind"). Fix: three-number doctrine — `catalogueSize` (real register count, ~403 rules/~295 frameworks, read from DB not guessed), `frameworksBinding`, `rulesChecked`.

**Scope.** DO list covers ~40 items (E01–E56 + NEW-1..4) each tagged Generator/Renderer/Catalogue/Both — including legal errors flagged: **E26 (SRA Transparency Rules do not cover personal injury), E27 (SRA fining limit is £25k, not £2.6M), E36 (invented "£25,000+ consultancy quote")**. SKIP list: E15 (thum.io), E21, E25, E38, E39, all retainer/mandate prices, W04/W05/W06/W13/W20, testimonials. NEEDS-YOUR-CALL: money and garbled instructions deferred to questions.

**Method / standing rules.** Research-mode web verification required before writing (SRA Transparency in-scope list, SRA fining limit, DIFC/ADGM currency, Companies House API, SCCO hourly rates — "no number goes into a legal document from memory"); Semgrep+CodeQL+Greptile before/during/after; every change behind a test that makes the defect impossible; both surfaces changed in the same commit when a price/promise appears on both.

**Executed vs open.** Only the NAME-01 renderer guard is described as already shipped. Everything else is proposed.

---

### 4. AUDIT-ENGINE-EDIT-PLAN-VETTED-2026-07-14.md

**Purpose.** A confidence-measured edit plan; every edit traced to blast radius. Vets: V1 ESLint, V2 eval suite (85 gates, incl. a smoke test that executes `buildPayload()`), V3 Stryker mutation (100%), V4 CodeQL+Semgrep, V5 CodeRabbit. Only 100%-confidence edits carry all five and are "ready."

**Items and status.**
- **#1 Corpus truncation — SHIPPED, PR #336, 100%.** `site-scan.js:88` cut the corpus at 4,000 chars (~600 words), so all footer disclosures (SRA authorisation, company number, registered office, VAT) sat past the cut and ABSENCE rules fired false accusations. Measured: russell-cooke's `SRA` string is at char 11,080; birketts had 15/18 findings as ABSENCE claims from a 3-page/4,000-char corpus on a site that 403s every legal URL. Fix: cap raised to 200,000 (`CORPUS_MAX_CHARS` env-overridable) + interlock — if truncation ever occurs, "it is missing" is demoted to NEEDS_REVIEW. All five vets pass.
- **#2 citation-gate.js — 60%, DO NOT WIRE.** `verifyCitations()` is safe (95%, 0 violations on Birketts). `gateMint()` is broken: keys violations by framework, not finding, so one uncited PECR rule deletes every PECR finding (proven runnable case: expected drop R6.2 only → actually dropped the fully-cited R6.1). A landmine. Must key by `rule_id` first.
- **#3 coverage-contract.js — 70%.** Correctly computes `screened` for Birketts (only 3 pages crawled, privacy policy never fetched). `applyCoverage()` is a no-op — filters on `f.status` but pointers use `state`. Reveals the deeper **crawl-breadth** bug. Wire only the reporting, not `applyCoverage()`.
- **#4 reachability gate — 90%, highest leverage (~40 lines).** Nine modules dead in production: citation-gate, coverage-contract, evidence-ledger, gap-finder, applicability, obligations, **subjurisdiction (134 US state rules that can never attach)**, vocab, engine-bridge — 554 lines of tested legal logic never run. Gate: every module under audit/compliance/evidence must be reachable from build.js or listed in a DORMANT manifest with reason+owner, else CI fails.
- **#5 1,004 phantom audits — CRITICAL, data not code.** Queue says 1,034 done; `audit_pages` has 17 rows; 1,004 "done" audits have no page; **412 lead records carry an audit URL returning HTTP 404** (curled). Only `mystrika_pushed=0`/`channel_email_ready=0` prevented sending. Fix: (1) post-write assertion — done only if row exists AND URL returns 200; (2) purge the 412 poisoned `leads.audit_url` values — **needs explicit go-ahead** (writes to lead records).
- **#6 165 silent swallows — 95%.** build.js/compliance.js are clean; 165 bare catches remain across src/. AST gate is mechanical.
- **The other six (not ready):** #7 evidence-ledger 65%, #8 US state law 40% (subjurisdiction has no consumer), #9 nightly gap-finder 80%, #10 mutation-test the scanner 85%, #11 golden-audit regression 90% (blocked on corpus fix), #12 retire enforcement-map 75%.

**Shipped today:** PR #336 (only 100% edit). Also open: #334 (mutation 100%), #335 (CodeRabbit domain rules). Stated lesson/correction: yesterday's advice that citation-gate was "30 lines, just wire it" was wrong — wiring as-is would have silently deleted valid findings. "Read the live payload before you trust the plan."

---

### 5. Tamazia_Audit_Engine_Accuracy_Review_2026_07_12.md

**Purpose.** An accuracy review answering the user's questions, every number queried from live Neon or read from shipped code.

**The one finding that matters:** "The LLM never sees a single breach." Every breach Tamazia ever sent is a **regex matched against crawled HTML, unreviewed by any model** — the root of the fabricated hacking accusation.

**Per-stage verdicts (this is the accuracy review the synthesis asks for — see below).**

**How breaches are checked (`ruleCheck()`, compliance.js:666):** four styles — conditional/trigger_then_check (570 rules), presence/must_appear (76), absence/prohibit (9), element_checklist (6), null (3). The richest style (element_checklist, produces per-element findings with quotes) is used by 6 of 664 rules; 99% of the catalogue is a single binary regex. Regex physically cannot read meaning, cannot see behaviour (cookies before consent, tracker calls, session-replay — where real PECR/GDPR breaches live), cannot handle negation/homonyms (the "sex discrimination"/`<slot>`/"pornography offences" false hacking match). Proposed foolproof architecture: **regex proposes → deterministic evidence verifies (no artefact, no breach) → LLM adjudicates → only evidenced adjudicated breaches emit.**

**Jurisdiction readiness scores (§7).** LEGAL: UK 7.5/10 (only genuinely sendable cell), EU 3/10, US 2.5/10 (no state bar advertising rules — *the* US regime), UAE 2/10, Saudi/Qatar 1/10. HEALTHCARE: UK 7/10, UAE 4.5/10 (strongest Gulf cell), EU 3.5/10, US 2.5/10 (35 rules "dangerous, not merely thin"), Saudi/Qatar 1/10. The honest Gulf note: no machine-readable law for UAE/Saudi/Qatar; UAE PDPL Executive Regulations still not issued, so asserting breach of provisions whose implementing regulations don't exist is fabrication (the Al Tamimi incident class). Keep Gulf hand-curated and lower-confidence.

**Under-utilisation (§6):** RAG layer (`statute-rag.js`) built, required by engine-bridge, never called by a mint; 27% of rules (180/664) have no statutory citation (dead weight); 22% (149/664) have no enforcement band. Recommended inversion: today LLM classifies + catalogue judges (backwards); it should be catalogue constrains (the closed world / moat) + LLM judges.

**Ten things not being seen (§8):** ICO Register of Data Controllers (free daily 76MB ZIP, binary evidenced breach) unused; page never loaded, only HTML read (Hetzner Playwright renderer does crawl-render only); pre/post-consent cookie diff missing; SRA API unused; statute-rag unwired; element_checklist under-used; 84% of frameworks (243 of 291) render without curated intel; legislation.gov.uk `/new/data.feed` unwatched; one accessibility engine (axe only); mint concurrency group silently serialises batches (3 of 4 dispatched workers cancelled).

**§9 resources:** Tier-1 accuracy repos (ICO Register OGL, EDPB Website Auditing Tool EUPL, CookieBlock MIT ~304k labelled cookies, Open Cookie Database Apache-2.0, EasyPrivacy CC BY-SA limb, Consent-O-Matic, Blacklight collector GPL, IAB TCF, IBM equal-access, OpenWPM); Tier-2 primary legal sources (legislation.gov.uk — gotcha: HTTP 202 empty body while generating, must poll; EUR-Lex CELLAR SPARQL; eCFR/Federal Register; Companies House API "the join key" free; SRA API; CQC Syndication now requires a key; FCA Register; eyecite). Licence traps to avoid: DuckDuckGo Tracker Radar, Ghostery TrackerDB, cookiedatabase.org (all NonCommercial), LexNLP (AGPL-3.0), OPP-115, CMS GDPR Enforcement Tracker, Blackstone (dormant).

**Recommended build order:** breach adjudication gate → ICO+Companies House join → cookie evidence via Hetzner → convert 28 UK legal rules to element_checklist → wire statute-rag → SRA API → populate framework intel → then expand jurisdictions. Warning: `ENGINE_VERSION` gates `scanner_cache`/idempotency; none of these appear in a re-mint until it's bumped, and the failure is silent-reports-success. Verify in Chrome, not in JSON.

**Executed vs open.** This document is diagnosis only — it proposes; the Completion Report below records what was then executed.

---

### 6. Tamazia_v23_Completion_Report_2026_07_12.md (v23.1)

**Purpose.** Item-by-item record of what was actually built the same day, with ✅/⚠️/❌ status.

**The lost law (§1).** Three law assets sat in Neon and reached zero audits: `compliance_laws` orphans (79, 0 files), `framework_candidates` (151), `statute_chunks` RAG corpus (908 chunks/366 laws, never called), `law_obligations` (51, 0 files). Cause: `UNIVERSAL_FW` derived from `BASELINE_BY_FAMILY` alone; `fwSectorOK()` drops any framework with empty `sector_relevance` unless in `UNIVERSAL_FW` — so the Electronic Commerce (EC Directive) Regulations 2002 reached zero clients. Fix (E-254, PR #290): promoted four laws as element_checklist (UK_ECOMMERCE_2002, UK_LEGAL_SERVICES_2007, DE_IMPRESSUM, FR_LCEN); russell-cooke went 15→16 frameworks. Invariant added: every baseline law must be in UNIVERSAL_FW. **The 151 candidates were largely fabricated with fake citations** — e.g. a non-existent "Cookies…Regulations 2020" with three invented legislation.gov.uk URLs; the repealed Disability Discrimination Act 1995; Telecoms Security Act 2021 attached to hospitality. Full run: 3 verified (all duplicates of held law), 4 provably wrong law, 17 unverifiable, 127 no citation — **zero new promotable law**. E-229's URL gate only checked a string was present, never fetched it.

**LLM and breaches (§2).** ✅ breach-adjudicator.js added (E-253, PR #289) — regex proposes, model adjudicates, filter-only (can remove/downgrade, never invent; no LLM = nothing removed, but high-risk P0/prohibit findings demoted to NEEDS_REVIEW). ✅ grounded in actual statute via statute-rag (E-255, PR #291). ✅ verdict was dying at the findings→pointers whitelist seam (E-253b, PR #292). ✅ adjudication report now a first-class payload field (E-253c). ✅ shown to client with honesty guard (E-253d, PR #164) — line doesn't render if no model reviewed.

**Cache (§3).** ✅ deleted entirely (E-252, PR #289); it failed silently-reporting-success three times (fixes replayed old scans; stale idem_key; day-old scan dated today). `eval/no-cache-e252.test.js` locks it.

**Sector (§4).** ✅ E-250 was half-applied (ran after connect() and rule selection) so Kingsley Napley checked against accountancy rules; now the authorisation statement decides sector before connect() (E-250b, PR #289).

**Corrections owed (§5).** ❌ was wrong about mint concurrency — `mint-now` drains the whole queue with `MINT_CONCURRENCY:3`; cancelled runs were redundant duplicate dispatches, not killed workers; the cap is deliberate (free-tier LLMs 429 under load: 71 failures to 1 success), left alone. ⚠️ the v23.1 remint was still draining at writing.

**Genuinely not done (§6).** ❌ Tier-1 evidence repos not built (ICO+Companies House join, pre/post-consent cookie diff, EasyPrivacy, CookieBlock, Blacklight) — "single biggest remaining accuracy gap." ❌ US legal 5 rules / EU legal 2. ❌ healthcare sub-sectors missing (pharmacy, optometry, care homes, veterinary, mental health). ❌ 84% of frameworks still no curated intel.

**Scorecard:** 67 checks across 9 suites, all green. Merged: engine #289/#290/#291/#292, website #164. `ENGINE_VERSION: v23.1-2026-07-adjudicated-seam`.

---

## SYNTHESIS

### (a) The exact tools in the sweep, and how each is configured/run

The sweep code lives in the engine repo under **`tools/sweep/`** (confirmed by ledger findings on `tools/sweep/collect-local.js:23/44/59/127/154` and by the ledger header's regenerate command `node tools/sweep/ledger.js`). The architecture is fan-out → SARIF → normalise/fingerprint/dedupe/cluster → Neon `findings` table → ledger. The tools that actually contributed findings (per the ledger's "By tool" table) plus those specified in the sweep plan:

1. **CodeQL** — whole-tree semantic dataflow/taint analyser. Run **once on `main` @ HEAD**, not per-PR. Emits SARIF natively; £0 on public repos. Contributed 27 findings (e.g., `js/file-access-to-http`, `js/unneeded-defensive-code`, useless assignments).
2. **Semgrep OSS** — pattern/secrets/OWASP rules. Run once on main, native SARIF, £0. Largest volume after CodeRabbit: 78 findings (ReDoS on dynamic `RegExp()`, path-traversal, http-not-https, urllib file://, SQL concat, curl|bash).
3. **Semgrep cloud** — managed rulesets/supply chain, £0 OSS tier (listed in plan; folded into the Semgrep lane).
4. **CodeRabbit** (Pro Plus, assertive) — diff-based cross-file AI reviewer. Run via **one synthetic full-tree PR**: `git checkout --orphan full-sweep-base && git rm -rf . && git commit --allow-empty && git push`, then open `main → full-sweep-base` so all 428 files review as "new." Comments adapted to SARIF via a ~40-line adapter. Strongest tool; 119 findings. Config file `.coderabbit.yaml` (itself flagged: F-0064 "move tools under reviews," F-0117).
5. **one-door detector** — a **local, domain-specific** analyser (in `tools/sweep/`) detecting "two doors" / multiple-producer defects (a fact with >1 producer file). Run in the local sweep lane. 36 findings; the source of every JURISDICTION/SECTOR/HOST/REGULATOR/FINE multiple-producer entry. Has its own eval `eval/one-door.test.js`.
6. **dependency-cruiser** — circular-dependency and orphan-module detector, local lane, £0 (already running). 14 findings.
7. **jscpd** — copy-paste/clone detector, local lane, £0. 4 findings (21–26 line clones).
8. **greptile-apps** — diff-based AI reviewer, GitHub App. **Explicitly settled as "do not pay"** (credit-blocked, 2 vs CodeRabbit's 51) but 3 findings still ingested.
9. **madge** — reachability/dead-module analyser, local lane (named in the sweep architecture; found 13 modules/691 lines unreachable). 
10. **ESLint** (`no-undef`, `no-use-before-define`) — local lane, caught 2 mint-killing bugs (per the vetted plan's V1).

Tools **triaged out**: Playwright (moved to the render-proof lane, not code-review — mints 4 UK/US×legal/healthcare cells, expands collapsibles, asserts rendered claims match payload verbatim, fails build on divergence); ForgeDock (rejected — Claude-in-a-wrapper, violates tools-only); CodeScene, Korbit AI, GitHub Copilot review (planned but require install/OAuth/seat — not yet run; Order §9 step 1 blocks on the user clicking approve); BugFixer AI / ProductLens / Revibe Codes (unverifiable, excluded).

### (b) The accuracy review's verdict per pipeline stage

- **Name (firm identity):** Broken/generator. No resolver; derived from domain stem in 7 sites → "Kingsleynapley," "Bristol Office." (Change plan RC-1; firm-identity.js proposed. F-0001 flags `firm_identity` stage reading the wrong field.)
- **Jurisdiction:** Broken/generator. Single weight-≥3 threshold produced phantom UAE (E17). Fix = tiered signal matrix, separate `serves` vs `bound`. Readiness: UK legal only genuinely sendable; Gulf must stay hand-curated (implementing regulations don't exist — asserting breach is fabrication).
- **Sector:** Was half-fixed (E-250) then corrected (E-250b) — authorisation statement now decides sector before connect(); previously KN was audited against accountancy rules. Scored well in healthcare, thin in US/EU/Gulf legal.
- **Law attachment:** Partially LLM-verified (`llm-verify.js` checks *which* laws attach, quorum for priority ICP). But the "self-learning" law-discovery loop was inventing statutes with fake citations (151 candidates, zero promotable). The `UNIVERSAL_FW`/`fwSectorOK()` gate silently dropped valid baseline laws (fixed E-254). RAG grounding (statute-rag) was built but unwired until E-255.
- **Breach detection:** The core failure. Pure regex (`ruleCheck()`), 570/664 rules a single binary conditional regex; only 6 use element_checklist; the LLM never saw a breach until v23.1's breach-adjudicator (E-253). Regex cannot read meaning, see behaviour, or handle negation (the hacking false positive). Verdict: not defensible without adjudication + deterministic evidence.
- **Fines:** 22% of rules have no enforcement band; FINE AMOUNT has 4 producers (two-doors); documented history of a "GBP 17.5M fine that never reached the client" and the "£17.5M fix" that didn't land; legal errors E27 (SRA £25k not £2.6M) and E36 (invented £25,000+ quote). Currency broken (£/$ only) — RC-3.
- **Rendering:** Website is a pure client-side renderer; a JSON check has never proved a render is correct (hence the Playwright render lane). Framework counts erased the screening story (RC-4); truncation, plurals, empty CTA hrefs, duplicate glossary keys, unstyled right panel (E-series renderer defects).

### (c) Every unfinished / deferred item across the plans

From the **vetted edit plan**: citation-gate gateMint (60%, blocked on rule_id keying), coverage-contract applyCoverage (70%, field mismatch state vs status), reachability gate (90%, must decide fate of 9 dead modules), the **412-lead audit_url purge** (needs explicit go-ahead), 165 silent swallows triage (95%), evidence-ledger wiring (65%), US state law/subjurisdiction (40%, no consumer), nightly gap-finder (80%), scanner mutation-testing (85%), golden-audit suite (90%, blocked on corpus fix), retire enforcement-map (75%). From the **change plan**: all E/W DO items except the shipped NAME-01 guard remain unimplemented; NEEDS-YOUR-CALL money/garbled-instruction questions unresolved. From the **completion report §6**: Tier-1 evidence repos not built (ICO+CH join, cookie diff, EasyPrivacy, CookieBlock, Blacklight), US legal (5) / EU legal (2) depth, healthcare sub-sectors (pharmacy/optometry/care homes/veterinary/mental health), 84% frameworks without curated intel; v23.1 remint still draining. From the **accuracy review**: SRA API, ICO Register, legislation.gov.uk feed watcher, second accessibility engine, framework-intel population. From the **sweep plan §9**: install CodeScene/Korbit/Copilot, run the fan-out/synthetic-PR/cluster/fix loop and Playwright render-proof — and every one of the 6 ACT + 200 REVIEW ledger findings is OPEN with fix `_TBD`.

### (d) Contradictions between documents

1. **Mint concurrency.** Accuracy review §8.10 asserts "the mint workflow has a concurrency group that silently serialises every batch… three [workers] were cancelled." The completion report §5.1 explicitly **retracts** this: `mint-now` drains the whole queue with `MINT_CONCURRENCY:3`; cancelled runs were redundant duplicate dispatches correctly discarded, and the cap is deliberate. Then the **change plan Part 0** describes mint-worker.js as "**Concurrency 1**, 12-min budget" — a third, different value (1 vs 3). These three documents do not agree on how the mint is parallelised.
2. **citation-gate readiness.** The vetted plan (#2 and its closing confession) states that an earlier plan called citation-gate "30 lines, already written — just wire it," and proves that wiring gateMint as-is would delete valid findings. The earlier recommendation (referenced as "yesterday") is thus explicitly contradicted/withdrawn.
3. **statute-rag status.** The accuracy review (12 July) says statute-rag "is built, required, and never called." The completion report (same day) says it was wired in via E-255/PR #291. Same-date documents describe it as both unwired and wired — the review predates the fix within the day.
4. **Corpus cap.** The accuracy review and change plan discuss the 3-page/4,000-char corpus as a live problem; the vetted plan says the 200,000-char fix **shipped** in PR #336. Depending on read order these disagree on whether the truncation defect is open.
5. **Catalogue rule count.** The accuracy review states 664 rules repeatedly; the change plan RC-4 says "~403 rules / ~295 frameworks" and pointedly refuses to guess ("I will read the true number from the DB"). Framework totals also drift (291 vs ~295). The documents do not share one authoritative count.
6. **Greptile.** The ledger uses Greptile's 2-vs-51 as the headline justification for the corroboration gate and still ingests 3 greptile-apps findings, while the sweep plan says "Greptile: settled, do not pay… Do not pay." It is simultaneously cited as evidence and dismissed as a tool — and its findings nonetheless appear in the ledger (F-0079 is a corroborated ACT item resting partly on greptile-apps).

*(This digest is analysis of the six documents only; no files were modified.)*