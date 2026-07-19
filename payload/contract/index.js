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
//
// v1.1 (additive minor - every v1.0 path is untouched): adds the compliance side the
// skeleton lacked.
//   findings                        REQUIRED presence, MAY be EMPTY (a compliant firm has
//                                   zero findings). Deliberately NOT in NONEMPTY - an empty
//                                   findings[] is a valid compliant audit, never a broken one.
//   applicability.assessed          REQUIRED: the catalogue records connect() judged binding.
//   applicability.assessedCompliant REQUIRED: the pass subset (may be empty).
//   applicability.excludedCount     REQUIRED: how many records connect() excluded (a number,
//                                   which may legitimately be 0). No catalogueSize (C-118).
//   notLegalAdvice                  REQUIRED: the standing not-legal-advice line (C-200).
// The path-level validator below is presence/non-null/non-empty/exact-count only (zero deps);
// the finding-item shape, the earned-voice if/then (Rule 10 / C-111) and the exposureWaterfall
// target shape live in payload/schema/payload.schema.json and are locked by the selftest below,
// which cross-checks the JSON Schema structurally rather than running a JSON-schema engine.

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
  // v1.1 additive (compliance side). findings is a PRESENCE check only (an empty findings[] is a valid
  // compliant audit) and is deliberately kept OUT of NONEMPTY. excludedCount may be 0, which is non-null
  // and so satisfies the presence check.
  'findings',
  'applicability.assessed', 'applicability.assessedCompliant', 'applicability.excludedCount',
  'notLegalAdvice',
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

