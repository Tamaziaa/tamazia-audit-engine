#!/usr/bin/env node
'use strict';
/**
 * HEALTH-GATE: the CodeScene-class complexity smells caught before a reviewer ever sees them.
 *
 * Builder agents ship functions that pass every test yet are the exact shape CodeScene later flags:
 * Complex Method (too long), Bumpy Road (too many independent branches), Deep Nested Complexity (too
 * many levels of if/for/while inside one another). This gate exists so those findings die in the
 * builder loop, before a reviewer or a CodeScene scan ever fires on them (caution.md C-163: "a gate
 * that cannot fire is theatre" - CodeScene refactoring-goal gates were enabled with no goals defined;
 * this gate has an explicit, calibrated goal from commit 1).
 *
 * Five caps, each a hard ceiling, never a target to creep toward:
 *   - function body        > 60 lines
 *   - nesting depth         > 4   (if/for/while/switch/try nested inside one another)
 *   - decision points       > 12  (if / for / while / do-while / switch-case / && / || / ?: )
 *   - formal parameters     > 5
 *   - file length           > 500 lines
 *
 * Engine: an AST walk via acorn. acorn is MANDATORY (it always ships as a transitive devDependency of
 * eslint). The old brace/indent fallback was removed in PR #3 because it under-reported template ${}
 * code, regex-literal braces and braceless nesting - all confident zeros. HEALTH_GATE_ENGINE=heuristic
 * now forces tools/health-gate/heuristic.js's EXPLICIT REFUSAL (it throws, check.js exits 2), so the
 * fail-closed fallback is exercised in CI (mirrors SWALLOW_GATE_ENGINE=regex, but this fallback refuses
 * rather than approximates - under-reporting is an unearned zero, Constitution Rule 4).
 *
 * Tests: node --test tools/health-gate/check.test.js
 *
 * Modes:
 *   node tools/health-gate/check.js                  scan the repo source tree, exit 1 on any violation
 *   node tools/health-gate/check.js --json <path>    also write findings JSON for the sweep normaliser
 *   node tools/health-gate/check.js --calibrate      scan eval/calibration-known-bad/fixtures/ and REQUIRE
 *                                                    that the seeded violations are found. Zero found = exit 1.
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');
const { listJsFiles } = require('../lib/fswalk');
const { refuseHeuristicScan } = require('./heuristic');

// facts, catalogue (minus packs/dist), tools, eval, payload, evidence, breach, llm, mint - the
// repo's source dirs. catalogue/packs is data (compiled law rows, not builder-authored logic) and is
// owned by a parallel workflow; excluding it here is a scan-scope decision, not an editing boundary.
const SCAN_DIRS = ['facts', 'catalogue', 'tools', 'eval', 'payload', 'evidence', 'breach', 'llm', 'mint'];
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist|fixtures)$/;

const MAX_FUNCTION_LINES = 60;
const MAX_NESTING_DEPTH = 4;
const MAX_DECISION_POINTS = 12;
const MAX_PARAMS = 5;
const MAX_FILE_LINES = 500;

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: require() may throw if acorn is genuinely absent; we swallow that to null HERE (acorn=null is the typed failure state) rather than crash on load, but scanContent() then REFUSES (exit 2) when acorn is null, so the SYSTEM fails closed. acorn ships as a transitive devDependency of eslint, so this branch does not fire in a normal install. */ }
// HEALTH_GATE_ENGINE=heuristic forces the refusal path so the fail-closed fallback is exercised in CI.
const FORCE_HEURISTIC = process.env.HEALTH_GATE_ENGINE === 'heuristic';
const useAcorn = Boolean(acorn) && !FORCE_HEURISTIC;

// ── naming: best-effort label for a function node, for readable violation messages only (never gates on it) ──

function keyName(k) {
  if (!k) return '(computed)';
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'Literal') return String(k.value);
  return '(computed)';
}

function exprName(n) {
  if (!n) return '(anonymous)';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') return exprName(n.object) + '.' + keyName(n.property);
  return '(anonymous)';
}

function functionDisplayName(node, hint) {
  return (node.id && node.id.name) ? node.id.name : (hint || '(anonymous)');
}

function isMetaKey(key) {
  return key === 'loc' || key === 'start' || key === 'end' || key === 'range';
}

