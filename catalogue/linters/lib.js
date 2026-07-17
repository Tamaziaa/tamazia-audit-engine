'use strict';
// catalogue/linters/lib.js - shared support for the catalogue linter fleet (citation-completeness,
// polarity, regex-health, threshold-guard). One door for "how a linter finds its input files and
// what shape a record is in", so four linters do not grow four slightly-different pack loaders
// (the clone class jscpd and tools/lib/fswalk.js already exist to stop elsewhere in this repo).
//
// Every linter accepts TWO input shapes over the SAME loader:
//   1. Real packs:   catalogue/packs/*.json, {cell, jurisdiction, generated, records: [COM record, ...]}
//   2. Calibration:  eval/calibration-known-bad/fixtures/*.json, a MIX of:
//        a) a full COM-shaped pack (a p2-* fixture this catalogue-linters build owns), or
//        b) a single bare COM record (no {cell,...} wrapper), or
//        c) a single LEGACY flat-rule record (framework_short/style/regex_pattern shape,
//           pre-dating the Compliance Object Model, seeded by an earlier phase and still wired
//           into eval/calibration-known-bad/run.js's CALIBRATIONS table under the names
//           rule-dead-regex.json / rule-polarity-inverted.json). This loader recognises all
//           three shapes so regex-health.js and polarity.js keep the pre-existing calibration
//           gate honest instead of silently reporting zero on a fixture shape they do not own.
//        d) anything else (a fixture belonging to a DIFFERENT gate, e.g. p1-sector-*.json,
//           payload-missing-fields.json) is recognised as "not a rule/record" and skipped -
//           a linter must never crash or invent a false finding on another gate's fixture.

const fs = require('fs');
const path = require('path');

