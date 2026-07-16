I now have a complete picture across all requested areas. Here is the digest.

---

# TAMAZIA AUDIT RENDER PATH — END-TO-END AUDIT

Fresh clone `Tamaziaa/tamazia-website` @ `75bdd96` (2026-07-14). All paths under `functions/audit/`, `public/audit/`, `admin-v2-src/`, and repo-root `patch-dist.js`.

Sizes matter here: `_adapter.js` is **2,814 lines / 259 KB** (the brief said ~2000; it is bigger), `audit-app.js` is 1,642 lines, `audit-charts.js` 409, `audit.css` 144 KB, `patch-dist.js` 1,699 lines with **132 gates**.

---

## (a) `functions/audit/[[path]].js` — routing, access, R2 fetch (162 lines)

Cloudflare Pages Function, catch-all under `/audit/`. Flow:

- **Route match** (line 24): regex `^/audit/([^/]+)/([^/]+)/?$` → `slug`, `hash`. Non-matching paths that look like assets (`\.[a-z0-9]{2,6}$` or `/(fonts|engine-logos|trusted-logos)/`) fall through to static serving via `context.next()` (lines 30-32) — this pass-through is load-bearing; without it every audit page renders blank because the catch-all would 404 the JS/CSS/fonts.
- **DB read** (lines 41-46): single `neonQuery` against `audit_pages` joined to `leads` for `company`. Selects `payload_json, domain, sector, country, lead_id, expires_at, verified, status, generated_at, unlocked, company`.
- **Expiry** (line 51): `expires_at < now` → 410.
- **HMAC access control (lines 55-74) IS INERT.** The engine signs minted links over `slug|hash|lead_id|exp`, but the whole block is gated behind `env.AUDIT_HMAC_SECRET`, which is **not bound**. The code even admits it doesn't know the exact signed-payload format ("assumed `${slug}|${hash}|${lead_id}|${exp}`, hex HMAC-SHA256"). **Today the only access barrier is the 8-char `hash`.** Anyone with the URL sees the report. `verifyHmacHex` (lines 145-162) is a correct timing-safe implementation waiting for a secret + format confirmation that hasn't happened.
- **R2 dual-path** (lines 79-85): new rows store `{r2:true}` in Neon; the full payload lives in the `AUDITS` bucket at key `audits/${slug}/${hash}.json`. Old rows carry the full payload inline. Missing R2 object → 404.
- **Unlock/caching** (lines 87-89, 139): `unlocked` column OR `?unlocked=1` → `Cache-Control: no-store` (`maxAge=0`), so a paying customer is never handed a stale locked edge copy; locked pages get `max-age=300`.
- **Open tracking** (lines 124-138): fire-and-forget `waitUntil` that increments `audit_pages.open_count` + `last_opened_at` **server-side** (fixing P-010, where the beacon only wrote to PostHog while the cockpit read Neon), plus a PostHog `audit_opened` capture.
- Env-threaded commerce links (booking, 5 Stripe links), `CONTACT_PHONE` (hard default `+44 7778243657` at line 12), PostHog keys, and a **real deploy-unique `buildId`** from `CF_PAGES_COMMIT_SHA` are passed to `payloadToD` / `renderShell`.

**Verdict: KEEP, with one must-fix.** Clean, defensive, well-cached. The dead HMAC path is a real security gap — either wire the secret + confirm the format, or delete the block so it isn't mistaken for protection. Right now it is security theatre that reads as protection but enforces nothing.

---

## (b) `_adapter.js` — "THE PIPE" (2,814 lines)

Pure, deterministic `payload_json → window.D`. No I/O, `now` injected. It calls itself "the render-side safety membrane." It does an enormous amount. Key behaviours:

**What it READS vs RE-DERIVES/GUESSES** — this is the crux of the rebuild question:

- **Reads (trustworthy):** pointers/findings, evidence quotes, `checked_urls`, `scan.psi.audits` (real Lighthouse), `scan.signals`, `ai_readiness`, `authority.ranked` (DR), `competitive_benchmark`, `keyword_map`, `geo_probe`, `binding` map, `framework_meta`, `framework_intel`, `applicable_frameworks`, `adjudication`, `registers`, `catalogue_rules`/`catalogue_frameworks`.
- **Re-derives / GUESSES (the risk surface):**
  - **`estimateTurnover(payload)` (lines 1150-1169) invents the firm's revenue** from sector keyword regex × Domain Authority multiplier × indexed-page count × jurisdiction count. A dental clinic → £3M base; a bank → £600M. This estimate then **rescales every statutory fine** (lines 1727-1734) via `fineRate(fw)` (lines 1144-1149, another regex: GDPR/PDPL→4%, FCA/SRA→2%, else 1%). This is defensible ("£18M PECR on a dental clinic" → credible "£34k") but it is a **fabricated number driving a headline financial figure on a legal document.** Well-commented, but fragile: a sector-keyword miss silently mis-bands turnover by 100×.
  - **`PORTED_NEWS` (lines 1836-1882): ~55 hardcoded 2024-2026 enforcement blurbs** baked into the renderer, keyed by framework code, used when the payload carries no live `news_map`. These are real facts *today* but rot with time and can attach a generic regulator story to a firm it doesn't fit. Same risk with `FW_REGULATOR` (lines 203-253), `FW_NAME`/`FW_NAME_CAT` (lines 181-723, ~285 entries).
  - Per-engine GEO readiness (lines 2277-2281) is **modelled** from entity signals, flagged `engineEstimate:true`.
  - Competitor DR falls back to a **hash of the name** (`drFallback`, line 1601) when no real DR exists, flagged `drEstimated`.

**Fallback strings that could show wrong facts** — the file's own history is a graveyard of these:
- **"Sector regulator"** (E08, lines 734-739): 151 of 294 frameworks had no regulator, so the literal words "Sector regulator" shipped in the Regulator column of a law firm's report. Now `fwRegulator()` returns `null` (omit) rather than a placeholder, and reads `framework_meta` first.
- **"Statute"** (E09, lines 362-399): SRA rulebooks were labelled "Statute" (an Act of Parliament) because `_BINDING_LABEL` had no `statutory_code` key. Now defaults to neutral "Framework."
- Title-cased raw codes ("Uk Gdpr", "UAE Dha") — patched via `fixAcronyms` + `FW_NAME_CAT`.

