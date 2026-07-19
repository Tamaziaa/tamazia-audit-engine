#!/usr/bin/env node
'use strict';
/**
 * LANE-EMPTY-GATE: an evidence lane must never return an empty array from an error path (Kimi WS0,
 * blueprint 2.2 / invariant c). "Empty-arrays-flowing-as-success is how the blank page rendered clean."
 *
 * The type-level guarantee lives in payload/contract/v1_2.js (requireBytes + an OK EvidenceRecord that
 * cannot exist without a real 64-hex hash of non-empty bytes). THIS gate is the belt to that brace: it
 * flags a `catch` block that returns an empty array literal (`return []` / `return new Array()`), the
 * exact anti-pattern where a fetch/parse failure is laundered into an empty-but-successful value instead of
 * a typed LaneError. A lane that cannot fetch a required surface must return a LaneError (via requireBytes),
 * never [].
 *
 * Engine: acorn (MANDATORY, like tools/domain-gates/deadline-audit.js - an AST gate that silently
 * approximated would be an unearned zero, Constitution Rule 4). Without acorn the self-test fails and the
 * gate exits 2.
 *
 * Modes (the shared gate-cli contract): normal scan of the lane dirs (exit 1 on any violation);
 * --calibrate scans eval/calibration-known-bad/fixtures/ and REQUIRES the seeded violation is found;
 * --json <path> also writes findings for the sweep normaliser.
 */
const { runGateCli } = require('../lib/gate-cli');
const { scanTreeWith, isMetaKey, lineOf } = require('../domain-gates/acorn-scan');

const SCAN_DIRS = ['evidence']; // the evidence lanes (blueprint invariant c targets lane error paths)
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist)$/; // never descend build/vendor dirs (fswalk skipDirs is a RegExp)

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn=null is the typed failure captured HERE; scanContent throws when it is null, so selfTest fails (exit 2) and the SYSTEM fails closed. acorn ships transitively via eslint (package-lock). */ }

// isAstNode(n) -> true when n is an acorn node (has a string `type`). One predicate so walkNodes/walkChild
// carry no multi-operator condition.
function isAstNode(n) { return Boolean(n) && typeof n.type === 'string'; }
// walkChild(child, visit): descend one property value (an array of nodes, or a single node, else nothing).
function walkChild(child, visit) {
  if (Array.isArray(child)) { for (const c of child) walkNodes(c, visit); return; }
  if (isAstNode(child)) walkNodes(child, visit);
}
// walkNodes(node, visit): depth-first visit of every AST node (skipping acorn's loc/start/end/range
// bookkeeping via isMetaKey). Used to FIND every CatchClause (it descends into everything, so nested
// catches are found in their own right). Small, generic, and not a clone of any existing walker.
function walkNodes(node, visit) {
  if (!isAstNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (!isMetaKey(key)) walkChild(node[key], visit);
  }
}

// SCOPE_BOUNDARY: node types that OWN their own return statements. When walking a catch body for the
// catch's OWN returns, we must not descend into a nested function (its return is the function's, not the
// catch's) nor into a nested CatchClause (that inner catch is found on its own by walkNodes, so descending
// would double-count it) - CodeRabbit PR #33.
const SCOPE_BOUNDARY = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'CatchClause']);
function walkOwnScope(node, visit) {
  if (!isAstNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (!isMetaKey(key)) walkChildOwnScope(node[key], visit);
  }
}
// descendOwnScope(node, visit): descend into a child node UNLESS it opens its own scope (a nested function
// or catch owns its own returns). Applied to BOTH single children and array elements (a nested function is
// commonly a call argument, i.e. an array element - the earlier array branch bypassed this and let a
// callback return-[] leak through, CodeRabbit PR #33).
function descendOwnScope(node, visit) {
  if (isAstNode(node) && !SCOPE_BOUNDARY.has(node.type)) walkOwnScope(node, visit);
}
function walkChildOwnScope(child, visit) {
  if (Array.isArray(child)) { for (const c of child) descendOwnScope(c, visit); return; }
  descendOwnScope(child, visit);
}

// isEmptyArrayLiteral(arg) -> an empty `[]`. isEmptyNewArray(arg) -> a zero-arg `new Array()` (a sized
// `new Array(n)` is a different act and is NOT an empty-array return).
function isEmptyArrayLiteral(arg) { return arg.type === 'ArrayExpression' && arg.elements.length === 0; }
function isEmptyNewArray(arg) {
  if (arg.type !== 'NewExpression' || !arg.callee) return false;
  return arg.callee.name === 'Array' && (arg.arguments || []).length === 0;
}
// isEmptyArrayReturn(arg) -> true iff a return argument is an empty array literal or new Array().
function isEmptyArrayReturn(arg) {
  if (!arg) return false;
  return isEmptyArrayLiteral(arg) || isEmptyNewArray(arg);
}

