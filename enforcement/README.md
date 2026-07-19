# enforcement/ - the enforcement-mining pipeline

Workstream WS-Enforcement (KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md, B4 Discipline 2 + B5 + P1-21 +
resource table C, "Enforcement corpora" row). Collectors + a normalised `EnforcementAction` store +
derived violation-lexicon and penalty-precedent outputs, mined from what regulators have actually
punished rather than authored from statute prose.

## Scope (what this workstream does and does not do)

This workstream PRODUCES artefacts. It does not wire anything into the live mint path
(`applicability/connect.js`, `breach/`, `payload/`, `mint/`) - that is later work, dependent on the
detector registry (WS0). Nothing here is imported by any module outside `enforcement/`.

**No LLM ever writes to the store.** `grep -rn "require.*llm" enforcement/` returns nothing. An LLM
may only ever be used, in a future session, to PROPOSE additional lexicon candidates for a human or
agent to review and fold in by hand (editing a collector's regex or the seed store directly) - never
to write a row or a phrase.

## Layout

```
enforcement/
  store/
    schema.js        the EnforcementAction row shape + assertValidRow/isValidRow (fail-closed)
    store.js          NDJSON load/append/write, validated on every read and write
  collectors/
    lib/
      fetcher.js       deadline-wrapped fetch + sha256 hashing (reuses evidence/registers/lib/deadline.js)
      framework.js     shared fetch -> parse -> validate orchestration every source module uses
      text.js          dependency-free HTML-to-text stripper + verbatim-quote/entity extraction helpers
    asa.js / ico.js / cnil.js / ftc.js / ocr.js / gdprhub.js   one parser per source
    fixtures/<source>/  saved real fetched pages (ASA/ICO/CNIL/FTC) or clearly-labelled synthetic
                         structural fixtures (OCR/GDPRhub - see below)
  data/
    enforcement-actions.ndjson   the committed seed store (real fetched+hashed rows only)
  derive/
    lexicon.js         violation-lexicon proposals per law_id (out/lexicon-proposals/<law_id>.json)
    precedent.js        penalty precedent ranges per law_id/currency (out/precedent-ranges.json)
```

## Sources and live-fetch status (2026-07-20 session)

| Source | Status | Seeded rows | Notes |
|---|---|---|---|
| ASA (UK ad rulings) | live-fetched | 5 | Verbatim offending ad quotes; POM/misleading-price/greenwashing coverage |
| ICO (UK data protection) | live-fetched | 5 | Exact monetary penalties, UK GDPR articles / PECR regulations |
| CNIL (France) | live-fetched | 2 | English-language `/en/` articles only; two article shapes handled (single-entity, combined multi-entity) |
| FTC (US) | live-fetched | 1 | Listing pages (`/press-releases`) return 403 to every fetch method tried; individual article pages fetch fine |
| OCR (HHS, US HIPAA) | **blocked** | 0 | hhs.gov returns HTTP 403 to every request this session, including a realistic UA and a Wayback Machine lookup. Parser built and tested against a clearly-labelled SYNTHETIC fixture; no row seeded. |
| GDPRhub (noyb) | **blocked** | 0 | gdprhub.eu serves an Anubis proof-of-work anti-bot challenge (requires JS execution) to every request. Parser built and tested against a clearly-labelled SYNTHETIC fixture; no row seeded. |

ICO and ASA listing/archive pages (`ico.org.uk/action-weve-taken/enforcement/`,
`ftc.gov/news-events/news/press-releases`) also 403 under the `WebFetch` tool specifically; a plain
`curl` with a realistic browser `User-Agent` succeeded for every individually-named article page used
here. This is recorded honestly rather than worked around silently: `collect()`'s default
`ARCHIVE_URL` targets the listing page for future expansion, but every row in the committed seed
store was collected by pointing the collector at a specific, known article URL.

13 rows are seeded, spanning 4 sources (ASA, ICO, CNIL, FTC), each with a real `url` + `sha256`
matching a fixture committed in `collectors/fixtures/`.

## Running the collectors and derived outputs

```
node -e "require('./enforcement/collectors/asa').collect().then(r => console.log(JSON.stringify(r, null, 2)))"   # live collect (network)
node enforcement/derive/lexicon.js     # writes enforcement/derive/out/lexicon-proposals/<law_id>.json
node enforcement/derive/precedent.js   # writes enforcement/derive/out/precedent-ranges.json
```

`derive/out/` is gitignored (deterministically regenerable from the committed store).

## Extending the seed store

Run a collector's `collect()` against a live or fixture-backed `fetchImpl`, then
`enforcement/store/store.js`'s `appendRow`/`writeStore` to add validated rows. Every row must pass
`enforcement/store/schema.js`'s `assertValidRow` before it can enter the committed file.
