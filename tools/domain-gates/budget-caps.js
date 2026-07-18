#!/usr/bin/env node
'use strict';
/**
 * BUDGET-CAPS gate: budgets are caps, never floors (Constitution Rule 8, GAPS.md `budget-floor`).
 *
 * The old estate lost the "~45s any website" crawl because the SPA-render tail carried a 45-second FLOOR
 * via `Math.max(45, ...)` / `Math.max(20000, Math.floor(deadlineMs*0.6))`, so a few shells always cost at
 * least that long; E-236 restored a 43s crawl to 6.9s by deleting the floor. Separately, an unbounded
 * browser step held a mint hostage for 752s. This gate fails CI (AST scan, evidence/ only) on:
 *
 *   1. A `Math.max(...)` FLOOR on a time/budget value: a Math.max with a numeric-literal argument that is
 *      budget-associated - the value it initialises is named timeout/budget/deadline/wait/delay/ttl/...,
 *      OR one of its arguments references such an identifier (e.g. Math.max(20000, f(deadlineMs))).
 *   2. A setTimeout delay / AbortSignal.timeout / budget-named constant that is a numeric literal > 120s
 *      (120000ms): a deadline longer than two minutes is a hang budget, not a cap.
 *
 * A Math.min cap, a setTimeout(fn, 5000), and a non-time numeric (a byte/char ceiling not bound to a
 * budget name) are all spared. Engine: acorn is MANDATORY; without it the gate REFUSES (exit 2) rather
 * than approximate (Constitution Rule 4). String literals are invisible to acorn, so no false hits.
 *
 * Modes (tools/lib/gate-cli.js dialect):
 *   node tools/domain-gates/budget-caps.js               scan evidence/, exit 1 on any floor/oversize
 *   node tools/domain-gates/budget-caps.js --json <path> also write findings JSON for the sweep normaliser
 *   node tools/domain-gates/budget-caps.js --calibrate   scan eval/calibration-known-bad/fixtures/ and
 *                                                         REQUIRE the seeded floor to be caught
 */
const { runGateCli } = require('../lib/gate-cli');
const { scanTreeWith } = require('./acorn-scan');

// evidence/ is the fetch/crawl/browser code where a floor or an oversize deadline does the damage. The
// gate lives in tools/, so scanning tools/ would flag the gate's own detection literals; evidence is scope.
const SCAN_DIRS = ['evidence'];
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist|fixtures)$/;

const THRESHOLD_MS = 120000; // 120s. A time budget above this is a hang budget, not a cap.
const BUDGET_WORD_RX = /(timeout|budget|deadline|delay|backoff|linger|wait|ttl|sleep)/i;
// A millisecond-budget suffix the word list misses: camelCase `*Ms` (closeMs, settleMs, deadlineMs) or
// SCREAMING_SNAKE `*_MS` (DEFAULT_CLOSE_MS, DEFAULT_SETTLE_MS). Matched CASE-SENSITIVELY so ordinary
// words ending in lowercase "ms" (forms, terms, items, params) are never swept in - only the deliberate
// ms-budget spelling is a budget. Without this the gate reported a CONFIDENT ZERO on `const
// DEFAULT_CLOSE_MS = 200000` (caution.md C-203: a gate that encodes one spelling of a defect is theatre).
const BUDGET_MS_RX = /(?:[a-z0-9]Ms|_MS)$/;
// isBudgetName(name): the ONE door for "is this identifier a time/ms budget" (both spellings), so the
// three call sites below cannot drift apart on which names count.
function isBudgetName(name) {
  const n = String(name || '');
  return BUDGET_WORD_RX.test(n) || BUDGET_MS_RX.test(n);
}

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn=null is the typed failure captured HERE; scanContent() REFUSES (exit 2) so the SYSTEM fails closed. acorn ships transitively via eslint. */ }
const FORCE_REFUSE = process.env.BUDGET_CAPS_ENGINE === 'refuse';
const useAcorn = Boolean(acorn) && !FORCE_REFUSE;

// ── small AST predicates ──────────────────────────────────────────────────────────────────────────
function isMathMax(callee) {
  return Boolean(callee) && callee.type === 'MemberExpression' && !callee.computed &&
    callee.object && callee.object.type === 'Identifier' && callee.object.name === 'Math' &&
    callee.property && callee.property.name === 'max';
}
function isSetTimeout(callee) {
  if (!callee) return false;
  if (callee.type === 'Identifier') return callee.name === 'setTimeout';
  return callee.type === 'MemberExpression' && callee.property && callee.property.name === 'setTimeout';
}
function isAbortTimeout(callee) {
  return Boolean(callee) && callee.type === 'MemberExpression' &&
    callee.object && callee.object.type === 'Identifier' && callee.object.name === 'AbortSignal' &&
    callee.property && callee.property.name === 'timeout';
}
function isNumericLiteral(node) {
  return Boolean(node) && node.type === 'Literal' && typeof node.value === 'number';
}
function isOversizeLiteral(node) {
  return isNumericLiteral(node) && node.value > THRESHOLD_MS;
}