// Each hint source is a guard-claused predicate returning the name or null, so computeChildHint stays a
// flat nullish-coalescing chain with no multi-operator conditional in any test position.
function variableDeclaratorHint(node, key) {
  if (node.type !== 'VariableDeclarator' || key !== 'init') return null;
  if (!node.id || node.id.type !== 'Identifier') return null;
  return node.id.name;
}

function propertyOrMethodHint(node, key) {
  if (node.type !== 'Property' && node.type !== 'MethodDefinition') return null;
  if (key !== 'value' || !node.key) return null;
  return keyName(node.key);
}

function assignmentHint(node, key) {
  if (node.type !== 'AssignmentExpression' || key !== 'right') return null;
  return exprName(node.left);
}

// A function-like node's immediate syntactic context tells us its best-effort display name: the
// variable it was assigned to, the object/class key it lives under, or the identifier it was
// reassigned onto. Anything else is anonymous (fine: naming is cosmetic here, never load-bearing).
function computeChildHint(node, key) {
  return variableDeclaratorHint(node, key)
    ?? propertyOrMethodHint(node, key)
    ?? assignmentHint(node, key);
}

// ── acorn engine: collect every function-like node, tagged with a best-effort name ────────────────────────

// Nested functions are collected too (each is its own unit for metrics purposes; walkMetrics stops at
// a nested function's boundary so inner units are never double-charged against the outer one). The walk
// is split into three small units (node / array / children) so no single one exceeds the caps.
function walkCollectChildren(node, out) {
  for (const key of Object.keys(node)) {
    if (isMetaKey(key)) continue;
    const value = node[key];
    if (!value || typeof value !== 'object') continue;
    walkCollect(value, computeChildHint(node, key), out);
  }
}

function walkCollect(node, hint, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkCollect(n, hint, out); return; }
  if (typeof node.type !== 'string') return;
  if (FUNCTION_TYPES.has(node.type)) out.push({ node, name: functionDisplayName(node, hint) });
  walkCollectChildren(node, out);
}

function collectFunctions(root) {
  const out = [];
  walkCollect(root, null, out);
  return out;
}

// ── acorn engine: bounded per-function walk computing decision points and max nesting depth ────────────────
// Each handler owns exactly one nesting-inducing construct; walkMetrics itself is a lookup, not a
// switch, which keeps its own decision count low (a dispatch table branches without a branch).

function walkIf(node, depth, state) {
  state.decisions++;
  walkMetrics(node.test, depth, state);
  walkMetrics(node.consequent, depth + 1, state);
  state.maxDepth = Math.max(state.maxDepth, depth + 1);
  if (!node.alternate) return;
  // "else if" chains stay at the SAME depth (sibling branches, not nested ones); a genuine
  // "else { ... }" block is a further nesting level.
  if (node.alternate.type === 'IfStatement') { walkMetrics(node.alternate, depth, state); return; }
  walkMetrics(node.alternate, depth + 1, state);
  state.maxDepth = Math.max(state.maxDepth, depth + 1);
}

function walkLoop(node, depth, state) {
  state.decisions++;
  for (const k of ['init', 'test', 'update', 'left', 'right']) if (node[k]) walkMetrics(node[k], depth, state);
  walkMetrics(node.body, depth + 1, state);
  state.maxDepth = Math.max(state.maxDepth, depth + 1);
}

function walkSwitch(node, depth, state) {
  walkMetrics(node.discriminant, depth, state);
  for (const c of node.cases) {
    if (c.test) { state.decisions++; walkMetrics(c.test, depth, state); }
    walkMetrics(c.consequent, depth + 1, state);
  }
  state.maxDepth = Math.max(state.maxDepth, depth + 1);
}

function walkTry(node, depth, state) {
  walkMetrics(node.block, depth + 1, state);
  state.maxDepth = Math.max(state.maxDepth, depth + 1);
  if (node.handler) { walkMetrics(node.handler.body, depth + 1, state); state.maxDepth = Math.max(state.maxDepth, depth + 1); }
  if (node.finalizer) { walkMetrics(node.finalizer, depth + 1, state); state.maxDepth = Math.max(state.maxDepth, depth + 1); }
}

function walkLogical(node, depth, state) {
  if (node.operator === '&&' || node.operator === '||') state.decisions++;
  walkMetrics(node.left, depth, state);
  walkMetrics(node.right, depth, state);
}

