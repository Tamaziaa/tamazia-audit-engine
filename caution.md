# caution.md: the failure bible

Every pointer below is a real failure recorded in the old estate (tamazia-cowork-os + tamazia-website, May-July 2026), deduplicated across the discovery digests, the 9-audit failure catalogue, the 2-month forensic, DORMANT.md and the CLAUDE-LEDGER forensic digest. Form: what went wrong -> the mechanically-checkable rule that prevents it. Pointers are append-only, dated at the section foot, and walked against every phase diff by the Caution warden. A repeat of any pointer fails the phase.

---

## 1. Resolution (identity, jurisdiction, sector)

**C-001** Firm name derived from the domain stem in 7 separate call sites produced "Kingsleynapley" and "Bristol Office" as company names -> one identity resolver module is the only producer of firm name; any `domain.split('.')[0]`-style derivation outside it fails CI.

**C-002** A page heading ("Bristol Office") was mistaken for the firm name -> a resolved display name must share a token with the domain stem or be corroborated by a register match; otherwise fall back to the clean domain stem, never a page fragment.

**C-003** Slugs were minted from marketing page titles, leaking HTML entities into live URLs (`luxury-aesthetic-clinic-for-radiant-skin-amp-body`, `miami-x27-s-top-luxury...`) -> slugs derive only from the resolved legal/trading name; CI rejects any slug containing `amp`, `x27`, `quot` or other entity residue, and rejects slugs not producible from the identity resolver output.

**C-004** `register-grounding` accepted any HTTP-200-with-rows as a firm match, creating false establishment nexus -> a register match requires a real name match against the query, never just a non-empty API response.

**C-005** `mergeGrounding` stamped `established_source` even when the register did not establish that fact -> provenance is recorded only for the source that actually established the fact; a provenance field with no matching evidence row fails validation.

**C-006** A Miami immigration firm was assessed entirely under UK law (immigrationlawyersusa.com) -> jurisdiction requires agreement of independent signals (TLD, address, phone country code, currency, register); on conflict the mint flags and abstains, it never defaults to UK.

**C-007** `detectMarkets()` used a single weight threshold and produced a phantom UAE market for a London-only firm -> jurisdiction attaches only on one Tier-A signal (register/authorisation/registered office) or two independent Tier-B signals (office postcode, local phone, ccTLD-hreflang, currency); Tier-C prose signals never attach alone.

**C-008** Marketing reach and legal nexus were conflated in one field -> `serves` and `bound` are separate typed fields; law attaches off `bound` only, and no code path reads `serves` for attachment.

**C-009** `/incorporated in/` was anchored to no country, so 6 of 7 real UK/EU/UAE law-firm footers were judged "established in the United States" and Mills & Reeve (UK) was served US ABA rules -> every nexus regex must bind the evidence to a named country token; the nexus-anchoring gate stays blocking CI.

**C-010** "DIFC Courts" (a litigation venue mention) was read as DIFC establishment -> establishment evidence must be incorporation/registration/licence evidence, never a mention of a court, venue, or client jurisdiction.

**C-011** Knightsbridge.ae had DIFC and ADGM both attached (both wrong) from service-page keywords -> jurisdiction ties to where the firm is licensed/established (address, licence number), never to page keywords about places it discusses.

**C-012** A hotel was classified "media" because sector ran on raw HTML `<head>`/CSS/JS noise -> sector classification runs only on stripped visible text; a test asserts the classify slice contains no `<script>`/`<style>` content.

**C-013** A flat first-match keyword classifier let stray words win (`\bllp\b` made every wealth LLP a law firm) -> high-precision own-identity self-IDs run before any keyword list; keyword classification requires two independent cues.

**C-014** A law firm was classified ACCOUNTING because its practice-area content was thick with accountancy vocabulary -> a regulatory authorisation statement ("regulated by the SRA, no. 500046") decides sector outright, ahead of all inference; a firm writing about a regulator is not regulated by it.

**C-015** E-250 corrected the sector label but ran after connect() and rule selection, so the page said "law firm" while accountancy rules were checked -> the sector decision must precede attachment in source order, and a test drives the full order.

**C-016** An aesthetics clinic shipped as sector "General", losing its entire regulated pack (neuclinic) -> a mint with regulated-sector signals present (GMC/CQC/SRA/FCA tokens, register hits) may never ship a generic sector; it resolves or quarantines.

**C-017** A free state school was assessed under OfS (the HE regulator) plus consumer and company law (stmartinsepsom.school) -> sub-sector resolution is mandatory before regulator attachment: school is not university, mainland is not free-zone, B2B is not B2C.

**C-018** `connect()` said wellness→fitness while `sector.js` said wellness→healthcare: three engines, three sectors for one firm -> one sector ontology in one module; every taxonomy consumer imports it; the fact-lineage tracer asserts a single producer for sector.

**C-019** `region()` used `/^EU/` which matched "EUROPEAN" -> anchor every prefix test with a delimiter; lint stored prefix regexes against near-miss fixtures.

**C-020** Registered-country nexus was injected after the nexus filter, so a firm with no established family skipped the filter entirely and a Paris firm shipped FR/DE/IT/EU ghost families -> registration-as-establishment is injected before the filter; a source-order guard test locks it.

**C-021** `detected_jurisdictions` rendered empty when the crawl found no explicit signal -> fall back to registered country plus bound-framework jurisdictions; an empty jurisdiction block on a resolved firm fails the payload validator.

**C-022** Sixteen non-English pages (ramsaysante.fr) fed English disclosure regexes and fabricated a 16-breach GDPR cascade -> non-English sites gate to an honest `compliance_unassessed` state before any rule runs; language detection precedes classification.

**C-023** Sector tags in heavy use (`recruitment`, `care-homes`, `gambling`) had no canonical-tree key, so whole verticals were unreachable -> every tag used by any rule must resolve to a canonical tree node (with singular/plural aliases) or the catalogue linter fails.

---

## 2. Crawl & Evidence

