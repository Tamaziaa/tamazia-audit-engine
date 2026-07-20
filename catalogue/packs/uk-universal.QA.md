<!-- qa-approval pack_sha256=bf11ceaa9f52b14252acb0a3a866c9c9fcda1da565c988d353dfe5ca7c1a54c8 verdict=approved reviewed=2026-07-20 -->
Integrity attestation and review record (legal-QA reviewer Rob, 2026-07-17; re-stamped 2026-07-19 for the DUAA carve-out correction, again for the W2 records-authoring wave - see the W2 section directly below - and again for the W6 un-quarantine of UK_DATA_SECURITY_TRANSPORT once its false-accusation path was structurally closed in the engine, see the "Engine fix landed (W6)" note below). This attests that the pack was legally reviewed, including the PR #3 gate-loop corrections (official-source verifications and conservative removals), and that the pack_sha256 in the header above matches the current pack bytes. It is NOT a release approval. Release requires CI-green plus founder (Aman) phase sign-off at PR merge.

## Records-authoring verification 2026-07-19 (W2: two new UK GDPR records added)

Two records were authored and appended to the pack in the W2 wave (records now 14 -> 16) and the header sha256 is re-stamped to the post-addition bytes. Method: independent primary-source verification of every citation, penalty tier and enforcement case, fetched live on official sources. legislation.gov.uk and ico.org.uk are bot-walled to plain fetch (legislation returns HTTP 202 while generating; ICO returns 403), so those pages were rendered through the audit engine's own crawl-render service and their content confirmed; GOV.UK fetched directly.

**UK_GDPR_INTERNATIONAL_TRANSFER** (restricted transfers, UK GDPR Chapter V). Verified against the live, CURRENT (post-5-February-2026) text: the Data (Use and Access) Act 2025 (s.142, Sch 7; SI 2026/82) substituted Chapter V - Art 44 omitted and Art 44A ("General principles for transfers") inserted, Art 45 omitted and Art 45A (adequacy regulations) inserted, new Art 47A (standard data protection clauses), the Art 46 "data protection test" - and Art 83(5)(c) now reads "Articles 44A to 49" and stays the higher tier (GBP 17,500,000 or 4%). This is a correction to the brief's "Articles 44-49 as retained" framing. Citation anchored to Art 44A (body confirmed live). Adequacy/DPF excluded_when confirmed against the GOV.UK UK-US data bridge factsheet and the Data Protection (Adequacy) (United States of America) Regulations 2023 (SI 2023/1028), in force 12 October 2023, plus the ICO UK-Extension guidance. Enforcement: ICO v Clearview AI Inc (Upper Tribunal page live, October 2025; underlying GBP 7,552,800 fine, 2022) is included as a genuine ICO cross-border action, labelled expressly as a lawful-basis/transparency case rather than a Chapter V export case; the archetypal restricted-transfer penalty (EU/EDPB Meta, EUR 1.2bn, 22 May 2023) is EU not UK and sits in intel/provenance only (its EDPB URL is not an OFFICIAL_HOSTS host, so it cannot enter enforcement[]). Polarity: evidence_type behavioural, worded needs-review by design (a third-country receiver alone does not prove an unlawful transfer); the tracker_request_pre_consent observation kind that would carry a third-country tracker has no OBSERVATION_CONCEPTS entry today, so no observed-fact bypass can ship this as a standalone violation. Verdict: confirmed.

