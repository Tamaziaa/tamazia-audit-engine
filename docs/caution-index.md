# caution-index.md: one-line recall index

One line per pointer in `caution.md`, grouped by its section, for fast recall. Format: `C-xxx: <what went wrong> -> <the rule>`. This index is derived from `caution.md` (the authoritative source); if the two ever disagree, `caution.md` wins. Regenerate by hand when new pointers are appended.

## 1. Resolution (identity, jurisdiction, sector)

- C-001: firm name from domain stem in 7 call sites -> one identity resolver is the only firm-name producer.
- C-002: page heading read as firm name -> display name shares a domain-stem token or a register match, else the clean stem.
- C-003: slugs from marketing titles leaked HTML entities -> slugs derive from the resolved name; CI rejects amp/x27/quot residue.
- C-004: register accepted any HTTP-200-with-rows -> a match requires a real name match against the query.
- C-005: provenance stamped without establishing evidence -> provenance only for the source that actually established the fact.
- C-006: Miami firm judged under UK law -> jurisdiction needs agreement of independent signals; abstain on conflict, never default UK.
- C-007: single-weight detectMarkets fabricated a UAE market -> attach on one Tier-A or two Tier-B signals; Tier-C prose never alone.
- C-008: marketing reach conflated with legal nexus -> serves and bound are separate typed fields; law attaches off bound only.
- C-009: unanchored /incorporated in/ mis-assigned US law -> every nexus regex binds evidence to a named country token.
- C-010: "DIFC Courts" read as DIFC establishment -> establishment = incorporation/registration/licence, never a venue mention.
- C-011: DIFC+ADGM attached from service-page keywords -> jurisdiction ties to licence/establishment, not discussed places.
- C-012: hotel classified media on raw HTML -> sector classification runs on stripped visible text only.
- C-013: flat first-match keyword (\bllp\b) -> self-IDs run before keyword lists; keyword classification needs two cues.
- C-014: law firm classified ACCOUNTING on vocabulary -> a regulatory authorisation statement decides sector outright.
- C-015: sector corrected after rule selection -> the sector decision precedes attachment in source order.
- C-016: clinic shipped sector General, lost regulated pack -> regulated signals may never ship a generic sector; resolve or quarantine.
- C-017: state school assessed under OfS + consumer law -> sub-sector resolution is mandatory before regulator attachment.
- C-018: three engines, three sectors for one firm -> one sector ontology in one module, single producer.
- C-019: /^EU/ matched "EUROPEAN" -> anchor every prefix test with a delimiter, tested against near-miss fixtures.
- C-020: registered-country nexus injected after the filter -> inject before the filter; a source-order guard locks it.
- C-021: detected_jurisdictions empty on no signal -> fall back to registered country + bound-framework jurisdictions.
- C-022: non-English pages fed English regexes (16-breach cascade) -> gate to compliance_unassessed; language detection precedes classification.
- C-023: sector tags with no canonical-tree key -> every rule tag resolves to a canonical node or the catalogue linter fails.

## 2. Crawl & Evidence

- C-024: 4,000-char corpus cut dropped footer disclosures -> generous env-guarded cap; on truncation, absence claims demote to needs-review.
- C-025: corpus floors forced to 0 via env -> safety floors clamped in code; a sub-floor env value throws at startup.
- C-026: crawl cap exhausted before policy pages -> Tier-1 legal pages fetched before any commercial page and before any cap.
- C-027: link discovery excluded any URL with "?" -> query-string URLs are crawled; a query-string policy fixture is in the eval.
- C-028: must_appear fell back to whole corpus on unfetched page -> a url_check fires only if its page was fetched, else target_unfetched.
- C-029: reconciliation checked reachability, not per-rule coverage -> every rule declares its page-class need; missing -> screened.
- C-030: Wayback snapshot rendered as a current breach -> via_archive travels into finding trust; archive absence is needs-review, fines withheld.
- C-031: crawl-escalation flipped reachable on any length>0 -> the reachable flip is guarded against login/challenge/error pages by content.
- C-032: SPAs never rendered -> no absence claim on render-dependent content when unrendered; unrendered -> unverified.
- C-033: footer-linked PDFs never read -> the crawler follows footer links incl. PDFs and parses them before any absence claim.
- C-034: on-page footer company number never scanned -> footer text is a mandatory surface for registration-number/office rules.
- C-035: detection on raw HTML, quote from stripped text -> detection and evidence surface are one declared corpus per rule.
- C-036: disclosure keyword inside a script counted as "having" -> triggers match visible prose; mechanism presence lenient; declared per rule.
- C-037: absence rendered for sites never read -> fabrication-prone blocks gated behind a real live-read (siteScanned) guard.
- C-038: bot-walled site asserted against -> an unreadable site gets knowledge-mode only: no findings, no fines.
- C-039: PECR pre-consent breach is behaviour, not HTML -> pre/post-consent browser observation is a first-class evidence lane.
- C-040: browser goto timeout did not bound launch (752s hang) -> every browser step wrapped in one hard outer Promise.race deadline.
- C-041: missing playwright silently did nothing -> a missing evidence-lane dependency logs loudly and is recorded on the payload.
- C-042: broken policy links uncaught -> a link-health check runs on every policy/consent control; a broken control is a finding class.
- C-043: NonCommercial-licensed oracles shipped in a paid product -> every bundled data source carries a commercial-OK licence; CI blocks NC/AGPL.
- C-044: coverage classify substring-matched "cost"->pricing -> page-type classification uses path segments and anchored tokens.
- C-045: local sandbox scan differed from the runner mint -> verification runs against the minted payload and the live URL, never a local scan.

