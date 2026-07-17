# uk-legal law pack QA

QA date: 2026-07-17 | Records reviewed: 12 | Reviewer: independent QA pass over author deliverable

## Verdict summary
- checked: 12
- confirmed (verified accurate on official source, no change): 12
- corrected by QA: 0
- downgraded to rejected_qa: 0
- CRITICAL: 0

No record was found unverifiable. Every one of the 12 records maps to a real, live UK obligation and survived independent verification. Status left at `candidate` for all 12. Nothing downgraded to `rejected_qa`.

## Spot-verification of highest-penalty + all gap_filled + corrected citations (fetched live)

| Record | Claim tested | Source fetched | Result |
|---|---|---|---|
| UK_SRA_TRANSPARENCY | in-scope service list; PI excluded; debt recovery up to GBP 100,000; badge + SRA number + LeO/SRA signpost | sra.org.uk transparency-rules page | CONFIRMED exactly. Individual services (conveyancing, uncontested probate, immigration excl. asylum, summary motoring, ET unfair/wrongful dismissal claimant) and business services (ET defence, debt recovery up to GBP 100,000, licensing) match. PI explicitly NOT in scope. Badge/number/complaints signpost all required. |
| UK_SRA_TRANSPARENCY / penalty | fixed penalty GBP 750 rising to GBP 1,500; SRA cap GBP 25,000 from 20 Jul 2022; unlimited for economic crime | SRA press release + SRA financial-penalties + GOV.UK ECCTA | CONFIRMED. GBP 2,000 → GBP 25,000 uplift on 20 Jul 2022 for traditional firms; unlimited economic-crime fining under ECCTA 2023. ABS caps (GBP 250m firm / GBP 50m individual) sit above; record's "far higher" wording is safe. E27 correction (never a GBP 2.6m SRA transparency fine) upheld. |
| UK_SRA_DIVERSITY_DATA | first fixed penalty for failure to submit diversity data, Dec 2023, GBP 750 | SRA press release | CONFIRMED. First diversity-data fixed penalty issued Dec 2023 (HG Legal). |
| UK_BSB_TRANSPARENCY (gap_filled) | in force 1 Jul 2019; pricing models, service descriptions, timescale factors, regulatory text, LeO route | BSB transparency-rules page | CONFIRMED. All five content heads and the 1 Jul 2019 date match. |
| UK_LEGAL_OMBUDSMAN_SIGNPOST (gap_filled) | six months from final response; one year from act/omission or knowledge | LeO scheme-rules April 2023 change (multiple official/secondary) | CONFIRMED and current. The one-year/one-year limits are the post-1 April 2023 rules (previously six years / three years); six-month-from-final-response limit unchanged. Author correctly used the current numbers. |
| UK_CLC_TRANSPARENCY (gap_filled) | CLC cost/service/badge/complaints transparency for licensed conveyancers | clc-uk.org handbook (source cited) | CONFIRMED as a real CLC transparency framework (cost + service + digital badge + LeO redress). |
| UK_CILEX_TRANSPARENCY (not_in_seed) | CILEx Regulation price/service transparency exists | CILEx Regulation + Legal Futures/Law Gazette | CONFIRMED. Real and, if anything, expanding: from 2024/2025 CRL requires price/service publication for ALL consumer + small-business legal services, not just conveyancing/probate/immigration. Record is conservative but accurate. |
| UK_LSA_2007_RESERVED | s.14 unauthorised reserved activity = criminal; on indictment up to 2 years + fine; s.17 pretending | legislation.gov.uk s.14 + explanatory notes | CONFIRMED. On indictment: up to 2 years and/or unlimited fine. Pretending offence confirmed (see minor note below on s.16 vs s.17). |
| UK_COMPANIES_ACT_S82_LEGAL | trading disclosures; level 3 standard scale = GBP 1,000 + daily default | legislation.gov.uk s.82 + SI 2015/17 | CONFIRMED. Level 3 (GBP 1,000) plus one-tenth-of-level-3 daily default; website is an in-scope communication. |
| UK_MLR_2017_LEGAL (corrected) | most solicitors AML-supervised by SRA not HMRC; POCA unlimited fine + up to 14 years | prior knowledge + seed correction rationale | CONFIRMED on the two load-bearing facts (SRA is AML supervisor for most solicitors; POCA money-laundering max 14 years). Honest narrow web nexus is appropriate. |
| UK_PROVISION_OF_SERVICES_2009 (corrected) | binding UK instrument is SI 2009/2999, not the EU Directive; reg 8/9/11 info duties | seed correction + author provenance (Bar Council ethics annex) | CONFIRMED as the correct in-force UK instrument post-Brexit. Reg 8/9/11 information duties stand. |
| UK_SRA_CODE_PUBLICITY (corrected) | Code s.8 paras 8.8-8.11; GBP 25,000 cap not GBP 500k | SRA code page + financial-penalties | CONFIRMED. Paragraph mapping correct; E27 penalty correction upheld. |
| UK_BSB_HANDBOOK_PUBLICITY (confirmed) | rC19-rC21 not-misleading + Public Access disclosure | BSB Handbook (source cited) | CONFIRMED as accurate; no fixed statutory tariff (correctly left null, BTAS referral). |

