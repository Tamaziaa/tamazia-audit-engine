# eval/e2e - the P3 exit-criteria end-to-end harness

Runs the full chain the P3 exit criteria describe (`docs/P3-ACCEPTANCE.md`, "P3 exit"):

```
fixtureBundle -> facts -> coverage -> propose -> verify -> adjudicate -> findings[]
```

against `eval/reference-set/reference-set.json`'s hand-verified expectations, plus this directory's own
synthetic fixtures, plus (when it lands) `eval/red-team/fixtures.json`'s adversarial fixtures. It never
touches the network and never calls a real LLM provider - propose/verify/adjudicate are wired
opportunistically: **wired the moment a real module lands, honestly reported `skipped` until then**
(caution.md C-037: absence must be visible, never a silent or fabricated pass).

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
jurisdiction / `expected_frameworks_min` / known-breach / known-non-breach matching. `eval/e2e/lib/
judge.js` adds the one distinction a facts-only harness cannot make - **why** a `known_breach` was not
reproduced:

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

### Red-team lane (`eval/red-team/fixtures.json`, expected to land in parallel)

Absent today; the lane reports itself honestly skipped (`present:false`) rather than a fabricated pass
on zero entries. **Assumed contract** (align `eval/e2e/lib/redteam.js` the moment the real file lands
with a different shape):

```jsonc
{
  "entries": [
    {
      "id": "RT-001",
      "description": "optional, human-readable",
      "target_gate": "propose",              // optional: facts|coverage|propose|verify|adjudicate.
                                                // Names a stage that must be WIRED for this entry to run;
                                                // if that stage did not run, the entry is skipped (running
                                                // it would trivially "catch" for a reason that proves
                                                // nothing).
      "bundle": { "...": "an inline EvidenceBundle" },
                                                // OR "fixture": "relative/or/absolute/path.json"
                                                // OR "domain": "example.co.uk" (looked up in --fixtures)
      "must_not": { "match_any": ["fake statute name", "hallucinated-id-123"] }
    }
  ]
}
```

(A bare top-level array of the same entry shape, or `{"fixtures":[...]}`, are also accepted.) Each entry
reports `caught` (the gate held), `escaped` (a forbidden token appeared anywhere in the pipeline's
findings or its whole serialised output - checked in both places for defence in depth), `skipped`
(target gate unavailable, or no runnable bundle, or no evaluable `must_not` clause), or `error` (the
PIPELINE ITSELF threw on the fixture - a distinct failure mode from an escape, always loud, never
mistaken for the gate having held).

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
    redteam.js                    the red-team lane (see contract above)
    report.js                    human-table + --json rendering
    *.test.js                    one node:test suite per module above
  fixtures/
    synthetic-quote-breach.json   the worked synthetic example (see above)
    fake-modules/                 test-only fixtures for breach-stages.test.js (never real breach/llm code)
```

*Not legal advice. This describes an evaluation harness, not the law.*