**C-024** The corpus was cut at 4,000 chars (~600 words) so footer disclosures (russell-cooke's SRA string sits at char 11,080) fell past the cut and ABSENCE rules fired false accusations -> the corpus cap is generous and env-guarded; if truncation ever occurs, every "it is missing" claim is demoted to needs-review by an interlock.

**C-025** `MIN_PAGES_FOR_ABSENCE` and `CORPUS_MAX_CHARS` could be forced to 0 via env, silently zeroing the corpus -> safety floors are clamped in code; an env value below the floor throws at startup, never degrades silently.

**C-026** A 22-page (later 120) crawl cap exhausted on blog/commercial pages before policy pages were reached, fabricating absences -> Tier-1 legal pages (privacy, cookies, terms, complaints) are fetched before any commercial page and before any cap applies.

**C-027** `_discoverLinks` excluded any URL containing `?`, so CMS `/privacy?page_id=` pages were never crawled -> link discovery permits query-string URLs; a fixture site with query-string policy pages is in the crawl eval.

**C-028** A `must_appear` rule fell back to the whole corpus when its targeted `url_check` page was not fetched, asserting a fine on unread content -> a url_check rule fires only if its page was actually fetched; unfetched target -> `target_unfetched`, no finding, no fine.

**C-029** The reconciliation gate checked site reachability, not per-rule page coverage -> every rule declares the page-class it needs; missing page-class -> screened, never breached (coverage-contract as blocking data, not reporting theatre).

**C-030** Findings generated from a years-old Wayback snapshot rendered as current breaches, and Dr Clayton's 2025-08-16 archive was sold as "live" -> `via_archive`/`snapshot` travels into finding trust; archive-sourced absence is needs-review with fines withheld, and headline copy derives from the snapshot field.

**C-031** `crawl-escalation` force-set `reachable=true` whenever a login/error page had length > 0 -> the reachable flip is guarded against login, challenge and error pages by content classification, not byte count.

**C-032** SPAs were never rendered, producing 22 unverifiable cookie findings on royalparkpartners.com and "missing banner" on sites with live Complianz banners -> if a page is not JS-rendered, no absence claim may be made about content that requires rendering; unrendered -> unverified, never breach.

**C-033** Footer-linked policy documents and external PDFs were never read (Lomond, Dutch & Dutch privacy/MSA/fees PDFs), producing false "missing" findings -> the crawler follows footer links including PDFs and parses them before any absence claim on those obligations.

**C-034** On-page footer text carrying the company number was never scanned, so Companies Act "missing number" fired on compliant firms -> footer text is a mandatory detection surface for registration-number and registered-office rules.

**C-035** Detection ran on raw HTML while the evidence quote came from stripped text, so hit and quote disagreed -> detection surface and evidence surface are declared per rule and must be the same corpus; a test compares them.

**C-036** A disclosure keyword inside a cookie-banner `<script>` counted as "having" the disclosure; inverting to all-visible then fabricated breaches on legit JS consent tools -> asymmetry is codified: triggers match visible prose only, required-mechanism presence is lenient (visible OR raw), and the choice is a per-rule declared field.

**C-037** Absence findings rendered for sites that were never actually read -> every fabrication-prone block is gated behind a real live-read (`siteScanned`) guard checked in the payload validator.

**C-038** A bot-walled site (jarir.com, empty corpus) was asserted against -> an unreadable site gets knowledge-mode output only: no findings, no fines, nothing asserted about content that was not read.

**C-039** The PECR breach (cookies before consent) is behaviour, not HTML, and the engine was structurally blind to it -> pre/post-consent browser observation is a first-class evidence lane; a non-essential cookie set pre-consent is a completed observed breach with the network event as artifact.

**C-040** `observe()`'s internal 30s goto timeout did not bound browser launch/networkidle and a stuck Chromium held a mint hostage for 752s -> every browser step is wrapped in a hard outer `Promise.race` deadline; a slow browser fails open on that step, never hangs the mint.

**C-041** `require('playwright')` threw in an unresolvable node_modules and the cookie layer silently did nothing for whole versions -> a missing evidence-lane dependency is logged loudly and recorded on the payload; the lane's absence is visible, never silent.

**C-042** Broken policy links (Roxana's dead /privacy-policy, D&D's broken cookie control) went uncaught -> a link-health check runs on every policy/consent control found; a broken control is itself a finding class.

**C-043** Shipping NonCommercial-licensed oracles (DuckDuckGo Tracker Radar, Ghostery, cookiedatabase.org) in a paid product would itself be a licence breach -> every bundled data source carries a licence field vetted as commercial-OK; CI blocks known NC/AGPL sources.

**C-044** `coverage-contract.classify` substring-matched "cost"→pricing and "feedback"→fees, over-crediting coverage and enabling breaches on unread content -> page-type classification uses path segments and anchored tokens, never loose substrings.

**C-045** A local sandbox `scan()` differed from the GitHub-runner mint because sandbox crawls are bot-blocked -> verification always runs against the minted `audit_pages` payload and the live URL, never a local scan.

---

## 3. Applicability

**C-046** The DB stored `rule_type='prohibited'` while the engine tested `=== 'prohibit'`, inverting every prohibition (clean firms flagged, banned-content firms passed) -> code matches the exact enum the DB stores; an eval drives ruleCheck with prohibit+present→breach and prohibit+absent→pass fixtures.

**C-047** Botox/U18, FTC fake-reviews, HMR and tenant-fees prohibitions leaked onto any clinic or firm in the sector -> prohibited-content rules require a real subject trigger match, never sector membership alone.

**C-048** A `must_appear` ASA rule on "no.1/best" fired when the phrase was ABSENT, and DG-02 found 5 rules breaching firms for NOT advertising what the regulator prohibits (MED_CLAIMS fired on any page containing "clinic") -> a rule-polarity linter proves every prohibition is typed `prohibit` and calibrates each against a boastful fixture (must fail) and a compliant fixture (must pass).

**C-049** 240 `trigger_then_check` rules had a trigger but no check regex, returning `unknown` and going mute (~36% of the catalogue) -> the catalogue linter fails any active rule that can neither produce a finding nor is explicitly marked attachment-only.

**C-050** 27 stored trigger patterns had corrupted escapes (`\b`→`b`, `\s`→`s`, so `b(bank...)` never matched "bank"), and DG-01 found dead-in-production P0 regexes (`dpo[@\s]`, `vat\s*(no)`, `\bPOM\b`, `FRN ?\d{6}`) that compiled, ran and matched nothing forever -> the regex-health linter proves every stored pattern matches its own intended positive token and rejects over-escaped forms; blocking CI.

**C-051** The engine canonicalised the firm's sector but compared against raw `sector_relevance` tags, silently dropping rules tagged `legal`/`wealth`/`health` -> canonicalise both sides of every tag comparison at the gate; a test feeds raw-tagged rules through.

**C-052** Barristers were bridged to `law-firms` so chambers inherited SRA solicitor rules; the bug lived in three files and was "fixed" while a copy remained -> node-exclusive frameworks (SRA vs BSB) bind their exact node only; and no mapping fact may have more than one producer file (one-door gate).

**C-053** FR_CNIL/DE_BDSG stored `jurisdiction='EU'` so national law leaked onto every EU member firm -> member-state law carries its ISO code; the attachment gate excludes other member states; a linter rejects national statutes tagged with a supranational code.

**C-054** National law also leaked via bare-token triggers (`|FR|`, `.de domain`) on unrelated prose -> national law gates on jurisdiction membership evidence, never on leaky token alternations.

**C-055** CCPA/CPRA/VCDPA/TDPSA attached to every US firm with no residency/volume nexus; separately, 134 US state rules could never attach because their consumer module was dormant -> threshold/residency-gated laws stay held until detection proves the nexus, and are rendered in an advisory tier when nexus is unprovable; never silently unreachable, never blanket-attached.

**C-056** CCPA and CPRA both attached although CPRA superseded CCPA -> the catalogue models supersession; the linter rejects attaching a superseded twin alongside its successor.

**C-057** `UK_COMPANIES_ACT` capability gate fired on the adjective "limited" ("limited availability") -> entity gates anchor to company-name/number context, never bare words.

**C-058** Consumer-law gates fired on "book a consultation"/"our customers", re-attaching consumer law to the B2B firms it meant to exclude (also RPP, a B2B fintech, got consumer law) -> consumer law requires B2C transaction evidence (pricing, cart, consumer signals), not ubiquitous business language.

**C-059** `signalSatisfiesTrigger` substring-matched "post"→postcode and "pay"→payroll -> trigger tokens are word-boundary anchored; substring matching against a rule pattern string is banned by lint.

**C-060** `ugc:true` alone attached FTC fake-reviews with no reviews present -> a structured signal never satisfies a content trigger without a real subject match in the corpus.

**C-061** UAE_DHA attached to health firms in every emirate, and DHA+DOH+MOHAP all attached to one Abu Dhabi clinic -> emirate-scoped capability gates with per-emirate health-authority exclusivity; attaching two emirate authorities to one establishment fails the linter.

**C-062** SAUDI_PDPL/QATAR_PDPPL failed to attach to Saudi/Qatari firms because a redundant capability gate was demanded -> jurisdiction membership IS the nexus for a home data-protection law; no extra gate required.

**C-063** The nexus family map covered only UK/EU/US/AE, so 8 routed jurisdictions' nexus gate was a silent no-op -> the family map must cover every routed jurisdiction or the gate fails closed; a completeness test enumerates them.

**C-064** DIFC/ADGM could not be distinguished from onshore AE, and free-zone law stacked with UAE_PDPL -> free-zone establishment is a distinct typed nexus; DIFC_DPL/ADGM_DPR displace UAE_PDPL, never stack.

**C-065** Citation-presence pseudo-rules ("Section 3 personal data definition disclosure"), seeded to satisfy a text-uniqueness QA gate, masqueraded as duties -> rules are optimised for legal correctness only; citation-presence non-duties are quarantined by the linter.

**C-066** Trade bodies (UK_ABI, RICS, Portman) rendered as binding statute, and GOOGLE_EEAT/UK_NMC were mislabelled `statute` -> every framework declares binding_status (statute / statutory_code / professional_code / voluntary_code); the linter cross-checks peer regulators for consistency.

**C-067** `specificityRank` treated empty `sector_relevance:[]` as universal, so a sector law lost a lex-specialis tie -> "empty relevance (data gap)" and "genuinely universal" are distinct states in the schema.

**C-068** The framework list was built only from findings, so a law that bound but was clean never rendered, and `REG_CAP=10` dropped clean binding laws (PECR vanished) -> every law in the binding map back-fills into the render set; caps govern discretionary rows only; a test asserts a clean-but-binding law renders.

**C-069** `fwSectorOK()` silently removed sector-agnostic laws (EC Directive Regs 2002, Legal Services Act 2007) from every audit because they lacked a baseline entry -> an invariant asserts every baseline/universal law is in the universal set; a sector-agnostic law without an explicit baseline entry fails the linter.

**C-070** `US_CDC_ART_REPORTING` hit dermatology via the bare tokens "art"/"clinic", and a `US_STATE_PRIVACY` catch-all double-covered named state acts -> tokens are scoped to the sub-sector; catch-alls are deactivated where named acts cover the ground.

**C-071** Modern Slavery Act applied to sub-£36m SMEs in 5 of the 9 forensic audits -> `excluded_when` thresholds (turnover, size) are first-class schema fields the gate enforces; the SME fixture is in the calibration corpus.

**C-072** Companies Act s.82 fired on a sole trader and on firms whose number was visibly in the footer -> the rule requires an Ltd/LLP signal AND absence of a disclosed number after footer/PDF scanning.

**C-073** PECR and "ICO Cookies Guidance" were counted as two breached regimes for one statute -> frameworks mapping to one statute dedupe before counting and before exposure.

**C-074** The wrong instrument within the right regulator was attached (FCA MAR to a fin-promo matter; DfE Prevent to a publication-duty matter) -> the catalogue maps sector to the correct sub-instrument; an instrument-level fixture per priority regulator is in the golden set.

**C-075** Correctly-tagged firms received only generic web-law because sector packs were missing (estate agency lost the entire property pack and got an F while displaying TPO/ARLA/CMP compliance) -> every priority sub-sector cell either has its pack or the audit discloses the coverage gap; grade credit is given for displayed redress/licence/AML badges.

**C-076** When two laws conflicted the engine attached both because the lex-specialis tie-break module was dormant -> conflict precedence is a reviewed legal decision wired into the attachment path, with the review recorded; attaching both sides of a modelled conflict fails the validator.

**C-077** The rigorous attachment engine (`resolveLaws`) was an orphan called only by QA while the live path used a weaker `connect()` -> there is exactly one attachment authority and both the mint path and QA call it; the reachability gate proves it.

---

## 4. Breach & Adjudication

**C-078** A bare-word regex over raw HTML accused a real criminal-defence firm of being HACKED ("sex discrimination", `<slot>`, "pornography offences") -> site-compromise detection keys on injected outbound anchor links (off-site, spam-brand, cluster ≥3), never body prose; the mills-reeve-class fixture is in calibration.

**C-079** Every breach ever sent was an unreviewed regex match: the LLM gate verified WHICH laws attach, never WHETHER they were broken -> the pipeline is propose (regex/DOM/register) -> verify (deterministic artifact) -> adjudicate (LLM); only adjudicated breaches ship.

**C-080** No deterministic artifact stood behind findings -> no artifact, no breach: every shipped breach carries a verbatim quote string-matched to the corpus, a captured network event, a register row, or a failing DOM node; the payload validator enforces the artifact field.

**C-081** The adjudicator's verdict died at the findings→pointers whitelist seam (0 pointers carried `adjudicated`) -> every verdict field is asserted to survive end-to-end from adjudicator to payload to rendered DOM; a field-survival test walks each seam.

**C-082** Uncertain items shipped as hard breaches -> three output states only (violation / needs-review / pass); nothing uncertain ever ships labelled breach, and needs-review renders in observation language with fines withheld.

**C-083** Unadjudicated high-risk findings could reach clients when every LLM provider was down -> any unadjudicated P0 or prohibit finding is demoted to needs-review; the adjudicator is filter-only (remove/downgrade, never invent), tested against a hallucinated-id fixture.

**C-084** The adjudicator dropped a real observed PECR breach because the network log was not in the text it saw -> browser-observed and register-observed facts bypass text adjudication; `observed_fact` is a distinct evidence kind.

**C-085** `_kindOf()` mapped every compliance finding to `absence`, so browser observations were structurally incapable of confirming and every audit shipped with zero compliance findings (birketts went 0→18 on the fix) -> evidence kind is a declared enum (document-absence, document-presence, observed-behaviour, register-fact) and confirmation logic branches on it; a fixture per kind is in the golden set.

**C-086** An ambiguous LLM entailment verdict ("Unclear, leaning no") matched neither branch and the finding stayed CONFIRMED with its fine -> unparseable or ambiguous verdicts default to withholding the accusation, never to keeping it.

**C-087** A P0 "your site is hacked" shipped with no citation and no page reference -> every P0 accusation carries locating evidence (URL + quote/artifact) and a citation; the citation gate blocks the mint otherwise.

**C-088** An SEO/GEO pointer factory produced findings with no `citation_url` on a legal-flavoured audit -> every finding carries a citation; citation-less breach cards are suppressed at the validator, not styled around.

**C-089** Quotes under 25 chars and nav fragments passed as evidence -> evidence quotes have a minimum length, must be verbatim-anchored in the fetched corpus, and are attributable to exactly one page (never merged across pages).

**C-090** Breach phrases inside testimonials were treated as the firm's own claims -> testimonial/review content is segmented out of the claim-detection surface; a testimonial fixture is in calibration.

**C-091** "Injected spam" accusations fired from template text without verbatim URLs -> template-accusation guard: an injection claim requires the specific injected URLs quoted verbatim.

**C-092** NO_BREACH verdicts were accepted without proof -> every NO_BREACH must carry a verbatim disproof quote from the supplied evidence or the rubric scores it 0.

**C-093** GDPR fired 6 criticals on a thin-but-present privacy policy -> presence-but-thin is a distinct, lower-severity finding class from absence; the severity map is calibrated per regulator posture.

---

## 5. Exposure & Fines

**C-094** Statutory maxima were summed additively ("your exposure" = 5 × £17.5M GDPR) -> one ceiling per framework family, deduped; the headline is the median of the typical enforcement band, never a sum of maxima.

**C-095** A £5M "MAXIMUM STATUTORY PENALTY" headline appeared nowhere else on the page -> the headline number must be traceable to a band printed on a specific breach card; a render test asserts headline-to-card traceability.

**C-096** Exposure headlines used the statutory cap verbatim (£18M on a school, £16M on an SME) -> exposure derives from per-law typical bands scaled by enforcement reality, capped at the turnover-rescaled ceiling; raw statutory caps never headline.

**C-097** The GDPR £17.5M cap was applied to a PECR matter (cap £500k) -> the cap comes from the specific law's own catalogue row; a cross-law cap borrow fails the validator.

**C-098** A UK firm was shown $5.7M USD exposure -> currency follows the binding regime of each fine (statutory currency per regime); no invented FX; a home-currency total states its conversion basis once; no figure is ever currency-ambiguous.

**C-099** Fine rates and collapse families were hardcoded regexes (`fineRate` missed UAE_DHA/UK_BSB; `DP_FAMILY` missed a new code and inflated exposure) -> fine basis, percentage rates and family-collapse sets derive from catalogue metadata, never from code-side regex or hand lists.

**C-100** Fine reads stayed pinned to a legacy field name (`fine_high_gbp`) and silently collapsed to £0 after a migration -> the payload/render contract validates required fine fields against the current record shape and fails loud on a missing field.

**C-101** A voluntary-code framework could render a statutory fine -> fine/enforcement wording is suppressed whenever binding_status is voluntary, independent of any bucket routing.

**C-102** The £17.5M fine was fixed in the DB and never reached the client because three code files kept their own copy -> the catalogue is the only source of a fine, a regulator name, or a law title; a repo-wide gate fails CI on any monetary/regulator/law-name literal in engine or renderer source.

**C-103** The renderer's `estimateTurnover()` invented firm revenue from sector keywords × DA and rescaled every statutory fine with it -> turnover estimation lives in the engine with its inputs recorded, is labelled "estimated" wherever shown, and a keyword miss falls back to abstention, never a silent 100× mis-band.

**C-104** The SRA fining limit shipped as £2.6M when it is £25k for traditional firms, and a "£25,000+ consultancy quote" was invented -> no legal number enters the catalogue or a document from memory; every figure carries a source URL verified at authoring time.

**C-105** Severity was inflated to critical for matters regulators handle by reprimand (CMA/Equality criticals on a sole practitioner) -> severity banding reflects the regulator's enforcement posture per sector; the enforcement-intel table is populated (human-gated, provenance-mandatory) before posture claims render.

**C-106** "The regulator can act today" language shipped on items never enforced against SMEs -> enforcement claims render only when a real, cited enforcement row exists for that regime and firm class.

---

## 6. Consistency & Rendering

**C-107** Engine and renderer were 61% change-coupled with no shared schema; the contract lived in prose comments and ~1,000 defensive reads -> the payload schema, `payloadToD()` transform and D-contract validator live in one versioned package owned by the engine repo; the website imports it and re-derives nothing; any payload change and its transform change land in the same commit.

**C-108** `_contract.js` existed but was never imported by the render route, so runtime had no contract enforcement -> the render route validates the payload against the contract at runtime, fail-closed; an invalid payload renders an honest error page, never a partial report.

**C-109** `craftFix` re-derived fixes at render by keyword substring ("fee" in "data-protection-fee" → pricing fix) -> the fix is a typed field bound to the finding's control at generation time; the renderer formats, never re-derives; the fact-lineage tracer asserts the renderer introduces no facts.

**C-110** The whole evidence-ledger contract (binding/drop_trace/review_candidates/violated) shipped and the renderer ignored every field -> a producer contract is not "delivered" until a consumer reads every field; a contract-consumption test enumerates fields both ends.

**C-111** The `violated` flag was ignored, so attached-but-not-violated law counted as breached, and low-confidence review-band attachments rendered as hard breaches -> "breached" derives only from `violated`; review-band items render distinctly from confirmed breaches.

**C-112** `FW_NAME_CAT` was a frozen 285-code snapshot so new codes rendered as "Uae Newcode", and "Sector regulator" literally printed in the Regulator column on 51% of the catalogue -> names and regulators derive from the catalogue shipped in the payload; hardcoded name/regulator maps in the renderer fail CI; unknown -> omit, never a placeholder string.

**C-113** `FW_JUR` returned GLOBAL for any unrecognised prefix, so a mis-prefixed statute showed on every firm -> unknown jurisdiction resolves to screened, never GLOBAL; GLOBAL is an explicit catalogue value only.

**C-114** ~55 hardcoded enforcement blurbs (`PORTED_NEWS`) were baked into the renderer and rot with time -> enforcement stories come only from the payload's provenance-carrying intel; render-side news maps are banned.

**C-115** Framework cards rendered hollow (FRC/HMRC/ICAEW with no obligations, no enforcement) and invented filler ("regulator actively enforces this regime") printed when intel was missing -> a card earns its place: breached always renders; screened renders only with real obligations or a cited enforcement row; filler strings fail the render truth-pack.

**C-116** Three non-statutory bucket lists drifted inside the renderer until a Core Web Vital carried the literal string "enforcement action" -> one canonical `isNonStatutory` predicate; an SEO/performance metric can never carry enforcement language (a truth-pack assertion).

**C-117** Exec summary, `frameworksBinding` and `frameworksAssessed` showed three different framework numbers on nearly every audit, and the headline conflated critical-count with breached-framework-count ("4 breached" was the critical count) -> all displayed counts derive from one counts object with `criticals` and `breachedFrameworks` as separate fields; the truth-pack diffs every rendered number against the payload.

**C-118** "All 400+ frameworks screened" overstated coverage, and the deploy gate enforced a `400+` string the renderer had already abandoned as false -> coverage copy states "screened the catalogue; N bind you" from live counts; deploy gates assert data-driven values, not magic strings that rot.

**C-119** Jurisdictions were claimed in copy with zero frameworks attached ("UK and US", 0 US frameworks), and `jurisdiction_statement` told a UAE firm CCPA applies -> a jurisdiction is named only if ≥1 framework actually attached for it; the statement is grounded in the attached set only.

**C-120** `decodeDeep` re-introduced raw `<`/`>` across all rendered strings after the tag strip (stored-XSS-adjacent), and `errorShell`/sector INSERT interpolated values unescaped -> escape, never decode, before injection; strip `[<>]` after any decode pass; every SQL and HTML sink is parameterised/escaped and the silent-swallow/injection lint covers both repos.

**C-121** The website asset version `_av='r37'` was hand-maintained and never bumped, so the 4h edge cache served stale bundles while origin was fixed -> asset versions derive from the deploy commit SHA; a hand-maintained version string anywhere in the render path fails CI.

**C-122** The HMAC access block was gated on an unbound secret, so an 8-char hash was the only gate while the code read as protection -> dead security code is deleted or wired, never left as theatre; the per-recipient HMAC is enforced end-to-end with the signed format tested from mint to route.

**C-123** Superseded audit pages continued to serve 200 as if current, and row 10564 (freeths) sat `status='live'` with `archived_at` set, an impossible combination -> superseded pages redirect to the latest generation; status and archived_at are coupled by a DB constraint or transition function so partial supersessions cannot persist; a freshness assertion is in the truth pack.

**C-124** A JSON check repeatedly "proved" a render that was wrong in the browser -> the browser, not the JSON, defines shipped: a Playwright word-by-word truth lane asserts every rendered claim exists verbatim in the payload and no non-catalogue fine/regulator/law-title appears, on every PR.

**C-125** A `compliance_unassessed` flag was written that nothing read -> a flag is worthless until a consumer reads it end-to-end; wiring engine→payload→renderer is part of the definition of done for any new flag.

**C-126** For a £495 deliverable there was no PDF, print, share or copy affordance at all -> deliverable export is a product requirement with its own render test, not an afterthought.

---

## 7. LLM Usage

**C-127** The self-learning loop invented statutes with fake citations ("Cookies... Regulations 2020" with three different invented legislation.gov.uk URLs; the repealed Disability Discrimination Act 1995): 151 candidates yielded zero promotable law -> a discovered law persists only when its citation fetches 200 on an official legislative domain AND the page content IS that law; repealed names are rejected by list; unverifiable is a terminal state.

**C-128** The "official-URL gate" only checked that a URL string was present, never fetched it -> a provenance gate must fetch and content-verify the destination; syntax checks are not verification.

**C-129** legislation.gov.uk answers HTTP 202 with an empty body to ANY URL shape, so the status-code gate passed every fabrication -> 202/empty-body is never proof; require a definitive 200 with matching content, with 202-polling so throttling is not mislabelled fabrication.

**C-130** The verifier could not distinguish a throttled real statute from a fabricated one and called the real Equality Act fabricated -> three-state verdicts everywhere (verified / rejected / unverifiable): refuse to promote what you cannot prove AND refuse to accuse without evidence.

**C-131** The cross-verifier quarantined perfect audits (flagged SRA on an SRA-regulated solicitor, called GOOGLE_EEAT "foreign family, no nexus", invented an EU family on a UK firm) -> the LLM may veto nothing it cannot know better than the catalogue: SECTOR_CORE and SECTOR_AGNOSTIC sets are immune on every leg, GLOBAL frameworks are immune by definition, and a flag requires a citable contradicting fact or it becomes abstain/route-to-human.

**C-132** Guards added to the main verifier leg were repeatedly missed on the quorum leg (E-228/E-241/E-249 each re-broke) -> when logic forks into legs, guards live in one shared code path both legs call; a test drives both legs against the guard fixtures.

**C-133** Both "cross-check" models hit the same provider (Groq), so the quorum was correlated, not independent -> quorum legs must use genuinely different model families/providers, asserted by config test.

**C-134** LLM prompts interpolated raw web regulatory text inside `"""`, so prompt injection could fabricate a penalty both models agree on -> untrusted text is sanitised and DOC-delimited in every prompt; an injection fixture is in the LLM eval harness.

**C-135** `gemini-2.0-flash` was retired on 1 June yet 8 references still called it (the leg silently failed for weeks and the first "fix" never actually merged), and separately an OAuth token was mistaken for an API key, 401ing forever -> model IDs live in one config with a scheduled liveness probe; provider preflight validates key type and executes one real call at startup; a provider that cannot complete a call is marked absent loudly, never silently degraded around.

**C-136** The documented Claude Haiku "paid safety net" was fully implemented but wired into no chain -> every declared fallback appears in an actual chain; a config test enumerates chain membership against documentation.

**C-137** Gemini calls never set a JSON response format, relying on prompt-only JSON (the most parse-fragile lane) -> every JSON-expecting call sets the provider's structured-output mechanism where it exists; schema-validated parse with typed failure.

**C-138** Free tiers 429'd under batch load (measured 71 fail / 1 ok in 20 minutes) and every gate attempt walked a chain of rate-limited providers burning 30s × 3 retries × 3 attempts, holding mints for minutes for answers that were never coming -> quota-aware routing with per-call timeouts sized to reality, hard per-stage `deadline_ms` budgets that are caps never floors, and no backoff after the final attempt.

**C-139** Null LLM results were never cached, re-hitting quota'd APIs on every call -> negative results are cached (bounded, TTL'd) alongside positives.