## 3. Applicability

- C-046: DB stored 'prohibited', engine tested 'prohibit' -> code matches the exact enum the DB stores; an eval drives both polarities.
- C-047: prohibitions leaked onto any firm in the sector -> prohibited-content rules need a real subject trigger, not sector membership.
- C-048: must_appear ASA rule fired when phrase absent -> a polarity linter proves every prohibition is typed prohibit, calibrated both ways.
- C-049: 240 trigger_then_check rules had no check regex -> the catalogue linter fails any active rule that can neither find nor is attachment-only.
- C-050: over-escaped stored patterns matched nothing forever -> a regex-health linter proves every pattern matches its own positive token.
- C-051: canonical sector compared against raw relevance tags -> canonicalise both sides of every tag comparison at the gate.
- C-052: barristers bridged to law-firms (SRA on chambers) -> node-exclusive frameworks bind their exact node; one producer file only.
- C-053: FR_CNIL/DE_BDSG stored jurisdiction='EU' -> member-state law carries its ISO code; a supranational-coded national statute fails the linter.
- C-054: national law leaked via bare-token triggers (|FR|) -> national law gates on membership evidence, not leaky token alternations.
- C-055: CCPA/CPRA attached with no residency nexus; state module dormant -> threshold laws held until nexus proven, advisory when unprovable.
- C-056: CCPA + CPRA both attached -> the catalogue models supersession; a superseded twin beside its successor fails the linter.
- C-057: UK_COMPANIES_ACT gate fired on "limited availability" -> entity gates anchor to company-name/number context, never bare words.
- C-058: consumer law fired on "book a consultation" -> consumer law needs B2C transaction evidence, not ubiquitous business language.
- C-059: signalSatisfiesTrigger substring "post"->postcode -> trigger tokens are word-boundary anchored; substring matching banned.
- C-060: ugc:true alone attached FTC fake-reviews -> a structured signal never satisfies a content trigger without a real subject match.
- C-061: UAE_DHA attached in every emirate; DHA+DOH+MOHAP stacked -> emirate-scoped gates with per-emirate authority exclusivity.
- C-062: SAUDI_PDPL failed to attach (redundant gate demanded) -> jurisdiction membership IS the nexus for a home data-protection law.
- C-063: nexus family map covered only UK/EU/US/AE -> the family map covers every routed jurisdiction or the gate fails closed.
- C-064: DIFC/ADGM stacked with UAE_PDPL -> free-zone establishment is a distinct nexus; free-zone law displaces, never stacks.
- C-065: citation-presence pseudo-rules masqueraded as duties -> rules optimise for legal correctness; citation-presence non-duties quarantined.
- C-066: trade bodies rendered as binding statute -> every framework declares binding_status; the linter cross-checks peer regulators.
- C-067: empty sector_relevance treated as universal -> "empty (data gap)" and "genuinely universal" are distinct schema states.
- C-068: framework list built only from findings; REG_CAP dropped clean laws -> every binding law back-fills; caps govern discretionary rows only.
- C-069: sector-agnostic laws silently removed (no baseline) -> an invariant asserts every universal law is in the universal set.
- C-070: US_CDC hit on bare "art"/"clinic"; catch-all double-covered -> tokens scoped to sub-sector; catch-alls off where named acts cover.
- C-071: Modern Slavery Act applied to sub-GBP36m SMEs -> excluded_when thresholds are first-class schema fields the gate enforces.
- C-072: Companies Act s.82 fired on a sole trader -> the rule needs an Ltd/LLP signal AND absence of a disclosed number after PDF/footer scan.
- C-073: PECR + "ICO Cookies Guidance" counted as two regimes -> frameworks mapping to one statute dedupe before counting.
- C-074: wrong instrument within the right regulator (FCA MAR on fin-promo) -> the catalogue maps sector to the correct sub-instrument.
- C-075: correct firms got only generic web-law (missing packs) -> every priority sub-sector has its pack or discloses the coverage gap.
- C-076: engine attached both sides of a conflict (dormant tie-break) -> conflict precedence is a wired, reviewed legal decision.
- C-077: rigorous resolveLaws was orphan; live path used weaker connect() -> one attachment authority; both mint and QA call it.