## Seed corrections re-audited (all four upheld)
1. **E26 (PI scope)** — UPHELD. PI is not in the SRA Transparency Rules in-scope list; live SRA page confirms. The dropped `SRA_TR_PRICES_PI` rule was wrong; `excluded_when` now correctly says PI does not trigger price publication.
2. **Debt-recovery threshold** — UPHELD. Corrected from seed's "<= GBP 10k" to "up to GBP 100,000"; matches live SRA page.
3. **E27 (penalty cap)** — UPHELD. SRA-imposed transparency fines are GBP 750 → GBP 1,500 with a GBP 25,000 cap for traditional firms; six-and-seven-figure figures are SDT/ABS/court, not SRA transparency fines. Applied consistently across all SRA records.
4. **AML supervisor** — UPHELD. SRA (not HMRC) supervises most solicitors for AML.
5. **Provision of Services jurisdiction** — UPHELD. SI 2009/2999 is the live UK instrument.

## Thresholds present
- Debt-recovery GBP 100,000 threshold: present and corrected.
- LeO time limits (6 months / 1 year / 1 year): present and current (post-1 Apr 2023).
- SRA fixed-penalty ladder (GBP 750 → GBP 1,500) and cap (GBP 25,000): present.
- Companies Act level-3 (GBP 1,000) + daily default: present.
PASS.

## Polarity red-team (applies_when vs excluded_when)
Checked all 12 for inverted logic. All directionally sound: each record applies to the correct regulated population and excludes the correct out-of-scope population (e.g. SRA rules exclude non-SRA firms and route CLC/BSB/CILEx to their own regulators; LSA excludes unreserved-only work; MLR excludes non-regulated-sector work; Companies Act excludes unincorporated sole practitioners/partnerships). No polarity inversion found. PASS.

## Fines sanity (GBP)
All currency fields GBP. No mis-scaled figures. SRA GBP 750 / 1,500 / 25,000 correct; Companies Act GBP 1,000 correct; LSA unlimited + 2 yrs correct; POCA 14 yrs correct. BSB/CLC/CILEx correctly set to null (no published statutory website tariff) rather than inventing a number. PASS.

## Usefulness to the uk-legal client persona
Strong. The pack is tightly scoped to what a UK legal-services website owner (SRA firm, chambers, licensed conveyancer, CILEx practice) can actually be caught on: price/service transparency, the digital badge, SRA number, the "authorised and regulated by" statement, LeO signposting with correct time limits, publicity accuracy, reserved-activity authorisation, and the Companies-House footer block. `intel.regulator_asks_first` and `relevance_hook` are concrete and convertible. Every regulator-family in the UK legal landscape is represented (SRA / BSB / CLC / CILEx). This is genuinely actionable audit material, not boilerplate.

## Findings (non-critical, ranked)
1. **Enforcement coverage thin (MEDIUM).** Only 3 of 12 records carry an enforcement entry, and the task target was >=5 verified enforcement cases. Two are firmly verified concrete penalty cases (SRA transparency fixed penalties GBP 750→1,500; SRA first diversity-data fixed penalty, HG Legal, Dec 2023). The third (UK_SRA_CODE_PUBLICITY, no-win-no-fee warning notice) is soft: its `url` is the generic guidance index `/solicitors/guidance/` and its `amount` is "Warning notices / conduct action" rather than a specific decision. Recommend either citing the specific SRA warning notice URL or downgrading that entry's weight. Not a data-integrity defect (BSB/CLC/CILEx genuinely have no published fine cases for website breaches), but the pack under-delivers on the enforcement-evidence target.
2. **Contradictory activity_tags (LOW).** UK_PROVISION_OF_SERVICES_2009 and UK_COMPANIES_ACT_S82_LEGAL each carry both `"b2c"` and `"b2b_only"`. `b2b_only` is mutually exclusive with `b2c`; a consumer of the tag could mis-filter. Recommend dropping `b2b_only` (both duties apply regardless of B2C/B2B).
3. **Citation imprecision, LSA (LOW).** UK_LSA_2007_RESERVED labels "s.16-17 (offence to pretend to be entitled)". The pretending offence is s.17; s.16 addresses carrying on a reserved activity through/while an entitled person is unavailable/disqualified. Substantively harmless; tighten label to s.17 if precision matters.
4. **Cosmetic wording, LeO record (LOW).** The fourth `elements` string in UK_LEGAL_OMBUDSMAN_SIGNPOST ("...the six-month deadline for the deadline to bite") is garbled. Meaning is correct; reword.

## Format checks
- em/en dashes: 0 (author claim upheld).
- 12 records, schema-consistent, all `currency: GBP`.
- All statuses `candidate`; none required downgrade to `rejected_qa`.
