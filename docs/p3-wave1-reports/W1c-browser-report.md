# P3 Wave-1c — evidence/browser/ PECR pre-consent lane — builder final report (verbatim)

Agent: module-builder (opus), task-id a474c9ca1b22d0fb1. Completed 2026-07-18. Saved verbatim, unedited.

---

Everything is green. Here is my report.

## P3 Wave-1c — PECR pre-consent browser observation lane — DONE

### Files delivered (all absolute paths)

Production (`evidence/browser/`):
- `/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine/evidence/browser/observe.js` (355 lines) — the lane orchestrator: `observe(url, opts)`.
- `/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine/evidence/browser/deadline.js` (50) — the one hard `Promise.race` deadline primitive (Rule 9 / C-040).
- `/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine/evidence/browser/oracle.js` (166) — licence-clean tracker-host + cookie classifier (C-043).
- `/Users/amanigga/Desktop/TAMAZIA-REBUILD/tamazia-audit-engine/evidence/browser/playwright-adapter.js` (120) — the lazy, optional real-Playwright adapter; the only file naming Playwright, required lazily inside a function.

Tests (same folders):
- `observe.test.js` (194), `oracle.test.js` (104), `deadline.test.js` (63) — 36 tests, all fake/injection-driven, zero real Chromium/network.

Calibration fixtures:
- `eval/calibration-known-bad/fixtures/p3-browser-deadline.js` (86) — the required C-040 hanging-browser fixture.
- `eval/calibration-known-bad/fixtures/p3-browser-preconsent-breach.js` (85) — a second fixture calibrating the C-039 detector (planted `_ga` + GA request caught, session cookie not).

### Output contract (spec §1c)
`observe()` returns `{ observed[], consentControl:{found,healthy,url}, lane:{ran,reason,...,oracle:{source,licence}} }`. Each `observed` entry: `{ kind, name, host, essential, networkEvent, artifact, ts }`, `kind ∈ {cookie_pre_consent, tracker_request_pre_consent, consent_control_broken}`. I kept the committed spec field `networkEvent` AND added an always-present `artifact` object so Rule 3 holds even when a cookie has no matching request (a jar-entry artifact); the two reconcile rather than compete.

### Fake-browser test architecture
`observe()` takes an injected `launchBrowser` factory returning a browser conforming to a small contract (`newPage / on('request') / goto / settle / cookies / findConsentControl / clickConsent / close`). `makeFake({...})` in `observe.test.js` scripts pre/post cookies, on-load and post-click tracker requests, a consent control, and can `hang` on launch or goto. A `rec` object records what the fake was asked to do (e.g. `closed`). The real adapter maps Playwright onto the same contract, so production and tests drive identical logic; no Chromium in CI. `fetchLink` (link-health) and `now` (clock) are injected too.

### Deadline proof (the 752s class)
ONE outer `raceWithDeadline` wraps `runObservation` (launch→observe→close); on timeout the lane returns `{ran:false, reason:'deadline', elapsedMs}` and a `finally` force-closes the held browser under its own `closeMs` cap. Total time ≤ `deadlineMs + closeMs`, both caps (no `Math.max` floors). Proven by: `observe.test.js` "a hanging goto…" (30ms deadline, asserts wall-time < 2000ms and the fake was force-closed) and "a hanging LAUNCH…"; `deadline.test.js` structural-proof test; and `p3-browser-deadline.js`, which races `observe()` against a wall-clock guard so a regression that re-hangs is reported as a MISS, never an actual hang.

### Oracle licence decision (C-043)
The port read `data/tracker-oracle.json`, whose own `sources` block declared: tracker hosts from **EasyPrivacy** licensed **"CC BY-SA 3.0"** (ShareAlike / copyleft, ~50,079 hosts), and cookie purposes from the **jkwakman Open Cookie Database** licensed **Apache-2.0** (~2,239 cookies). Neither is one of C-043's explicitly-named NonCommercial sources (DuckDuckGo Tracker Radar / Ghostery / cookiedatabase.org), so the port was not shipping an NC dataset — but EasyPrivacy's CC BY-SA ShareAlike limb is copyleft and unsafe to redistribute verbatim inside a proprietary, paid product in a public repo. Rather than adjudicate that limb, **I bundled no third-party dataset at all**: `oracle.js` authors a minimal list fresh from first-hand knowledge (well-known tracker registrable domains + vendor-published cookie-name patterns), deliberately conservative to avoid false positives, abstention-first (unknown cookie → not flagged). `lane.oracle = { source:'tamazia-authored (evidence/browser/oracle.js)', licence:'own-authored (no third-party dataset bundled)' }`, and an oracle test asserts no NC/AGPL/ShareAlike/known-NC-source token appears in the runtime provenance values.

