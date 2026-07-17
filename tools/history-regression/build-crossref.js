#!/usr/bin/env node
'use strict';
/**
 * build-crossref.js - regenerate docs/failure-ledger/crossref.json from the primary sources.
 *
 * Sources (read fully, never invented):
 *   - the normalised sweep findings (256 deduped clusters + 6 ACT), passed as --sweep <path>
 *   - tools/history-regression/taxonomy.js (the derived class table, DG-01..DG-05, F-0001..F-0090)
 *
 * Output: an array of defect entries plus the class-level taxonomy rollup that check.js validates.
 * Each defect entry carries {class, caution_pointer, catching_gate, status} exactly as the task
 * asks, where catching_gate and status are inherited from the defect's class in taxonomy.js (one
 * door per class: the class decides the gate, the defect points at the class).
 *
 * The sweep defects are classified by (category -> class) with a message-keyword refinement for
 * the large "other" bucket. The mapping is deterministic and printed in --explain so a human can
 * audit every assignment; it is a best-effort triage of tool output, NOT a legal judgement - the
 * load-bearing contract is the class->gate mapping, which check.js enforces regardless of how any
 * single defect was triaged.
 *
 * Usage:
 *   node tools/history-regression/build-crossref.js --sweep <sweep-findings.json> [--out <path>]
 *   node tools/history-regression/build-crossref.js --sweep <path> --check   (build in memory,
 *                                                                              diff against the
 *                                                                              committed file)
 */
const fs = require('fs');
const path = require('path');

const { TAXONOMY, DOMAIN_GATES, ACT } = require('./taxonomy');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'docs', 'failure-ledger', 'crossref.json');

const BY_CLASS = new Map(TAXONOMY.map((t) => [t.class, t]));

// category -> class for the sweep buckets that map cleanly.
const CATEGORY_CLASS = {
  secret: 'secret-leak',
  injection: 'injection',
  duplication: 'duplication',
  'dead-code': 'dead-code',
  regex: 'unanchored-regex',
  'error-handling': 'silent-swallow',
  async: 'phantom-data',
  performance: 'budget-floor',
};

