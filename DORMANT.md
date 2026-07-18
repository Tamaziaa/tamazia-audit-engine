# DORMANT.md - register of intentionally unreached code

Constitution Rule 5: every module is either provably reachable from the mint entry point or explicitly
declared here with a reason. Dead-but-green code is a lie waiting to ship (caution.md C-154: 13 modules /
691 lines of correct, tested, cited legal logic were merged and never called on the old estate, including
the gate built to make an unevidenced monetary claim impossible). The reachability walk
(`tools/sweep/collect-local.js`) parses this file for exactly this table: a module not reachable from
`mint/worker.js` or `mint/index.js` AND not listed here (by its exact repo-relative path, one row per
file) fails the sweep the moment the walk arms.

**The walk is not armed yet.** `ENTRIES = ['mint/worker.js', 'mint/index.js']` in
`tools/sweep/collect-local.js`; both are P4 and neither exists (`mint/` holds only `.gitkeep` today), so
`reachability()` returns early with "SKIPPED (no mint entrypoint exists yet)" and never even reads this
file. This file is created now anyway, ahead of the gate arming, per Rule 5 and the DORMANT.md convention
referenced in README.md, CONSTITUTION.md and AGENTS.md's read order - landing it with the first modules
rather than waiting for mint/ to expose the gap is the whole point of "lands with the first module."

Every module below is real, tested, calibrated, wave-1/wave-2 P3 work. None of it is dead code in the
`groupFindings`-never-called sense (caution.md C-195): each is exercised by its own `.test.js` suite today
and will be wired into `mint/`'s evidence-collection step in P4. They are dormant only in the specific
sense that no `mint/` entry point exists yet to require them.

## Charter-exit condition FORMALLY DEFERRED to P4

The P3 charter exit **"PECR pre-consent proven in a minted payload"** is **NOT met in P3 and is formally
deferred to P4 mint wiring** - recorded here rather than silently missed. The whole evidence chain that
proves it exists and is green (`evidence/browser/observe.js` observes the pre-consent breach, the
proposer wraps it as a `network_event` candidate, the verifier re-matches it against
`bundle.browser.observed`, and the adjudicator bypasses it to a `violation` as an observed fact), but
there is no `mint/` entry point yet to assemble a bundle, run the chain end-to-end and persist the
resulting payload. "Proven in a minted payload" therefore cannot be demonstrated until `mint/worker.js`
lands (P4) and the reachability walk arms. The exit condition is owned by P4, not dropped.

## evidence/browser/ (PECR pre-consent lane, P3 Wave-1c)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `evidence/browser/deadline.js` | the one hard `Promise.race` deadline primitive for the browser lane (Rule 9 / C-040); no mint entry point requires it yet | Aman | `mint/` requires `evidence/browser/observe.js` (which requires this) for the PECR pre-consent evidence step |
| `evidence/browser/observe.js` | the lane orchestrator (`observe(url, opts)`); tested (`observe.test.js`, 14 tests) and calibrated (`p3-browser-deadline.js`, `p3-browser-preconsent-breach.js`, both wired into `eval/calibration-known-bad/run.js`), but nothing under `mint/` calls it yet | Aman | same as above |
| `evidence/browser/oracle.js` | licence-clean tracker-host + cookie classifier consumed only by `observe.js` | Aman | same as above |
| `evidence/browser/playwright-adapter.js` | the lazy, optional real-Playwright adapter; the only file naming Playwright, required lazily inside a function so its absence never breaks a require graph walk | Aman | same as above; also gated on Playwright being installed in the mint runner (not exercised in CI by design, no Chromium install) |

## evidence/crawler/ (crawl + coverage lane, P3 Wave-1a)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `evidence/crawler/crawl.js` | the crawl orchestrator (`crawl(domain, opts)`); tested (`crawl.test.js`, landed mid-pass, consuming the previously-orphaned `p3-crawl-querystring.json`/`p3-crawl-login-reachable.json` fixtures directly), but no `mint/` entry point calls it yet | Aman | `mint/` requires `evidence/crawler/crawl.js` for the site-corpus evidence step |
| `evidence/crawler/discover.js` | link + sitemap discovery, consumed only by `crawl.js` | Aman | same as above |
| `evidence/crawler/extract.js` | page-content classification + footer text extraction, consumed only by `crawl.js` | Aman | same as above |
| `evidence/crawler/pool.js` | the bounded-concurrency fetch pool; tested (`pool.test.js`, landed mid-pass), consumed only by `crawl.js` | Aman | same as above |
| `evidence/crawler/coverage-contract.js` | coverage-as-blocking-data (C-029/C-044); real and load-bearing (`crawl.js` already requires and calls it in `buildCoverage()`, and `breach/proposers/detection-spec.js` imports its `pageClassForObligation` as the one door for page-class), but the crawl path itself is unreached from any mint entry point; now covered by its own `coverage-contract.test.js` (which drives the `p3-crawl-substring-classify.json` C-044 fixture) | Aman | same as above |

