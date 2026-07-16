I have audited every LLM call site. Here is the complete digest.

---

# LLM CALL-SITE AUDIT — tamazia-cowork-os @ main (clone 2026-07-14)

## Scope and method
Grepped for every provider endpoint (`api.groq.com`, `generativelanguage.googleapis.com`, `integrate.api.nvidia.com`, `api.anthropic.com`, `api.perplexity.ai`, `api.deepseek.com`, `api.openai.com`, Alibaba DashScope, Cloudflare Workers AI) and every key name (`GROQ_API_KEY`, `GEMINI_API_KEY`, `NIM_API_KEY`, `DASHSCOPE_API_KEY`, `CLOUDFLARE_API_TOKEN`, `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`). Two independent LLM stacks exist plus a scored gate wrapper, and ~14 distinct call sites hang off them.

## Shared infrastructure (three entry points)

### A. `src/lib/llm/router.js` — the primary router (`run()`)
- **Chain** (`DEFAULT_CHAIN`/`ROUTE_BY_ROLE`, lines 247–260): Cloudflare 70B (only if token) → Groq `llama-3.1-8b-instant` → Groq `llama-3.3-70b-versatile` → NIM → Gemini `2.5-flash-lite` → Qwen (paid, only if `DASHSCOPE_API_KEY`).
- **Temperature**: provider functions default to **0.2** (e.g. router.js:84, 113, 137) but every audited caller passes `temperature: 0`.
- **JSON**: `json:true` sets `response_format:{type:'json_object'}` for Groq/CF/NIM/Qwen (lines 86, 115, 161, 210). **Gemini's call (line 133) never receives `json` and never sets a response schema** — Gemini is asked for JSON by prompt only.
- **Retry/fallback**: 3 attempts per provider with jittered backoff (line 296–300); Gemini gets 1 attempt. Concurrency semaphore width 2 (line 27). Per-call 30s timeout (line 40).
- **Budget**: reads/writes `scanner_budget_state`; returns `budget_exhausted_for_today` when the daily cap is blown (line 268).
- **Failure = fail-open to caller**: returns `{ok:false, text:''}` (line 322). No exception; callers decide.
- **Dead code worth flagging**: `callAnthropic` (Claude Haiku) is fully implemented (lines 181–199) and its cost is in the `COST` table, but **no chain — default, role, gate, or profile — ever includes `provider:'anthropic'`**. The comment (lines 177–180) claims Haiku is the paid fallover that saves the engine "when every free tier has 429'd"; in reality that safety net is not wired in. The real paid last-resort is Qwen, and only if `DASHSCOPE_API_KEY` is set.

### B. `src/lib/audit/llm.js` — the legacy `askLLM` chain
- **Chain** (`_providers`, lines 35–45): Groq 70B → NIM → DeepSeek → Perplexity → OpenAI `gpt-4o-mini` → then Gemini plain (line 68) → then Qwen (lines 71–77).
- **Temperature default 0.4** (line 59) — the loosest default in the codebase; GEO callers override to 0, but this is the raw-generation stack.
- `askGeminiGrounded` (lines 83–98) uses Gemini with the real `google_search` tool and returns cited `sources`. Graceful `null` on quota exhaustion.
- Rate-limit token bucket `LLM_MAX_PER_MIN` default 90 (line 10).

### C. `src/lib/llm/gate.js` — `gateLLM` scored wrapper
- Attempt → parse → **deterministic rubric score 0–10** → pass ≥ threshold (default 7) → else retry with targeted-deficiency feedback and an escalating extraction protocol (lines 34–37) → after `max_attempts` (default 3, attempt 3 uses a "premium" chain Groq70B→CF→Gemini→Qwen) **DROP to the caller's deterministic fallback** (fail-closed).
- Rubric helpers `H.anchored` (verbatim-quote presence in corpus) and `H.inSet` (enum membership) — lines 117–128. **Self-reported model confidence is explicitly excluded as a rubric input** (line 10–11 comment; enforced by never reading it). This is the single best-designed piece of the LLM layer.

---

## Call site inventory