// Message-keyword refinement for the "other" bucket, first match wins. Ordered most-specific
// first so a message mentioning both "version" and "cache" lands on cache-version, etc.
// A keyword is only a signal WITH semantic context (caution.md C-203): "out of scope" is not
// evidence of module-scope state, and a bare "market" wrongly matched "marketing", so those were
// tightened (\bmarkets?\b is the whole word, never the "marketing" prefix). Negative calibration
// cases in build-crossref.test.js lock both directions.
const KEYWORD_CLASS = [
  [/two doors|multiple producer|\bproducers\b|single producer|keep .* aligned|_n2c aligned/i, 'two-doors'],
  [/fail\s*closed|fail-open|before persist|before.*r2|persist.*payload|preflight|marked\s+`?ran`?|gates? (?:before|fail)|fail closed on neon/i, 'fail-open-gate'],
  [/module[- ]scope|singleton|_warn|_swarn|per-invocation|per-scan|reset between|scoped to one/i, 'module-scope-state'],
  [/bypass.*catalogue|truncated-code fallback|framework in rule identit|regulator|law name|law title|framework name|fw_name|placeholder string/i, 'law-fact-literal'],
  [/browser observation|presence rule type|prioritise browser|observed[- ]fact/i, 'absence-vs-observation'],
  [/persisted socials|bypass anchor|sharestoken|host anchoring|parse inputs before comparing|anchor.*scheme|url-substring/i, 'host-substring'],
  [/engine[- ]version|required_engine_version|scanner_cache|idem[_ ]key|replay|stale scan/i, 'cache-version'],
  [/jurisdicti|nexus|detectmarkets|\bbound\b|incorporated|established in|\bmarkets?\b/i, 'jurisdiction-nexus'],
  [/\bsector\b|classif/i, 'sector-misclassification'],
  [/fine|penalty|exposure|turnover|statutory (?:cap|max)|currency|\bband\b/i, 'exposure-error'],
  [/citation|provenance|official[- ]url|legislation\.gov|fetch.*200|repealed|duaa cap/i, 'provenance-fabrication'],
  [/polarity|prohibit|must[_ ]appear|advertis/i, 'polarity'],
  [/regex|pattern|escape|missing.?regexp.?anchor|hostname[- ]regexp/i, 'unanchored-regex'],
  [/file data in outbound|network data written|outbound network|http server|residential|object\.assign|user control data|sanitiz|xss|decode|escape.*inject|path[- ]?travers|shell[- ]?inject|child[- ]?process|\bhref\b/i, 'injection'],
  [/secret|rotate|webhook|credential/i, 'secret-leak'],
  [/mutable[- ]action|action[- ]tag|pin .* (?:commit )?sha|minimum[- ]release|renovate|dependabot|cooldown|dockerfile|node_tls|curl.*bash|npm ci|move zod|zod to|legacy sentry|sentry .* endpoint/i, 'ci-supply-chain'],
  [/contract|shared schema|payloadtod|defensive read|re-derive/i, 'contract-drift'],
  [/craftfix|renderer|hollow|filler/i, 'consistency-error'],
  [/quote|artifact|testimonial|hacked|injected spam|adjudicat|verdict|needs-review/i, 'breach-artifact'],
  [/node_modules|circular depend|aws-crypto/i, 'dead-code'],
  [/dead branch|never (?:match|call|execut)|unreachable|orphan|useless assignment|defensive code|trivial-conditional/i, 'dead-code'],
  [/coverage|absence|sitescanned|unfetched|corpus|crawl|\bspa\b|rendered/i, 'crawl-poverty'],
  [/done|phantom|on conflict|queue|reconcil|await.*ok|verifyauditurl|startup throw/i, 'phantom-data'],
  [/threshold|excluded_when|modern slavery|ccpa|residency/i, 'threshold-attachment'],
  [/deadline|timeout|promise\.race|hang|goto/i, 'deadline-hang'],
  [/duplicat|clone|copy-paste|jscpd/i, 'duplication'],
];

function classifyOther(message) {
  const m = String(message || '');
  for (const [rx, cls] of KEYWORD_CLASS) if (rx.test(m)) return cls;
  return null; // no keyword claimed it
}

// isOneDoorFinding(f) -> a one-door tool finding IS the two-doors class, whatever its prose says.
function isOneDoorFinding(f) {
  const tools = (f.tools || []).map((t) => String(t).toLowerCase());
  return tools.includes('one-door') || /^two doors/i.test(f.message || '');
}

// hasCleanCategory(f) -> a non-"other" category bucket the tool already typed authoritatively
// (secret/injection/duplication/dead-code/regex/error-handling/async/performance); only "other" is ambiguous.
function hasCleanCategory(f) {
  return Boolean(f.category && f.category !== 'other' && CATEGORY_CLASS[f.category]);
}

function classForSweep(f) {
  if (isOneDoorFinding(f)) return 'two-doors';
  if (hasCleanCategory(f)) return CATEGORY_CLASS[f.category];
  // The "other" bucket: keyword-refine the message, else fall to tooling-hygiene (tooling/test/CI
  // housekeeping or a genuinely diffuse lead - sweep-tool files, test gaps, workflow config; never dropped).
  const kw = classifyOther(f.message);
  if (kw) return kw;
  return 'tooling-hygiene';
}

function entryFor(cls, extra) {
  const t = BY_CLASS.get(cls);
  if (!t) throw new Error('build-crossref: sweep defect classified as unknown class "' + cls + '" (a class with no taxonomy row is a bug in the classifier, not a silent pass).');
  return Object.assign({
    class: cls,
    caution_pointer: t.caution && t.caution.length ? t.caution[0] : 'NONE',
    catching_gate: t.catching_gate,
    status: t.status,
  }, extra);
}

