# Reference-oracle verification proposals (U4)

Author: U4 (reference-oracle verification researcher). Date: 2026-07-18. Branch: `p3-tail`.
Status: PROPOSALS ONLY. Reference-set expectation changes are founder-gated (AGENTS.md sections 6 and 7). This document changes no engine or eval file. Nothing here is applied; every item is for founder sign-off.

Scope (per docs/P3-TAIL-ACCEPTANCE.md section U4):
1. The 5 known_breach entries: primary-source legal verification, committed-fixture-corpus factual basis, a precise verbatim match token present in the corpus (replacing the loose token), and a confidence note.
2. Status review of the 17 PRD-sourced firms (fixture-grounded, live and register checks where cheap).
3. Two or three US positive-control firm proposals with evidence and source URLs.

## How to read this (the one law the oracle lives by)

The engine must MATCH or ABSTAIN, never CONTRADICT (AGENTS.md section 6). A `known_breach.match_any` token is matched by `eval/reference-set/verify.js` against the engine's ASSERTED FINDINGS text (`norm(findingText).includes(norm(token))`, lowercased, non-alphanumerics collapsed to spaces), not against the corpus directly. A breach is "reproduced" (eval/e2e/lib/judge.js) when a finding's text contains a token.

Why the token must ALSO be present in the committed corpus: the breach lane is propose -> verify -> adjudicate (breach/proposers/propose.js, breach/verifiers/quote-match.js, breach/adjudicator/adjudicate.js). A PRESENCE-breach candidate carries a VERBATIM QUOTE that gate 2 (quote-match) re-matches against the corpus. A finding that reproduces such a breach therefore contains a verbatim corpus string. So a discriminating token is one that (a) is verbatim present in the frozen corpus and (b) evidences THIS breach specifically, so a compliant firm would not emit it. The loose tokens ("GDPR", "broken link") fail (b): they either never appear in the corpus or would fire on compliant self-declarations.

The committed fixture corpus is `eval/reference-set/fixtures/<domain>.json` for the reference firms (loaded by run-facts.js and the e2e breach lane) and `eval/e2e/fixtures/synthetic-quote-breach.json` for the synthetic control. Corpus text lives in `corpus.pages[].text` and `corpus.footerText`; grepping the JSON file greps the corpus.

## Verification environment note (C-127 / C-128 / C-129 discipline)

Several official sources were bot-walled or serving the async-generation state during this session. This is recorded honestly and treated per doctrine: a blocked, empty, or HTTP-202 response is never proof of absence, and no fact is fabricated from an unfetched string.

- legislation.gov.uk returned HTTP 202 with a zero-byte body for every provision URL tried (reg 280, UK GDPR articles 13/14, DPA 2018 s.8), sustained across a polling loop of 40 spaced retries per URL. HTTP 202 (not 404) confirms the resource EXISTS and is generating; it does not deliver the text. Existence is recorded as confirmed; verbatim UK text is corroborated from an official mirror where possible and otherwise flagged as pending the definitive 200 body.
- Content that WAS verified this session: 16 CFR Part 323 (eCFR, HTTP 200, full text), and GDPR Articles 13 and 14 (EUR-Lex, the official EU source), and two Companies House company records (HTTP 200).
- Content bot-walled this session (403 / 503 / 302-to-unblock): ICO, ABA (Cloudflare challenge), FTC.gov press releases, federalregister.gov, US Code. Facts drawn from these are cited to the official URL and flagged needs_verification against the source-of-record body where I could not render it, per C-219.

---

# Part 1: The 5 known_breach entries

Headline: 1 of 5 verifies clean against the committed corpus (the synthetic control). The other 4 are UNVERIFIABLE against the committed corpus as currently frozen, for two structural reasons proven by grep below: (i) the fixtures are text-only extractions that preserve NO link hrefs or anchors, so the two link-health breaches cannot be reproduced; (ii) the fixtures did not capture the privacy-policy document text, so the two "thin/absent GDPR policy" breaches have no quotable evidence, and the bare word "GDPR" appears nowhere in any of the four corpora. This corroborates the P3 retrospective headline ("0/5 known_breaches reproduce e2e") and locates its cause in the fixtures, not only the tokens.

