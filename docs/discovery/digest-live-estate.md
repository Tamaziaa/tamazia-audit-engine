I have everything needed. Here is the full digest.

---

# TAMAZIA LIVE ESTATE — READ-ONLY DIGEST (checked 2026-07-16, ~10:45 UTC)

Connection succeeded via `psql` against the Neon pooler (`ep-sparkling-sunset-al01a9od-pooler`, region eu-central-1, db `neondb`). All queries were SELECT-only; all HTTP was GET/curl. The database is large — **173 tables** in `public` (including ~40 `_bak_*` snapshot tables dated 20260627–20260714, evidence of heavy iterative framework/rule surgery over the last three weeks). Below is what the target table families actually contain, followed by live curls of the four newest audit pages.

## 1. Target table families — row counts

| Table | Rows | Notes |
|---|---|---|
| `audit_pages` | **26** | NOT ~17 as the brief guessed. 10 truly live (archived_at NULL), 15 superseded, 1 anomalous. |
| `audit_pages_shadow` | 11 | shadow/staging copy |
| `audit_events` | 0 | empty |
| `audit_intents` | 3 | |
| `audit_trail_exports` | 0 | empty |
| `minting_queue` | **2,876** | 2,858 paused / 8 held / 7 done / 3 failed |
| `framework_versions` | 300 | catalogue of frameworks |
| `framework_candidates` | 161 | |
| `framework_intelligence` | 290 | |
| `compliance_laws` | **187** | the core law catalogue |
| `compliance_rules` | **696** | detection rules, 696/696 have citation_url |
| `compliance_checks` | 0 | empty |
| `compliance_enforcement` | 24 | |
| `compliance_docs` | 50 | |
| `compliance_vocab` | 49 | |
| `compliance_client_types` | 400 | |
| `classifier_audit_log` | 2 | |
| `pointer_hallucination_log` | 41 | LLM pointer-hallucination guardrail log |
| `statute_chunks` | 908 | full-text statute chunks (tsvector) |
| `law_records` / `law_obligations` / `law_enforcement` | 26 / 51 / 26 | |
| `engine_flags` | 1 | global mint kill-switch |
| `engine_runs` | 2,901 | job heartbeats |
| `leads` | **10,065** | only 7 carry an audit_url |

## 2. audit_pages — all 26 rows

Schema is rich: `id, workspace_id, lead_id, slug, hash, domain, sector, country, framework_version, payload_json (jsonb), generated_at, expires_at, status, archived_at, pdf_url, share_card_url, open_count, last_opened_at, high_intent_at, unlocked, verified, verify_report (jsonb), idem_key`.

Every row is `framework_version = 4.7`. Statuses are `live` or `superseded`. The estate is dominated by a repeatedly-regenerated set of **UK law firms** (birketts, mills-reeve, russell-cooke, wardhadaway, freeths) plus a handful of healthcare/aesthetics/real-estate pages. The law-firm domains show long supersession chains — e.g. `birketts.co.uk` appears as 10613→10596→10672 (superseded) then **10672→10746 live**; `mills-reeve.com` has six generations (10530, 10585, 10617, 10662, 10679 all superseded → 10688 live). This is a regenerate-and-supersede pattern: each new mint sets the prior row's `archived_at` and flips it to `superseded`.

**The 10 truly-live rows (status=live, archived_at IS NULL):**
- 10746 `birketts-llp` / [HASH] / birketts.co.uk / law-firms / UK / verified=t / opens=1
- 10743 `sk-n-clinics` / [HASH] / sknclinics.co.uk / healthcare / UK / verified=f
- 10709 `about-elysium-aesthetics-clinic` / [HASH] / elysiumchicago.com / aesthetics / US / verified=t
- 10703 `luxury-aesthetic-clinic-for-radiant-skin-amp-body` / [HASH] / evayabeautyclinic.com / professional-services / AE / verified=f
- 10697 `price-list` / [HASH] / hollylaneaesthetics.co.uk / aesthetics / UK / verified=t
- 10694 `prestige-medical-center` / [HASH] / prestigemedicalcenter.com / healthcare / US / verified=f
- 10691 `8-best-medical-clinics-in-abu-dhabi...` / [HASH] / bhomes.com / real-estate / AE / verified=t
- 10688 `mills-reeve` / [HASH] / mills-reeve.com / law-firms / UK / verified=f / opens=0
- 10683 `russell-cooke` / [HASH] / russell-cooke.co.uk / law-firms / UK / verified=t
- 10669 `wardhadaway` / [HASH] / wardhadaway.com / law-firms / UK / verified=t

