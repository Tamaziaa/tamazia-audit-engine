<!-- qa-approval pack_sha256=e101138b1d9a53a9d691b68d66c38eb7f70263e35c98aa773b8d511016dd3f6f verdict=approved reviewed=2026-07-17 -->
Post-QA edits: PR #3 gate-loop corrections (official-source verifications + conservative removals), attested by Rob 2026-07-17.

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