## 4. Breach & Adjudication

- C-078: bare-word regex accused a real firm of being HACKED -> compromise detection keys on injected outbound anchor clusters, never body prose.
- C-079: every breach was an unreviewed regex match -> pipeline is propose -> verify (artifact) -> adjudicate; only adjudicated breaches ship.
- C-080: no deterministic artifact behind findings -> no artifact, no breach; every breach carries a quote/network event/register row/DOM node.
- C-081: adjudicator verdict died at the pointers whitelist -> every verdict field is asserted to survive end-to-end; a field-survival test.
- C-082: uncertain items shipped as hard breaches -> three states only (violation/needs-review/pass); uncertainty never ships as breach.
- C-083: unadjudicated high-risk reached clients on LLM outage -> any unadjudicated P0/prohibit demotes to needs-review; adjudicator is filter-only.
- C-084: adjudicator dropped a real observed PECR breach -> browser/register facts bypass text adjudication; observed_fact is a distinct kind.
- C-085: _kindOf mapped every finding to absence (0 compliance findings) -> evidence kind is a declared enum; confirmation branches on it.
- C-086: "Unclear, leaning no" kept the finding CONFIRMED -> ambiguous verdicts default to withholding the accusation, never keeping it.
- C-087: "your site is hacked" P0 shipped with no citation -> every P0 carries locating evidence + citation; the citation gate blocks otherwise.
- C-088: SEO/GEO factory produced citation-less findings -> every finding carries a citation; citation-less cards suppressed at the validator.
- C-089: sub-25-char nav fragments passed as evidence -> quotes have a min length, are verbatim-anchored, attributable to one page.
- C-090: testimonial phrases treated as the firm's claims -> testimonial/review content is segmented out of claim detection.
- C-091: "injected spam" fired from template text -> an injection claim requires the specific injected URLs quoted verbatim.
- C-092: NO_BREACH accepted without proof -> every NO_BREACH carries a verbatim disproof quote or the rubric scores it 0.
- C-093: GDPR fired 6 criticals on a thin-but-present policy -> presence-but-thin is a distinct lower-severity class from absence.

## 5. Exposure & Fines

- C-094: statutory maxima summed ("5x GBP17.5M") -> one ceiling per family, deduped; headline is the median enforcement band.
- C-095: a GBP5M headline appeared nowhere else on the page -> the headline number traces to a band on a specific breach card.
- C-096: exposure used statutory caps verbatim -> exposure derives from typical bands scaled by enforcement, turnover-capped.
- C-097: GDPR GBP17.5M cap applied to a PECR matter -> the cap comes from the specific law's own catalogue row; cross-law borrow fails.
- C-098: UK firm shown USD5.7M exposure -> statutory currency per regime; no invented FX; no currency-ambiguous figure.
- C-099: fine rates/collapse families were hardcoded regexes -> fine basis and family-collapse derive from catalogue metadata.
- C-100: fine reads pinned to a legacy field name, collapsed to GBP0 -> the render contract validates fine fields against the record shape, loud on miss.
- C-101: a voluntary-code framework rendered a statutory fine -> fine wording suppressed when binding_status is voluntary.
- C-102: three files kept their own copy of the fine -> the catalogue is the only source of a fine/regulator/law title; a repo gate blocks literals.
- C-103: estimateTurnover invented revenue and rescaled fines -> turnover estimation lives in the engine, labelled estimated, abstains on a miss.
- C-104: SRA limit shipped as GBP2.6M (real GBP25k); invented quote -> no legal number from memory; every figure carries a verified source URL.
- C-105: criticals for matters regulators reprimand -> severity reflects the regulator's enforcement posture per sector.
- C-106: "the regulator can act today" on unenforced items -> enforcement claims render only when a cited enforcement row exists.

