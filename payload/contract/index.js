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

/**
 * validatePayload(payload) -> string[] of contract paths that are missing (null or
 * undefined), empty where content is required, or violating an exact-count invariant.
 * An empty return array means the payload satisfies contract v1.
 */
function validatePayload(payload) {
  const missing = [];
  for (const p of REQUIRED) {
    if (get(payload, p) == null) missing.push(p);
  }
  for (const p of NONEMPTY) {
    const v = get(payload, p);
    if (!Array.isArray(v) || v.length === 0) missing.push(`${p} (empty)`);
  }
  for (const { path, count, label } of EXACT_COUNTS) {
    if ((get(payload, path) || []).length !== count) missing.push(label);
  }
  return missing;
}

// ---------- self-test (run: node payload/contract/index.js --selftest) ----------

function setPath(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  if (cur[keys[keys.length - 1]] === undefined) cur[keys[keys.length - 1]] = value;
}

function setPathForce(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** Builds the smallest payload that satisfies contract v1 (placeholder leaves). */
function buildMinimalValidPayload() {
  const p = {};
  for (const path of REQUIRED) setPath(p, path, 'x');
  for (const path of NONEMPTY) setPathForce(p, path, [{}]);
  for (const { path, count } of EXACT_COUNTS) setPathForce(p, path, Array.from({ length: count }, () => ({})));
  return p;
}

/** Walks the JSON Schema's properties tree to the given dot path; returns the subschema or null. */
function schemaNodeFor(dotPath) {
  let node = schema;
  for (const key of dotPath.split('.')) {
    if (!node || !node.properties || !(key in node.properties)) return null;
    node = node.properties[key];
  }
  return node;
}

function selftest() {
  const errors = [];

  // 1. Every REQUIRED path must exist in the schema and be in a `required` chain.
  for (const p of REQUIRED) {
    if (!schemaNodeFor(p)) errors.push(`REQUIRED path not described by schema: ${p}`);
    const segs = p.split('.');
    let node = schema;
    for (const seg of segs) {
      if (!Array.isArray(node.required) || !node.required.includes(seg)) {
        errors.push(`schema does not require "${seg}" on path ${p}`);
        break;
      }
      node = node.properties && node.properties[seg];
      if (!node) break;
    }
  }

  // 2. Every NONEMPTY path must exist and carry minItems >= 1.
  for (const p of NONEMPTY) {
    const node = schemaNodeFor(p);
    if (!node) { errors.push(`NONEMPTY path not described by schema: ${p}`); continue; }
    const minItems = node.minItems != null ? node.minItems : (node.$ref === '#/$defs/nonEmptyArray' ? 1 : null);
    if (minItems == null || minItems < 1) errors.push(`schema does not enforce non-empty on ${p}`);
  }

  // 3. Exact counts must be encoded as minItems == maxItems == count.
  for (const { path, count } of EXACT_COUNTS) {
    const node = schemaNodeFor(path);
    if (!node || node.minItems !== count || node.maxItems !== count) {
      errors.push(`schema does not pin ${path} to exactly ${count} items`);
    }
  }

  // 4. catalogueSize must NOT be required (deliberately nullable).
  if ((schema.required || []).includes('catalogueSize') || REQUIRED.includes('catalogueSize')) {
    errors.push('catalogueSize must stay nullable and non-required');
  }

  // 5. The validator must reject an empty payload and accept the minimal valid one.
  if (validatePayload({}).length === 0) errors.push('validatePayload({}) returned no missing paths - validator broken');
  const minimalMissing = validatePayload(buildMinimalValidPayload());
  if (minimalMissing.length !== 0) errors.push(`minimal valid payload flagged: ${minimalMissing.join(', ')}`);

  return errors;
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
