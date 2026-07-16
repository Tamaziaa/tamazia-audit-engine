I have now read the entire document end to end (all 8,098 lines: the header/ACT §0, the full CodeQL/Semgrep/Semgrep-full-tree/CodeRabbit/Greptile tables, all of CodeScene §6.1–6.7, one-door §8, jscpd §9, dep-cruiser §10, ESLint §11, domain gates §12, and all 515 dismissals in §13 plus the provenance footer). Here is the digest.

---

# DIGEST — AUDIT-ENGINE-FINDINGS.html (generated 2026-07-14T17:01:42Z)

Estate: `Tamaziaa/tamazia-cowork-os` (engine, 341 PRs) + `Tamaziaa/tamazia-website` (renderer, 184 PRs). Headline counts: **1,386 raw findings · 879 code-scanning alerts (58 OPEN, 515 DISMISSED, the rest fixed) · 144 CodeScene findings · 256 distinct code defects · 6 ACT items (≥2 tools agree).** Two meta-findings the author flags as findings in themselves: (1) only **45 of 525 PRs ever got an inline AI review — 480 merged with zero review** (the synthetic full-tree PR #343 exists to pay this off); (2) **515 code-scanning alerts were dismissed, 322 as "won't fix"** — a risk accepted, not a defect refuted (though all 515 carry a written reason).

---

## A) EVERY P0 AND P1 FINDING (§0–§13), with tool, file:line, description, state

The document only assigns explicit **P0/P1 severity in §0 (ACT)**, §12 (domain gates), and the Greptile badges (§5). CodeQL/Semgrep use note/warning/medium/high/error, not P-levels. The P0/P1 set is therefore:

**§0 ACT — corroborated P0/P1 (facts, not leads):**
- **F-0001 · P0 · ×3 (CodeQL + CodeRabbit + one-door)** — `src/skills/S025-audit-page-builder/scripts/build.js:1270` — "Make mandatory audit gates fail closed." Umbrella for the biggest class: gates run *after* the R2 payload is persisted; jurisdiction stage marked `ran` unconditionally (can never fail); `llmPreflight()` fails open; module-scope `_WARN`/`_warn` singleton never reset between builds (warning counts wrong for every audit after the first); firm_identity stage reads `comp.firm_profile` instead of resolver output (build.js:835-837). CodeQL corroborates via `js/file-access-to-http`; one-door via multiple-producers on regulator/jurisdiction/element-checklist. **State: OPEN** (this is what PR #340/#326/#325/#324/#329/#331 review threads target; the CodeQL open alerts CQ-0015/16 at build.js:218/199 remain open).
- **F-0002 · P0 · ×2 (CodeRabbit + one-door)** — `src/skills/S008-personalisation-engine/scanners/compliance.js:1218` — "Keep `_N2C` aligned with `detectMarkets().bound`." Includes stale `_ordered` snapshot making the C-1 sector-term rescue a no-op; `_SWARN` module-scope leak; fetch failures returned-not-thrown go unrecorded; protected-library-change-needs-sign-off. one-door corroborates on jurisdiction-nexus, sector, host, element-checklist. **State: OPEN.**
- **F-0003 · P0 · ×2 (CodeRabbit + one-door)** — `src/lib/audit/payload-schema.js:51` — "Anchor the engine-version format" + enforce the draft gate at payload-schema.js:79-89. one-door: REGULATOR NAME has 5 producers. **State: OPEN.**
- **F-0004 · P0 · ×2 (CodeRabbit + one-door)** — `src/lib/util/url-safe.js:68` — "Parse inputs before comparing hosts" (+ keep `^` anchor on scheme strip; `LogicalOperator` proof wrong at both call sites). one-door: HOST anchoring has 8 producers. **State: OPEN.**
- **F-0005 · P0 · ×2 (CodeRabbit + one-door)** — `src/lib/compliance/signals.js:155` — "Protected compliance library change needs Aman sign-off" (+ freeze `NEXUS_PROFILE` before export). one-door: jurisdiction-nexus + sector. **State: OPEN.**
- **F-0090 · P1 · ×2 (CodeQL + Greptile)** — `src/lib/enrich/lead-quality.js:521` — "Persisted socials bypass anchor" (`hasLinkedin` still returns true from persisted socials, bypassing the host anchor). CodeQL: `js/unneeded-defensive-code`. **State: OPEN** (CodeQL twin CQ-0041 at :521 is dismissed "won't fix"; CQ-0025 at :524 is OPEN).

**§5 Greptile — the only other explicit P1s (all 3 of Greptile's total):**
- **GR-0001 · P1** — `src/lib/enrich/lead-quality.js:521` (PR #316) — Persisted socials bypass anchor (= F-0090). **OPEN.**
- **GR-0002 · P1** — `.github/workflows/env-rebuild-v5.yml:28` (PR #314) — "Require rotated secret": `CAL_WEBHOOK_SECRET` not rotated. **OPEN** (see also CR-0010: leaked webhook secret persisted verbatim in the harvested snapshot `sarif/ai-reviewers.reviews.json:1189`).
- **GR-0003 · P1** — `website/functions/audit/_adapter.js:88` (PR #172) — "Guard passed names too": `sharesTokenWithDomain` only guards one side. **OPEN.**

**§12 Domain gates — three explicit P0s (all FIXED + GATED), the ones "no marketplace tool would find":**
- **DG-01 regex-health P0 (×3 dead-in-production):** `dpo[@\s]` (UK_GDPR A13/A13.1.b DPO-contact check DEAD), `vat\s*(no)` (UK_TRADING_STANDARDS TS2.1 VAT-number check DEAD), `\bPOM\b` (UK_HMR_2012 prescription-only-medicine advertising DEAD); plus `FRN ?\d{6}` (UK_FSMA_S21 FCA authorisation) — over-escaped regexes that compile, run, and match nothing forever while reporting compliance. **FIXED+GATED.**
- **DG-03 prohibition-calibration P0 (×3):** 6 prohibitions had no pattern and could never fire; three P0 including **UK_BOTOX_FILLERS_U18** (a criminal offence in England). **FIXED+GATED** (negation guard added).
- **DG-05 nexus-anchoring (the ghost-jurisdiction P0):** `/incorporated in/` anchored to no country; 6 of 7 real UK/EU/UAE law-firm footers judged "established in the United States"; Mills & Reeve (UK) served US ABA rules/ADA/US attorney-advertising law, 4 of 8 findings jurisdictionally void. **FIXED+GATED.**
- (DG-02 rule-polarity P1 MED_CLAIMS and DG-04 reachability are the other two gates — see B.)

---

## B) RECURRING FAILURE CLASSES (with counts and canonical examples)

1. **Two-doors / multiple-producers (the single most-implicated class — one-door §8, 36 instances across 7 facts).** Same client-facing fact produced by multiple modules; the stale door is the one the client sees. Producer counts: **jurisdiction = 10 producers** (llm-verify.js, register-grounding.js, nexus.js, signals.js, compliance.js ×2, firm-profile.js, jurisdiction-router.js, jurisdiction.js, build.js), **host = 8**, **sector = 6**, **regulator = 5**, **fine = 3**, **element-checklist = 2**, **law = 2**. This class "has already shipped a P0 three times": the ghost jurisdiction, the "Sector regulator" label printed to clients on **51% of the catalogue**, and the **£17.5M fine fixed in the DB that never reached the client because three code files kept their own copy.** CodeScene corroborates it from git history alone (CS-C-51 connect.js↔signals.js 21%/24 rev = the ghost-jurisdiction pair; CS-C-33 compliance.js↔build.js 32%/108 rev; and the cross-repo 61% build.js↔_adapter.js coupling in §6.3).

2. **Fail-open gates.** Canonical: build.js:1270 mandatory gates run after R2 persist (F-0001, CR-0024/CR-0025/CR-0068/CR-0083); `llmPreflight()` fails open (CR-0094); jurisdiction stage marked `ran` unconditionally (CR-0093); `MIN_PAGES_FOR_ABSENCE`/`CORPUS_MAX_CHARS` forced to 0 via env (CR-0048/CR-0050). Inverse anti-pattern also flagged: CR-0079/CR-0081 want NEON guards to **fail open** in operational scripts (a deliberate open direction), and CR-0023 wants tests to fail when DB is absent.

3. **Module-scope state leaks (the "singleton warning sink" class).** `_WARN` module-level singleton never reset between builds → persisted `warnings`/`warning_count` wrong for every audit after the first (CR-0118, build.js:44); `_SWARN` per-scan leak (CR-0098, compliance.js:70); sub-stage state must be scoped to one scan (CR-0062). "Make it per-invocation" recurs across CR-0095/98/118/121.

4. **Broken / mis-anchored regexes.** CodeQL `js/regex/missing-regexp-anchor` appears ~40× (10 OPEN in `scripts/backtest-personalisation.js:27-36`, 14 fixed in `pixel-detector.js`); `js/incomplete-hostname-regexp` (unescaped `.` before co.uk/org.uk, CQ-0021-24 OPEN); `js/bad-tag-filter` (regex misses `</script >`) fixed ~18×; **over-escaped domain regexes that match nothing** = the §12 DG-01 P0 class. Semgrep ReDoS (`detect-non-literal-regexp`) is the single largest §3 rule (~30 of the 83 still-live), concentrated in compliance.js (lines 556-788) and extract.js.

5. **Polarity inversions (DG-02 rule-polarity, P1, FIXED+GATED).** 5 rules breached firms for NOT advertising what the regulator PROHIBITS: a firm claiming "THE BEST LAW FIRM — GUARANTEED RESULTS" PASSED ABA Rule 7.1 while a compliant firm FAILED. **MED_CLAIMS (P1)** fired on any page containing "clinic"/"dental"/"treatment" — the entire healthcare vertical told it breached its medical board for failing to advertise a miracle cure.

6. **Dead-but-green modules (madge §7 = 0 findings *because* gate is working; DG-04 reachability).** 13 modules / 691 lines of correct, tested, cited legal logic were unreachable from the mint — including `citation-gate.js`, the gate built to make an unevidenced monetary claim impossible, which **had never executed once.** `statute-rag.js` required for months, never called. Now all wired/merged or declared in DORMANT.md. dep-cruiser §10 lists 7 live orphans (timezone-router.js, applicability.js, obligations.js, subjurisdiction.js, mystrika/client.js, conversion.js, safe-insert.js, S052 handle.js).

7. **Silent-swallow catches.** Glossary catch swallows with no `_warn` (CR-0092 build.js:1024, CR-0116 build.js:964); empty `except: pass` (CodeQL `py/empty-except` ×8 in server.py — all RE-CHECK); coherence-gate test only catches literally-empty `catch(_e){}` (CR-0122).

8. **Dead/unconditional branches & dead-but-green tests.** `declin` alt in `NEGATION_RX` can never match (CR-0026); jurisdiction stage `ran` unconditionally (CR-0093); CodeQL `js/trivial-conditional` / `js/unneeded-defensive-code` (guard always true/false) recur throughout lead-quality.js and _adapter.js.

9. **Payload-contract duplication across two repos (CodeScene §6.3, "THE BIGGEST FINDING").** Engine and renderer are **61% change-coupled with no shared schema** — the mechanism behind classes 1 and the £17.5M fine.

10. **CI/supply-chain hygiene (Semgrep §2, mostly FIXED).** `github-actions-mutable-action-tag` (~150 instances across every workflow), `run-shell-injection` via `${{github}}` in `run:` (~20), generic-secret detections (5), missing USER in Dockerfile, `NODE_TLS_REJECT_UNAUTHORIZED=0`, curl-pipe-bash. Plus duplicated 10-line engine-version guard block repeated 7× across ≥4 workflows (CR-0086–CR-0090).

---

## C) §1–§5 OPEN ITEMS (not dismissed), grouped by theme, worst first

**§1 CodeQL (425 total: 40 OPEN, 271 dismissed, 114 fixed). The 40 OPEN items:**
- **Broken URL regexes (worst) — 14 high:** `js/regex/missing-regexp-anchor` CQ-0005–0014 at `scripts/backtest-personalisation.js:27-36`; `js/incomplete-hostname-regexp` CQ-0021-0024 (unescaped `.` before co.uk/org.uk) same file.
- **Taint: file-data → outbound HTTP / untrusted → file write (5 medium, audit path):** CQ-0015 `build.js:218`, CQ-0016 `build.js:199`, CQ-0017 `src/lib/audit/llm.js:52` (file→http); CQ-0018 `src/lib/audit/geo-probe.js:45`, CQ-0019 `scripts/remint-audits.js:12`, CQ-0020 `_drv_mint.js:7` (http→file).
- **Logic/dead-code (audit path):** CQ-0025 `lead-quality.js:524` guard always true (twin of P1 F-0090); CQ-0026 `src/lib/audit/firm-identity.js:274` useless assignment; CQ-0035/0036 superfluous arg to `subjectOf` at `functions/audit/_adapter.js:1922`/`:308`; CQ-0030 unused `catalogueFrameworks` at `_adapter.js:2504`.
- **Noise/unused (notes):** CQ-0001-0003 (eval tests), CQ-0004 ASI in source-gap.js, CQ-0027-0034 & 0037-0040 unused vars in the bundled `dist/audit/audit-app.js` and `public/audit/audit-app.js` (topFix, coldSendRule, crit2, regFixes, cwvN, cwvFail, fixSummary, $).

**§2 Semgrep OSS (454: 18 OPEN, 244 dismissed, 192 fixed). The 18 OPEN:**
- **Path-traversal into `path.join/resolve` (11, all in eval/ tests):** SG-0001-0007/0015-0017 at `eval/reachability.test.js:62/63/85`, `eval/no-hardcoded-fines.test.js:32`, `eval/coherence-gate.test.js:42`, `eval/one-door.test.js:23`.
- **ReDoS `detect-non-literal-regexp` (6, audit path):** SG-0009-0014 at `compliance.js:753/763/780/788/685/608`; SG-0018 at `src/lib/sourcing/markets.js:68`.
- **Supply chain:** SG-0008 `renovate.json:22` missing minimum-release-age.

**§3 Semgrep fresh full-tree (83 — "defects that STILL exist on main," all warning).** ReDoS dominates (~30: compliance.js 556-788, extract.js 20-71, rank-insight.js 232/368/539, signals.js:92, connect.js:315, markets.js:68, linkedin-finder.js:44, html-text.js:38, feeds). Path-traversal (~24, incl. `tools/sweep/collect-local.js` 44/45/59/62/104 — the sweep's own tooling). Python `dynamic-urllib` (SGL-0018-0025) all in `mcp/tamazia-ops/server.py`. Notables: **SGL-0074 `var-in-href` XSS in `src/templates/email/footer.html:31`**; SGL-0075 `detect-child-process` from arg `cmd` in `tools/sweep/collect-local.js:23`; SGL-0026 node-postgres SQLi + SGL-0028 curl-pipe-bash in ops/infra; SGL-0066 unknown-value-with-script-tag `content-depth.js:75`.

**§4 CodeRabbit (139 — "strongest tool; caught 2 bugs the author shipped on PR #340 alone"). EVERY CodeRabbit finding touching the audit path (build.js / compliance.js / _adapter.js / payload-schema / llm-verify / url-safe / signals / finding-trust / citation-gate / mint-worker):**
- **build.js (S025):** CR-0024 fail-closed gates (:1270); CR-0025 run gates before R2 persist (:1287); CR-0068 validate before offloading payload (:1224); CR-0083 don't upload open manifest to early R2 snapshot (:818); CR-0091 pass `_manifest`+findings into `build()` (:1196); CR-0092 glossary catch swallows silently (:1024); CR-0093 jurisdiction stage `ran` unconditionally (:360); CR-0094 make `llmPreflight()` fail closed (:304); CR-0095 module-scope warning sink per-invocation (:44); CR-0116 glossary lookup swallows (:964); CR-0117 stale `_warn` line labels (:947); CR-0118 `_WARN` module singleton never reset (:44); CR-0123 run preflight once per mint worker (:245); CR-0128 `_SM`/`_manifest` out of scope, throws every build (:1102); CR-0129 firm_identity should read resolver output not `comp.firm_profile` (:837); CR-0082 node_modules (:1190).
- **compliance.js (S008 scanners):** CR-0034 keep `_N2C` aligned w/ `detectMarkets().bound` (:1218); CR-0043 stale `_ordered` snapshot → C-1 rescue no-op (:974); CR-0044 don't modify protected crawl/render engine (:466); CR-0047 Neon `required_engine_version` must match bump or minting halts (:888); CR-0061 record thrown sub-stage failures in manifest (:1266); CR-0062 keep sub-stage state per-scan (:71); CR-0063/CR-0099 don't change prohibited engine paths (:72); CR-0096/CR-0119 expose warning data on every payload path (:1480); CR-0097/CR-0120 record returned (not only thrown) fetch failures (:235); CR-0098 make `_SWARN` per-scan (:70); CR-0121 isolate warning state per scan (:72); CR-0026 `declin` dead branch (corpus-index.js:90); CR-0027 tighten negation guard (corpus-index.js:89); CR-0028 triplicated `_extractQuote` + per-iteration `require()` (:823).
- **_adapter.js (website):** CR-0138 truncated-code fallback bypasses catalogue (:1942); GR-0003 `sharesTokenWithDomain` one-sided guard (:88).
- **payload-schema.js:** CR-0067 enforce draft gate (:89, refs 79-89); CR-0069 anchor engine-version format (:51); CR-0070 don't modify protected components (:89).
- **llm-verify / llm/router:** CR-0100 don't log optional-provider absence as error (router.js:381); CR-0124 add direct coverage for `llmPreflight()`.
- **url-safe.js:** CR-0051 keep `^` anchor on scheme strip (:81); CR-0052 `LogicalOperator` proof wrong at both call sites (:55); CR-0076 parse inputs before comparing hosts (:68).
- **signals.js:** CR-0036 freeze `NEXUS_PROFILE` before export (:227); CR-0037 protected-library change needs Aman sign-off (:155).
- **finding-trust.js:** CR-0048 `MIN_PAGES_FOR_ABSENCE` forced to 0 via env (:43); CR-0064 prioritise browser observations over presence rule types (:62).
- **citation-gate.js:** CR-0022 don't modify protected modules (:32); CR-0029 include framework in rule identities (:16).
- **mint-worker.js:** CR-0030 await `verifyAuditUrl()` before `_res.ok` (:286); CR-0058 keep http diagnostics in dead-letter (:275); CR-0059 migrate off legacy Sentry `/store/` (:79); CR-0041 flag worker+Neon rollout to Aman (:27).
- **site-scan.js:** CR-0050 `CORPUS_MAX_CHARS` misconfig zeroes corpus (:114). **geo-probe.js:** CR-0077 protected component (:79).
- (Remaining CodeRabbit findings are CI/workflow hygiene, sweep-tooling bugs CR-0001–CR-0009, `.coderabbit.yaml`, and eval-test coverage gaps CR-0031/0032/0042/0049/0065/0072/0101-0104/0122/0130/0137/0139.)

**§5 Greptile (3, all P1, all OPEN):** GR-0001/0002/0003 above — "credit-blocked; do not pay for it" (3 vs CodeRabbit's 139 on the same estate).

---

## D) §13 DISMISSALS — verdict distribution + RE-CHECK at high/medium

**Verdict distribution of the 515 (all carry a written reason; none a "silent shrug"):**
- **SOUND: 238** (138 note, 48 medium, 27 high, 24 warning) — correctly dismissed.
- **RE-CHECK: 187** (171 warning, 15 note, ~1 other) — deserve re-examination.
- **RISK-ACCEPTED: 40** (36 warning, 2 medium, 1 note) — "won't fix" = risk accepted, not refuted.
- **SOUND-BY-DESIGN: 37** (all warning).
- **REASONED: 17** (10 high, 6 warning).
- **FIXED-BUT-MISLABELLED: 1** (the one real defect: an alert dismissed "won't fix" that is in fact fixed).

**RE-CHECK at high/medium severity: THERE ARE NONE.** Every RE-CHECK item is warning (171) or note (15). The RE-CHECK population breaks down as: **160 `html.security.audit.missing-integrity` (SRI) warnings** dismissed as "false positive" in one blanket sweep (DIS-0040 onward, across `public/blog/weight-loss-glp1-clinic-seo-2026/index.html`, `.../top-50-private-clinics-in-london-2026/index.html`, `.../top-50-law-firms-in-london-2026/index.html`, etc.) — the report's explicit ask: "a blanket dismissal of 160 deserves re-examination one by one, not defence in aggregate"; **11 `path-traversal` warnings** (00-Briefs/qa-runner/audit-merge.js:16, materialise-client-emails.js:35/42, reconcile.js:21, verify-attribution.js:30, S057-pre-call-brief/build.js:109, S064-touch-cadence/render.js:66/282/285); **8 `py/empty-except` notes** (mcp/tamazia-ops/server.py:347/553/712/1299/1353/2301/2450, scrapers/run_jobspy.py:32); **7 `js/unneeded-defensive-code` notes** (functions/api/audit.js:1525, _adapter.js:1273, lead-quality.js:410/517/521).

**High-severity dismissals that DO exist (for completeness — all verified against live source):**
- **FIXED-BUT-MISLABELLED (high):** `js/xss-through-dom` `public/audit/audit-app.js:1044`, dismissed "won't fix" but actually fixed (uses `textContent`, not `innerHTML`). "The code is safe; the alert state lies."
- **REASONED (high, all "false positive," 10):** `notify.js` incomplete-multi-char-sanitization (:96,:91) and incomplete-sanitization (:139) — verified `stripTags()` loops to fixed point and `escMd()` escapes backslash in same pass; `push-to-mystrika.js:93` url-substring; `extract.js:105/:85`, `lead-quality.js:410/:297`, `ad-tech.js:21`, `_adapter.js:683` missing-regexp-anchor.
- **SOUND (high, 27):** mostly `patch-dist.js` bad-tag-filter/file-system-race/multi-char-sanitization (:57,:75,:83,:378,:810,:1534), and `js/regex/missing-regexp-anchor` + url-substring dismissed "used in tests" (10-layer.test.js:237 ×5, commercial-rebuild.test.mjs, adversarial-test.js).

**Medium RISK-ACCEPTED (2):** `js/incomplete-html-attribute-sanitization` `public/portal/index.html:17`; `js/missing-origin-check` `dist/book/index.html:109`. **Medium SOUND (48)** are largely the file↔http taint pairs (llm/router.js, neon-backup.js, intel-pulse.js, reconcile-cal-bookings.js).

---

## E) TOP 20 MOST-IMPLICATED FILES (across all tools) + what's wrong

1. **`src/skills/S025-audit-page-builder/scripts/build.js`** — the P0 epicentre (F-0001). CodeScene hotspot CS-H-02: 1,046 LoC, **106 commits, health 1.76 and falling (↓0.73).** Gates run after R2 persist, fail-open preflight, `_WARN` singleton, ~16 CodeRabbit items, 2 open CodeQL taint alerts. one-door producer of regulator + jurisdiction + element-checklist.
2. **`src/skills/S008-personalisation-engine/scanners/compliance.js`** — ghost-jurisdiction P0 (F-0002). CS-H-03: 1,134 LoC, **112 commits, health 2.08 (↓0.95).** ~15 CodeRabbit items, most §3 ReDoS live alerts, producer of jurisdiction/sector/host/element-checklist.
3. **`website/functions/audit/_adapter.js`** — worst-health file on the estate. CS-H-01: 1,995 LoC, 60 commits, **health 1.30 (↓0.93, lowest).** 61% cross-repo coupled to build.js; catalogue-bypass fallback (CR-0138), one-sided token guard (GR-0003), duplicate-property + superfluous-arg alerts.
4. **`public/audit/audit-app.js` (+ dist copy)** — CS-H-06: 1,296 LoC, 53 commits, health 3.39 (↓1.73). The mislabelled XSS dismissal (:1044), many unused-var alerts, 35–49% coupled to _adapter/_shell.
5. **`src/lib/compliance/signals.js`** — P0 F-0005; `NEXUS_PROFILE` not frozen; protected-lib. **Edited this session: health fell 10→8.07** (an "honest note": correct fix, less-healthy code). Ghost-jurisdiction pair CS-C-51.
6. **`src/lib/util/url-safe.js`** — P0 F-0004; host comparison without parsing, scheme-strip anchor, wrong logical-operator proof.
7. **`src/lib/audit/payload-schema.js`** — P0 F-0003; unanchored engine-version, unenforced draft gate.
8. **`src/lib/enrich/lead-quality.js`** — P1 F-0090/GR-0001 persisted-socials bypass; CS-D-07 health 3.46 (↓0.7); multiple `unneeded-defensive-code` guards (RE-CHECK), bad-tag-filter.
9. **`patch-dist.js` (website)** — CS-H-10: 1,409 LoC, health 9.84 but many high SOUND dismissals (bad-tag-filter, file-system-race, multi-char sanitization); central to website coupling cluster.
10. **`cloudflare/audit-worker-v14.js`** — CS-H-04: 1,552 LoC, 39 commits, health 2.72 flat; many unused viz functions, one fixed multi-char-sanitization XSS.
11. **`src/lib/audit/site-scan.js`** — CS-H-05/D-04: health 3.23 (↓0.3); `CORPUS_MAX_CHARS` zero-corpus (CR-0050); ReDoS; multiple fixed bad-tag-filter.
12. **`src/lib/compliance/connect.js`** — CS-H-07/D-10: 206 LoC, 36 commits, **health 4.62 (↓2.82).** Ghost-jurisdiction pair; ReDoS SGL-0042.
13. **`src/lib/audit/firm-profile.js`** — CS-H-08/D-15: **health 5.24 (↓3.28).** host + jurisdiction producer; trivial-conditional; bad-tag-filter.
14. **`scripts/mint-worker.js`** — CS-D-37: health 8.09 (↓1.57, **edited this session**); await-before-ok bug, dead-letter/Sentry issues.
15. **`mcp/tamazia-ops/server.py`** — CS-D-12: 1,997 LoC, **health 4.8 (↓3.32).** 8 `dynamic-urllib` (§3), 8 `empty-except` (RE-CHECK), unused globals/imports.
16. **`src/lib/llm/router.js`** — CS-D-18 health 6.14 (↓1.08); 6 file→http taint (dismissed), optional-provider-logged-as-error.
17. **`src/lib/compliance/jurisdiction-router.js`** — CS-D-24 health 7.0 (↓1.02); jurisdiction + sector producer; unused `regions`.
18. **`src/skills/S008-personalisation-engine/lib/extract.js`** — REASONED high regex FPs (:85,:105); ReDoS SGL-0056-0059; fixed url-scheme-check/double-escaping.
19. **`src/lib/audit/finding-trust.js`** — CS-D-19 health 6.49; `MIN_PAGES_FOR_ABSENCE→0`; browser-vs-presence priority; useless assignments (edited this session).
20. **`functions/_lib/notify.js` (website)** — REASONED high stripTags/escMd FPs (verified correct :91/96/139); CS-D-31 health 7.96 (↓1.07). *(Honorable mentions: `scripts/backtest-personalisation.js` — 10 open regex-anchor + 4 hostname-regexp alerts; `tools/sweep/collect-local.js` — the sweep's own tool with child-process + path-traversal in §3.)*

---

## F) THINGS EASY TO MISS FROM SUMMARIES — asides, caveats, honest notes, tool config, exactly which tools & how

**The 12 tools and exactly what each contributed / how it was run** (this is the list the user wants running 24×7 in the rebuild):
1. **CodeQL** — semantic dataflow & taint; 425 findings (§1); GitHub code-scanning; workflow `.github/workflows/codeql.yml`.
2. **Semgrep OSS (uploaded)** — pattern + security-audit rulesets; 454 (§2); `.github/workflows/semgrep.yml`.
3. **Semgrep (fresh full tree)** — re-run *now* on main with `p/default + p/security-audit + p/javascript --sarif`; 83 that still exist (§3).
4. **CodeRabbit** — cross-file INTENT; 139 (§4); harvested from GitHub review API across every PR (not re-run on history — findings already stored); config `.coderabbit.yaml` (CR-0054/0055 flag `tools` placement and `early_access`). "Strongest tool on the estate; caught 10 real issues on PR #340, two of which were bugs I shipped."
5. **Greptile** — 3 findings, **credit-blocked** — explicit verdict: "**Do not pay for it.**"
6. **CodeScene** — the only tool that reads the GIT LOG (hotspots, trend, change-coupling, economics). Project 82581, job 6934386, 69,328 LoC / 738 files. Explicit honesty caveat (§6): "**it will NOT find a broken regex, a dead P0 rule, a jurisdiction attached to the wrong country, or an inverted compliance polarity. It has no idea what your engine means.** The domain gates found those. Both lanes are required."
7. **madge** — reachability; 0 findings *by design* — "an empty section here is the gate working" (§7).
8. **one-door** — SEMANTIC duplication, 36/7 facts (§8) — "**the most valuable analyser; no marketplace tool can replace it. jscpd structurally cannot see this class.**"
9. **jscpd** — textual clones, 86, **unfiltered** (§9). Honest note: "I originally filtered these to ≥20 lines and called the rest 'boilerplate' — that was me deciding what you were allowed to see. Removed. You judge what is noise."
10. **dependency-cruiser** — orphans + circulars, 14 (§10; note 6/14 are node_modules zod/aws-crypto circulars = not actionable, CR-0008 flags this).
11. **ESLint** — 2 findings but "**caught 3 MINT-KILLING bugs 77 green evals missed**" — `no-undef` (ReferenceError) and `no-use-before-define` (temporal-dead-zone), both shipped. "The gate that proves the code can run at all." EL-0002 is itself a parse-error (collect-eslint.js:21 got unparseable JSON).
12. **Domain gates** — 5 gates (§12) that "found what no marketplace tool did": regex-health (1,075 patterns/671 rules), rule-polarity, prohibition-calibration, reachability, nexus-anchoring.

**The gate philosophy (§0):** **ACT = ≥2 independent tools agree = a fact, fix it. REVIEW = one tool only = a lead, never auto-fixed.** "A lone finding from a weak tool is noise; a lone finding from a strong tool is still only a lead. Corroboration is the whole point." Only 6 of 256 distinct defects reached ACT.

**Narrative asides / honest notes not visible in tables:**
- **CodeScene's first act was to fail the author** (§6.6): PR #342 (the sweep tooling itself) failed the Code Health quality gate on 3 files — normalise.js (7.61/4 rules), collect-local.js (8.1/4), report.js (9.1/3). "It is right, and I will fix it. I am not going to hold your engine to a standard my own code does not meet."
- **The "correct fix ≠ healthy fix" admission** (§6.5): `signals.js` fell 10→8.07 and `mint-worker.js` 9.66→8.09 — both edited this session. "My fixes were correct, and they made the code less healthy… a correct fix and a healthy fix are not the same thing, and CodeScene is now measuring the difference."
- **Dismissal-hygiene honesty** (§13): "The dismissal hygiene here is better than I expected, and I am not going to manufacture alarm." Only real defect = 1 mislabelled alert. But: "160 SRI alerts dismissed as 'false positive' in one sweep is a decision that deserves re-examination one by one, not defence in aggregate."
- **The two "numbers that are themselves findings"**: 45/525 PRs reviewed (480 unreviewed); 515 dismissals (322 "won't fix").

**CodeScene economics/config details (§6.1, §6.7) — load-bearing for a 24×7 rebuild:**
- System health: **Average 7.2 (Problematic) vs Hotspot 3.7 (Unhealthy)** — "the code you change most is nearly twice as rotten as the code you don't… the worst possible shape." **66 files declining vs 2 improving; 26 climbing rank AND declining; 7 predicted to decline.** Composition Red 20.3% / Yellow 40.7% / Green 39%. Architecture: 2 components, 0 improving, 2 declining. **Hotspots are 1.5% of files but absorb 24% of dev effort.**
- **Cross-repo coupling (§6.3, "THE BIGGEST FINDING"): engine↔renderer 61% coupled with no shared schema** (build.js↔_adapter.js 61%/20rev; firm-profile↔_adapter 60%; compliance↔_adapter 60%). This is the mechanism behind the "Sector regulator on 51% of catalogue" and the "£17.5M fine fixed in DB, never reached client."
- **§6.7 tool config, verbatim:** Quality-gates profile = **Clean Code Collective (Minimal Safety Net + Quality Guardians), 5 gates all able to fire today.** Gates ENABLED: Prevent Hotspot Decline · New Code is Healthy · Enforce Critical Code Health Rules · Enforce Advisory Code Health Rules · Tag Reviewer for Critical Code. Gates left OFF: Enforce Refactoring Goals, Enforce Supervise Goals — "they enforce refactoring goals that do not exist yet. **A gate that cannot fire is theatre.**" Exclude source branches `^(main|full-tree-base|empty-base)$` (else PR #343 reports all 428 files as "new code"). Only PRs targeting default branch: YES. Comment on ALL PRs: YES (default is failures-only; they want every finding). Post findings as: Create a review in the PR (inline comments — which the §4 harvester pulls straight into this ledger). GitHub App = CodeScene Delta Analysis, scoped to 2 repos, read-code / write-checks+PRs only — **least privilege: it cannot write code.** Both repo refs pinned to main so the full-tree-base deletion commit doesn't pollute history analysis.

**Provenance / methodology (file footer) — how to reproduce & how numbering is deterministic:**
- Commands: `node tools/sweep/collect-alerts-full.js` (harvest all alert states); `collect-reviews.js` (every AI review comment); `semgrep scan --config=p/default --config=p/security-audit --config=p/javascript --sarif`; `collect-local.js` + `collect-eslint.js` (domain + local analysers); `normalise.js sarif` (fingerprint→dedupe→Union-Find cluster→number); `report.js` (this report).
- **Fingerprint = SHA256(path ‖ rule_id ‖ SHA256(snippet)) — never the line number** ("lines shift on every edit; the defect does not"). Dedupe = hash map O(1). Cluster = Union-Find (union-by-rank + path compression), bucketed by (path, category) so it never compares across files. Numbering = sort by (severity, corroboration, fingerprint) → deterministic ("same input, same numbers, forever").

**Caveat on totals:** the CodeRabbit note "/node_modules/" appears as several finding rows (CR-0035/0056/0082/0133 etc.) — these are filter/exclusion artefacts, not real defects, and (per CR-0008) node_modules circular-dependency findings inflate the dep-cruiser count. Two CodeQL "duplicate" copies (`dist/` and `public/audit/audit-app.js`, plus `functions/` bundles) also inflate raw counts (CR-0009). The 425/454/83/139/3/144/0/36/86/14/2/5 per-tool numbers should be read with that dedup context.