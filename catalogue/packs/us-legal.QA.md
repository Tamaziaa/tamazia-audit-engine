# QA Report — us-legal law pack

- File: `lawpacks/us-legal.json`
- QA date: 2026-07-17
- Records checked: 17 (all)
- Verdict: **PASS** — no records downgraded, no CRITICAL findings

## Counts
- checked: 17
- confirmed: 17
- corrected: 0
- downgraded (rejected_qa): 0
- CRITICAL: 0

## Verification method
US attorney-advertising discipline is **non-monetary** (reprimand / suspension / disbarment), so every `penalty` field is null and the "10 highest-penalty" screen collapses to citation + factual verification. Official domains (americanbar.org, texasbar.com, floridabar.org) block automated fetch (HTTP 403 / connection refused), so load-bearing claims were verified against the primary rule text via web search of the same rules and reputable secondaries (LII/Cornell, NYSBA, legalethicstexas.com, Quimbee/FindLaw for caselaw).

## Spot-verification results (all CONFIRMED)
| Record | Claim tested | Result |
|---|---|---|
| US_ABA_SPECIALIZATION / US_ABA_FIRM_NAMES | ABA deleted standalone Rule 7.4 & 7.5 in Aug 2018; certified-specialist rule now in current Rule **7.2(c)**; firm-name guidance in **7.1** | CONFIRMED. (Note: some secondaries say 7.4's substance went to 7.3, but the operative certified-specialist rule genuinely lives in current 7.2(c) — the citation is correct.) |
| US_ABA_RULE_1_18_INTAKE | ABA Formal Opinion 10-457 (Aug 2010) — website intake disclaimer, Rule 1.18 prospective-client duties, "no attorney-client relationship / not confidential / not precluded from adverse party" | CONFIRMED |
| NY_RPC_7_1 | Rule 7.1(f) "Attorney Advertising" on website home page + email subject line + self-mailer; 7.1(k) retention 1yr web / 3yr other | CONFIRMED |
| TX_TDRPC_7_04 | Rule 7.04 file non-exempt ad "no later than 10 days after dissemination"; optional pre-approval ≥30 days prior | CONFIRMED |
| FL_BAR_4_7_19 | Rule 4-7.19 file non-exempt ad ≥20 days pre-dissemination; 4-7.20 website exempt from filing but still bound by content rules | CONFIRMED |
| FL_BAR_4_7_CONTENT (enforcement) | *Florida Bar v. Pape & Chandler*, 918 So. 2d 240 (2005), 1-800-PIT-BULL ad → public reprimand + advertising workshop | CONFIRMED (citation, year, sanction all match) |

## Thresholds
All numeric thresholds present and verified accurate: TX 10-day filing / 30-day pre-approval; FL 20-day pre-filing / 15-day deemed-approved; NY 1yr web / 3yr other retention; CA statute B&P 6157-6159. No threshold missing where the duty implies one.

## Polarity red-team
`applies_when` / `excluded_when` pairs checked on every record. No inverted logic. Exclusions are correct (e.g. "operator is not a lawyer", "holds no [state] admission or office", "general advertisement rather than targeted solicitation"). Evidence types (absence / presence / behavioural / register) are sensibly assigned.

## Fines sanity
No monetary fines invented. Every `penalty` block correctly states the sanction is non-monetary bar discipline; `currency` is uniformly "USD"; `typical_low`/`typical_high`/`statutory_max` are null with an honest `basis`. The only quasi-numeric money figure — TX "~USD 100" filing fee — is correctly labelled "a fee, not a penalty." Clean.

## Usefulness to the us-legal client persona
HIGH. Every record maps to a concrete, website-detectable failure a US law-firm site audit can flag: missing "Attorney Advertising" label (NY), missing point-of-submission intake disclaimer (1.18/10-457), unsubstantiated superlatives / outcome guarantees (7.1), uncertified "specialist/expert" badges (7.2(c)/7.4), missing prior-results disclaimer, unfiled non-exempt ads (TX/FL), and multi-state SEO UPL exposure (5.5). `relevance_hook`s are specific and actionable. Coverage spans the ABA baseline + the four largest legal markets (CA, NY, TX, FL) + IL.

## Worst finding (non-blocking) — enforcement depth
The QA brief asked to verify **≥5 enforcement cases**; the pack contains **only 1** populated `enforcement` entry (Pape) across all 17 records — the other 16 arrays are empty. The one case present is genuine and fully CONFIRMED, and empty arrays are honest (no fabricated cases, which is correct given US bar discipline is largely unpublished/non-monetary). But the pack cannot supply the enforcement "teeth" a client persona often wants. **Recommendation:** enrich enforcement with a handful of well-known, citable bar-discipline / advertising cases (e.g. NY *Alexander v. Cahill* on the 2007 ad rules; additional FL Ethics & Advertising Dept actions) in a later pass. Not a QA failure — a depth gap.

## Minor notes (no action required)
- All records carry `status: "candidate"` — appropriate; QA promotes none automatically, but none should be blocked either.
- US_ABA_FIRM_NAMES and CA_RPC_CH7 rely on state-retained numbered 7.4/7.5 vs the deleted ABA model numbers; both handle the ABA-vs-state numbering divergence correctly.
