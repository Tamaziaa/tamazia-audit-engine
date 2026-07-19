# eval/reality-corpus - the reality-validation gate

Built per `AGENT-CONTEXT-PACK-2026-07-19.md`'s mandate and `KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md` section
3 ("THE REALITY-VALIDATION MACHINE") plus B8/P1-10/P0-19: the safety net that would have caught the
0/19 regression documented in `EMPIRICAL-BREACH-AUDITS/RETEST-2026-07-19.md` in ten minutes, per the
context pack, and per caution.md #258: *"a margin-blind abstain gate passed 1,699 unit tests, two
reviewers and CodeScene, and destroyed 8 of 11 real audits. Oracles measure the map. Only the corpus
measures the territory."*

The rest of the fleet (eslint, `node --test`, one-door, swallow-gate, sweep, catalogue compile,
`eval/calibration-known-bad/`) all measure the engine against **assumptions the team wrote down**. This
gate measures the engine against **hand-verified reality**: real sites, real quotes, a human who read
the live page. A PR can be green on every other gate and still be wrong about the world; this is the one
gate that would notice.

## 1. The corpus format

Each labelled site is one YAML file in `eval/reality-corpus/sites/<slug>.yml`:

```yaml
slug: <unique id, matches the fixture filename>
domain: <the real domain, or a synthetic placeholder for a synthetic fixture>
role: train | negative-near-clean | negative-out-of-scope
brand: { legal: <legal name or null>, trading: <trading name> }
establishment:                  # jurisdictions where the FIRM IS (registers, offices) - Kimi blueprint
  - jurisdiction: UK             #   section 2.3/B3's "establishment" family
    tier: A | B | C
    basis: "<why - the evidence>"
audience:                       # jurisdictions the site REACHES (marketing, language, currency) -
  - jurisdiction: UK             #   the "audience" family. Kept SEPARATE per Kimi blueprint 2.3: conflating
    tier: C                      #   the two is "a whole class of wrong-attach and wrong-miss".
    basis: "<why>"
sector_paths: [ "legal.solicitors" ]        # informal path; run.js maps the head segment to a real
                                             # facts/vocabulary.js family via metrics.js's alias table
applicable_law_ids: [ "UK_SRA_TRANSPARENCY", ... ]   # every catalogue law_id this firm should be
                                                      # assessed against (used for applicability recall)
labelled_breaches:
  - law_id: UK_SRA_TRANSPARENCY
    quote_substring: "<verbatim or near-verbatim text a human captured from the live page, or null>"
    url: "https://..."
    note: "<what a human verified, and how>"
known_clean_laws: [ "UK_EQUALITY_ACCESSIBILITY" ]    # laws that apply but the firm is CLEAN on -
                                                      # any violation finding against one of these is a
                                                      # false accusation, full stop
known_regression: "<the specific engine defect this site is known to trigger, dated and code-referenced>"
source: "EMPIRICAL-BREACH-AUDITS/<file>.md#<anchor>"
snapshot_source: manual-transcription | synthetic
```

`known_clean_laws` is how the NEGATIVE half of the brief is represented: near-clean and out-of-scope
sites are corpus members with `labelled_breaches: []` and a non-empty `known_clean_laws`/expectation
that nothing binds outside the universal set. `role: negative-near-clean` /
`role: negative-out-of-scope` mark these explicitly (see `conveyancingdirect.yml` and
`synthetic-out-of-scope-plumber.yml`).