const { runGateCli } = require('../../tools/lib/gate-cli');
const safePath = require('../../tools/lib/safe-path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PACK_GLOB = 'catalogue/packs/*.json';
const CALIBRATE_DIR = path.join('eval', 'calibration-known-bad', 'fixtures');

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

// ---------------------------------------------------------------------------------
// File resolution. Deliberately minimal (zero new npm deps): supports a bare directory
// (expands to its *.json files, non-recursive, sorted), a "<dir>/*.json" or "<dir>/*"
// glob, or a single literal file path. Anything else resolves to [] rather than throwing -
// the caller reports "0 files matched", never crashes on an odd argv.
// ---------------------------------------------------------------------------------
function resolveJsonFiles(patternOrDir) {
  const raw = String(patternOrDir || '');
  const wildcardMatch = raw.match(/^(.*)\/\*(\.[A-Za-z0-9]+)?$/);
  let dir;
  let ext = '.json';
  if (wildcardMatch) {
    dir = wildcardMatch[1];
    ext = wildcardMatch[2] || ''; // "<dir>/*" (no extension filter) vs "<dir>/*.json"
  } else {
    dir = raw;
  }
  // dir/raw are caller-supplied (a CLI positional, DEFAULT_PACK_GLOB, or CALIBRATE_DIR) - allowlist
  // them as safe RELATIVE paths (no ".." traversal segment) before they ever reach path.resolve.
  // An empty string is a legitimate "no directory named" case (falls through to the empty [] return
  // below) so it is exempted from the check rather than treated as unsafe.
  if (dir) safePath.assertSafeRelativePath(dir, { label: 'catalogue linter scan directory' });
  const absDir = path.resolve(REPO_ROOT, dir);
  if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
    return fs.readdirSync(absDir)
      .filter((f) => (ext ? f.endsWith(ext) : true))
      .filter((f) => f.endsWith('.json')) // this loader only ever parses JSON
      .sort()
      .map((f) => safePath.safeJoin(absDir, [f], { label: 'catalogue linter input file' }));
  }
  if (raw) safePath.assertSafeRelativePath(raw, { label: 'catalogue linter scan file' });
  const absFile = path.resolve(REPO_ROOT, raw);
  if (fs.existsSync(absFile) && fs.statSync(absFile).isFile()) return [absFile];
  return [];
}

// dirsOrPatterns: array of directory/glob/file strings (as passed by tools/lib/gate-cli.js's
// runGateCli, which supplies [CALIBRATE_DIR] under --calibrate and the caller's scanDirs
// otherwise). Returns a flat, de-duplicated, sorted absolute file list.
function resolveManyJsonFiles(dirsOrPatterns) {
  const set = new Set();
  for (const p of dirsOrPatterns || []) {
    for (const f of resolveJsonFiles(p)) set.add(f);
  }
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------------
// Shape detection + record extraction. Never throws: a file that fails to parse is
// reported back as a parseError entry (recorded, not swallowed - Constitution Rule 4)
// rather than aborting the whole scan, since one unrelated gate's malformed fixture
// must never take down every catalogue linter's calibration run.
// ---------------------------------------------------------------------------------
function isComRecordShape(obj) {
  return isPlainObject(obj)
    && typeof obj.id === 'string'
    && isPlainObject(obj.citation)
    && Array.isArray(obj.website_obligations);
}

function isLegacyRuleShape(obj) {
  return isPlainObject(obj)
    && typeof obj.regex_pattern === 'string'
    && (typeof obj.style === 'string' || typeof obj.framework_short === 'string');
}

// recordParseError(message) -> { parseError: message }. A pack/fixture JSON that cannot be read
// or parsed must surface as a typed, propagated error state, never be silently skipped
// (Constitution Rule 4). A bare `return { parseError }` reads as swallowing to the repo-wide
// swallow-gate AST scan (tools/swallow-gate/check.js), which only recognises a catch body that
// RETHROWS or calls a recognisable recorder; this named helper IS that recording call, and every
// caller (loadRecords below, and every linter's scan()) forwards parseErrors rather than dropping
// them.
function recordParseError(message) {
  return { parseError: message };
}

// recordsFromFile(absPath) -> { parseError } | { entries: [{ file, locator, record, shape }] }
// shape is 'com' or 'legacy'. locator is a human-readable position ("records[3]" or the bare
// filename) used to build traceable finding messages.
function recordsFromFile(absPath) {
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return recordParseError(rel + ': read failed: ' + e.message);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return recordParseError(rel + ': invalid JSON: ' + e.message);
  }

  const entries = [];
  if (isPlainObject(parsed) && Array.isArray(parsed.records)) {
    parsed.records.forEach((record, i) => {
      if (isComRecordShape(record)) {
        entries.push({ file: rel, locator: rel + ':records[' + i + ']', record, shape: 'com', pack: parsed });
      }
      // a records[] entry that is neither COM-shaped nor relevant is silently skipped: schema.js
      // is the door for "is this a well-formed record at all", not this loader.
    });
    return { entries };
  }
  if (isComRecordShape(parsed)) {
    entries.push({ file: rel, locator: rel, record: parsed, shape: 'com', pack: null });
    return { entries };
  }
  if (isLegacyRuleShape(parsed)) {
    entries.push({ file: rel, locator: rel, record: parsed, shape: 'legacy', pack: null });
    return { entries };
  }
  return { entries: [] }; // recognisably not a rule/record fixture - belongs to another gate
}

// loadRecords(dirsOrPatterns) -> { entries: [...], parseErrors: [...] }
function loadRecords(dirsOrPatterns) {
  const files = resolveManyJsonFiles(dirsOrPatterns);
  const entries = [];
  const parseErrors = [];
  for (const f of files) {
    const r = recordsFromFile(f);
    if (r.parseError) parseErrors.push(r.parseError); // RECORDED, never thrown past the caller
    else entries.push(...r.entries);
  }
  return { entries, parseErrors, filesScanned: files.length };
}

// parseErrorViolations(parseErrors) -> violation[] in the SAME uniform {file, locator, id, rule,
// message} shape every linter's own content-check violations already use. Every catalogue linter's
// scan() folds this straight into the violations array it returns (never a side channel the CLI
// forgets to look at) so a file that could not even be READ fails the gate through the exact same
// path a real content defect does (Constitution Rule 4/CR-7): before this existed, a linter whose
// ONLY problem that run was an unreadable/unparseable file returned zero violations and exited 0 -
// a gate that never actually looked at a file is not the same as a gate that found nothing wrong.
// `file` is recovered from the loader's own "rel: reason" string shape (recordParseError above);
// this stays backward-compatible with any caller still reading the raw parseErrors string array.
function parseErrorViolations(parseErrors) {
  return (parseErrors || []).map((pe) => {
    const sepIdx = pe.indexOf(': ');
    const file = sepIdx === -1 ? pe : pe.slice(0, sepIdx);
    const reason = sepIdx === -1 ? pe : pe.slice(sepIdx + 2);
    return { file, locator: file, id: '<parse-error>', rule: 'linter-parse-error', message: reason };
  });
}

// ---------------------------------------------------------------------------------
// Host allowlist matching: host === suffix, or host ends with "." + suffix. Used by
// citation-completeness.js against its OFFICIAL_HOSTS export.
// ---------------------------------------------------------------------------------
function hostMatchesAllowlist(host, allowlist) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  return (allowlist || []).some((suffix) => {
    const s = String(suffix).toLowerCase();
    return h === s || h.endsWith('.' + s);
  });
}

function urlHost(u) {
  try { return new URL(u).hostname; }
  catch (e) { return null; /* FAIL-OPEN: an unparsable URL is reported by the caller as its own finding, not derived here */ }
}

