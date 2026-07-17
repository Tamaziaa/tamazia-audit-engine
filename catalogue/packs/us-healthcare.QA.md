<!-- qa-approval pack_sha256=40f9155c9273c709e2f919c7c3754b8574550e3f22b96eee5d44debefcc37fb9 verdict=approved reviewed=2026-07-17 -->
Integrity attestation and review record (legal-QA reviewer Rob, 2026-07-17). This attests that the pack was legally reviewed, including the PR #3 gate-loop corrections (official-source verifications and conservative removals), and that it is unchanged since review: the pack_sha256 in the header above matches the current pack bytes. It is NOT a release approval. Release requires CI-green plus founder (Aman) phase sign-off at PR merge.

# QA Report — us-healthcare.json

**QA date:** 2026-07-17
**Records:** 17 total. By **seed provenance** (where the row came from): seed-confirmed 5, seed-corrected 1, gap_filled 11, not_in_seed 0. This is a different axis from the **QA-verdict** counts below (whether the row survived this review) — the two "confirmed" numbers measure different things and are labelled here to keep them distinct (CR-23).
**Verdict:** PASS. No fabrications, no polarity errors. Two records (US_MEDBOARD_ADV_TX, US_MEDBOARD_ADV_IL) were conservatively downgraded to needs_verification and excluded from the compiled artifact (retained in the source pack) - see the counts below.