**Data-quality flags in audit_pages:**
- **Row 10564 (`freeths`) is inconsistent**: `status='live'` yet `archived_at = 2026-07-14 05:59:59` is set. Every other row couples live↔NULL and superseded↔timestamp. This one is a live row that has been stamped archived — likely a partial supersession that failed to flip the status, or a "live" flag left dangling. Worth a look.
- **Slug drift across generations of the same company**: birketts appears both as slug `birketts` (older gens) and `birketts-llp` (current live). The current live mills-reeve uses slug `mills-reeve` consistently. Slugs are derived from page `<title>`/H1 and are not stable across re-scrapes, which is why elysium's slug is `about-elysium-aesthetics-clinic` and evaya's is `luxury-aesthetic-clinic-for-radiant-skin-amp-body` (scraped from a marketing headline, not the brand name).
- `unlocked = false` on all 26 (paywall/gated state); `expires_at` ~180 days out (Jan 2027).

## 3. minting_queue — status breakdown & done-with-no-page

Counts: **paused 2,858 · held 8 · done 7 · failed 3**. Column set includes `domain, company, sector, country, lead_id, status, retries, slug, hash, error, enqueued_at, minted_at, source, claimed_at, priority, recovery_count`.

**Done-with-no-page = 0.** All 7 `done` rows join cleanly to an `audit_pages` row on (slug, hash). The 7 done: birketts-llp, sk-n-clinics, about-elysium-aesthetics-clinic, luxury-aesthetic...(evaya), price-list (hollylane), prestige-medical-center, 8-best-medical-clinics...(bhomes). Note the queue's `country` uses **USA/UAE** while audit_pages uses **US/AE**, and the queue tags all of elysium/evaya/prestige/bhomes as `sector=healthcare` whereas audit_pages re-classified them to aesthetics / professional-services / real-estate — so **sector normalization diverges between the queue and the published page.**

**The 3 failed rows share one identical failure mode** — the minter refuses to emit a dead link:
- 407 `opesre.com` (miami-x27-s-top-luxury-real-estate...) retries=3
- 3901 `cooley.com` (cooley-llp/[HASH]) retries=3
- 1979 `advocatehealth.com` (advocate-health/[HASH]) retries=3

Error text: *"audit_pages INSERT failed for … — no row written; refusing to return a dead audit link."* This is a guardrail firing correctly (better a failed queue row than a 404 audit URL). Note `opesre.com`'s slug `miami-x27-s-top-luxury...` contains a raw HTML entity artifact (`x27` = apostrophe), an upstream scrape-sanitisation bug.

**8 held rows** (retries=0, no error) are all UK/law-firm or law domains: michelmores, wrigleys, stephens-scown, harbottle, brownejacobson, fosterswrigley, anthonygold, shoosmiths — a batch staged but gated (held awaiting a manual/verification release).

The 2,858 **paused** rows are the bulk backlog (e.g. wardhadaway, mills-reeve, russell-cooke, freeths, independent.co.uk), all enqueued 2026-07-14. The queue is effectively **globally paused** — nothing is minting from it right now except the small verified law-firm/healthcare set that was pushed through.

## 4. leads & audit_url coverage

`leads` = **10,065 total**, of which **only 7 have audit_url set** (0.07%). Lead audit columns: `audit_url, audit_slug, audit_hash, audit_url_minted_at, audit_verified, audit_verified_at, audit_critical, audit_high, audit_first_touch_sentence, claude_audit_cleared`. The 7 minted leads map 1:1 to the 7 minting_queue `done` rows and to live audit_pages. Sample (5):

