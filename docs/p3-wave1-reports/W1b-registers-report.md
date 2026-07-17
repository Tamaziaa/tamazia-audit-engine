# P3 Wave-1b — evidence/registers/ — builder final report (verbatim)

Agent: module-builder (sonnet), task-id acb7fce11a941db0e. Completed 2026-07-18. Saved verbatim, unedited, per instruction that no part of the finding be lost.

---

## Summary

Built the P3 Wave-1b `evidence/registers/` module: six register lookups plus a shared library and orchestrator, all pure with respect to network (dependency-injected `fetchFn`, never `process.env`, never a raw fetch/https call).

### Files (all new; absolute paths)

**Orchestrator + registers** (`/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine/evidence/registers/`):
- `registers.js` (189 lines) — `fetchRegisters(identityHints, {fetchFn, deadlineMs, keys, log})`, plus its own `--calibrate` CLI
- `companies-house.js` (69), `gleif.js` (59), `sra.js` (72), `cqc.js` (79), `fca.js` (72), `ico.js` (72)
- `lib/lookup-runner.js` (93) — shared execution flow (guard → key check → deadline fetch → C-004 judge)
- `lib/name-match.js` (160) — the shared name-match algorithm
- `lib/deadline.js` (58) — the one `Promise.race` deadline primitive
- `lib/notes.js` (27) — the shared `notes[]` entry shape/logger
- One `.test.js` per module (57 tests total, all passing) + `README.md`

**Fixtures**: `eval/calibration-known-bad/fixtures/p3-register-http200-nonmatch.json` (required, Companies House "Kingsley Napley LLP" vs "Kingsley Carpets Ltd") and `p3-register-multi-register-nonmatch.json` (Companies House + GLEIF + FCA together, broader coverage).

### Name-match algorithm (C-004)

Normalise (lowercase, `&`→`and`, strip legal suffixes via `facts/vocabulary.js`'s `LEGAL_ENTITY_SUFFIXES`), tokenise (drop tokens <3 chars and connectives), score by Jaccard similarity, require `score >= 0.6` **and** ≥1 shared token. 0.6 was chosen because: exact/suffix-only variants score 1.0; a superset variant (one extra token) scores 0.667; the "Kingsley Napley LLP" vs "Kingsley Carpets Ltd" near-miss (shares only the generic first token) scores 0.333 — comfortably below threshold on both sides of the gap.

### Provenance and degrade doctrine

Every row carries `{source, fetched_at, query, match:{name_queried, name_matched, score}}`, stamped in exactly one place (`lookup-runner.js`), never by the submodule (C-005). A register key is present on the bundle only on a real match; every other outcome (missing key, sector-inapplicable, timeout, fetch error, zero candidates, below-threshold) is field-absent plus a loud `bundle.notes[]` entry with `kind: skipped|degraded|no_match`.

### CQC/FCA/ICO honest gaps (stated as required)

CQC and FCA are founder-blocked today (CLAUDE.md: keys blank); both modules degrade loudly with `missing_key` on every real call. ICO has **no free real-time JSON API at all** — the port source queries a Neon mirror of a weekly CSV via direct SQL, which this fetch-only evidence layer cannot call without smuggling in an undeclared dependency; `ico.js` exposes a `keys.ico` mirror-endpoint seam and degrades loudly (`missing_endpoint`) until one exists.

### Verification

`npm test` (546/546 pass, repo-wide), `npm run lint` (clean), `npm run calibrate` (`--strict`, all 10 existing calibrations pass), `npm run circular` and `npm run depcruise` (no cycles/orphans), and `tools/one-door/check.js`, `tools/swallow-gate/check.js`, `tools/health-gate/check.js` run individually with zero findings under `evidence/registers/`. `node evidence/registers/registers.js --calibrate` correctly emits one finding per shipped fixture.

### Open risks / honest gaps

1. **`eval/calibration-known-bad/run.js`'s `CALIBRATIONS` registry is not wired to my fixtures** — that file is outside my ownership boundary (likely intentionally, to avoid parallel-agent collisions on a shared file across Wave-1). The entry needed, matching the existing `identity-marketing-headline` pattern:
   ```js
   {
     name: 'register-nonmatch-rejected',
     description: 'a non-empty HTTP-200 register response that is not a real name match must yield no row (C-004)',
     fixtures: ['p3-register-http200-nonmatch.json', 'p3-register-multi-register-nonmatch.json'],
     checkerCandidates: ['evidence/registers/registers.js'],
   }
   ```
2. **jscpd flags two clones** touching my files: an 8-line structural echo between `cqc.test.js`/`fca.test.js` (idiomatic parallel test shape, harmless) and an 11-line echo between `facts/identity.js`'s suffix-strip builder and my `lib/name-match.js` (same algorithm over the same one-door word list; I couldn't edit `facts/identity.js` to extract a shared helper without exceeding scope). Neither is an ACT-class finding (jscpd alone, no second tool corroborating).
3. **Companies House registered-office address is not populated** — the search endpoint doesn't return it; a follow-up profile fetch would be needed (noted in the module header as a future strengthening, matching the port source's own search-only scope).
4. The overall repo `tools/sweep/run.js` reports RED, but only from other parallel builders' files (`evidence/crawler/extract.js`, `evidence/documents/documents.js`, `tools/lib/safe-fetch.js`) — nothing under `evidence/registers/`.