YAML is parsed by a small hand-rolled subset parser, `eval/reality-corpus/lib/yaml.js` (block mappings,
block sequences, scalars, flow-style `[]`/`{}` for empty collections, comments - documented scope limit
in the file header; the repo runs zero runtime npm dependencies unless the blueprint says otherwise, and
js-yaml would have been the engine's first). `node eval/reality-corpus/run.js --lint` validates every
corpus file's required fields without running the engine.

## 2. The seed (13 sites, transcribed from our own human-verified work)

Every non-synthetic site here was hand-verified by direct page inspection in one of
`Tamazia-Remix/EMPIRICAL-BREACH-AUDITS/{legal-uk,legal-us,healthcare-uk,healthcare-us}.md` and
cross-referenced against the live wave-1-vs-now diff in `RETEST-2026-07-19.md`:

| Site | Sector x jurisdiction | Verified breaches | Known regression represented |
|---|---|---|---|
| `rothwellandevans` | UK solicitor | 1 (SRA pricing) + 1 caught (PECR) | sector misclassified real-estate -> now sector-abstain refusal; the PECR catch this site once produced is now LOST |
| `ukimmigrationconsulting` | UK immigration adviser | 2 (OISC number, complaints) | wave-1 jurisdiction refusal (fixed by #28) -> now sector-abstain refusal; UK_OISC_IAA_REGISTRATION is a genuine catalogue gap (Layer 1) |
| `housingdisrepairteam` | UK FCA claims mgmt | 1 (trading disclosures) + 1 caught (PECR) | sector misclassified -> now sector-abstain; false-accusation regression guard for the fixed 6/6 WPForms false "missing label" class |
| `ask4sam` | US-NY attorney | 2 (attorney advertising, disclaimer) | British-only legal vocabulary misses "attorney"/"lawyer" entirely |
| `avidlawyers` | US-FL attorney | 2 (testimonial + fee disclaimer) | the ONE site where sector self-IDs correctly (domain contains "lawyers"); still blocked at gate-6 `established_in` nexus - the corpus's proof that the sector fix alone is not sufficient |
| `seriousaccidents` | US-CA attorney | 2 (cost disclosure, case-results disclaimer) | jurisdiction correctly binds on BOTH waves (proof the US jurisdiction-misdirection bug class does not reproduce); sector was, and remains, the blocker |
| `botoxclinic` | UK aesthetics | 2 (MHRA POM ad, CAP 12.12) | THE parent-vs-leaf tag mismatch (P1-6): every aesthetics record restricts to the parent label, the classifier only ever emits a leaf |
| **`londondoctors`** | UK healthcare GP | 1 (CQC Reg 20A rating) | **THE NAMED sector-abstain regression fixture** - an unambiguous 32-cue healthcare winner still abstains on the live site under `_rivalFamiliesAtFloor` (see the corpus-limitation note in the file: this fixture's thin hand-built snapshot does not yet reproduce the exact abstain on its OWN row; the regression class is reproduced corpus-wide by `housingdisrepairteam`/`ukimmigrationconsulting` today) |
| `dentalpractice` | UK dental | 1 (GDC complaints route) | the dental branch of the same parent-vs-leaf class as `botoxclinic`; false-accusation guard for the (compliant) GDC specialist-title numbers |
| `vanfamilymedical` | US healthcare/telemedicine | 2 (HIPAA NPP, tracking pixels) | wave-1 jurisdiction refused despite an explicit on-page US address (fixed by #28); documents the jurisdiction door's country-only granularity (no state axis yet) |
| `damiradental` | UK dental | 1 (unlabelled quote, positive control) | THE proven-healthy end-to-end path: the one site RETEST-2026-07-19.md shows running classify->bind->assess->fire without abstaining |
| `conveyancingdirect` | UK conveyancer (negative) | none (near-clean control) | false-accusation guard: working CMP + full CLC/Companies-House disclosure |
| `synthetic-out-of-scope-plumber` | out-of-scope (negative, synthetic) | none | wrong-attach guard: no legal/healthcare law should ever bind |

## 3. Running it

```sh
node eval/reality-corpus/run.js --lint          # validate corpus YAML only, no engine run
node eval/reality-corpus/run.js                 # human-readable scorecard, process.exit(0|1) per budgets.json
node eval/reality-corpus/run.js --json           # machine-readable scorecard
node eval/reality-corpus/run.js --site botoxclinic
node --test eval/reality-corpus/                # the harness's OWN unit tests (yaml.js, metrics.js)
```

For each site with a captured snapshot (`eval/reality-corpus/fixtures/<slug>.json`), `run.js` calls the
REAL engine doors directly: `facts/identity.js`, `facts/jurisdiction.js`, `facts/sector.js`,
`applicability/connect.js`, and the real breach lane via `eval/e2e/lib/pipeline.js`'s `runPipeline()`
(in-process, scripted-LLM-decline by default - no network call, no real LLM call, matching the rest of
the fleet's replay discipline). `eval/reality-corpus/lib/metrics.js` then scores the output against the
label with pure functions: sector top-1, jurisdiction establishment recall, applicability recall (with
catalogue gaps split out from applicability misses - Layer 1 vs Layer 2 of the empirical audits' own
6-layer taxonomy), breach coverage-adjusted recall, and false-accusation count.

### The replay-mode limitation (disclosed, not hidden)

The fixtures in `eval/reality-corpus/fixtures/*.json` are **manual transcriptions** of the exact quotes
verified in `EMPIRICAL-BREACH-AUDITS/*.md` - short, hand-built `EvidenceBundle` excerpts, not a captured
WARC/HAR of the real crawl (the task's stated preference). Consequences, stated plainly:

- The facts/applicability layer runs for real against real (if excerpted) text - sector, jurisdiction and
  applicability numbers are genuine engine output on real code paths, not simulated.
- No fixture carries `bundle.browser` (no captured network events, no DOM), so **behavioural breaches
  (PECR pre-consent cookies, DOM accessibility) are `unassessable_lane_incomplete`**, never a false
  "missed" - this is `breach/proposers/propose.js`'s own `evalBehavioural()` lane-suppression firing
  honestly, not a shortcut in this harness. `coverage_adjusted_recall` today is computed only over the
  text/register-evidenced labelled breaches (absence-of-pricing, absence-of-disclaimer, price-led
  promotion), which is why it is currently 0/18 rather than a larger denominator.
- Jurisdiction binding is sensitive to exact sentence-level formatting (address block shape, phone
  format); several sites in this seed show `0%` establishment recall on their thin snapshot even though
  the same firm's real, full page correctly binds per the empirical audits. This is a corpus-authoring
  gap, not necessarily an engine defect - flagged per-site in each YAML's `known_regression` field rather
  than silently absorbed into the scorecard.
- `facts/jurisdiction.js` emits **country-level codes only** (`US`, `UK`), never a state/sub-jurisdiction
  axis. Every US site's `establishment[].jurisdiction` in this seed is labelled `US`, not `US-TX`/`US-FL`/
  `US-CA`, specifically so this genuine granularity gap (Kimi blueprint section 2.3's `JurisdictionAxes`,
  not yet built) is not double-counted as a false wrong-attach.

**Follow-up (tracked here, not silently deferred):** capture real Playwright + network snapshots per
seed site (a `--capture` mode against the live `evidence/` lanes, persistence stubbed exactly as
`RETEST-2026-07-19.md`'s own harness does) so PECR/DOM breaches become assessable and jurisdiction
binding reflects the real page rather than an excerpt. Until then this file states the limitation on
every read, and `budgets.json`'s baseline is set to the current honest number, not an aspirational one.

## 4. The honest baseline (2026-07-20, engine-v2.1.5-p4)

```
sites: 13 ran, 0 skipped, 0 errored
sector: accuracy 83.3%, refusal_rate 16.7% (2/12 abstained)              <- FAILS budget (max 0)
jurisdiction: establishment recall avg 30.8%, wrong-attach total 0       <- PASSES budget (max 0)
applicability: recall avg 28.2%, catalogue gaps 2
breach: coverage-adjusted recall 0.0% (0/18 assessable of 19 labelled)   <- at floor baseline (min 0)
FALSE ACCUSATIONS: 0                                                     <- PASSES budget (max 0)
RESULT: FAIL (sector.refusal_rate 0.167 > max 0)
```

This is `RETEST-2026-07-19.md`'s 0/19 finding and its named sector-abstain regression, reproduced
through this harness's own independent code path (not copied from the retest's numbers - this run calls
`facts/sector.js`/`applicability/connect.js`/the breach lane directly). It is **not fudged green**: two
of thirteen sites abstain sector on their captured snapshots today, which alone trips the hard
`sector_refusal_rate_max: 0` budget, exactly as `AGENT-CONTEXT-PACK-2026-07-19.md` instructed this report
to state honestly. `budgets.json`'s `coverage_adjusted_recall_min` is deliberately pinned at `0` (not the
observed `0.0` value dressed up as a target) so a future PR cannot make recall structurally *worse* while
still reading as "meets baseline" - see `budgets.json`'s own `_comment` and `baseline_history[]`.

## 5. Budgets and CI wiring

`eval/reality-corpus/budgets.json` holds the four hard numbers (Kimi blueprint section 3.4/3.6):

| Budget | Value | Rationale |
|---|---|---|
| `false_accusations_max` | 0 | Constitution Rule 3/10; zero tolerance, independent of every other number |
| `sector_refusal_rate_max` | 0 | the named regression this gate exists to catch |
| `coverage_adjusted_recall_min` | 0 (today's honest baseline) | ratchets up only via a dated `baseline_history[]` entry, never a silent edit |
| `jurisdiction_wrong_attach_max` | 0 | no law ever attaches to a jurisdiction the firm is not established/audience-bound in |

`run.js` exits 0 only when all four budgets are met; exit 1 means at least one is missed. **This exit
code is DATA, not a fleet failure** - per `AGENT-CONTEXT-PACK-2026-07-19.md`'s instruction, the corpus
scorecard is kept separate from the green engine fleet (eslint/`node --test`/one-door/swallow-gate/
sweep/catalogue/`npm test`/`eval/calibration-known-bad/`/history-regression), which all stay green in
this PR. A CI step that runs `node eval/reality-corpus/run.js` is EXPECTED to go red while the
sector-abstain regression is unfixed; that is the entire point of building this gate, and a PR that ships
alongside a red reality-corpus run is not thereby blocked from other work, but a PR that makes the red
score REDDER (a lower recall than the recorded baseline, a new false accusation, a new refusal) must be
treated as a regression the same way a green-to-red flip on any other gate would be.

Suggested wiring (`.github/workflows/reality-corpus.yml`, alongside the existing 14-gate engine fleet in
`.github/workflows/ci.yml`): run `node eval/reality-corpus/run.js --lint` as a required, blocking check
(a malformed corpus file is a real bug in this harness's own inputs); run
`node eval/reality-corpus/run.js --json` as an **informational** step whose JSON output is uploaded as a
build artifact and diffed against the previous run's summary - a strictly worse `coverage_adjusted_recall`,
any `false_accusations_total > 0`, or a higher `sector.refusal_rate` fails that step; an improvement is
logged with instructions to bump `budgets.json`'s `baseline_history[]`. This mirrors the existing
`tools/history-regression/check.js` pattern (compare against a recorded baseline, ratchet forward, never
silently backward).

## 6. Adding a site

1. Find or re-verify a real breach by direct page inspection (or extend `EMPIRICAL-BREACH-AUDITS/`).
2. Write `eval/reality-corpus/sites/<slug>.yml` per the format above; run `--lint`.
3. Build `eval/reality-corpus/fixtures/<slug>.json` (an `EvidenceBundle`: `{domain, corpus: {pages:
   [{url, title, text}], footerText}, registers}`) - either a manual transcription (label it
   `snapshot_source: manual-transcription`) or a captured WARC/HAR-derived bundle once the capture
   follow-up above lands (`snapshot_source: captured`).
4. Run `node eval/reality-corpus/run.js --site <slug>` and read the row before committing - a corpus
   entry that silently errors or silently skips is worse than no entry.
