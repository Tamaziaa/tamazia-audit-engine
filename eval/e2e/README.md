# eval/e2e - the P3 exit-criteria end-to-end harness

Runs the full chain the P3 exit criteria describe (`docs/P3-ACCEPTANCE.md`, "P3 exit"):

```
fixtureBundle -> facts -> coverage -> propose -> verify -> adjudicate -> findings[]
```

against `eval/reference-set/reference-set.json`'s hand-verified expectations, plus this directory's own
synthetic fixtures, plus `eval/red-team/fixtures.json`'s adversarial fixtures. It never touches the
network and never calls a real LLM provider. All three breach stages (propose/verify/adjudicate) have
landed and are wired for real per Rob's ledger decision 6; a stage that had NOT landed would still be
honestly reported `skipped`, never a silent or fabricated pass (caution.md C-037).

## Running

```
node eval/e2e/run-pipeline.js                                   # full run (real breach lane, subprocess-guarded)
node eval/e2e/run-pipeline.js --no-breach                        # facts + coverage + red-team only (fast)
node eval/e2e/run-pipeline.js --domain neuclinic.co.uk           # one firm
node eval/e2e/run-pipeline.js --json                             # machine-readable
node eval/e2e/run-pipeline.js --no-synthetic --no-red-team       # reference-set firms only
node eval/e2e/run-pipeline.js --breach-timeout 8000              # tune the per-firm breach deadline (ms)
node eval/e2e/run-pipeline.js --breach-inline                    # run the breach lane in-process (fast, no subprocess) - use ONCE the propose ReDoS below is fixed
node eval/e2e/run-pipeline.js --set <file> --fixtures <dir> --synthetic <dir> --red-team <file>
```

**Suggested `package.json` script** (this task does not own `package.json`; add by hand):

```json
"e2e": "node eval/e2e/run-pipeline.js"
```

### The propose ReDoS guard (why the breach lane runs in a subprocess by default)

`breach/proposers/propose.js` currently hangs SYNCHRONOUSLY on the real 92-record catalogue against real
corpora - a catastrophic-backtracking-regex (ReDoS) P0 in its `presence`/`visible_text` detection specs
(observed: `CA_RPC_CH7` ~6s, `IL_RPC_7` ~8s, `NY_RPC_7_3_7_4` hangs). Owner: R3 / W2a. A synchronous hang
cannot be bounded by an in-process `Promise.race` (the event loop is blocked), so by default the real
breach lane runs in a CHILD PROCESS (`eval/e2e/lib/breach-worker.js`) bounded by a hard `--breach-timeout`
wall-clock kill (Constitution Rule 9). A firm whose breach lane hangs is recorded as an honest breach-lane
**error/timeout** (never a hang, never a fabricated pass); the run completes. Once the ReDoS is fixed,
`--breach-inline` runs the fast in-process lane. Tests use small/empty catalogues (which never hang) and
run in-process.

### Exit codes

- `0` - zero contradictions AND zero red-team escapes/errors among entries that actually ran. (A breach-
  lane timeout is neither a contradiction nor a red-team escape - it is surfaced in the summary's
  `breach lane: N complete | N errored/timed-out | N skipped` line so a timed-out run is never misread as
  a clean full assessment.)
- `1` - at least one contradiction (a known-verified fact disagreed with, a binding jurisdiction outside
  the verified list, or a `known_non_breach` asserted as a finding), or at least one red-team escape/error.
- `2` - usage/data error: a bad argument, an unreadable reference set, an empty/missing fixtures
  directory, a reference-set firm with no fixture on disk (an uncovered gap, not an abstention), or a
  facts/coverage door that threw (a real integration bug, never silently downgraded).

## Pipeline stages