**C-140** Law discovery spent mint wall-clock -> learning loops are fire-and-forget side channels; nothing in the mint path waits on them.

**C-141** `geo-probe` shipped client-facing competitor names and share-of-voice from ungrounded free generation -> generation surfaces that create client-facing facts require grounding (search-cited sources); when grounding is unavailable, render nothing (abstain), never model recall.

**C-142** `hallucination.js` shipped a "negative sentiment" finding from the model's own memory -> any negative claim about a firm sourced from a model requires grounded citations or is dropped; only the fail-safe direction ("no reliable info") may ship ungrounded.

**C-143** `fix-writer` ran at temperature 0.6 on client-facing prose, the loosest knob reaching a client -> client-facing generation temperature is capped low by config test, and rewrites are constrained to phrasing with a claims diff-guard.

**C-144** The LLM sector, once it named any anchored enum, single-handedly unlocked a regulated pack -> a fact-creating LLM output requires corroboration by an independent deterministic signal (self-ID, register, domain profession) before it changes attachment.

**C-145** Model self-confidence was almost used as a quality signal -> gate rubrics are deterministic only (schema, enum membership, verbatim anchoring, cross-signal agreement); self-reported confidence is never a rubric input.

**C-146** Temperature 0 was assumed deterministic -> temp 0 is not deterministic; every LLM call logs prompt version, model, inputs and raw output, and the eval harness gates every prompt/model change against a fixture corpus (≥60% drawn from real production failures) on precision and abstain-rate.