## evidence/documents/ (footer-linked document lane, P3 Wave-1a)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `evidence/documents/documents.js` | follows and parses footer-linked policy documents/PDFs (C-033); consumed only by `crawl.js`'s `collectDocuments()`, itself unreached from mint | Aman | `mint/` requires `evidence/crawler/crawl.js` (which requires this) |

## evidence/registers/ (register lookups, P3 Wave-1b)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `evidence/registers/registers.js` | the orchestrator (`fetchRegisters(identityHints, opts)`); tested (`registers.test.js`) and calibrated (`p3-register-http200-nonmatch.json`, `p3-register-multi-register-nonmatch.json`, wired into `eval/calibration-known-bad/run.js` as `register-nonmatch-rejected`), but no `mint/` entry point calls it yet | Aman | `mint/` requires `evidence/registers/registers.js` for the register-grounding evidence step |
| `evidence/registers/companies-house.js` | UK company register lookup, consumed only by `registers.js` | Aman | same as above |
| `evidence/registers/gleif.js` | LEI record lookup, consumed only by `registers.js` | Aman | same as above |
| `evidence/registers/sra.js` | Solicitors Regulation Authority lookup, consumed only by `registers.js` | Aman | same as above |
| `evidence/registers/cqc.js` | Care Quality Commission lookup; founder-blocked today (`CLAUDE.md`: `CQC_PARTNER_CODE`/`CQC_API_KEY` blank), degrades loudly with `missing_key`; consumed only by `registers.js` | Aman | same as above, plus CQC API keys (founder action, tracked in CLAUDE.md) |
| `evidence/registers/fca.js` | Financial Conduct Authority register lookup; founder-blocked today (`CLAUDE.md`: FCA keys blank), degrades loudly with `missing_key`; consumed only by `registers.js` | Aman | same as above, plus FCA API keys (founder action, tracked in CLAUDE.md) |
| `evidence/registers/ico.js` | ICO registration lookup; no free real-time JSON API exists at all (the port source queried a Neon mirror of a weekly CSV this fetch-only layer cannot call), degrades loudly with `missing_endpoint`; consumed only by `registers.js` | Aman | a real-time ICO mirror endpoint exists, or a Neon-backed seam is added without smuggling in an undeclared dependency |
| `evidence/registers/lib/deadline.js` | the one `Promise.race` deadline primitive shared by every register lookup | Aman | `mint/` requires `evidence/registers/registers.js` |
| `evidence/registers/lib/lookup-runner.js` | shared execution flow (guard -> key check -> deadline fetch -> C-004 judge), consumed by every register submodule | Aman | same as above |
| `evidence/registers/lib/name-match.js` | the shared C-004 name-match algorithm, consumed by `lookup-runner.js` | Aman | same as above |
| `evidence/registers/lib/notes.js` | the shared `notes[]` entry shape/logger, consumed by every register submodule | Aman | same as above |

## breach/verifiers/ and breach/adjudicator/ (P3 Wave-2, landed mid-pass)

