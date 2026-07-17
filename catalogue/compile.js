#!/usr/bin/env node
'use strict';
// catalogue/compile.js - the P2 catalogue compiler.
//
// THE ONLY producer of catalogue/dist/catalogue.v1.json (Constitution Rule 1: one door - here the
// "fact" is the compiled artifact itself). Every consumer of law facts downstream (P3 breach/
// adjudicator, P4 render) reads this artifact; nothing downstream re-parses catalogue/packs/*.json
// directly, and nothing downstream re-derives what this file already decided.
//
// PIPELINE (fail closed at every stage - Constitution Rule 4):
//   1. Discover catalogue/packs/*.json. A pack is compilable ONLY if it has a same-named .QA.md
//      sidecar (the human legal-QA sign-off, caution.md's own "graduation" doctrine - see
//      catalogue/README.md). A pack with no sidecar is EXCLUDED with a loud log line; it is not a
//      soft warning, because shipping unreviewed legal content is exactly the class of defect this
//      repo exists to stop (Constitution Rule 14: provenance-mandatory catalogue rows).
//   2. Validate every included pack's SHAPE through catalogue/schema.js (the one door for record/
//      pack shape - this compiler never re-implements a shape check).
//   3. Run every catalogue linter (citation-completeness, polarity, regex-health, threshold-guard)
//      against the included packs ONLY (an excluded pack's content is never linted or shipped).
//   4. ANY error-severity finding (schema violation or linter error) REFUSES compilation: exit 1,
//      no artifact is written. Warnings are printed but do not block. This compiler never waters
//      down a linter or a schema rule to make a real defect disappear - it reports the finding
//      verbatim and stops (see catalogue/README.md "what a real finding means").
//   5. Assemble the artifact: records with status rejected_qa or needs_verification are EXCLUDED
//      from the shipped artifact (they stay in the source pack, logged) - only candidate rows that
//      passed every gate above ship. (P3+ promotes candidate -> a human-signed-off active state;
//      this compiler does not itself activate anything, see catalogue/README.md.)
//   6. Emit catalogue/dist/catalogue.v1.json: catalogue_version, generated (from --stamp, NEVER
//      Date.now() - Constitution Rule 15 doctrine applied here to a build artifact: a build dated
//      "now" that is really a rebuild of yesterday's inputs is not honest provenance), a
//      content_hash (sha256 of the artifact's OWN canonical JSON with content_hash itself excluded
//      from the hash), cells[], counts, and records[] sorted deterministically by id.
//
// CLI: node catalogue/compile.js --stamp <ISO8601> [--out <path>]
//   --stamp is REQUIRED. There is no wall-clock fallback: an artifact with no supplied stamp is a
//   build this compiler refuses to produce, not a build it silently timestamps for you.
//
// Exit codes: 0 = artifact written; 1 = refused (bad args, no compilable packs, or an
// error-severity finding). Every refusal is a THROWN CompileError caught once at the CLI boundary
// in main() (never a bare process.exit() buried inside a library function) so every exported
// function below stays a plain, testable function: node:test can call discoverPacks() or
// runLinterFleet() directly and assert on a thrown CompileError instead of losing the whole test
// process to an exit call three stack frames down.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const schema = require('./schema.js');
const citationCompleteness = require('./linters/citation-completeness.js');
const polarity = require('./linters/polarity.js');
const regexHealth = require('./linters/regex-health.js');
const thresholdGuard = require('./linters/threshold-guard.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(REPO_ROOT, 'catalogue', 'packs');
const DEFAULT_OUT = path.join(REPO_ROOT, 'catalogue', 'dist', 'catalogue.v1.json');
const CATALOGUE_VERSION = 'v1.0.0-p2';
const EXCLUDED_STATUSES = ['rejected_qa', 'needs_verification'];
const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Every linter in the fleet, run in a fixed order so console output and the findings list are
// deterministic across runs (Constitution Rule 4: a gate map is not theatre if it always fires the
// same way on the same input).
const LINTER_FLEET = [
  { name: 'citation-completeness', mod: citationCompleteness },
  { name: 'polarity', mod: polarity },
  { name: 'regex-health', mod: regexHealth },
  { name: 'threshold-guard', mod: thresholdGuard },
];

// CompileError: the ONE thrown shape this file uses to signal "refuse to compile". Deliberately a
// real Error subclass (not a plain object) so a genuine programmer bug (a TypeError from a typo)
// is never mistaken for a modelled refusal at the CLI boundary.
class CompileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompileError';
  }
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let stamp = null;
  let out = DEFAULT_OUT;
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stamp') { stamp = args[i + 1]; i += 1; }
    else if (args[i] === '--out') { out = path.resolve(process.cwd(), args[i + 1] || ''); i += 1; }
    else unknown.push(args[i]);
  }
  return { stamp, out, unknown };
}

