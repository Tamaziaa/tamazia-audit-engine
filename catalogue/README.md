# catalogue/ - the Compliance Object Model, its gates, and the compiled artifact

The catalogue is the ONLY source of law names, citations, fines, penalty bands, regulators and
enforcement intel anywhere in this engine (Constitution Rule 2). Nothing in `breach/`, `render-proof/`,
or any future renderer holds a law fact of its own; every fact a client sees traces back to exactly
one row in this directory's compiled artifact. This file documents the record model, the four gates
every row must clear, how a pack graduates into that artifact, and how a shipped row later activates
into something the mint can actually attach to a live audit.

---

## 1. The record model (the Compliance Object Model, "COM")

A **pack** is one JSON file under `catalogue/packs/<cell>.json`:

```jsonc
{
  "cell": "uk-legal",          // matches the filename (schema-enforced)
  "jurisdiction": "UK",        // a facts/vocabulary.js jurisdiction code
  "generated": "2026-07-17",   // YYYY-MM-DD, the pack AUTHORING date (not a build stamp)
  "records": [ /* COM record, COM record, ... */ ]
}
```

A **record** is one law/rule/duty. The full required shape is enforced by `catalogue/schema.js`
(`validateRecord`/`validatePack` - the one door for record/pack SHAPE, per Constitution Rule 1) and
is not repeated field-by-field here; read `schema.js`'s own header for the exact contract and the
scope decisions behind it (why `sector` accepts a `'universal'` sentinel, why `sub_sector` is
type-checked but not enum-checked, why `sub_jurisdiction` accepts `null`/`'multi'`/a modelled code).
In outline, a record carries:

- **Identity**: `id` (upper-snake), `name`, `jurisdiction`, `sub_jurisdiction`.
- **Attachment surface**: `sector[]`, `sub_sector[]`, `activity_tags[]`, `required_nexus[]`,
  `applies_when[]`, `excluded_when[]` (Constitution Rule 13: a jurisdiction/law attaches on
  evidence, never on "serves a market").
- **The duty**: `website_obligations[]`, each `{duty, elements[], evidence_type}` where
  `evidence_type` is one of `presence` / `absence` / `behavioural` / `register` (see §3 below - this
  is the field the polarity linter reads).
- **Money**: `penalty {typical_low, typical_high, statutory_max, currency, basis, max_is_rare}`
  (Constitution Rule 2/14: no code file anywhere else may hold a fine figure).
- **Who enforces it**: `regulator {name, register_url}`, `enforcement[]` (real cases, each with
  `case, date, amount, url, summary`).
- **Why it matters to the client**: `intel {why_matters, regulator_asks_first, relevance_hook}`.
- **Provenance** (Constitution Rule 14, mandatory on every row): `provenance {sources[],
  seed_status, verified_date}`.