**C-147** The LLM was positioned to author facts -> the LLM never authors a fact: it selects and judges inside the catalogue's closed world, quotes verbatim or abstains; retrieval-gated emission, verbatim re-match, NLI entailment, abstain-by-default floor and diverse-jury veto are the standing AND-chain, each fail-closed.

---

## 8. Gates & Testing

**C-148** 77 evals stayed green while two mint-killing bugs shipped (a ReferenceError, then a TDZ error) because not one eval ever executed `buildPayload()` -> every eval suite includes a smoke test that executes the real entry point; tests that assert on source text are not counted as coverage.

**C-149** The coherence gate reported 0 silent swallows while an AST found 55, and an AMD64 actionlint binary on an ARM box "found" 0 forever -> calibrate every analyser against a known-bad input on every run; a zero the gate did not earn fails the gate itself.

**C-150** Mutation testing showed the modules deciding what may be quoted to a law firm were 41% guarded while line coverage said 100% -> Stryker mutation thresholds are blocking CI on scanner, adjudicator and verify modules; coverage percentage is never accepted as proof.

**C-151** A bare `catch(_e){}` around the compliance scan minted a clean bill of health that was never computed, and three evidence layers threw ReferenceErrors swallowed by fail-open for two whole versions -> the silent-swallow AST gate is repo-wide and blocking; a ReferenceError is recorded as `BUG:<msg>` on the payload and can never fail open.

