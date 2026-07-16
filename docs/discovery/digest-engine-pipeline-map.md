I now have a comprehensive picture of the entire pipeline. Here is the full digest.

---

# TAMAZIA AUDIT/MINT PIPELINE — END-TO-END MAP
Repo: `Tamaziaa/tamazia-cowork-os` @ main `b1fd65e` (v25.14, 2026-07-14). All paths absolute-rooted at `…/scratchpad/engine/`.

## (a) ENTRY POINTS, CRON, PARALLELISM, TIMEOUTS

**`scripts/mint-worker.js` (364 LoC)** — the 24/7 drain. Reads `minting_queue` via `FOR UPDATE SKIP LOCKED` (multi-worker safe), calls `build()` from `src/skills/S025-audit-page-builder/scripts/build.js`. Knobs (env): `MINT_CONCURRENCY` (default 10), `MINT_IDLE_MS` (15000), `MINT_MAX_RETRIES` (3), `MINT_BUILD_TIMEOUT_MS` (default 120000, floor 30000), `MINT_RECLAIM_AFTER_MIN` (30), `MINT_MAX_RECOVERY` (5), `MINT_RECOVER_COOLDOWN_MIN` (20). `mintOne()` races `build()` against `effectiveTimeout` (manual-source rows get `max(BUILD_TIMEOUT, 600000)`). Lifecycle helpers: `reclaimStale()` (orphaned `minting`→`pending`, retry-counted), `recoverTransient()` (transient-failed rows `~*` a regex of timeout/network/challenge patterns back to pending, bounded by `recovery_count`), `resolveNames()` (turns `resolve:<slug>` sentinel rows into domains via S028 `resolveWebsite`), `reclaimStartup()` (`--reclaim-startup`, resets `minting` rows >2min old). CLI: `--once`, `--dry`, `--reclaim-startup`.

**Two hard post-write assertions in `mintOne`** (lines 262-295): (1) `SELECT 1 FROM audit_pages WHERE slug=… AND hash=…` — a builder-returned object is *not* an audit unless the row exists (this is the fix for the "1,004 phantom audits / 412 dead URLs" incident); (2) `verify-audit-url.js verifyAuditUrl(url, {live:true})` — the page must return HTTP 200 (fail-OPEN on infra error, fail-CLOSED on a real non-200). Only then `minting_queue.status='done'` and the lead's `audit_url/audit_slug/audit_hash` are set **once** (guarded `WHERE audit_url IS NULL`). Sentry alert (dependency-free HTTPS POST) fires only on dead-letter.

**Workflows (`.github/workflows/`):**
- `mint-now.yml` — primary on-demand + fallback drain. `workflow_dispatch` only; `timeout-minutes: 360`; `concurrency: mint-now, cancel-in-progress:false`. **Forces `MINT_CONCURRENCY=1`** and `MINT_BUILD_TIMEOUT_MS=720000` (via `*_OVERRIDE` re-assertion after sourcing `.env`, because `.env` silently overrode the job `env:` — E-273). **Unsets `COMPLIANCE_ENGINE_VERSION`** so the code constant is authoritative. Installs Playwright+chromium (cookie evidence). Concurrency was cut 3→1 because free-tier LLMs (Groq/Cloudflare/Gemini) 429 under parallelism, silently degrading grounding.
- `mint-cycle.yml` — the scheduler that dispatches mint-now every ~30 min as a safety net.
- Related: `remint-audits.yml`, `remint-priority.yml`, `nightly-workers.yml`, `backlog-burst.yml`, `layer3-complete.yml`, `engine-cycle.yml`.

There are **≥3 minters** (GitHub Actions, an Oracle VM pm2 worker, a Hetzner v19 fallback), which is why the DB-level version/kill gate exists (see build §SEAL).

## (b) `build.js` STAGE ORDER (1523 LoC) — the pipeline

`build()` → `_versionGate()` (fail-CLOSED on version mismatch, fail-OPEN if `engine_flags` unreadable; checks `mint_enabled` global kill) → `slugify` + collision-checked 8-char `hash` → deterministic `idemKey = sha1(domain|engineVer|hourBucket)` → `buildPayload()`. Stages inside `buildPayload`, each recorded on a **stage-manifest** (`_SM`):

