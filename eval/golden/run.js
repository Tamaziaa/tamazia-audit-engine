#!/usr/bin/env node
'use strict';
// eval/golden/run.js - pinned-payload diff harness.
//
// Compares every golden payload in eval/golden/goldens/<cell>.payload.json field-by-field
// against a fresh build output <freshDir>/<cell>.payload.json. ANY difference fails the run
// (exit 1) unless goldens are explicitly re-accepted with --accept.
//
// Diffs are classified for the report into the load-bearing classes:
//   finding-counts  (counts.*, findings lengths, frameworks lengths, rulesChecked, confirmed)
//   fines           (exposure*, fine*, penalty*, projected.*)
//   names           (company, legal_name, regulator, meta.company)
//   laws            (law, framework names, citation)
//   other           (everything else - still a failure; a golden is a golden)
//
// Usage:
//   node eval/golden/run.js [--fresh <dir>] [--goldens <dir>] [--accept [cell ...]] [--json]
//
// The harness FAILS CLOSED: an empty or missing goldens directory is not a pass, it is a gate that
// exercised no oracle, and a confident zero from a gate that compared nothing is worse than no gate
// (Constitution Rule 4). --accept is the single explicit bootstrap that pins the first goldens.
// Both filename sets are compared: a fresh cell with no pinned golden is unreviewed truth and fails
// until it is accepted deliberately (a golden changes only via --accept).
//
// Exit codes: 0 = every golden matches its fresh counterpart and no fresh cell is unpinned, or --accept completed;
//             1 = at least one diff, a golden with no fresh counterpart, an unpinned fresh cell, or no goldens at all;
//             2 = usage error.

const fs = require('fs');
const path = require('path');

const GOLDENS_DIR = path.join(__dirname, 'goldens');
const FRESH_DIR = path.join(__dirname, 'fresh');
const MAX_DIFFS_PRINTED = 40;

// ---------- deep diff ----------

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function deepDiff(golden, fresh, prefix, out) {
  const tg = typeOf(golden);
  const tf = typeOf(fresh);
  if (tg !== tf) {
    out.push({ path: prefix || '(root)', golden: preview(golden), fresh: preview(fresh) });
    return;
  }
  if (tg === 'array') {
    if (golden.length !== fresh.length) {
      out.push({ path: `${prefix}.length`, golden: golden.length, fresh: fresh.length });
    }
    const n = Math.min(golden.length, fresh.length);
    for (let i = 0; i < n; i++) deepDiff(golden[i], fresh[i], `${prefix}[${i}]`, out);
    return;
  }
  if (tg === 'object') {
    const keys = new Set([...Object.keys(golden), ...Object.keys(fresh)]);
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (!(k in golden)) out.push({ path: p, golden: '(absent)', fresh: preview(fresh[k]) });
      else if (!(k in fresh)) out.push({ path: p, golden: preview(golden[k]), fresh: '(absent)' });
      else deepDiff(golden[k], fresh[k], p, out);
    }
    return;
  }
  if (golden !== fresh) {
    out.push({ path: prefix || '(root)', golden: preview(golden), fresh: preview(fresh) });
  }
}

function preview(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function classify(diffPath) {
  const p = diffPath.toLowerCase();
  if (/counts|findings|ruleschecked|confirmed|frameworksbinding|frameworksassessed|\.length/.test(p)) return 'finding-counts';
  if (/exposure|fine|penalt|projected/.test(p)) return 'fines';
  if (/company|legal_name|legalname|regulator/.test(p)) return 'names';
  if (/law|framework|citation|statute/.test(p)) return 'laws';
  return 'other';
}

// ---------- runner ----------

function listGoldens(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.payload.json')).sort();
}

// parseArgs(argv) -> {opts} on success, or {exitCode} on an unrecognised argument.
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { fresh: FRESH_DIR, goldens: GOLDENS_DIR, accept: false, acceptCells: [], json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fresh') opts.fresh = path.resolve(args[++i]);
    else if (a === '--goldens') opts.goldens = path.resolve(args[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--accept') {
      opts.accept = true;
      while (args[i + 1] && !args[i + 1].startsWith('--')) opts.acceptCells.push(args[++i]);
    } else {
      console.error(`Unknown argument: ${a}`);
      return { exitCode: 2 };
    }
  }
  return { opts };
}

// runAccept(opts) -> exit code. Copies fresh outputs over goldens (all cells, or the named ones).
function runAccept(opts) {
  const freshFiles = listGoldens(opts.fresh);
  if (freshFiles.length === 0) {
    console.error(`--accept: no fresh payloads found in ${opts.fresh}; nothing to accept.`);
    return 2;
  }
  const wanted = opts.acceptCells.length
    ? freshFiles.filter((f) => opts.acceptCells.includes(f.replace(/\.payload\.json$/, '')))
    : freshFiles;
  if (opts.acceptCells.length && wanted.length !== opts.acceptCells.length) {
    const found = new Set(wanted.map((f) => f.replace(/\.payload\.json$/, '')));
    const missing = opts.acceptCells.filter((c) => !found.has(c));
    console.error(`--accept: no fresh payload for cell(s): ${missing.join(', ')}`);
    return 2;
  }
  fs.mkdirSync(opts.goldens, { recursive: true });
  for (const f of wanted) {
    // Re-serialise so goldens are canonical (2-space, trailing newline) regardless of builder formatting.
    const data = JSON.parse(fs.readFileSync(path.join(opts.fresh, f), 'utf8'));
    fs.writeFileSync(path.join(opts.goldens, f), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`ACCEPTED ${f} (fresh -> golden)`);
  }
  console.log(`Re-accepted ${wanted.length} golden(s). Commit the goldens/ change deliberately - it is a truth change.`);
  return 0;
}

// compareCell(f, opts) -> one report.cells[] entry for a single golden filename (a coverage-
// regression error, an unreadable-JSON error, or a diffs[]/byClass tally).
function compareCell(f, opts) {
  const cell = f.replace(/\.payload\.json$/, '');
  const goldenPath = path.join(opts.goldens, f);
  const freshPath = path.join(opts.fresh, f);
  const entry = { cell, diffs: [], byClass: {}, error: null };
  if (!fs.existsSync(freshPath)) {
    entry.error = `no fresh build output at ${freshPath} - a pinned cell with no fresh counterpart is a coverage regression`;
    return entry;
  }
  let golden;
  let fresh;
  try {
    golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));
  } catch (e) {
    entry.error = `unreadable JSON: ${e.message}`;
    return entry;
  }
  deepDiff(golden, fresh, '', entry.diffs);
  for (const d of entry.diffs) {
    const c = classify(d.path);
    entry.byClass[c] = (entry.byClass[c] || 0) + 1;
  }
  return entry;
}

