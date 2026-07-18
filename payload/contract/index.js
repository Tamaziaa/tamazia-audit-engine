'use strict';
// payload/contract - the seed of the @tamazia/audit-contract package.
//
// Exports { schema, REQUIRED, NONEMPTY, EXACT_COUNTS, validatePayload }.
// validatePayload(payload) -> missing[]  (empty array = contract satisfied)
//
// Pure JavaScript, zero dependencies. The path lists are ported verbatim from the
// proven D_CONTRACT manifest in tamazia-website functions/audit/_contract.js
// (REQUIRED / NONEMPTY / exact-count invariants: dims == 10, geo.engines == 8,
// geo.rootCause.chain == 4). payload/schema/payload.schema.json is the formal JSON
// Schema statement of the same contract; `node payload/contract/index.js --selftest`
// proves the two stay in sync and that the validator accepts a minimal conforming
// payload and rejects an empty one.
//
// Contract semantics:
//   REQUIRED      path must be present and non-null.
//   NONEMPTY      path must be a non-empty array (the render iterates these).
//   EXACT_COUNTS  array length must equal the stated count exactly.
//   catalogueSize is DELIBERATELY NULLABLE and absent from REQUIRED: the engine does
//                 not yet emit a catalogue count and the render must never invent one -
//                 it prints screenedLabel instead. The two numbers we can always prove
//                 (frameworksBinding, rulesChecked) stay required.

const schema = require('../schema/payload.schema.json');

const REQUIRED = [
  'meta.company', 'meta.domain', 'meta.sector', 'meta.country', 'meta.date',
  'score', 'grade', 'scoreBand', 'exposure', 'exposureFull', 'exposureNote', 'exposureWaterfall',
  'counts.critical', 'counts.high', 'counts.standard', 'counts.total', 'confirmed',
  'frameworksAssessed', 'frameworksBinding', 'screenedLabel', 'rulesChecked',
  'scoring.formula', 'scoring.why', 'scoring.inputs', 'exec', 'jurisdiction',
  'heat', 'heatRows', 'heatCols', 'projected.wk12', 'projected.wk24', 'glossary',
  'seo.psi', 'seo.cwv', 'seo.onpage', 'seo.security', 'seo.a11y', 'seo.tech', 'seo.keywordSummary', 'seo.psiAudits',
  'geo.entityReadiness', 'geo.shareOfVoice', 'geo.radar', 'geo.schema', 'geo.citations', 'geo.sourceGap', 'geo.rootCause', 'geo.fix',
  'competitors.bestKeyword', 'competitors.youDr', 'competitors.cols', 'competitors.rows', 'competitors.drBars',
  'pricingNotes', 'upsellProof',
];

const NONEMPTY = [
  'scoring.bands', 'frameworks', 'dims', 'fixes', 'trajectory', 'seo.keywords',
  'geo.engines', 'competitors.rows', 'pricing',
];

const EXACT_COUNTS = [
  { path: 'dims', count: 10, label: 'dims!=10' },
  { path: 'geo.engines', count: 8, label: 'geo.engines!=8' },
  { path: 'geo.rootCause.chain', count: 4, label: 'rootCause.chain!=4' },
];

function get(obj, dotPath) {
  try {
    return dotPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
  } catch {
    // FAIL-OPEN: a throwing property getter (exotic object/Proxy) is treated as "path absent";
    // validatePayload then reports the path as missing, so the contract still fails closed.
    return undefined;
  }
}

// missingRequired(payload) -> REQUIRED paths that are null/undefined. Split out of validatePayload
// so each contract clause reads as its own named step (Constitution Rule 4 /
// tools/health-gate/check.js caps); behaviour is the original loop, only relocated.
function missingRequired(payload) {
  const missing = [];
  for (const p of REQUIRED) {
    if (get(payload, p) == null) missing.push(p);
  }
  return missing;
}

// missingNonEmpty(payload) -> NONEMPTY paths that are not a non-empty array. Unchanged loop.
function missingNonEmpty(payload) {
  const missing = [];
  for (const p of NONEMPTY) {
    const v = get(payload, p);
    if (!Array.isArray(v) || v.length === 0) missing.push(`${p} (empty)`);
  }
  return missing;
}