## 1.1 example-synthetic-breach.test (SYN-GUARANTEE) - VERIFIED, keep token

- Corpus: `eval/e2e/fixtures/synthetic-quote-breach.json`, `corpus.pages[0].text` = "Example Synthetic Breach Ltd sells widgets online. We guarantee you will win every case, no exceptions, or your money back."
- Primary legal source: none required. The fixture declares framework "synthetic test framework (harness self-test only)" and states it is "NOT a real firm and NOT a real legal claim". The real-world analogue (a guarantee of legal outcome) would engage solicitor-advertising rules, but this fixture is a harness self-test, not a law-pack citation.
- Factual basis in corpus: the prohibited guarantee-of-outcome sentence is present verbatim. This is a PRESENCE-breach (prohibited content found), the one artifact shape (a verbatim quote, breach/proposers/propose.js "absence obligation -> PRESENCE-breach, confidence: strong") that the frozen text corpus can carry.
- Proposed token: KEEP `"guarantee you will win every case"`. It is precise (a guarantee-of-outcome is the breach), discriminating (a compliant firm would not print it), and present.

```
$ grep -o "guarantee you will win every case, no exceptions" eval/e2e/fixtures/synthetic-quote-breach.json
guarantee you will win every case, no exceptions
```

- Confidence: VERIFIED. This is the model the other four should aspire to, and the only one currently reproducible end to end once the breach lane runs.

## 1.2 neuclinic.co.uk (NEU-GDPR) - original UNVERIFIABLE in corpus; a stronger anchorable breach is proposed

Corpus: `eval/reference-set/fixtures/neuclinic.co.uk.json` (3 pages, text 14349 / 13523 / 9635 chars, footer 3000; NOT truncated at the 20000-char cap, so the home/about/team pages are reasonably complete).

(a) Primary legal source for the CLAIMED breach (a UK GDPR problem). The transparency duty that a "thin/absent privacy policy" would engage is UK GDPR Articles 13 and 14 (the assimilated Regulation (EU) 2016/679). Article 13 ("Information to be provided where personal data are collected from the data subject") and Article 14 ("... where personal data have not been obtained from the data subject") were content-verified on the official EU source EUR-Lex (https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679): Article 13(1) opens "Where personal data relating to a data subject are collected from the data subject, the controller shall, at the time when personal data are obtained, provide the data subject with all of the following information ...". The UK primary citation is the assimilated text at https://www.legislation.gov.uk/eur/2016/679/article/13 and /article/14 (existence confirmed by HTTP 202, not 404; live body was in the generating state this session). For special-category health data (an aesthetics clinic) the relevant additional provision is Article 9, and the enforcing statute is the Data Protection Act 2018 (https://www.legislation.gov.uk/ukpga/2018/12).

(b) Factual basis in the corpus. The breach cannot be anchored: the bare token "GDPR" appears zero times, and the privacy-policy page text was never captured (only the footer link label "Privacy Policy" is present, which is a compliant signal, not evidence of thinness).

```
$ grep -c -i "gdpr" eval/reference-set/fixtures/neuclinic.co.uk.json
0
```

(c) Proposed token. Do NOT keep `"GDPR"` (absent from corpus; and were it present, it would fire on any compliant GDPR reference, failing to discriminate). The original NEU-GDPR breach is UNVERIFIABLE against the frozen corpus.