**UK_DATA_SECURITY_TRANSPORT** (security of processing, UK GDPR Art 32). Verified against live text: Art 32(1)(a) names "the pseudonymisation and encryption of personal data"; Art 83(4) lists Arts 25 to 39, so an Art 32 breach is the STANDARD tier (GBP 8,700,000 or 2%) - confirmed, as the brief expected. ICO "Encryption and data transfer" guidance (encryption in transit; HTTPS/TLS, not SSL) confirmed live. Enforcement (all ICO, official host, pages live): LastPass UK Ltd (GBP 1,228,283, 20 November 2025, Art 5(1)(f) and Art 32(1)(f)); Advanced Computer Software Group (GBP 3.07m, 26 March 2025, MFA gap); DPP Law Ltd (GBP 60,000, 16 April 2025). Correction: the brief's suggested DPA 2018 s.57 was checked and NOT cited - s.57 is "data protection by design and default" in Part 3 (law-enforcement processing), the wrong scope; the general-processing security duty is UK GDPR Art 32 given domestic effect by DPA 2018 Part 2. Polarity: evidence_type behavioural, needs-review by design (a risk indicator to assess against the controller's own Art 32 assessment). OPEN ITEM (engine, outside catalogue scope): the obligation's tokens deliberately intersect the dom_node insecure_form concept (secure/security/encryption/transport) so a captured insecure-form node routes to it; but because breach/adjudicator/evidence-kind.js classifies a dom_node as an observation that BYPASSES the LLM and evidence/browser/dom-assert.js emits the insecure-form node as state "violation", a routed+verified node would currently ship as a HARD violation rather than needs-review. The record encodes needs-review voice; making the deterministic https-to-http node itself surface as needs-review is a code change (dom-assert.js emitting "incomplete", or an adjudicator review-route) for a later stage, not a catalogue edit. Verdict: confirmed.

**Orchestrator decision (Fable, delegated legal-QA, 2026-07-19).** Second-pass adversarial legal-QA VERIFIED both records against live primary sources (Art 44A currency, penalty bands, enforcement URLs, pack_sha256 attestation) and returned one correction (Advanced Computer Software date 27 -> 26 March 2025, applied to the pack prose and this sidecar). Decision: UK_GDPR_INTERNATIONAL_TRANSFER ships as `candidate` (legally clean; routes to no active lane today, so it cannot false-accuse). UK_DATA_SECURITY_TRANSPORT is set to `needs_verification` (stays fully authored in the source pack, EXCLUDED from the compiled artifact) because the OPEN ITEM above is a live false-accusation path: with the merged T2a dom lane active, a captured https->http insecure-form node routes to this record and would ship a HARD Art 32 violation via the observed-fact bypass, which Art 32's risk-based nature forbids (the C-048 class). It flips back to `candidate` once the engine wiring routes risk-indicator DOM nodes (insecure-form) to needs-review rather than a hard violation. This is quarantine-the-unshippable, not doubt about the law.

**Engine fix landed (W6, 2026-07-19).** The risk-indicator DOM-node routing is now wired end to end, so the OPEN ITEM above is closed and UK_DATA_SECURITY_TRANSPORT is flipped `needs_verification` -> `candidate` (INCLUDED in the compiled artifact; records 93 -> 94). The single classification door lives in evidence/browser/dom-assert.js (`DOM_RULE_TIER`): the six accessibility checks are `deterministic` (the DOM fact IS the breach) and insecure-form + pre-ticked-consent are `risk`. breach/proposers/propose.js rides that tier onto the dom_node artifact; breach/adjudicator/evidence-kind.js classifies a `tier:risk` dom_node as a confirmed observation that does NOT take the observed-fact bypass; breach/adjudicator/adjudicate.js quarantines it to needs-review (adjudication `risk_indicator`) carrying its dom_node artifact - evidence-backed (Rule 3), never a hard accusation (Rule 6/Rule 10). A captured https-to-http insecure-form node routed to this record therefore now adjudicates to needs-review, exactly as its worded voice expects, never a hard Art 32 violation (the C-048 class). The deterministic accessibility violations (a missing alt attribute) still ship as hard violations, unchanged. Proven end to end by breach/dom-node-risk-tier.test.js and guarded every run by the earn-your-zero fixture eval/calibration-known-bad/fixtures/p4-risk-domnode-never-hard-violation.js (a regression that let the risk node ship as a hard violation fails CI). The pack_sha256 header above is re-stamped to the post-flip bytes.

Both records status "candidate", provenance verified_date and last_synced 2026-07-19. Independent adversarial legal-QA (stage 2) should still re-verify before activation.