**C-152** Mandatory gates ran after the R2 payload was persisted, `llmPreflight()` failed open, and the jurisdiction stage was marked `ran` unconditionally -> all mandatory gates run before any persist, fail closed, and a stage may only report `ran` from inside its own executed body.

**C-153** Module-scope `_WARN`/`_SWARN` singletons were never reset between builds, so warning counts were wrong for every audit after the first -> no module-scope mutable state in the mint path; per-invocation state objects only, enforced by lint.

**C-154** `citation-gate.js`, `statute-rag.js` and 7 more modules (554-691 lines of correct legal logic) were merged, tested and never called: the gate built to block unevidenced monetary claims had never executed once -> the reachability gate: every audit-path module is reachable from the mint entry point in the static require graph or listed in DORMANT.md with reason and owner; CI fails otherwise.

**C-155** Wiring `gateMint()` as-is would have deleted every fully-cited PECR finding because it keyed violations by framework while the filter keyed per-finding -> before wiring any dormant gate, prove its filter behaviour on a fixture with known expected drops; keying identity is per-finding.

**C-156** `applyCoverage()` filtered on `f.status` while pointers carried `state`: a no-op that looked like a filter -> two modules reading one field share one typed contract; a round-trip test feeds real records through every filter.

**C-157** `matched_law_ids` was read as JSON by one module and jsonb by another, a silent total no-op depending on column type -> shared columns carry one declared type contract tested by both consumers.

