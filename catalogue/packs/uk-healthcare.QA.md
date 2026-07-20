<!-- qa-approval pack_sha256=07a5890939cb676fc1128e38bbdb2d373e6e056620e98d39a5574487256dc878 verdict=approved reviewed=2026-07-20 -->
Integrity attestation and review record (legal-QA reviewer Rob, 2026-07-17; re-stamped 2026-07-19 for the additive detection-data change below). This attests that the pack was legally reviewed, including the PR #3 gate-loop corrections (official-source verifications and conservative removals). The 2026-07-19 re-stamp covers ONLY an additive `prohibited_phrases[]` change (detection data, no law fact touched); every name, citation, penalty, nexus and obligation is byte-identical to the 2026-07-17 legal review. The pack_sha256 in the header matches the current pack bytes. It is NOT a release approval. Release requires CI-green plus founder (Aman) phase sign-off at PR merge.

## Detection-data addition 2026-07-19 (prohibited_phrases; P6 breach-detection integrity wave)
The breach proposer's prohibition matcher was rebuilt (hidden-defects.md RANK 1, the "paper tiger"): an `absence` obligation used to compile a match token-set from the LAW'S DESCRIPTIVE PROSE, so it patterned on how the offence is DESCRIBED and never on how the VIOLATION APPEARS, so "Book your Botox treatment" never tripped this record. The descriptive-token fallback is now disabled in `breach/proposers/detection-spec.js`; a prohibition matches on curated `prohibited_phrases[]` (the actual violating language) plus any phrase quoted verbatim in the law prose. This section documents the additive `prohibited_phrases[]` authored into this pack's two `absence` obligations, each a genuine on-page manifestation of the already-approved duty:
- `UK_MHRA_POM_AD_BAN` obl[0]: the POM brand/generic names the record already lists in its own `applies_when` (Botox, Dysport, Bocouture, Azzalure, Xeomin, Wegovy, semaglutide, tirzepatide; plus the MHRA-recognised indirect references the duty itself quotes: 'wrinkle-relaxing injections', 'fat jab', and the common 'anti-wrinkle injections'; Ozempic/Mounjaro are the public brand names for the semaglutide/tirzepatide the record already names). Advertising any of these to the public IS the reg 284 breach. A compliant "we do not offer Botox" is protected by the matcher's unconditional negation guard (C-048/C-060).
- `UK_VMD_POMV_AD` obl[0]: public offers-to-sell of named POM-V products without a prescription (Metacam, Bravecto, Nexgard, Apoquel; POM-V without a prescription), the exact Schedule 1 breach. No OTC (AVM-GSL/NFA-VPS) phrase is patterned, so a compliant OTC listing is untouched.
No obligation `duty`/`elements`, `evidence_type`, penalty, citation or nexus was changed.

# UK Healthcare Law Pack — QA

Reviewer pass over `uk-healthcare.json` (17 records). Date: 2026-07-17.
Method: structural validation, live citation fetches (legislation.gov.uk / regulator sites / web search of official sources), polarity red-team, penalty/currency sanity, enforcement verification.

## Verdict

**PASS with corrections.** No fabricated laws, no wrong-statute records, nothing unverifiable enough to reject. Three evidence-backed corrections applied in place. The pack's central P0 fix (reg 284) is verified correct.

## QA outcome counts
- Checked: 17
- Confirmed (citation verified against official/authoritative source): 8 spot-verified directly, remainder rest on well-established statutes
- Corrected (edited in place this pass): 3 edits across 2 records
- Downgraded to `rejected_qa`: 0
- CRITICAL (fabricated law / wrong statute / invented enforcement): 0

## Structural checks
- Valid JSON, parses clean after edits.
- 17 records, 17 unique IDs, zero duplicates.
- All 18 required fields present on every record.
- Provenance mix matches the author report: confirmed 7 / corrected 3 / gap_filled 4 / not_in_seed 3.
- Currency GBP on all 17; jurisdiction UK on all 17. Consistent.

## Citations spot-verified (10 highest-value + all gap_filled + not_in_seed)