// assertValidClusterCount(sweep) -> the cluster-metadata gate, factored out. sweep.clusters is REQUIRED
// and must be a non-negative integer: a missing, non-numeric, negative or fractional cluster count is
// rejected (fail closed), NEVER treated as an optional check to skip. Line ~194 publishes sweep.clusters
// as the declared cluster count, so a malformed value must never reach the cross-reference at all.
function assertValidClusterCount(sweep) {
  if (!Number.isInteger(sweep.clusters) || sweep.clusters < 0) {
    throw new Error('build-crossref: sweep.clusters must be a non-negative integer (missing/non-numeric/negative/fractional cluster metadata fails closed, never optional-skip); got ' + JSON.stringify(sweep.clusters) + '.');
  }
  if (sweep.findings.length !== sweep.clusters) {
    throw new Error('build-crossref: sweep metadata is inconsistent - findings.length=' + sweep.findings.length
      + ' but metadata claims clusters=' + sweep.clusters + '. A truncated findings array must not produce a crossref asserting the original cluster count.');
  }
}

// assertSweepConsistent(sweep) -> throws when the sweep JSON is truncated or its metadata disagrees
// with its findings. A truncated findings array must never silently produce a crossref that still
// claims the original cluster count (CR: reject inconsistent input before emitting the cross-ref).
function assertSweepConsistent(sweep) {
  if (!sweep || typeof sweep !== 'object') {
    throw new Error('build-crossref: sweep JSON is not an object.');
  }
  if (!Array.isArray(sweep.findings)) {
    throw new Error('build-crossref: sweep.findings is not an array; refusing to build a crossref from malformed sweep output.');
  }
  assertValidClusterCount(sweep);
}

// collectDefects(sweep) -> the full defect list: the classified sweep clusters, the 5 domain-gate
// classes (engine-semantic defects no marketplace tool found), and the 6 ACT items (>=2 tools agree,
// recorded as their own entries so the ledger names them directly).
function collectDefects(sweep) {
  const defects = [];
  sweep.findings.forEach((f, i) => {
    defects.push(entryFor(classForSweep(f), {
      id: 'SW-' + String(i + 1).padStart(4, '0'),
      source: 'sweep',
      act: (f.corroboration || 0) >= 2,
      severity: f.severity,
      category: f.category,
      corroboration: f.corroboration || 0,
      tools: f.tools || [],
      path: f.path,
      message: f.message,
      fingerprint: f.fingerprint,
    }));
  });
  for (const dg of DOMAIN_GATES) {
    defects.push(entryFor(dg.class, {
      id: dg.id, source: 'domain-gate', act: true, severity: dg.past_severity,
      path: 'digest-findings-bible.md §12', message: dg.name + ': ' + dg.note,
    }));
  }
  for (const a of ACT) {
    defects.push(entryFor(a.class, {
      id: a.id, source: 'act', act: true, severity: a.past_severity, path: a.path, message: a.note,
    }));
  }
  return defects;
}

// buildTaxonomyRollup(defects) -> one row per class carrying the caution pointers it distils and its
// defect count. This is the structure check.js validates (catching_gate present and pointing at a
// real or phase-owned file).
function buildTaxonomyRollup(defects) {
  const counts = {};
  for (const d of defects) counts[d.class] = (counts[d.class] || 0) + 1;
  return TAXONOMY.map((t) => ({
    class: t.class,
    description: t.description,
    catching_gate: t.catching_gate,
    status: t.status,
    phase: t.phase,
    past_severity: t.past_severity,
    shipped_to_client: t.shipped,
    caution_pointers: t.caution,
    defect_count: counts[t.class] || 0,
  }));
}

