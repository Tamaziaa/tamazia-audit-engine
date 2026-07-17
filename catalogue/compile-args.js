'use strict';
// catalogue/compile-args.js - CLI argument parsing and stamp resolution for catalogue/compile.js.
//
// Split out of compile.js purely to keep compile.js under the health-gate file-length cap
// (tools/health-gate/check.js): argument parsing and stamp resolution is a cohesive, self-
// contained concern with no dependency on pack discovery, schema validation or artifact assembly,
// so it earns its own module rather than padding out compile.js once the earlier long-function
// extractions and the catalogue/qa-approval.js split still left it oversized.
//
// Every export here is required straight back into catalogue/compile.js and wrapped so the
// external call signature (argv only / stamp+stampFile / stamp) is unchanged - catalogue/
// compile.test.js exercises these exclusively through `compile.*`, never through this file
// directly, precisely so that contract holds.
//
// ErrorClass is injected by every throwing function here rather than importing CompileError from
// compile.js, because compile.js requires this module - a reverse require would be a cycle. This
// is the same pattern catalogue/qa-approval.js's verifyQaApproval already uses.

const fs = require('fs');
const path = require('path');
const safePath = require('../tools/lib/safe-path.js');
const { isRealTimestamp } = require('./valid-date.js');

const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// parseArgs(argv, defaultOut, ErrorClass): --stamp <ISO8601> and --stamp-file <path> are two ways
// to supply the SAME thing (the artifact's "generated" value); at most one may be given
// (resolveStamp below throws on a conflicting pair). --print-hashes is a separate utility mode
// (see listPackFiles/computePackSha in compile.js) that needs neither: it exists to produce the
// sha256 a human embeds in a .QA.md approval header, which by definition happens BEFORE that
// header exists.
function parseArgs(argv, defaultOut, ErrorClass) {
  const args = argv.slice(2);
  let stamp = null;
  let stampFile = null;
  let out = defaultOut;
  let packsDir = null;
  let printHashes = false;
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stamp') { stamp = args[i + 1]; i += 1; }
    else if (args[i] === '--stamp-file') {
      stampFile = safePath.assertSafeRelativePath(args[i + 1] || '', { label: '--stamp-file', ErrorClass });
      i += 1;
    } else if (args[i] === '--out') {
      const raw = safePath.assertSafeRelativePath(args[i + 1] || '', { label: '--out', ErrorClass });
      out = path.resolve(process.cwd(), raw);
      i += 1;
    } else if (args[i] === '--packs') {
      const raw = safePath.assertSafeRelativePath(args[i + 1] || '', { label: '--packs', ErrorClass });
      packsDir = path.resolve(process.cwd(), raw);
      i += 1;
    } else if (args[i] === '--print-hashes') { printHashes = true; }
    else unknown.push(args[i]);
  }
  return { stamp, stampFile, out, packsDir, printHashes, unknown };
}

// resolveStamp(stamp, stampFile, repoRoot, ErrorClass) -> the ISO8601 string to use as the
// artifact's "generated" value. --stamp-file names a COMMITTED file (RELEASE_STAMP at the repo
// root, by convention) whose trimmed contents are the stamp - this is how CI derives a
// deterministic, reviewable "generated" value without falling back to Date.now() (Constitution
// Rule 15's doctrine applied to a build artifact, same as assertValidStamp's own header comment)
// while still letting a human bump it in one place as catalogue inputs change, rather than
// hand-editing a workflow file. Supplying both --stamp and --stamp-file with DIFFERENT values is
// refused rather than silently preferring one (Rule 4: no silently-resolved ambiguity).
function resolveStamp(stamp, stampFile, repoRoot, ErrorClass) {
  if (!stampFile) return stamp;
  const abs = path.resolve(repoRoot, stampFile);
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new ErrorClass('--stamp-file ' + JSON.stringify(stampFile) + ' could not be read: ' + e.message);
  }
  const trimmed = content.trim();
  if (stamp && stamp !== trimmed) {
    throw new ErrorClass(
      '--stamp ' + JSON.stringify(stamp) + ' conflicts with --stamp-file ' + JSON.stringify(stampFile)
      + ' (contains ' + JSON.stringify(trimmed) + ') - supply only one'
    );
  }
  return trimmed;
}

function assertValidStamp(stamp, ErrorClass) {
  if (!stamp) {
    throw new ErrorClass('--stamp <ISO8601> or --stamp-file <path> is required (e.g. --stamp 2026-01-01T00:00:00Z, or --stamp-file RELEASE_STAMP). This compiler never falls back to Date.now(): a shipped artifact\'s "generated" field must be exactly reproducible from the same inputs, every time, forever.');
  }
  if (!ISO_RX.test(stamp)) {
    throw new ErrorClass('--stamp ' + JSON.stringify(stamp) + ' does not match YYYY-MM-DDTHH:MM:SS(.sss)Z');
  }
  // Shape is not enough: reject an ISO-shaped string that names no real UTC instant (2026-02-30,
  // month 13, hour 25). The compiler's "generated" value must be an instant that actually existed.
  if (!isRealTimestamp(stamp)) {
    throw new ErrorClass('--stamp ' + JSON.stringify(stamp) + ' is ISO-shaped but names no real UTC instant (impossible calendar date or time)');
  }
}

module.exports = { ISO_RX, parseArgs, resolveStamp, assertValidStamp };