**C-158** A passing generic e2e was mistaken for proof of a new sector's correctness (the SRA-on-barristers leak) -> every taxonomy change is verified against a real firm's rendered framework set, then locked with a systematic CI guard.

**C-159** An equality test would have forced the richer registry to byte-match a narrower flawed legacy -> retire legacy via shadow-gated repoint (prove old⊆new, accept improvements), never byte-equality.

**C-160** Golden fixtures nearly leaked prospect PII into the public repo -> committed fixtures are structural-only and pseudonymised; raw payloads stay gitignored as the local shadow oracle.

**C-161** Lone-tool findings were treated as facts -> ACT requires ≥2 independent tools corroborating; a single-tool finding is a lead, never auto-fixed.

**C-162** 160 SRI alerts were dismissed as "false positive" in one blanket sweep, and 322 alerts were dismissed "won't fix" -> dismissals are per-item with a written reason; a blanket dismissal fails review; "won't fix" is logged as risk-accepted, never counted as refuted.

**C-163** CodeScene refactoring-goal gates were enabled with no goals defined -> a gate that cannot fire is theatre; every enabled gate must be demonstrably able to fire (calibration fixture or seeded violation).

**C-164** No regression caught a silent product change (finding counts, fines, firm names drifting) -> the golden-audit regression suite pins one real payload per cell; any diff in a finding count, fine, or name fails CI unless explicitly accepted.

