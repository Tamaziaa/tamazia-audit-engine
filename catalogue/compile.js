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
//      repo exists to stop (Constitution Rule 14: provenance-mandatory catalogue rows). A pack
//      WHOSE cell does not match its own filename, or whose sidecar exists but does not START with
//      a valid, CURRENT machine-readable qa-approval header binding it to the pack's exact sha256
//      (CR-2/CR-3 - see discoverPacks()'s own header), is a WORSE state than "no sidecar yet" and
//      REFUSES compilation outright (CompileError), never a silent exclude.
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
// CLI: node catalogue/compile.js (--stamp <ISO8601> | --stamp-file <path>) [--out <path>] [--packs <dir>]
//   node catalogue/compile.js --print-hashes [--packs <dir>]
//   --packs overrides catalogue/packs/ (default) with any directory of *.json pack files -
//   PACKS_DIR is a module-level constant elsewhere in this file precisely so nothing downstream
//   ever points it somewhere else by accident, but the CLI itself needs to be exercisable
//   end-to-end against an isolated fixture directory (compile.test.js's CLI smoke tests inject it
//   this way rather than driving exported helper functions directly, so the real argv parsing,
//   stamp validation and CLI error boundary are all actually exercised - caution.md C-148).
//   Exactly one of --stamp or --stamp-file is REQUIRED for a real compile. There is no wall-clock
//   fallback: an artifact with no supplied stamp is a build this compiler refuses to produce, not a
//   build it silently timestamps for you. --stamp-file points at a COMMITTED file (RELEASE_STAMP at
//   the repo root, by convention) whose trimmed contents are the stamp - CI uses this so bumping the
//   release stamp is a one-line, reviewable file edit, never a hardcoded workflow literal (CR-1).
//   --print-hashes is a separate utility mode, independent of --stamp/--stamp-file: it prints every
//   catalogue/packs/*.json file's current sha256 so a human can stamp (or re-stamp) the matching
//   .QA.md sidecar's approval header after reviewing it.
//
// Exit codes: 0 = artifact written (or hashes printed); 1 = refused (bad args, no compilable packs, or an
// error-severity finding). Every refusal is a THROWN CompileError caught once at the CLI boundary
// in main() (never a bare process.exit() buried inside a library function) so every exported
// function below stays a plain, testable function: node:test can call discoverPacks() or
// runLinterFleet() directly and assert on a thrown CompileError instead of losing the whole test
// process to an exit call three stack frames down.

const fs = require('fs');
const path = require('path');

const schema = require('./schema.js');
const citationCompleteness = require('./linters/citation-completeness.js');
const polarity = require('./linters/polarity.js');
const regexHealth = require('./linters/regex-health.js');
const thresholdGuard = require('./linters/threshold-guard.js');
const safePath = require('../tools/lib/safe-path.js');
const qaApproval = require('./qa-approval.js');
const { sha256Hex, computePackSha, QA_APPROVAL_RX, parseQaApprovalHeader } = qaApproval;
const compileArgs = require('./compile-args.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(REPO_ROOT, 'catalogue', 'packs');
const DEFAULT_OUT = path.join(REPO_ROOT, 'catalogue', 'dist', 'catalogue.v1.json');
const CATALOGUE_VERSION = 'v1.0.0-p2';
const EXCLUDED_STATUSES = ['rejected_qa', 'needs_verification'];

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

// parseArgs/resolveStamp/assertValidStamp: thin wrappers over catalogue/compile-args.js, binding
// in this file's own DEFAULT_OUT, REPO_ROOT and CompileError so every external caller (the CLI in
// main() below, and catalogue/compile.test.js via `compile.parseArgs` etc.) keeps the exact same
// call signature it always had - see compile-args.js for the actual argument-parsing/stamp-
// resolution logic and its own doc comments.
function parseArgs(argv) {
  return compileArgs.parseArgs(argv, DEFAULT_OUT, CompileError);
}

function resolveStamp(stamp, stampFile) {
  return compileArgs.resolveStamp(stamp, stampFile, REPO_ROOT, CompileError);
}

function assertValidStamp(stamp) {
  return compileArgs.assertValidStamp(stamp, CompileError);
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

// listPackFiles(packsDir = PACKS_DIR) -> [{cellName, absPath, relPath}] for every catalogue/packs/*.json
// file, REGARDLESS of whether it has a QA sidecar or a valid approval header. This is deliberately
// independent of discoverPacks(): --print-hashes exists to produce the sha256 a human embeds in a
// NOT-YET-WRITTEN (or just-updated) .QA.md approval block, so it must work on a pack discoverPacks()
// would currently refuse.
function listPackFiles(packsDir) {
  const dir = packsDir || PACKS_DIR;
  if (!fs.existsSync(dir)) throw new CompileError(path.relative(REPO_ROOT, dir) + ' does not exist');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const cellName = file.slice(0, -'.json'.length);
      const absPath = safePath.safeJoin(dir, [file], { label: 'catalogue pack filename', ErrorClass: CompileError });
      return { cellName, absPath, relPath: path.relative(REPO_ROOT, absPath).replace(/\\/g, '/') };
    });
}