### 1. `src/lib/audit/firm-profile.js` — sector + jurisdiction classifier — **CAN CREATE a client-facing fact**
- **Pipeline position**: runs early in the mint; its `primary_sector` and jurisdiction codes **decide which law frameworks attach to the audit**, i.e. everything downstream.
- **Prompt** (lines 206–223): "From the WEBSITE TEXT below, extract ONLY what the text actually evidences — never guess…" returns strict JSON with `own_activity`, `client_industries`, `primary_sector` (enum of `SECTORS`), `sector_evidence` (**verbatim phrase**), `sub_sector` (enum of offered nodes), `office_countries`/`served_markets` with verbatim `evidence`.
- **Output authority**: CREATE. `resolvedSector = _ovr || llmSector || deterministicSector` (line 282); when the LLM returns any canonical sector, `sector_confident` is forced `true` (line 298), meaning the LLM sector **overrides** the deterministic "professional-services" deny-default and unlocks a regulated pack.
- **Format enforcement**: gateLLM rubric (lines 233–256): schema 3 · sector-enum 2 · sub-sector-enum 1 · `sector_evidence` must appear verbatim in corpus (`H.anchored`, line 243) · office/served evidence verbatim (line 247) · self-ID/own-vs-client agreement 2. Threshold 7, 3 attempts, deadline 110s, then deterministic fallback.
- **Retry/params**: temp 0, max_tokens 700, custom chain CF→Groq70B→NIM→Gemini→Qwen (lines 257–263). Legacy `_profileLLM`/`askLLM` only if the gate module itself crashed (line 269).
- **Failure**: fail-open to deterministic keyword classifier `_detectSectorFromCorpus` + `_selfIdOverride` + `_domainProfession`.
- **Hallucination pathways**: (a) LLM adopts the client industry ("accountancy firm for charities" → charity) — mitigated by `client_industries` exclusion + `_selfIdOverride` + rubric consistency penalty. (b) Fabricated `sector_evidence` — mitigated by verbatim anchoring. (c) Invented foreign jurisdiction → law attachment — mitigated by the **two-signal gate** in `mergeJurisdictions` (lines 305–320): a foreign country needs the LLM *and* a deterministic strong-market or a verbatim corpus quote. Residual risk: the sector itself is single-signal LLM-trusted once it names a canonical enum with any anchored phrase.

### 2. `src/lib/audit/llm-verify.js` — cross-verifier — **VETO only, but has repeatedly DESTROYED correct audits**
- **Pipeline position**: runs after the deterministic verifier and **before the `audit_pages` INSERT** (build.js:1203).
- **Prompt** (`_prompt`, lines 43–83): a "regulatory-attachment auditor" given DOC-wrapped untrusted site text + the engine's claimed sector, jurisdiction families, and each attached framework code with its family label. Asks: is the sector the firm's own; for each framework apply nexus PATH A (establishment) vs PATH B (targeting); flag foreign-family-without-evidence or sector-implausible attachments. Returns strict JSON `{sector_ok, sector_should_be, families_ok, wrong_families, flagged_frameworks:[{code,reason}], confidence}`.
- **Output authority**: VETO. It cannot add a framework; the whitelist intersection (`binding.includes(code)`, line 169) discards anything the model invents. But a flag sets the audit to `verified=false / V12_llm_crosscheck` — **quarantine**. So it can suppress a correct, penalty-bearing finding.
- **Format**: `router.run` role `extract`, temp 0, json true, max_tokens 700. Optional **quorum** second leg on a different model family (Gemini→Qwen) for priority sectors carrying P0/P1 (lines 193–236).
- **Failure**: fail-open on unavailability (`status:'unavailable'`), fail-closed on disagreement.
- **This is the strongest evidence for the founder's complaint.** The file is a graveyard of post-mortems (E-228, E-241, E-249, E-266) where the model **wrongly quarantined perfect audits**: it flagged the SRA Code of Conduct on an SRA-regulated solicitor (line 108–117), flagged `GOOGLE_EEAT` as "foreign family/no nexus" (line 152–157), invented an EU family for UK codes on a UK firm (`wardhadaway`, lines 216–225), and rejected registered-country law for "no nexus". Each was patched with another deterministic guard *around* the model. The pattern: a probabilistic veto placed in front of a deterministic ground truth it "cannot possibly know better than we do" (line 112). Every guard added is an admission the model output is untrustworthy.

