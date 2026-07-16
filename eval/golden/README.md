# eval/golden - pinned-payload diff harness

Pins one known-good payload per reference cell and fails CI on ANY field-level drift.
The point: a payload change is a truth change, and truth changes are made deliberately,
never as a side effect.

## Layout

```
eval/golden/
  run.js                      the harness
  goldens/<cell>.payload.json pinned truth (committed; EMPTY until P3 fills them)
  fresh/<cell>.payload.json   fresh build outputs (gitignored; produced by the build under test)
```

`<cell>` names a reference cell, e.g. `uk-legal-russell-cooke`, `us-healthcare-carbonhealth`.
One golden = one full engine payload as minted for that cell.

## Running

```
node eval/golden/run.js                      # compare goldens/ vs fresh/ (defaults)
node eval/golden/run.js --fresh <dir>        # fresh outputs live elsewhere
node eval/golden/run.js --json               # machine-readable report
```

Behaviour:

- **goldens/ empty or missing** (the P0 state): prints a WARNING and exits **0**.
  P3 fills the goldens; until then the harness is honest about having nothing to pin.
- **A golden exists but no fresh counterpart**: **FAIL** - a pinned cell the build no
  longer produces is a coverage regression, not a pass.
- **Any field differs**: **FAIL** (exit 1). Every diff is printed with its path, the
  golden value and the fresh value, and classified into: `finding-counts`, `fines`,
  `names`, `laws`, `other`. All classes fail equally; the classes exist so a human can
  see at a glance whether the drift touches money, law names, or cosmetics.

## Re-accepting goldens (the only way a diff passes)

```
node eval/golden/run.js --accept                 # accept fresh for every cell
node eval/golden/run.js --accept uk-legal-russell-cooke   # accept named cell(s) only
```

`--accept` copies the fresh payload over the golden (canonically re-serialised) and you
commit the change. Review that diff like a legal document: it IS the truth change.
There is no environment variable, no flag in CI, and no tolerance threshold - a golden
either matches or is re-accepted by a human in a reviewed commit.

## What P3 must do

1. Mint the reference cells through the new engine.
2. Hand-verify each payload against the reference set (`eval/reference-set/`).
3. `node eval/golden/run.js --accept` and commit `goldens/`.
4. Add this runner to the blocking CI lane.
