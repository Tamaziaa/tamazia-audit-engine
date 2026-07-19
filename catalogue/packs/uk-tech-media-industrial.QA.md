<!-- qa-approval pack_sha256=7fd65149f069ffbb737f61290c8b9bbdd5b06f1d05fb98d8f9775ef059e684d8 verdict=changes_requested reviewed=2026-07-19 -->
Integrity attestation and adversarial legal-QA record (independent QA verifier, 2026-07-19). This attests that all 24 records were adversarially reviewed against official sources, and that the pack_sha256 in the header above matches the current pack bytes. The verdict token is deliberately `changes_requested`, NOT `approved`: two records carry compile-BLOCKING citation-completeness errors and several others need corrections first (see "Compile gate / header state" and "Orchestrator decision"). It is NOT a release approval and it does NOT graduate the pack. Release requires the fixes below, a re-stamp to `verdict=approved`, CI-green, plus founder (Aman) phase sign-off at PR merge.

## Compile gate / header state (read first)

**How the pack is excluded today.** `catalogue/compile.js` `discoverPacks()` compiles a pack ONLY if a same-named `.QA.md` sidecar exists that STARTS with a valid, current `<!-- qa-approval ... verdict=approved ... -->` header whose `pack_sha256` matches the pack bytes (`catalogue/qa-approval.js`, `QA_APPROVAL_RX`). Until this file existed there was NO sidecar, so the pack was excluded with a loud warning and none of its 24 records reached `catalogue/dist/catalogue.v1.json`. All 24 records are `status: "candidate"` (verified below), so status is NOT the blocker; the missing sidecar was the sole exclusion mechanism. `facts/served-cells.json` is a SEPARATE runtime gate (the ICP gate `facts/sector.js auditableCell()`) over the LEAD's resolved sector; every sector this pack targets (`saas`, `tech`, `media`, `marketing`, `fitness`, `automotive`, `transport`, `energy`, `manufacturing`, `construction`) is `served:true`, and `universal` is handled by the universal overlay. So compile-time exclusion = the missing sidecar, nothing else.

**Why this sidecar does NOT set `verdict=approved`.** Two records have ERROR-severity `catalogue/linters/citation-completeness.js` findings (`enforcement-host-unofficial`). `catalogue/compile.js reportFindings()` throws on ANY error-severity finding, so the pack CANNOT compile as-is even with an approved sidecar. Stamping `approved` would be both a false attestation and non-functional. This header therefore withholds the machine-readable green light. A real `node catalogue/compile.js` run refuses this pack until the two URLs are fixed; that is the intended fail-closed behaviour (Constitution Rule 4 / Rule 14), which is why the pack stays on the unpushed `p5-tmi-qa` branch. **The two blocking errors CANNOT be cleared by flipping the records to `needs_verification`** — `catalogue/linters/lib.js loadRecords()` and `citation-completeness.js checkEnforcementEntries()` scan every record regardless of status (only the primary `checkCitation` is status-gated). The enforcement URLs must actually be corrected to an OFFICIAL_HOSTS host (`asa.org.uk`, `ico.org.uk`).

## Verdict summary
- checked: 24 / 24
- legally sound (real, in-force UK obligation; citation/polarity/penalty verified): 24 / 24 (no fabricated statute, section, fine or case found)
- GO (ship as `candidate` once the pack compiles): 19
- fix-first (non-blocking correction needed before ship): 3 (UK_WASTE_CARRIER_REGISTRATION, UK_TRUSTMARK_ACCREDITATION_CLAIMS, UK_ATOL_LICENSING)
- NO-GO / compile-blocking (must fix before the PACK compiles at all): 2 (UK_CAP_AI_CLAIMS, UK_PECR_EMARKETING)
- downgraded to rejected_qa by this QA: 0 (QA-only pass; no status flipped, no record edited, no inclusion changed)
- CRITICAL: 2 (the two `enforcement-host-unofficial` blockers; both are enforcement-illustration URLs, NOT the primary law citation, so the underlying law records are salvageable with a URL fix)