// anyChildRefsBudget(node) -> true when some child (array entry or nested object) references a
// budget-named identifier. Split out of refsBudgetIdent so the recursive fan-out is not folded into
// the same function as the base cases (the health-gate "Bumpy Road"/Complex Method caps).
function anyChildRefsBudget(node) {
  for (const k of Object.keys(node)) {
    if (isMetaKey(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) { if (v.some(refsBudgetIdent)) return true; continue; }
    if (v && typeof v === 'object' && refsBudgetIdent(v)) return true;
  }
  return false;
}
// refsBudgetIdent(node) -> true when a budget-named identifier appears anywhere in this expression
// subtree (so Math.max(20000, Math.floor(deadlineMs*0.6)) is recognised as a floor on deadlineMs).
function refsBudgetIdent(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Identifier') return isBudgetName(node.name);
  return anyChildRefsBudget(node);
}

// isBudgetFloor(callNode, binding) -> the Math.max is a FLOOR on a budget: it has a numeric-literal arg
// AND is budget-associated (its binding name, or a referenced identifier, is budget-named).
function isBudgetFloor(callNode, binding) {
  const args = callNode.arguments || [];
  if (!args.some(isNumericLiteral)) return false;
  if (binding && isBudgetName(binding)) return true;
  return args.some(refsBudgetIdent);
}

// ── binding context: the name a value-carrying child initialises (for the two budget-name rules) ─────
// isMemberPropertyIdentifier(node) -> true when node is a MemberExpression whose property is itself an
// Identifier. Named so the 2-term conjunction is not its own "Complex Conditional" inline in targetName.
function isMemberPropertyIdentifier(node) {
  return node.type === 'MemberExpression' && node.property && node.property.type === 'Identifier';
}
function targetName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (isMemberPropertyIdentifier(node)) return node.property.name;
  return null;
}
function keyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
}
// valueChildBinding(node, key) -> the binding name to pass to the value-carrying child (init/right/value),
// else null. A value nested inside a CallExpression's arguments resets to null (it is not the binding).
function valueChildBinding(node, key) {
  if (node.type === 'VariableDeclarator' && key === 'init') return targetName(node.id);
  if (node.type === 'AssignmentExpression' && key === 'right') return targetName(node.left);
  if (node.type === 'Property' && key === 'value') return keyName(node.key);
  return null;
}

// ── flaggers ────────────────────────────────────────────────────────────────────────────────────────
// Each of the three call-shape checks flagCall used to inline is now its own named finder returning a
// finding or null, so flagCall itself is a flat composition with no branch structure left to fold
// (the health-gate "Bumpy Road"/Complex Method caps) and no multi-term conditional inline.
function mathMaxFloorFinding(node, binding, relPath, line) {
  if (!isMathMax(node.callee) || !isBudgetFloor(node, binding)) return null;
  return { file: relPath, line, kind: 'budget-floor', message: 'Math.max() imposes a FLOOR on a time/budget value; a budget is a cap, never a minimum (Rule 8, E-236)' };
}
function setTimeoutOversizeFinding(node, relPath, line) {
  const arg = node.arguments && node.arguments[1];
  if (!isSetTimeout(node.callee) || !isOversizeLiteral(arg)) return null;
  return { file: relPath, line, kind: 'oversize-deadline', message: 'setTimeout delay literal ' + arg.value + 'ms exceeds the 120s hard-deadline cap (Rule 9)' };
}
function abortTimeoutOversizeFinding(node, relPath, line) {
  const arg = node.arguments && node.arguments[0];
  if (!isAbortTimeout(node.callee) || !isOversizeLiteral(arg)) return null;
  return { file: relPath, line, kind: 'oversize-deadline', message: 'AbortSignal.timeout literal ' + arg.value + 'ms exceeds the 120s hard-deadline cap (Rule 9)' };
}
function flagCall(node, binding, relPath, line) {
  return [
    mathMaxFloorFinding(node, binding, relPath, line),
    setTimeoutOversizeFinding(node, relPath, line),
    abortTimeoutOversizeFinding(node, relPath, line),
  ].filter(Boolean);
}
function flagLiteral(node, binding, relPath, line) {
  if (!isOversizeLiteral(node)) return [];
  if (!binding || !isBudgetName(binding)) return [];
  return [{ file: relPath, line, kind: 'oversize-deadline', message: 'budget "' + binding + '" is set to a literal ' + node.value + 'ms, exceeding the 120s hard-deadline cap (Rule 9)' }];
}

// ── walk: carry the binding name to value-carrying children only ──────────────────────────────────────
// isMetaKey / lineOf are lifted out so walk itself stays under the branch cap (each is trivially small).
function isMetaKey(k) { return k === 'loc' || k === 'start' || k === 'end'; }
function lineOf(node) { return (node.loc && node.loc.start.line) || 1; }