## 6. Consistency & Rendering

- C-107: engine/renderer 61% coupled, contract in prose -> the schema, transform and validator live in one versioned package the website imports.
- C-108: _contract.js existed but the render route never imported it -> the route validates the payload at runtime, fail-closed, honest error page.
- C-109: craftFix re-derived fixes at render by substring -> the fix is a typed field bound at generation; the renderer formats, never re-derives.
- C-110: the whole evidence-ledger contract shipped, renderer ignored it -> a producer contract is not delivered until a consumer reads every field.
- C-111: the violated flag was ignored -> "breached" derives only from violated; review-band items render distinctly.
- C-112: frozen FW_NAME_CAT printed "Uae Newcode"/"Sector regulator" -> names/regulators derive from the payload catalogue; unknown -> omit.
- C-113: FW_JUR returned GLOBAL for any unknown prefix -> unknown jurisdiction resolves to screened; GLOBAL is an explicit catalogue value.
- C-114: ~55 hardcoded enforcement blurbs baked into the renderer -> enforcement stories come only from payload intel; render-side news banned.
- C-115: hollow framework cards + invented filler -> a card earns its place; filler strings fail the render truth-pack.
- C-116: bucket lists drifted; a Core Web Vital carried "enforcement action" -> one isNonStatutory predicate; a metric never carries enforcement language.
- C-117: three framework counts on one audit; critical-count as breached-count -> all counts derive from one counts object; the truth-pack diffs them.
- C-118: "All 400+ frameworks screened" overstated + a rotted magic string -> coverage copy is data-driven counts, not magic strings.
- C-119: jurisdictions claimed in copy with zero attached frameworks -> a jurisdiction is named only if >=1 framework attached for it.
- C-120: decodeDeep re-introduced raw <>; unescaped SQL/HTML sinks -> escape never decode before injection; strip [<>] after decode; parameterise sinks.
- C-121: hand-maintained _av served stale bundles -> asset versions derive from the deploy commit SHA; a hand-maintained string fails CI.
- C-122: HMAC gated on an unbound secret (8-char hash only) -> dead security code is deleted or wired; the per-recipient HMAC is enforced end-to-end.
- C-123: superseded pages served 200; status/archived_at impossible combo -> superseded pages redirect; status and archived_at coupled by a constraint.
- C-124: a JSON check "proved" a render wrong in the browser -> a Playwright word-by-word truth lane asserts every rendered claim against the payload.
- C-125: a compliance_unassessed flag nothing read -> a flag is worthless until a consumer reads it end-to-end.
- C-126: no PDF/print/share affordance for a GBP495 deliverable -> deliverable export is a product requirement with its own render test.

## 7. LLM Usage