## Re-verification 2026-07-19 (DUAA analytics carve-out; legal basis CATALOGUE-VERIFICATION-2026-07-19.md)
Per two primary-source-verified adversarial legal-QA passes (see `CATALOGUE-VERIFICATION-2026-07-19.md`; legislation.gov.uk DUAA 2025 s.112 and Schedule 12 rendered, plus the ICO Storage and Access Technologies guidance), UK_PECR_COOKIES_MARKETING `excluded_when` gains the purpose-limited DUAA/PECR Schedule A1 para 5 (and para 6) carve-out, in force 5 February 2026, worded with every statutory condition: sole purpose of measuring how THIS site or service is used in order to improve it; the information not shared with any third party except a processor assisting those improvements; no reliance on device fingerprinting; and clear information plus a simple, free means to object. UK-only (no EU or French PECR equivalent). obl[0] (consent for non-essential cookies) and the GBP 17,500,000 penalty are unchanged, so the record still fires for advertising cookies, device-fingerprinting analytics and third-party-shared analytics. The pack_sha256 in the header is re-stamped to the post-edit bytes.

# uk-universal — QA verification (2026-07-17)

QA of `uk-universal.json` (14 records). Method: independent web verification of the 10 highest-penalty records + all 5 gap_filled citations + 7 enforcement references. Statutes, penalty formulae, thresholds and enforcement cases cross-checked against ICO, GOV.UK, legislation.gov.uk and multiple law-firm briefings. Polarity, fines-sanity and persona-usefulness red-teamed.

## Verdict
- **checked: 14 / 14**
- **confirmed: 14** (every core law, citation, penalty band and threshold verified sound)
- **corrected: 2** (enforcement-metadata errors inside `UK_GDPR_PRIVACY_NOTICE` and `UK_DMCC_UNFAIR_PRACTICES` — the underlying law records stay valid)
- **downgraded (rejected_qa): 0** (no record was unverifiable; no fabricated statutes, sections, fines or cases found)
- **CRITICAL: 0**

The pack is honest and well-targeted. No invented law. The defects are date/figure inaccuracies in three enforcement sub-entries, not in the legal substance.

