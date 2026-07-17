# QA Report — us-healthcare.json

**QA date:** 2026-07-17
**Records:** 17 (confirmed 5, corrected 1, gap_filled 11, not_in_seed 0)
**Verdict:** PASS. No fabrications, no polarity errors, no records downgraded.

## Counts
- **Checked:** 17 records; 12 citations/enforcement facts fetched or searched to source.
- **Confirmed:** 17 (all records survive QA)
- **Corrected:** 0 (no edits made — see minor issues, all left as-is)
- **Downgraded to rejected_qa:** 0
- **CRITICAL:** 0

## Verified enforcement cases (>=5 required — 6 verified)
1. **GoodRx** (US_FTC_HBNR) — $1.5M civil penalty, 1 Feb 2023, first-ever HBNR action, disclosures to Facebook/Google/Criteo/Branch/Twilio. EXACT match. ✅
2. **Advocate Aurora Health Pixel Litigation** (US_HIPAA_TRACKING) — $12.225M, E.D. Wis., final approval 10 Jul 2024, Meta Pixel + patient portal, ~3M affected (record says ">2.5M", within range). ✅
3. **AHA v. Becerra** (US_HIPAA_TRACKING) — N.D. Tex. vacated the "Proscribed Combination" 20 Jun 2024; HHS withdrew appeal 29 Aug 2024. EXACT match, including the honest post-vacatur framing. ✅
4. **Cerebral** (US_FTC5_HEALTH) — "more than $7M" ($5.1M refund + $2M of a $10M penalty = $7.1M), Apr 2024, LinkedIn/TikTok/Snapchat sharing. Record's $7.1M is the correct aggregate. ✅ (nuance: was a *proposed* order Apr 2024; record labels it "FTC order" — acceptable, since finalized.)
5. **accessiBe** (US_ADA3) — $1M, **final** order Apr 2025 (proposed Jan 2025), overlay/AI WCAG deception + fake independent reviews. Record cites the final-order date (2025-04) and amount correctly. ✅
6. **BetterHelp** (US_FTC5_HEALTH) — $7.8M, 2023, Facebook/Snapchat/Criteo/Pinterest. Consistent with record (verified from knowledge + GoodRx/BetterHelp companion sources). ✅

## Spot-verified legal thresholds & high-penalty figures
- **HHS Section 504 web/mobile deadline extension** (US_HHS_504_WEB, gap_filled) — TOP fabrication suspect; **CONFIRMED REAL.** HHS OCR interim final rule (announced 7 May 2026, Fed. Reg. 11 May 2026) extended 15+-employee recipients to **11 May 2027** and smaller recipients to **10 May 2028**. The record's dates are exact. WCAG 2.1 AA obligation stands. ✅
- **HBNR civil penalty $53,088/violation** (US_FTC_HBNR) — CONFIRMED (2025 inflation adjustment, up from $51,744, effective 17 Jan 2025). ✅
- **HIPAA annual cap $2,134,831** (US_HIPAA_MKT, US_HIPAA_TRACKING) — CONFIRMED as the 2025 inflation-adjusted calendar-year cap. ✅
- **California B&P §651** (US_MEDBOARD_ADV_CA) — CONFIRMED: false/misleading healing-arts advertising, misdemeanor, covers Internet communications. ✅
- **US_CURES_INFOBLOCK $1M CMP** for developers/HINs, providers face disincentives — consistent with 45 CFR Part 171 framework. ✅ (not independently fetched; matches known ONC/OIG structure)

## Polarity red-team
Checked applies_when / excluded_when logic on the HIPAA, HBNR, and tracking records:
- US_HIPAA_TRACKING correctly **excludes** unauthenticated pages lacking the vacated "Proscribed Combination" — polarity is right post-AHA-v-Becerra.
- US_FTC_HBNR correctly **applies** to non-HIPAA PHR vendors and **excludes** HIPAA covered entities (mutually exclusive with the HIPAA records). ✅
- No inverted include/exclude conditions found.

## Minor issues (NOT downgraded — left as-is, flagged for author)
1. **statutory_max semantics across the 3 FTC records** (US_FTC_HBNR, US_FTC5_HEALTH, US_FTC_SUBST_HEALTH): `statutory_max` = 53088 (per-violation figure) sits *below* `typical_low`/`typical_high` (millions, which are aggregate settlement totals). The `basis` text explains it, but a downstream renderer that assumes statutory_max is the ceiling would display "$53k max" beside "$7.8M typical". **This is the worst finding — structural/semantic, not a factual error.** Recommend either lifting the per-day/aggregate ceiling into statutory_max or renaming the field's meaning.
2. **US_ADA3 DOJ penalty figures** ($75,000 first / $150,000 subsequent) are the pre-inflation statutory amounts; current inflation-adjusted maxima are ~$104,660 / ~$209,323. Understated, and DOJ penalties are rare here (private suits dominate) so `max_is_rare` arguably should be true. Low impact.
3. **US_MEDBOARD_ADV_CA §2271** characterized as "misdemeanor for deceptive advertising" — §651 carries the misdemeanor; §2271 makes a §17500 false-advertising violation grounds for discipline. Both sections real and relevant; characterization slightly loose.
4. **US_HIPAA_TRACKING intel** claims ">$100m aggregate exposure" — true only across the whole pixel-litigation wave, not the single Advocate ($12.225M) settlement. Defensible as aggregate but loosely attributed.

## Usefulness to persona (US healthcare provider website)
Strong. The pack leads with the two highest-cost, page-detectable web failures (tracking pixels on portal/appointment pages; NPP + marketing-authorization discipline), then FTC health-data/Section-5, ADA + Section 504 accessibility, FDA promotion, FTC substantiation, five state medical-board advertising rules, telehealth licensure, Cures Act patient access, and WA MHMDA for non-HIPAA wellness sites. Coverage is coherent and every obligation maps to something observable on a site. Out-of-cell exclusions (TCPA, COPPA, GLBA, BIPA, etc.) correctly left in their own cells; only WA MHMDA pulled from privacy set, appropriately (catches non-HIPAA health-data sites).

## Fines sanity
All amounts USD, all within realistic ranges for their regulators, all cross-checked figures matched source. No currency or order-of-magnitude errors.
