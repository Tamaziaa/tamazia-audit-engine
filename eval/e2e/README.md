# eval/e2e - the P3 exit-criteria end-to-end harness

Runs the full chain the P3 exit criteria describe (`docs/P3-ACCEPTANCE.md`, "P3 exit"):

```
fixtureBundle -> facts -> coverage -> propose -> verify -> adjudicate -> findings[]
```

against `eval/reference-set/reference-set.json`'s hand-verified expectations, plus this directory's own
synthetic fixtures, plus `eval/red-team/fixtures.json`'s adversarial fixtures (landed mid-build; see
below). It never touches the network and never calls a real LLM provider - propose/verify/adjudicate are
wired opportunistically: **wired the moment a real module lands, honestly reported `skipped` until
then** (caution.md C-037: absence must be visible, never a silent or fabricated pass).

## Running

```
node eval/e2e/run-pipeline.js                                   # full run: reference-set + synthetic + red-team
node eval/e2e/run-pipeline.js --domain neuclinic.co.uk           # one firm
node eval/e2e/run-pipeline.js --json                             # machine-readable
node eval/e2e/run-pipeline.js --no-synthetic --no-red-team       # reference-set firms only
node eval/e2e/run-pipeline.js --set <file> --fixtures <dir> --synthetic <dir> --red-team <file>
```

**Suggested `package.json` script** (this task does not own `package.json`; add by hand):

```json
"e2e": "node eval/e2e/run-pipeline.js"
```

### Exit codes

- `0` - zero contradictions AND zero red-team escapes/errors among entries that actually ran.
- `1` - at least one contradiction (a known-verified fact disagreed with, a binding jurisdiction outside
  the verified list, or a `known_non_breach` asserted as a finding), or at least one red-team escape/error.
- `2` - usage/data error: a bad argument, an unreadable reference set, an empty/missing fixtures
  directory, a reference-set firm with no fixture on disk (an uncovered gap, not an abstention), or a
  facts/coverage door that threw (a real integration bug, never silently downgraded).

## Pipeline stages

| Stage | Module | Status at the time this harness was built |
|---|---|---|
| fixtureBundle | `eval/reference-set/fixtures/*.json` (real crawled fixtures) + `eval/e2e/fixtures/*.json` (synthetic additions) | live |
| facts | `facts/identity.js`, `facts/jurisdiction.js`, `facts/sector.js`, `facts/capabilities.js` | live (P1) |
| coverage | `evidence/crawler/coverage-contract.js` against `catalogue/dist/catalogue.v1.json` | live (P2/P3 wave 1) |
| propose | `breach/proposers/index.js` exporting `propose(bundle, catalogueRecords, opts)` | **not landed** (directory carries only `.gitkeep`) |
| verify | `breach/verifiers/index.js` exporting `verifyAll(candidates, bundle)` | **landed mid-build** - wired for real |
| adjudicate | `breach/adjudicator/index.js` exporting `adjudicate(verified, opts)` (`opts.llmCall` injected) | **not landed as a composed entry point** - `evidence-kind.js` (`classifyEvidenceKind`) and `verdict.js` (`parseVerdict`) exist as pure building blocks, and `llm/gate.js` + `llm/prompts/adjudicate.js` exist, but nothing yet composes them into one callable `adjudicate()` |

Run `node eval/e2e/run-pipeline.js --json` and read `stageWiring` for the CURRENT truth - this table is
a snapshot from when the harness was written, not a live source. `eval/e2e/lib/breach-stages.js`'s
`STAGE_CONTRACT` is the single seam to edit if a stage lands at a different path or export name than
guessed above.

### Why `verify` runs today but still produces empty findings

`breach/proposers/` has not landed, so `propose` always contributes `candidates = []`. `verify` (which
HAS landed - `breach/verifiers/index.js`'s `verifyAll(candidates, bundle)`) genuinely runs on that empty
list every time and genuinely returns `{verified: [], rejected: []}` - this is reported as **`ran`**,
not `skipped`, because the module executed for real. `adjudicate` still reports `skipped` (no composed
entry point exists yet). The distinction matters for `eval/e2e/lib/judge.js`: a known_breach expectation
is only ever `skipped` (never `missed`) while ANY of propose/verify/adjudicate did not fully run - which
is the case for every firm today, honestly, regardless of verify's own readiness.

### Assumed contracts for stages that have not landed yet

These are this harness's best-guess call conventions, documented so the Wave-2/3 builder can either
conform to them or tell this harness's owner to adjust `eval/e2e/lib/breach-stages.js` /
`eval/e2e/lib/pipeline.js`'s `runBreachLane()`:

- **propose**: `propose(bundle, catalogueRecords, { coverage }) -> candidate[]`, each candidate shaped
  per `breach/verifiers/quote-match.js`'s documented contract (`{rule_id, artifact:{type, ...}}`).
  Receives the FULL compiled catalogue (unfiltered by sector/jurisdiction - `applicability/` has not
  landed either), so a landed proposer is expected to filter internally.
- **adjudicate**: `adjudicate(verified, { llmCall }) -> finding[]`, where `verified` is exactly
  `breach/verifiers/index.js`'s `verifyAll(...).verified` array (`[{candidate, verified, code, reason}]`)
  and `llmCall` is ALWAYS a function this harness supplies (`eval/e2e/lib/scripted-llm.js`) - never a
  real network call. A finding is expected to carry at least `{framework, state}` where `state` is one
  of `violation | needs-review | pass` (the three-state doctrine, Constitution Rule 10) so
  `eval/reference-set/verify.js`'s `findingIsAsserted()` can tell an asserted breach from an abstention.

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
reports: `RT-A`/`RT-C`/`RT-D`/`RT-G`/`RT-H` caught, `RT-F` xfail, `RT-B1`/`RT-B2`/`RT-E` honestly
skipped (no evaluable content this wave, or the fixture's own `pending_gate` declaration) - zero
escapes, zero errors.

## Files

```
eval/e2e/
  README.md                     this file
  run-pipeline.js                CLI entry point (argv parsing, orchestration, exit codes)
  run-pipeline.test.js            unit tests + the C-148 smoke test (executes the real main())
  lib/
    pipeline.js                  runs ONE bundle through facts -> coverage -> propose -> verify -> adjudicate
    breach-stages.js             the optional-module loader (STAGE_CONTRACT lives here)
    scripted-llm.js               the only llmCall this harness ever injects (never real network)
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