**`framework_meta` catalogue (PR #184):** `setFrameworkMeta` / `metaOf` (lines 352-354). The engine now ships `framework_meta` with each audit; `fwName`, `fwRegulator`, `bindingType`, `bindingLabel` **read the catalogue FIRST** and fall back to the hardcoded maps only for legacy payloads. This is the correct direction — "adding a law to the catalogue fixes the render everywhere with no code change" — but the hardcoded maps (~700 lines) still exist as fallback and still drift.

**Entity decoding:** `decodeEnt` (lines 45-51) decodes typographic HTML entities but **deliberately never decodes `<`/`>`** (FIX-R4 XSS guard), so crawled `&lt;script&gt;` stays literal text. `firmName`/`humaniseName`/`sharesTokenWithDomain` (lines 75-129) are a careful anti-embarrassment layer — the "Bristol Office" bug (a page heading mistaken for a firm name on the Birketts audit) drove a rule that a real name shares a token with its own domain stem, else fall back to the clean domain stem. A `decodeDeep` pass (lines 2640-2644) decodes entities across the whole final `D`.

**TDZ / render-freeze remnants (history scars in comments):**
- Line 1817-1823: a `frameworks` **TDZ ReferenceError** ("Cannot access 'frameworks' before initialization") once crashed `payloadToD` on **every** payload, blocking all render improvements from reaching production. Fixed by computing `bindingN` inline. The scar comment remains.
- `_shell.js` line 71-79 documents the **asset-version freeze**: `_av='r37'` was hand-maintained, never bumped, so the 4h edge cache served the r37 bundle forever while fixes sat live-but-invisible on origin. Now derived from the deploy SHA.

**Truth filter (E-218):** if `ctx.verified !== true`, `sanitiseUnverified` (lines 1037-1098) strips findings lacking proof, applies jurisdiction-family narrowing, withholds statutory-ceiling fines, and flags `compliance_unassessed`. 9,700+ legacy rows render only evidence-clean content.

The main `payloadToD` (1671-2646) builds the full `D`: exposure (median not ceiling, per-currency, no FX — lines 1762-1794), 10 dims + score, frameworks (grouped by `actKey`, merged, deduped, hollow-cards dropped, ≥5 floor injected), 5×5 heatmap, SEO (on-page/security/a11y/keywords/PSI audits), GEO (engines/radar/schema/citations/root-cause chain), competitors (single spine, self-competitor stripping), 3 BINGO fixes, exec (hype-scrubbed), glossary, pricing pass-through.

**Verdict: REBUILD (staged), do not delete.** This file *works* and encodes years of hard-won edge-case knowledge — but at 2,814 lines with a health score of 1.3 it is the single largest liability. The right move is to **shrink it toward the `framework_meta` model**: once the engine reliably ships the catalogue, delete the ~700 lines of hardcoded `FW_NAME`/`FW_REGULATOR`/`PORTED_NEWS`/`FW_NAME_CAT` maps. The `estimateTurnover`/`fineRate` fabrication should move to the engine (which knows the firm) or be surfaced explicitly as "estimated." Keep `firmName`, `decodeEnt`, `sanitiseUnverified`, and the currency logic — they are genuinely defensive.

---

## (c) `_shell.js` + `audit-app.js` + `audit-charts.js` — page structure

**`_shell.js` (97 lines):** emits the exact HTML skeleton. Self-hosted fonts inlined as `@font-face` (11 woff2: Fraunces, Newsreader, JetBrains Mono) because the production CSP `font-src 'self' data:` blocks Google Fonts. Per-company `<title>`/OG ("`Company · The Exposure Report · Tamazia`"), always `noindex,nofollow` (per-recipient minted links). `injectJSON` escapes `<`/`>`/`&`/LS/PS for safe inline `window.D`. `renderShell` links `audit.css`/`audit-charts.js`/`audit-app.js` with `?v={buildId}`. A fixed "Notes on" toggle button. `errorShell` for all failure states.

**`audit-app.js` — page anatomy:**

- **LEFT RAIL** (`rail()`, lines 156-203): Tamazia lockup → company `<h1>` → "The Exposure Report / Compliance, Search and AI Visibility" → sector·country·city·domain → **score gauge (96px)** → "`{screenedLabel} · N bind you`" → **exposure headline + note** → adjudication line ("N findings re-examined against the statute") → **4 KPIs** (Critical findings, Confirmed v. evidence, AI share of voice, Domain rating) → **"Report prepared by Aman Pareek, LLM in International Business Law, King's College London"** with logo + "Every fix checked against N rule checks" → Instagram/LinkedIn/email social icons.
- **LANDING / FIRST SCREEN** (`verdict()`, lines 954-980): eyebrow "The verdict" → `H2` = "`{score}/100 · {grade}, with a median enforcement exposure of {exposure} across the N breaches evidenced on your live site.`" → **5 bold-led bullets** (What this is / The headline / Where you stand / How to read it / Keep it current) → "Your three highest-priority breaches" → 3 clickable `vfix` buttons.
- **FOUNDER SESSION** (`founderSession()`, lines 987-1008): directly under the verdict — "Walk the report through in 20 minutes," founder credential (verbatim/locked), "Claim the session" opens the on-page Cal intake, founder@ email + optional phone, plus two blind-send booking CTAs.
- **HERO CHARTS** (`heroCharts()`, lines 1035-1043): dim-card grid, PSI block (mobile|desktop dials), exposure waterfall, "Why AI can't see {company}" causal chain.
- **SECTION ORDER** (`SECT`, line 1048): **6 collapsible accordion pillars, one open at a time**: **Overview (Diagnostics & scorecard) → SEO & Technical → AI & GEO → Regulatory → Competitors → Plan & Pricing.** Each summary carries an icon + KPI chips (`SUMM`, lines 1054-1061).
- **SEO findings** (`P.seo`, lines ~308-368): subhead "On-page, technical and security signals…"; on-page issue list, security-header table, a11y list, keyword-demand table ("Keyword demand a rival is capturing" or the thin-firm variant), PSI element-level audits.
- **GEO findings** (`P.geo`, ~370-384): "Who AI names instead of you," per-engine readiness, radar, schema presence grid, source-gap table, root-cause chain, "The fix, in full."
- **Compliance/Regulatory findings** (`P.regulatory`, ~220-306): "The three you fix this quarter" → "Registered reality: your public register record, checked" → framework accordions ("The N frameworks carrying your exposure, worst first") with per-Article grouped breaches, evidence quotes, regulator, binding label, obligations, enforcement action.
- **Headings:** consistent `<div class="subhead"><span class="nt">↳</span><h3>…</h3></div>` pattern throughout — narrative, sentence-length H3s.

**Wasted-words / text-vs-visual balance:** the report is **prose-heavy**. Headings are full sentences ("You currently rank 20 to 50 for these. Moving into the top 1 to 10 captures the high-intent traffic AI and Google hand to whoever ranks first"). The adapter carries paragraph-length fallback strings (e.g. the `_pushScreened` `why` at `_adapter.js` 2058-2062, root-cause reasons at 2346-2349, exposure-note prose). Verdict bullets each run 30-50 words. Visuals (gauge, dials, waterfall, radar, heatmap, DR bars) exist and are good, but they are surrounded by dense explanatory copy — a genuine "wasted-words" reduction candidate. Every displayed string passes `escH` (line 143), which also **de-dashes em/en dashes to commas** at the render chokepoint (founder "no dashes" rule).

**Download / share options: ABSENT.** No `window.print`, no PDF export, no `navigator.share`, no "copy link," no CSV. The only "sharing" affordance is the OG meta in `_shell.js` for when someone pastes the URL. For a £495 deliverable this is a real gap — buyers cannot save or forward a PDF.

**Stripe unlock (freemium) flow:** `D.unlocked` (from `audit_pages.unlocked`, flipped by the Stripe webhook) gates every "Tamazia fix." When locked, a **green-gradient lock veil** (`.tz-lock-veil`) sits over each fix; clicking it (`goUnlock`, line 1163) opens the Plan pillar / pricing drawer at **Route 3 — £495 "Unlock this report + start Regulatory Watch"** (£495 unlocks + month one of Watch, then £1,500/mo, credited against any mandate within 90 days). `unlockHref()` (lines 126-132) appends `?client_reference_id=slug__hash` so the webhook unlocks *this exact* report. Three routes: Route 1 (one-time Fix Sprints £4,900/£8,900/£12,500), Route 2 (mandate), Route 3 (unlock/Watch), plus Independent Solutions add-ons.

**`audit-charts.js` (409 lines):** pure SVG chart kit — `gauge`, `dial`, `bars`, `exposureBars`, `heatmap`, `radar`, `trajectory`, `donut`, `dimScorecard`, `cwvMeters`, `psiDials`, `issueList`, plus `lockFix` (the veil). Self-contained, no deps. Handles `drHidden`/single-bar degeneration.

**Verdict: KEEP the shell + charts; REBUILD the app's copy density + ADD deliverable export.** `_shell.js` and `audit-charts.js` are tight and correct — keep. `audit-app.js` works but is copy-bloated; a rebuild should cut heading verbosity ~40%, rebalance toward the (already good) visuals, and **add PDF/print + a share affordance** — the absence is conspicuous for a paid report.

---

## (d) `patch-dist.js` — 132 gates (1,699 lines)

Post-build patcher + deploy gate. Injects the minified `_tgcs` CSS block into `dist/index.html` (lines 47-62), then runs **132 sequential checks** across all built HTML; **any failure → `process.exit(1)`, blocking deploy.** Also force-copies `public/audit → dist/audit` (tail) because Astro's public-copy intermittently drops `engine-logos/`, which would 404 assets live.

Gate flavours: structural CSS markers (1-5), **brittle string bans over stripped HTML** — no em-dashes (6), no "Subscribe" (7), no `pages.dev` (8), `400+` appears ≥4× (9), "Aman Pareek" present (10), no Indian regulators `IBC/TRAI/SEBI/RBI/DPDP/MeitY/IRDAI` (11), British English no "inquiry" (12), `Nasdaq:` not `NYSE: CGON` (13), "Verified mandates" not "Selected mandates" (14); page-existence gates (legal pages, confirmation pages, OG PNGs); function-source content gates (DSAR endpoints, cal-webhook events/indexes, honeypot field names, body caps); footer-entity gates ("Tamazia Ltd," no "sole proprietor"); and the audit-asset gates 131-132 (audit.css/charts/app + all 11 woff2 present in `dist/audit/`).

**Fragility:** this is a **1,700-line wall of `readFileSync` + `.includes()`/regex over generated HTML.** It's genuinely useful as a last-mile "did the founder's copy rules survive the build" gate, but: (1) many gates hardcode magic strings ("Aman Pareek," "NYSE: CGON," `400+` count) that will silently rot as copy changes; (2) gate 9 enforces a `400+` claim the *adapter* deliberately abandoned as a false claim (671 rules / 294 frameworks — see `_adapter.js` 2496-2505) — **the gate and the renderer now disagree on the core count story**; (3) numbering is non-contiguous and comments reference "50 gates"/"110 gates"/"132 gates" inconsistently; (4) `stripSafeZones` fixed-point loop is careful but the whole thing is O(gates × files) re-reading files repeatedly.

**Verdict: KEEP the mechanism, PRUNE hard.** The concept (a build-time truth gate) is worth keeping. But ~40% of the gates are stale copy-assertions that should be data-driven or deleted (gate 9's `400+` contradicts the product's own honesty doctrine and should go). Halve it.

---

## (e) The payload contract & the 61% change-coupling problem

**`_contract.js` (41 lines)** is the closest thing to a schema. It lists every `window.D` field the render consumes:
- **REQUIRED (non-null, lines 8-22):** `meta.{company,domain,sector,country,date}`, `score`, `grade`, `scoreBand`, `exposure`, `exposureFull`, `exposureNote`, `exposureWaterfall`, `counts.{critical,high,standard,total}`, `confirmed`, `frameworksAssessed`, `frameworksBinding`, `screenedLabel`, `rulesChecked`, `scoring.{formula,why,inputs}`, `exec`, `jurisdiction`, `heat`, `heatRows`, `heatCols`, `projected.{wk12,wk24}`, `glossary`, `seo.{psi,cwv,onpage,security,a11y,tech,keywordSummary,psiAudits}`, `geo.{entityReadiness,shareOfVoice,radar,schema,citations,sourceGap,rootCause,fix}`, `competitors.{bestKeyword,youDr,cols,rows,drBars}`, `pricingNotes`, `upsellProof`.
- **NON-EMPTY arrays (lines 26-29):** `scoring.bands`, `frameworks`, `dims`, `fixes`, `trajectory`, `seo.keywords`, `geo.engines`, `competitors.rows`, `pricing`.
- **Exact-count invariants (lines 36-38):** `dims.length===10`, `geo.engines.length===8`, `geo.rootCause.chain.length===4`.
- `catalogueSize`/`frameworksTotal` are **deliberately nullable** (engine emits no catalogue count yet).

**Critically: `_contract.js` is NOT imported by the render route** (line 3-4 comment) — it's used only by the backtest + CI. So the runtime pipe has **no contract enforcement**; `payloadToD` defends field-by-field instead.

**The 61% change-coupling / no-shared-schema problem is real and structural.** The website encodes the payload shape in **three uncoordinated places**: (1) `_contract.js`'s REQUIRED/NONEMPTY lists, (2) the ~1,000 `g(payload, '…')` path reads scattered through `payloadToD`, and (3) the engine repo's emitter (off-limits here). There is **no shared schema artifact** — no JSON Schema, no shared TypeScript type, no generated types. When the engine changes a payload field, the website only finds out via a rendered defect or a backtest failure. That is exactly why 61% of changes touch both repos: the contract lives in prose comments and defensive reads, not in a shared, versioned, machine-checked schema. `payload.framework_version` (used at `_adapter.js` 2493 as `catalogue: 'v'+…`) is a version *string*, not a validated schema.

**Verdict: REBUILD as a shared schema.** Promote `_contract.js` into a **versioned JSON Schema (or shared TS package) owned jointly by engine + website**, imported by both the emitter and the render route (fail-closed at mint, not at render). This is the highest-leverage structural fix in the whole system — it directly attacks the 61% coupling.

---

## (f) Cockpit `/admin` audit tabs (brief)

`admin-v2-src/` is a React (no-build, `React.createElement`-style JSX) admin. Audit-relevant:
- **`tab-audits.jsx` (135 lines):** "Audit micro-sites." Reads `window.AUDITS`, `window.QUEUE`, `window.LEADS`. Mint any brand (`MintBox`), tagged History (manual vs auto mints), a live **mint queue** (`minting_queue`: pending/minting/done/failed, drained ~every 30 min), stat tiles (Total / Manual / Opened / Auto), and a History table with links to live pages + view counts.
- **`audit-search.jsx` (8.5 KB):** search across minted audits.
- Supporting tabs: `tab-leads`, `tab-inbox`, `tab-bookings`, `tab-channels`, `tab-clients`, `tab-now`, `tab-ops`, `tab-outreach`, `tab-settings`, plus `lead-drawer`, `mint-box`, `lib.jsx`, `boot.jsx`, `app.jsx`. Data is injected globally (`window.AUDITS`/`QUEUE`/`LEADS`) by admin API functions.

**Verdict: KEEP.** Thin, functional, live-data views over the same Neon tables. No obvious liability; out of the render-path critical zone.

---

## OVERALL — what the CLIENT experiences opening an audit URL

They open a per-recipient link `tamazia.co.uk/audit/{slug}/{hash}` (from cold outreach; the 8-char hash is the only gate today). The page is `noindex`. **First screen:** a dark left rail pinned with their **company name, a large score gauge (e.g. "58/100 · At risk"), their exposure headline (e.g. "£340k") and note, four red/neutral KPIs (Critical findings, Confirmed vs evidence, AI share of voice, Domain rating), and a personal by-line — "Report prepared by Aman Pareek, LLM in International Business Law, King's College London."** The main column leads with **"The verdict"**: a one-sentence score+exposure headline, then five bold-led bullets (what it is, the headline breach, where they stand, how to read it, keep it current), then **three clickable "highest-priority breach" buttons.** Immediately below sits the **founder session** ("Walk the report through in 20 minutes") with a booking CTA and founder email. Then a **hero charts strip** (dimension scorecard, live PageSpeed dials, exposure waterfall, "Why AI can't see {company}" causal chain).

Below that are **six accordion pillars, one open at a time** — Overview → SEO & Technical → AI & GEO → Regulatory → Competitors → Plan & Pricing — each with icon + KPI chips in the header. The **information hierarchy is: verdict → book a call → visual proof → drill-down.** Inside Regulatory they see per-framework cards (regulator, binding label, evidenced breaches grouped by Article with their own site's quotes, obligations, real enforcement examples). SEO/GEO show measured on-page/PSI/keyword/entity gaps. Every **"Tamazia fix" is hidden behind a green lock veil**; clicking any of them jumps to **Route 3 — £495 to unlock the whole report** and start Regulatory Watch. There is **no way to download or share a PDF** — the report is a live web page only. If they pay, the webhook flips `unlocked`, the veils lift for everyone opening that link, and the edge stops caching it.

The experience is **credible, dense, and conversion-engineered**, but it is **prose-heavy, single-format (no export), and — critically — access-unprotected (dead HMAC) and schema-uncoupled from the engine.**