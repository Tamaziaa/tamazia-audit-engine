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
const safePath = require('../tools/lib/safe-path.js');
const { isRealTimestamp } = require('./valid-date.js');

const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// VALUE_FLAGS: the flags that consume the NEXT token as their value, each a named handler that writes
// the parsed value onto the accumulating state object. A dispatch table keeps parseArgs a flat loop
// (one lookup, not a long if/else-if chain) while every branch stays a tiny, independently readable
// unit. --stamp-file/--out/--packs route their raw path through the single safe-path door before use.
const VALUE_FLAGS = {
  '--stamp': (state, value) => { state.stamp = value; },
  '--stamp-file': (state, value, ErrorClass) => {
    state.stampFile = safePath.assertSafeRelativePath(value || '', { label: '--stamp-file', ErrorClass });
  },
  '--out': (state, value, ErrorClass) => {
    state.out = safePath.resolveSafeRelativePath(process.cwd(), value || '', { label: '--out', ErrorClass });
  },
  '--packs': (state, value, ErrorClass) => {
    state.packsDir = safePath.resolveSafeRelativePath(process.cwd(), value || '', { label: '--packs', ErrorClass });
  },
};

// parseArgs(argv, defaultOut, ErrorClass): --stamp <ISO8601> and --stamp-file <path> are two ways
// to supply the SAME thing (the artifact's "generated" value); at most one may be given
// (resolveStamp below throws on a conflicting pair). --print-hashes is a separate utility mode
// (see listPackFiles/computePackSha in compile.js) that needs neither: it exists to produce the
// sha256 a human embeds in a .QA.md approval header, which by definition happens BEFORE that
// header exists.
// consumeFlagValue(args, i, flag, ErrorClass) -> the token following a value flag. A value flag must
// never consume the NEXT FLAG as its value: "--out --print-hashes" would otherwise treat
// "--print-hashes" as the output path and complete the wrong operation.
function consumeFlagValue(args, i, flag, ErrorClass) {
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ErrorClass(flag + ' requires a value, got ' + (value === undefined ? 'end of arguments' : JSON.stringify(value)));
  }
  return value;
}

function parseArgs(argv, defaultOut, ErrorClass) {
  const args = argv.slice(2);
  const state = { stamp: null, stampFile: null, out: defaultOut, packsDir: null, printHashes: false, unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--print-hashes') { state.printHashes = true; continue; }
    const handler = VALUE_FLAGS[flag];
    if (!handler) { state.unknown.push(flag); continue; }
    handler(state, consumeFlagValue(args, i, flag, ErrorClass), ErrorClass);
    i += 1;
  }
  return state;
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
  // stampFile is USUALLY already relative (the --stamp-file CLI flag validates it via
  // assertSafeRelativePath in VALUE_FLAGS above before it ever reaches here), but this function is
  // also called directly with an absolute path (catalogue/compile.test.js's own resolveStamp unit
  // tests, and any future direct caller) - resolveSafeScanPath accepts both (absolute is used
  // directly; a relative one is traversal-guarded and resolved against repoRoot), matching
  // path.resolve(repoRoot, stampFile)'s original unrestricted-but-traversal-safe contract.
  const abs = safePath.resolveSafeScanPath(repoRoot, stampFile, { label: '--stamp-file', ErrorClass });
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