### 3. `src/lib/audit/breach-adjudicator.js` — false-positive filter — **REMOVE/DOWNGRADE only (safe pattern)**
- **Position**: after regex proposes candidate breaches, before they ship.
- **Prompt** (`_prompt`, lines 116–148): "compliance adjudicator… you do not add findings… you rule." Per candidate returns `breach|no_breach|insufficient` and — critically — **every `no_breach` must carry a verbatim `disproof` quote from the supplied evidence**.
- **Output authority**: FILTER. "It may only REMOVE or DOWNGRADE… never invent one" (line 23).
- **Format**: gateLLM with a rubric (`_rubric`, lines 153–190): one verdict per id (3), enum (3), and **4 points gated on the disproof quote actually appearing in the evidence** (lines 172–186) — a genuine entailment/verbatim check.
- **Failure**: unadjudicated high-risk findings are demoted to `NEEDS_REVIEW`, not shipped (lines 213, 254). Browser-observed facts bypass adjudication entirely (`_observedFact`, line 211/226).
- **Hallucination pathway**: it can DROP a real breach it can't "see" (the header documents it dropping a live PECR pre-consent-tracking breach because the network log isn't in the text — line 44–54); fixed structurally by routing observed facts around it. This is the correct design: verbatim-anchored veto with a fail-safe.

### 4. `src/lib/audit/law-discovery.js` — discovers NEW statutes — **GENERATES law, but quarantined behind two gates**
- **Position**: side-channel per (sector, sub-sector, jurisdiction) cell; cached 30 days.
- **Prompt** (lines 79–88): "List the statutes… that govern its DIGITAL EXPOSURE… For EACH include `official_url`… If you cannot give a REAL official URL, DO NOT list the law." Strict JSON, 3–15 laws.
- **Output authority**: **CREATE in principle** — but output never touches `connect()`, the binding map, or any client surface (line 6–8); unmatched laws land in `framework_candidates` with `status='candidate'`, promotable only at `seen_count>=2` **and** human review.
- **Guards**: rubric requires ≥N of the returned laws to rediscover known catalogue laws (distant supervision, lines 58–63); then `_citationProved` → `candidate-verifier.verifyCandidate` (line 158–166) must fetch the official URL, get HTTP 200 on an official legislative host, and confirm the page carries the law's distinctive terms.
- **This is where fabrication actually happened**: the header (lines 132–157) documents "Cookies (Information, Consent and Related Obligations) Regulations 2020" — a non-existent SI — admitted **three times with three invented `legislation.gov.uk` URLs**, because the old gate checked only HTTP status and `legislation.gov.uk` returns 202 to any URL shape. Now hard-closed by content verification.

### 5. `src/lib/audit/candidate-verifier.js` — **DETERMINISTIC, no LLM.** Fetches official URLs, checks host allow-list, repealed-law list, and distinctive-term presence in the page body (lines 88–125). Three-state verdict (verified/rejected/unverifiable) with 202-polling so a throttled gov server isn't called "fabricated". This is the correct antidote to LLM law-invention. Safe.

### 6. `src/lib/audit/finding-trust.js` — **DETERMINISTIC, no LLM.** Assigns each finding CONFIRMED/NEEDS_REVIEW via verbatim-quote locks, page-coverage floors (`MIN_PAGES_FOR_ABSENCE`), archive guards, jurisdiction veto. Only CONFIRMED renders to a client. Safe and load-bearing.

### 7. `src/lib/audit/geo-probe.js` — AI share-of-voice — **CREATES client-facing competitor claims from free generation — DANGEROUS**
- **Prompt** (line 55): "A buyer asks for the best providers for '<query>'. List the top 6 specific firms or providers by name." via `askLLM`, temp 0, seed 42, N=5 samples.
- **Output authority**: CREATE. The finding shown to the client (lines 103–112) states verbatim: "an AI engine named you in X of N answers; it named `<competitor names>`" — **the competitor names are whatever the model generated**. `share_of_voice`, `top_competitors`, and the "your competitors appeared, you didn't" narrative all derive from model free-text.
- **Format**: none — free comma list, regex-parsed (`_parseNames`), aggregator names filtered.
- **Grounding**: optional `askGeminiGrounded` layer adds *real* cited domains (lines 72–81), but the core SoV number does not require it.
- **Hallucination pathways**: the model can name firms that don't exist, name the wrong sector's firms, or omit the client for reasons unrelated to real visibility. This is a genuine "the model invented our competitors" surface. Mitigation is only multi-sampling + temp 0 (reduces variance, not fabrication).