function build(sweepPath) {
  const sweep = JSON.parse(fs.readFileSync(sweepPath, 'utf8'));
  assertSweepConsistent(sweep);

  const defects = collectDefects(sweep);
  const taxonomy = buildTaxonomyRollup(defects);

  return {
    _README: 'The historical-failure crossref. Every distinct defect from the old estate mapped to a failure class, the caution.md pointer it distils, the gate in THIS repo that catches its class, and whether that gate is live (guarded) or planned (gap). Regenerate with: npm run history:build. Validated by: npm run history.',
    generated_at: new Date().toISOString().slice(0, 10),
    sources: [
      'sweep-findings.json (' + sweep.raw_findings + ' raw -> ' + sweep.after_dedupe + ' deduped -> ' + sweep.clusters + ' clusters, ' + sweep.act + ' ACT)',
      'docs/discovery/digest-findings-bible.md (§0 ACT, §12 domain gates, §13 dismissals)',
      'caution.md (C-001..C-202)',
      'CONSTITUTION.md (Part III gate map)',
    ],
    totals: {
      defects: defects.length,
      classes: taxonomy.length,
      guarded_classes: taxonomy.filter((t) => t.status === 'guarded').length,
      gap_classes: taxonomy.filter((t) => t.status === 'gap').length,
      act: defects.filter((d) => d.act).length,
    },
    classification_note: 'Sweep defects are triaged category->class with a message-keyword refinement for the "other" bucket (see build-crossref.js). This is best-effort triage of tool output; the load-bearing contract is the class->gate mapping, enforced by check.js.',
    taxonomy,
    defects,
  };
}

// printExplain(doc) -> the --explain audit dump: one line per class with its status and defect count.
function printExplain(doc) {
  const byClass = {};
  for (const d of doc.defects) (byClass[d.class] = byClass[d.class] || []).push(d.id);
  for (const t of doc.taxonomy) console.log((t.status === 'gap' ? 'GAP  ' : 'guard') + ' ' + t.class.padEnd(26) + ' ' + String(t.defect_count).padStart(3) + '  ' + t.catching_gate);
}

// runCheckMode(outPath, json, doc) -> --check: diff the freshly-built JSON against the committed file
// (ignoring generated_at) and exit 1 if stale, 0 if current. Never returns (always exits).
function runCheckMode(outPath, json, doc) {
  if (!fs.existsSync(outPath)) { console.error('crossref.json missing at ' + outPath); process.exit(1); }
  const current = fs.readFileSync(outPath, 'utf8');
  const norm = (s) => s.replace(/"generated_at":\s*"[^"]*"/, '"generated_at":"X"');
  if (norm(current) !== norm(json)) {
    console.error('crossref.json is STALE: rebuild with `npm run history:build`. The committed file does not match the sources.');
    process.exit(1);
  }
  console.log('crossref.json is up to date (' + doc.totals.defects + ' defects, ' + doc.totals.classes + ' classes).');
  process.exit(0);
}

// writeCrossref(outPath, json, doc) -> write the built crossref to disk and report the totals.
function writeCrossref(outPath, json, doc) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json);
  console.log('wrote ' + outPath + ': ' + doc.totals.defects + ' defects, ' + doc.totals.classes + ' classes (' + doc.totals.guarded_classes + ' guarded, ' + doc.totals.gap_classes + ' gap), ' + doc.totals.act + ' ACT.');
}

function main() {
  const args = process.argv.slice(2);
  const sweepIdx = args.indexOf('--sweep');
  if (sweepIdx < 0) {
    console.error('usage: build-crossref.js --sweep <sweep-findings.json> [--out <path>] [--check] [--explain]');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;
  const doc = build(args[sweepIdx + 1]);
  const json = JSON.stringify(doc, null, 2) + '\n';

  if (args.includes('--explain')) printExplain(doc);
  if (args.includes('--check')) runCheckMode(outPath, json, doc);
  writeCrossref(outPath, json, doc);
}

if (require.main === module) main();
module.exports = { build, classForSweep, classifyOther, assertSweepConsistent };