```
8415 sknclinics.co.uk   https://tamazia.co.uk/audit/sk-n-clinics/[HASH]?l=8415&x=1799592974&sig=[REDACTED]
3755 elysiumchicago.com https://tamazia.co.uk/audit/about-elysium-aesthetics-clinic/[HASH]?l=3755&x=1799587836&sig=[REDACTED]
3047 evayabeautyclinic  https://tamazia.co.uk/audit/luxury-aesthetic-clinic-for-radiant-skin-amp-body/[HASH]?l=3047&x=1799587450&sig=[REDACTED]
2855 hollylaneaesthetics https://tamazia.co.uk/audit/price-list/[HASH]?l=2855&x=1799586948&sig=[REDACTED]
1684 birketts.co.uk     https://tamazia.co.uk/audit/birketts-llp/[HASH]?l=1684&x=1799593387&sig=[REDACTED]
```

**Verified URL pattern**: `https://tamazia.co.uk/audit/<slug>/<hash>?l=<lead_id>&x=<expiry_unix>&sig=<hmac>`. The `l/x/sig` triad is per-lead tracking/attribution + a signed expiry (`x` = unix ~1799.5M ≈ early 2027). I confirmed empirically that the **bare `/audit/<slug>/<hash>` (no l/x/sig) also returns 200** — the signature governs attribution/expiry, not access; the (slug, hash) pair is the real key. A wrong hash → **404**. Superseded pages still serve 200 (e.g. `mills-reeve/[HASH]`).

## 5. Framework catalogue — how laws are stored

**`compliance_laws` (187 rows)** is the master catalogue. Columns cover exactly the fields you asked about: `id, name, jurisdiction, region, regulator, category, section_ref, website_obligation, applies_when (jsonb), excluded_when (jsonb), where_on_site (jsonb), trigger_flags (jsonb), severity, severity_rank, max_penalty, fine_low_gbp, fine_high_gbp, effective_date, status, confidence, servable (bool), detection (jsonb), enforcement_feed, source, neon_framework_short, files10_law_id, detection_rules (jsonb), updated_at`.

- **Jurisdiction spread**: UK 93, EU 30, USA 28, MENA-AE 10, plus DIFC/ADGM/DE/FR/ES/IT/SA/KW/EG/IL/JO/BH/QA/CA and GLOBAL. Strongly UK-weighted.
- **Category spread** (with servable count): sector_specific 64/64, data_protection 19/12, sector_financial 11/5, consumer_fairness 10/3, sector_healthcare 9/5, sector_legal 7/4, accessibility 4/3, plus many 3-row sector buckets (crypto, cbd, travel, hospitality, automotive, education, aesthetics, veterinary…) most of which are **not yet servable** (servable=0). Roughly half the catalogue is `servable=true`.
- **Fines**: stored as `fine_low_gbp` / `fine_high_gbp` integers (e.g. ADGM DPR £40k–£79k), with a human `max_penalty` string for non-GBP/criminal penalties (e.g. UAE Cybercrime "Imprisonment up to 2 yrs; fines up to AED 500k" has NULL GBP fields). `compliance_rules` additionally carries native-currency fine columns (`fine_currency, fine_high_native, fine_low_native`) and enforcement-realism columns (`enforce_typical_low/high_gbp`, `enforce_methodology`, `enforce_context`, `enforce_max_rare`).
- **Citations**: `detection_rules` jsonb embeds per-rule `citation_url` (e.g. `https://www.adgm.com/operating-in-adgm/office-of-data-protection`), `regex_pattern`, `trigger_pattern`, `layman_explanation`, `tamazia_fix_short`, `enforcement_example`, `pricing_tier`, `service_page_path`. **`compliance_rules` (696 rows) has 696/696 citation_url populated** — full citation coverage.

**`framework_versions` (300 rows)**: `framework_name, framework_short, jurisdiction, version, rules_count, last_reviewed_at, reviewed_by, status, sector_news, required_nexus (jsonb), binding_status, binding_label, regulator, sector[], sub_sector[], universal, effective_from/to, canonical_law_id`. Reviews are attributed to *"Aman Pareek, International Business Lawyer"*, last_reviewed ~2026-05-18. `sector_news` holds enforcement talking-points (e.g. "ICO fined British Airways £20M…", "ICO sweep of FTSE-100 cookie banners in 2024 → 53 letters"). `required_nexus` encodes the binding test (`established_in`, `serves_customers_in`, `processes_residents_of`).