function walkConditional(node, depth, state) {
  state.decisions++;
  walkMetrics(node.test, depth, state);
  walkMetrics(node.consequent, depth, state);
  walkMetrics(node.alternate, depth, state);
}

function walkGenericChildren(node, depth, state) {
  for (const key of Object.keys(node)) {
    if (isMetaKey(key)) continue;
    const v = node[key];
    if (v && typeof v === 'object') walkMetrics(v, depth, state);
  }
}

const NESTING_HANDLERS = {
  IfStatement: walkIf,
  ForStatement: walkLoop,
  ForInStatement: walkLoop,
  ForOfStatement: walkLoop,
  WhileStatement: walkLoop,
  DoWhileStatement: walkLoop,
  SwitchStatement: walkSwitch,
  TryStatement: walkTry,
  LogicalExpression: walkLogical,
  ConditionalExpression: walkConditional,
};

function walkMetrics(node, depth, state) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkMetrics(n, depth, state); return; }
  if (typeof node.type !== 'string' || FUNCTION_TYPES.has(node.type)) return;
  const handler = NESTING_HANDLERS[node.type];
  if (handler) handler(node, depth, state);
  else walkGenericChildren(node, depth, state);
}

function functionMetricsAcorn(fnNode) {
  const state = { decisions: 0, maxDepth: 0 };
  walkMetrics(fnNode.body, 0, state);
  const lines = fnNode.loc.end.line - fnNode.loc.start.line + 1;
  return { lines, params: fnNode.params.length, maxDepth: state.maxDepth, decisions: state.decisions, line: fnNode.loc.start.line };
}

function scanContentAcorn(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true });
  return collectFunctions(ast).map((f) => ({ name: f.name, ...functionMetricsAcorn(f.node) }));
}

// ── shared judgement: metrics -> violations against the five caps (engine-agnostic) ────────────────────────

const CAPS = [
  { key: 'lines', kind: 'long-function', cap: MAX_FUNCTION_LINES, label: 'lines', tail: 'Complex Method' },
  { key: 'maxDepth', kind: 'deep-nesting', cap: MAX_NESTING_DEPTH, label: 'levels deep', tail: 'Deep Nested Complexity' },
  { key: 'decisions', kind: 'high-branching', cap: MAX_DECISION_POINTS, label: 'decision points', tail: 'Bumpy Road' },
  { key: 'params', kind: 'too-many-params', cap: MAX_PARAMS, label: 'parameters', tail: null },
];

function judgeFunction(relPath, fn) {
  const out = [];
  for (const c of CAPS) {
    const value = fn[c.key];
    if (value <= c.cap) continue;
    const tail = c.tail ? ' - ' + c.tail : '';
    out.push({
      file: relPath, line: fn.line, name: fn.name, kind: c.kind, metric: value, cap: c.cap,
      message: `function "${fn.name}" has ${value} ${c.label} (cap ${c.cap})${tail}`,
    });
  }
  return out;
}

function scanContent(relPath, src) {
  // acorn is mandatory. Without it (or under a forced heuristic), REFUSE rather than approximate:
  // refuseHeuristicScan throws, which the CLI turns into exit 2 (a broken tool), never a zero.
  if (!useAcorn) refuseHeuristicScan(relPath);
  let fns;
  try { fns = scanContentAcorn(src); }
  catch (e) { throw new Error(relPath + ': acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero violations)'); }
  const engine = 'acorn';
  const violations = fns.flatMap((fn) => judgeFunction(relPath, fn));
  const totalLines = src.split('\n').length;
  if (totalLines > MAX_FILE_LINES) {
    violations.push({ file: relPath, line: 1, name: '(file)', kind: 'large-file', metric: totalLines, cap: MAX_FILE_LINES,
      message: `file is ${totalLines} lines (cap ${MAX_FILE_LINES})` });
  }
  return { violations, functions: fns.length, engine };
}

function scanTree(dirs) {
  const violations = [];
  let scanned = 0;
  let functions = 0;
  for (const dir of dirs) {
    const absDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
    for (const abs of listJsFiles(absDir, { skipDirs: SKIP_DIRS, skipTests: true })) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      const r = scanContent(rel, fs.readFileSync(abs, 'utf8'));
      functions += r.functions;
      violations.push(...r.violations);
    }
  }
  return { violations, scanned, functions };
}