// readAndValidatePackFile(absPath, relPath, cellName) -> the parsed pack object, or throws
// CompileError on an unreadable file, invalid JSON, wrong shape, or a cell mismatch (CR-3: a pack
// signed off under one identity must never compile under another). Split out of discoverPacks so
// each stage of "read this pack file" stays a small, independently readable unit.
function readAndValidatePackFile(absPath, relPath, cellName) {
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
  if (pack.cell !== cellName) {
    throw new CompileError(
      relPath + ': pack.cell ' + JSON.stringify(pack.cell) + ' must match its filename-derived cell '
      + JSON.stringify(cellName) + ' - a pack signed off under one identity must never compile under another (CR-3)'
    );
  }
  return pack;
}

// discoverPacks(packsDir = PACKS_DIR) -> { included: [{cellName, absPath, relPath, pack}], excluded: [{cell, source, reason}] }
// packsDir is injectable so node:test can point this at an isolated fixture directory instead of
// the real catalogue/packs/ (compile.test.js never writes into the real packs directory).
// A missing sidecar is the modelled EXCLUDED state (recorded, loud, never thrown). A pack that
// HAS a sidecar but cannot be read or parsed as JSON, or whose sidecar does not carry a valid,
// CURRENT machine-readable QA-approval header (CR-2/CR-3, verified by catalogue/qa-approval.js's
// verifyQaApproval), is a worse state than "no sidecar yet" - it claims legal QA sign-off over
// content that cannot even be verified - so that throws CompileError.
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
    const qaSidecarAbs = safePath.safeJoin(dir, [cellName + '.QA.md'], { label: 'catalogue QA sidecar filename', ErrorClass: CompileError });
    const absPath = safePath.safeJoin(dir, [file], { label: 'catalogue pack filename', ErrorClass: CompileError });
    const relPath = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
    const relQaPath = path.relative(REPO_ROOT, qaSidecarAbs).replace(/\\/g, '/');

    if (!fs.existsSync(qaSidecarAbs)) {
      console.warn(
        'pack excluded: no legal-QA sidecar - cell ' + JSON.stringify(cellName)
        + ' has no ' + relQaPath
        + '; this pack is NOT compiled and NONE of its records can reach the artifact until a human legal-QA sign-off lands the sidecar (see catalogue/README.md)'
      );
      excluded.push({ cell: cellName, source: relPath, reason: 'no legal-QA sidecar' });
      continue;
    }

    const pack = readAndValidatePackFile(absPath, relPath, cellName);
    qaApproval.verifyQaApproval(absPath, qaSidecarAbs, relPath, relQaPath, CompileError);

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
  for (const { mod } of LINTER_FLEET) {
    // A parse error means a linter's own loader could not read a file this compiler already parsed
    // successfully above. Each linter's own scan() now folds its parseErrors into the SAME
    // violations array its content checks use (catalogue/linters/lib.js's parseErrorViolations,
    // CR-7), so mod.toFindings(result.violations) already carries them through as error-severity
    // findings - there is exactly one door for that conversion, not a second copy living here.
    const result = mod.scan(includedAbsPaths);
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

// collectRecords(included) -> {records, cells, recordsTotal, recordsExcluded, excludedByStatus}
// Walks every included pack's records exactly once, splitting shipped records from excluded ones
// and building the per-cell summary rows in the same pass. Extracted out of assembleArtifact so
// the "one pass over every record" logic is a single, independently readable unit.
function collectRecords(included) {
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

  return { records, cells, recordsTotal, recordsExcluded, excludedByStatus };
}

// sortRecords/buildCells: deterministic ordering (records by id, cells by cell name). id is
// unique across the whole artifact - crossPackDuplicateIds() is checked before assembleArtifact
// runs - so records is a total order.
function sortRecords(records) {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildCells(cells) {
  return [...cells].sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0));
}

