#!/usr/bin/env node
'use strict';
/**
 * NO-MODULE-STATE gate: no mutable module-scope state in the mint path (caution.md C-153, GAPS.md
 * `module-scope-state`).
 *
 * THE DISEASE: module-scope `_WARN` / `_SWARN` singletons were never reset between builds, so warning
 * counts were wrong for every audit AFTER the first. A per-invocation counter or accumulator that
 * lives at module scope carries one audit's state silently into the next - the correctness bug that
 * is invisible in a single-audit test and only shows up in production, audit two.
 *
 * This gate FAILS CI (AST scan, evidence/ breach/ llm/ facts/) on a module-scope binding MUTATED from
 * inside a function:
 *   - module-accumulator: `binding++` / `binding += x` / `binding.push(...)` (and the other mutating
 *     array/set/map methods), or an assignment to a PROPERTY of a module-scope object/array literal.
 *     This is the C-153 counter/accumulator; it is never benign at module scope, always flagged.
 *   - module-reassign: a plain `binding = value` reassignment of a module-scope let/var from a
 *     function, EXCEPT the benign singletons the constitution allows: a module-load-time IIFE write, a
 *     guarded write-once memoisation (`if (binding) return binding; binding = ...`), an idempotent
 *     self-referential update (`binding = binding || value`), and require caches / frozen consts
 *     (which are const, never a tracked mutable binding, or whose init is `require(...)` / a frozen
 *     value - not a mutable array/object literal).
 *
 * The mere top-level declaration is NOT flagged: every module-scope binding in the current tree is a
 * require cache, a guarded lazy memoisation, or a module-init typed-failure flag - the exact benign
 * classes C-153 exempts. What C-153 forbids is the per-audit MUTATION that leaks, so that is what the
 * gate targets. Writes at module scope (not inside a function) are initialisation, not per-audit leak,
 * and are never flagged. A write to a name shadowed by a local declaration is a local, never touched.
 *
 * Engine: acorn is MANDATORY. Without it (or under NO_MODULE_STATE_ENGINE=refuse) the gate REFUSES
 * (exit 2) rather than approximate; a parse failure is likewise fail-closed (exit 2) - an under-report
 * is an unearned zero (Constitution Rule 4).
 *
 * Modes (tools/lib/gate-cli.js dialect):
 *   node tools/no-module-state/check.js               scan evidence/ breach/ llm/ facts/, exit 1 on any hit
 *   node tools/no-module-state/check.js --json <path> also write findings JSON for the sweep normaliser
 *   node tools/no-module-state/check.js --calibrate   scan eval/calibration-known-bad/fixtures/ and REQUIRE
 *                                                     the seeded _WARN/_SWARN accumulator is caught
 */
const { runGateCli } = require('../lib/gate-cli');
const { scanTreeWith, isMetaKey, lineOf, memberPropName: propName } = require('../domain-gates/acorn-scan');

const SCAN_DIRS = ['evidence', 'breach', 'llm', 'facts'];
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist|fixtures)$/;

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'add', 'set', 'delete', 'clear']);
const ARITH_COMPOUND = new Set(['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=']);

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn=null is the typed failure captured HERE; scanContent() REFUSES (exit 2), so the SYSTEM fails closed. acorn ships transitively via eslint. */ }
const FORCE_REFUSE = process.env.NO_MODULE_STATE_ENGINE === 'refuse';
const useAcorn = Boolean(acorn) && !FORCE_REFUSE;

// ── tiny helpers (isMetaKey / lineOf / propName come from the shared acorn-scan lib) ──────────────────
// rootIdent(node) -> the leftmost identifier name of an Identifier or a member chain (a.b.c -> 'a').
function rootIdent(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return rootIdent(node.object);
  return '';
}

// walkPatternNode/walkIdentNode below are named top-level functions (not nested IIFEs) so each walk's
// own decision count is its own unit, never folded into the enclosing patternNames/identsIn (the
// health-gate Complex Method/Bumpy Road caps this whole file was flagged for).

