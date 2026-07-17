# eval/reference-set - hand-verified ground truth

`reference-set.json` holds verified expectations for 30 real firms (9 forensic-audit
firms, 13 watch-list, 8 legal/health x UK/IE/US/AE matrix). The watch-list includes
3 US cell exemplars added 2026-07-18 (munsch.com for us-legal, cedars-sinai.org for
us-healthcare, kabodcoffee.com for us-universal), each scoped with verified sector,
jurisdiction and catalogue-id frameworks. `verify.js` checks an engine payload against
them under one law: **match or abstain, never contradict**.

- **Match**: the engine asserts a value that agrees with a verified expectation.
- **Abstain**: the engine omits it, or ships it as needs-review. Allowed and logged -
  honest abstention beats confident fabrication.
- **Contradict**: the engine asserts a different value, claims a binding jurisdiction
  outside the verified list, or asserts any `known_non_breach` as a breach. Exit 1.

## Running

```
node eval/reference-set/verify.js <payload.json> [--domain <domain>] [--set <file>] [--json]
```

Exit 0 = no contradictions. Exit 1 = contradiction. Exit 2 = usage/data error
(including a domain that is not in the set).

## Editing the set

Fields are filled ONLY from hand-verified sources (each firm carries `provenance` and
`verified_date`). Unverified fields are `null` with `needs_verification: true` - do not
fill one without adding the verification source. The forensic firms' entries encode the
verified false positives from `AUDIT-ENGINE-FAILURE-CATALOGUE.md` as `known_non_breaches`:
those are the regressions the old engine actually shipped, and re-asserting any of them
fails the harness. P1's exit gate is 100% on this set (abstentions allowed,
contradictions not).
