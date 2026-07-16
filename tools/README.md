# tools/: the sweep fleet

Ported with adaptation from `tamazia-cowork-os` PR #342 (`full-estate-sweep`). These tools are the harness
that goes in BEFORE the engine: they run from commit 1, and every phase exit requires them green.

One principle runs through all of them: **a zero you did not earn is a lie.** Every gate proves it can see
the class it exists to catch (in-memory self-test on every run, seeded known-bad fixtures via `--calibrate`)
before its zero counts for anything. A tool that cannot run reports a loud SKIP, never a silent zero.

## Quick start

```
node tools/sweep/run.js               # full local sweep -> tools/sweep/out/{ledger.json, LEDGER.md}
node tools/sweep/run.js --calibrate   # sweep + prove the gates catch the seeded known-bad fixtures
node tools/one-door/check.js          # just the one-door gate
node tools/swallow-gate/check.js      # just the swallow gate
node tools/fact-lineage/check.js      # just the lineage check
```

No dependencies are required: everything runs on bare Node 24. Installing optional devDependencies arms
extra lanes: `eslint` (the can-it-run-at-all gate), `jscpd` (textual clones), `dependency-cruiser`
(orphans + circulars), `acorn` (upgrades the swallow-gate from the regex fallback to a precise AST walk).

Exit codes everywhere: `0` green, `1` findings/violations open (or calibration failed), `2` the tool itself
is broken (failed self-test, unparseable input). CI must treat 1 and 2 as failures.

## tools/sweep/: SARIF fan-in, dedupe, clustering, ledger

- **`run.js`**: the orchestrator. Order of battle: (0) in-memory self-tests of one-door and swallow-gate,
  abort if either fails; (1) collectors, each writing findings JSON into `tools/sweep/out/sarif/`;
  (1b, with `--calibrate`) both gates against `eval/calibration-known-bad/fixtures/`, failing unless the
  seeded violations are found; (2) normalise; (3) ledger; (4) the gate: exit 1 if any ACT finding or gate
  violation is open. External SARIF (CodeQL, Semgrep) dropped into `tools/sweep/out/sarif/*.sarif` by CI is
  ingested automatically; review-bot comments as `*.reviews.json`; local analysers as `*.local.json`.
- **`normalise.js`**: the one entry point for findings. Fingerprint = `SHA256(path + rule_id +
  SHA256(stripped snippet))`, NEVER line numbers (lines shift on every edit; the defect does not). Dedupe by
  fingerprint across tools and runs; DSU (union by rank + path compression) clusters findings that share
  file, overlapping region (slack `CLUSTER_SLACK`, default 6) and semantic category; deterministic numbering
  F-0001... by severity DESC, corroboration DESC, fingerprint ASC. The gate: >=2 corroborating tools = ACT
  (a fact, fix it), 1 tool = REVIEW (a lead, triage it, never auto-fix).
- **`collect-local.js`**: the domain analysers: reachability from the mint entrypoints (`mint/worker.js`,
  `mint/index.js`; armed the moment one exists; unreachable and not declared in `DORMANT.md` = P0, because
  a module unreachable from the mint is dead law), jscpd (no minimum clone size: filtering is deciding what
  the reader is allowed to see), dependency-cruiser (orphans + circulars). Absent optional tools SKIP loudly.
- **`collect-eslint.js`**: the eslint lane. `no-undef` / `no-use-before-define` each caught a mint-killing
  bug on the old estate that 77 green evals missed. When eslint is not installed the skip itself is recorded
  as a note-level finding, so the ledger shows the lane was absent.
- **`ledger.js`**: the one exit point: `out/ledger.json` -> `out/LEDGER.md`. Generated, never hand-edited.