// catchReturnsEmptyArray(catchNode) -> the line of the first empty-array return in the catch's OWN scope,
// or null. Walks the catch body but stops at nested functions and nested catches (walkOwnScope), so a
// `return []` in a callback declared inside the catch is NOT attributed to the catch, and a nested catch's
// return is counted once (via walkNodes finding that inner CatchClause), not twice. A return nested in an
// if/switch inside the catch still counts - it is still this error path laundering an empty array.
function catchReturnsEmptyArray(catchNode) {
  let hit = null;
  walkOwnScope(catchNode.body, (n) => {
    if (hit) return;
    if (n.type === 'ReturnStatement' && isEmptyArrayReturn(n.argument)) hit = lineOf(n);
  });
  return hit;
}

// scanContent(relPath, src) -> { violations }. Parses src and flags every CatchClause whose body returns
// an empty array. A file acorn cannot parse is skipped (other gates + eslint own syntax errors); acorn
// being null is a hard failure surfaced through the self-test.
function scanContent(relPath, src) {
  if (!acorn) throw new Error(relPath + ': acorn unavailable and this AST gate refuses to approximate (an under-report is an unearned zero, Rule 4)');
  const violations = [];
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true });
  } catch (e) {
    // FAIL-OPEN: a file this gate cannot parse is not this gate's concern (eslint owns syntax errors); skip
    // it rather than crash the whole scan. Never masks a lane-empty return in a well-formed lane file.
    return { violations };
  }
  walkNodes(ast, (n) => {
    if (n.type !== 'CatchClause') return;
    const line = catchReturnsEmptyArray(n);
    if (line != null) violations.push({ file: relPath, line });
  });
  return { violations };
}

function scanTree(dirs) { return scanTreeWith(dirs, SKIP_DIRS, scanContent); }

// selfTest: prove the gate sees the class it exists to catch, in memory. A catch returning [] is caught; a
// catch returning a value and a bare `return []` OUTSIDE a catch are NOT caught (the precision guard).
function selfTest() {
  const bad = scanContent('evidence/rogue.js', 'function f(){ try { return doThing(); } catch (e) { record(e); return []; } }');
  const nestedIf = scanContent('evidence/rogue2.js', 'function f(){ try { g(); } catch (e) { if (x) { return new Array(); } record(e); } }');
  const goodValue = scanContent('evidence/ok.js', 'function f(){ try { return g(); } catch (e) { return laneError("boom"); } }');
  const goodOutside = scanContent('evidence/ok2.js', 'function f(){ if (!m) return []; return g(); }');
  // a `return []` inside a CALLBACK declared in the catch belongs to the callback, NOT the catch (0 hits).
  const callbackInCatch = scanContent('evidence/ok3.js', 'function f(){ try { g(); } catch (e) { record(e); arr.forEach(function(){ return []; }); } }');
  // a NESTED catch that returns [] is counted ONCE (via the inner CatchClause), not twice.
  const nestedCatch = scanContent('evidence/rogue3.js', 'function f(){ try { g(); } catch (e) { try { h(); } catch (e2) { record(e2); return []; } } }');
  const pass = bad.violations.length === 1 && nestedIf.violations.length === 1
    && goodValue.violations.length === 0 && goodOutside.violations.length === 0
    && callbackInCatch.violations.length === 0 && nestedCatch.violations.length === 1;
  return {
    pass,
    detail: 'catch-return-[]: ' + bad.violations.length + ' (want 1) + nested-if ' + nestedIf.violations.length
      + ' (want 1); catch-return-LaneError: ' + goodValue.violations.length + ' (want 0); return-[] outside catch: '
      + goodOutside.violations.length + ' (want 0); callback-in-catch: ' + callbackInCatch.violations.length
      + ' (want 0); nested-catch: ' + nestedCatch.violations.length + ' (want 1, once)',
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'lane-empty-gate',
    ruleId: 'lane-empty-array-return',
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    level: 'error',
    message: 'A catch block returns an empty array. An evidence lane must return a typed LaneError (payload/contract/v1_2.js requireBytes), never an empty array as if it were a value (blueprint invariant c: empty-arrays-flowing-as-success is how the blank page rendered clean).',
    snippet: 'catch { ... return [] }',
  }));
}

function main() {
  runGateCli({
    name: 'lane-empty-gate',
    selfTest,
    scan: (dirs) => scanTree(dirs),
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' lane file(s) scanned, ' + r.violations.length + ' empty-array error-path return(s)',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded violation(s) found',
    violationLine: (v) => 'LANE-EMPTY [catch returns []] ' + v.file + ':' + v.line,
  });
}

if (require.main === module) main();
module.exports = { scanContent, scanTree, selfTest, toFindings };