**`statute_chunks` (908 rows)**: `chunk_id, law_id, section, chunk_text, tsv (tsvector)` — full-text-searchable statute passages with inline `| Statutory basis: … | Cite: <url>` (e.g. `UK_SRA_TRANSPARENCY` / `SRA_COMPLAINTS_ELEMENTS` citing sra.org.uk transparency-rules). This is the RAG corpus behind the citations.

## 6. engine_flags / engine_runs

**`engine_flags` (1 row)**: `mint_enabled = TRUE`; `required_engine_version = "v25.14-2026-07-coderabbit-hardening"`; updated 2026-07-14 12:48. Note text confirms a hard version gate: *"Every minter must be on this exact ENGINE_VERSION or it refuses to mint. Set mint_enabled=false to stop ALL minters everywhere, including the Oracle VM and the Hetzner fallback."* (So there are minters on GH Actions **and** an Oracle VM **and** a Hetzner fallback.) This engine version (v25.14) is distinct from the catalogue version stamped on pages (framework_version 4.7 / catalogue v4.7).

**`engine_runs` (2,901 rows)** — heartbeats are current (latest 2026-07-16 10:40). Last-24h job health:
- Healthy/ok: `layer3-complete` (processed 400, 0 err), `apply-review` (21 runs ok), `llm-factcheck` (8), `llm-rescue` (8), `match-inbound-replies` (12), `gen-state` (11), `intel-pulse` (11), `mystrika` (4), `source-registers`, `daily-digest`, `claude-safeguard`, `health-check`, `compute-metrics`, `nightly-workers`.
- **Two recurring failures**: `verify-backlog` — **11 error runs in 24h**, every one `timeout after 1200000ms` (20 min ceiling); and `scrapers` — `timeout after 2100000ms` (35 min). The verify-backlog timeouts are the notable operational issue: the verification job cannot clear its backlog within its window, which plausibly explains why several live pages still carry `verified=false` (sk-n-clinics, prestige, evaya, mills-reeve-10688).

## 7. Live curls of the 4 most-recent non-archived audit pages

All four returned **HTTP 200, 0 redirects**, served from `tamazia.co.uk` (Remix app). Sizes 50–86 KB. The pages are a single `<div class="tz-shell" id="app">` hydrated from an inline `window.D = {…}` JSON payload, with `/audit/audit-app.js` + `/audit/audit-charts.js` (nonce-CSP). I parsed `window.D` for each.

**Common structure** (identical schema across all four): `meta` (company/domain/slug/sector/country/city/markets/date/catalogue "v4.7"/snapshot "live scan") → `score`+`grade`+`scoreBand` → `exposure`/`exposureCeiling`/`exposureByCurrency`/`exposureWaterfall` (the £/$ fine headline) → `counts` + `countsRegulatory` → `regulatoryHeadline` → `frameworks[]` (per-framework findings + regulator) → `exposureBars`/`heat`/`heatRows`/`heatCols` → `dims[]` (the "ten dimensions") → **`seo`** and **`geo`** sections → `competitors` → `trajectory` → `fixes[]` → `glossary`/`pricing`/`upsellProof`/`severityDefs`. It is a right-hand-content report shell (`tz-shell`), not a landing hero — a gated exposure report (`unlocked=false`).

**Placeholder/fallback audit — CLEAN.** Zero `undefined`, zero `{{mustache}}`, zero `[object Object]`, zero "lorem/placeholder/TODO". The 38–54 `null` occurrences per page are all legitimate JSON values inside `window.D` (e.g. `"wcag":null`, `"sanitised":null`, `"catalogueSize":null`), and the `nan` hits are substrings of real words ("Criminal **Finan**ces Act", "**finan**cial penalties"). **Nothing renders as a broken placeholder.**

**Per page:**