Bottom line: the pack is legally honest and unusually well-targeted. Every one of the 24 maps to a real, in-force UK obligation with an observable website signal. The defects are citation-hygiene (2 blocking enforcement URLs), one currency miss, dead provenance links, and a non-canonical sector tag — not legal substance. The single biggest risk in a broad industrial pack, C-048 false accusation via a risk-based duty encoded as a hard breach, is NOT present: the pack avoided the exact trap that quarantined the sibling's Art 32 record.

## Inventory (24 records, grouped by sub-sector)

| # | id | framework / citation.section | url host | polarity (evidence_type) | statutory_max (GBP) | status | seed |
|---|---|---|---|---|---|---|---|
| 1 | UK_GDPR_SAAS | UK GDPR Arts 12-14/26/28; DPA 2018 | legislation.gov.uk | presence/presence/register | 17,500,000 | candidate | confirmed |
| 2 | UK_NIS_RDSP | NIS Regs 2018 reg 12, 14A (registration) | legislation.gov.uk | register/absence | 17,000,000 | candidate | corrected |
| 3 | UK_DMCC_SUBS_UCP | DMCC 2024 Pt4 Ch1 ss.224-230, Sch 20 | legislation.gov.uk | behavioural/absence/presence | 300,000 | candidate | corrected |
| 4 | UK_CAP_AI_CLAIMS | CAP Code 3.1/3.7/3.9 (AI substantiation) | asa.org.uk | absence | null | candidate | gap_filled |
| 5 | UK_PECR_EMARKETING | PECR 2003 regs 22/23/6 (DUAA uplift) | legislation.gov.uk | behavioural/presence | 17,500,000 | candidate | confirmed |
| 6 | UK_INFLUENCER_AD_DISCLOSURE | CAP 2.1-2.4; DMCC Sch 20 (hidden ads) | asa.org.uk | absence | 300,000 | candidate | gap_filled |
| 7 | UK_OSA_UGC | Online Safety Act 2023 Pt3/Pt7/Sch13 | legislation.gov.uk | presence | 18,000,000 | candidate | corrected |
| 8 | UK_ODPS_NOTIFICATION | Communications Act 2003 s.368BA (Pt4A) | legislation.gov.uk | register/presence | 250,000 | candidate | gap_filled |
| 9 | UK_PRESS_REGULATOR_MEMBERSHIP | IPSO/IMPRESS (voluntary) + DMCC Sch 20 | ipso.co.uk | register/presence | null | candidate | corrected |
| 10 | UK_CCR_FITNESS_DISTANCE | CCR 2013 regs 9-14/27-38/40 | legislation.gov.uk | presence/behavioural | null | candidate | confirmed |
| 11 | UK_CRA_UNFAIR_TERMS_FITNESS | CRA 2015 ss.61-71, Sch 2 (Ashbourne) | legislation.gov.uk | absence | 300,000 | candidate | confirmed |
| 12 | UK_CAP_HEALTH_FITNESS_CLAIMS | CAP 12/13; NHC Reg 1924/2006; NHC register | asa.org.uk | absence | null | candidate | confirmed |
| 13 | UK_FCA_MOTOR_FINANCE_PROMOTIONS | FSMA s.19/21; CONC 3.5/3.3 | handbook.fca.org.uk | presence/register | null | candidate | confirmed |
| 14 | UK_GREEN_CLAIMS | DMCC ss.224-226; Green Claims Code | legislation.gov.uk | absence | 300,000 | candidate | confirmed |
| 15 | UK_TRUSTMARK_ACCREDITATION_CLAIMS | DMCC s.226, Sch 20 paras 1-4 | legislation.gov.uk | register | 300,000 | candidate | gap_filled |
| 16 | UK_OFGEM_SUPPLY_LICENCE | Gas Act 1986/Electricity Act 1989 SLC 0/0A | ofgem.gov.uk | presence | null (band 214,580-2,111,798) | candidate | confirmed |
| 17 | UK_ATOL_LICENSING | ATOL Regs 2012 regs 9-12/17 | legislation.gov.uk | register | null (unlimited fine) | candidate | confirmed |
| 18 | UK_PACKAGE_TRAVEL_2018 | PTR 2018 regs 5-6/14/19-25 | legislation.gov.uk | presence/presence | null (unlimited fine) | candidate | confirmed |
| 19 | UK_UKCA_CE_MARKING_CLAIMS | PSM Regs 2019/2024 (CE recognition) | gov.uk | absence | null | candidate | corrected |
| 20 | UK_CPR305_DOP | CPR 305/2011 arts 4/6/7; DR 157/2014 | legislation.gov.uk | presence | null | candidate | gap_filled |
| 21 | UK_ENERGY_LABELLING_ONLINE | Energy labelling 2017/1369; EIR 2011 | legislation.gov.uk | presence | null | candidate | gap_filled |
| 22 | UK_GAS_SAFE_REGISTRATION | Gas Safety Regs 1998 reg 3(1)/3(3)/3(7) | legislation.gov.uk | register | null (band low 2,000) | candidate | gap_filled |
| 23 | UK_BSA_BUILDING_CONTROL_REGISTRATION | Building Safety Act 2022 Pt3 (ss.58A-58Z) | legislation.gov.uk | register | null | candidate | gap_filled |
| 24 | UK_WASTE_CARRIER_REGISTRATION | COPA 1989 s.1; Waste Regs 2011 regs 26-30 | legislation.gov.uk | register | null (band 300-5,000) | candidate | corrected |