| Stage | Module (`--json` `stageWiring` is the live truth) | Status |
|---|---|---|
| fixtureBundle | `eval/reference-set/fixtures/*.json` (real crawled fixtures) + `eval/e2e/fixtures/*.json` (synthetic additions) | live |
| facts | `facts/identity.js`, `facts/jurisdiction.js`, `facts/sector.js`, `facts/capabilities.js` | live (P1) |
| coverage | `evidence/crawler/coverage-contract.js` against `catalogue/dist/catalogue.v1.json` | live (P2/P3 wave 1) |
| propose | `breach/proposers/propose.js` exporting `propose(bundle, catalogue, coverage)` -> `candidate[]` | **wired** (W2a); subprocess-guarded (ReDoS above) |
| verify | `breach/verifiers/index.js` exporting `verifyAll(candidates, bundle)` -> `{verified, rejected}` | **wired** (W2b) |
| adjudicate | `breach/adjudicator/adjudicate.js` exporting `adjudicate(candidates, bundle, {llmCall})` -> `{findings, report}` | **wired** (W2c, ledger decision 6: `adjudicate.js` directly, no `index.js` barrel) |

The caller (`eval/e2e/lib/pipeline.js`) unwraps the verifier's `.candidate` objects, passes the bundle
plus a SCRIPTED `llmCall` (`eval/e2e/lib/scripted-llm.js` - a `{verdicts}`/`{ok:false}` fake; the default
declines so every text candidate abstains to `needs_review`, never a fabricated violation), and reads
`.findings`. `eval/e2e/lib/breach-stages.js`'s `STAGE_CONTRACT` is the single seam to edit if a stage
moves. Rob's ledger warns (decisions 2/3/4) that the propose<->verify artifact SHAPES are being
reconciled by a parallel agent (R3); the wiring is tolerant of both pre- and post-reconciliation shapes
(a shape-mismatched candidate is rejected by the verifier or classified-invalid by the adjudicator, so it
becomes `needs_review`, never a violation).

### Breach-lane completeness, and why a known_breach reports `missed` vs `skipped`

`eval/e2e/lib/judge.js` reports a `known_breach` as `reproduced` only when the pipeline's findings carry
its `match_any` tokens; otherwise it is `missed` (the whole breach lane genuinely ran and found nothing -
an honest abstention) or `skipped` (one or more of propose/verify/adjudicate did not run for this firm -
not run via `--no-breach`, or a subprocess timeout, or a stage error). On the current tree, a firm whose
breach lane completes within `--breach-timeout` reports `missed` for its known breaches (the 92-record
catalogue does not yet carry a rule matching every forensic-audit breach); a firm whose breach lane times
out on the propose ReDoS reports `skipped`. Both are honest; neither is ever a fabricated pass.

## The judging law: match or abstain, never contradict - plus honest skips

Reuses `eval/reference-set/verify.js`'s `verifyPayload()` UNMODIFIED for identity / sector /
jurisdiction / `expected_frameworks_min` / known-breach / known-non-breach matching, and
`eval/reference-set/run-facts.js`'s exported `canonicaliseFirm()` to canonicalise `expected.sector`
before that comparison (facts/vocabulary.js's `canonicalSector`) - **exactly** the call the facts-only
harness itself makes, and for the same reason: the sector door emits a canonical family key
(`law-firms`), reference-set.json records a human alias (`legal`), and comparing the raw strings would
report a false CONTRADICTION on every aliased sector. This was caught live during this harness's own
build (`immigrationlawyersusa.com` / `russell-cooke.co.uk` both false-CONTRADICTed before the fix) and
is now regression-locked in `eval/e2e/lib/judge.test.js`.

`eval/e2e/lib/judge.js` adds the one further distinction a facts-only harness cannot make - **why** a
`known_breach` was not reproduced:

- **reproduced** - a `known_breach`'s `match_any` tokens were found among the pipeline's findings.
- **missed** - the FULL breach lane ran (propose + verify + adjudicate all genuinely executed) and still
  did not find it. An honest abstention, not a system fault.
- **skipped** - one or more of propose/verify/adjudicate did not run for this firm (not landed, or
  errored). Calling this "missed" would overclaim: the check never really happened. **This is what every
  firm reports today**, because propose has not landed.

- **contradiction** - a `known_non_breach`'s `match_any` tokens were found among the findings (the P3
  exit bar: zero false accusations). Fatal regardless of breach-lane completeness.
