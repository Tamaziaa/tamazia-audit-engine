#!/usr/bin/env node
'use strict';
/**
 * THE LOCAL ANALYSERS -> the one entry point.
 *
 * These encode what THIS engine is; no marketplace app replaces them:
 *   reachability   a module unreachable from the mint is dead law. On the old estate, statute-rag.js was
 *                  required for months and never called; 13 modules / 691 lines were dead.
 *   jscpd          textual clones (optional devDependency; skips loudly when absent).
 *   dep-cruiser    orphans + circulars (optional devDependency; skips loudly when absent).
 *
 * one-door and swallow-gate are their OWN tools (tools/one-door, tools/swallow-gate) and are invoked by
 * tools/sweep/run.js, not duplicated here. One door for one-door.
 *
 * A general-purpose tool finds code defects. These find DOMAIN defects. Neither substitutes for the other.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { listJsFiles } = require('../lib/fswalk');
const safePath = require('../lib/safe-path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'tools', 'sweep', 'out', 'sarif');
const TMP = path.join(ROOT, 'tools', 'sweep', 'out', 'tmp');

// Mint entrypoints of the NEW engine. mint/ is empty in P0; entries are armed the moment the files exist.
const ENTRIES = ['mint/worker.js', 'mint/index.js'];
const SCAN_DIRS = ['catalogue', 'evidence', 'facts', 'applicability', 'breach', 'llm', 'payload'];
// Clone and dependency hygiene also cover the tool fleet itself: the tools eat their own cooking.
const HYGIENE_DIRS = [...SCAN_DIRS, 'mint', 'render-proof', 'tools'];
// dirs is always one of SCAN_DIRS/HYGIENE_DIRS above (single-segment, repo-defined literal
// names): safeJoin makes that a checked PATH COMPONENT at the site (Rule 1) rather than trusting
// the literal-array shape silently.
const nonEmpty = (dirs) => dirs.filter((d) => listJsFiles(safePath.safeJoin(ROOT, [d], { label: 'sweep hygiene dir' })).length > 0);

const out = [];
const add = (o) => out.push(o);
// BIN_DIR is built from all-literal segments (path.join with no dynamic argument, so it is not
// itself a traversal-scanner sink); only `name` - always a literal devDependency bin name at the
// call sites below ('jscpd', 'depcruise') - is the dynamic PATH COMPONENT, and safeJoin routes it
// through the door instead of trusting that by convention alone.
const BIN_DIR = path.join(ROOT, 'node_modules', '.bin');
const hasBin = (name) => fs.existsSync(safePath.safeJoin(BIN_DIR, [name], { label: 'sweep bin lookup' }));
const runBin = (name, argsStr) => {
  try {
    return execSync(safePath.safeJoin(BIN_DIR, [name], { label: 'sweep bin lookup' }) + ' ' + argsStr, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128e6, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return (e.stdout || '').toString(); /* FAIL-OPEN: these analysers exit non-zero when they FIND things; their findings are on stdout and are ingested below. */
  }
};

// ── reachability from the mint entrypoints ──────────────────────────────────────────────────────────────────
// require() extraction is regex-based here (dependency-free). It over-approximates slightly (a require in a
// comment counts) but never under-approximates a live edge, which is the direction that matters: a false
// "reachable" is noise, a false "unreachable" would be a lie.
function requiresOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  const rx = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = rx.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  let base;
  try {
    // A require() specifier legitimately climbs directories ("../lib/foo") - resolveRepoRelative
    // is the require-specifier shape (unlike safeJoin/assertSafeRelativePath, it does not reject
    // "..") but still refuses a resolution that lands outside ROOT.
    base = safePath.resolveRepoRelative(ROOT, from, spec, { label: 'reachability require specifier' });
  } catch (e) {
    return null; // FAIL-OPEN: a specifier resolving outside the repo tree is not a live edge; treat as unresolved rather than crash the reachability walk.
  }
  for (const c of [base, base + '.js', base + '.cjs', safePath.safeJoin(base, ['index.js'], { label: 'reachability require specifier' })]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function reachability() {
  // ENTRIES is a hardcoded literal array of repo-relative paths ('mint/worker.js', ...):
  // resolveSafeRelativePath makes that validation visible instead of trusting the literal-array
  // shape silently.
  const entries = ENTRIES.map((e) => safePath.resolveSafeRelativePath(ROOT, e, { label: 'mint entrypoint' })).filter((p) => fs.existsSync(p));
  if (entries.length === 0) {
    console.log('  reachability: SKIPPED (no mint entrypoint exists yet: ' + ENTRIES.join(', ') + '). Armed the moment one lands.');
    return 0;
  }
  const reach = new Set();
  const walk = (f) => {
    if (reach.has(f)) return;
    reach.add(f);
    for (const s of requiresOf(f)) { const r = resolveSpec(f, s); if (r) walk(r); }
  };
  entries.forEach(walk);

  const dormant = fs.existsSync(path.join(ROOT, 'DORMANT.md')) ? fs.readFileSync(path.join(ROOT, 'DORMANT.md'), 'utf8') : '';
  const declared = new Set([...dormant.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1].trim()));

  for (const dir of SCAN_DIRS) {
    for (const p of listJsFiles(path.join(ROOT, dir), { skipTests: true })) {
      if (reach.has(p)) continue;
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (declared.has(rel)) continue;
      add({
        tool: 'reachability', ruleId: 'unreachable-from-mint', file: rel, startLine: 1, level: 'error',
        message: 'UNREACHABLE from any mint entrypoint and NOT declared in DORMANT.md. A module unreachable from the mint is dead law: reachable-or-DORMANT is constitutional.',
        snippet: 'module ' + rel + ' unreachable',
      });
    }
  }
  return reach.size;
}