function assertValidStamp(stamp) {
  if (!stamp) {
    throw new CompileError('--stamp <ISO8601> is required (e.g. --stamp 2026-01-01T00:00:00Z). This compiler never falls back to Date.now(): a shipped artifact\'s "generated" field must be exactly reproducible from the same inputs, every time, forever.');
  }
  if (!ISO_RX.test(stamp)) {
    throw new CompileError('--stamp ' + JSON.stringify(stamp) + ' does not match YYYY-MM-DDTHH:MM:SS(.sss)Z');
  }
}

// canonicalStringify(value) -> string
// Deterministic JSON: object keys sorted recursively, arrays kept in their given order (the
// caller is responsible for giving arrays a deterministic order before this is called - records
// are sorted by id, cells by cell name, in compileArtifact() below). This is the ONLY function
// that decides what "canonical" means for the content_hash, so a future format change has one door
// to update.
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// discoverPacks(packsDir = PACKS_DIR) -> { included: [{cellName, absPath, relPath, pack}], excluded: [{cell, source, reason}] }
// packsDir is injectable so node:test can point this at an isolated fixture directory instead of
// the real catalogue/packs/ (compile.test.js never writes into the real packs directory).
// A missing sidecar is the modelled EXCLUDED state (recorded, loud, never thrown). A pack that
// HAS a sidecar but cannot be read or parsed as JSON is a worse state than "no sidecar yet" - it
// claims legal QA sign-off over content that cannot even be loaded - so that throws CompileError.
function discoverPacks(packsDir) {
  const dir = packsDir || PACKS_DIR;
  if (!fs.existsSync(dir)) throw new CompileError(path.relative(REPO_ROOT, dir) + ' does not exist');
  const packFiles = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // deterministic discovery order

  const included = [];
  const excluded = [];

  for (const file of packFiles) {
    const cellName = file.slice(0, -'.json'.length);
    const qaSidecarAbs = path.join(dir, cellName + '.QA.md');
    const absPath = path.join(dir, file);
    const relPath = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');

    if (!fs.existsSync(qaSidecarAbs)) {
      console.warn(
        'pack excluded: no legal-QA sidecar - cell ' + JSON.stringify(cellName)
        + ' has no ' + path.relative(REPO_ROOT, qaSidecarAbs).replace(/\\/g, '/')
        + '; this pack is NOT compiled and NONE of its records can reach the artifact until a human legal-QA sign-off lands the sidecar (see catalogue/README.md)'
      );
      excluded.push({ cell: cellName, source: relPath, reason: 'no legal-QA sidecar' });
      continue;
    }

    let raw;
    try {
      raw = fs.readFileSync(absPath, 'utf8');
    } catch (e) {
      throw new CompileError(relPath + ': failed to read: ' + e.message);
    }
    let pack;
    try {
      pack = JSON.parse(raw);
    } catch (e) {
      throw new CompileError(relPath + ': invalid JSON: ' + e.message);
    }
    if (!isPlainObject(pack) || !Array.isArray(pack.records)) {
      throw new CompileError(relPath + ': pack has a legal-QA sidecar but is not a valid {cell, jurisdiction, generated, records:[]} pack shape');
    }
    included.push({ cellName, absPath, relPath, pack });
  }

  return { included, excluded };
}