Outputs live in `tools/sweep/out/` (gitignored). Not ported from PR #342: `collect-alerts-full.js`,
`collect-codescanning.js`, `collect-reviews.js`, `report.js`. Those harvest the OLD estate's GitHub history
(code-scanning alert states, 525 PRs of review comments) and judge its 515 dismissals; they are
old-repo-specific by design. The `*.reviews.json` adapter in `normalise.js` keeps the door open for a fresh
harvest collector when this repo has history worth harvesting.

## tools/one-door/: the semantic-duplication gate

jscpd sees textual clones; this sees SEMANTIC clones: two pieces of code that both PRODUCE the same
client-visible fact. The stale door is the one the client sees. This class shipped a P0 three times on the
old estate (ghost jurisdiction, "Sector regulator" label, the GBP 17.5M fine that never reached the client).

- **`facts.json`**: the declared FACTS manifest: 8 client-visible facts (jurisdiction, host, sector,
  regulator, fine, law-title, element-checklist, identity), each mapped to its ONE allowed producer
  (`facts/jurisdiction.js`, `facts/host.js`, `facts/sector.js`, `facts/identity.js`, and `catalogue/` for
  the four catalogue-only facts), plus the producer-signature regex patterns that betray a second door.
  Adding a new client-visible fact means adding it HERE first.
- **`check.js`**: scans `catalogue/ evidence/ facts/ applicability/ breach/ llm/ payload/ mint/
  render-proof/` for files matching a fact's producer patterns outside the allowed door; any hit exits 1.
  `--calibrate` scans `eval/calibration-known-bad/fixtures/` instead and exits 1 unless it FINDS the seeded
  violations. `--json <path>` emits findings for the sweep. Self-tests on every invocation.

## tools/swallow-gate/: no failure may report success

Every `catch` must (1) rethrow, (2) call a recorder (`_warn`/`record*`/`addWarning`/`manifest.record*`/
`logger.warn|error`/`console.warn|error`/`report*`/`captureException`), or (3) carry a written
`// FAIL-OPEN: <reason>` justification inside or immediately above the catch. Bare `catch (e) {}` and
`catch {}` always fail. The old estate's coherence gate found 55 silent catches that an earlier regex
reported as 0.

- **`check.js`**: AST walk via `acorn` when installed; otherwise a hardened string/comment-aware
  brace-matching fallback (regex literals are the one context it does not model; install acorn for the
  precise walk). `SWALLOW_GATE_ENGINE=regex` forces the fallback even when acorn is installed, so CI can
  keep both engines honest. Scans the engine directories AND `tools/` itself: the gate eats its own cooking,
  which is why every intentional fail-open in this fleet carries a written `FAIL-OPEN:` line. `--calibrate`
  and `--json` as above. `eval/` is excluded from the normal scan because its fixtures are intentionally
  bad; they are exactly what `--calibrate` runs against.

## tools/lib/: shared plumbing

- **`fswalk.js`**: the one file walker for the fleet. A second walker is exactly the clone class jscpd
  exists to catch (and did catch, in this fleet's first draft).
- **`gate-cli.js`**: the one CLI runner for blocking gates: self-test first (exit 2 on failure), normal
  scan (exit 1 on violations), `--calibrate` (exit 1 unless the seeded violations are FOUND), `--json`.

## tools/fact-lineage/: single producer asserted in CI

Reads `payload/schema/facts-lineage.json` (landed by the payload owner in P4). While the manifest is absent
this check prints a WARNING and exits 0, so P0 stays green honestly. The moment it exists, blocking checks
apply: every fact declares exactly one producer, the producer file exists, and the declaration agrees with
`tools/one-door/facts.json` (two manifests disagreeing about the door is itself a two-doors defect).

## CI wiring

Per-PR and nightly: `node tools/sweep/run.js --calibrate` once the known-bad fixtures are seeded
(`node tools/sweep/run.js` until then). Upload CodeQL/Semgrep SARIF into `tools/sweep/out/sarif/` before the
run so external tools join the corroboration count. The step fails on any non-zero exit; ACT findings block
all progress until closed (the tool-warden rule: work stops if the tools stop).