## Citation + enforcement spot-verification (official sources; ≥8 required, 13+ verified)

legislation.gov.uk bot-walls plain fetch (HTTP 202-while-generating) and ico.org.uk returns 403 (caution.md C-129), so those were corroborated via the regulator's own pages and cross-source search; regulator/GOV.UK pages were fetched directly. Nothing below is asserted from memory.

| Record | Claim tested | Source | Result |
|---|---|---|---|
| UK_OSA_UGC | 4chan penalty GBP 20,000 + GBP 100/day; failure to produce risk assessment + qualifying worldwide revenue | ofcom.org.uk (fetched) | CONFIRMED exact — published 2025-10-13, daily penalty from 14 Oct 2025 |
| UK_GAS_SAFE_REGISTRATION | HSE v Neil Burton, regs 3(1)/3(3), 6-month suspended + 150h unpaid | press.hse.gov.uk (fetched) | CONFIRMED exact — real HSE release 10 Oct 2025; false-pretence reg 3(3) confirmed |
| UK_FCA_MOTOR_FINANCE_PROMOTIONS | PS26/3 redress scheme 2007-2024; parts suspended by Upper Tribunal July 2026 | fca.org.uk (fetched) | CONFIRMED — GBP 7.5bn scheme; UT suspension 2 July 2026 |
| UK_OFGEM_SUPPLY_LICENCE | United Gas & Power GBP 2,111,798, SLC 0A + micro-business overcharging | ofgem.gov.uk (fetched) | CONFIRMED exact — 16 Mar 2023; anchors typical_high |
| UK_PACKAGE_TRAVEL_2018 | Teletext/Truly broke PTR 2018 14-day refund duty via High Court | gov.uk (search) | CONFIRMED — High Court declaration 28 Feb 2022 (minor date/entity imprecision, see below) |
| UK_ODPS_NOTIFICATION | s.368BA advance-notification duty; Ofcom keeps a public list of notified ODPS | ofcom.org.uk (search) | CONFIRMED — duty + public list real; guidance updated 5 Jan 2026 |
| UK_ENERGY_LABELLING_ONLINE | online duty to show label + info sheet near price; EIR 2011; OPSS/TS | gov.uk (fetched) | CONFIRMED |
| UK_UKCA_CE_MARKING_CLAIMS | CE recognised indefinitely for most GB goods (UKCA voluntary); PSM Regs 2024 | gov.uk (fetched) | CONFIRMED — record's "missing UKCA is NOT a breach" carve-out is correct |
| UK_TRUSTMARK / DMCC Sch 20 | Sch 20 banned practices: trust mark w/o authorisation; false code signatory/endorsement | gov.uk CMA207 + legislation (search) | CONFIRMED — 32 banned practices; exact use cases present |
| UK_NIS_RDSP | NIS Regs 2018 in force through 15 Jul 2026; ICO is RDSP authority; NIS2 NOT in UK force | legislation/ICO/gov.uk (search) | CONFIRMED — CS&R (NIS2) Bill introduced 12 Nov 2025, not in force; record's carve-out correct |
| UK_ATOL_LICENSING | CAA "Check an ATOL" public register exists | caa.co.uk (fetched) | CONFIRMED register; legislation citation not re-fetched (202-wall) |
| UK_CPR305_DOP | DR 157/2014 website-DoP conditions (unaltered, 10-yr, free access) | legislation.gov.uk (search) | CONFIRMED — assimilated; conditions match record elements |
| UK_BSA_BUILDING_CONTROL_REGISTRATION | mandatory BSR registration 6 Apr 2024; impersonation offence; "Approved Inspector" renamed | legislation/law-firm (search) | CONFIRMED |
| UK_CAP_AI_CLAIMS | ASA v UAB CommerceCore (WiggyDog), 22 complaints upheld, exaggerated AI performance | multi-source (search) | CASE CONFIRMED (25 Mar 2026) but cited URL points to a DIFFERENT ASA ruling — see NO-GO |
| UK_PECR_EMARKETING | KRA Consultancy GBP 300,000, 5.57m texts, PECR regs 22/23 | ico.org.uk + multi-source (search) | CASE CONFIRMED but record DATE is wrong (2025-06; actual 2026) + blog host — see NO-GO |
| UK_GDPR_SAAS | Advanced Computer Software GBP 3.07m first UK GDPR processor fine | cross-verified by sibling uk-universal.QA | CONFIRMED (same case + ICO URL the sibling QA verified: 26 Mar 2025) |

