# Rob's P3 integration ledger — decisions + pending seams

Authored by Rob (Fable orchestrator) while wave-2 builders were landing. This file IS the contract for the final reconciliation pass; every decision below is binding on that pass.

## DECIDED contracts (apply in the reconciliation wave)

1. **Artifact-type vocabulary (ONE closed enum).** Canonical set = the proposer/verifier set already flowing end-to-end: `quote | network_event | register_row | coverage_proof` plus NEW `register_absence` (see 3). `breach/adjudicator/evidence-kind.js` must MAP from these canonical types (its internal `corpus_quote`/`network_request`/`cookie_jar_entry` literals become aliases or are replaced). One door: define the enum in `breach/verifiers/result.js` (or a tiny shared `breach/artifact-types.js`) and have proposers, verifiers, adjudicator all import it.

2. **coverage_proof contract (absence claims).** `propose.js` MUST include `tier1_fetched:boolean` and `truncated:boolean` in the artifact at emit time (it has both from its internal absenceInterlock), alongside existing `{page_class, surface, pages_checked[], searched_patterns[]}`. `verifyCoverageProof` then independently re-verifies: pages_checked is non-empty AND every entry is a URL present in `bundle.corpus.pages`, `tier1_fetched===true`, `truncated===false`. Defence in depth: the proposer's internal interlock is NOT trusted alone (Rule 3 + C-024/C-026). Verifier stays pure over (candidate, bundle).

3. **Register no-match candidates.** A claim grounded in a register LACKING a row is a different artifact: `register_absence` `{type:'register_absence', register, query, lane:'no_match', note}`. Verifier check: `bundle.registers[register]` is absent AND the register lookup RAN (a notes[] entry for that register exists with kind skipped|degraded|no_match — a lookup that never ran proves nothing). `verifyRegisterRow` keeps verifying claimed-PRESENT rows (row must match bundle row).

4. **consent_control_broken artifacts.** `propose.js` reuses the observed-entry shape (artifact carries `host` derived from the control url via the safe-fetch door + `name:'consent_control_broken'` + the url + healthy:false) instead of a bespoke shape, so `verifyNetworkEvent`'s identity check passes unchanged.

5. **VERDICTS spelling one-door.** Canonical: `violation | needs_review | pass` (underscore, as shipped by breach/adjudicator/verdict.js which owns the enum). `llm/prompts/adjudicate.js` VERDICTS constant and any llm/ surface using 'needs-review' (hyphen) reconcile to import/underscore. CONSTITUTION prose uses hyphenated English; code uses the underscore token.

6. **e2e adjudicate stage contract.** `eval/e2e/lib/breach-stages.js` STAGE_CONTRACT points at `breach/adjudicator/adjudicate.js` (3-arg `adjudicate(candidates, bundle, {llmCall,...})` returning `{findings, report}`); the caller unwraps verifier `.candidate`s, passes bundle + a scripted llmCall, reads `.findings`. NO index.js barrel with a wrong signature.

7. **taxonomy/crossref 8-row flip.** `tools/history-regression/taxonomy.js` + `docs/failure-ledger/crossref.json`: flip exactly these classes to guarded (gate files all landed + verified by W2e): host-substring, budget-floor, evidence-lane-silent, crawl-poverty, llm-unverified, breach-artifact, absence-vs-observation, adjudication-abstention. Then `npm run history:build`; `node tools/history-regression/check.js` must exit 0.

8. **DORMANT.md reconcile.** Lines about llm/router failing test + missing adjudicate test are stale (fixed by W2d). Refresh those lines; keep the mint-wiring exit condition.

9. **--calibrate CLI scaffold jscpd clone** (verifiers vs llm/gate vs facts/identity vs registers): accepted as the documented dialect for now; extraction into a shared helper is a P3.5 cleanup, NOT done in the reconciliation wave (C-207: only shrink).

10. **p3-crawl-substring-classify.json** must gain its automated consumer: `evidence/crawler/coverage-contract.test.js` (W1a-salvage scope; if salvage lands without it, reconciliation adds the test).

## Open items to verify at reconciliation time
- W2a propose.js final shapes (agent was still building when W2b probed it) — re-probe after it lands; apply decisions 2/3/4 to its final code.
- Health-gate repo total (33 at last count) — separate pre-existing (facts/, tools/sweep ledger+normalise, fact-lineage, swallow-gate) from any NEW violations in P3 files; new ones must go to zero.
- Sweep single-tool REVIEW leads in P3 files: triage each (fix or documented-accept), zero leads in P3 files at PR time.
- Full fleet from FRESH CLONE (C-201) before PR #4.

## Completion state at last update
DONE+ACCEPTED: W1b registers, W1c browser, W2b verifiers, W2c adjudicator, W2d llm, W2e integration. RUNNING: W1a-salvage (crawler), W2a proposers (restarted), W2f red-team+US firms, W2g e2e harness.