**C-165** The engine had no adversarial coverage of fabrication -> red-team fixtures that try to make the engine fabricate (fake statutes, injected prompts, hallucinated ids) run in CI and every gate must catch its class.

---

## 9. Data & Pipeline

**C-166** `scanner_cache` keyed on ENGINE_VERSION replayed stale scans, so merged fixes never executed and "it's fixed now" was false four rounds running -> for a legal-evidence engine there is NO scan cache; a day-old scan dated today is not evidence.

**C-167** ENGINE_VERSION was not bumped on scan-logic changes, silently replaying pre-fix behaviour through idem keys and verdict caches -> CI fails any scan-logic PR that does not bump ENGINE_VERSION; the version is inside every idem/cache key.

**C-168** `DELETE ... WHERE domain='x.com'` matched nothing because the column stored a composite cacheKey -> operational deletes are written against the actual stored key format and verified by row count.

**C-169** `loadCatalogue` cached a partial catalogue (290 frameworks, 0 rules) after a query hiccup, so zero frameworks attached process-wide -> never cache a partial catalogue; a load with empty rules or frameworks throws.

**C-170** `pg()` returned null/'' on any psql failure, indistinguishable from no-rows, producing false-clean audits on a Neon blip -> transport failure and empty result are distinct return states; a DB fault fails the mint closed.

**C-171** Silent catches around jurisdiction profiling fell back to raw keyword codes, re-introducing US-law-on-UAE-firm noise -> on profiler failure, fall back to registered country only; raw keyword codes are never a fallback.

**C-172** A process-global enforcement cache had no TTL, pinning stale legal data for the process lifetime -> every long-lived cache of mutable legal data declares a TTL and an invalidation trigger.

**C-173** An unclamped recency score let a future-dated (2099) enforcement row outrank every real case -> clamp both ends of every score; reject implausible future dates at ingest.

**C-174** `parseAtom` used `<link href>` for RSS feeds (text node) and 2 of 3 feeds were HTML: silent zero events forever -> feed parsers match the actual format, derive stable entry ids (guid), and a zero-event streak alerts.

**C-175** `fetchFeed` slept after the final attempt and retried permanent 404/410s -> no backoff after the last try; permanent statuses are never retried.

**C-176** 1,004 of 1,006 queue rows said "done" with no page, and 412 lead records carried audit URLs returning HTTP 404 -> a mint is done only when the DB row exists AND the URL returns 200 AND the Playwright truth pass succeeds; a scheduled reconciler diffs queue vs pages vs leads and alerts on any drift.

**C-177** A stub payload lacking `llm_verify` was writable, and a version gate placed only in `build()` could not stop a pre-gate rogue worker (the v19 Hetzner cron kept claiming and burning queue rows) -> the lock lives in the database: a BEFORE-INSERT trigger rejects non-conforming rows and enforces `required_engine_version` plus a global kill switch that every minter must pass.

**C-178** A stale idem_key with `ON CONFLICT DO NOTHING` adopted an old row while the queue said "done", and a 20s hardcoded HTTP timeout made large payloads' failures masquerade as idempotent conflicts -> exactly-once writes via deterministic idem_key (version included) + UNIQUE index + adopt-by-key; a transport failure returns a distinct `{transport}` state that can never look like a conflict; timeouts are sized to the payload.

**C-179** A worker raced `build()` against a timeout, retried, and the abandoned build INSERTed late, creating duplicate rows -> the build deadline is a cap that cancels the work, never a race that abandons it.

**C-180** A statement over 128KB could not ride execFileSync argv -> large statements route through a file (`-f`) leg by size check.

**C-181** A write failed four times with "no row written" and no cause -> the write seam dumps HTTP response, idem_key, row existence, gate-field presence and payload size on failure; a causeless error is itself a defect (a failure must explain itself; truncating an error to 160 chars cost four sessions).