These modules were still `.gitkeep`-only scaffolding when this pass began and landed while it was in
progress (P3 Wave-2e, 2026-07-18); listed here now rather than left stale.

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `breach/verifiers/quote-match.js` | the Rule 3 / Rule 12 gate 2 artifact verifier (`verifyCandidate`/`verifyAll`); tested (`quote-match.test.js`) and calibrated (4 `p3-verifier-*.json` fixtures, wired into `eval/calibration-known-bad/run.js` as `breach-artifact-rejected`), but no `mint/` entry point calls it yet | Aman | `mint/` requires `breach/verifiers/` for the propose-verify-adjudicate pipeline (Constitution Rule 3) |
| `breach/verifiers/index.js` | pure re-export shim onto `quote-match.js`, nothing of its own | Aman | same as above |
| `breach/verifiers/network-event.js` | network-event artifact verification, consumed only by `quote-match.js`'s dispatch | Aman | same as above |
| `breach/verifiers/register-row.js` | register-row artifact verification (a row claimed PRESENT), consumed only by `quote-match.js`'s dispatch | Aman | same as above |
| `breach/verifiers/register-absence.js` | register NO-MATCH artifact verification (C-004: only a ran-and-no-match note proves non-appearance; a skipped/degraded lane proves nothing), consumed only by `quote-match.js`'s dispatch; calibrated (`p3-verifier-register-absence-unproven.json`) | Aman | same as above |
| `breach/verifiers/coverage-proof.js` | coverage-truncation interlock (C-024/C-025) on absence claims, consumed only by `quote-match.js`'s dispatch | Aman | same as above |
| `breach/verifiers/result.js` | the shared accepted/rejected result shape + `CODES` enum, consumed by every verifier submodule | Aman | same as above |
| `breach/artifact-types.js` | the one-door closed artifact-type enum (Rule 1) imported by the proposer, the verifier dispatch and the adjudicator's evidence-kind classifier; tested (`artifact-types.test.js`) | Aman | same as above |
| `breach/adjudicator/adjudicate.js` | the adjudicator orchestrator (`adjudicate(candidates, bundle, opts)`; filter-only per Rule 11); tested (`adjudicate.test.js`) and calibrated (self-driving fixture `p3-adjudicator-invented-finding.js`, wired into `eval/calibration-known-bad/run.js`), but no `mint/` entry point calls it yet | Aman | `mint/` requires it for the propose-verify-adjudicate pipeline |
| `breach/adjudicator/evidence-kind.js` | the evidence-kind classifier (C-085: document-absence/presence, observed-behaviour, register-fact); tested (`evidence-kind.test.js`, including a test named for the exact disease it closes); no `p3-adjudicator-*` fixture targets this file specifically, but the dedicated suite is real and passing, which is why GAPS.md flips `absence-vs-observation` to guarded despite there being no bare `--calibrate` CLI here | Aman | `mint/` requires it |
| `breach/adjudicator/verdict.js` | the verdict rubric (Rule 6/12 gate 4: abstain-by-default confidence floor); tested (`verdict.test.js`), which directly consumes the real seeded fixture `p3-adjudicator-unparseable-verdict.json` (13 malformed verdict shapes + 2 controls) as one of its cases; GAPS.md flips `adjudication-abstention` to guarded on this evidence | Aman | `mint/` requires it |

## breach/proposers/ (P3 Wave-2a, landed mid-pass)

The proposer layer has now landed (it was `.gitkeep`-only when this file was first written; that line is
corrected here). It is the only producer of breach CANDIDATES (propose -> verify -> adjudicate, C-079),
tested and reachable from its own `.test.js`, but no `mint/` entry point requires it yet.

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `breach/proposers/propose.js` | the breach proposer (`propose(bundle, catalogue, coverage)`); tested (`propose.test.js`) and exercised against the real catalogue, but no `mint/` entry point calls it yet | Aman | `mint/` requires `breach/proposers/propose.js` for the propose-verify-adjudicate pipeline (Constitution Rule 3) |
| `breach/proposers/detection-spec.js` | the runtime prose-obligation -> DetectionSpec migration consumed only by `propose.js`; page-class resolution is the single door imported from `evidence/crawler/coverage-contract.js` (no second copy); tested (`detection-spec.test.js`) | Aman | same as above |
| `breach/proposers/pattern-match.js` | the linear-time anchoring + matching primitives (`anchorToken`/`buildAnchoredRegex`/`compileRegex`/`matchesText`/`tokenContains`) consumed by `detection-spec.js` and `propose.js`; a token-set is matched token-by-token, never a co-occurrence mega-regex (the ReDoS that hung real corpora); tested (`pattern-match.test.js`) | Aman | same as above |

## llm/ (P3 Wave-2, landed mid-pass)

| Module | Reason | Owner | Unblocks when |
|---|---|---|---|
| `llm/gate.js` | the Rule 12 gates 1+2 structural validator (`validateResponse`); tested (`gate.test.js`) and calibrated (2 `p3-llm-*.json` fixtures, wired into `eval/calibration-known-bad/run.js` as `llm-gate`), but no `mint/` entry point calls it yet | Aman | `mint/` requires `llm/gate.js` to validate every adjudicator response |
| `llm/router.js` | provider routing/quorum (`route`/`quorum`); tested (`router.test.js`, all passing - the earlier synchronous-throw stringification defect is fixed) | Aman | `mint/` requires it |
| `llm/prompts/adjudicate.js` | prompt/schema builder for the adjudicator (`buildAdjudicationPrompt`); tested (`adjudicate.test.js`); its verdict enum is imported from the one door `breach/adjudicator/verdict.js` (no hyphen/underscore drift) | Aman | `mint/` requires it |

`llm/evals/` still holds only `.gitkeep` - no eval-harness module has landed as of this pass.

## Not in this file's scope

`facts/`, `applicability/`, `catalogue/` and `payload/` may also currently be unreached from any `mint/`
entry point (none exists yet), but this file's brief was `evidence/*` + `breach/*` + `llm/*` only; those
other trees are owned by other builders and were left alone here rather than guessed at.