// visitNodeForViolations(node, binding, relPath, violations) -> the type dispatch (CallExpression /
// Literal) walk itself used to inline. Split out so walk's own branch count stays low. Re-derives the
// line from the node rather than taking a 5th argument (the <=4-param house style).
function visitNodeForViolations(node, binding, relPath, violations) {
  const line = lineOf(node);
  if (node.type === 'CallExpression') violations.push(...flagCall(node, binding, relPath, line));
  else if (node.type === 'Literal') violations.push(...flagLiteral(node, binding, relPath, line));
}
// walkChildren(node, relPath, violations) -> recurse into every non-meta child, threading the correct
// value-carrying binding name. Split out so the child-recursion loop is its own single-purpose unit.
function walkChildren(node, relPath, violations) {
  for (const k of Object.keys(node)) {
    if (isMetaKey(k)) continue;
    walk(node[k], valueChildBinding(node, k), relPath, violations);
  }
}
function walk(node, binding, relPath, violations) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, null, relPath, violations); return; }
  if (typeof node.type !== 'string') return;
  visitNodeForViolations(node, binding, relPath, violations);
  walkChildren(node, relPath, violations);
}

function scanContent(relPath, src) {
  if (!useAcorn) throw new Error(relPath + ': acorn unavailable and BUDGET_CAPS refuses to approximate floor detection (an under-report is an unearned zero, Constitution Rule 4)');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, locations: true }); }
  catch (e) { throw new Error(relPath + ': acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero violations)'); }
  const violations = [];
  walk(ast, null, relPath, violations);
  return { violations };
}

// scanTree delegates the identical directory walk to the shared acorn-scan module (one copy for both
// domain gates); the per-file floor/oversize detection stays here in scanContent (this gate's door).
function scanTree(dirs) {
  return scanTreeWith(dirs, SKIP_DIRS, scanContent);
}

function selfTest() {
  if (!useAcorn) {
    let refused = false;
    try { scanContent('selftest.js', 'const timeoutMs = Math.max(5000, x);'); }
    catch (e) { refused = true; /* FAIL-OPEN: the throw is the measured refusal signal (acorn mandatory), captured on purpose. */ }
    return { pass: refused, detail: refused ? 'no-acorn engine correctly REFUSES (exit 2), never a zero' : 'no-acorn engine did not refuse - it must never approximate' };
  }
  const bad = [
    'const timeoutMs = Math.max(5000, x);',                          // floor via binding name
    'f(a, Math.max(20000, Math.floor(deadlineMs * 0.6)), b);',       // floor via referenced identifier
    'setTimeout(fn, 130000);',                                       // oversize setTimeout
    'AbortSignal.timeout(200000);',                                  // oversize abort deadline
    'const DEADLINE_MS = 200000;',                                   // oversize budget constant (word 'deadline')
    'const CLOSE_MS = 200000;',                                      // oversize budget: caught ONLY by the _MS suffix (no budget word)
    'const closeMs = Math.max(3000, x);',                            // floor: caught ONLY by the camelCase Ms suffix
  ];
  const good = [
    'const width = Math.min(12, concurrency);',   // a cap, not a floor
    'const n = Math.max(0, count);',              // Math.max but not budget-associated
    'setTimeout(fn, 5000);',                       // in-budget timeout
    'const CORPUS_MAX_CHARS = 500000;',            // a char ceiling, not a time budget
    'AbortSignal.timeout(12000);',                 // in-budget deadline
    'const forms = 200000;',                       // a word ending in lowercase "ms" is NOT a budget (case-sensitive suffix)
    'const maxItems = Math.max(3000, x);',         // 'maxItems' is not a budget name -> not a floor
  ];
  const badOk = bad.every((s) => scanContent('t.js', s).violations.length === 1);
  const goodOk = good.every((s) => scanContent('t.js', s).violations.length === 0);
  return {
    pass: badOk && goodOk,
    detail: (badOk && goodOk)
      ? 'catches Math.max floors on budget values (by binding name and by referenced identifier) and >120s setTimeout/AbortSignal/budget-constant literals; clears Math.min caps, in-budget timeouts and non-time ceilings (engine: acorn)'
      : 'FAILED: badOk=' + badOk + ' goodOk=' + goodOk,
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'budget-caps', ruleId: 'budget-caps/' + v.kind, file: v.file,
    startLine: v.line, endLine: v.line, level: 'error', message: v.message, snippet: v.kind,
  }));
}

function main() {
  runGateCli({
    name: 'budget-caps',
    selfTest,
    scan: scanTree,
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' evidence files, ' + r.violations.length + ' budget-floor/oversize-deadline violation(s) (engine: ' + (useAcorn ? 'acorn' : 'refuse') + ')',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded floor/oversize-deadline(s) found',
    violationLine: (v) => 'BUDGET [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.message,
  });
}

if (require.main === module) main();

module.exports = { scanContent, scanTree, selfTest, toFindings, isBudgetFloor, isMathMax, isBudgetName, THRESHOLD_MS };