### 8. `src/lib/audit/hallucination.js` — AI-knowledge probe — **model's own knowledge used as ground truth**
- **Prompt** (line 8): "In 2 sentences, what is `<company>` (`<domain>`)? If you do not have reliable, specific information… reply exactly: NO RELIABLE INFO." `askLLM`, temp 0. If "knows", a second call classifies sentiment (line 13).
- **Output authority**: CREATE a client-facing P1/P2 finding ("a leading AI model has no reliable information about your firm" / "describes your firm in negative terms").
- **Direction of risk is mostly fail-safe**: a hallucinated *positive* description makes `knows=true` and *suppresses* the finding. But the sentiment→"negative" finding (line 24) is a subjective free-text classification shown to the client. Free text, no schema.

### 9. `src/lib/audit/fix-writer.js` — rewrites the "Tamazia fix" line — **highest temperature, client-facing prose**
- **Prompt** (lines 18–27): rewrite each finding's remediation into a distinct sentence; "Invent NO facts, fines, dates, figures or law — only describe the remediation." `askLLM` **temp 0.6**, json array.
- **Output authority**: transform-only rewrite of client-facing prose. Deterministic dedupe/verb-rotation backstop guarantees no byte-identical fixes even if the LLM fails (lines 52–64).
- **Risk**: 0.6 on a free rewrite is the loosest generation that reaches the client; constrained to phrasing, but nothing verbatim-checks that it didn't smuggle a claim. Cosmetic risk, not a correctness risk to findings themselves.

### 10. `src/lib/llm-rescue.js` — lead qualification rescue — **PROPOSES only; deterministic gate keeps final say**
- **Position**: agency (not audit) side; enriches non-Tier-1 leads. `LLM_QA_ENABLED` default OFF.
- **Prompts**: LinkedIn disambiguation (line 309–310), named-DM extraction (line 350/364–365), sector classify to enum (line 403–405) — all `router.run`/`llmJson`, temp 0, strict JSON, `role:'classify'`/`'extract'`.
- **Output authority**: OVERRIDE-proof by construction. The LLM only supplies a found public signal; the **canonical deterministic `scoreLead`/`decideTier` re-runs with the found data** and keeps the final say (`retierWith`, lines 175–204). LLM never writes `icp_tier`/lifecycle/send state, never demotes.
- **Guards**: `looksLikePerson` person-check, deterministic surname/host-jurisdiction sanity caps on confidence (lines 330–334), unverified-email confidence cap below the auto-promote bar (line 395–396). Budget: separate `agency_llm_budget_state`.
- **Failure**: on parse failure one terser retry (line 222–225), else falls back to deterministic finder result, "never a guess". Well-designed; low risk.

### 11. `src/lib/llm-factcheck.js` — Tier-1 fact-check — **FLAG for human review only; never demotes**
- **Prompt** (`llmIsRealPerson`, lines 79–86): only adjudicates the borderline "is this string a real person's name" call; strict JSON. Deterministic doubt detectors do the rest (lines 41–74).
- **Output authority**: advisory only — sets `qa_status='flagged'`, `review_status='unreviewed'`; a flagged Tier-1 **stays Tier-1** until a human confirms (line 9–11). Cannot reduce the net Tier-1 count. Safe.

### 12. `src/skills/S008-personalisation-engine/scripts/run.js` — outreach pointers — **grounded, guarded**
- LLM (`llmRun`, temp 0.2) only re-phrases already-generated pointers that are too vague/long (`enhanceWithLLM`, lines 328–340); "We never let the LLM invent new findings."
- **Guard**: `hallucination-guard.js` rejects any pointer whose facts (URLs, framework codes, numbers, domains) don't appear verbatim in the scanner bundle anchor set (lines 34–56, 72+). Rejected pointers logged to `pointer_hallucination_log`. Grounded-extraction pattern done right.

### 13. `src/lib/touch0/rank-insight.js` — SERP keyword seeds — **model output is a query, not a fact (safe)**
- Inline Groq/Gemini calls (temp 0–0.2, lines 283–322) generate a *generic buyer keyword phrase*; that phrase is then **verified by a real SERP check**, and "every ranking claim is from a live SERP result or it is dropped" (line 3). The model's free text never becomes a client fact directly.