1. **Birketts LLP** (`birketts-llp/[HASH]`, 77 KB) — Title *"Birketts LLP · The Exposure Report · Tamazia"*. Sector **Law Firms / solicitors**, United Kingdom (London). **Grade D- (score 40, "At risk")**, verified=true. Counts: 46 total findings (3 critical / 14 high / 29 standard); regulatory-only 18 (3C/6H/9S). **Exposure £2.6M** (ceiling £5.1M), exact £2,585,850, £-only ("statutory currency… no exchange rate"). **15 frameworks** bind, rulesChecked 97: SRA Code of Conduct 2019 (5 findings), Companies Act 2006 s.82 trading disclosures (3), SRA Transparency Rules 2018 (1), EC Directive Regs 2002 (1), CMA (1), Consumer Rights Act 2015 (1), plus Criminal Finances Act 2017. `regulatoryHeadline`: "1 obligation is verified as breached on your live site right now. 14 further frameworks bind you…". **SEO**: PSI performance 49, seo 92, security 33, mobile 92; CWV CLS pass, Perf fail; onpage flags "No FAQ/Q&A schema". **GEO/AEO**: entityReadiness 80, shareOfVoice 0, "named 0 of 2 runs", aiKnows=true, sentiment neutral; per-engine readiness across ChatGPT/Gemini/Perplexity/Claude/Copilot/Grok/Meta AI/Google AI (all cite=true, readiness 51–66). Competitors: youDr 12, "Not named" in AI answer set. Fixes cite SRA Code C7.1/C7.4 and Transparency Rule 1.

2. **sk:n clinics** (`sk-n-clinics/[HASH]`, 86 KB) — Sector **Healthcare**, UK. **Grade D- (45)**, **verified=false**. 51 findings (0 critical / 18 high / 33 standard); regulatory 15 (0C/7H/8S). **Exposure £2.8M** (ceiling £5.5M, £2,848,250). **23 frameworks**, rulesChecked 115 (the widest scan): MHRA Human Medicines Regs 2012 POM advertising, CQC Fundamental Standards, UK GDPR (3), DPA 2018, ASA CAP Code s.12 Health & Beauty, CMA. `regulatoryHeadline` leans on "ranking and AI-visibility gaps… where buyers are being lost today."

3. **Elysium Aesthetics + Longevity Chicago** (`about-elysium-aesthetics-clinic/[HASH]`, 69 KB) — Sector **Aesthetics / injectables**, **United States**. **Grade D- (41)**, verified=true. 47 findings (3C/12H/32S); regulatory 15 (3C/5H/7S). **Exposure $4M** (ceiling $4M, $4,021,000, **$-denominated** — currency correctly switches to USD). **14 frameworks**, rulesChecked 48: FTC Act §5 (5 findings), ADA Title III web accessibility (2), plus FD&C/FDA, FTC Endorsement Guides 2023, FTC Health Breach Notification, HIPAA Marketing Rule (all 0). Correctly US-jurisdiction-scoped.

4. **Evaya Beauty Clinic** (`luxury-aesthetic-clinic-for-radiant-skin-amp-body/[HASH]`, 51 KB — smallest) — Sector **Professional Services** (mis-normalized; it's an aesthetics clinic), **United Arab Emirates**. **Grade C (60, "Workable")** — the only non-D- of the four. verified=false. 41 findings (0C/9H/32S); regulatory 11 (0C/1H/10S). **Exposure £0** (ceiling null, exposureByCurrency empty) — headline instead reads **"Ranking & AI"** (with no confirmed regulatory breach, the report pivots the hero from a fine number to the SEO/GEO angle; `regulatoryHeadline`: "Your live pages passed the checks a regulator's first sweep would run"). **6 frameworks**, rulesChecked 13 (thinnest): UAE Federal PDPL (4 findings), UAE AML/CFT, DIFC Data Protection, ADGM Data Protection, UAE Consumer Protection, UAE E-Commerce (all 0). **GEO is the weak spot**: entityReadiness 57, aiKnows=**false**, sentiment "No reliable information, risk of hallucination", every engine cites=false — i.e. the AI engines don't know this brand. Slug betrays the scrape artifact (`amp` = `&amp;` entity from "Skin & Body").

**Cross-page notes**: currency correctly follows jurisdiction (£ for UK, $ for US, £ fallback for UAE with £0 exposure). The `x27`/`amp` slug artifacts (opesre in the queue, evaya live) show the title-sanitiser leaks HTML entities into slugs. The four newest pages are content-complete and free of visible placeholder/undefined text; the only substantive concerns are operational (verify-backlog timeouts leaving 2 of 4 unverified, the freeths live/archived_at inconsistency, sector-normalization divergence between queue and page, and the globally-paused 2,858-row mint backlog).