// validateShapes(included) -> finding[] (schema.js is the one door for record/pack SHAPE; this
// function only translates schema.js's plain violation strings into the uniform finding shape the
// linter fleet already speaks, it invents no shape rule of its own)
function validateShapes(included) {
  const findings = [];
  for (const { relPath, pack, cellName } of included) {
    const violations = schema.validatePack(pack);
    for (const v of violations) {
      findings.push({
        tool: 'catalogue-schema', ruleId: 'schema-violation', file: relPath, level: 'error',
        message: '[' + cellName + '] ' + v,
      });
    }
  }
  return findings;
}

// runLinterFleet(includedAbsPaths) -> finding[]
// Every linter is called through its OWN scan()/toFindings() contract (catalogue/linters/lib.js is
// the shared loader; this file does not re-open or re-parse a pack for linting - it hands the
// already-discovered, already-included absolute paths straight to each linter).
function runLinterFleet(includedAbsPaths) {
  const findings = [];
  for (const { name, mod } of LINTER_FLEET) {
    const result = mod.scan(includedAbsPaths);
    if (result.parseErrors && result.parseErrors.length) {
      // A parse error here means a linter's own loader could not read a file compile.js already
      // parsed successfully above - recorded as a hard error, never silently skipped (Rule 4).
      for (const pe of result.parseErrors) {
        findings.push({ tool: 'catalogue-' + name, ruleId: 'linter-parse-error', file: pe, level: 'error', message: pe });
      }
    }
    for (const f of mod.toFindings(result.violations)) findings.push(f);
  }
  return findings;
}

// crossPackDuplicateIds(included) -> finding[]
// schema.validatePack() only catches a duplicate id WITHIN one pack (Rule 1: one door per fact);
// this compiler is the seam where several packs merge into ONE artifact, so a duplicate id ACROSS
// packs is a defect only visible here, not something any single-pack validator can ever see.
function crossPackDuplicateIds(included) {
  const findings = [];
  const seenAt = new Map();
  for (const { cellName, relPath, pack } of included) {
    for (const record of pack.records) {
      if (!isPlainObject(record) || typeof record.id !== 'string') continue;
      const prior = seenAt.get(record.id);
      if (prior) {
        findings.push({
          tool: 'catalogue-compile', ruleId: 'cross-pack-duplicate-id', file: relPath, level: 'error',
          message: 'record id ' + JSON.stringify(record.id) + ' in cell ' + JSON.stringify(cellName)
            + ' duplicates the same id already seen in cell ' + JSON.stringify(prior.cellName) + ' (' + prior.relPath + ') - one door per fact means one id per fact across the WHOLE compiled catalogue, not just within a pack',
        });
      } else {
        seenAt.set(record.id, { cellName, relPath });
      }
    }
  }
  return findings;
}

// collectFindings(included) -> finding[]
// The full fail-closed gate: schema shape + the linter fleet + cross-pack identity, in one call so
// both the CLI and node:test exercise the exact same aggregation logic.
function collectFindings(included) {
  const findings = [];
  findings.push(...validateShapes(included));
  findings.push(...runLinterFleet(included.map((p) => p.absPath)));
  findings.push(...crossPackDuplicateIds(included));
  return findings;
}