Constructive alternative (a genuinely anchorable, stronger breach for this firm): a NEW known_breach for the advertising of a prescription-only medicine (POM) to the public. An aesthetics clinic advertising "Anti Wrinkle Injections" is advertising botulinum toxin, a POM, whose advertising to the public is prohibited by regulation 280 of the Human Medicines Regulations 2012 (https://www.legislation.gov.uk/uksi/2012/1916/regulation/280, existence confirmed by HTTP 202; the ASA/CAP limb is CAP Code rule 12.12 on cosmetic interventions, https://www.asa.org.uk/type/non_broadcast/code_section/12.html). This is a PRESENCE-breach with a verbatim corpus quote, the strong-confidence artifact shape. Proposed as a new entry, for example NEU-POM, framework "MHRA Human Medicines Regulations 2012 reg 280 (POM advertising)", `match_any: ["Anti Wrinkle Injections"]`.

```
$ grep -o "Anti Wrinkle Injections" eval/reference-set/fixtures/neuclinic.co.uk.json | sort | uniq -c
  18 Anti Wrinkle Injections
```

(d) Confidence. Original NEU-GDPR: UNVERIFIABLE in corpus (recommend retiring it to needs_verification, or re-capturing the privacy-policy page text so thinness can be assessed). Proposed NEU-POM: MODERATE. Two conditions gate it before it becomes ground truth, both founder/adjudication matters, not something to assert here: (1) confirm the reg 280 verbatim wording against the legislation.gov.uk 200 body (blocked as 202 this session, C-129); (2) whether a bare service listing "Anti Wrinkle Injections" (without naming a brand) constitutes advertising a POM is a determination for the adjudicator on the ASA line of rulings, so the token anchors a CANDIDATE, not an automatic violation. It is nonetheless far more discriminating and reproducible than "GDPR".

## 1.3 dutchanddutch.com (DND-GDPR) - UNVERIFIABLE in corpus

Corpus: `eval/reference-set/fixtures/dutchanddutch.com.json` (pages 5728 / 3608 / 5602, footer 3000).

(a) Primary legal source. The claimed breach is a "thin privacy policy", the same UK GDPR Articles 13/14 transparency duty verified in 1.2 (EUR-Lex confirmed; legislation.gov.uk/eur/2016/679 canonical, 202 this session).

(b) Factual basis in corpus. Un-anchorable. "GDPR" appears zero times. The privacy-policy document text was not captured; the corpus carries only the footer/consent link label "Privacy Policy" (in "I agree to the Terms and Conditions , Privacy Policy & Cookie Policy"), which evidences the PRESENCE of a policy link, not its thinness. The corpus in fact carries compliant signals (an "Anti Money Laundering Policy" and "Client Money Protection" reference), which support the reference-set note that the original F grade was wrong (class G1), and which a breach token on "privacy policy" would collide with.

```
$ grep -c -i "gdpr" eval/reference-set/fixtures/dutchanddutch.com.json
0
```

(c) Proposed token. None. Do NOT keep `["GDPR", "privacy policy"]`: "GDPR" is absent, and "privacy policy" anchors a compliant link label (using it would risk a contradiction against the firm's own compliant self-declaration, caution C-048). No alternative PRESENCE-breach exists in this corpus (no prohibited claim; "best price for your property" is lawful puffery).

(d) Confidence. UNVERIFIABLE in corpus. Recommend either recharacterising DND-GDPR to needs_verification, or re-capturing the fixture WITH the privacy-policy page body so the thinness finding (an absence/quality judgement) can be evidenced by a coverage_proof over the actual policy text.

## 1.4 roxanaaesthetics.com (ROX-LINK) - UNVERIFIABLE in corpus

Corpus: `eval/reference-set/fixtures/roxanaaesthetics.com.json` (3 pages each truncated at 19999 chars; footer begins mid-word "bai", evidence the footer capture is itself truncated).

(a) Primary legal source. roxana is UAE-bound (jurisdictions_bound AE). The transparency/privacy-notice duty is Federal Decree-Law No. 45 of 2021 (the UAE PDPL), whose controller notice obligation ("The Controller shall, before starting the processing, provide the Data Subject with the information ...") is on the official UAE government legislation portal (https://uaelegislation.gov.ae/en/legislations/1972 and the UAE Government portal https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws, both confirmed to carry the PDPL). A broken privacy-policy link defeats that notice duty; the reference set frames it as "policy link health" (failure class G3).

(b) Factual basis in corpus. Un-anchorable, on two counts. First, "broken" is a link-health property (an HTTP fetch of the link target), which a frozen TEXT corpus cannot carry; there are no hrefs at all (see 1.6 grep). Second, even the loose tokens are absent: the corpus contains no "privacy-policy" string and no "broken link" string. The only related text is the nav label "Privacy And Policy", which anchors the link's existence, not its brokenness.

```
$ grep -c -i "privacy-policy" eval/reference-set/fixtures/roxanaaesthetics.com.json
0
$ grep -c -i "broken link" eval/reference-set/fixtures/roxanaaesthetics.com.json
0
```

(c) Proposed token. None. Do NOT keep `["privacy policy link", "broken link", "privacy-policy"]` (none present; the breach is not a text property).

(d) Confidence. UNVERIFIABLE in corpus. A link-health breach can only be reproduced through the behavioural lane (breach/proposers/propose.js "behavioural -> bundle.browser.observed", C-042 broken consent control), which needs a fixture carrying observed link-health, not text. Recommend re-capturing roxana with a link-health observation (the target's HTTP status), or moving ROX-LINK out of known_breaches until such a fixture exists. The reference-set note also records a positive signal here (a displayed DHA licence number, class G2) that the engine must credit.

## 1.5 lomond.co.uk (LOM-ANCHOR) - UNVERIFIABLE in corpus

Corpus: `eval/reference-set/fixtures/lomond.co.uk.json`.

(a) Primary legal source. The broken anchor sits on a policy link; if the privacy policy, the duty is UK GDPR Articles 13/14 (verified in 1.2); if the cookie policy, the Privacy and Electronic Communications Regulations 2003 reg 6 (https://www.legislation.gov.uk/uksi/2003/2426/regulation/6, canonical). The reference set frames it as "policy link health" (class G3).

(b) Factual basis in corpus. Un-anchorable. The corpus carries the footer link labels "Privacy Policy", "Cookie Policy", "Modern Day Slavery Policy" and "Company Number" as plain text (these are the LOM known_non_breaches, correctly present), but no anchor or href data, and neither "broken anchor" nor "broken link" appears.

```
$ grep -c -i "broken anchor" eval/reference-set/fixtures/lomond.co.uk.json
0
$ grep -c -i "broken link" eval/reference-set/fixtures/lomond.co.uk.json
0
```

(c) Proposed token. None. Do NOT keep `["broken anchor", "broken link"]` (absent; link-health is not a text property).

(d) Confidence. UNVERIFIABLE in corpus. Same structural cause and remedy as roxana (1.4): needs an observed link-health lane. Recommend re-capture or removal from known_breaches until then.

## 1.6 The structural proof under 1.3 to 1.5: the frozen corpus carries no link data

No reference fixture preserves any href or anchor attribute, so no link-health or link-target breach can be reproduced from the committed corpus. This is the single largest cause of the 0/5 reproduction rate for the real firms.

```
$ for f in roxanaaesthetics.com lomond.co.uk dutchanddutch.com neuclinic.co.uk; do \
    echo -n "$f href-count: "; grep -c -i "href" eval/reference-set/fixtures/$f.json; done
roxanaaesthetics.com href-count: 0
lomond.co.uk href-count: 0
dutchanddutch.com href-count: 0
neuclinic.co.uk href-count: 0
```

---

# Part 2: Status review of the 17 PRD-sourced firms

These 17 carry `provenance: "PRD reference-set ... (membership only)"` and `verified_date: null`; every expected field is null (matrix members note a cell intent only). So there is nothing to CONTRADICT yet and nothing to reproduce; the review is about what a committed fixture plus a cheap primary-source check would let the founder fill, following the russell-cooke and munsch pattern (verified sector and jurisdiction added to a non-forensic entry). All 17 have a committed fixture except where noted. British registers were reachable this session (Companies House HTTP 200); UAE, Irish and US registers were not attempted beyond the live sites and are named as the next step.

Two firms are register-verified here (a real name match against the company number in the fixture footer, satisfying caution C-004; a non-empty response alone is never a match):

- connells.co.uk: fixture footer states "Registered in England and Wales under company number 01489613". Companies House confirms 01489613 = "CONNELLS RESIDENTIAL" (https://find-and-update.company-information.service.gov.uk/company/01489613, HTTP 200). Proposed scoping: sector real-estate, jurisdiction UK. Note: the fixture also shows FCA-related text (estate agents commonly hold FCA authorisation for insurance mediation); the FCA Register (https://register.fca.org.uk/) is the confirming source before attaching any FCA framework.
- pallmallmedical.co.uk: fixture footer states "registered in England and Wales No" 06980523. Companies House confirms 06980523 = "PALL MALL MEDICAL (MANCHESTER) LIMITED" (https://find-and-update.company-information.service.gov.uk/company/06980523, HTTP 200). Proposed scoping: sector healthcare, sub-sector private healthcare and cosmetic surgery, jurisdiction UK. The "Cosmetic Surgery" self-description means the CQC register (https://www.cqc.org.uk/) and the aesthetics/POM frameworks (as in neuclinic) are the relevant next checks. This is a strong candidate for a us-style matrix cell already declared (UK x healthcare).

Fixture-grounded scoping proposals for the remaining 15 (sector and jurisdiction inferred from the committed fixture's title, ogSiteName, on-page text and TLD; each needs the named register or a live re-check before filling):

| Domain | Fixture title signal | Proposed sector | Proposed jurisdiction | Confirming source needed |
|---|---|---|---|---|
| finsbury-associates.com | "Leading Financial Advisors in Dubai, Boutique Wealth Management" | finance (wealth management) | AE (Dubai) | DFSA/SCA register; note "Leading" superlative for a later claim check |
| fichtelegal.com | "Award-Winning Law Firm in Dubai and Abu Dhabi" | legal | AE | UAE legal-consultancy licence; note "Award-Winning" superlative |
| abspartners.ae | "Corporate Law Firm in Abu Dhabi" | legal | AE (Abu Dhabi) | UAE / ADGM or mainland licence check |
| masecoprivatewealth.com | "Private Wealth Management Firm London", FCA text present | finance | UK | FCA Register (FRN); Companies House |
| ahdubai.com | "American Hospital Dubai, Best Private Hospital in Dubai" | healthcare | AE (Dubai) | DHA licence; note "Best" superlative |
| lvproperty.co.uk | "Estate and Letting Agents in Birmingham City Centre" | real-estate | UK | Companies House; redress-scheme membership |
| maguirejackson.com | "Birmingham City Centre Estate Agents" | real-estate | UK | Companies House; redress-scheme membership |
| brookswm.co.uk | "Brooks Wealth Management, Financial Planning", heavy FCA text | finance | UK | FCA Register (the "331415" in the footer looks like an FCA FRN, not a company number, so verify both) |
| gtag.ae | "UAE Tax and Accounting Firm in Dubai, VAT and CT Experts" | professional-services (accounting) | AE (Dubai) | UAE mainland/free-zone licence |
| whitneymoore.ie | "Whitney Moore" (matrix intent IE x legal) | legal | IE | Law Society of Ireland; CRO (https://core.cro.ie/) |
| goulstonstorrs.com | "Full-Service Law Firm in Boston, New York and DC" | legal | US (MA, NY, DC) | State bar admissions; multi-state node care (caution C-052) |
| bsalaw.com | "Legal Consultants and Dispute Resolution Firm, BSA LAW" | legal | AE | UAE legal-consultancy licence |
| beaconhospital.ie | "Beacon Hospital Dublin, Ireland's Most Advanced Private Hospital" | healthcare | IE | CRO; HIQA; note "Most Advanced" superlative |
| carbonhealth.com | fixture is UNREACHABLE (HTTP 403 Cloudflare bot wall, note C-038, no content asserted) | (matrix intent US healthcare) | (US) | cannot scope from fixture; needs a rendered capture before any expectation |
| medcare.ae | "JCI Accredited Hospital in Dubai and Sharjah" | healthcare | AE (Dubai, Sharjah) | DHA / MOH licence (page mentions MOH and licence) |

Notes and risks in this set:
- carbonhealth.com cannot be scoped at all from the frozen fixture (it is an explicit unreachable bot-wall bundle). Any expectation for it must wait for a rendered capture; treat as an uncovered US-healthcare cell for now.
- Several fixtures carry marketing superlatives ("Leading", "Award-Winning", "Best", "Most Advanced"). These are potential future PRESENCE-breach positive controls (unsubstantiated superiority claims), but each is jurisdiction-specific and adjudication-gated; none should be added as a known_breach without the primary-source rule and an adjudicator determination.
- The .ae, .ie and US firms could not be register-checked cheaply this session (no UK-register equivalent reachable). Their sector and jurisdiction proposals are fixture-grounded only and are explicitly needs_verification against the named register.

---

# Part 3: US positive-control firm proposals

The reference set has US CLEAN controls (munsch.com, cedars-sinai.org, kabodcoffee.com as known_non_breaches) but no US POSITIVE controls (real breaches). The three below are proposed for future fixture capture. All are GOVERNMENT-DOCUMENTED (a regulator, not this author, made the determination), which keeps them evidence-backed and non-defamatory. Per caution C-219 / C-104 / C-244, every legal figure is verified on the source of record or is flagged needs_verification where the official body was bot-walled this session; a penalty is not assumed to exist unless a penalty provision is cited.

## 3.1 Lysulin Inc. (lysulin.com) - health-products / disease claims

- Provision: Federal Food, Drug, and Cosmetic Act. Marketing a dietary supplement with disease claims renders it an unapproved new drug (FD&C Act section 505(a), 21 U.S.C. 355(a)) and misbranded (section 502, 21 U.S.C. 352); the FTC limb is deceptive health claims under the FTC Act section 5 (15 U.S.C. 45). Note per C-244: bare FTC Act section 5 carries no first-violation civil penalty, so the penalty exposure here is the FDA enforcement route (seizure, injunction), not an automatic fine.
- Government record: on 2025-03-20 the FDA and FTC issued warning letters to 10 companies for illegally selling diabetes dietary supplements; Lysulin Inc. is one of the named companies (FDA action page https://www.fda.gov/food/dietary-supplements/whats-new-dietary-supplements; the naming is corroborated across trade coverage, e.g. https://www.nutritionaloutlook.com/view/ftc-fda-issue-warning-letters-to-supplement-companies-claiming-to-treat-diabetes). The exact FDA/FTC letter body could not be rendered this session (FDA/FTC bot-walled), so the letter's precise wording is needs_verification against the source-of-record letter.
- On-page evidence I observed (WebFetch of https://www.lysulin.com/, real content returned): "designed to support healthy blood sugar levels"; "help maintain healthy blood sugar and track changes in your A1c levels"; "Enhances Insulin Function". The page also carries the standard disclaimer "These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease." The teaching value is precisely this tension: structure/function language plus a disclaimer can still be an unapproved-drug violation when the totality (a product named for insulin, targeting A1c and diabetes) implies disease treatment (the FDA "intended use" doctrine). Fixture capture should include the pages the warning letter cited, not only the hedged homepage.
- Cell fit: us-healthcare / health-products. Confidence: STRONG on the government record and the observed claims; the specific FD&C section numbers are cited from the FDA's standard basis and should be confirmed against the rendered warning letter.

## 3.2 Williams-Sonoma, Inc. - e-commerce / Made in USA (us-universal)

- Provision: the FTC Made in USA Labeling Rule, 16 CFR Part 323, content-verified on eCFR this session (https://www.ecfr.gov/current/title-16/part-323, HTTP 200 via the eCFR renderer). Section 323.2 makes it "an unfair or deceptive act or practice within the meaning of section 5(a)(1) of the Federal Trade Commission Act ... to label any product as Made in the United States unless the final assembly or processing of the product occurs in the United States, all significant processing ... occurs in the United States, and all or virtually all ingredients or components ... are made and sourced in the United States." Section 323.4 makes any violation "a violation of a rule under section 18 of the Federal Trade Commission Act, 15 U.S.C. 57a", which is the civil-penalty hook (15 U.S.C. 45(m)); authority 15 U.S.C. 45a. This is the penalty-bearing US provision (contrast bare FTC Act section 5).
- Government record: FTC press release, 2024-04, "Williams-Sonoma Will Pay Record ... Civil Penalty for Violating FTC Made in USA Order" (https://www.ftc.gov/news-events/news/press-releases/2024/04/williams-sonoma-will-pay-record-317-million-civil-penalty-violating-ftc-made-usa-order). The FTC alleged the company listed products as "Made in USA" that were in fact made in China and other countries, in violation of a 2020 FTC order. The penalty is reported as USD 3.175 million by the FTC release and multiple legal alerts; FTC.gov returned HTTP 403/503 to direct fetch this session, so the figure is cited to the FTC URL and marked needs_verification against the rendered release body (C-219). The penalty amount is not load-bearing for a positive control (the reference set records breaches, not fines), so it can be omitted or filled once rendered.
- Cell fit: us-universal (e-commerce). This is the direct positive counterpart to the kabodcoffee KAB-MADEINUSA known_non_breach (a firm that makes no US-origin claim), so the pair bounds the Made-in-USA rule from both sides. Confidence: STRONG on the provision (eCFR-verified) and the FTC action; the figure is needs_verification. For fixture capture, re-check the current live product listings, since a firm under an FTC order may have corrected.

## 3.3 Kubota North America Corporation - manufacturing / Made in USA (second us-universal exemplar)

- Provision: same 16 CFR Part 323 (eCFR-verified above).
- Government record: FTC press release, 2024-01, "FTC Action Leads to ... Penalty Against Kubota for False Made in USA Claims" (https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-action-leads-2-million-penalty-against-kubota-false-made-usa-claims). The FTC alleged Kubota falsely labelled replacement parts as "Made in USA"; a DOJ stipulated order accompanied the settlement. The penalty is reported as USD 2 million; same C-219 caveat as 3.2 (FTC body not rendered this session, figure needs_verification).
- Cell fit: us-universal. Included as an optional third to show the rule biting on a manufacturer as well as a retailer. Confidence: STRONG on provision and action; figure needs_verification.

Note on a rejected candidate (a false-positive trap worth recording): a personal-injury firm's "we guarantee that if we don't win you don't pay any attorney's fees" is a contingency-fee (no win, no fee) statement, which is lawful and standard, NOT a prohibited guarantee of outcome. It must NOT be used as a positive control. It is a good example of the site's own compliant self-declaration that the engine must not flip into a breach (caution C-048), and a reminder that a us-legal positive control needs a genuine outcome-guarantee or an unsubstantiated superiority claim without the required disclaimer (ABA Model Rule 7.1 and the adopting state's analogue), ideally sourced from a published state-bar disciplinary record rather than a live accusation.

---

# Headline risks found in the oracle

1. The known_breach tokens do not discriminate, and worse, four of five cannot be reproduced from the committed corpus at all. Only the synthetic control has a valid, present, discriminating token. This is the concrete mechanism behind "0/5 reproduce e2e": the tokens were never anchored to the frozen fixtures.
2. The fixtures are text-only. They preserve no hrefs or anchors (Part 1.6) and did not capture policy-document bodies, so the two link-health breaches (roxana, lomond) and the two thin/absent-policy breaches (neuclinic, dutchanddutch) are structurally un-anchorable. Fixing the tokens alone will not fix reproduction; the fixtures must be re-captured with link-health observations and policy-page text. This is a fixture problem first, a token problem second.
3. Loose tokens that ARE present anchor compliant signals, not breaches. "privacy policy" (dutchanddutch, lomond) matches the firm's own compliant policy link; using it as a breach token risks a contradiction against a compliant self-declaration (C-048). "GDPR" is absent everywhere, so it can never fire.
4. All 30 firms are needs_verification, and 17 of 30 have no verified field at all. The oracle is thin: 9 forensic entries plus russell-cooke and the 3 US 2026-07-18 additions are the only substantively scoped rows. The 17 PRD firms are scoped here from fixtures but still need register or live confirmation before filling.
5. One fixture (carbonhealth.com) is an unreachable bot-wall bundle, so its declared us-healthcare matrix cell is uncovered until a rendered capture exists.
6. There are no US positive controls; Part 3 proposes three government-documented ones. Note that even a clean-looking supplement homepage (Lysulin) can be a documented violation, and a lawful "no win no fee" can look like a prohibited guarantee: both directions of error are live.

# Verification ledger (method, per doctrine)

| Claim | Method | Result |
|---|---|---|
| GDPR Art 13/14 transparency duty | EUR-Lex official EU text, WebFetch | VERIFIED (headings and Art 13(1) opening quoted); UK citation legislation.gov.uk/eur/2016/679, existence 202 |
| 16 CFR Part 323 Made in USA rule, incl. civil-penalty hook | eCFR renderer, curl HTTP 200, full text | VERIFIED (323.2 prohibition, 323.4 enforcement, authority 15 USC 45a) |
| Connells company 01489613 = CONNELLS RESIDENTIAL | Companies House, curl HTTP 200 | VERIFIED (C-004 real name match) |
| Pall Mall Medical 06980523 = PALL MALL MEDICAL (MANCHESTER) LIMITED | Companies House, curl HTTP 200 | VERIFIED (C-004 real name match) |
| reg 280 HMR 2012 (POM advertising ban) | legislation.gov.uk, curl and WebFetch | EXISTENCE confirmed (HTTP 202, not 404); text NOT served this session (C-129); wording needs_verification |
| UK GDPR / DPA 2018 UK bodies | legislation.gov.uk | EXISTENCE confirmed (202); UK verbatim pending 200 body |
| UAE PDPL controller notice duty | uaelegislation.gov.ae and u.ae, WebSearch and WebFetch | Confirmed the PDPL exists and imposes a pre-processing controller notice duty; article-number precision needs_verification against the official body |
| Lysulin FDA/FTC warning letter, on-page claims | WebFetch lysulin.com (rendered); FDA/FTC pages bot-walled | On-page claims VERIFIED as observed; warning-letter body needs_verification (FDA/FTC 403/404) |
| Williams-Sonoma USD 3.175m, Kubota USD 2m Made in USA penalties | FTC press releases (URLs cited); FTC.gov 403/503 | Actions documented; exact figures needs_verification against the rendered FTC body (C-219) |

# Attribution of concurrent changes (C-210, C-215)

`git status --porcelain` at hand-off shows changes outside `docs/`, none authored by U4. They belong to the concurrent builders on their own paths: `eval/e2e/lib/real-llm.js` (U1); `eval/e2e/run-pipeline.js`, `eval/e2e/lib/replay-llm.js` (U2); `eval/e2e/lib/redteam-handlers.js`, `llm/prompts/adjudicate.js`, `llm/prompts/entailment.js`, `llm/prompts/sanitise.js`, `llm/prompts/sanitise.test.js` (U3). U4's only change is this file under `docs/`.
