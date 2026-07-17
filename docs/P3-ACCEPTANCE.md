# P3 acceptance specification — evidence + breach

Committed BEFORE implementation per AGENTS.md (builders never self-certify; done = green CI against this spec + founder sign-off). Charter: docs/PRD.md §P3. Port source: fresh clone `/Users/amanigga/Desktop/TAMAZIA-REBUILD/cowork-os-fresh` @ `a422195` (GitHub main, v25.x) — NOT the stale `cowork-os` clone (2026-06-29; its crawler pre-dates E-236).

## Wave 1 — evidence lane (this wave)

### 1a. `evidence/crawler/` — crawl + coverage
Port sources: `src/lib/audit/site-scan.js` (635 LoC, E-236 parallel version), `src/skills/S008-personalisation-engine/scanners/compliance.js` `gatherCorpus()`, `src/lib/audit/coverage-contract.js` (50 LoC), `src/lib/audit/crawl-escalation.js` (fix C-031 while porting), `scanners/corpus-index.js` (negation guard).
- Output: the `EvidenceBundle.corpus` shape from facts/README.md verbatim: `{pages:[{url,title,text,jsonLd[],ogSiteName?}], footerText?}`; `text` = stripped visible text only (C-012).
- E-236 parallelism preserved: no serial rounds where width can widen, no `Math.max` floors (Rule 8; `tools/domain-gates/budget-caps.js` lands with this wave), sitemap discovery parallel.
- Tier-1 legal pages (privacy, cookies, terms, complaints) fetched before any commercial page and before any cap (C-026). Query-string URLs crawled (C-027, fixture required). Corpus cap generous + env floors clamped in code (C-024/C-025, sub-floor env throws). Footer-linked policy PDFs followed and parsed before any absence claim (C-033 — pdf text extraction may live in `evidence/documents/`). Footer text a mandatory surface (C-034).
- `coverage-contract.js` ported as BLOCKING data, not reporting (C-029): every catalogue rule's `evidence_type`+page-class need is answerable as `covered | screened`; missing page-class -> `screened`, never a breach input. `classify()` uses path segments + anchored tokens, no substring matches (C-044, "cost"→pricing fixture).
- Unfetched `url_check` target -> `target_unfetched` (C-028). Archive-sourced page marked `via_archive` (C-030). Login/error pages never flip `reachable` (C-031, content classification). SPA-unrendered content -> no absence claims (C-032). Bot-walled -> bundle marked unreadable, nothing asserted (C-038).
- Every fetch behind a hard deadline (Rule 9); host safety via ONE parsed-host door (reuse/extend the P2 `eval/reference-set/build-fixtures-lib.js` door by promoting it to `tools/lib/safe-fetch.js` — one door, both consumers; closes GAPS.md `host-substring` with `tools/domain-gates/host-parse.js`).

### 1b. `evidence/registers/` — binary register rows
Port sources: `src/lib/audit/register-check.js` (138 LoC), `src/lib/evidence/ico-register.js`.
- Output: `EvidenceBundle.registers` rows (`companiesHouse?, gleif?, sra?, cqc?, fca?, ico?`) — pre-fetched, binary hit/no-hit; a match REQUIRES a real name match against the query (C-004), provenance only for the establishing source (C-005). facts/ modules stay pure consumers.
- Free-tier APIs only; every call deadlined; keys absent -> row absent + loud bundle note, never a guess.

### 1c. `evidence/browser/observe.js` — PECR pre-consent lane
Port source: `src/lib/evidence/cookie-evidence.js` (288 LoC: `observe()`, `cookieFindings()`, `oracle()`, tracker/cookie classifiers).
- Pre/post-consent diff is a first-class evidence lane (C-039); a non-essential cookie set pre-consent = completed observed breach with the network event as artifact (Rule 3).
- EVERY browser step inside one hard outer `Promise.race` deadline covering launch->close (C-040/Rule 9; the 752s incident is the calibration case). Missing playwright dependency -> loud log + recorded on the bundle (C-041). Link-health check on found policy/consent controls; broken control = finding class (C-042). Oracle data licence-vetted: no NC/AGPL sources (C-043); each bundled source carries a licence field, CI-checkable.
- Output: `bundle.browser = {observed:[{kind:'cookie_pre_consent', name, host, essential:false, networkEvent:{...}, ts}], consentControl:{found, healthy, url}, lane:{ran:true|false, reason}}` (shape is this spec's contract; tests pin it).

### Wave-1 definition of done
`npm test` green (every new module has node:test); calibration fixtures added per gate (C-027 query-string site, C-044 substring classify, C-031 login page, C-040 deadline, C-004 empty-register non-match) and `--calibrate` catches all; fleet green from a fresh clone (sweep, strict calibration, health-gate zero on touched files); GAPS.md rows `crawl-poverty`, `evidence-lane-silent`, `host-substring` flipped to guarded with their gate files real; caution pointers appended for anything new learned. Live-fetch code paths must be dependency-injected (network mocked in tests; no real network in CI).

## Wave 2 — breach lane (next)
`breach/proposers/` (detection-spec migration: pack `website_obligations[].elements[]` prose -> machine-checkable specs), `breach/verifiers/quote-match.js` (Rule 3), `breach/adjudicator/` (`evidence-kind.js`, `verdict.js`; three-state violation/needs-review/pass; the 5 structural gates of Rule 12), `llm/gate.js`. Port sources: `breach-adjudicator.js` (287), `llm-verify.js`, `candidate-verifier.js`, `evidence-ledger.js`, `stage-manifest.js`.

## Wave 3 — eval closure
Red-team fixture set (adversarial INPUTS per the p1-jurisdiction fixture precedent + C-165: fake statutes, injected prompts in crawled text, hallucinated ids, bot walls, foreign-language corpora); US reference firms added; reference-set breach expectations (`known_breaches`/`known_non_breaches`) wired into an end-to-end harness: crawl -> facts -> breach -> verify.

## P3 exit (PRD)
Reference-set breaches reproduced; zero false accusations (`known_non_breaches` all honoured); red-team fixtures all caught. Then founder sign-off; the paused 2,858-row queue re-mints only after this exit (decision 23).