| Record | Citation claim | Result |
|---|---|---|
| UK_MHRA_POM_AD_BAN | HMR 2012 **reg 284** = POM public-advertising ban | **CONFIRMED.** Reg 284(1): "A person may not publish an advertisement that is likely to lead to the use of a prescription only medicine." Seed's "reg 286-297" was wrong; the correction to reg 284 is right. The P0 is fixed correctly. |
| UK_MHRA_POM_AD_BAN | Enforcement: CAP/MHRA botox social-media notice | Notice is **real and live** at the cited asa.org.uk URL — BUT dated **09 Jan 2020**, not "2025-01" as recorded. **Corrected → 2020-01.** |
| UK_BOTOX_FILLER_U18 | Botulinum Toxin & Cosmetic Fillers (Children) Act 2021 s.1 | CONFIRMED. Offence to administer botox/filler to under-18 in England; in force 1 Oct 2021; unlimited fine. Negation guard correctly encoded. |
| UK_CQC_20A_RATING | Reg 20A display-rating duty; CQC prosecutes without warning | CONFIRMED on duty and no-warning-notice power. Penalty figure wrong — see below. |
| UK_HCPC_PROTECTED_TITLE | Health Professions Order 2001 **art 39** protected-title offence | CONFIRMED. Art 39, "physiotherapist" protected, criminal offence for unregistered use. |
| UK_GOC_OPTICIANS | Opticians Act 1989 **s.28** title misuse | CONFIRMED. s.28 makes unregistered use of "optometrist"/"optician" titles a criminal offence. |
| UK_HFEA_ADVERTISING | HFE Act 1990 **s.25** Code of Practice basis | CONFIRMED (s.25 = statutory Code of Practice). |
| UK_CARE_HOME_FEES | CRA 2015 + DMCC Act 2024 Part 4 + CMA care-homes advice | CONFIRMED framework; DMCC 10%-of-turnover penalty power accurate. |
| UK_GMC_GMP_2024 | GMC Good Medical Practice 2024 | CONFIRMED (GMP 2024 in force 30 Jan 2024). |
| UK_NHS_BRANDING | DMCC 2024 Part 4 + NHS identity | Framework accurate; see polarity note. |

legislation.gov.uk returns empty through the fetch layer (the author flagged this; reproduced it). All legislation citations above were therefore cross-checked via official regulator statements and authoritative secondary sources, never assumed.

## Corrections applied in place
1. **UK_MHRA_POM_AD_BAN → enforcement[0].date**: `2025-01` → `2020-01`. The cited CAP/MHRA botox notice is genuinely dated January 2020; recording it as 2025 presented a 5-year-old action as current.
2. **UK_MHRA_POM_AD_BAN → provenance.sources**: `gov.uk/guidance/advertising-rules-for-medicines` (HTTP 404) → `gov.uk/guidance/advertise-your-medicines` (live). Broken source link.
3. **UK_CQC_20A_RATING → penalty**: `typical_low/high` was `null/2500`. CQC's published practice is a **£100 fixed penalty notice** for failure to display; £2,500 (level 4) is the prosecution ceiling. Set `typical_low/high` = 100, kept `statutory_max` = 2500, and rewrote `basis` to distinguish the FPN from the prosecution ceiling. Prior `typical_high: 2500` overstated the typical outcome 25x.

## Downgrades
None. Every record's load-bearing citation verifies; no record is unverifiable or fabricated.

## Polarity red-team (prohibition vs presence)
- UK_MHRA_POM_AD_BAN obligation 1 = `evidence_type: absence` — CORRECT (breach when the POM name/image/hashtag is PRESENT). The dead-regex polarity bug is properly inverted.
- UK_VMD_POMV_AD = `absence` — CORRECT (breach when POM-V promoted).
- Negation guards present and correct on UK_BOTOX_FILLER_U18, UK_GDC_SPECIALIST_TITLE, UK_HFEA_ADVERTISING, UK_NHS_BRANDING, UK_HCPC_PROTECTED_TITLE — each prevents a compliant statement (age gate / "special interest" / HFEA-linked data / genuine NHS contract / unprotected descriptor) from scoring as a breach.
- **Soft note (not corrected):** UK_NHS_BRANDING is a "do not imply NHS" prohibition but uses `evidence_type: presence`. Mitigated by a tight `applies_when` gate (only fires when the site references NHS/NHS branding), so a purely private site that never mentions NHS will not misfire. Acceptable as-is; worth watching if the scorer ignores `applies_when`.

## Penalty / fine sanity
- All GBP, all UK — clean.
- Numeric penalties exist on only 3 of 17 records (CQC_20A now 100/2500; MHRA and GPHC both 20000/500000). The 20k–500k bands are explicitly labelled "investigation/settlement exposure not the statutory ceiling" — honest hedge, not presented as a statutory figure. Acceptable.
- The other 14 records leave penalty numbers null with a prose `basis` (unlimited fines / professional sanctions / turnover-based). Correct — no invented figures.

## Enforcement coverage — the structural gap
- The QA brief expected ≥5 verified enforcement cases. **The pack contains exactly 1** (the CAP/MHRA botox notice). All other `enforcement` arrays are empty.
- The one case is real (verified live) but was mis-dated (now fixed).
- This is a deliberate no-fabrication choice by the author (empty where no official URL exists) and is defensible under accuracy-first doctrine — but it means the pack is thin on the social-proof enforcement examples the client persona finds persuasive. Recommend a follow-up pass to add real, URL-backed cases (e.g. GDC/GMC FtP determinations, ASA upheld rulings, HFEA licence actions) rather than leaving 16 of 17 records with no enforcement example.

## Client usefulness (uk-healthcare persona)
Strong. Every requested sub-sector covered (GP, dental, pharmacy, aesthetics, fertility, telemedicine, care home, mental health, optometry, physio, veterinary). `website_obligations.elements` are concrete and checkable (show GMC/GDC/GOC/HCPC number, display CQC rating + link, remove POM names/hashtags, MHRA distance-selling logo, age-gate bookings). `intel` hooks are sharp and sales-usable.