**C-182** `verify-backlog` timed out 11 times a day at its 20-minute ceiling, leaving live pages `verified=false` indefinitely -> recurring job timeouts are incidents, not noise: jobs are chunked to provably clear their window, and a repeated-timeout alert exists from day one.

**C-183** Dispatching a mint while an older run drained queued the new mint behind old code -> the DB version gate makes stale code unable to write; dispatch logic cancels or defers, never stacks blindly.

**C-184** Raising MINT_CONCURRENCY while adding LLM calls 429'd the free tiers (71 fail / 1 ok) -> concurrency changes are benchmarked against provider quotas before merge; adding LLM load and raising concurrency in one change is banned.

**C-185** A 45-second floor (`Math.max`) on the SPA-render tail and fully-sequential sitemap discovery made every mint slow regardless of the site; the crawl fix (E-236) took anthonygold from >43s timeout to 6.9s with identical accuracy -> every budget is a cap, never a floor; discovery fans out in parallel; a per-stage latency report ships with every mint.

**C-186** `mint-now` cancellations were misread as "workers being killed" when they were redundant duplicate dispatches correctly discarded -> understand the concurrency group semantics (and write them down) before "fixing" scheduler behaviour.

**C-187** The queue stored `country` as USA/UAE while pages stored US/AE, and queue sector diverged from published sector -> one canonical enum for country and sector shared by queue, pages and leads; the reconciler flags divergence.

---

## 10. Process & Repo Discipline

**C-188** The same fact was fixed in one file while other producers kept shipping the stale value (barristers mapping lived in three files; the fake-hacking fix was "done" while cache and asset-version staleness re-served it) -> the stale door is the one the client sees: the one-door gate blocks CI on any fact with more than one producer, and every fix search enumerates all producers before "fixed" is claimed.

**C-189** Fixes were reported "done" against in-loop assumptions (the 17-node sector insert silently skipped three times while reported done) -> done is verified at the end against ground truth: git diff, DB row, live payload, live URL.

**C-190** A commit was never pushed before a REST-API PR, so PR #114 merged empty and "deploy success" shipped nothing -> push the branch, confirm a non-empty diff, and verify the changed string on the live surface after deploy, every time.

**C-191** A staged migration would have downgraded live data (the promote-JSON candidate would have dropped 184 frameworks; A13 already had 12 granular rules) -> re-check live state before applying any staged candidate and prove old⊆new (no loss) first.

**C-192** Yesterday's plan said citation-gate was "30 lines, just wire it"; the live payload proved wiring it would silently delete valid findings; planning documents also disagreed on the catalogue size (664 vs ~403 rules) -> read the live payload, the live code and the live database before trusting any plan document; counts are queried at time of writing, never quoted from another document; plans are leads, payloads are facts.

**C-193** 480 of 525 PRs merged with zero review, and the three hotspot files rotted to health 1.30-2.08 while absorbing 24% of dev effort -> every tool in the sweep runs from commit 1 on every PR; hotspot health decline blocks merge; no file grows past single-purpose size.

**C-194** Correct fixes made code less healthy (signals.js fell 10→8.07) and half-applied fixes were worse than none (E-250 label-only) -> a fix lands whole (all seams, all legs, all copies) with its eval, or it does not land; health deltas are reviewed alongside correctness.

**C-195** Dead duplicate files misled readers (`jurisdiction-router.ts` 5-sector stub beside the real 40-sector `.js`; `groupFindings` exported and never called) -> dead code is deleted (with a backup tag) or listed in DORMANT.md; "single source of truth" modules that nothing calls fail the reachability gate.

**C-196** A leaked webhook secret persisted verbatim in a harvested review snapshot inside the repo -> nothing matching a secret pattern is ever written to any file in this public repo; a secret-scan gate blocks commits, and any leak triggers rotation, not deletion-only.

**C-197** Golden work was verified against stale on-disk clones instead of GitHub main -> only the latest main is edited or trusted; on-disk copies are reference-only and marked as such.

**C-198** The knowledge that could have prevented repeats sat scattered across 2,040 ledger lines -> caution.md is append-only with dates; every phase diff is walked against every pointer by the Caution warden; any repeated pointer fails the phase; new failures are appended within the phase that discovered them.

**C-199** Ported modules arrived without their tests and history ("proven" only by reputation) -> every module ported from the old estate arrives with its eval fixtures and a note of the ledger entries it earned; port without eval fails review.

**C-200** Findings were phrased as adjudicated legal conclusions -> findings ship as evidence-quoted factual observations plus risk indicators ("detected X; this may implicate Act §Y, penalty band Z") with a standing not-legal-advice line; conclusory phrasing fails the render truth-pack. If you would not assert it in a tribunal, do not render it.

---

## How this file is used

1. **The Caution warden owns this file.** At the end of every phase, the warden walks the entire phase diff against every pointer above. Each pointer is concrete enough to check mechanically: a reviewer (human or agent) can hold a diff hunk against the rule and answer yes/no.
2. **Any repeat fails the phase.** If a diff re-introduces a failure class recorded here (the same mechanism, not merely the same file), the phase exit gate fails regardless of every other green signal. There is no severity negotiation on repeats.
3. **Pointers are append-only, with dates.** Existing pointers are never edited or renumbered (typo fixes excepted). New failures discovered during the rebuild are appended to the relevant section with the date and phase in which they were found. Deduplication happens at append time: if a new failure is an instance of an existing pointer, the existing pointer's citation is extended instead of adding a duplicate.
4. **The seed set (C-001 to C-200) is dated 2026-07-16**, mined from: digest-claude-ledger-forensic.md (135 raw pointers), digest-findings-bible.md, digest-plan-docs.md, digest-architecture-canon.md, digest-live-estate.md, digest-website-render.md, digest-llm-callsites.md, AUDIT-ENGINE-FAILURE-CATALOGUE.md (the 9-audit A1-G3 taxonomy), AUDIT-ENGINE-2-MONTH-FORENSIC-2026-07-14.md (the 5 earned rules and 12 recommendations), and the old repo's DORMANT.md.
5. **Aman reviews this file monthly.** The warden's per-phase report lists which pointers were exercised by the phase diff, which fired, and which new pointers were appended.