// ── jscpd: textual clones ───────────────────────────────────────────────────────────────────────────────────
function clones() {
  if (!hasBin('jscpd')) { console.log('  jscpd: SKIPPED (not installed; add jscpd to devDependencies to arm this lane)'); return; }
  const targets = nonEmpty(HYGIENE_DIRS);
  if (targets.length === 0) { console.log('  jscpd: nothing to scan yet'); return; }
  fs.mkdirSync(TMP, { recursive: true });
  runBin('jscpd', targets.join(' ') + ' --min-tokens 50 --reporters json --output ' + TMP + ' --silent');
  const report = path.join(TMP, 'jscpd-report.json');
  if (!fs.existsSync(report)) { console.log('  jscpd: ran but wrote no report (treat as a failed lane, not zero clones)'); return; }
  const d = JSON.parse(fs.readFileSync(report, 'utf8'));
  for (const c of (d.duplicates || [])) {
    if (c.firstFile.name === c.secondFile.name) continue;
    // NO MINIMUM. Filtering clones below N lines and calling it boilerplate is deciding what you are allowed
    // to see. Every clone is reported; the reader decides what is noise.
    add({
      tool: 'jscpd', ruleId: 'clone', file: c.firstFile.name.replace(ROOT + '/', ''), startLine: c.firstFile.start,
      endLine: c.firstFile.end, level: 'warning',
      message: c.lines + '-line clone shared with ' + c.secondFile.name.split('/').pop(),
      snippet: (c.fragment || '').slice(0, 120),
    });
  }
}

// ── dep-cruiser: orphans + circulars ────────────────────────────────────────────────────────────────────────
function depcruise() {
  if (!hasBin('depcruise')) { console.log('  dependency-cruiser: SKIPPED (not installed; add dependency-cruiser to devDependencies to arm this lane)'); return; }
  const targets = nonEmpty(HYGIENE_DIRS);
  if (targets.length === 0) { console.log('  dependency-cruiser: nothing to scan yet'); return; }
  const j = runBin('depcruise', targets.join(' ') + ' --output-type json --no-config');
  let d;
  try { d = JSON.parse(j); }
  catch (e) { console.error('  dependency-cruiser: output not parseable, lane treated as FAILED not zero (' + e.message + ')'); return; }
  for (const m of (d.modules || [])) {
    if (m.orphan) add({ tool: 'dependency-cruiser', ruleId: 'orphan', file: m.source, startLine: 0, level: 'note',
      message: 'orphan module: nothing depends on it and it depends on nothing', snippet: m.source });
    for (const dep of (m.dependencies || [])) if (dep.circular) add({ tool: 'dependency-cruiser', ruleId: 'circular',
      file: m.source, startLine: 0, level: 'warning', message: 'circular dependency via ' + dep.resolved, snippet: m.source });
  }
}

function main() {
  const reached = reachability();
  clones();
  depcruise();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'local.local.json'), JSON.stringify(out, null, 2));
  console.log('  reachable from the mint entrypoints: ' + reached + ' modules');
  console.log('  local findings: ' + out.length);
  const byTool = {};
  for (const f of out) byTool[f.tool] = (byTool[f.tool] || 0) + 1;
  console.log('  ' + JSON.stringify(byTool));
}

if (require.main === module) main();
module.exports = { requiresOf, resolveSpec };