// specialPatternChild(n) -> the single child to recurse into for a "wrapper" pattern shape
// (Property/AssignmentPattern/RestElement), or undefined for an Identifier leaf or a generic node
// (handled by the fallback walkPatternChildren). Named so walkPatternNode is a flat dispatch.
function specialPatternChild(n) {
  if (n.type === 'Property') return n.value;
  if (n.type === 'AssignmentPattern') return n.left;
  if (n.type === 'RestElement') return n.argument;
  return undefined;
}
function walkPatternChildren(n, out) {
  // walkPatternNode self-guards non-object children (returns immediately), so the child object-test is
  // redundant here; skipping only the meta keys keeps this a single-term conditional (Complex Conditional cap).
  for (const k of Object.keys(n)) { if (!isMetaKey(k)) walkPatternNode(n[k], out); }
}
// patternNames(id) -> every identifier bound by a declarator/param pattern (destructuring included).
function walkPatternNode(n, out) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'Identifier') { out.push(n.name); return; }
  const special = specialPatternChild(n);
  if (special !== undefined) { walkPatternNode(special, out); return; }
  walkPatternChildren(n, out);
}
function patternNames(id) {
  const out = [];
  walkPatternNode(id, out);
  return out;
}

function walkIdentChildren(n, out) {
  for (const k of Object.keys(n)) { if (!isMetaKey(k)) walkIdentNode(n[k], out); }
}
function walkIdentNode(n, out) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walkIdentNode(x, out); return; }
  if (n.type === 'Identifier') out.add(n.name);
  walkIdentChildren(n, out);
}
function identsIn(node) {
  const out = new Set();
  walkIdentNode(node, out);
  return out;
}

// ── module-scope binding collection ──────────────────────────────────────────────────────────────────
// A `let`/`var` is always tracked (reassignable). A `const` is tracked ONLY when its init is a bare
// mutable array/object literal (an accumulator like `const _S = []`); a frozen value, a require cache
// or any other const is NOT a mutable binding and is exempt by construction.
function isMutableLiteral(init) {
  return Boolean(init) && (init.type === 'ArrayExpression' || init.type === 'ObjectExpression');
}
function addBinding(map, kind, decl) {
  const mutableConst = kind === 'const' && isMutableLiteral(decl.init);
  if (kind === 'const' && !mutableConst) return;
  for (const n of patternNames(decl.id)) map.set(n, { kind, line: lineOf(decl), mutableConst });
}
function collectModuleBindings(ast) {
  const map = new Map();
  for (const stmt of ast.body || []) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) addBinding(map, stmt.kind, d);
  }
  return map;
}

// isIifeCall(n) -> true for a CallExpression whose callee is itself a function literal. Named so the
// conjunction is not its own "Complex Conditional" inline in the walk.
function isIifeCall(n) {
  return n.type === 'CallExpression' && n.callee && FN_TYPES.has(n.callee.type);
}
function walkIifeChildren(n, set) {
  for (const k of Object.keys(n)) { if (!isMetaKey(k)) walkIifeNode(n[k], set); }
}
function walkIifeNode(n, set) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walkIifeNode(x, set); return; }
  if (isIifeCall(n)) set.add(n.callee);
  walkIifeChildren(n, set);
}
// collectIifes(ast) -> the Set of function nodes that are immediately invoked (their writes are
// module-load-time initialisation, not per-audit mutation).
function collectIifes(ast) {
  const set = new Set();
  walkIifeNode(ast, set);
  return set;
}

// isOtherFunctionNode(n, fnNode) -> true for a nested function distinct from fnNode itself. Named so
// the conjunction is not its own "Complex Conditional" inline in the walk.
function isOtherFunctionNode(n, fnNode) {
  return FN_TYPES.has(n.type) && n !== fnNode;
}
function addFunctionName(n, names) {
  if (n.id) names.add(n.id.name);
}
function addDeclaratorNames(n, names) {
  if (n.type !== 'VariableDeclarator') return;
  for (const nm of patternNames(n.id)) names.add(nm);
}
function walkLocalNameChildren(n, fnNode, names) {
  for (const k of Object.keys(n)) { if (!isMetaKey(k)) walkLocalNameNode(n[k], fnNode, names); }
}
function walkLocalNameNode(n, fnNode, names) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walkLocalNameNode(x, fnNode, names); return; }
  if (isOtherFunctionNode(n, fnNode)) { addFunctionName(n, names); return; }
  addDeclaratorNames(n, names);
  walkLocalNameChildren(n, fnNode, names);
}
function collectParamNames(fnNode, names) {
  for (const p of fnNode.params || []) for (const n of patternNames(p)) names.add(n);
}
// collectLocalNames(fnNode) -> the names this function binds locally (params + its own var/function
// declarations), NOT descending into nested functions. A write to such a name is a local, not a
// module-scope leak.
function collectLocalNames(fnNode) {
  const names = new Set();
  collectParamNames(fnNode, names);
  walkLocalNameNode(fnNode.body, fnNode, names);
  return names;
}

