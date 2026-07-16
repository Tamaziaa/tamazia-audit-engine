#!/usr/bin/env node
'use strict';
/**
 * SWALLOW-GATE: no failure may report success.
 *
 * A swallowed exception is how a failure reports success. The old estate was burned by this class repeatedly:
 * a coherence gate found 55 silent catches that an earlier regex had reported as 0. Every catch block in this
 * repo must do one of three things:
 *
 *   1. RETHROW            throw inside the catch body
 *   2. RECORD             call a recorder: _warn / warn / record* / addWarning / manifest.record /
 *                         logger.warn|error / console.warn|error / report* etc.
 *   3. JUSTIFY IN WRITING carry a "// FAIL-OPEN: <reason>" comment inside or immediately above the catch
 *
 * A bare `catch (e) {}` or `catch {}` always fails.
 *
 * Engine: AST walk via acorn when it is installed (add acorn to devDependencies to get the precise walk);
 * otherwise a hardened regex + brace-matching fallback that skips string and comment contexts. Both engines
 * fail non-zero on the same core class, and the self-test proves whichever engine is active can see it.
 *
 * Modes:
 *   node tools/swallow-gate/check.js                  scan the repo source tree, exit 1 on any violation
 *   node tools/swallow-gate/check.js --json <path>    also write findings JSON for the sweep normaliser
 *   node tools/swallow-gate/check.js --calibrate      scan eval/calibration-known-bad/fixtures/ and REQUIRE
 *                                                     that seeded violations are found. Zero found = exit 1.
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');

const SCAN_DIRS = ['catalogue', 'evidence', 'facts', 'applicability', 'breach', 'llm', 'payload', 'mint', 'render-proof', 'tools'];

const RECORDER = /\b(?:_warn|warn|_record|record[A-Z_]\w*|addWarning|logWarning|manifest\.[A-Za-z_$]*(?:record|add|warn|note)\w*|logger?\.(?:warn|error)|console\.(?:warn|error)|log\.(?:warn|error)|report(?:Error|Failure|Warning)\w*|captureException)\s*\(/;
const JUSTIFY = /FAIL-OPEN:/;

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn is an optional devDependency; the regex fallback below is the guaranteed engine and the self-test proves it works. */ }
// CI runs the self-test against BOTH engines: SWALLOW_GATE_ENGINE=regex forces the fallback even when acorn
// is installed, so the fallback can never rot unnoticed.
if (process.env.SWALLOW_GATE_ENGINE === 'regex') acorn = null;

// ── fallback engine: comment/string-aware scan for catch blocks ─────────────────────────────────────────────

// Walk the source character by character, tracking string/template/comment context, and return the index just
// past the matching close brace for the brace at `openIdx`.
function matchBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl + 1; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return src.length;
}

// Find every catch clause with the fallback engine. Returns [{start, bodyStart, bodyEnd, line}].
function findCatchesRegex(src) {
  const out = [];
  const rx = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    // Reject matches that sit inside a string or comment by rescanning context up to the match. Cheap and
    // exact enough: count unterminated context from the start of the line only, then a full scan when unsure.
    if (inStringOrComment(src, m.index)) continue;
    const openIdx = m.index + m[0].length - 1;
    const bodyEnd = matchBrace(src, openIdx);
    out.push({ start: m.index, bodyStart: openIdx + 1, bodyEnd: bodyEnd - 1, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

// True if position `idx` is inside a string, template or comment. Single forward scan.
function inStringOrComment(src, idx) {
  let i = 0;
  while (i < idx) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const nl = src.indexOf('\n', i); if (nl === -1 || nl >= idx) return true; i = nl + 1; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); if (end === -1 || end + 2 > idx) return true; i = end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      if (i >= idx) return true;
      i++;
      continue;
    }
    i++;
  }
  return false;
}

// ── acorn engine ────────────────────────────────────────────────────────────────────────────────────────────

function findCatchesAcorn(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true });
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'CatchClause') out.push({ start: n.start, bodyStart: n.body.start + 1, bodyEnd: n.body.end - 1, line: n.loc.start.line });
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return out;
}