- **Lifecycle**: `status` - one of `candidate` / `needs_verification` / `rejected_qa` (see §4).
- **Citation**: `citation {act, section, url}` - the URL is checked against an allowlist of genuine
  statutory/regulatory/court hosts (`catalogue/linters/citation-completeness.js`'s `OFFICIAL_HOSTS`),
  strictly for any `status: "candidate"` row.

---

## 2. The QA-sidecar rule (a pack is compilable only with a human sign-off)

`catalogue/compile.js` reads every `catalogue/packs/*.json` file, but only ever COMPILES a pack that
has a same-named `.QA.md` sidecar sitting next to it:

```
catalogue/packs/uk-legal.json      <- authored pack
catalogue/packs/uk-legal.QA.md     <- the human legal-QA sign-off for THAT pack
```

A pack with no sidecar is **excluded** from compilation with a loud log line
(`pack excluded: no legal-QA sidecar - ...`) - not a warning, not a soft partial-include. At the
time this compiler was built, `catalogue/packs/uk-tech-media-industrial.json` has no sidecar and is
therefore excluded; none of its records can reach the compiled artifact until its own `.QA.md` lands.

The sidecar is not a rubber stamp - read any of the six existing ones
(`catalogue/packs/*.QA.md`) and you will find the actual method every reviewer used: independent
fetches of the highest-penalty and every `gap_filled` citation against primary sources
(legislation.gov.uk, ftc.gov, oag.ca.gov, federalregister.gov, regulator sites), a polarity red-team
pass, a fines/currency sanity pass, and per-record verdicts (`confirmed` / `corrected` /
`downgraded to rejected_qa` / `CRITICAL`). This is the human step Constitution Rule 14 exists to
force: "promotion of legal judgements is human-gated." The compiler does not, and cannot, replace it
- it only refuses to ship anything that skipped it.

---

## 3. The linter fleet (what runs on every compilable pack, every time)

Four linters, each with its own doctrine documented in its own file header - this section is a map,
not a duplicate of that documentation:

| Linter | Catches | Blocking rule id(s) | Warning rule id(s) |
|---|---|---|---|
| `catalogue/linters/citation-completeness.js` | Rule 14/C-104: a `candidate` row's `citation.url` on a non-official host; missing `provenance.sources`; missing `penalty.currency`/`basis`; an `enforcement[]` entry with no `url`/`date` | `citation-missing`, `citation-host-unofficial`, `provenance-sources-empty`, `penalty-currency-missing`, `penalty-basis-missing`, `enforcement-url-missing`, `enforcement-date-missing`, `enforcement-host-unofficial`, `register-host-unofficial` | *(none - every rule id above is emitted at `level: 'error'`; see §6 on why this compiler takes that literally)* |
| `catalogue/linters/polarity.js` | C-046/047/048: a duty containing PROHIBITION language typed anything other than `evidence_type: 'absence'`; REQUIREMENT language typed anything other than `presence`/`register` | `polarity-prohibition-mismatch`, `polarity-requirement-mismatch` | `negation-guard-needed` (an `absence` duty whose text also carries self-declaration wording - the Botox-U18 class, C-048/C-060: a naive presence-check risks matching the site's OWN compliant statement) |
| `catalogue/linters/regex-health.js` | C-050: a `pattern`/`regex`/`detect`/etc. field that does not compile, has no `positive_example`, or does not match its own `positive_example` (the over-escaped dead-regex class) | `regex-health/pattern-does-not-compile`, `regex-no-positive-example`, `regex-dead-pattern` | *(none)* - and it honestly reports "0 patterns" when a pack carries none, which is the current, correct state for every COM pack today (duties are prose, not regex, until a future detection migration) |
| `catalogue/linters/threshold-guard.js` | C-071: a size/turnover-threshold-bearing record with an empty `excluded_when` (the Modern Slavery Act-on-an-SME class); C-096: a `statutory_max` with no modelled typical band | `threshold-excluded-when-missing` | `typical-band-missing` |

### Polarity semantics, restated (read `polarity.js`'s own header for the full doctrine)

`evidence_type` describes **what the check looks for on the client's site**, not what the law
requires in the abstract: `presence` fires when required content is MISSING; `absence` fires when
prohibited content IS PRESENT; `register` is a presence-family check against a register row rather
than page text; `behavioural` is exempt from polarity-language checks entirely, because an observed
action can legitimately be phrased either way depending on what actually fired the check. Getting
this backwards is exactly the DG-02 defect (C-048): a `must_appear` rule that fired on the ABSENCE
of a boastful phrase, breaching firms for things they did NOT say.

### `catalogue/linters/lib.js`

Not a linter itself - the shared pack/fixture loader every linter above calls (`loadRecords`,
`resolveJsonFiles`, `hostMatchesAllowlist`). One door for "how a linter finds its input and what
shape a record is in", so four linters do not grow four slightly different loaders.

---

## 4. Record lifecycle: `status`

| `status` | Meaning | Ships in the compiled artifact? |
|---|---|---|
| `candidate` | Authored, passed the pack's own `.QA.md` legal-QA pass, passed every linter | **Yes** |
| `needs_verification` | A specific fact inside the record could not be confirmed at authoring time | **No** - stays in the source pack (visible, logged), excluded from `catalogue.v1.json` |
| `rejected_qa` | The pack's own QA reviewer downgraded this record (unverifiable, wrong statute, or worse) | **No** - stays in the source pack, excluded |

`catalogue/compile.js` enforces the "No / No" column: a record is filtered OUT of `records[]` at
assembly time if its `status` is `needs_verification` or `rejected_qa`, and the compiler logs every
such exclusion by id, cell and status so nothing disappears silently. It is NOT deleted from the
pack file - the record stays exactly where its author and QA reviewer put it, in case a later pass
resolves the open question and promotes it.

94 of the 95 records across the six QA'd packs are `candidate`; one, `US_STATE_PRIVACY_WAVE_2025_26`
(us-universal), is `needs_verification` - an aggregate multi-state overview cannot carry one
official citation, so it is excluded from the artifact until a future pass splits it into per-state
records each with its own official citation (see the record's own `qa_note`). None is `rejected_qa`.
The exclusion path exists, is exercised by this one real record, and is tested
(`catalogue/compile.test.js`).

**`candidate` is not "active."** Shipping in `catalogue.v1.json` means a row is available to be
read by the P3+ attachment/breach pipeline once it exists; it is P3+'s own human-sign-off gate
(outside this compiler's scope) that promotes a compiled `candidate` row into something the mint
actually attaches to a live audit. This compiler's job stops at "compiled, gated, deterministic
artifact" - it activates nothing.

---

## 5. How a pack graduates (the whole path, start to artifact)

```
  author writes catalogue/packs/<cell>.json
              |
              v
  a human runs an independent legal-QA pass and writes catalogue/packs/<cell>.QA.md
  (fetches primary sources, red-teams polarity, sanity-checks fines, downgrades what fails)
              |
              v
  catalogue/compile.js discovers the pack: sidecar present -> COMPILABLE
  (no sidecar -> EXCLUDED, loud log line, stops here)
              |
              v
  catalogue/schema.js validatePack() - shape gate (Rule 1)
              |
              v
  the linter fleet (citation-completeness, polarity, regex-health, threshold-guard) - content gate
              |
              v
  ANY error-severity finding -> compilation REFUSED (exit 1). No artifact written.
  This compiler never edits a pack or waters down a linter to force a pass (see catalogue/README.md
  and the compiler's own header) - a real finding on real content is reported verbatim and the run
  stops so a human can fix the SOURCE (the pack, or its QA sidecar).
              |
              v   (zero errors)
  assemble: drop rejected_qa/needs_verification records, sort deterministically, hash
              |
              v
  catalogue/dist/catalogue.v1.json written (gitignored - always regenerated, never committed)
```

---

## 6. What a real finding means (do not water this down)

If `node catalogue/compile.js --stamp <...>` reports an error-severity finding against a REAL,
already-QA'd pack, that is not a bug in the compiler to route around - it is either:

1. A defect the pack's own `.QA.md` pass did not catch (fix the pack, get it re-QA'd), or
2. A defect in the `.QA.md` sign-off itself (the sidecar claims a clean pass over content a linter
   can now catch that it could not before), or
3. A linter being stricter than the sidecar anticipated (the sidecar predates this linter fleet
   landing) - in which case the right fix is still to correct the SOURCE pack, never to loosen the
   linter or special-case a rule id inside this compiler.

At the time this compiler was built, running it against the real packs surfaced exactly this class
of finding on four records in `us-healthcare.json`/`us-universal.json` - unofficial-host
`enforcement[].url`/`regulator.register_url` entries, an uncitable aggregate `citation.url`, and one
`sub_sector` value using an underscore instead of the required hyphen-slug format - reported
verbatim by `compile.js`, exactly as designed. A subsequent P2 catalogue-hygiene pass fixed the
SOURCE, never the gate: the two unofficial enforcement entries were removed (their URLs preserved in
`provenance.sources`), the unofficial `register_url` was set to `null`, the uncitable aggregate
record was downgraded to `needs_verification` (with a `qa_note` explaining why), and the `sub_sector`
slug was corrected. The real packs now compile with zero error-severity findings (two
`typical-band-missing` warnings remain, which is the honest, expected state for a bare statutory
ceiling with no gathered typical-enforcement band). This history stays here as a worked example of
what a real finding means and how it is properly resolved - fix the pack, never the gate.

---

## 7. Compile determinism

`node catalogue/compile.js --stamp <ISO8601> [--out <path>]`:

- `--stamp` is REQUIRED and must match `YYYY-MM-DDTHH:MM:SS(.sss)Z`. There is no `Date.now()`
  fallback anywhere in this file - an artifact's `generated` field must be exactly reproducible from
  the same pack inputs and the same stamp, forever (the same doctrine as Constitution Rule 15
  applied to a build artifact rather than a live scan).
- `cells[]` and `records[]` are sorted deterministically (`cell` name, `id` respectively) so two
  runs over identical inputs produce byte-identical JSON.
- `content_hash` is `sha256` of the artifact's own canonical JSON (recursively key-sorted) with the
  `content_hash` field itself excluded from what gets hashed - hashing the hash's own container
  would make the hash unreproducible by definition, so `content_hash` is computed over
  `{catalogue_version, generated, cells, counts, records}` and then attached.
- `catalogue/dist/` is gitignored: the artifact is always a build output, never a committed file.

Output shape (`catalogue/dist/catalogue.v1.json`):

```jsonc
{
  "catalogue_version": "v1.0.0-p2",
  "generated": "2026-01-01T00:00:00Z",   // the --stamp value, verbatim
  "content_hash": "<sha256 hex>",
  "cells": [
    { "cell": "uk-legal", "jurisdiction": "UK", "pack_generated": "2026-07-17",
      "source": "catalogue/packs/uk-legal.json",
      "records_total": 12, "records_included": 12, "records_excluded": 0 }
    // ...
  ],
  "counts": {
    "packs_scanned": 7, "packs_compilable": 6, "packs_excluded": 1,
    "packs_excluded_detail": [ { "cell": "uk-tech-media-industrial", "source": "...", "reason": "no legal-QA sidecar" } ],
    "records_scanned": 95, "records_included": 94, "records_excluded": 1,
    "records_excluded_by_status": { "needs_verification": 1 }
  },
  "records": [ /* every included COM record, plus a "cell" field naming its source pack */ ]
}
```

---

## 8. Files in this directory

| File | Role |
|---|---|
| `schema.js` (+`.test.js`) | The Compliance Object Model shape validator - `validateRecord`/`validatePack`. One door for record/pack shape. |
| `linters/lib.js` | Shared pack/fixture loader for the linter fleet. |
| `linters/citation-completeness.js` (+`.test.js`) | Rule 14/C-104 provenance + official-host citation gate. |
| `linters/polarity.js` (+`.test.js`) | C-046/047/048 polarity doctrine + negation-guard warning. |
| `linters/regex-health.js` (+`.test.js`) | C-050 earn-your-zero regex gate. |
| `linters/threshold-guard.js` (+`.test.js`) | C-071 threshold/`excluded_when` gate + C-096 typical-band warning. |
| `compile.js` (+`.test.js`) | The compiler documented in this README: packs -> gated -> `catalogue/dist/catalogue.v1.json`. |
| `packs/*.json` + `*.QA.md` | The authored packs and their human legal-QA sign-offs. |
| `dist/` | Compiler OUTPUT. Gitignored. Never hand-edited, never committed. |

Related, outside this directory: `facts/vocabulary.js` (the enum door every schema/linter check
delegates to - `jurisdiction`, `sector`, `activity_tags`, `required_nexus` all validate through it,
never a parallel list in `catalogue/`), `eval/calibration-known-bad/run.js` (wires
`catalogue-citation-completeness`, `catalogue-polarity`, `catalogue-regex-health` and
`catalogue-threshold-guard` into the repo-wide earn-your-zero gate against the `p2-*.json` fixtures
in `eval/calibration-known-bad/fixtures/`), `facts/served-cells.json` (the ICP gate dataset -
separate from, and downstream of, which catalogue cells exist: a cell can be compiled here and still
not be `served: true` there until the ICP gate is updated).