// missingExactCounts(payload) -> EXACT_COUNTS labels whose array length is not the stated count.
// Unchanged loop.
function missingExactCounts(payload) {
  const missing = [];
  for (const { path, count, label } of EXACT_COUNTS) {
    if ((get(payload, path) || []).length !== count) missing.push(label);
  }
  return missing;
}

/**
 * validatePayload(payload) -> string[] of contract paths that are missing (null or
 * undefined), empty where content is required, or violating an exact-count invariant.
 * An empty return array means the payload satisfies contract v1.
 */
function validatePayload(payload) {
  return [
    ...missingRequired(payload),
    ...missingNonEmpty(payload),
    ...missingExactCounts(payload),
  ];
}

// ---------- self-test (run: node payload/contract/index.js --selftest) ----------

// assertSafeKeys(keys) -> throws (fail closed, Constitution Rule 4) if any dot-path segment is a
// prototype-pollution vector. setPath/setPathForce only ever receive the internal constant paths in
// REQUIRED/NONEMPTY/EXACT_COUNTS, so this never fires at runtime; it is a defence-in-depth guard on
// the dynamic key assignment that also closes the CodeQL js/prototype-pollution-utility and Semgrep
// prototype-pollution-loop findings. One door for the check so the two builders below do not each
// grow their own (jscpd clone).
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function assertSafeKeys(keys) {
  for (const k of keys) {
    if (UNSAFE_PATH_KEYS.has(k)) throw new Error('unsafe payload path segment: ' + JSON.stringify(k));
  }
}

// walkToParent(obj, keys): descend obj along keys[0..length-2], creating an intermediate object at any
// step that is missing or non-object, and return the parent object the final key should be set on.
// Shared by setPath/setPathForce so the traversal exists in exactly one place (removes the
// CodeScene/jscpd near-duplicate the two previously carried verbatim).
function walkToParent(obj, keys) {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  return cur;
}

function setPath(obj, dotPath, value) {
  const keys = dotPath.split('.');
  assertSafeKeys(keys);
  const parent = walkToParent(obj, keys);
  const lastKey = keys[keys.length - 1];
  if (parent[lastKey] === undefined) parent[lastKey] = value;
}

function setPathForce(obj, dotPath, value) {
  const keys = dotPath.split('.');
  assertSafeKeys(keys);
  const parent = walkToParent(obj, keys);
  parent[keys[keys.length - 1]] = value;
}

/** Builds the smallest payload that satisfies contract v1 (placeholder leaves). */
function buildMinimalValidPayload() {
  const p = {};
  for (const path of REQUIRED) setPath(p, path, 'x');
  for (const path of NONEMPTY) setPathForce(p, path, [{}]);
  for (const { path, count } of EXACT_COUNTS) setPathForce(p, path, Array.from({ length: count }, () => ({})));
  return p;
}

// nodeLacksProperty(node, key) -> true when `node` cannot be descended into `key` (no node, no
// properties bag, or the key is absent from it). Extracted so the boolean lives in a RETURN
// position rather than the schemaNodeFor if-test (CodeScene complex-conditional guard).
function nodeLacksProperty(node, key) {
  return !node || !node.properties || !(key in node.properties);
}

/** Walks the JSON Schema's properties tree to the given dot path; returns the subschema or null. */
function schemaNodeFor(dotPath) {
  let node = schema;
  for (const key of dotPath.split('.')) {
    if (nodeLacksProperty(node, key)) return null;
    node = node.properties[key];
  }
  return node;
}

// Every assertion group below has the exact same shape: () -> string[] of selftest errors.
// selftest (the aggregator, at the foot of this section) just concatenates them. Split out of the
// former single 22-branch selftest (Constitution Rule 4/tools/health-gate/check.js caps): each
// group reads independently and none of the underlying assertion logic changed, only where it
// lives.

// pathRequiredInSchema(segs) -> the first segment along `segs` that the schema does not mark
// `required`, or null when every checkable segment is required. Split out of
// checkRequiredPathsAgainstSchema so the inner walk's own nesting is its own unit (the health-gate
// Deep Nesting cap): the outer loop no longer nests a second loop nesting an if.
function pathRequiredInSchema(segs) {
  let node = schema;
  for (const seg of segs) {
    if (!Array.isArray(node.required) || !node.required.includes(seg)) return seg;
    node = node.properties && node.properties[seg];
    if (!node) return null; // ran out of schema to descend; nothing further to check
  }
  return null;
}