// didThrow(fn) -> true when fn() throws. An expected-throw probe: the throw IS the signal being
// measured, deliberately captured, never an error to surface.
function didThrow(fn) {
  try { fn(); return false; }
  catch (e) { return true; /* FAIL-OPEN: the throw is the measured signal here (an expected-refusal probe), captured on purpose, not swallowed in error. */ }
}

// selfTestRefusal() -> prove the heuristic fallback FAILS CLOSED: it must throw (refuse) on ANY input,
// clean or malformed, never return zero violations. Exercised via HEALTH_GATE_ENGINE=heuristic.
function selfTestRefusal() {
  for (const [label, src] of [['clean', 'function ok(a) { return a; }\n'], ['malformed', 'function ( { ) not js']]) {
    if (!didThrow(() => scanContent('selftest-' + label + '.js', src))) {
      return { pass: false, detail: 'heuristic fallback did NOT refuse ' + label + ' input - it must never under-report (acorn is mandatory)' };
    }
  }
  return { pass: true, detail: 'heuristic fallback correctly REFUSES all input (acorn mandatory; under-reporting is an unearned zero)' };
}

// Self-test: prove the acorn engine can see every one of the FIVE caps this gate exists to catch,
// including large-file (a synthetic 501-line source, in memory). If this fails, every zero this tool
// has ever reported is unearned (Constitution Rule 4). Under a forced/absent heuristic, prove instead
// that the fallback refuses (selfTestRefusal).
function selfTest() {
  if (!useAcorn) return selfTestRefusal();

  const nested = 'if (a) { if (b) { if (c) { if (d) { if (e) { x(); } } } } }'; // 5 deep
  const manyDecisions = Array.from({ length: 13 }, (_, i) => `if (a${i}) { y(); }`).join(' ');
  const longBody = Array.from({ length: 65 }, (_, i) => `  const v${i} = ${i};`).join('\n');
  const src = [
    'function tooLong(a, b, c, d, e, f) {',
    longBody,
    '  ' + nested,
    '  ' + manyDecisions,
    '  return a + b + c + d + e + f;',
    '}',
    '',
    'const clean = (x) => x + 1;',
  ].join('\n');

  const r = scanContent('selftest.js', src);
  const kinds = new Set(r.violations.map((v) => v.kind));
  const functionCaps = ['long-function', 'deep-nesting', 'high-branching', 'too-many-params'];
  const wantFunctionCaps = functionCaps.every((k) => kinds.has(k));

  // The fifth cap (large-file) is file-length, not function-shape: exercise it with a synthetic
  // 501-line source so a regression disabling the file-length check fails the self-test.
  const bigSrc = Array.from({ length: 501 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
  const hasLargeFile = scanContent('selftest-big.js', bigSrc).violations.some((v) => v.kind === 'large-file');

  const cleanScan = scanContent('selftest-clean.js', 'const clean = (x) => x + 1;\nfunction ok(a) { return a; }\n');
  const pass = wantFunctionCaps && hasLargeFile && cleanScan.violations.length === 0;
  return {
    pass,
    detail: pass
      ? 'all 5 caps demonstrably reachable (engine: acorn), including large-file; clean code scores 0'
      : `expected {${functionCaps.join(', ')}, large-file}, got {${[...kinds].join(', ')}${hasLargeFile ? ', large-file' : ''}} (engine: acorn)`,
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'health-gate',
    ruleId: 'health-gate/' + v.kind,
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    level: 'error',
    message: v.message,
    snippet: v.name,
  }));
}

function main() {
  runGateCli({
    name: 'health-gate',
    selfTest,
    scan: scanTree,
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' files, ' + r.functions + ' functions, ' + r.violations.length + ' violations (engine: ' + (useAcorn ? 'acorn' : 'heuristic-refuse') + ')',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.functions + ' functions, ' + r.violations.length + ' seeded violations found',
    violationLine: (v) => 'HEALTH [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.message,
  });
}

if (require.main === module) main();

module.exports = {
  scanContent,
  scanTree,
  selfTest,
  toFindings,
  judgeFunction,
  collectFunctions,
  MAX_FUNCTION_LINES,
  MAX_NESTING_DEPTH,
  MAX_DECISION_POINTS,
  MAX_PARAMS,
  MAX_FILE_LINES,
};