## Residual open items (not blocking)
- Reg 20A `statutory_max` of £2,500 retained as the level-4 prosecution ceiling; if a deeper read of SI 2014/2936 reg 25 shows a different scale, revisit.
- MHRA distance-selling logo: **resolved in the P2 wave (see below).** The mandatory EU common / MHRA distance-selling logo now applies to **Northern Ireland** sellers only (Windsor Framework); Great Britain (England/Scotland/Wales) dropped the requirement on 1 Jan 2021 and relies on GPhC registration + the register, with the GPhC internet-pharmacy logo being voluntary.

## P2 law-verification wave (2026-07-17)
- **UK_GPHC_ONLINE_PHARMACY (GB/NI split, CR-15):** verified against GPhC (`pharmacyregulation.org` "providing services online") and GOV.UK ("register for the distance-selling logo" / "new mandatory logo for selling medicines online"). Since 1 January 2021 GB sellers no longer display the EU common (distance-selling) logo; it remains a legal requirement in Northern Ireland under the Windsor Framework. `applies_when` / `excluded_when` / the logo `elements` and `penalty.basis` were rewritten conservatively so the mandatory-logo obligation is scoped to NI, and GB is verified via GPhC registration and the register.
- **All 17 records:** `provenance.last_synced: "2026-07-17"` added.

## Adversarial re-review pass 2026-07-20 (dental-catalogue edits; legal-QA verifier)
Scope: the 2026-07-20 author edits to this pack (UK_GDC_ADVERTISING rewrite; penalty_model on UK_CQC_REGISTRATION + UK_CQC_20A_RATING; new record UK_FCA_CREDIT_PROMOTION_HEALTHCARE) plus the new `penalty.penalty_model` schema rule. Header sha256 re-stamped to current pack bytes.

**Verified against primary sources (not rubber-stamped):**
- **UK_GDC_ADVERTISING citation — CONFIRMED verbatim** against the GDC "Standards for the Dental Team" (June 2014) primary PDF (standards-printer-friendly-colour.pdf, text extracted and read directly): 2.4.1 = "a simple price list is clearly displayed... consultation, single-surface filling, extraction, radiographs... hygienist... 'from – to' price range"; 2.4.2 = clear price information "in your practice literature and on your websites - patients should not have to ask"; 5.1.5 = complaints procedure "displayed where patients can see it - patients should not have to ask for a copy"; 5.1.1 = complaints responsibility; 6.6.10 = display registration numbers; 6.6.11 = "the fact that you are regulated by the GDC"; 1.3.3 = advertising "accurate and not misleading... complies with the GDC's guidance on ethical advertising". Principle 7 / Standard 7.3 = "Maintain, develop and work within your professional knowledge and skills" (CPD), which does NOT cover pricing/complaints/advertising. The author's correction away from a mis-cited "Standard 7.1-7.3" is therefore CORRECT and the new numbered citations are accurate. Three split obligations are node-level checkable and independently quotable.
- **UK_FCA_CREDIT_PROMOTION_HEALTHCARE — not frivolous, correctly gated.** FSMA ss.19/21 and CONC 3.3/3.5 (representative example / representative APR) are real and correctly described; modelled on the existing motor-finance record. Gating verified: activity_tag `financial_promotion` + `applies_when` requires an actual finance/0%/payment-plan/named-lender mention, and `excluded_when` explicitly excludes a site with "no mention of finance, credit, payment plans or monthly pricing anywhere on the site" and genuine no-credit in-house instalments. A practice with no finance copy will NOT fire this record. penalty_model "uncapped" with null typical figures (author declined to invent a per-practice figure) is honest and schema-conformant (uncapped requires statutory_max null; it is null).
- **UK_CQC_REGISTRATION / UK_CQC_20A_RATING** penalty_model additions ("uncapped" / "statutory_cap") touch no law fact; the 20A statutory_cap of GBP 2,500 (level 4) and the reg-12/13 unlimited-fine basis were confirmed in the 2026-07-17 pass and are unchanged.

**Schema:** `node catalogue/schema.test.js` = 29/29 pass, including the smoke test over every committed pack, so the new record (all 18 required fields) and every penalty_model value validate; the uncapped→statutory_max-null invariant holds.

**Corrected this pass:** none in this pack (the GDC rewrite verified clean against the primary source).

**needs_verification / residual:** enforcement[] is empty on the new FCA record (deliberate no-fabrication; the analogous motor-finance action is the real-world anchor). legislation.gov.uk plain-fetch remains bot-walled (202/empty), so FSMA s.21 body text was confirmed via well-established secondary/handbook sources rather than a live primary fetch; a human primary-source spot-check before release is advisable but not blocking.

Verdict: **approved.** No fabricated law, no wrong statute, no frivolous or mis-gated record found.