// buildReport(goldenFiles, opts) -> {cells[], failed} over every golden file, via compareCell.
function buildReport(goldenFiles, opts) {
  const report = { cells: [], failed: 0 };
  for (const f of goldenFiles) {
    const entry = compareCell(f, opts);
    if (entry.error || entry.diffs.length > 0) report.failed++;
    report.cells.push(entry);
  }
  return report;
}

// printCellLine(c) -> the one-cell (or one-cell-plus-diffs) console block for the human report.
function printCellLine(c) {
  if (c.error) {
    console.log(`FAIL ${c.cell}: ${c.error}`);
    return;
  }
  if (c.diffs.length === 0) {
    console.log(`OK   ${c.cell}: identical to golden`);
    return;
  }
  const classes = Object.entries(c.byClass).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`FAIL ${c.cell}: ${c.diffs.length} diff(s) [${classes}]`);
  for (const d of c.diffs.slice(0, MAX_DIFFS_PRINTED)) {
    console.log(`     ${d.path}\n       golden: ${d.golden}\n       fresh:  ${d.fresh}`);
  }
  if (c.diffs.length > MAX_DIFFS_PRINTED) console.log(`     ... ${c.diffs.length - MAX_DIFFS_PRINTED} more`);
}

// printReport(report, json) -> the CLI's human/--json output, unchanged from the original inline
// block in main().
function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const c of report.cells) printCellLine(c);
  if (report.failed === 0) {
    console.log(`RESULT: OK - ${report.cells.length} cell(s) match their goldens.`);
  } else {
    console.log(`RESULT: FAIL - ${report.failed} of ${report.cells.length} cell(s) diverge. If the fresh output is the new truth, re-accept explicitly: node eval/golden/run.js --accept [cell ...]`);
  }
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.exitCode) return parsed.exitCode;
  const { opts } = parsed;

  // --accept: copy fresh outputs over goldens (all cells, or the named ones). This is the only path
  // that may proceed with an empty goldens set - it is how the first goldens are pinned.
  if (opts.accept) return runAccept(opts);

  const goldenFiles = listGoldens(opts.goldens);
  const freshFiles = listGoldens(opts.fresh);

  // Fail closed: no goldens means the oracle was never exercised. This is a broken gate, not a pass.
  if (goldenFiles.length === 0) {
    console.error(`RESULT: FAIL - no goldens in ${opts.goldens}; the golden harness pinned nothing to compare (Constitution Rule 4: a gate that exercises no oracle is broken). Pin the fresh outputs deliberately: node eval/golden/run.js --accept [cell ...].`);
    return 1;
  }

  const report = buildReport(goldenFiles, opts);

  // Compare BOTH filename sets: a fresh cell with no pinned golden is a new truth that must be
  // accepted deliberately (goldens change only via --accept), never silently ignored.
  const goldenSet = new Set(goldenFiles);
  for (const f of freshFiles) {
    if (goldenSet.has(f)) continue;
    report.cells.push({
      cell: f.replace(/\.payload\.json$/, ''), diffs: [], byClass: {},
      error: 'fresh output has no pinned golden - accept it deliberately (node eval/golden/run.js --accept) before it can pass',
    });
    report.failed++;
  }

  printReport(report, opts.json);
  return report.failed === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { deepDiff, classify, listGoldens, parseArgs, buildReport, main };