- C-127: self-learning loop invented statutes with fake citations -> a discovered law persists only if its citation fetches 200 on an official domain and IS that law.
- C-128: the "official-URL gate" only checked a URL string existed -> a provenance gate fetches and content-verifies the destination.
- C-129: legislation.gov.uk 202/empty-body passed every fabrication -> 202/empty is never proof; require a definitive 200 with matching content.
- C-130: verifier called the real Equality Act fabricated -> three-state verdicts everywhere: refuse to promote OR accuse without proof.
- C-131: cross-verifier quarantined perfect audits (SRA on SRA firm) -> the LLM vetoes nothing it cannot know better; core/agnostic/GLOBAL immune.
- C-132: guards added to one leg missed on the quorum leg -> forked logic shares one guarded code path both legs call.
- C-133: both quorum models hit the same provider (Groq) -> quorum legs use different model families/providers, asserted by config test.
- C-134: prompts interpolated raw web text inside """ -> untrusted text is sanitised and DOC-delimited; an injection fixture is in the eval.
- C-135: 8 refs to a retired model 401'd for weeks; token mistaken for key -> model IDs in one config with a liveness probe; provider preflight validates and calls.
- C-136: the documented Haiku safety net was wired into no chain -> every declared fallback appears in an actual chain; a config test enumerates.
- C-137: Gemini calls set no JSON response format -> every JSON-expecting call sets the provider's structured-output mechanism; schema-validated parse.
- C-138: free tiers 429'd; retry storm held mints for minutes -> quota-aware routing, per-call timeouts, hard deadline caps, no backoff after final attempt.
- C-139: null LLM results never cached -> negative results are cached (bounded, TTL'd) alongside positives.
- C-140: law discovery spent mint wall-clock -> learning loops are fire-and-forget; nothing in the mint path waits on them.
- C-141: geo-probe shipped ungrounded competitor names -> client-facing generation needs grounding (search-cited); else abstain.
- C-142: hallucination.js shipped negative sentiment from memory -> any negative claim from a model needs grounded citations or is dropped.
- C-143: fix-writer ran at temperature 0.6 on client prose -> client-facing temperature capped low; rewrites constrained with a claims diff-guard.
- C-144: LLM sector alone unlocked a regulated pack -> a fact-creating LLM output needs an independent deterministic corroborator.
- C-145: model self-confidence nearly used as a quality signal -> gate rubrics are deterministic only; self-reported confidence is never an input.
- C-146: temperature 0 assumed deterministic -> temp 0 is not deterministic; log prompt/model/inputs/output; gate every prompt change on a fixture corpus.
- C-147: the LLM was positioned to author facts -> the LLM selects/judges inside the closed catalogue world; the standing fail-closed AND-chain of gates.

## 8. Gates & Testing

- C-148: 77 evals green while two mint-killing bugs shipped -> every eval suite smoke-tests the real entry point; source-text asserts are not coverage.
- C-149: coherence gate reported 0 swallows; AST found 55; ARM/AMD64 mismatch -> calibrate every analyser against known-bad each run; an unearned zero fails the gate.
- C-150: mutation testing showed 41% guarded while lines said 100% -> Stryker thresholds block CI on scanner/adjudicator/verify; coverage % is never proof.
- C-151: bare catch minted a clean bill never computed -> the silent-swallow AST gate is repo-wide, blocking; a ReferenceError records BUG, never fails open.
- C-152: gates ran after persist; llmPreflight failed open; stage marked ran -> gates run before persist, fail closed; a stage reports ran only from its body.
- C-153: module-scope _WARN singletons never reset between builds -> no module-scope mutable state in the mint path; per-invocation state only.
- C-154: 9 modules of correct legal logic never called -> the reachability gate: every audit module is reachable or listed in DORMANT.md.
- C-155: wiring gateMint would have deleted cited PECR findings -> prove a dormant gate's filter on a known-drops fixture before wiring; key per-finding.
- C-156: applyCoverage filtered on f.status while pointers carried state -> two modules reading one field share one typed contract; a round-trip test.
- C-157: matched_law_ids read as JSON by one, jsonb by another -> shared columns carry one declared type contract tested by both consumers.
- C-158: a passing generic e2e mistaken for new-sector proof -> every taxonomy change is verified against a real rendered framework set, then locked.
- C-159: an equality test would force the richer registry to match a flawed legacy -> retire legacy via shadow-gated repoint (prove old subset-of new).
- C-160: golden fixtures nearly leaked prospect PII -> committed fixtures are structural-only and pseudonymised; raw payloads gitignored.
- C-161: lone-tool findings treated as facts -> ACT requires >=2 independent tools; a single-tool finding is a lead.
- C-162: 160 SRI alerts dismissed in one blanket sweep -> dismissals are per-item with a reason; blanket dismissal fails review.
- C-163: refactoring-goal gates enabled with no goals -> a gate that cannot fire is theatre; every enabled gate must be demonstrably able to fire.
- C-164: no regression caught silent product change -> the golden-audit suite pins one payload per cell; any count/fine/name diff fails CI.
- C-165: no adversarial coverage of fabrication -> red-team fixtures (fake statutes, injected prompts, hallucinated ids) run in CI; each gate must catch its class.

## 9. Data & Pipeline

- C-166: scanner_cache keyed on ENGINE_VERSION replayed stale scans -> for a legal-evidence engine there is NO scan cache.
- C-167: ENGINE_VERSION not bumped on scan-logic changes -> CI fails a scan-logic PR that does not bump the version inside every idem/cache key.
- C-168: DELETE WHERE domain matched nothing (composite cacheKey) -> operational deletes written against the actual stored key, verified by row count.
- C-169: loadCatalogue cached a partial catalogue (0 rules) -> never cache a partial catalogue; empty rules/frameworks throws.
- C-170: pg() returned null on any psql failure (false-clean) -> transport failure and empty result are distinct states; a DB fault fails closed.
- C-171: silent catches fell back to raw keyword codes -> on profiler failure fall back to registered country only; raw codes never a fallback.
- C-172: process-global enforcement cache had no TTL -> every long-lived cache of mutable legal data declares a TTL + invalidation trigger.
- C-173: a 2099 enforcement row outranked real cases -> clamp both ends of every score; reject implausible future dates at ingest.
- C-174: parseAtom used link href on HTML feeds (0 events forever) -> feed parsers match the actual format, derive stable ids; a zero-event streak alerts.
- C-175: fetchFeed slept after the final attempt, retried 404/410 -> no backoff after the last try; permanent statuses are never retried.
- C-176: 1,004/1,006 queue rows "done" with no page -> done = DB row AND URL 200 AND Playwright pass; a reconciler diffs queue/pages/leads.
- C-177: a stub payload lacking llm_verify was writable -> the lock lives in the DB: a BEFORE-INSERT trigger rejects non-conforming rows + kill switch.
- C-178: stale idem_key ON CONFLICT adopted an old row -> exactly-once via versioned idem_key + UNIQUE; a transport failure returns a distinct state.
- C-179: a worker raced build vs timeout; the abandoned build INSERTed late -> the build deadline cancels the work, never races and abandons it.
- C-180: a >128KB statement could not ride execFileSync argv -> large statements route through a file (-f) leg by size check.
- C-181: a write failed four times with no cause -> the write seam dumps response/idem_key/row/gate-fields/size on failure; a causeless error is a defect.
- C-182: verify-backlog timed out 11x/day at its ceiling -> job timeouts are incidents; jobs chunked to clear their window; a repeated-timeout alert.
- C-183: dispatching a mint while an older run drained -> the DB version gate makes stale code unable to write; dispatch cancels/defers, never stacks.
- C-184: raising MINT_CONCURRENCY with new LLM calls 429'd -> concurrency changes benchmarked against quotas; adding LLM load + concurrency in one change banned.
- C-185: a 45s floor + serial discovery made every mint slow -> every budget is a cap never a floor; discovery fans out parallel; a per-stage latency report.
- C-186: mint-now cancellations misread as workers killed -> understand and write down concurrency-group semantics before "fixing" the scheduler.
- C-187: queue stored USA/UAE, pages stored US/AE -> one canonical country/sector enum shared by queue/pages/leads; the reconciler flags divergence.

## 10. Process & Repo Discipline

- C-188: a fact fixed in one file while other producers shipped stale -> the one-door gate blocks any fact with more than one producer; enumerate all producers.
- C-189: fixes reported done against in-loop assumptions -> done is verified against ground truth: git diff, DB row, live payload, live URL.
- C-190: a commit never pushed before a REST-API PR (empty merge) -> push, confirm a non-empty diff, verify the changed string live after deploy.
- C-191: a staged migration would have downgraded live data -> re-check live state before any staged candidate; prove old subset-of new first.
- C-192: a plan said "just wire it"; the live payload proved it would delete findings -> read the live payload/code/DB before trusting any plan; counts queried, not quoted.
- C-193: 480/525 PRs merged with zero review; hotspots rotted -> every sweep tool runs from commit 1; hotspot health decline blocks merge.
- C-194: correct fixes made code less healthy; half-applied fixes worse -> a fix lands whole (all seams/legs/copies) with its eval; health deltas reviewed.
- C-195: dead duplicate files misled readers -> dead code is deleted (with a backup tag) or listed in DORMANT.md.
- C-196: a leaked webhook secret persisted in a repo snapshot -> nothing secret-shaped is ever written to the public repo; a secret-scan gate + rotation.
- C-197: golden work verified against stale on-disk clones -> only the latest main is edited or trusted; on-disk copies are reference-only.
- C-198: prevention knowledge scattered across 2,040 ledger lines -> caution.md is append-only; every phase diff walked against every pointer.
- C-199: ported modules arrived without their tests -> every ported module arrives with its eval fixtures and its earned ledger entries.
- C-200: findings phrased as adjudicated legal conclusions -> findings ship as evidence-quoted observations + risk indicators, with a not-legal-advice line.
- C-201: (P0) CI checked a different tree than local (untracked empty dirs) -> gates run against the tree git ships (.gitkeep); verify from a fresh clone of HEAD.
- C-202: (P2) an unquoted ": " broke a workflow; the check VANISHED -> parse every workflow as a P0 lane; green = the check LIST matches the manifest.
- C-203: (P2) THRESHOLD_RX matched "employee" in "endorsement by an employee" -> a keyword is a signal only with its semantic context; both-direction fixtures.
- C-204: (P2) quota cuts killed fleets mid-write three times -> salvage doctrine: inventory the tree first, read-and-complete never rewrite; route to sonnet/opus.
- C-205: (P2) QA sidecar hashes worded as release "approvals" -> sidecars are INTEGRITY attestations; release = CI green + founder merge; CI is the only arbiter.
- C-206: (P2) a CodeScene multi-entry form dropped batched entries -> UI config re-reads persisted state after every submit; staged-but-unsubmitted is not done.
- C-207: (P2) new tooling inside an open PR reset its review cycle -> tooling ships in its own gate-loop PR; an open feature PR only SHRINKS.

## 11. Multi-agent orchestration

- C-208: (P3) salvage ran on a tree five builders were mutating and never converged -> verification-heavy stages need a QUIET tree, sequenced after the build fleet.
- C-209: (P3) a quota reset killed all four in-flight agents at ~95% -> the quota-window is a scheduling input; do not launch long agents into its last hour.
- C-210: (P3) builders saw sibling files in their own sweeps -> attribute every lead to an owned file via git diff before acting; never fix a sibling's file.
- C-211: (P3) a verifier built to an assumed sibling shape rejected 100% of real output -> re-probe the producer's actual landed shape; lock it in a hermetic test.
- C-212: (P3) a landed gate could not flip its own ledger (forbidden dir) -> an ownership-spanning change is a NAMED reconciliation task; the phase waits on it.
- C-213: (P3) an unregistered calibration fixture is ignored by --strict -> a check asserts every committed fixture is registered in run.js.
- C-214: (P3) P0s found outside the finder's scope -> document with a repro and ROUTE to the owner; the finder continues its own scope.
- C-215: (P3) a checkpoint swept in uncommitted work; a builder assumed it committed -> verify via git status/diff exactly what landed vs what is uncommitted.
- C-216: (P3) parallel builders re-implemented a helper across waves -> one-door/jscpd scan across wave boundaries; a cross-wave clone is a one-door violation.

## 12. External review & verdict discipline

- C-217: (P2 PR#3) a fix list read from a stale review body fixed the wrong residue -> a verdict is valid only against its commit SHA; re-derive if HEAD moved.
- C-218: (P3) a completeness audit ran while HEAD moved -> an audit pins every finding to its observed SHA and re-verifies what changed.
- C-219: (P2 PR#3) a reviewer supplied two legal figures, one wrong -> a reviewer-supplied number is a lead; re-verify on the primary source.
- C-220: (P3) new gates mid-review reset the P3 PR cycle again -> confirmed repeat of C-207; a feature PR that grows gate surface phase-fails.
- C-221: (P2 PR#3) the health bar flagged the deliberately known-bad fixtures -> exclude them by a narrow documented mechanism; they must still trip their own gate.

## 13. Evidence, breach & LLM lane (P3 build)

- C-222: (P3) evidence-kind literals mismatched the canonical artifact types, quarantining all observed candidates -> one frozen artifact-type enum all three import.
- C-223: (P3) proposer/verifier diverged on artifact shape; every absence/register/broken-control class fail-closed -> one shared contract; e2e composes every type.
- C-224: (P3) a shim bridged one artifact type and hid the drift on the rest -> normalise all types or add no shim; the composition test exercises unshimmed types first.
- C-225: (P3) the propose->verify lane was never composed e2e (live crawl timed out, skipped) -> an integration seam is verified only by driving both ends offline on real data.
- C-226: (P3) a prose-derived 'all' token-set ReDoS'd (CA_RPC hung 45s) -> match co-occurrence token-by-token in JS; a validateSpec ReDoS guard, both-direction.
- C-227: (P3) the ReDoS was a synchronous hang no Promise.race bounds -> CPU-bound work runs in a child process with a hard kill; smoke at real SCALE.
- C-228: (P3) a register no-match claim did not prove the lookup ran -> a register_absence breach needs a ran-proof note; row-absence without it is target_unfetched.
- C-229: (P3) the proposer self-certified its own corpus adequacy -> the verifier independently re-derives adequacy from the bundle (defence-in-depth).
- C-230: (P3) an unparsed PDF was counted as covered corpus -> a document with no parse is screened not covered; document assets excluded from the HTML corpus.
- C-231: (P3) the ported oracle carried CC BY-SA ShareAlike/copyleft -> the licence gate blocks copyleft/ShareAlike too; bundle no third-party dataset.
- C-232: (P3) identity corroborated on name-core despite a contradicting on-page number (RT-F) -> a contradicted register row abstains; a matching number is decisive.
- C-233: (P3) an xfail keyed loosely would absorb a new escape -> xfail keys on the exact status; flip out of xfail the moment the escape is closed.
- C-234: (P3) the Rule 12 NLI gate existed only in comments -> a constitution-named gate has an executing module + neutral/contradiction fixtures, or a founder-approved divergence.
- C-235: (P3) STAGE_CONTRACT named barrels/arity the modules never exported (NOT-WIRED) -> name the real entrypoint/arity; a runtime probe is authoritative; NOT-WIRED fails the harness.
- C-236: (P3) "zero false accusations" was vacuously true on zero findings -> the exit bar also requires known_breaches to reproduce; report complete vs timed-out.
- C-237: (P3) Object.freeze on a Set did not block .add() -> an immutable enum is a frozen plain object/array; the test proves a mutation throws.
- C-238: (P3) presence/absence built with one match strictness -> strictness flips by polarity; the footer is an additional presence surface, not exclusive.
- C-239: (P3) a redundant catch around a deadline-wrapped call mangled the error string -> remove it, read the rejection from the race; log the true error.

## 14. Gates, CI, catalogue & security (P2 PR#3 + P3 tooling)

- C-240: (P3) a gitignored built catalogue made a fresh clone fail 5 tests -> CI compiles consumed artifacts before the suites that load them, ahead of unit tests.
- C-241: (P2 PR#3) split('\n').length + a trailing newline failed a legal 500-line file -> a line-count gate counts lines; calibrate at the exact boundary.
- C-242: (P2 PR#3) an IPv4-mapped IPv6 spelling bypassed the SSRF door -> validate every resolved address through one door; unmap IPv4-in-IPv6; a rebinding fixture.
- C-243: (P2 PR#3) sweep metadata could be missing/non-numeric and still accepted -> validate it fail-closed (numeric counts, catching_gate a real file via lstat).
- C-244: (P2 PR#3) a statute was assumed to carry a civil penalty (FTC s.5 has none) -> statutory_max is null unless a penalty provision is cited.
- C-245: (P2 PR#3) sub_jurisdiction could be omitted; state records carried CA specifics -> sub_jurisdiction required (explicit null); state law carries no other state's specifics.
- C-246: (P3) GNU timeout(1) is absent on macOS (exit 127 read as no-failures) -> bound subprocesses with node timers/child kill/perl alarm; 127 is a harness failure.
- C-247: (P3) control-char regex literals mangled the source (Edit could not match) -> build such classes with RegExp + \uXXXX; a control-byte grep gate.
- C-248: (P3) builders wrote swallow-gate justifications the gate could not see -> use the exact literal FAIL-OPEN: marker in the accepted position; read the gate contract.
- C-249: (P3) DORMANT.md was snapshotted mid-churn and went stale -> refresh at reconciliation vs the actual tree; declare newly-landed unreached modules.
- C-250: (P3) the reachability walk was unarmed (no mint entrypoint) -> declare unreached modules in DORMANT; an audit treats SKIPPED reachability as a gap.
- C-251: (P3) node --test directory-arg and explicit-glob gave different results -> verify against the exact invocation CI uses; a discrepancy is a signal to investigate.
- C-252: (P3) a grep filter over a test run discarded the failure detail -> capture full output to a file first, then extract.
- C-253: (P3) a no-leak test embedded a secret-shaped literal -> rename it to an obviously-synthetic token so the secret-scan gate is not tripped.
- C-254: (P3) a repo-wide health total hid new debt; a fix crossed the line cap -> separate pre-existing from new by (rule, location); extract a module, never grow the file.
- C-255: (P3) a red-team fixture the generic evaluator could not check read as caught -> route to a bespoke handler or mark an explicit skip with a reason; count states separately.