- **clean** - no such finding. `trivial:true` marks the case where the breach lane could not possibly
  have produced ANY finding, so the clean verdict is true by construction, not because a real check ran.

## Fixtures

### Reference-set firms (real crawled data)

Read-only from `eval/reference-set/fixtures/*.json` and `eval/reference-set/reference-set.json` -
neither file is owned or modified by this task. See `eval/reference-set/README.md`.

### Synthetic additions (`eval/e2e/fixtures/*.json`)

Self-contained `{domain?, role?, bundle, expected, notes?}` files - fabricated domains and text only
(Constitution Rule 16: no secrets, no real prospect PII). `bundle` is an `EvidenceBundle`
(`facts/README.md`'s shape); `expected` uses exactly `reference-set.json`'s per-firm schema
(`known_breaches`, `known_non_breaches`, `jurisdictions_bound`, etc. - all optional, fill only what the
fixture actually needs to prove). `eval/e2e/fixtures/synthetic-quote-breach.json` is the worked example:
one planted, verbatim-quotable "guarantee of outcome" claim (a `known_breach`) and one trap framework
that must never be asserted (a `known_non_breach`), with no sector/jurisdiction expectations at all so
the fixture can never itself create an unrelated false contradiction.

### Red-team lane (`eval/red-team/fixtures.json`)

Landed mid-build with nine adversarial classes (`RT-A` through `RT-H`; see the file's own `doctrine` /
`bundle_shape_ref` blocks) in a richer, per-fixture shape than a single generic contract can express -
some entries carry a plain `input.bundle` (an `EvidenceBundle`), others carry `input.fetch` +
`input.honest_bundle` + `input.naive_bundle` (RT-D), `input.cookies_pre_consent` +
`input.browser_script` (RT-G), or bare `input.corpus_text` strings (RT-H); `must_not` is mostly
descriptive boolean flags rather than a single token list; `target_gate` is an object
(`{gate, status, ...}`), and the fixture's own `current_status` field records whether the class is
already `verified_caught_live`, `verified_escapes_live_gate` (a KNOWN, tracked, owned-elsewhere issue),
or `pending_gate` (not on disk at all). `eval/e2e/lib/redteam.js` supports this in two layers:

1. **Bespoke per-id handlers** (`eval/e2e/lib/redteam-handlers.js`), for the four entries whose `input`
   is not a plain bundle, or whose correct handling needs xfail semantics:
   - `RT-D-BOT-WALL` - `evidence/crawler/extract.js`'s `pageContentClass()` recognises the challenge
     page, and the four facts doors abstain across the board on both the honest (`unreachable:true`)
     and naive (challenge text stored as content) bundles.
   - `RT-G-ESSENTIAL-COOKIE-PRECONSENT` (**partial** - documented scope limit) - `evidence/browser/
     oracle.js`'s `classifyCookie()` correctly classifies the fixture's session/CSRF/consent cookies as
     essential. The full `evidence/browser/observe()` lane run against a scripted fake browser built
     from `input.browser_script` is NOT implemented; that is a real, separate piece of work.
   - `RT-H-QUOTE-DRIFT` - `breach/verifiers/index.js`'s `verifyQuote()` (Gate 2) rejects the one-word-
     drifted quote and accepts the exact control quote (both directions, C-203 - a verifier that
     rejects everything is theatre).
   - `RT-F-CONTRADICTORY-ENTITY` - `facts/identity.js`'s `resolveIdentity()` is called directly; the
     fixture documents a KNOWN, live escape (a name-corroborated register row is accepted at `register`
     confidence despite a contradicting on-page company number and Ltd/LLP entity-form conflict). Wired
     as **xfail**: if the escape still reproduces AND the fixture's own `current_status` already says
     `verified_escapes_live_gate`, this is the tracked, expected state (does not fail the build); if it
     no longer reproduces, that is a genuine regression-fix (reports `caught`); a *different* new escape
     shape would still report a fresh `escaped`, never silently absorbed into the xfail (caution.md
     C-162 / Fleet Rule 4: the red team records, it does not fix).
2. **A generic evaluator** for every other entry (and any future entry with no bespoke handler): resolve
   a bundle from `entry.input.bundle` (this file's originally-assumed `entry.bundle`/`entry.fixture`/
   `entry.domain` shapes are kept as a forward-compatible fallback), run it through the real pipeline,
   and treat **every STRING value found anywhere in `entry.must_not`, including every string inside an
   array value**, as a forbidden token to search for in the pipeline's findings and its whole serialised
   output (checked in both places for defence in depth). Boolean flags - most of this file's `must_not`
   clauses, e.g. `RT-B1`/`RT-B2`/`RT-E` are entirely boolean - carry no searchable text and contribute
   nothing: those entries fall through to an honest `skipped` rather than a fabricated `caught` on a
   check that never actually ran (this is the same "a skipped stage can never fabricate a pass" doctrine
   applied to red-team). `RT-A` (fake statute) and `RT-C` (hallucinated id) both DO carry real forbidden
   tokens (`attach_framework_matching`, `emit_finding_citing`, and similar string/array fields) and are
   genuinely, generically caught this way.

An absent `eval/red-team/fixtures.json` is handled as an honest whole-lane skip (`present:false`), never
a fabricated pass on zero entries. Each entry reports `caught` (the gate held), `escaped` (a forbidden
token appeared, or a bespoke handler found the live gate did not hold), `skipped` (target gate
unavailable per the fixture's own `current_status`/`target_gate.status: pending_gate`, no runnable
bundle, or no evaluable `must_not` content), `xfail` (RT-F only - a known, already-tracked escape,
counted separately from a fresh one), or `error` (the pipeline, or a bespoke handler, itself threw - a
distinct failure mode from an escape, always loud, never mistaken for the gate having held).

Running `node eval/e2e/run-pipeline.js --no-synthetic` against the real, committed fixture file today
reports: `RT-A`/`RT-C`/`RT-D`/`RT-F`/`RT-G`/`RT-H` **caught**, `RT-B1`/`RT-B2`/`RT-E` honestly **skipped**
(no evaluable content this wave, or the fixture's own `pending_gate` declaration) - **zero escapes, zero
errors**. (`RT-F` is now caught, not xfail: the facts owner fixed the C-004 contradictory-entity escape,
and the fixture's own `current_status` is now `verified_caught_live`; the handler adapts automatically.)

## Files

```
eval/e2e/
  README.md                     this file
  run-pipeline.js                CLI entry point (argv parsing, orchestration, exit codes)
  run-pipeline.test.js            unit tests + the C-148 smoke test (executes the real main())
  lib/
    pipeline.js                  runs ONE bundle through facts -> coverage -> propose -> verify -> adjudicate
    breach-stages.js             the stage loader (STAGE_CONTRACT: propose.js / verifiers/index.js / adjudicate.js)
    breach-worker.js              the subprocess breach-lane worker (Rule-9 hard-deadline guard for the propose ReDoS)
    scripted-llm.js               the only llmCall this harness ever injects ({verdicts}/{ok:false}, never real network)
    catalogue-records.js          loads catalogue/dist/catalogue.v1.json's records[] for coverage
    judge.js                     reference-set comparison overlay (reproduced/missed/skipped, contradiction/clean)
    synthetic-fixtures.js         loads eval/e2e/fixtures/*.json
    redteam.js                    the red-team lane: generic evaluator + bespoke-handler dispatch
    redteam-handlers.js            bespoke per-fixture-id wiring for RT-D/RT-F/RT-G/RT-H (see above)
    report.js                    human-table + --json rendering
    *.test.js                    one node:test suite per module above
  fixtures/
    synthetic-quote-breach.json   the worked synthetic example (see above)
    fake-modules/                 test-only fixtures for breach-stages.test.js (never real breach/llm code)
```

*Not legal advice. This describes an evaluation harness, not the law.*