1. **`crawl`** — `scanSite()` (site-scan.js) raced against 150s hard cap. fail-OPEN but `_SM.failed('crawl')` → makes audit unsendable. Then `crawl-escalation.maybeEscalateCrawl` (Apify, default-off).
2. **`firm_identity`** — `firm-identity.resolveFirmIdentity()`. If a CH company_number, `markets.attachRegisterEvidence` folds Tier-A into the jurisdiction matrix.
3. **`resolveHomeCountry`** (build-local, lines 261-295) → `effCountry`.
4. **`jurisdiction`** — marked ran iff `scan.markets` present (detectMarkets ran inside site-scan).
5. **`compliance_scan`** — `_M_compliance.scan()` (S008 compliance.js). fail-CLOSED: on throw, `comp = {compliance_unassessed:true}` (never a clean bill). Sub-stages (`cookie_evidence`, `ico_register`) folded from `comp.substages` into manifest.
6. **Per-mint fail-CLOSED overlay gate** (lines 390-414) — `resolver.overlayDrop` drops non-servable/out-of-jurisdiction findings; **assertion-only** if `comp.canonical_jurisdictions` present (won't double-cut the authoritative overlay), actively filters only as a safety net.
7. **Tier 1 (parallel)**: keyword_map, ai_citation probe+findings, ai-readiness, local-pack. **Tier 2 (parallel)**: content-gap, organic-competitors, geo-probe, source-gap, seo-deep. **Tier 3**: authority-gap, bing-volume, hf-ml intent, then serial CC footprint, hallucination, geo-visuals/screenshots. All fail-OPEN via `_warn()`.
8. **Reachability reconciliation** (739-744): `_assessable = scan.reachable || comp.reachable`; if neither read the site, `findings = []` (hard zero-fabrication).
9. **`finding-trust.classifyAll`** → kind/state/confidence; then `verifyTopFindings()` (NIM/Groq entailment check on top fined presence+absence findings, fail-OPEN, demotes NOT_ENTAILED→NEEDS_REVIEW and withholds fine).
10. **Integrity gate** (`_integrityOK`, 755-764): drops textless findings, compliance findings with no framework, fined breaches with no citation (fail-CLOSED).
11. **fix-writer.uniqueFixes**, design-system.bingoLine, exec_summary via `_M_gate.gateLLM` (rubric-scored, 2 attempts) with deterministic fallback composer.

Then `build()` continues: register-check → **`llm_verify`** (llm-verify.js, cached in `llm_verdicts`) → adjudication-verdict check (manifest `breach_adjudication` ran iff every text-derived finding carries `adjudicated===true`) → PSI/statute_rag proved-from-payload → **`_SM.seal()` → `payload.sendable`**.

**Write-seam gate order (CodeRabbit #340 fix — the critical ordering):**
1. **Citation gate** (`citation-gate.verifyCitations`) — quarantine mode (records + `sendable=false`), drop mode only if `CITATION_GATE_DROP=1`. Fail-CLOSED.
2. **Coverage contract** (`coverage-contract.computeCoverage`) — reporting only; `render_class!=='assessable'` → `sendable=false`. `applyCoverage()` deliberately NOT wired (it filters `.status`, pointers carry `.state`). Fail-CLOSED.
3. **Zod schema** (`payload-schema.validatePayload`) — never throws; on fail `sendable=false`.
4. **R2 WRITE** (`putAudit`) — **moved to AFTER all gates** (was before). This is the load-bearing fix: R2 now stores only the gated document.
5. `verify-payload.verifyPayload` (send-gate, quarantines but persists) → resilient Neon INSERT (HTTP `neonHttp` 90s/3-attempts → shim fallback → idempotent adopt-by-key confirm loop). Supersede prior live rows. Refuses to return a dead link.

**Gate polarity summary:** version-gate=fail-closed; crawl/compliance stages=fail-open-but-recorded; overlay drop=fail-closed safety-net; integrity/citation/coverage/schema=fail-closed; R2 write is **after** gates.

## (c) IDENTITY RESOLUTION

**`firm-identity.js` (332 LoC)** — the display-name ladder (highest confidence first, recorded in `source`; CONFIDENCE map: schema_org 0.95, companies_house 0.9, og_site_name 0.85, title 0.6, domain_stem 0.3):
1. schema.org JSON-LD Organization/LegalService/LocalBusiness `.name` (walks `@graph`, nested publisher/provider/brand).
2. `og:site_name` / `application-name`.
3. **Companies House API** (`CH_API_KEY`/`COMPANIES_HOUSE_KEY`) — legal_name + company_number + registered_office; **accepts only a normalized-equal or domain-tied+contains match** (never `items[0]`, unlike register-check.js). No key → NULLs, recorded in `notes`.
4. `<title>`, separator-split, marketing tails stripped.
5. domain stem (cleaned, title-cased) — last resort.

**Rejection rules:** `GENERIC_RX` kills page furniture ("Bristol Office", "Home", "Contact"); `sharesTokenWithDomain` requires a ≥4-char token shared with the stem (acronym/containment escape hatch for "BDO"). Precedence in build.js `company` field (966-976): resolved `display_name` wins *if source≠domain_stem*, else lead-supplied name, else scanned firm_profile name. `firm-profile.js` (322 LoC, invoked inside compliance.js via `profileFirm`) supplies the LLM-derived `hq_country`/`sub_sector_llm` used for HQ reconciliation of the scalar display country (build.js 378-385, only when corroborated by `detected_jurisdictions`). `resolve-name.js` lives in `src/lib/sourcing/` and is the sourcing-side resolver, not on the mint identity path.

## (d) JURISDICTION

**Signal sources & precedence.** `markets.js detectMarkets()` (393 LoC) runs inside site-scan and is the primary producer. It builds a **tiered evidence matrix** (E17 fix for the Kingsley-Napley phantom-UAE bug): **Tier A** (w=5, dispositive) = official register entry, on-site regulator *authorisation* statement (anchored to "authorised and regulated by", SRA/FCA number, s.82 trading-disclosure block, Law Society); **Tier B** (w=3) = ccTLD, hreflang, phone code, currency, country-valid postcode, stated office; **Tier C** (w=1, never attaches) = marketing prose, bar admission, bare country/regulator mention. **A jurisdiction is `bound` iff ≥1 Tier-A OR ≥2 *independent* Tier-B signal types.** `serves` (marketing reach) is kept strictly separate from `bound` (legal nexus) — only `bound` may attach law (E-228). Every attachment ships `jurisdiction_evidence:[{country,tier,bound,signals:[{type,weight,quote,url}]}]`.

`build.resolveHomeCountry()` picks the scalar `effCountry`: (1) explicit passed country overridden only when ccTLD/strong signal contradicts, (2) **ccTLD wins first** (definitive registration, fixes `.ae` carrying stale `country=UK`), (3) strongest strong-market, (4) dominant operating country, (5) single currency; **never blind-defaults to UK** (returns `''`).

`signals.js` (227 LoC) — `buildSignals()` maps proven codes→canonical law jurisdictions via `registry/jurisdiction.js` (`JUR_MAP`, `toCanonical`), derives ~40 trigger flags (`TRIGGER_RX`), employee band, `augmentFreezones` (DIFC/ADGM only on establishment context), and **`detectNexus()`** — the v25.12 ghost-jurisdiction fix. `NEXUS_PROFILE` now requires every establishment alternative to **name its own country** (the bare `/incorporated in/` that put UK firms in the US is gone; corporate suffixes near a state name removed). Produces per-family `{established_in, serves_customers_in, processes_residents_of, factors, evidence}` (serves = ≥2 EDPB factors).

**`jurisdiction-router.js` (278 LoC)** — `routeForMarkets()` is the live router; registered country is always-on primary, operating markets attach only with strong evidence, then `CONDITIONAL` laws (EU_AI_ACT, US_BIPA, COPPA, PSD2, OSA, DSA, TCPA) gated by `conditionalOK`, then `jOK()` strips laws for markets not served. `routeJurisdictions()` is the coarse floor. `SECTOR_MAP` (~35 sectors) is the deterministic floor unioned with the Neon catalogue via `mergedSectorMap()`.

**Subjurisdiction (US states): NOT wired.** `registry/subjurisdiction.js` (68 LoC) holds `US_STATE_PRIVACY` (17 states with real 2026 nexus thresholds — CCPA/VCDPA/CPA/TDPSA etc.), UK devolved-nation resolver, EU derogations, UAE emirate health authorities. DORMANT.md confirms: **"134 US state privacy rules that can never attach"** — needs an economic-nexus threshold decision (revenue/consumer cutoffs unobservable from a website). `connect.js` `_K_SUBJUR` regex excludes US state acts outright in knowledge mode; `CAP_GATE` has US_VCDPA/US_TDPSA regexes but these gate the catalogue frameworks, not the subjurisdiction registry. `registry/nexus.js` (62 LoC, `NEXUS_TYPES`/`EDPB_SIGNALS`) is a **second door on the nexus fact** and is dormant (signals.js is the live producer; DORMANT.md defers merging until after v25.12 stabilizes).

**Evidence tiers:** three (A/B/C in markets.js) plus the finding-trust confidence layer plus the connect.js gate chain (A jurisdiction, B0/B sector, nexus, C trigger, capability).

## (e) SECTOR

**Detection**: (1) `signals.normalizeSector` regex (`SECTOR_RX`, ~22 patterns → 20 canonical keys), (2) compliance.js **authorisation-override** (`_AUTH_SECTOR`, lines 996-1007, runs BEFORE any rule is chosen — an SRA/FCA/CQC authorisation statement is the most authoritative sector signal and mutates `effectiveSector`), (3) LLM `profileFirm` `detected_sector`/`sub_sector_llm` (gate-validated), (4) `registry/sector.js` (149 LoC) canonical TREE + `subSectorExcludes` node-exclusivity. build.js propagates `comp.detected_sector` to every downstream engine (line 418).

**Mapping to frameworks**: `resolver.js` (157 LoC, `resolveLaws`/`overlayDrop`) is the negative-guardrails-first mapping-driven attach path; `connect.js` (371 LoC, `connect()`) is the live **catalogue-driven** connection layer — the 400+ framework spine. Gates in order: **GATE A jurisdiction** (`fvJuris[fw]==='GLOBAL' || J.has`), **GATE B0 framework-sector** (`fwSectorOK`: universal OR SECTOR_MAP OR rule sector_relevance OR parent alias), `subSectorExcludes`, **NEXUS gate** (establishment-only frameworks drop if firm established in another family), **CAP_GATE capability** (EU_AI_ACT/EU_MDR/UK_CRA/UK_COMPANIES_ACT/DIFC_DPL/ADGM_DPR/UK_CMA/DMCC/Trading Standards each need a real signal or on-page mention), **GATE B sector** (empty sector_relevance = family baseline via `BASELINE_BY_FAMILY`), **GATE C trigger** (`trigger_then_check`/`prohibit` rules need trigger present). `connectSelfTest` throws fail-closed on jurisdiction/node/nexus leak. Regulator exclusivity: CLC displaces SRA; DIFC displaces ADGM displaces UAE_PDPL.

**Catalogue location**: primarily **Neon tables** — `compliance_rules` (rule_type, trigger_pattern, sector_relevance[], regex_pattern, regex_elements, severity, fine_low/high_gbp, penalty_*, enforce_*, statutory_citation) and `framework_versions` (framework_short, jurisdiction, binding_status, required_nexus). Loaded by `connect.loadCatalogue()` (never caches an empty/partial result). Seeds in `db/seeds/`: `compliance-laws.json` (187 laws, 110 distinct `neon_framework_short` codes), plus ~14 SQL seed files, `cohort-frequencies.json` (conformal review band, 9,166 golden firms), `crosswalks/sector-taxonomies.json`. `BASELINE_BY_FAMILY` (connect.js) hard-codes per-family universal law (UK/DE/FR/EU/US/AE/SA/QA/BH/OM/EG/JO/IL/GLOBAL). `applies_when`/`excluded_when` are law-level trigger-flag arrays consumed by `resolveLaws`/`overlayDrop`; `tags` via `registry/vocab.js` (dormant).

## (f) BREACH DETECTION — `scanners/compliance.js` (1660 LoC) + `corpus-index.js` (124 LoC)

`ruleCheck()` handles four rule shapes:
- **`element_checklist`** (lines 750-774): one rule, multiple `regex_elements:[{label,pattern}]`; reports `present_elements`/`missing_elements` each with verbatim quote + url ("you show price and VAT but not timescales"). Optional `trigger_pattern` gates relevance; `page_scope` via `_scopePool`.
- **`trigger_then_check`** (785-803): trigger phrase must be present on visible body, disclosure regex absent → miss. DP-policy guard: if no privacy page was read → `policy_page_unfetched` (non-fined).
- **`prohibit`** (806-829): breach if pattern present. Uses `scanRuleGlobal(re, index, {proseOnly:true, skipTestimonial:true, skipNegated:true})` — the every-word prose scan. **Legacy raw-markup fallback** (818-828) also runs `isNegated()` (the "back door" was closed).
- **`must_appear`** (831-860): disclosure required; `url_check`-scoped miss on unfetched target → `target_unfetched` (absence-fabrication guard, bug #38/#41).

**Negation guard (`corpus-index.js`):** `NEGATION_RX` (line 96) matches `do not|don't|never|cannot|not offer|must be over|18 and over|over-18s only|strictly 18` etc.; `isNegated(sentence)`. Polarity fix v25.13: "we do NOT offer filler to under-18s" is a compliance statement, not a prohibited claim — `skipNegated` in `scanRuleGlobal`. This is the ONE door for every rule.

**Evidence classes/quotes:** `_presentIn` (visible prose OR raw source), `_extractQuote` (returns the sentence only if `_isProse`), `_absenceEvidence` (A3 — nearest-miss context: pages_checked, searched_terms, requirement, nearest_quote). **Absence vs observed:** finding-trust `_kindOf` routes compliance→`absence` UNLESS `_isBrowserObserved` (absence_evidence.state==='observed_in_browser' or adjudication==='observed_fact' or observed===true)→`observed`. This is the fix for the "16 frameworks, ZERO compliance findings" bug where the PECR pre-consent tracking breach (up to £17.5m) was structurally unable to confirm because browser observations have no checked_urls/quote.

**Adjudication** (compliance.js 1448-1474): `breach-adjudicator.adjudicateBreaches()` (287 LoC), 60s deadline. Adjudication fields carried through: `adjudicated` (bool), `adjudication` (verdict), `adjudication_reason`, `adjudication_disproof`. A `ReferenceError` here is treated as a BUG (E-263) — the report `_adjReport` is a first-class payload field; the manifest marks `breach_adjudication` failed unless every text-derived finding carries a verdict. **`positive_compliance`** (1552-1564): ICO/SRA/FCA/CQC/Companies House regex detection.

**Non-English gate** (1087-1112): `<html lang>` + stop-word density vote → out-of-scope rather than fabricate GDPR breaches on foreign text. **Credibility/knowledge-mode fallback** (1079-1086): empty corpus → `render_mode:'knowledge'` (sector + registered-family + catalogue-bound laws, zero findings/fines). **No cache** (E-252, lines 924-943): every scan is a fresh live read.

## (g) EVIDENCE/VERIFICATION — WIRED vs DORMANT (verified from require graph)

Confirmed by `build.js` require graph + `mint-worker.js` + `DORMANT.md` + `eval/reachability.test.js` (acorn-based CI gate over both entrypoints):

**WIRED into the mint:** `citation-gate.js` (66 LoC — v25.13, quarantine mode, per-FINDING identity `fw+rule`), `coverage-contract.js` (50 LoC — reporting only, `applyCoverage` deliberately unwired), `finding-trust.js` (142 LoC), `payload-schema.js` (108), `verify-payload.js` (72), `llm-verify.js` (247 — required by build.js, cached in `llm_verdicts`), `stage-manifest.js` (89), `register-check.js`, `enforcement-map.js`, `verify-audit-url.js` (via mint-worker post-write assertion). `statute-rag.js` (53 LoC) is required by `breach-adjudicator.js` (grounding); the manifest proves it from payload output, not from a call site.

**DORMANT (not on the require graph):** `evidence-ledger.js` (41 — no renderer contract), `gap-finder.js` (103 — catalogue immune system, belongs in nightly not mint), `candidate-verifier.js` (127 — not required anywhere in src/scripts/eval), `enforcement-matcher.js` (37), `enforcement-crossval.js` (31), `engine-bridge.js` (58), `applicability.js` (43 — lex specialis tie-break, unreviewed legal decision), `registry/nexus.js` (62), `registry/obligations.js` (104), `registry/subjurisdiction.js` (68), `registry/vocab.js` (26). All 11 are listed in DORMANT.md with owner (Aman) + unblock condition. The reachability test enforces: reachable OR declared-dormant, else CI fails.

## (h) PAYLOAD — `payload-schema.js` (108 LoC, Zod)

`schema_version:'v2'`. Top-level shape (build.js return, 827-1046): domain, sector, country, `applicable_frameworks`, `detected_jurisdictions` (only law-assessed jurisdictions), `detected_sector`, `sub_sector`, `engine_version`, `firm_profile`, `firm_identity`, `binding` (framework→binding_status), **`framework_meta`** (single source of truth: name/regulator/binding_type/section_ref from catalogue — renderer never guesses; null omitted), `warnings[]`/`warning_count` (every swallowed error), `jurisdiction_evidence`, `jurisdictions_bound`/`served`, `adjudication`, `rules`, **`pointers[]`** (bucket-quota'd, ≤140, severity-sorted), `needs_review`, `trust_summary`, `exec_summary`, `keyword_map`, `ai_citation`, `authority`, `ai_readiness`, `geo_probe`, `geo_visuals`, `screenshots`, `content_gap`, `jurisdiction_statement`, `glossary`, `stage_manifest`, `sendable`, `citation_gate`, `coverage`, `schema_ok`/`schema_errors`, `llm_verify`. **Zod validator** enforces: `company` not FORBIDDEN_NAMES/PAGE_FURNITURE, `engine_version` `/^v\d+\.\d+/`, `llm_verify` present, `framework_meta.regulator`≠"Sector regulator", `Pointer` shape (kind∈signal/absence/probe/observed, state='CONFIRMED' only, non-empty citation+evidence), and **if any compliance pointer exists, `adjudication.ran===true`**. Never throws (returns `{ok,errors}`). **Renderer contract:** the renderer reads `framework_meta`/`binding`/`pointers`/`framework_intel` and never holds parallel maps (E07/E08/E09 fixed drift). R2 stores full payload; Neon keeps a compact projection when `AUDIT_PAYLOAD_STORE=r2`. Versioning: `schema_version:'v2'` + `engine_version` (stamped from compliance.js constant) + `framework_version` (from `framework_versions`).

## (i) CRAWLING — `site-scan.js` (635 LoC) + `services/crawl-render`

`scanSite()` is the direct-fetch + PSI scanner (shared S008 `http.js fetchWithRetry`, 20s/2-retries, challenge detection). Compliance.js `gatherCorpus()` (lines 357-545) is the deeper crawler: up to **120 pages, 45s deadline, concurrency 28**, sitemap discovery, `_RELEVANT` link ranking, disclosure-page-first ordering. **JS-render fallback ladder:** (1) residential proxy (Apify credits) if homepage bad, (2) free Jina reader `r.jina.ai` (`_renderViaReader`), (3) `CRAWL_RENDER_URL` crawl4ai/Playwright microservice (`_renderPage`, the birketts.co.uk 403 fix — reads /legal, "SRA Registration No"), (4) **public Wayback archive** (`_archiveSnapshot`, `via_archive` flag → all findings demoted to NEEDS_REVIEW). `services/crawl-render/` is the microservice. Two corpora: `corpusHtml` (600k raw, hreflang/meta) and `corpusText` (2M visible words, all 120 pages) — 94% of raw was markup. C-1 sector-term rescue re-fetches ≤3 sector pages via Jina. **Speed budget:** scanSite capped 150s in build.js; per mint-now comment PSI≤90s + compliance+formatters ~60s; whole build capped at `MINT_BUILD_TIMEOUT_MS` (720000 in mint-now, 120000 default).

## (j) CI GATES TODAY — eval/ + workflows

**93 `eval/*.test.js` files.** Active CI workflows gating the engine:
- **`quality-gates.yml`** (PR on src/eval + push main): `eval/properties.test.js` (fast-check), `boundaries.test.js`, `payload-schema.test.js`, `mint-smoke.test.js` (**actually calls buildPayload**), and **`npx stryker run`** (mutation score must not regress). This is the "77 evals green while 2 mint-killers shipped" fix.
- **`eval.yml`** (compliance-eval): guardrails.js golden baseline, e2e-engine, obligations, framework-intel, rulecheck-detection, subsector, node-exclusive, connect-failclosed, barristers-attach, framework-record, nexus-gate, sra-complaints-superset, sector-cutover, catalogue-completeness, connect-shadow-identity, review-band, eaa-statement-superset, applicability, register-grounding, enforcement-matcher, + more (~40 steps).
- Others: `eval-audit.yml`, `eval-audit-gaps.yml`, `eval-qualifier.yml`, `eval-retier.yml`, `codeql.yml`, `semgrep.yml`, `eslint-pipeline.yml`, `lint-workflows.yml`, `engine-version-guard.yml`, `neon-guard.yml`, `shadow-validate.yml`. `eval/reachability.test.js` is the dormant-module gate.

**The "12 sweep tools" do not exist as `tools/sweep/`** — there is no `tools/` directory and zero `sweep` references in js/yml. This appears to be a stale premise; the equivalent function lives in the 93 eval tests + Stryker + `scripts/audit-of-the-audits.js`, `scripts/self-audit-workflow.js`, `scripts/verify-audits.js`.

## (k) SEO/GEO SCANNERS (inventory only)

`src/lib/audit/`: `ai-readiness.js` (robots AI-crawler access, llms.txt, entity schema, Wikidata), `geo-probe.js` (multi-sample share-of-voice), `geo-visuals.js` (engine grid, radar, entity web map), `authority-gap.js` (OpenPageRank DR), `content-gap.js`, `competitor-overlap.js`, `source-gap.js`, `seo-deep.js`, `cc-index.js` (Common Crawl footprint), `bing-volume.js`, `hf-ml.js` (zero-shot intent), `local-pack.js`, `hallucination.js`, `screenshot.js`, `glossary.js`, `enforcement-map.js`. `rank-insight.js` (touch0) supplies keyword_map + aiCitationProbe. site-scan.js `aiCrawlerPointers` flags blocked GPTBot/ClaudeBot/PerplexityBot etc. GEO/best-practice findings are re-bucketed out of the regulatory section with penalties stripped (`_nonReg`, build.js 497).

---

# VERDICT — TRUSTWORTHY vs ROTTEN

**Trustworthy (hardened, gate-protected, evidence-tied):**
- **Identity resolution** (firm-identity.js) — strict CH matching, no `items[0]`, rejection rules for page furniture. The "Bristol Office"/"Kingsleynapley" class is structurally dead.
- **Jurisdiction attachment** (markets.js tiered matrix + signals.js anchored nexus + connect.js gate chain) — the v25.12 ghost-jurisdiction fix names every establishment country; `bound`≠`serves`; multi-gate fail-closed self-test. This is the most battle-hardened part of the engine.
- **Write-seam integrity** (build.js SEAL + mint-worker post-write assertions) — R2-after-gates, dual post-write DB+URL assertions, idempotent write with named transport failures, version/kill gate reaching un-loginnable boxes. The 1,004-phantom-audit and stale-worker classes are closed.
- **Fabrication guards** — reachability reconciliation (`findings=[]` if unreadable), finding-trust evidence-lock (fines only on CONFIRMED, absence needs ≥3 pages read, archive/truncation interlocks), non-English gate, knowledge-mode fallback, citation-gate quarantine. Multiple independent layers.
- **Negation/polarity** (corpus-index.js) — one-door `isNegated` closes the prohibit false-positive class including the raw-markup back door.
- **CI** — quality-gates.yml + Stryker + mint-smoke actually execute code; reachability.test.js prevents "built and never called."

**Rotten / incomplete / risk-bearing:**
- **US state privacy (subjurisdiction) — non-functional.** 134 state rules + a full 17-state threshold registry that *cannot attach*. Any claim of US state coverage is false; this is the largest known coverage hole.
- **Dormant enforcement evidence** — `enforcement-matcher`/`enforcement-crossval`/`evidence-ledger` unwired because `compliance_enforcement` is empty; the "matched precedent" and per-law evidence-ledger a managing partner would demand are absent.
- **Fragility of the `_warn()` swallow pattern** — 34+ swallow sites in build.js alone; now *recorded* on `warnings[]` (honest) but still means many stages fail-open silently within a single mint; correctness depends on the manifest being read downstream.
- **Coverage `applyCoverage` is a knowing no-op** (filters `.status`, pointers carry `.state`) — wired as reporting only; the honest label is shipped but breaches are NOT actually filtered by coverage, only by `sendable`.
- **Catalogue quality** is unverifiable from code alone — lives in Neon; the seed shows 187 laws/110 frameworks, and the v25.14 commit itself fixed "19 broken catalogue regexes (3 dead P0s)," implying ongoing regex-rot in `compliance_rules`.
- **Multi-minter estate** (Oracle VM, Hetzner v19) — mitigated by the DB version gate but still a source of stale-code risk the repo cannot fully control.
- **The "12 sweep tools" premise is stale** — no such directory exists; sweep-equivalent logic is scattered across eval/ and ad-hoc scripts.

Net: the **jurisdiction, identity, and anti-fabrication/write-integrity spine is genuinely trustworthy** and reflects many hard-won incident fixes; the **US-state layer, enforcement-precedent evidence, and coverage-filtering are the rotten/incomplete edges**, all explicitly acknowledged in DORMANT.md.