// assembleArtifact(included, excluded, stamp) -> the full artifact object (content_hash computed
// and included). Caller (main() or a test) is responsible for having already confirmed zero
// error-severity findings - this function does not itself re-check that, it only assembles.
function assembleArtifact(included, excluded, stamp) {
  const records = [];
  const cells = [];
  let recordsTotal = 0;
  let recordsExcluded = 0;
  const excludedByStatus = {};

  for (const { cellName, pack, relPath } of included) {
    let cellIncluded = 0;
    let cellExcluded = 0;
    for (const record of pack.records) {
      recordsTotal += 1;
      if (EXCLUDED_STATUSES.includes(record.status)) {
        recordsExcluded += 1;
        cellExcluded += 1;
        excludedByStatus[record.status] = (excludedByStatus[record.status] || 0) + 1;
        console.log('record excluded from artifact (stays in source pack): ' + record.id + ' (cell=' + cellName + ', status=' + record.status + ')');
        continue;
      }
      records.push(Object.assign({ cell: cellName }, record));
      cellIncluded += 1;
    }
    cells.push({
      cell: cellName,
      jurisdiction: pack.jurisdiction,
      pack_generated: pack.generated,
      source: relPath,
      records_total: pack.records.length,
      records_included: cellIncluded,
      records_excluded: cellExcluded,
    });
  }

  // deterministic ordering: cells by cell name, records by id (id is unique across the whole
  // artifact - crossPackDuplicateIds() is checked before this function runs - so this is a total order).
  cells.sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0));
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const counts = {
    packs_scanned: included.length + excluded.length,
    packs_compilable: included.length,
    packs_excluded: excluded.length,
    packs_excluded_detail: excluded,
    records_scanned: recordsTotal,
    records_included: records.length,
    records_excluded: recordsExcluded,
    records_excluded_by_status: excludedByStatus,
  };

  const artifactCore = {
    catalogue_version: CATALOGUE_VERSION,
    generated: stamp,
    cells,
    counts,
    records,
  };
  const content_hash = sha256Hex(canonicalStringify(artifactCore));
  return {
    catalogue_version: artifactCore.catalogue_version,
    generated: artifactCore.generated,
    content_hash,
    cells: artifactCore.cells,
    counts: artifactCore.counts,
    records: artifactCore.records,
  };
}

function main() {
  try {
    const { stamp, out, unknown } = parseArgs(process.argv);
    if (unknown.length) throw new CompileError('unknown argument(s): ' + unknown.join(', '));
    assertValidStamp(stamp);

    const { included, excluded } = discoverPacks();
    if (included.length === 0) {
      throw new CompileError('zero compilable packs found under catalogue/packs/ (every pack excluded for missing a legal-QA sidecar, or the directory is empty)');
    }

    const findings = collectFindings(included);
    const errors = findings.filter((f) => f.level === 'error');
    const warnings = findings.filter((f) => f.level !== 'error');

    console.log(
      'catalogue/compile.js: ' + included.length + ' pack(s) compilable ('
      + included.map((p) => p.cellName).join(', ') + '), ' + excluded.length + ' excluded, '
      + findings.length + ' finding(s): ' + errors.length + ' error, ' + warnings.length + ' warning'
    );
    for (const w of warnings) {
      console.warn('  WARNING [' + w.tool + '/' + w.ruleId + '] ' + w.file + ': ' + w.message);
    }
    if (errors.length > 0) {
      for (const e of errors) console.error('  ERROR [' + e.tool + '/' + e.ruleId + '] ' + e.file + ': ' + e.message);
      throw new CompileError(
        errors.length + ' error-severity finding(s) above; compilation refused (fail closed, Constitution Rule 4 + Rule 14). '
        + 'This compiler never waters down a schema rule or a linter to make a real finding disappear - fix the source pack, or the pack\'s legal-QA sign-off, then re-run.'
      );
    }

    const artifact = assembleArtifact(included, excluded, stamp);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n');

    console.log('catalogue/compile.js: wrote ' + path.relative(REPO_ROOT, out) + ' - ' + artifact.records.length + ' record(s) across ' + artifact.cells.length + ' cell(s), content_hash ' + artifact.content_hash.slice(0, 12) + '...');
    process.exit(0);
  } catch (e) {
    // The one catch in this file: RECORDS the failure (prints it) and fails closed (exit 1),
    // never swallows (Constitution Rule 4 / the silent-swallow gate). A CompileError is a modelled
    // refusal; anything else (a genuine programmer bug) is printed with its stack so it is loud,
    // not disguised as a modelled refusal.
    if (e instanceof CompileError) {
      console.error('catalogue/compile.js: REFUSED - ' + e.message);
    } else {
      console.error('catalogue/compile.js: UNEXPECTED ERROR (this is a bug, not a modelled refusal):');
      console.error(e.stack || e.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  CompileError,
  CATALOGUE_VERSION,
  EXCLUDED_STATUSES,
  PACKS_DIR,
  DEFAULT_OUT,
  canonicalStringify,
  sha256Hex,
  discoverPacks,
  validateShapes,
  runLinterFleet,
  crossPackDuplicateIds,
  collectFindings,
  assembleArtifact,
  parseArgs,
  assertValidStamp,
};
