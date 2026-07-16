# payload - the engine-owned payload seam

This directory is the seed of the versioned npm package **`@tamazia/audit-contract`**:
the single artifact both repos share. The engine composes payloads that satisfy it;
tamazia-website mounts it (route + shell + assets only) and **re-derives nothing**.
Any payload change and its transform change land in the same commit in this repo,
which makes the old 61% cross-repo coupling class structurally impossible.

## Layout

```
payload/
  schema/payload.schema.json   contract v1 as JSON Schema draft 2020-12 ($id + version)
  contract/index.js            pure-JS validator: { schema, REQUIRED, NONEMPTY,
                               EXACT_COUNTS, validatePayload(payload) -> missing[] }
  composer/                    payload composition (P4)
```

## Contract v1

Ported from the proven D_CONTRACT manifest in tamazia-website
`functions/audit/_contract.js`:

- **REQUIRED** - 55 paths that must be present and non-null (meta.*, score, exposure*,
  counts.*, the three-numbers fields, scoring.*, seo.*, geo.*, competitors.*, ...).
- **NONEMPTY** - 9 arrays the render iterates and that must never be empty
  (scoring.bands, frameworks, dims, fixes, trajectory, seo.keywords, geo.engines,
  competitors.rows, pricing).
- **EXACT COUNTS** - `dims == 10`, `geo.engines == 8`, `geo.rootCause.chain == 4`.
- **`catalogueSize` is deliberately nullable and NOT required**: the engine does not yet
  emit a catalogue count and the render must never invent one; `screenedLabel` is
  printed instead. The two numbers we can always prove (`frameworksBinding`,
  `rulesChecked`) stay required.

Leaf types are permissive in v1 (present-and-non-null is the contract); they tighten in
later minor versions as the composer lands. Version lives in the schema (`version` +
`$id`); breaking changes bump the major and both repos move together.

## Using it

```js
const { validatePayload } = require('./payload/contract');
const missing = validatePayload(payload);
if (missing.length) throw new Error(`payload contract violation: ${missing.join(', ')}`);
```

CLI:

```
node payload/contract/index.js --selftest      # proves lists and schema are in sync
node payload/contract/index.js <payload.json>  # validate a payload file
```

The self-test asserts every REQUIRED path is a `required` chain in the schema, every
NONEMPTY array carries `minItems >= 1`, the exact counts are pinned, catalogueSize
stays nullable, and the validator rejects `{}` while accepting the minimal conforming
payload.

## What moves here in P4

**`payloadToD()` moves into this package in P4.** The pure payload -> D transform, the
D_CONTRACT validator and the payload schema then live and are tested together in this
repo against every golden payload (`eval/golden/`); the website imports the published
package, validates at runtime fail-closed, and deletes its own re-derivation paths in
`_adapter.js`. Render bugs become engine-repo unit tests instead of production
surprises.

## Consumers today

- `eval/calibration-known-bad/run.js` - the earn-your-zero gate runs `validatePayload`
  against a deliberately incomplete payload fixture on every run.
- `eval/golden/run.js` and `eval/reference-set/verify.js` operate on payloads that must
  satisfy this contract once the composer lands.
