# eval/calibration-known-bad - the earn-your-zero gate

A gate that reports zero findings is only trustworthy if it provably fails on planted
disease. This directory seeds known-bad fixtures for each analyser class; `run.js`
invokes every relevant checker in `--calibrate` mode and FAILS the run if any checker
reports zero findings on its own fixture. (Constitutional rule: "every gate fails
closed and is calibrated against a known-bad fixture".)

## The --calibrate contract (for the tools/ agent)

Every checker under `tools/` (and every catalogue linter under `catalogue/linters/`)
must support:

```
node tools/<checker> --calibrate
```

- In `--calibrate` mode the checker scans **`eval/calibration-known-bad/fixtures/` only**
  (not the engine source).
- It prints a single JSON object to stdout:

```json
{ "checker": "one-door", "findings": [ { "file": "eval/calibration-known-bad/fixtures/second-door-jurisdiction.js", "line": 12, "rule": "one-door/jurisdiction", "message": "second producer of JURISDICTION" } ] }
```

- `file` must contain the fixture filename (relative or absolute both accepted).
- Exit code is 0 whether or not findings exist: `--calibrate` reports, this runner judges.

## Fixtures seeded now (P0)

| Fixture | Disease class | Checker that must catch it |
|---|---|---|
| `bare-catch-swallow.js` | bare catch swallows errors (the 165-swallow class) | silent-swallow AST gate |
| `second-door-jurisdiction.js` | second producer of the JURISDICTION fact | one-door gate |
| `rule-dead-regex.json` | over-escaped dead regex in rule JSON (`dpo[@\\s]` class) | catalogue regex-health linter |
| `rule-polarity-inverted.json` | prohibit rule whose pattern matches the compliant wording | catalogue polarity linter |
| `fabricated-fine-literal.js` | fine/regulator/law literal authored in code | catalogue-only-literals domain gate |
| `payload-missing-fields.json` | payload missing REQUIRED contract fields, dims != 10 | payload/contract validatePayload (internal, live now) |

Every fixture file carries a header explaining what is wrong with it and which gate must
fire. Fixtures are never imported by engine code.

## Running

```
node eval/calibration-known-bad/run.js            # P0 default: missing external checkers are SKIPPED with a warning
node eval/calibration-known-bad/run.js --strict   # missing checker = FAIL; CI flips to this the moment tools/ lands
node eval/calibration-known-bad/run.js --json
```

Exit 1 whenever any present checker reports zero findings on its fixture. The
`payload-contract` calibration runs internally against `payload/contract` and is live
from commit 1, so the gate is never entirely vacuous.

## Adding a calibration

1. Commit a fixture under `fixtures/` with a header comment naming the disease and the gate.
2. Add an entry to `CALIBRATIONS` in `run.js` (fixture filename + checker candidate paths).
3. The checker's `--calibrate` mode must find it. If it cannot, the checker is not done.