## Polarity red-team — C-048 (all 24; the highest-risk check for this pack) — PASS

Mechanical: `catalogue/linters/polarity.js scan()` returns **0 violations** over all 24 (no prohibition/requirement mismatch, no required-disclosure-mistyped-as-absence, no negation-guard error). Adversarial read confirms and explains why:

- **No risk-based/reasonableness duty is encoded as a hard breach.** This is the C-048 landmine in an industrial+cyber pack ("appropriate technical and organisational measures", "so far as reasonably practicable"). UK_NIS_RDSP cites reg 12 (risk-based security duties) in its citation but the ENCODED obligations are only RDSP registration (`register`) and false-status claims (`absence`) — it does NOT turn the reasonableness security duty into a website breach. The pack therefore avoided the exact defect that forced the sibling's UK_DATA_SECURITY_TRANSPORT (Art 32) into quarantine. There is no Art 32 / "adequate security" hard-accuser anywhere in this pack.
- **The substantiation/unfairness family** (UK_CAP_AI_CLAIMS, UK_GREEN_CLAIMS, UK_CAP_HEALTH_FITNESS_CLAIMS, UK_CRA_UNFAIR_TERMS_FITNESS, UK_INFLUENCER_AD_DISCLOSURE) is typed `absence`/`register` with the "the breach is X being present" framing, which the linter's `BREACH_PRESENT_RX` correctly accepts, and whose voice is needs-review by design (whether a claim is "unsubstantiated"/"unfair" is a judgement, not a web-observable fact). WATCH (engine, not catalogue): these must route through the LLM adjudicator to needs-review (Rule 6/Rule 10), never fire a hard violation on mere keyword presence. This is the same established, accepted behaviour as the sibling's CAP/DMCC records; it is a per-engine assurance, not a per-record catalogue defect.
- **The one behavioural duty that intersects a deterministic DOM concept** (UK_CCR_FITNESS_DISTANCE obl[1], "no pre-ticked boxes") is protected by the W6 engine fix already in main: `evidence/browser/dom-assert.js DOM_RULE_TIER` freezes `pre-ticked-consent` and `insecure-form` as `risk` tier, and `breach/adjudicator/adjudicate.js` routes a risk-tier dom_node to `needs_review` (`risk_indicator`) with the model never called — never a hard violation (verified in `adjudicate.test.js`, regression-locked). So no behavioural record here can ship a hard accusation via the observed-fact bypass.
- **Voluntary/industry code correctly marked non-statutory:** UK_PRESS_REGULATOR_MEMBERSHIP is exemplary — `statutory_max: null`, basis states voluntary corrections/adjudications, and `excluded_when` says "non-membership is NOT a breach and must never be asserted as one." The only breach is a FALSE membership mark (register) or a member missing its complaints route (presence). Model handling.
- **Polarity red-team (would a compliant firm's own compliance statement trigger it?):** no record fires on a firm's self-declaration. UK_NIS_RDSP obl[1] ("do not claim NIS status not held") and the trust-mark/accreditation records are register-verified (the claim is checked against the issuing register, not matched as page text), so a firm that truthfully states its accreditations is not accused.

## Threshold audit — C-071 — PASS (with one currency miss)

Every size/volume/scale-gated record carries the correct `excluded_when` carve-out:
- UK_NIS_RDSP — small/micro exemption present ("fewer than 50 staff AND turnover/balance sheet <= EUR 10m"); confirmed still-current and NIS2 correctly excluded. PASS.
- UK_OSA_UGC — gated to user-to-user surfaces; extensive `excluded_when` (email/SMS-only, limited-functionality, internal tools, recognised-news carve-outs). Prevents the biggest false-positive on brochure sites. PASS.
- UK_DMCC_SUBS_UCP — B2B-only excluded; the subscription-contract chapter (Part 4 Ch 2) correctly flagged NOT-in-force until ~Spring 2027 and explicitly "do not assert as current breaches"; the in-force hook is the misleading-omission/UCP angle only. Temporally honest. PASS.
- UK_OFGEM_SUPPLY_LICENCE — gated to licensed suppliers/brokers; installers/consultants excluded. PASS (niche population).
- UK_ATOL_LICENSING — airlines (own seats), no-flight sellers, and disclosed-agent-of-ATOL-holder excluded. The ATOL volume figure (500 pax SBA) is a licence-TYPE threshold, not a de-minimis exemption from needing an ATOL, so there is no missing carve-out. PASS.
- UK_PACKAGE_TRAVEL_2018 — single-service, business-travel, <24h-no-overnight excluded. PASS.
- UK_UKCA_CE / UK_CPR305_DOP / UK_ENERGY_LABELLING — correctly scoped to in-scope product categories / manufacturer-importer role; contractors/merchants/out-of-scope products excluded. PASS.
- Modern Slavery s.54 GBP 36m turnover gate is NOT in this pack (it is in uk-universal, correctly gated there). No sub-threshold false-fire risk introduced here.
- CDM notifiable-project threshold is NOT relied on (the construction records here are registration/claim records, not CDM duty-holder records), so no missing CDM carve-out.

**Currency miss (fix-first):** UK_WASTE_CARRIER_REGISTRATION cites COPA 1989 s.1 + Waste (E&W) Regs 2011 regs 26-30, but from **1 April 2026** the regime is transitioning to "transporters" under a permit-based system (Environmental Permitting (Waste Controlling or Transporting) Regulations 2026). The duty persists (registration/permit still required; EA public register still live) so there is no false accusation, but the citation may be partly superseded and the record does not note the transition. Add a currency carve-out / verify the in-force citation before ship.

## Fines sanity — C-096 / C-104 / C-244 — PASS (with a rendering caveat)

- All 24 `currency` fields are GBP; no order-of-magnitude or unit errors.
- `statutory_max: null` is used honestly wherever there is no fixed numeric ceiling: the criminal/unlimited-fine regimes (ATOL, Package Travel, Gas Safe, UKCA/CPR/energy-labelling product regimes, BSA, waste carrier), the non-monetary regimes (CAP Code x3, IPSO/IMPRESS voluntary), and the turnover-percentage regime (Ofgem 10% of licensee turnover). This is exactly the C-244 discipline (a penalty figure is never assumed from "it is a statute").
- Real penalty bands are anchored on real enforcement: UK_OFGEM typical_high 2,111,798 = the verified United Gas & Power penalty; UK_GDPR_SAAS typical_high 3,070,000 = the verified Advanced Computer Software fine; UK_PECR band 20,000-300,000 sits within real ICO PECR penalties.
- **Caveat (C-096, advisory, non-blocking):** `catalogue/linters/threshold-guard.js` returns **8 WARNING-severity `typical-band-missing` findings** (UK_NIS_RDSP, UK_DMCC_SUBS_UCP, UK_INFLUENCER, UK_OSA_UGC, UK_ODPS, UK_CRA_UNFAIR_TERMS, UK_GREEN_CLAIMS, UK_TRUSTMARK): each sets `statutory_max` with both `typical_low` and `typical_high` null. A bare ceiling with no typical band invites the renderer to headline the rare maximum (the £18m-on-an-SME class). `max_is_rare: true` mitigates and these are warnings (do not block compilation), but the high-ceiling ones (OSA 18m, NIS 17m) should get a defensible typical band or an explicit "no representative band; do not headline the max" note before render.
- Minor: UK_GAS_SAFE `typical_low: 2000` appears anchored on the Lee Lancaster costs award (GBP 2,000 costs), not a fine; verify it represents a fine, not costs.

## Usefulness — C-236 — the concrete website signal that fires each record

Every record has a real, crawlable firing signal (none is dead weight on a live site):
1. UK_GDPR_SAAS — privacy notice missing the Art 13/14 disclosures / role (controller vs processor); not on ICO fee register.
2. UK_NIS_RDSP — a scaled cloud/SaaS/marketplace firm (>50 staff) with no RDSP registration; or a false "NIS/critical-infrastructure accredited" claim.
3. UK_DMCC_SUBS_UCP — headline price that excludes mandatory fees (drip pricing); reviews with no verification; auto-renewal not disclosed before sign-up.
4. UK_CAP_AI_CLAIMS — an "AI-powered / AI-driven / X% faster" claim on the page with no visible substantiation (needs-review).
5. UK_PECR_EMARKETING — trackers firing before consent; pre-ticked marketing box; no working opt-out / bought-list "partners" consent.
6. UK_INFLUENCER_AD_DISCLOSURE — a campaign/case-study gallery post shown without an #ad/paid-partnership label.
7. UK_OSA_UGC — a forum/community/user-reviews surface with no safety terms or reporting route (the "risk assessment completed" element is NOT web-observable — treat as informational).
8. UK_ODPS_NOTIFICATION — a TV-like VOD catalogue not on Ofcom's notified-ODPS list. (Niche but valid; product/marketing video is excluded.)
9. UK_PRESS_REGULATOR_MEMBERSHIP — an IPSO/IMPRESS mark in the footer that does not match the regulator's member list; or a member with no complaints route.
10. UK_CCR_FITNESS_DISTANCE — online gym joining flow missing total price / minimum term / 14-day cancellation notice; pre-ticked add-ons.
11. UK_CRA_UNFAIR_TERMS_FITNESS — published T&Cs with an Ashbourne-class minimum-term / near-100% early-exit clause (needs-review).
12. UK_CAP_HEALTH_FITNESS_CLAIMS — a specific weight-loss rate/amount claim, or a supplement disease claim, on the page.
13. UK_FCA_MOTOR_FINANCE_PROMOTIONS — "from £199/month" with no representative example/APR on the page; an FRN that does not resolve on the FS Register; missing "credit broker not lender".
14. UK_GREEN_CLAIMS — "carbon neutral / eco-friendly / net zero" with no qualification/evidence near the claim (needs-review).
15. UK_TRUSTMARK_ACCREDITATION_CLAIMS — any accreditation badge (Gas Safe, MCS, TrustMark, ATOL, Cyber Essentials, ISO) that does not resolve on the issuing register. (Highest-yield register check; see overlap note.)
16. UK_OFGEM_SUPPLY_LICENCE — a licensed supplier's tariff page missing unit rate/standing charge/exit fee, or licensee identity/Ombudsman route. (Niche: only ~dozens of licensees.)
17. UK_ATOL_LICENSING — an ATOL number/logo that does not resolve on Check-an-ATOL, or ATOL protection implied where none exists.
18. UK_PACKAGE_TRAVEL_2018 — a package-sales flow missing the Sch 1-3 standard information / insolvency protector / 14-day refund terms.
19. UK_UKCA_CE_MARKING_CLAIMS — an invented conformity claim ("UK safety approved") or a "UKCA/CE certified" claim not backed by real assessment. ("Missing UKCA" alone correctly does NOT fire.)
20. UK_CPR305_DOP — a construction-product page claiming fire/structural performance with no reachable Declaration of Performance.
21. UK_ENERGY_LABELLING_ONLINE — a priced appliance/lighting listing with no energy label/class near the price.
22. UK_GAS_SAFE_REGISTRATION — a site advertising boiler/gas work with a Gas Safe number that does not resolve (or none).
23. UK_BSA_BUILDING_CONTROL_REGISTRATION — a firm marketing "Approved Inspector / Registered Building Inspector" not on the BSR register.
24. UK_WASTE_CARRIER_REGISTRATION — a skip-hire/clearance site with no EA CBDU/transporter registration number resolving on the public register.

Two cross-record usefulness notes (non-blocking): (a) UK_TRUSTMARK overlaps the specific badge records (UK_ATOL, UK_GAS_SAFE, UK_PRESS_REGULATOR) — the same badge can be flagged twice; recommend the engine dedupe register findings so one bad badge is one finding; (b) the ODPS, CPR-DoP and Ofgem records are genuinely niche (small lead populations) but valid — keep, they are cheap when they fire.

## Per-record GO / NO-GO

**NO-GO — compile-blocking (must fix the URL before the pack compiles at all):**
- **UK_CAP_AI_CLAIMS** — `enforcement[0].url` = `https://www.lewissilkin.com/insights/2026/03/30/asa-upholds-complaints-about-ad-for-ai-tool-102mocz`. This is (a) a law-firm blog, not an OFFICIAL_HOSTS host (error-severity `enforcement-host-unofficial`), and (b) WRONG CONTENT — that URL is the ASA "PixVideo AI Video Maker" ruling (8 complaints, objectification/harm grounds), NOT the record's "WiggyDog / UAB CommerceCore / 22 complaints / exaggerated AI performance" case. The WiggyDog case is REAL and the record's description is accurate (ASA upheld 22 complaints, 25 Mar 2026), so the fix is a URL swap to the official ASA ruling on `asa.org.uk`. Law, polarity, penalty all sound.
- **UK_PECR_EMARKETING** — `enforcement[1].url` = `https://www.freevacy.com/news/ico/...` (a blog, not OFFICIAL_HOSTS; error-severity `enforcement-host-unofficial`), and the entry's `date` is **wrong**: it says `2025-06` but the KRA Consultancy £300,000 fine was issued in **2026** (official ICO MPN: `https://ico.org.uk/action-weve-taken/enforcement/2026/05/kra-consultancy-ltd-mpn/`; ICO media notice 2026/06). Fix: swap to the official `ico.org.uk` URL and correct the date to 2026. The other enforcement entry (AFK Letters, GBP 90,000, on an ico.org.uk URL) is on an official host; not independently re-fetched (ICO 403), relies on author provenance. Law, polarity, penalty sound.

**Fix-first — non-blocking, correct before ship:**
- **UK_WASTE_CARRIER_REGISTRATION** — citation currency: note/verify the 1 Apr 2026 transporter/permit reform (see Threshold audit). No false accusation; duty persists.
- **UK_TRUSTMARK_ACCREDITATION_CLAIMS** — `provenance.sources` includes `https://travelweekly.co.uk/articles/42283/agent-fined-after-breaching-atol-rules`, which **404s** (dead trade-press link). Remove/replace; the official CAA prosecutions PDF (`caa.co.uk/media/...`) is retained (binary, not machine-readable to fetch, but official host). The intel claim "CAA prosecuted a firm for a false ATOL logo" is plausible but was not corroborated from a live source in this pass; either cite a working official source or soften the claim.
- **UK_ATOL_LICENSING** — same dead `travelweekly.co.uk` provenance URL (404). Remove/replace as above. Primary citation (ATOL Regs 2012) and register (CAA Check-an-ATOL) are sound.

**GO — legally sound, citation-verified, polarity-clean, useful (ship as `candidate` once the pack compiles):** the remaining 19 — UK_GDPR_SAAS, UK_NIS_RDSP, UK_DMCC_SUBS_UCP, UK_INFLUENCER_AD_DISCLOSURE, UK_OSA_UGC, UK_ODPS_NOTIFICATION, UK_PRESS_REGULATOR_MEMBERSHIP, UK_CCR_FITNESS_DISTANCE, UK_CRA_UNFAIR_TERMS_FITNESS, UK_CAP_HEALTH_FITNESS_CLAIMS, UK_FCA_MOTOR_FINANCE_PROMOTIONS, UK_GREEN_CLAIMS, UK_OFGEM_SUPPLY_LICENCE, UK_PACKAGE_TRAVEL_2018, UK_UKCA_CE_MARKING_CLAIMS, UK_CPR305_DOP, UK_ENERGY_LABELLING_ONLINE, UK_GAS_SAFE_REGISTRATION, UK_BSA_BUILDING_CONTROL_REGISTRATION. Conditions attached below.

## Pack-level finding — non-canonical sector tag `saas-tech` (verify-before-ship; touches 6 records)

Records 1-7 that carry `sector: ["saas-tech"]` (UK_GDPR_SAAS, UK_NIS_RDSP, UK_DMCC_SUBS_UCP, UK_CAP_AI_CLAIMS, UK_PECR_EMARKETING, UK_OSA_UGC) use a compound `saas-tech` that is **not** a canonical sector node in `facts/vocabulary.js` (which has `saas` and `tech` as SEPARATE nodes) and appears nowhere else in `facts/` or `facts/served-cells.json`. `served-cells.json`'s own header mandates "Sector keys must stay in sync with the canonical parent nodes in facts/vocabulary.js." At best this is a sync/hygiene defect; at worst, if record `sector` is matched against the lead's resolved canonical sector, these six never attach to a `saas`/`tech` lead and are dead weight (C-236). I could not locate a `connect()` that normalises `saas-tech`. Orchestrator: confirm the routing normalises `saas-tech` -> `saas`/`tech`, OR retag these six to `["saas","tech"]`, before they ship. Not a legal defect (the law in each is sound and citation-verified).

## Minor / precision (LOW, non-blocking)
- UK_PACKAGE_TRAVEL_2018 enforcement `date: 2021-09` is the court-action LAUNCH; the PTR-breach declaration was 28 Feb 2022, and the defendants were Truly Travel Ltd / Alpha Holidays Ltd (Truly Holdings is the parent). Summary is honest about the sequence; tighten if precision matters.
- UK_GDPR_SAAS enforcement `date: 2025-03` — the sibling QA fixed the precise date to 26 Mar 2025; consistent, no action needed.

## Orchestrator decision

**Is any subset safe to include NOW, as-is? No.** Two ERROR-severity `enforcement-host-unofficial` findings make `node catalogue/compile.js` refuse the ENTIRE pack, and flipping those two records to `needs_verification` does NOT clear the errors (the linter scans every record regardless of status). No record can reach the artifact until at least the two enforcement URLs are corrected.

**Minimum path to a shippable pack (recommended order):**
1. **Fix the 2 blockers (required to compile):** UK_CAP_AI_CLAIMS enforcement[0] URL -> the official `asa.org.uk` WiggyDog/CommerceCore ruling; UK_PECR_EMARKETING enforcement[1] URL -> `https://ico.org.uk/action-weve-taken/enforcement/2026/05/kra-consultancy-ltd-mpn/` AND correct `date` 2025-06 -> 2026. Both land on OFFICIAL_HOSTS.
2. **Apply the 3 fix-first corrections:** UK_WASTE_CARRIER currency note; remove/replace the dead `travelweekly.co.uk` provenance URL in UK_TRUSTMARK and UK_ATOL.
3. **Resolve the `saas-tech` routing** for the 6 records (verify normalisation or retag to `["saas","tech"]`).
4. **Advisory before render:** give the 8 `typical-band-missing` records a defensible typical band or an explicit "do not headline the max" note (priority: OSA 18m, NIS 17m).
5. Re-run `node catalogue/compile.js --print-hashes`, re-stamp THIS sidecar's header to the new `pack_sha256` with `verdict=approved`, confirm `node catalogue/compile.js --stamp <ISO>` is CI-green, then founder phase sign-off.

**Once steps 1-3 are done, all 24 records are safe to ship as `candidate`** — every one is a real, in-force UK obligation with a crawlable firing signal, correct polarity, honest penalty framing, and correct thresholds/carve-outs. This QA flipped no status, edited no record, and changed no inclusion; the pack and its records are unchanged from the reviewed bytes (`pack_sha256` above).

## Format checks
- em/en dashes: 0.
- 24 records, all `currency: GBP`, all `status: candidate`.
- Mechanical linter state at review: polarity 0, regex-health 0, citation-completeness 2 ERROR, threshold-guard 8 WARNING.