## Highest-penalty records — verified
| Record | Penalty claim | Verified |
|---|---|---|
| UK_GDPR_PRIVACY_NOTICE | £17.5m or 4% turnover (Art 83(5)) | ✅ correct |
| UK_PECR_COOKIES_MARKETING | post-DUAA up to £17.5m / 4% | ✅ DUAA aligned PECR to UK-GDPR maxima; old £500k cap removed |
| UK_DUAA_2025 | PECR uplift to £17.5m | ✅ DUAA law 19 Jun 2025; most provisions in force 5 Feb 2026 (matches the record's 2026-02 enforcement row) |
| UK_OSA_2023 | greater of £18m or 10% qualifying worldwide revenue | ✅ correct (Ofcom) |
| UK_DMCC_UNFAIR_PRACTICES | CMA direct fines up to 10% global turnover / £300k individuals | ✅ correct; commenced by SI 2025/272 on 6 Apr 2025 |
| UK_CPUT_MISLEADING | unlimited fine + up to 2yr imprisonment | ✅ correct baseline; superseded post-6 Apr 2025 by DMCC |
| UK_CRA_2015 | unfair terms unenforceable; no fixed Part 2 fine | ✅ correct |
| UK_CCR_2013 | unenforceability + up to 12-month cancellation extension | ✅ correct |
| UK_EQUALITY_ACCESSIBILITY | uncapped county-court compensation | ✅ correct (no statutory cap) |
| UK_ICO_FEE_REGISTRATION | up to £4,350 (150% of top tier) | ✅ exact (tiers £52/£78/£3,763; fixed penalties £400/£600/£4,000, max £4,350) |

## Gap_filled citations — all verified
1. **UK_ICO_FEE_REGISTRATION** — DPA 2018 s.137 + SI 2018/480. Tiers £52 / £78 / £3,763 and £4,350 max **exact** per ICO. ✅
2. **E-Commerce Regs 2002 reg 6** (folded into UK_TRADING_DISCLOSURES) — reg 6 service-provider info duty + CA 2006 s.82/s.84 level-3 (£1,000) fine confirmed. ✅
3. **UK_CAP_CODE** — correctly labelled self-regulatory; ASA sanctions non-monetary; statutory bite only via CPRs/DMCC referral. Penalty object carries **no monetary figure** — correct. ✅
4. **UK_MODERN_SLAVERY_S54** — £36m turnover threshold confirmed via SI 2015/1833; no financial penalty (injunction only) is correct. ✅ Correctly gated so SMEs are excluded.
5. **UK_PRICE_VAT_DISPLAY** — Price Marking Order 2004 (SI 2004/102) VAT-inclusive selling price + unit price to consumers confirmed. ✅ (Note: PMO guidance is being updated with effect ~April 2026 — re-check article detail before rendering.)

## Enforcement cases — 7 checked, all real, 0 fabricated
| Case | Amount | Status |
|---|---|---|
| HelloFresh (Grocery Delivery E-Services) | £140,000 | ✅ **exact** — 79m emails, 1m texts, reg 22, Jan 2024 |
| Advanced Computer Software | £3.07m | ✅ **exact** — 26 Mar 2025, first processor fine, NHS/Adastra |
| ICO cookie top-1,000 sweep | notices | ✅ consistent with live ICO cookie-compliance activity |
| CMA fake-reviews programme | undertakings | ✅ real |
| CMA drip-pricing (DMCC) | investigation opened | ⚠️ real (18 Nov 2025) but **sector mischaracterised** — see below |
| Capita | £14m | ⚠️ real but **date + affected-count wrong** — see below |
| 23andMe | £2.31m | ⚠️ real but **date + UK-count questionable** — see below |

## Corrections required (enforcement metadata — not law defects)

**C1 — UK_GDPR_PRIVACY_NOTICE / Capita (worst finding).**
- Date `2025-04` is wrong. The final £14m penalty was issued **15 Oct 2025** (reduced from an initial ~£45m provisional figure). The record pairs the *final* amount with an *early* date that matches neither the provisional nor final action.
- Summary says the breach exposed data of "around 90,000 people." The ICO's final position put personal data of **~6.6 million** individuals at risk (90,000 was an early, superseded figure). Materially understates scale.
- Fix: set date to `2025-10` and the affected count to ~6.6m (or drop the count).

**C2 — UK_GDPR_PRIVACY_NOTICE / 23andMe.**
- Date `2025-04` is wrong. Fine issued **5 Jun 2025**.
- "including 693,000 UK individuals" is not the ICO's figure — the fine concerned **~155,592 UK residents** (breach was 6.9m worldwide). The 693,000 UK number is unverified; recommend replacing with 155,592 or removing.

**C3 — UK_DMCC_UNFAIR_PRACTICES / CMA drip-pricing (minor).**
- Summary says the first action targeted "the travel and hospitality sectors." The **first eight DMCC investigations (18 Nov 2025)** were StubHub, viagogo, AA Driving School, BSM, Gold's Gym, Wayfair, Appliances Direct, Marks Electrical — i.e. secondary ticketing, driving schools, gyms and homeware/electricals. Travel was part of the wider 400-business review and advisory-letter cohort, not the named first cases. Re-word to "online pricing / drip pricing across consumer sectors" rather than "travel and hospitality."

None of C1–C3 invalidate the parent law record; the statute, citation and penalty band are all correct. They are accuracy fixes on illustrative case rows.

## Polarity red-team — PASS
- The critical trap (scarcity/urgency and pricing) is handled correctly: DMCC, CPUT and the urgency duties use `evidence_type: behavioural` and breach when the **prohibited content is present** (fake countdown, hidden mandatory fee, bought review), not when it is absent. No inverted polarity.
- PECR cookie duty correctly breaches on cookies **firing before consent** / reject-all missing (behavioural).
- Presence/register duties (privacy notice, trading identifiers, ICO fee, modern-slavery statement) correctly breach on **absence**.
- Activity gating is correct where it most matters:
  - **OSA** fires only on user-to-user / UGC surfaces; brochure sites excluded — prevents the biggest false-positive risk.
  - **Modern Slavery** fires only at ≥£36m turnover; sub-threshold SMEs explicitly excluded — prevents a false flag on the actual SME lead pool.

## Fines sanity (GBP) — PASS
- All 14 `currency` fields are GBP; no unit/order-of-magnitude errors.
- Non-monetary regimes correctly carry no headline fine: **CAP Code** (self-regulatory) and **Modern Slavery s.54** (injunction only) both null — correct, and load-bearing for not over-stating exposure.
- Uncapped regimes (Equality, CRA, CCR, DMCC, CPUT) correctly use `statutory_max: null` with the mechanism described in `basis`.
- Minor cosmetic: `UK_PECR` sets `typical_high` = `statutory_max` (17.5m); a "typical" fine equal to the statutory ceiling is inconsistent, though `max_is_rare: true` mitigates. Consider lowering `typical_high`. Not a correctness defect.

## Thresholds present — PASS
Modern Slavery £36m ✅, ICO fee tiers £52/£78/£3,763 + £4,350 max ✅, OSA £18m/10% ✅, DMCC 10%/£300k ✅, CA 2006 level-3 £1,000 ✅. All numeric gates verifiable and correct.

## Usefulness to the uk-universal persona — STRONG
Every record maps to something testable on a public SME website (privacy notice, cookie banner, trading-disclosure footer, ICO register lookup, accessibility, consumer terms, cancellation rights, pricing/VAT, fake-review/urgency patterns). The two turnover/UGC-gated records (Modern Slavery, OSA) are the ones that would otherwise generate false findings, and both are correctly gated. `UK_ICO_FEE_REGISTRATION` and `UK_TRADING_DISCLOSURES` are the cleanest binary findings; `UK_GDPR_PRIVACY_NOTICE` is the highest-coverage. No frivolous or non-website-surface records slipped in (Art 30 / DPIA / PSBAR correctly excluded per the report).

## Recommended edits before compile
1. Fix Capita date→2025-10 and affected count (C1).
2. Fix 23andMe date→2025-06 and UK count→155,592 or remove (C2).
3. Re-word DMCC first-enforcement sector line (C3).
4. Optional: lower UK_PECR `typical_high` below the statutory max.
5. Dedupe GDPR/PECR/DMCC/CAP against sector-overlay cells at compile time (one statute → one framework), per the author's open question 5.

## P2 law-verification wave (2026-07-17) — C1–C3 applied to the pack
The pack was out of sync with this sidecar's C1–C3 corrections; all three are now applied, each re-verified against the ICO's own media-centre notices before editing:
- **C1 Capita (UK_GDPR_PRIVACY_NOTICE):** date → `2025-10`; url → the real ICO notice (`.../2025/10/capita-fined-14m-for-data-breach-affecting-over-6m-people/`, replacing a guessed `.../2025/04/capita-14m-fine/`); summary → £14m (£8m controller + £6m processor), ~6.6 million people (ICO, 15 Oct 2025).
- **C2 23andMe (UK_GDPR_PRIVACY_NOTICE):** date → `2025-06`; url → the real ICO notice (`.../2025/06/23andme-fined-for-failing-to-protect-uk-users-genetic-data/`); summary → £2.31m, penalty notice 5 Jun 2025, **155,592 UK residents** (6.9m worldwide), replacing the unverified "693,000 UK individuals".
- **C3 DMCC (UK_DMCC_UNFAIR_PRACTICES):** the illustrative first-enforcement case is de-scoped from "travel and hospitality" to "drip pricing across consumer sectors" (Nov 2025), per the QA finding that the named first cases were not travel/hospitality.
- **All 14 records:** `provenance.last_synced: "2026-07-17"` added.
Item 4 (lower UK_PECR `typical_high`) and item 5 (compile-time statute dedupe) remain open — out of scope for a fact-verification wave.

## Adversarial re-review pass 2026-07-20 (dental-catalogue edits; legal-QA verifier)
Scope: the 2026-07-20 author edits (UK_EQUALITY_ACCESSIBILITY Vento re-band; UK_PRICE_VAT_DISPLAY VAT-exempt health gate + LASPO penalty fix; UK_PECR_COOKIES_MARKETING + UK_DUAA_2025 DUAA commencement/penalty_model; penalty_model added to seven further records) plus the new `penalty.penalty_model` schema rule. Header sha256 re-stamped to current pack bytes (post my one correction below).

**Verified against primary/authoritative sources:**
- **Equality Act s.29 uncapped — CONFIRMED.** Services discrimination liability is uncapped county-court compensation (remedies under s.119), no statutory cap; Vento bands are guidance for injury to feelings. penalty_model "uncapped" with statutory_max null is correct and schema-conformant.
- **Vento bands — CORRECTED BY QA.** The author's endpoints (typical_low 1,200 / typical_high 60,700) are correct for claims presented on/after 6 April 2025, but the basis prose and one provenance line listed the two INTERMEDIATE band boundaries as 11,700 and 35,200 — those are the stale pre-6-April-2025 figures. The correct 2025 bands (judiciary.uk Presidential Guidance Eighth Addendum, RPI to 26 March 2025; corroborated by VWV and Clarkslegal) are GBP 1,200-12,100 / 12,100-36,400 / 36,400-60,700. Fixed in place in both the penalty.basis and the provenance source line. Endpoints unchanged, so typical_low/high were already right.
- **LASPO 2012 s.85 — CONFIRMED.** In force 12 March 2015; fines of GBP 5,000 or more on summary conviction (incl. level 5) became unlimited. The correction of UK_PRICE_VAT_DISPLAY from a false GBP 5,000 ceiling to penalty_model "uncapped" is sound.
- **VATA 1994 Sch 9 Group 7 — CONFIRMED.** Dental services by registered dentists/DCPs (Dentists Act 1984 s.36B register) and other registered health professionals are VAT-exempt where the primary purpose is protection/restoration/maintenance of health; purely cosmetic supplies without a medical purpose are standard-rated. The author's excluded_when health-exemption gate, and its cosmetic-treatment carve-back, are accurate — this correctly stops the engine telling a VAT-exempt dental practice to "add VAT".
- **DUAA 2025 / SI 2026/82 — CONFIRMED.** The Data (Use and Access) Act 2025 (Commencement No. 6 and Transitional and Saving Provisions) Regulations 2026, SI 2026/82, commenced the relevant DUAA data-protection provisions on 5 February 2026 (made 29 January 2026). The PECR penalty uplift toward UK-GDPR levels (higher of GBP 17.5m or 4% turnover) applies to conduct from that date; pre-DUAA PECR conduct stays at the GBP 500k cap. penalty_model "turnover_pct" is the right label. legislation.gov.uk machine-readable endpoint returned empty/202 at verification time (known behaviour), so the SI number/date were cross-checked via Practical Law, Womble Bond Dickinson, Clifford Chance and Handley Gill — a human primary-source spot-check before release is advisable but not blocking.
- **penalty_model additions to the seven further records** (UK_GDPR_PRIVACY_NOTICE, UK_ICO_FEE_REGISTRATION, UK_TRADING_DISCLOSURES, UK_GDPR_INTERNATIONAL_TRANSFER, UK_DATA_SECURITY_TRANSPORT, UK_OSA_2023, UK_DMCC_UNFAIR_PRACTICES) touch no law fact; each value (turnover_pct/fixed) is consistent with the existing statutory_max/basis. No law fact changed.

**Schema:** `node catalogue/schema.test.js` = 29/29 pass after my correction, including the smoke test over every committed pack; all penalty_model values validate and the uncapped→statutory_max-null invariant holds for both uncapped records.

**Corrected this pass:** UK_EQUALITY_ACCESSIBILITY Vento intermediate boundaries 11,700/35,200 → 12,100/36,400 (basis prose + provenance line).

Verdict: **approved.** One factual correction applied; no fabricated law, no wrong statute, no mis-gated record.
