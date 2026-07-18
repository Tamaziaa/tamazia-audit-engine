# breach/verifiers/ - the no-artifact-no-breach gate

Constitution Rule 3 ("no artifact, no breach") and Rule 12 Gate 2 ("verbatim-quote exact re-match").
This directory is the ONLY path a proposed finding may take from `breach/proposers/` (not yet built)
to `breach/adjudicator/` (not yet built). It is a pure filter: it never creates, upgrades or edits a
candidate, it only decides whether the candidate's cited artifact genuinely exists on the evidence
bundle.

## The candidate/artifact contract

```
candidate = {
  rule_id: string,                          // pass-through; never read or judged here
  artifact: {
    type: 'quote' | 'network_event' | 'register_row' | 'coverage_proof',
    ... type-specific fields (below) ...
  },
}
```

An artifact with a missing or unrecognised `type` is REJECTED, never passed through (fail closed,
Constitution Rule 4).

### `quote` (breach/verifiers/quote-match.js, Rule 12 Gate 2)

```
{ type: 'quote', page_url, surface: 'visible_text' | 'raw_html', quote }
```

`page_url` must exactly match a `url` in `bundle.corpus.pages`. `surface` declares which detection
surface the quote was found on (caution.md C-035: detection surface must equal evidence surface).
`visible_text` reads `page.text` (the stripped text every EvidenceBundle page carries per
facts/README.md); `raw_html` reads an optional `page.rawHtml` field that the canonical
EvidenceBundle does not yet populate (a future evidence/crawler/ extension point for rules that
legitimately need the pre-strip surface, caution.md C-036's trigger/mechanism asymmetry). A
`raw_html` candidate against a page with no such field is honestly unverifiable, not assumed true.

The quote is matched after exactly ONE normalisation: every run of whitespace collapses to a single
space. No case folding, no punctuation stripping, no other transformation. See quote-match.js's file
header for the full justification.

### `network_event` (breach/verifiers/network-event.js)

```
{ type: 'network_event', kind, host, name, ts? }
```

Matched by exact equality (never substring) against an entry in `bundle.browser.observed[]`
(evidence/browser/observe.js's own output shape: `{kind, name, host, essential, networkEvent,
artifact, ts}`). A lane that never ran (`bundle.browser.lane.ran !== true`) rejects every candidate,
since there is nothing to verify against.

### `register_row` (breach/verifiers/register-row.js)

```
{ type: 'register_row', register: 'companiesHouse'|'gleif'|'sra'|'cqc'|'fca'|'ico', row }
```

`row` must be the EXACT row object the candidate is citing, copied verbatim from what it read off the
bundle. Verified only when `bundle.registers[register]` exists and deep-equals `row` field for field
(Rule 12 Gate 2's "exact re-match" ethos applied to structured data). This directory does not
hardcode the six register keys: an unknown or misspelt key simply has no bundle row to match, so it
fails the same way a genuinely absent register does.

### `coverage_proof` (breach/verifiers/coverage-proof.js)

```
{ type: 'coverage_proof', page_class, coverage: { pages: [url,...], tier1_fetched, truncated } }
```

The artifact class for ABSENCE claims ("no complaints procedure was found"), which have no quote to
point at by definition. Verified only when every URL in `coverage.pages` is present in
`bundle.corpus.pages` (a coverage claim cannot invent pages nobody crawled), `tier1_fetched` is
literally `true` (caution.md C-026), and `truncated` is literally `false` (caution.md C-024/C-025: a
truncated corpus cannot honestly ground an absence claim). This module never re-derives the coverage
computation itself; that stays evidence/crawler/coverage-contract.js's one door.

## Result shape

Every verify function returns `{verified, code, reason}`. `code` is a closed taxonomy exported as
`CODES` from `result.js`; `reason` is always a human-readable string. `verifyAll(candidates, bundle)`
returns `{verified: [{candidate, verified, code, reason}], rejected: [...]}`, carrying the ORIGINAL
candidate reference unmodified in both arrays.

## Calibration

`node breach/verifiers/quote-match.js --calibrate [--json <path>]` runs every
`eval/calibration-known-bad/fixtures/p3-verifier-*.json` fixture through `verifyCandidate` and emits
a finding only when the fixture's planted poison is correctly rejected (optionally checked against a
`poison.expected_code`). This mirrors facts/identity.js and evidence/registers/registers.js's own
`--calibrate` dialect exactly, so it can be wired into `eval/calibration-known-bad/run.js`'s
`CALIBRATIONS` registry with no adaptation (that registration is not part of this module: run.js is
outside this directory's ownership).
