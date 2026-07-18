# evidence/registers/ — binary register rows (P3 Wave 1b)

Supplies the pre-fetched `EvidenceBundle.registers` object described in `facts/README.md`:
`{ companiesHouse?, gleif?, sra?, cqc?, fca?, ico?, notes:[...] }`. facts/identity.js,
facts/jurisdiction.js and facts/sector.js stay pure consumers of this bundle (Constitution Rule 1);
this directory produces no client-facing fact itself.

## Binary semantics (C-004)

A register key is present on the bundle **only** when the register answered with a candidate that
clears a real name match against the query (`evidence/registers/lib/name-match.js`, Jaccard token
overlap, threshold 0.6 — see that module's header for the full justification and the
"Kingsley Napley LLP" vs "Kingsley Carpets Ltd" rejection case). A non-empty, HTTP-200 API response
that is not a name match, a missing API key, a timeout, or any fetch error all resolve to the SAME
outcome: the field is absent from the bundle, and a loud entry is pushed onto `bundle.notes[]`
explaining why (`kind`: `skipped` | `degraded` | `no_match`). Nothing is ever fabricated or
partially filled in.

## Provenance (C-005)

Every returned row carries `{source, fetched_at, query, match:{name_queried, name_matched, score}}`,
stamped in exactly one place (`lib/lookup-runner.js`'s `judgeOutcome`), never by the submodule that
built the row's register-specific fields. Only the register that actually established the match
stamps its own provenance; there is no shared or merged provenance across registers.

## Dependency injection and deadlines (Rule 9)

Every register module is a pure function of its inputs plus one injected `fetchFn(url, options)`.
No module ever imports `https`/`fetch` directly; every call is routed through
`lib/deadline.js`'s `withDeadline()`, which never rejects and never hangs — a slow or absent
dependency degrades to a `notes[]` entry, it never blocks `fetchRegisters()`. Keys are read only from
an injected `keys` object (`keys.companiesHouse`, `keys.cqc = {apiKey, partnerCode}`,
`keys.fca = {email, key}`, `keys.sra`, `keys.ico`); no module reads `process.env` directly.

## Registers in this directory

| Module | Register | Key required | Applicability gate |
|---|---|---|---|
| `companies-house.js` | UK Companies House search | `keys.companiesHouse` (free self-service) | UK only |
| `gleif.js` | Global LEI Index (GLEIF) | none (public) | worldwide, always attempted |
| `sra.js` | SRA Data Sharing Platform | none (public organisation search) | law-firms/barristers, or unspecified |
| `cqc.js` | CQC provider register | `keys.cqc.apiKey` + `keys.cqc.partnerCode` | health family, or unspecified |
| `fca.js` | FCA Financial Services Register | `keys.fca.email` + `keys.fca.key` | finance family, or unspecified |
| `ico.js` | ICO Register of Data Controllers | `keys.ico` (mirror endpoint URL) | UK only |

**CQC and FCA are founder-blocked in this estate today** (CLAUDE.md: `CQC_API_KEY`/
`CQC_PARTNER_CODE` and `FCA_API_EMAIL`/`FCA_API_KEY` are blank pending developer-portal
registration). Both modules degrade loudly with a `missing_key` note on every real call until those
keys land; this is expected and reported honestly, not a bug in either module.

**ICO has no free real-time JSON search API** at all today (the port source mirrors the ICO's weekly
CSV download into a database and queries it directly with SQL). Since this evidence layer is
fetch-only and dependency-injected, `ico.js` exposes a `keys.ico` seam for a small JSON-serving
mirror of that same dataset; until one is configured, this lookup also degrades loudly
(`missing_endpoint`). Whether a firm is or is not on the ICO register is therefore currently
**unknowable** to this evidence layer in production, and no absence is ever asserted without it —
that determination stays correctly deferred rather than guessed.

## Orchestration

`registers.js` exports `fetchRegisters(identityHints, {fetchFn, deadlineMs, keys, log})`.
`identityHints` is `{domain, company?, country?, sector?}`. The company-name query prefers
`identityHints.company`; absent that, it falls back to a minimal, local domain-stem seed (never the
identity fact itself — facts/identity.js remains the one door for that). GLEIF always runs; the
other five run only when the country hint is absent, `UK` or `GB` (a register hit is itself Tier-A
jurisdiction evidence, so withholding the UK registers pending jurisdiction resolution would be
circular). All applicable lookups run in parallel (`Promise.all`), each independently
deadline-bound, so wall time is capped by the slowest single call, not their sum.

## Calibration

`node evidence/registers/registers.js --calibrate [--json <path>]` replays every
`eval/calibration-known-bad/fixtures/p3-register-*.json` fixture (each plants a non-empty, HTTP-200
response that is *not* a name match) and emits a finding only when the poison was correctly refused
— the same dialect `eval/calibration-known-bad/run.js` already drives for `facts/identity.js`. **This
calibration is not yet wired into that runner's `CALIBRATIONS` registry** (out of this module's
ownership boundary for this wave); see the build report for the exact entry to add.

*Not legal advice. This describes the engine's evidence layer, not the law.*