// guardReturnBindings(fnNode) -> names N the function early-returns on (`if (N ...) return ...`): the
// write-once memoisation guard. A reassignment of such a binding is a lazy cache, not a leak.
function consequentReturns(node) {
  if (!node) return false;
  if (node.type === 'ReturnStatement') return true;
  return node.type === 'BlockStatement' && node.body.some((x) => x.type === 'ReturnStatement');
}
function bodyStatements(body) {
  return (body && body.type === 'BlockStatement') ? body.body : [];
}
// addGuardIdents(stmt, set) -> adds every identifier in an `if (N...) return` guard's test. Split out
// of guardReturnBindings so the loop body is a single call, not a nested if+for (Bumpy Road cap).
function addGuardIdents(stmt, set) {
  if (stmt.type !== 'IfStatement' || !consequentReturns(stmt.consequent)) return;
  for (const n of identsIn(stmt.test)) set.add(n);
}
function guardReturnBindings(fnNode) {
  const set = new Set();
  for (const s of bodyStatements(fnNode.body)) addGuardIdents(s, set);
  return set;
}

// ── write detection against the module bindings ───────────────────────────────────────────────────────
function shadowed(name, ctx) { return ctx.fnStack.some((f) => f.local.has(name)); }
function isModuleTarget(name, ctx) { return Boolean(name) && ctx.bindings.has(name) && !shadowed(name, ctx); }
function inFunction(ctx) { return ctx.fnStack.length > 0; }
function topFn(ctx) { return ctx.fnStack[ctx.fnStack.length - 1]; }

// flag({ctx, node, name, kind, message}): record one violation. An options object (the
// <=4-positional-arg house style) rather than five positional arguments.
function flag({ ctx, node, name, kind, message }) {
  ctx.violations.push({ file: ctx.relPath, line: lineOf(node), name, kind, message });
}

function handleUpdate(node, ctx) {
  if (!inFunction(ctx)) return;
  const name = rootIdent(node.argument);
  if (!isModuleTarget(name, ctx)) return;
  flag({ ctx, node, name, kind: 'module-accumulator', message: 'module-scope binding "' + name + '" is mutated (++/--) from a function - a per-audit accumulator that leaks between builds (C-153)' });
}

function handleMutatingCall(node, ctx) {
  if (!inFunction(ctx) || node.callee.type !== 'MemberExpression') return;
  if (!MUTATING_METHODS.has(propName(node.callee))) return;
  const name = rootIdent(node.callee.object);
  if (!isModuleTarget(name, ctx)) return;
  flag({ ctx, node, name, kind: 'module-accumulator', message: 'module-scope collection "' + name + '" is mutated (.' + propName(node.callee) + ') from a function - a per-audit accumulator that leaks between builds (C-153)' });
}

// handleAssign: '=' to an Identifier is a reassignment (M2, with the benign-singleton exemptions);
// '=' to a member, or an arithmetic/bitwise compound, is an accumulator mutation (M1, always flagged).
function handleAssign(node, ctx) {
  if (!inFunction(ctx)) return;
  const name = rootIdent(node.left);
  if (!isModuleTarget(name, ctx)) return;
  if (ARITH_COMPOUND.has(node.operator)) {
    flag({ ctx, node, name, kind: 'module-accumulator', message: 'module-scope binding "' + name + '" is compound-mutated (' + node.operator + ') from a function - a per-audit accumulator (C-153)' });
    return;
  }
  if (node.operator !== '=') return; // logical compound (||= &&= ??=) is idempotent memoisation - exempt
  if (node.left.type === 'MemberExpression') {
    flag({ ctx, node, name, kind: 'module-accumulator', message: 'a property of module-scope object "' + name + '" is written from a function - per-audit mutation of shared state (C-153)' });
    return;
  }
  const fn = topFn(ctx);
  if (isBenignReassign(fn, name, node)) return;
  flag({ ctx, node, name, kind: 'module-reassign', message: 'module-scope binding "' + name + '" is reassigned from a function without a write-once guard - per-audit state that leaks between builds (C-153); use a per-invocation state object' });
}
// isBenignReassign(fn, name, node) -> module-init IIFE write, guarded write-once, or idempotent
// self-reference (`x = x || v`). Named so the 3-term disjunction is not its own "Complex Conditional".
function isBenignReassign(fn, name, node) {
  return fn.isIife || fn.guarded.has(name) || identsIn(node.right).has(name);
}

function detectWrite(node, ctx) {
  if (node.type === 'UpdateExpression') handleUpdate(node, ctx);
  else if (node.type === 'AssignmentExpression') handleAssign(node, ctx);
  else if (node.type === 'CallExpression') handleMutatingCall(node, ctx);
}