### 14. Catalogue-enrichment scripts (feed the law catalogue, not clients directly)
- `scripts/llm-extractor.js`: extracts `{obligation, penalty, effective_date}` from statute text; **DOC-tagged injection-hardened prompt** (line 23), temp 0, **dual-model cross-check — penalties never ship unless Groq and Gemini agree** (lines 51–61). Grounded extraction, done well.
- `scripts/sector-autotagger.js`: enum-constrained sector tags, **two-model intersection**, invented sectors dropped (lines 13–22). Safe.
- `scripts/intel-pulse.js`: internal Slack/Telegram ops summary, temp 0.4 — **not client-facing**. Low stakes.
- `scripts/mint-verified-gate.js`: no LLM call; only warns if no key is present.
- `src/skills/S060-gemini-lead-enricher` and `S063-deep-research` call `lib/llm/gemini.js` `generate`/`extractJson` (enrichment/research; not in the audit render path — flagged for completeness, not deeply traced).

---

## Verdict: is "LLMs are destroying our results" supported?

**Partially, and specifically — not globally.** The architecture is overwhelmingly built on the correct principle: *deterministic proposes/decides; the LLM verifies, filters, or extracts under a verbatim/enum lock*. The gate (`gate.js`), the breach adjudicator, the candidate verifier, finding-trust, llm-rescue, llm-factcheck, the personalisation hallucination guard, and the dual-model catalogue scripts are all sound. Where the engine has been burned, the git-archaeology in the file headers shows the damage came from a small number of places:

**Dangerous / has demonstrably destroyed results:**
1. **`llm-verify.js` (cross-verifier)** — a probabilistic *veto* sitting in front of curated deterministic ground truth, able to quarantine correct, penalty-bearing audits. Its own comments document repeated false quarantines of SRA-regulated law firms and GLOBAL frameworks. Replace with: an **entailment/abstain** design — the model may only flag when it can cite a specific contradicting fact, must return `abstain` on absence-of-evidence, and may **never** override a curated sector-core or registered-country attachment (the guards already bolted on should be the *primary* contract, not patches). Better: demote it from "quarantine" to "route-to-human" like llm-factcheck.
2. **`geo-probe.js`** — invents client-facing competitor names and a share-of-voice number from free generation. Replace with: **grounded extraction only** — require the Gemini google-search-grounded layer (real cited sources) as the source of competitor names, and abstain (render nothing) when grounding is unavailable, rather than shipping ungrounded model recall.
3. **`hallucination.js`** — sentiment/knowledge claim from the model's own memory. Acceptable for the "no reliable info" direction (fail-safe), but the "negative sentiment" finding should require **grounded citations** or be dropped.

**Medium — well-guarded but LLM-authoritative:**
4. **`firm-profile.js`** — the LLM sector *creates* the fact that drives law attachment. Keep, but tighten: the jurisdiction two-signal gate is the right pattern; apply the same **corroboration requirement to the sector** (LLM sector must agree with `_scoreSectorCues` or a self-ID/domain signal before it unlocks a regulated pack), rather than trusting any anchored enum value.
5. **`fix-writer.js`** — temp 0.6 client prose; lowest correctness stakes but the loosest knob. Drop to temp ~0.2; the deterministic backstop already exists.

**Safe (leave as-is):** gate.js, breach-adjudicator, candidate-verifier, finding-trust, law-discovery (behind human gate + URL proof), llm-rescue, llm-factcheck, personalisation engine, rank-insight, llm-extractor, sector-autotagger.

**Two infra findings independent of the complaint:** (a) the Anthropic/Haiku "paid safety net" is dead code — not in any chain (router.js:247–260), so under a full free-tier 429 cascade the chain really does collapse to deterministic, exactly the silent-degradation failure the preflight klaxon (lines 361–382) was written to catch; (b) Gemini calls in `router.js` never set a JSON response format (line 133), relying on prompt-only JSON, which is the most parse-fragile lane in the primary stack.

**Bottom line:** the LLMs are not "destroying results" across the board — the extraction/verification uses are disciplined. The destruction is concentrated in **one veto that outranks curated truth (`llm-verify.js`)** and **two ungrounded generation surfaces (`geo-probe.js`, `hallucination.js`)**. Converting the veto to entailment/abstain-with-human-routing and the two generators to grounded-only would remove the observed harm without touching the safe majority.