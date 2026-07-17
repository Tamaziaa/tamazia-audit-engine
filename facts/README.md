# facts/ — the one-door fact layer

Every client-facing fact has exactly ONE producer here (Constitution Rule 1). A consumer reads
the fact; it never re-derives it. Each module is a **pure, synchronous function over an
`EvidenceBundle`**: it never touches the network, a clock, or the environment, and it never
guesses. Register rows arrive pre-fetched on the bundle; page text arrives pre-stripped. The
producers are `identity.js`, `jurisdiction.js`, `sector.js`, `capabilities.js`, and the shared
token door `vocabulary.js`.

## The EvidenceBundle (input)

```
{
  domain: 'example.co.uk',
  corpus: {
    pages: [{ url, title, text, jsonLd: [...], ogSiteName? }],   // text = stripped visible text
    footerText?: '...'                                            // statutory disclosure block
  },
  registers: { companiesHouse?, gleif?, sra?, cqc?, fca?, ico? }  // pre-fetched rows, may be {}
}
```

`text` is stripped visible text only (caution C-012): no `<script>`/`<style>`, and sector scoring
never reads `title`, `ogSiteName` or `jsonLd` (those are identity signals). An unreachable bundle
(bot-walled or an unrendered SPA shell) carries no readable corpus; the tolerant doors abstain
across the board on it rather than inventing.

## The confidence ladder (every fact grades on it)

`register > corroborated > weak > abstain` (`vocabulary.CONFIDENCE_LEVELS`).

- **register** — a register row (or an authorisation statement with a number) backs the fact.
- **corroborated** — two or more independent on-page sources agree (or an on-site Tier-A signal).
- **weak** — a single unrivalled source; attaches, but never more than weakly.
- **abstain** — nothing safe. A `null`/omitted fact is a first-class, correct outcome.

**Doctrine: match or abstain, never contradict.** A missing field is fine; a wrong one ends the
company. Ambiguity always defaults to withholding, never to a default value. `eval/reference-set/
run-facts.js` enforces this against hand-verified firms: MATCH and ABSTAIN pass, CONTRADICT fails.

## vocabulary.js — the shared token door

The ONE producer of the non-legal token vocabularies the facts layer reads: the canonical sector
`TREE`/`SECTORS` (+ `SECTOR_ALIASES`, `CANONICAL_SECTORS`, `SUB_EXCLUSIVE`, `DOMAIN_SELF_IDENTITY`),
the jurisdiction sets (`JURISDICTIONS`, `SUB_JURISDICTIONS`, `COUNTRY_TOKENS`, `FAMILY_ALIAS`,
`AE_FEDERAL_DP_TOKEN`), `NEXUS_TYPES`, `ACTIVITY_TAGS`, and the grading enums (`CONFIDENCE_LEVELS`,
`FINDING_STATES`). Validators: `canonicalSector`, `famCanon`, `isCanonicalSector`, `isJurisdiction`,
`isActivityTag`, `sectorSelfIdFromDomain`, and `assertVocab(kind, value)` which **fails closed**
(throws on an unknown kind or value; Rule 4). Everything exported is deep-frozen. It holds **NO**
law names, citations, fines or regulator strings (Rule 2); those are catalogue-owned. Every detect
regex is word-boundary anchored on every alternation (C-059) and ships a known-positive sample
proven by `vocabulary.test.js` (the C-050 dead-regex guard).

## identity.js — `resolveIdentity(bundle)`

Sole producer of `display_name`, `legal_name`, `company_number`, `registered_office`, `slug`.
Returns `{ fact:'identity', domain, display_name, legal_name, company_number, registered_office,
slug, rejected, notes, vocabulary_source }` where each fact field is an envelope
`{ value, confidence, evidence[] }`. The ladder, highest first: (1) Companies House row corroborated
by an on-page identifier, (2) schema.org Organization/LegalService name, (3) `ogSiteName`,
(4) footer identity block, (5) `<title>` split on the site separator with marketing tails removed,
(6) domain stem (always-clean last resort, `weak`). Rejected candidates fall through and never
poison the result: generic page furniture, headlines over 6 words, HTML-entity residue (the
`amp`/`x27` slug class, C-003), and strings sharing no token with the domain unless
register-corroborated (C-002). The slug derives ONLY from the resolved name, never a page title.

## jurisdiction.js — `resolveJurisdiction(bundle)`

Sole producer of the nexus. Returns `{ bound:[{ jurisdiction, tier_evidence[], confidence, score }],
serves[], sub_jurisdictions[], abstained }`. `serves[]` (marketing reach) is separate from `bound[]`
(legal nexus): no consumer may attach law from `serves` (C-008). The **Tier A/B/C matrix**
(`TIER_WEIGHTS = {A:5, B:3, C:1}`, Rule 13):

- **Tier A (5, each alone binds)** — a register row with a real identifier; an on-site authorisation
  statement naming an authority WITH a number; a registered-office / incorporated-in statement
  anchored to a named country in the same span.