### Other decisions
- **One-door (Rule 1):** host parsing routes through the single door `tools/lib/safe-fetch.js` (`hostOf`); I removed a local `hostOf` that the one-door gate correctly flagged as a second HOST producer.
- **Rule 16:** cookie `value` is never stored in any artifact (name/domain/expiry only); a test asserts no value string appears anywhere in the bundle.
- **Rule 4:** every catch rethrows, records via `console.error`, or carries a literal `FAIL-OPEN:` justification; the missing-driver path logs loudly and records `lane:{ran:false, reason:'playwright-unavailable'}`.

### Exit codes / gate evidence
- `npm test`: **546 pass, 0 fail** (36 mine).
- `npm run calibrate` (--strict): **OK — every gate caught its fixture**.
- Both new fixtures standalone: exit 0 (traps caught).
- Lint: clean. Circular: none. Depcruise: no violations (109 modules). jscpd: 0 clones in `evidence/browser`, 0.19% repo-wide.
- health-gate / swallow-gate / one-door / host-parse / secret-shape grep: **zero findings in my files**.
- Full sweep: **ACT 0** (the blocking gate is green). All 8 REVIEW leads are single-tool and in other waves' files, none in `evidence/browser/**`.

### Open risks / honest gaps (all outside my ownership boundary)
1. **GAPS.md `evidence-lane-silent` row not flipped.** My gate file (`evidence/browser/observe.js`) is now real and guards the class, but I was scoped out of editing `GAPS.md`. Handoff: flip that row to guarded.
2. **`p3-browser-deadline` not registered in the `--strict` CALIBRATIONS registry.** `eval/calibration-known-bad/run.js` is outside my ownership, so the fixture is self-driving (standalone + node:test) and register-ready via an internal entry, but not yet wired into `run.js`. Handoff to the runner/tools owner. `--strict` stays green because unregistered fixtures are ignored by the runner.
3. **Sweep REVIEW leads in sibling wave-1a files** (`evidence/crawler/crawl.js`, `evidence/crawler/extract.js` one-door; `evidence/documents/documents.js`, `tools/lib/safe-fetch.js:93/160` swallow-gate). Single-tool leads (ACT 0), owned by the crawler/documents/safe-fetch builder — I depend on `safe-fetch.js` but did not modify it.
4. **The real Playwright adapter is not exercised in CI by design** (no Chromium install). Its DOM/consent heuristics are best-effort and untested against live sites; the mint wiring (opts → observe) lands with `mint/` in P4. Reachability is currently dormant (no `mint/` entrypoint yet), so `DORMANT.md` did not need my modules listed; when `mint/` lands, `observe()` must be wired in or listed there.

---

# W1a crawler+coverage — PARTIAL (session-limit cut, ~3:40am 2026-07-18)

Agent task-id a641e90c83b50e5df (opus) FAILED on session limit mid-verification. Last message before cut, verbatim: "Core behaviours pass. Now let me verify the E-236 Tier-1-first-before-cap ordering, the pool deadline-as-cap, and the documents PDF no-parser interlock."

Disk state at cut (all files present, captured in checkpoint commits): evidence/crawler/{crawl,discover,extract,pool,coverage-contract}.js, evidence/documents/documents.js, tools/domain-gates/{budget-caps,host-parse}.js, tools/lib/safe-fetch.js, modified eval/reference-set/build-fixtures-lib.js (door promotion), fixtures p3-crawl-* (check which of the 4 planned landed). Known leads from sibling reports: one-door REVIEW leads in crawl.js + extract.js; swallow-gate leads at safe-fetch.js:93/160; W1c removed its local hostOf to route via safe-fetch hostOf. Salvage doctrine C-204 applies: inventory, read-and-complete, do not rewrite. Full raw transcript: docs/p3-wave1-reports/transcripts/W1a-transcript.jsonl.
