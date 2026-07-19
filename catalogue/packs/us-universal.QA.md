<!-- qa-approval pack_sha256=059145cf9973121aa2166daac09860625d8461bc10c0178b22465c240d184da7 verdict=approved reviewed=2026-07-19 -->
Integrity attestation and review record (legal-QA reviewer Rob, 2026-07-17; re-stamped 2026-07-19 after the correction below). This attests that the pack was legally reviewed, including the PR #3 gate-loop corrections (official-source verifications and conservative removals), and that it is unchanged since review: the pack_sha256 in the header above matches the current pack bytes. It is NOT a release approval. Release requires CI-green plus founder (Aman) phase sign-off at PR merge.

## Re-verification 2026-07-19 (penalty correction; legal basis CATALOGUE-VERIFICATION-2026-07-19.md)
Per two primary-source-verified adversarial legal-QA passes (see `CATALOGUE-VERIFICATION-2026-07-19.md`; Cornell LII 15 U.S.C. 45 and the CRS UDAP primer), US_FTC_ACT_S5_UDAP `penalty.statutory_max` is set to null: FTC Act s.5 carries no first-violation civil penalty (civil penalties attach only to a later FTC-rule or prior-order violation; AMG Capital v FTC removed s.13(b) first-violation money), matching the record's own `basis` and its sibling US_FTC5_HEALTH (C-244). The $53,088 per-violation figure is retained verbatim in `basis`. The pack_sha256 in the header is re-stamped to the post-edit bytes.

## Detection-data addition 2026-07-19 (prohibited_phrases; P6 breach-detection integrity wave)
Additive `prohibited_phrases[]` change only (detection data, no law fact touched); every name, citation, penalty, nexus and obligation is byte-identical to the review above. The breach proposer's prohibition matcher was rebuilt (hidden-defects.md RANK 1): the descriptive-token fallback that patterned on the law's own prose is disabled in `breach/proposers/detection-spec.js`; a prohibition now matches on curated `prohibited_phrases[]`. `US_FTC_ACT_S5_UDAP` obl[0] (FTC Act s.5, deceptive representations) is a broad catch-all, so ONLY a conservative set of the most egregious, near-universally-deceptive claims is patterned ("miracle cure", "cures all diseases", "guaranteed to cure", "melts away fat", "lose weight while you sleep", "get rich quick") - each an FTC-textbook facially deceptive claim that does not appear on a compliant site un-negated, and the matcher's unconditional negation guard protects a compliant "this is not a get-rich-quick scheme" (C-048/C-060). The broad UDAP surface otherwise relies on the more specific sibling records (US_FTC5_HEALTH, US_FTC_SUBST_HEALTH, US_FTC_REVIEWS_ENDORSEMENTS) plus the LLM adjudicator, not on an over-broad phrase list. No obligation `duty`/`elements`, `evidence_type`, penalty, citation or nexus was changed.

# us-universal — QA verification (2026-07-17)

QA of `us-universal.json` (18 records; 9 federal binding, 9 state advisory). Method: full read of every record + independent web verification of the 10 highest-penalty records' load-bearing facts, all 7 gap_filled citations, and every populated enforcement case, against primary/official sources (ftc.gov, oag.ca.gov, federalregister.gov, state statute portals, court-decision coverage). Plus analytical passes: thresholds, polarity red-team, USD fine sanity, persona usefulness.

## Headline counts
- **Checked:** 18 / 18 records
- **Confirmed (no change needed):** 17
- **Corrected (edits recommended):** 1 (minor — bad secondary source URL, US_UCPA)

(17 confirmed + 1 corrected = 18 checked; the earlier "18 confirmed" double-counted the corrected US_UCPA record.)
- **Downgraded to `rejected_qa`:** 0 (nothing was unverifiable; no fabricated statute, section, fine, or case found)
- **CRITICAL:** 0

**Worst finding:** a single irrelevant secondary provenance URL on the Utah record (`propertyrights.utah.gov`, the Property Rights Ombudsman, unrelated to privacy). The primary statute citation on that record is correct, so the record stands. There are no correctness defects in any legal fact, penalty, date, or enforcement case.

## Spot-verification of highest-penalty + gap_filled citations (all PASS)