- **Tier B (3)** — country-format postcode, local phone country code, ccTLD, pricing currency.
  Binding needs **two independent Tier-B kinds**, never two of the same kind (C-007).
- **Tier C (1)** — marketing prose, bar admissions, bare authority mentions. **Never binds**; feeds
  `serves[]` only.

Nexus is anchored (C-009, the Mills & Reeve ghost-US class): "incorporated in" binds only to a
country named inside the establishment span. Sub-jurisdictions: US states on observable state nexus,
UK nation from the postcode, and DIFC/ADGM free-zone establishment as a distinct typed nexus that
**displaces** the AE federal DP regime (DIFC takes precedence; "DIFC Courts" advocacy never
establishes). Empty `bound[]` means `abstained: true`; there is no default jurisdiction (C-006).

## sector.js — `resolveSector(bundle, options)` + the ICP gate

Returns `{ fact:'sector', value:{ sector, sub_sector }|null, confidence, evidence[],
contradictions[], diagnostics }`. Deterministic doctrine:

- **Two-cue deny-by-default (E-005):** a sector attaches only when >= 2 distinct visible-text cues
  beat every rival from a different family. A weak or tied score selects nothing; "General" does not
  exist.
- **Own-identity guard:** client-industry mentions ("law firm SEO", "we help law firms") are
  discounted, so a marketing agency never classifies as its clients.
- **Domain self-identity (C-013):** the firm's own domain naming what it IS
  (`sectorSelfIdFromDomain`) can win the two-cue MARGIN over a rival that appears only as incidental
  body mentions — but never lowers the floor, so a self-identifying domain with < 2 body cues still
  resolves nothing (the immigrationlawyersusa class, caution C-006).
- **Register cross-check (C-014/C-016):** an SRA/CQC/FCA row or a Companies House SIC family decides
  or corroborates the family; a register or SIC that CONTRADICTS the text family downgrades to
  abstain. A contradicted sector never ships.
- A queue **hint** is never evidence: it never resolves or overrides a sector, only flags a
  disagreement for upstream re-verification.

`resolveSectorWithLlm(bundle, options)` is an async seam, never called by default: it runs only when
the deterministic path abstained WITHOUT a register contradiction, may select only a sector already
in the tree (closed world, Rule 11), is capped at `weak`, and fails closed to the abstention on any
hook error (recorded as a typed degradation, never swallowed).

**The ICP gate — `auditableCell({ sector, sub_sector, jurisdictions_bound })`.** The only reader of
`served-cells.json`. Returns `{ auditable, reason, cell? }`. A `(sector, sub_sector, jurisdiction)`
triple is auditable ONLY when it matches a `served:true` cell; anything else is refused with a
stated reason ("sector unresolved", "no bound jurisdiction", "cell not served yet; activates: …",
"not in the served-cells manifest"). The manifest is UK-depth-first: every UK sector cell is served
(`sub_sectors:'*'`); EU/US/AE/SA/QA are `served:false` with an `activates` note (the P5 waves).
Silence is free: the engine refuses an out-of-dataset cell rather than guessing.

## capabilities.js — `deriveCapabilities(bundle)`

Sole producer of the 14 activity predicates (`CAPABILITY_TAGS`: `b2c`, `b2b_only`, `ecommerce`,
`cookies_present`, `runs_ads`, `uses_ai`, `payments`, `ugc`, `biometrics`, `child_directed`,
`health_claims`, `financial_promotion`, `sells_food_online`, `sells_travel_packages`) that gate
capability-scoped law. Returns `{ fact:'CAPABILITIES', predicates:{ <tag>:{ tag, present:
true|false|'unknown', confidence, evidence[] } }, exclusions:{ smb_likely }, meta }`. **UNKNOWN is
the honest default.** `present:true` requires a verbatim-quotable on-site signal (an exact substring
of the scanned text, so it survives a Gate-2 re-match); `present:false` is itself a claim, asserted
only where the corpus is deep enough (`MIN_PAGES_FOR_ABSENCE`) and a positive counter-signal exists.
A register row never flips a content predicate true on its own (C-060). Tags are validated against
`vocabulary.ACTIVITY_TAGS`; drift fails closed at load (`VOCABULARY_LINKED`).

## How P3 populates the bundle

The facts layer is pure and already stable; P3 fills the `evidence/` collectors that build the
bundle it consumes: `evidence/crawler/` produces `corpus.pages` as stripped visible text (E-236
parallelism, coverage-contract); `evidence/browser/` adds the rendered DOM and network events (the
PECR pre-consent diff); `evidence/registers/` supplies the binary `registers.*` rows (Companies
House, GLEIF, SRA, CQC, FCA, ICO) with real name matches (C-004); `evidence/documents/` extracts
elements from PDFs. Non-English corpora are gated to `compliance_unassessed` before any fact runs
(C-022). The facts modules never fetch: give them a richer bundle and the same pure doors produce a
richer, still-abstaining-when-unsure fact set.

*Not legal advice. This describes the engine's fact layer, not the law.*