// ── shared judgement ────────────────────────────────────────────────────────────────────────────────────────

function judgeCatch(src, c) {
  const body = src.slice(c.bodyStart, c.bodyEnd);
  // Justification may sit inside the body or on the two lines immediately above the catch.
  const before = src.slice(Math.max(0, src.lastIndexOf('\n', Math.max(0, src.lastIndexOf('\n', c.start - 1) - 1))), c.start);
  if (JUSTIFY.test(body) || JUSTIFY.test(before)) return null;
  if (/\bthrow\b/.test(body)) return null;
  if (RECORDER.test(body)) return null;
  const bare = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() === '';
  return {
    line: c.line,
    kind: bare ? 'bare-swallow' : 'silent-swallow',
    excerpt: ('catch ' + body.trim()).replace(/\s+/g, ' ').slice(0, 120),
  };
}

function scanContent(src) {
  let catches;
  let engine;
  if (acorn) {
    try { catches = findCatchesAcorn(src); engine = 'acorn'; }
    catch (e) { throw new Error('acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero catches)'); }
  } else {
    catches = findCatchesRegex(src);
    engine = 'regex-fallback';
  }
  const violations = [];
  for (const c of catches) {
    const v = judgeCatch(src, c);
    if (v) violations.push(v);
  }
  return { violations, catches: catches.length, engine };
}

const { listJsFiles } = require('../lib/fswalk');

function scanTree(dirs) {
  const violations = [];
  let scanned = 0;
  let catches = 0;
  for (const dir of dirs) {
    for (const abs of listJsFiles(path.join(ROOT, dir))) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      const r = scanContent(fs.readFileSync(abs, 'utf8'));
      catches += r.catches;
      for (const v of r.violations) violations.push({ file: rel, ...v });
    }
  }
  return { violations, scanned, catches };
}

// Self-test: prove the active engine can see the class this gate exists to catch.
function selfTest() {
  const cases = [
    { src: 'try { x(); } catch (e) {}', bad: 1 },                                                 // bare, bound
    { src: 'try { x(); } catch { }', bad: 1 },                                                    // bare, optional binding
    { src: 'try { x(); } catch (e) { count++; }', bad: 1 },                                       // silent: does something, records nothing
    { src: 'try { x(); } catch (e) { throw new Error("ctx: " + e.message); }', bad: 0 },          // rethrows
    { src: 'try { x(); } catch (e) { manifest.record("crawl", e); }', bad: 0 },                   // records
    { src: 'try { x(); } catch (e) { /* FAIL-OPEN: bonus signal only, madge is authoritative */ }', bad: 0 }, // justified
    { src: 'const s = "catch (e) {}";', bad: 0 },                                                 // catch inside a string is not a catch
  ];
  const results = cases.map((c) => {
    const got = scanContent(c.src).violations.length;
    return { want: c.bad, got, ok: got === c.bad, src: c.src };
  });
  const pass = results.every((r) => r.ok);
  return { pass, detail: results.filter((r) => !r.ok).map((r) => 'want ' + r.want + ' got ' + r.got + ' for: ' + r.src).join('; ') || 'all ' + cases.length + ' cases correct' };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'swallow-gate',
    ruleId: 'swallowed-exception:' + v.kind,
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    level: 'error',
    message: (v.kind === 'bare-swallow' ? 'Bare empty catch: this failure reports success.' : 'Silent catch: neither rethrows, records via a recorder, nor carries a written FAIL-OPEN: justification.'),
    snippet: v.excerpt,
  }));
}

function main() {
  const engine = acorn ? 'acorn' : 'regex-fallback';
  runGateCli({
    name: 'swallow-gate',
    selfTest,
    scan: scanTree,
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' files, ' + r.catches + ' catch blocks, ' + r.violations.length + ' violations (engine: ' + engine + ')',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.catches + ' catches, ' + r.violations.length + ' seeded violations found',
    violationLine: (v) => 'SWALLOW [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.excerpt,
  });
}

if (require.main === module) main();
module.exports = { scanContent, scanTree, selfTest, toFindings, judgeCatch };