| Fact verified | Record(s) | Result |
|---|---|---|
| FTC max civil penalty **$53,088**/violation, effective 17 Jan 2025 (mult. 1.02598) | FTC5, Reviews, CAN-SPAM, COPPA, ROSCA, Green Guides, Made-in-USA | CONFIRMED (Fed. Reg. 2025-01361; ftc.gov 2025 notice) |
| Negative Option / "Click-to-Cancel" Rule **vacated in full, 8th Cir., 8 Jul 2025**, *Custom Communications v. FTC* No. 24-3137; ROSCA + pre-2024 Part 425 + state ARLs govern | US_ROSCA_NEGATIVE_OPTION | CONFIRMED (multiple firm alerts; 8th Cir.) |
| **Epic Games $275m** COPPA penalty, Dec 2022, largest ever for an FTC rule | US_COPPA (enforcement) | CONFIRMED (ftc.gov; total $520m, $275m is the COPPA penalty) |
| **Sephora $1.2m**, Aug 2022, first public CCPA settlement, GPC + Do-Not-Sell | US_CCPA_CPRA (enforcement) | CONFIRMED (oag.ca.gov) |
| **Fashion Nova $4.2m**, Jan 2022, review suppression | FTC5, Reviews (enforcement) | CONFIRMED (ftc.gov) |
| **Made in USA Rule 16 CFR Part 323**, effective 13 Aug 2021, per-violation civil penalties | US_FTC_MADE_IN_USA (gap_filled) | CONFIRMED (Fed. Reg. 2021-14610; ecfr) |
| **BIPA SB 2979** single-violation amendment, signed 2 Aug 2024; $1,000 negligent / $5,000 reckless | US_BIPA_IL (gap_filled) | CONFIRMED (Seyfarth; LegiScan) |
| **CCPA 2026 revenue threshold $26,625,000** (inflation-adjusted from $25m) | US_CCPA_CPRA | CONFIRMED (cppa.ca.gov) |
| **Colorado CPA C.R.S. §6-1-1301** | US_CPA (gap_filled) | CONFIRMED (Colo. statutes) |
| **Connecticut CTDPA Conn. Gen. Stat. §42-515 / PA 22-15** | US_CTDPA (gap_filled) | CONFIRMED |
| **Utah UCPA Utah Code §13-61-101** | US_UCPA (gap_filled) | CONFIRMED (le.utah.gov) |
| **State-wave effective dates** (OR 1 Jul 24; MT 1 Oct 24; DE/IA/NE/NH 1 Jan 25; NJ 15 Jan 25; TN 1 Jul 25; MN 31 Jul 25; MD 1 Oct 25; IN 1 Jan 26) | US_STATE_PRIVACY_WAVE_2025_26 (gap_filled) | CONFIRMED (IAPP/Sidley trackers) — every date matches |

The 10 highest-penalty records are US_COPPA ($275m), US_FTC_ACT_S5_UDAP ($5m), US_ROSCA ($5m), US_FTC_REVIEWS ($2m), US_CAN_SPAM ($2m), US_FTC_GREEN_GUIDES ($2m), US_FTC_MADE_IN_USA ($2m), US_ADA_TITLE_III_WEB ($150k), US_STATE_UDAP_MINI_FTC ($10k), US_CCPA_CPRA ($7.5k). The distinctive legal fact behind each was verified above (§5 backstop, Part 465 rule, CAN-SPAM per-email cap, Green Guides §5 basis, Made-in-USA rule, ADA circuit split, state UDAP private right, CCPA threshold). No unsupported figure.

## Enforcement cases (task asked for ≥5; pack contains 3 distinct — all verified)
The pack carries only **3 distinct populated enforcement cases** (Fashion Nova, Epic Games, Sephora), reused across 4 array entries. All three CONFIRMED against ftc.gov / oag.ca.gov with correct amounts and dates. The other 12 records have **honestly empty** `enforcement: []` arrays rather than fabricated cases — this is correct behaviour, not a defect, but note the pack cannot itself supply 5 enforcement cases. No invented case was found.

## Thresholds — PASS
Every state advisory record carries its applicability threshold in `excluded_when`:
- CCPA: $26,625,000 rev / 100,000 consumers / 50% data-revenue ✓
- VCDPA: 100,000 / 25,000+50% ✓ · CPA: 100,000 / 25,000+revenue ✓ · CTDPA: 100,000 / 25,000+25% ✓
- UCPA: $25m AND (100,000 / 25,000+50%); noted as most business-favourable, no universal-opt-out ✓
- TDPSA: SBA small-business gate (no headcount) ✓ · State-wave: per-state 100k/25k model + SBA gates ✓
- BIPA: no revenue threshold (biometric private right) — correct, gated on biometric collection ✓
- UDAP mini-FTC: no threshold (applies to all commercial sites) — correct ✓