// computeContentHash(artifactCore) -> sha256 hex of the artifact's own canonical JSON. THE one
// function that decides what goes into the hash, so assembleArtifact's callers never need to know
// canonicalStringify/sha256Hex are involved at all.
function computeContentHash(artifactCore) {
  return sha256Hex(canonicalStringify(artifactCore));
}

// assembleArtifact(included, excluded, stamp) -> the full artifact object (content_hash computed
// and included). Caller (main() or a test) is responsible for having already confirmed zero
// error-severity findings - this function does not itself re-check that, it only assembles.
function assembleArtifact(included, excluded, stamp) {
  const { records, cells, recordsTotal, recordsExcluded, excludedByStatus } = collectRecords(included);
  const sortedCells = buildCells(cells);
  const sortedRecords = sortRecords(records);

  const counts = {
    packs_scanned: included.length + excluded.length,
    packs_compilable: included.length,
    packs_excluded: excluded.length,
    packs_excluded_detail: excluded,
    records_scanned: recordsTotal,
    records_included: sortedRecords.length,
    records_excluded: recordsExcluded,
    records_excluded_by_status: excludedByStatus,
  };

  const artifactCore = {
    catalogue_version: CATALOGUE_VERSION,
    generated: stamp,
    cells: sortedCells,
    counts,
    records: sortedRecords,
  };
  const content_hash = computeContentHash(artifactCore);
  return {
    catalogue_version: artifactCore.catalogue_version,
    generated: artifactCore.generated,
    content_hash,
    cells: artifactCore.cells,
    counts: artifactCore.counts,
    records: artifactCore.records,
  };
}

// runPrintHashesMode(packsDir) -> prints every pack's current sha256 so a human can stamp (or
// re-stamp) its .QA.md approval header, then returns. Deliberately independent of
// --stamp/discoverPacks() - it must work on a pack that does not yet have a valid approval (that
// is the whole point of the mode). Split out of main() purely to keep main()'s own body short.
function runPrintHashesMode(packsDir) {
  const files = listPackFiles(packsDir || undefined);
  console.log('catalogue/compile.js --print-hashes: sha256 of each catalogue/packs/*.json file');
  console.log('(embed as pack_sha256 in the matching .QA.md sidecar\'s leading <!-- qa-approval ... --> block)');
  for (const f of files) {
    console.log(f.cellName + '  ' + computePackSha(f.absPath) + '  ' + f.relPath);
  }
}

// reportFindings(included, excluded, findings) -> prints the summary/warning/error lines and
// throws CompileError if any error-severity finding is present; returns (void) otherwise. This is
// the exact reporting behaviour main() used to inline, now callable and testable on its own.
function reportFindings(included, excluded, findings) {
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
  if (errors.length === 0) return;
  for (const e of errors) console.error('  ERROR [' + e.tool + '/' + e.ruleId + '] ' + e.file + ': ' + e.message);
  throw new CompileError(
    errors.length + ' error-severity finding(s) above; compilation refused (fail closed, Constitution Rule 4 + Rule 14). '
    + 'This compiler never waters down a schema rule or a linter to make a real finding disappear - fix the source pack, or the pack\'s legal-QA sign-off, then re-run.'
  );
}

function main() {
  try {
    const { stamp, stampFile, out, packsDir, printHashes, unknown } = parseArgs(process.argv);
    if (unknown.length) throw new CompileError('unknown argument(s): ' + unknown.join(', '));

    if (printHashes) {
      runPrintHashesMode(packsDir);
      process.exit(0);
    }

    const resolvedStamp = resolveStamp(stamp, stampFile);
    assertValidStamp(resolvedStamp);

    const { included, excluded } = discoverPacks(packsDir || undefined);
    if (included.length === 0) {
      throw new CompileError('zero compilable packs found under catalogue/packs/ (every pack excluded for missing a legal-QA sidecar, or the directory is empty)');
    }

    const findings = collectFindings(included);
    reportFindings(included, excluded, findings);

    const artifact = assembleArtifact(included, excluded, resolvedStamp);
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
  computePackSha,
  parseQaApprovalHeader,
  QA_APPROVAL_RX,
  listPackFiles,
  discoverPacks,
  validateShapes,
  runLinterFleet,
  crossPackDuplicateIds,
  collectFindings,
  assembleArtifact,
  parseArgs,
  resolveStamp,
  assertValidStamp,
};