// ── the walk: push a function context on entering a function, so shadowing + IIFE + guard are known ────
function walkChildren(node, ctx) {
  for (const k of Object.keys(node)) { if (!isMetaKey(k)) walk(node[k], ctx); }
}
function walkFunction(node, ctx) {
  ctx.fnStack.push({ node, isIife: ctx.iifes.has(node), local: collectLocalNames(node), guarded: guardReturnBindings(node) });
  walkChildren(node, ctx);
  ctx.fnStack.pop();
}
function walk(node, ctx) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, ctx); return; }
  if (typeof node.type !== 'string') return;
  if (FN_TYPES.has(node.type)) { walkFunction(node, ctx); return; }
  detectWrite(node, ctx);
  walkChildren(node, ctx);
}

function scanContent(relPath, src) {
  if (!useAcorn) throw new Error(relPath + ': acorn unavailable and NO_MODULE_STATE refuses to approximate mutation detection (an under-report is an unearned zero, Constitution Rule 4)');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true }); }
  catch (e) { throw new Error(relPath + ': acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero violations)'); }
  const bindings = collectModuleBindings(ast);
  if (bindings.size === 0) return { violations: [] };
  const ctx = { bindings, iifes: collectIifes(ast), relPath, violations: [], fnStack: [] };
  walk(ast, ctx);
  return { violations: ctx.violations };
}

function scanTree(dirs) {
  return scanTreeWith(dirs, SKIP_DIRS, scanContent);
}

function selfTest() {
  if (!useAcorn) {
    let refused = false;
    try { scanContent('selftest.js', 'let n = 0; function f(){ n++; }'); }
    catch (e) { refused = true; /* FAIL-OPEN: the throw is the measured refusal signal (acorn mandatory), captured on purpose. */ }
    return { pass: refused, detail: refused ? 'no-acorn engine correctly REFUSES (exit 2), never a zero' : 'no-acorn engine did not refuse - it must never approximate' };
  }
  const bad = [
    'let n = 0; function f(){ n++; }',                                       // accumulator ++
    'const s = []; function g(x){ s.push(x); }',                             // mutating method on module collection
    'let c = null; function h(v){ c = v; }',                                 // unguarded reassignment
    'let t = 0; function k(x){ t += x; }',                                   // compound accumulator
    'const o = {}; function p(v){ o.total = v; }',                           // property write on module object
  ];
  const good = [
    'let cache = null; function m(){ if (cache) return cache; cache = build(); return cache; }', // guarded write-once
    'let linked = false; (function init(){ linked = true; })();',                                // module-init IIFE
    'function loop(a){ let n = 0; for (const x of a) n++; return n; }',                           // local counter (shadow)
    'let mod = null; function load(){ if (mod) return mod; mod = require("x"); return mod; }',    // require cache (guarded)
    'const FROZEN = Object.freeze({ a: 1 }); function r(){ return FROZEN.a; }',                    // frozen const
    'let once = null; function o(v){ once = once || v; return once; }',                           // idempotent self-ref
  ];
  const badOk = bad.every((s) => scanContent('t.js', s).violations.length === 1);
  const goodOk = good.every((s) => scanContent('t.js', s).violations.length === 0);
  return {
    pass: badOk && goodOk,
    detail: (badOk && goodOk)
      ? 'catches module-scope accumulators (++/+=/.push/property-write) and unguarded reassignments; clears guarded memoisation, IIFE init, local counters, require caches, frozen consts and idempotent self-refs (engine: acorn)'
      : 'FAILED: badOk=' + badOk + ' goodOk=' + goodOk,
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'no-module-state', ruleId: 'no-module-state/' + v.kind, file: v.file,
    startLine: v.line, endLine: v.line, level: 'error', message: v.message, snippet: v.name,
  }));
}

function main() {
  try {
    runGateCli({
      name: 'no-module-state',
      selfTest,
      scan: scanTree,
      toFindings,
      scanDirs: SCAN_DIRS,
      summary: (r) => r.scanned + ' files, ' + r.violations.length + ' mutable module-scope-state violation(s) (engine: ' + (useAcorn ? 'acorn' : 'refuse') + ')',
      calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded module-scope mutation(s) found',
      violationLine: (v) => 'MODULE-STATE [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.message,
    });
  } catch (e) {
    // FAIL-CLOSED: an acorn refusal or a parse failure is a broken-tool state (exit 2), never a zero.
    console.error('no-module-state REFUSES: ' + e.message);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { scanContent, scanTree, selfTest, toFindings, collectModuleBindings };