## Counts (QA verdict — did the row survive review)
- **Checked:** 17 records; 12 citations/enforcement facts fetched or searched to source.
- **Confirmed (candidate):** 15 (was 17; two per-state medical-board records were downgraded in the PR #3 round-2 wave, see below)
- **Corrected:** 0 at original QA (a later P2 verification wave, 2026-07-17, applied targeted edits — see the P2 wave section at the foot)
- **Downgraded to needs_verification:** 2 (US_MEDBOARD_ADV_TX, US_MEDBOARD_ADV_IL — per-state penalty consequence not content-verifiable on an official source this pass; excluded from the compiled artifact, retained in the source pack)
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
- **HIPAA annual cap** (US_HIPAA_MKT, US_HIPAA_TRACKING) — the pack's `statutory_max` was $2,134,831 (2024/2025 figure); the **current** highest-tier per-violation maximum and calendar-year cap are both **$2,190,294** for 2026 (HHS annual inflation adjustment, Fed. Reg. 2026-01688, eff. 28 Jan 2026). P2 wave updated both records to $2,190,294. ✅
- **California B&P §651** (US_MEDBOARD_ADV_CA) — CONFIRMED: false/misleading healing-arts advertising, misdemeanor, covers Internet communications. ✅
- **US_CURES_INFOBLOCK $1M CMP** for health IT developers / HINs / HIEs; health care providers face "appropriate disincentives" rather than CMPs — **CONFIRMED** against the HHS-OIG final rule (Fed. Reg. 2023-13851, 3 July 2023; oig.hhs.gov information-blocking page): up to $1,000,000 per violation. P2 wave added both official sources; record stays `candidate` (verified, not `needs_verification`). ✅

## Polarity red-team
Checked applies_when / excluded_when logic on the HIPAA, HBNR, and tracking records:
- US_HIPAA_TRACKING correctly **excludes** unauthenticated pages lacking the vacated "Proscribed Combination" — polarity is right post-AHA-v-Becerra.
- US_FTC_HBNR correctly **applies** to non-HIPAA PHR vendors and **excludes** HIPAA covered entities (mutually exclusive with the HIPAA records). ✅
- No inverted include/exclude conditions found.

## Minor issues (resolved in the P2 wave 2026-07-17 — see foot)
1. **statutory_max semantics on the two §5 records** (US_FTC5_HEALTH, US_FTC_SUBST_HEALTH): the $53,088 sat in `statutory_max` as if it were a Section 5 ceiling, but FTC Act §5 carries **no general civil penalty** — the $53,088 (16 CFR 1.98; 15 U.S.C. 45(l)/(m)) applies only to violations of a prior FTC order or a specific FTC rule. **RESOLVED:** `statutory_max` set to `null` on both, with `basis` naming when a civil penalty does attach (CR-20). (US_FTC_HBNR keeps $53,088 — the HBNR is itself a rule with a per-violation penalty, so that record is correct.)
2. **US_ADA3 DOJ penalty figures** ($75,000 first / $150,000 subsequent) were the pre-inflation statutory amounts. **RESOLVED:** updated to the current inflation-adjusted maxima **$118,225 first / $236,451 subsequent** (28 CFR 85.5, referenced by 28 CFR 36.504, eff. 3 July 2025; Fed. Reg. 2025-12494), and `max_is_rare` set true (private suits dominate; DOJ penalties are rare) (CR-21/CR-25). Note: CodeRabbit floated two different figures; neither matched — the verified current pair from the source of record is $118,225/$236,451.
3. **US_MEDBOARD_ADV_CA §2271/§651** characterisation was reversed. **RESOLVED:** citation.section now reads §651 (false/misleading healing-arts advertising; a §651 violation is a misdemeanor) and §2271 (advertising in violation of the false-advertising law is unprofessional conduct and grounds for licence discipline) (CR-26). The four other state medical-board records (NY/TX/FL/IL) carried the California-specific misdemeanor line in their `penalty.basis`; each now carries jurisdiction-correct consequences with amounts null (CR-22).
4. **US_HIPAA_TRACKING intel** claimed ">$100m aggregate exposure". **RESOLVED:** reworded to attribute the >$100m to the hospital pixel-tracking litigation wave, not the single Advocate ($12.225M) settlement (CR-27).

## Usefulness to persona (US healthcare provider website)
Strong. The pack leads with the two highest-cost, page-detectable web failures (tracking pixels on portal/appointment pages; NPP + marketing-authorization discipline), then FTC health-data/Section-5, ADA + Section 504 accessibility, FDA promotion, FTC substantiation, five state medical-board advertising rules, telehealth licensure, Cures Act patient access, and WA MHMDA for non-HIPAA wellness sites. Coverage is coherent and every obligation maps to something observable on a site. Out-of-cell exclusions (TCPA, COPPA, GLBA, BIPA, etc.) correctly left in their own cells; only WA MHMDA pulled from privacy set, appropriately (catches non-HIPAA health-data sites).

## Fines sanity
All amounts USD, all within realistic ranges for their regulators, all cross-checked figures matched source. No currency or order-of-magnitude errors.

## P2 law-verification wave (2026-07-17) — summary of applied edits
Every figure below was re-verified on an official source of record before editing; verification URLs are recorded in each record's `provenance.sources`.
- **US_HIPAA_MKT / US_HIPAA_TRACKING:** `statutory_max` 2,134,831 → **2,190,294** (2026 HHS inflation adjustment, Fed. Reg. 2026-01688).
- **US_FTC5_HEALTH / US_FTC_SUBST_HEALTH:** `statutory_max` 53,088 → **null** (FTC Act §5 has no general civil penalty; the $53,088 rule/order figure is described in `basis`).
- **US_ADA3:** DOJ Title III maxima → **$118,225 first / $236,451 subsequent** (28 CFR 85.5, eff. 3 Jul 2025); `max_is_rare` true.
- **US_CURES_INFOBLOCK:** $1M CMP confirmed on the HHS-OIG final rule; official sources added.
- **US_MEDBOARD_ADV_CA:** §651 (misdemeanor) / §2271 (discipline) characterisation corrected.
- **US_MEDBOARD_ADV_NY / TX / FL / IL:** California-specific misdemeanor line removed; jurisdiction-correct disciplinary consequences written. **Superseded by the PR #3 round-2 per-state verification wave (2026-07-17, see foot):** each state's penalty consequence was then either content-verified on that state's official legislature source (NY, FL — kept `candidate`) or downgraded to `needs_verification` where the official source was not content-verifiable this pass (TX, IL — excluded from the artifact). The earlier "not independently verified per-state" caveat no longer applies to any record shipped as `candidate`.
- **US_TELEHEALTH_LICENSURE:** `advisory: true` added (multi-state licensure is an obligation-to-confirm, not a hard breach).
- **US_HIPAA_TRACKING:** ">$100m" attributed to the pixel-litigation wave.
- **All 17 records:** `provenance.last_synced: "2026-07-17"` added.

## PR #3 round-2 per-state medical-board verification (2026-07-17)
CodeRabbit flagged that the earlier wave shipped the NY/TX/FL/IL per-state penalty consequences as `candidate` without independent per-state verification. Each was re-checked against that state's own official source; the consequence was either content-verified and cited, or the record was downgraded to `needs_verification` (which the compiler excludes from `catalogue.v1.json`, keeping it visible and logged in the source pack). No unverified per-state legal consequence remains as `candidate`.

| Record | Official source fetched | Outcome | Basis now shipped |
|---|---|---|---|
| US_MEDBOARD_ADV_NY | nysenate.gov — N.Y. Pub. Health Law 230-a; op.nysed.gov — Educ. Law 6530(27) | **Verified, kept `candidate`** | Fine not exceeding USD 10,000 upon each specification of charges, plus censure, suspension, revocation. `statutory_max` 10,000. |
| US_MEDBOARD_ADV_FL | flsenate.gov — Fla. Stat. 456.072(2) | **Verified, kept `candidate`** | Administrative fine up to USD 10,000 per count or offence, plus reprimand, probation, suspension, revocation. `statutory_max` set 10,000 (was null). Penalty authority corrected from a bare 458.331 reference to 456.072(2). |
| US_MEDBOARD_ADV_TX | statutes.capitol.texas.gov — Tex. Occ. Code 164 | **Downgraded to `needs_verification`** | Official Texas Statutes site returns a client-rendered navigation shell to automated fetching, so 164.052(a)(6) and the board's penalty authority (164.001 / Ch. 165) could not be content-verified. Ground corroborated only on secondary sources. Amounts null; excluded from artifact. |
| US_MEDBOARD_ADV_IL | ilga.gov — 225 ILCS 60/22 | **Downgraded to `needs_verification`** | Official Illinois General Assembly host refused the connection (ECONNREFUSED) from the verification environment and no alternative official host serves the ILCS. Unreachable is not disproof, but the consequence must not ship unverified. Amounts null; excluded from artifact. |

Re-verification of the two downgraded records (a reachable fetch of the TX statute text and the IL ILCS section on ilga.gov) is the single open item to restore them to `candidate`.