// ---------------------------------------------------------------------------------
// runLinterCli(linter, name, opts) - the CLI tail shared by every catalogue linter's main(): parse
// argv for an optional positional pack glob (ignoring --calibrate/--json and the --json value),
// default to DEFAULT_PACK_GLOB, and hand off to tools/lib/gate-cli's runGateCli. `linter` is
// {selfTest, scan, toFindings} (pass the linter's own top-level functions, never `module.exports`
// - main() typically runs before the bottom-of-file `module.exports = {...}` assignment executes).
// Three of the four linters (citation-completeness, polarity, threshold-guard) share the
// summary/calibrateSummary/violationLine wording verbatim (the jscpd clone this helper exists to
// clear); regex-health overrides summary/calibrateSummary via opts for its "honest zero" wording.
// Every linter still owns its own selfTest/scan/toFindings.
function runLinterCli(linter, name, opts) {
  const o = opts || {};
  const argv = process.argv.slice(2);
  const positional = argv.filter((a, i) => a !== '--calibrate' && a !== '--json' && argv[i - 1] !== '--json');
  const packGlob = positional[0] || DEFAULT_PACK_GLOB;

  runGateCli({
    name,
    selfTest: linter.selfTest,
    scan: linter.scan,
    toFindings: linter.toFindings,
    scanDirs: [packGlob],
    summary: o.summary || ((r) => r.scanned + ' record(s) scanned, ' + r.violations.length + ' violation(s)'
      + (r.parseErrors.length ? ' (' + r.parseErrors.length + ' file(s) unreadable: ' + r.parseErrors.join('; ') + ')' : '')),
    calibrateSummary: o.calibrateSummary || ((r) => r.scanned + ' fixture record(s) scanned, ' + r.violations.length + ' seeded violation(s) found'),
    violationLine: o.violationLine || ((v) => '[' + v.rule + '] ' + v.locator + ' (' + v.id + '): ' + v.message),
  });
}

// makeToFindings(toolName) -> (violations) => finding[]. The uniform normaliser-shaped finding
// every linter's toFindings() produces (tools/sweep/normalise.js's expected shape; another jscpd
// clone this helper exists to clear - all four linters carried this shape near-verbatim). `level`
// is 'error' unless the violation itself carries `severity: 'warning'` (polarity's
// negation-guard-needed, threshold-guard's typical-band-missing); a violation with no severity
// field (citation-completeness, regex-health) is always 'error'.
function makeToFindings(toolName) {
  return (violations) => violations.map((v) => ({
    tool: toolName,
    ruleId: v.rule,
    file: v.file,
    startLine: 0,
    endLine: 0,
    level: v.severity === 'warning' ? 'warning' : 'error',
    message: '[' + v.id + '] ' + v.locator + ': ' + v.message,
  }));
}

module.exports = {
  REPO_ROOT,
  DEFAULT_PACK_GLOB,
  CALIBRATE_DIR,
  isPlainObject,
  isComRecordShape,
  isLegacyRuleShape,
  resolveJsonFiles,
  resolveManyJsonFiles,
  recordsFromFile,
  loadRecords,
  parseErrorViolations,
  hostMatchesAllowlist,
  urlHost,
  runLinterCli,
  makeToFindings,
};