/** Builds the smallest payload that satisfies the contract (placeholder leaves). */
function buildMinimalValidPayload() {
  const p = {};
  for (const path of REQUIRED) setPath(p, path, 'x');
  for (const path of NONEMPTY) setPathForce(p, path, [{}]);
  for (const { path, count } of EXACT_COUNTS) setPathForce(p, path, Array.from({ length: count }, () => ({})));
  // v1.1 keys carry real types (the REQUIRED loop stamped them the 'x' placeholder). findings is an array
  // that MAY be empty; applicability is the assessed/assessedCompliant/excludedCount object; notLegalAdvice
  // stays the non-empty 'x' string. setPathForce overrides the placeholders so the minimal payload is
  // type-faithful, not merely non-null.
  setPathForce(p, 'findings', []);
  setPathForce(p, 'applicability.assessed', []);
  setPathForce(p, 'applicability.assessedCompliant', []);
  setPathForce(p, 'applicability.excludedCount', 0);
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

// ---------- v1.1 additive-invariant clauses ----------
// Each locks one v1.1 promise so a future edit that quietly loosens it fails the selftest, not a client.

// 6. findings is a PRESENCE-only contract: REQUIRED but deliberately NOT in NONEMPTY (an empty findings[]
//    is a valid compliant audit). If someone adds it to NONEMPTY, a compliant firm's payload would be
//    rejected - lock against that.
function checkFindingsPresenceOnly() {
  const errors = [];
  if (!REQUIRED.includes('findings')) errors.push('findings must be REQUIRED (presence) in v1.1');
  if (NONEMPTY.includes('findings')) errors.push('findings must NOT be in NONEMPTY - an empty findings[] is a valid compliant audit');
  return errors;
}

// enumOf(node) -> the sorted, comma-joined enum of a schema node, or '' when it has none. Lets the
// finding-item enum checks read as a single equality rather than a nested guard (health-gate DP cap).
function enumOf(node) {
  return node && Array.isArray(node.enum) ? node.enum.slice().sort().join(',') : '';
}
// findingRequiredFieldErrors(f) -> a message per REQUIRED finding-item field the schema fails to require.
function findingRequiredFieldErrors(f) {
  const need = ['record_id', 'state', 'kind', 'artifact', 'framework', 'statutory_citation', 'page_url', 'voice_tier'];
  return need.filter((k) => !(f.required || []).includes(k)).map((k) => `$defs.finding must require "${k}"`);
}
// findingEnumAndArtifactErrors(f) -> the closed-enum (state, voice_tier) and artifact-`type` errors.
function findingEnumAndArtifactErrors(f) {
  const props = f.properties || {};
  const errors = [];
  if (enumOf(props.state) !== 'needs_review,pass,violation') errors.push('$defs.finding.state must be the closed enum violation|needs_review|pass');
  if (enumOf(props.voice_tier) !== 'confident,observation') errors.push('$defs.finding.voice_tier must be the closed enum confident|observation');
  if (!(props.artifact && (props.artifact.required || []).includes('type'))) errors.push('$defs.finding.artifact must require a `type` (Rule 3: no artifact, no breach)');
  return errors;
}
// 7. The finding item schema is real (typed, not nonNull): the eight required fields, the closed state and
//    voice_tier enums, and artifact carrying a required `type` (Rule 3).
function checkFindingItemSchema() {
  const f = schema.$defs && schema.$defs.finding;
  if (!f) return ['schema.$defs.finding is missing (v1.1 finding item shape)'];
  return [...findingRequiredFieldErrors(f), ...findingEnumAndArtifactErrors(f)];
}

// 8. The earned-voice rule is ENCODED (Rule 10 / C-111): an if/then ties state in {needs_review, pass} to
//    voice_tier const observation. A confident-voice string on a non-violation is schema-invalid.
function checkEarnedVoiceRule() {
  const f = schema.$defs && schema.$defs.finding;
  const clause = f && Array.isArray(f.allOf) ? f.allOf.find((c) => c && c.if && c.then) : null;
  if (!clause) return ['$defs.finding must carry an if/then allOf clause tying state to voice_tier (Rule 10 / C-111)'];
  const guardStates = clause.if.properties && clause.if.properties.state && clause.if.properties.state.enum;
  const forced = clause.then.properties && clause.then.properties.voice_tier && clause.then.properties.voice_tier.const;
  const errors = [];
  if (String((guardStates || []).sort()) !== 'needs_review,pass') errors.push('the earned-voice if must guard exactly state in {needs_review, pass}');
  if (forced !== 'observation') errors.push('the earned-voice then must force voice_tier to observation');
  return errors;
}

// applicabilityRequiredErrors(a) -> a message per REQUIRED applicability child the schema fails to require.
function applicabilityRequiredErrors(a) {
  return ['assessed', 'assessedCompliant', 'excludedCount']
    .filter((k) => !(a.required || []).includes(k))
    .map((k) => `applicability must require "${k}"`);
}
// assessedRecordStateErrors() -> the assessed-item state must be the FOUR-state enum (adds not_evaluated).
function assessedRecordStateErrors() {
  const rec = schema.$defs && schema.$defs.assessedRecord;
  const state = rec && rec.properties && rec.properties.state;
  return enumOf(state) !== 'needs_review,not_evaluated,pass,violation'
    ? ['$defs.assessedRecord.state must be violation|needs_review|pass|not_evaluated'] : [];
}
// catalogueSizeAbsentErrors(a) -> catalogueSize must never appear on applicability (C-118).
function catalogueSizeAbsentErrors(a) {
  const present = (a.properties && a.properties.catalogueSize) || (a.required || []).includes('catalogueSize');
  return present ? ['applicability must not carry catalogueSize (C-118)'] : [];
}
// 9. applicability is a real object (assessed/assessedCompliant/excludedCount), the assessed item carries
//    the four-state enum (adds not_evaluated), and no catalogueSize leaks in anywhere (C-118).
function checkApplicabilitySchema() {
  const a = schema.properties && schema.properties.applicability;
  if (!a) return ['schema.properties.applicability is missing (v1.1)'];
  return [...applicabilityRequiredErrors(a), ...assessedRecordStateErrors(), ...catalogueSizeAbsentErrors(a)];
}

// 10. notLegalAdvice is a required non-empty string (C-200); exposureWaterfallShape is documented as an
//     anyOf that also accepts the legacy website shape (additive, both shapes valid).
function checkStandingLineAndWaterfallShape() {
  const errors = [];
  const nla = schema.properties && schema.properties.notLegalAdvice;
  if (!nla || nla.type !== 'string' || !(nla.minLength >= 1)) errors.push('notLegalAdvice must be a string with minLength >= 1 (C-200)');
  if (!(schema.required || []).includes('notLegalAdvice')) errors.push('notLegalAdvice must be in schema.required');
  const w = schema.$defs && schema.$defs.exposureWaterfallShape;
  if (!w || !Array.isArray(w.anyOf) || w.anyOf.length < 2) errors.push('$defs.exposureWaterfallShape must be an anyOf accepting the target AND legacy shapes');
  return errors;
}

function selftest() {
  return [
    ...checkRequiredPathsAgainstSchema(),
    ...checkNonEmptyPathsAgainstSchema(),
    ...checkExactCountsAgainstSchema(),
    ...checkCatalogueSizeNotRequired(),
    ...checkValidatorBehaviour(),
    ...checkFindingsPresenceOnly(),
    ...checkFindingItemSchema(),
    ...checkEarnedVoiceRule(),
    ...checkApplicabilitySchema(),
    ...checkStandingLineAndWaterfallShape(),
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