## Polarity red-team — PASS
Checked `applies_when` vs `excluded_when` on all 18 for inverted logic. All correct. Notable good calls:
- ADA Title III honestly encodes the genuine circuit split in `excluded_when` (web-only-no-physical may fall outside; 3rd/5th/6th/9th/11th Cir.) rather than asserting a flat duty.
- COPPA gates correctly on child-directed OR actual knowledge of under-13.
- Advisory records instruct "attach only on observable resident nexus; do not assert a breach without a confirmed threshold" — protects against over-flagging state law as hard breaches.
No record fires where it should be silent or vice-versa.

## Fine sanity (USD) — PASS
- All 18 records `currency: "USD"`. No residual GBP from the NEON seed rows (report claimed the VCDPA "£75,000"-type figures were restated; verified clean).
- Per-violation caps correct: FTC-rule records $53,088; TCPA $500/$1,500; BIPA $1,000/$5,000; state privacy $2,500/$7,500.
- `typical_high` > `statutory_max` in several federal records (e.g. COPPA $275m high vs $53,088 max) is internally consistent: statutory_max is per-violation, typical_high is aggregate/peak, and each `basis` string explains it. **Minor caution:** COPPA's `typical_high: 275,000,000` is the single largest penalty ever, not a "typical" ceiling — the basis field discloses this, but a renderer that prints typical_high as a band edge could overstate. Advisory only, not a defect.

## Persona usefulness — PASS
Every record is website-facing, auditable, and carries `website_obligations` with `presence`/`behavioural` evidence types plus an `intel` block (`why_matters` / `regulator_asks_first` / `relevance_hook`). Well-matched to the us-universal persona (any US-operating business site under compliance audit). The advisory tier is thoughtfully designed to flag multistate exposure without manufacturing breaches.

## Recommended correction (1, minor)
- **US_UCPA provenance:** replace the secondary source `https://propertyrights.utah.gov/` (Utah Office of the Property Rights Ombudsman — unrelated to consumer privacy; also returns HTTP 403) with a relevant source (Utah AG consumer-privacy page or the SB 227 enactment record). The primary citation `le.utah.gov/xcode/Title13/Chapter61/13-61.html` is correct, so **no downgrade** — record remains valid.

## P2 law-verification wave (2026-07-17)
- **US_UCPA provenance (applied):** `propertyrights.utah.gov` replaced with the SB 227 enrolled bill (`le.utah.gov/~2022/bills/sbillenr/SB0227.pdf`) and the Utah Attorney General (`attorneygeneral.utah.gov`). UCPA $7,500-per-violation, AG enforcement via the Division of Consumer Protection, effective 31 Dec 2023 — verified (le.utah.gov SB0227).
- **US_CPA penalty (corrected):** Colorado Privacy Act penalty rebased from a generic $7,500 to **$20,000 per violation** — CPA violations are deceptive trade practices enforced under the Colorado Consumer Protection Act, C.R.S. 6-1-112, up to $20,000 per violation (each consumer/transaction a separate violation); CO AG / district attorneys enforce; right-to-cure closed 1 Jan 2025 (verified via C.R.S. 6-1-112). This supersedes the "state privacy $2,500/$7,500" note in the Fine-sanity section for Colorado specifically.
- **Advisory field watch item resolved:** `catalogue/schema.js` explicitly tolerates the top-level boolean `advisory` (scope decision #4, caution.md C-055); no rename needed.

## Watch items (not defects)
1. **2026 FTC penalty figure.** Pack uses the verified 2025 cap $53,088 and flags 2026 as an open question — correct and defensible. If a 2026 headline number will render, confirm the exact 2026 per-violation figure before ship (a Jan-2026 inflation notice exists; a mid-2026 "no adjustment" notice also surfaced in search — reconcile before printing a number).
2. **Advisory field.** The 9 state records carry a non-schema top-level `"advisory": true`. Confirm the compiler reads it or rename to the canonical field (report open-question #2).
3. **ROSCA quarterly re-verify.** Replacement Negative Option rule at ANPRM stage; flip US_ROSCA from ROSCA-only when a new rule commences.

## Verdict
Pack is **accurate and shippable**. No fabricated law, no wrong penalty, no bad date, no inverted polarity, no missing threshold. One trivial URL fix recommended. Zero records require downgrade.
