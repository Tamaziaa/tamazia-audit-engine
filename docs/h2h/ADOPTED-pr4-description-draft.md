# PR #4 — P3: evidence + breach engine

## Summary
P3 delivers the evidence + breach engine end-to-end against the pre-committed acceptance spec (docs/PRD.md §P3), built in three waves. All five structural gates of Rule 12 are now live and wired (e2e487). The fleet is fully green from a fresh clone with 1,077 tests. Red-team fixtures show 0 escapes and eval harness precision is 1.000. PECR-in-minted-payload is deferred to P4.

## What landed

### Evidence lanes
- **Crawler (`evidence/crawler/`)** — ported E-236 parallel crawler + coverage-contract as BLOCKING data (not reporting); tier-1 legal pages first; query-string URLs, footer PDFs, `via_archive`, `target_unfetched` all handled; one parsed-host door promoted to `tools/lib/safe-fetch.js` (closes `host-substring` GAP).
- **Registers (`evidence/registers/`)** — binary pre-fetched rows (CH/GLEIF/SRA/CQC/FCA/ICO); real-name match required (C-004); free-tier only, deadlined, keys-absent = loud note.
- **Browser (`evidence/browser/observe.js`)** — PECR pre/post-consent diff lane; pre-consent non-essential cookie = observed breach with network artifact; single outer deadline race (C-040); licence-vetted oracle (C-043).

### Breach pipeline
- `breach/proposers/` — detection-spec migrated from prose to machine-checkable specs.
- `breach/verifiers/quote-match.js` — Rule 3 quote-match verification.
- `breach/adjudicator/` — `evidence-kind.js` + `verdict.js` (violation / needs-review / pass).
- `llm/gate.js` — LLM verification gate with router.

### 5 structural gates (Rule 12)
- All five structural gates live and wired end-to-end (e2e487, Gate-3 NLI + 2 domain gates per 357eb87).
- Gate-3 NLI + eval harness precision 1.000 (357eb87); 2 domain gates verified.

### Eval / red-team / e2e
- R2 e2e harness: 6 stages wired, 990 tests, zero-contradiction bar MET, red-team 0 escapes (23cffaf).
- R3 reconciliation: all decisions applied, ReDoS killed 45s→2ms, e2e inline 31/31, history-regression exit 0 (357eb87).
- Red-team: 9 entries (CKPT 9), 3 US firms verified, RT-F P0 identity escape found + CLOSED (af7ad6b).
- Free-model delegation plan benchmarked: 20–30% delegable, jury+collectors, bash-harness door (b4d48ec).

### Tooling gates
- CI now compiles the catalogue BEFORE unit tests — caught C-201 fresh-clone break (1ad904d).
- FIX-A complete: 47 traversal alerts absorbed into safe-path door, 4 justified dismissals, 2 real bugs caught (dbe9d14).
- Caution bible C-208..C-255: 48 real pointers, 2 new sections, index (bf06f4c).
- Free-model head-to-head on real tasks + C-256/C-257 (tencent-drafted, Rob-vetted) (d5d3293).

## Verification (the fleet numbers)
- **1,077 tests** green (dbe9d14 FINAL CHECKPOINT state)
- **990 tests** in R2 e2e harness, zero-contradiction bar MET, red-team 0 escapes (23cffaf)
- **937 tests** local fleet green on combined tree, sweep ACT 0 (4d40e7c)
- **e2e inline 31/31**, history-regression exit 0 (357eb87)
- **Eval harness precision 1.000**, ReDoS 45s→2ms (357eb87)
- **47 traversal alerts** absorbed, 2 real bugs caught, 4 justified dismissals (dbe9d14)
- **48 caution pointers** added C-208..C-255 (bf06f4c)

## Review guide (where to look first)
1. `docs/PRD.md §P3` + committed spec `8c29210` — the contract builders could not self-certify against.
2. `e4807ac` — P3 FINAL INTEGRATION: all five structural gates live, fleet fully green.
3. `evidence/` (crawler, registers, browser) — the three evidence lanes per Wave 1.
4. `breach/` (proposers, verifiers, adjudicator) + `llm/gate.js` — breach pipeline + 5 gates.
5. `357eb87` / `23cffaf` — eval, red-team, e2e evidence.

## Known deferrals
- **PECR-in-minted-payload** → deferred to P4 (not in this PR's scope; paused 2,858-row queue re-mint awaiting P3 exit + founder sign-off per decision 23).