// 1. Every REQUIRED path must exist in the schema and be in a `required` chain.
function checkRequiredPathsAgainstSchema() {
  const errors = [];
  for (const p of REQUIRED) {
    if (!schemaNodeFor(p)) errors.push(`REQUIRED path not described by schema: ${p}`);
    const missingSeg = pathRequiredInSchema(p.split('.'));
    if (missingSeg) errors.push(`schema does not require "${missingSeg}" on path ${p}`);
  }
  return errors;
}

// 2. Every NONEMPTY path must exist and carry minItems >= 1.
function checkNonEmptyPathsAgainstSchema() {
  const errors = [];
  for (const p of NONEMPTY) {
    const node = schemaNodeFor(p);
    if (!node) { errors.push(`NONEMPTY path not described by schema: ${p}`); continue; }
    const minItems = node.minItems != null ? node.minItems : (node.$ref === '#/$defs/nonEmptyArray' ? 1 : null);
    if (minItems == null || minItems < 1) errors.push(`schema does not enforce non-empty on ${p}`);
  }
  return errors;
}

// countNotPinned(node, count) -> true when the schema node does not pin an array to exactly
// `count` items (missing node, or minItems/maxItems not equal to count). Extracted so the
// boolean lives in a RETURN position, not the checkExactCountsAgainstSchema if-test.
function countNotPinned(node, count) {
  return !node || node.minItems !== count || node.maxItems !== count;
}

// 3. Exact counts must be encoded as minItems == maxItems == count.
function checkExactCountsAgainstSchema() {
  const errors = [];
  for (const { path, count } of EXACT_COUNTS) {
    const node = schemaNodeFor(path);
    if (countNotPinned(node, count)) {
      errors.push(`schema does not pin ${path} to exactly ${count} items`);
    }
  }
  return errors;
}

// catalogueSizeIsRequired() -> true if catalogueSize appears in the compiled schema's `required`
// list or in this module's own REQUIRED list (it must stay nullable and non-required). Extracted
// so the boolean lives in a RETURN position, not the checkCatalogueSizeNotRequired if-test.
function catalogueSizeIsRequired() {
  return (schema.required || []).includes('catalogueSize') || REQUIRED.includes('catalogueSize');
}

// 4. catalogueSize must NOT be required (deliberately nullable).
function checkCatalogueSizeNotRequired() {
  const errors = [];
  if (catalogueSizeIsRequired()) {
    errors.push('catalogueSize must stay nullable and non-required');
  }
  return errors;
}

// 5. The validator must reject an empty payload and accept the minimal valid one.
function checkValidatorBehaviour() {
  const errors = [];
  if (validatePayload({}).length === 0) errors.push('validatePayload({}) returned no missing paths - validator broken');
  const minimalMissing = validatePayload(buildMinimalValidPayload());
  if (minimalMissing.length !== 0) errors.push(`minimal valid payload flagged: ${minimalMissing.join(', ')}`);
  return errors;
}

function selftest() {
  return [
    ...checkRequiredPathsAgainstSchema(),
    ...checkNonEmptyPathsAgainstSchema(),
    ...checkExactCountsAgainstSchema(),
    ...checkCatalogueSizeNotRequired(),
    ...checkValidatorBehaviour(),
  ];
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    const errors = selftest();
    if (errors.length) {
      console.error('payload contract selftest FAILED:');
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`payload contract selftest OK: ${REQUIRED.length} required paths, ${NONEMPTY.length} non-empty arrays, ${EXACT_COUNTS.length} exact-count invariants, schema v${schema.version} in sync.`);
    process.exit(0);
  }
  // Convenience: validate a payload file from the CLI.
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node payload/contract/index.js --selftest | <payload.json>');
    process.exit(2);
  }
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = validatePayload(payload);
  if (missing.length) {
    console.error(`CONTRACT VIOLATION (${missing.length}):`);
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log('contract v1 satisfied');
  process.exit(0);
}

module.exports = { schema, REQUIRED, NONEMPTY, EXACT_COUNTS, validatePayload, buildMinimalValidPayload };
