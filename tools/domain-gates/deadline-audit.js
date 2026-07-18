#!/usr/bin/env node
'use strict';
/**
 * DEADLINE-AUDIT gate: every external step has a hard deadline (Constitution Rule 9, GAPS.md
 * `deadline-hang`, caution.md C-040/C-138).
 *
 * The old estate let a stuck Chromium hold a mint hostage for 752 seconds because the browser's own
 * goto timeout did not bound launch + networkidle, and exhausted free LLM tiers burned 30s x 3 retries
 * waiting for answers that were never coming. The lesson: a slow external dependency must DEGRADE the
 * mint, never HANG it - so every external call site is wrapped in a hard Promise.race deadline
 * (raceWithDeadline / withDeadline / runWithDeadline) or carries its own reachable deadline argument.
 *
 * This gate FAILS CI (AST scan, evidence/ llm/ breach/) on:
 *   1. undeadlined-await: an `await` on a KNOWN injected external caller (fetchFn / launchBrowser /
 *      llmCall / a `.call(...)` provider invocation) that is NOT lexically inside a deadline-wrapper's
 *      arguments and carries no deadline/timeout/signal argument of its own.
 *   2. undeadlined-spawn: a child-process spawn (spawnSync / execSync / execFileSync / spawn) shelling
 *      out to an http(s) URL or a curl/wget command, outside any deadline wrapper.
 *
 * FALSE POSITIVES NEAR ZERO by construction: only the small closed set of KNOWN external-call
 * identifiers is ever flagged. A `page.goto(...)`, a `browser.newPage()`, a regex `.exec(...)`, a
 * plain local await - none are external-call identifiers, so none are touched. A call inside a
 * withDeadline(() => fetchFn(url), ms) wrapper is exempt; so is fetchFn(url, { deadlineMs }).
 *
 * Engine: acorn is MANDATORY. Without it (or under DEADLINE_AUDIT_ENGINE=refuse) the gate REFUSES
 * (exit 2) rather than approximate - an under-report is an unearned zero (Constitution Rule 4). A parse
 * failure on any scanned file is likewise fail-closed (exit 2), never silently counted as zero.
 *
 * Modes (tools/lib/gate-cli.js dialect):
 *   node tools/domain-gates/deadline-audit.js               scan evidence/ llm/ breach/, exit 1 on any hit
 *   node tools/domain-gates/deadline-audit.js --json <path> also write findings JSON for the sweep normaliser
 *   node tools/domain-gates/deadline-audit.js --calibrate   scan eval/calibration-known-bad/fixtures/ and
 *                                                           REQUIRE the seeded undeadlined await is caught
 */
const { runGateCli } = require('../lib/gate-cli');
const { scanTreeWith, isMetaKey, lineOf, memberPropName: propName } = require('./acorn-scan');

const SCAN_DIRS = ['evidence', 'llm', 'breach'];
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist|fixtures)$/;

// The closed set of KNOWN injected external-call identifiers. This is the whole FP surface: nothing
// outside it is ever flagged (a page/browser method, a regex .exec, a plain local await are all spared).
const KNOWN_IDENTS = new Set(['fetchFn', 'launchBrowser', 'llmCall']);
const KNOWN_MEMBER_PROPS = new Set(['fetchFn', 'launchBrowser', 'llmCall', 'call']);
const WRAPPERS = new Set(['withDeadline', 'raceWithDeadline', 'runWithDeadline']);
const SPAWN_NAMES = new Set(['spawnSync', 'execSync', 'execFileSync', 'spawn']);
const DEADLINE_RX = /(deadline|timeout|signal|abort)/i;
const HTTP_RX = /^https?:\/\//i;
const SHELL_HTTP_RX = /\b(curl|wget)\b/i;

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn=null is the typed failure captured HERE; scanContent() REFUSES (exit 2), so the SYSTEM fails closed. acorn ships transitively via eslint. */ }
const FORCE_REFUSE = process.env.DEADLINE_AUDIT_ENGINE === 'refuse';
const useAcorn = Boolean(acorn) && !FORCE_REFUSE;

// ── small AST predicates (isMetaKey / lineOf / propName come from the shared acorn-scan lib) ──────────
function isKnownExternalCallee(callee) {
  if (!callee) return false;
  if (callee.type === 'Identifier') return KNOWN_IDENTS.has(callee.name);
  if (callee.type === 'MemberExpression') return KNOWN_MEMBER_PROPS.has(propName(callee));
  return false;
}

// isPromiseRaceCallee(callee) -> true for Promise.race specifically. Named so the 3-term conjunction is
// not its own "Complex Conditional" inline in isWrapperCallee.
function isPromiseRaceCallee(callee) {
  return callee.object && callee.object.type === 'Identifier' && callee.object.name === 'Promise' && propName(callee) === 'race';
}
// isWrapperCallee(callee) -> the call is a hard-deadline wrapper (withDeadline family or Promise.race);
// anything lexically inside its arguments is deadline-bounded and therefore exempt.
function isWrapperCallee(callee) {
  if (!callee) return false;
  if (callee.type === 'Identifier') return WRAPPERS.has(callee.name);
  if (callee.type !== 'MemberExpression') return false;
  if (WRAPPERS.has(propName(callee))) return true;
  return isPromiseRaceCallee(callee);
}

function spawnName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') return propName(callee);
  return '';
}

// Named guards for subtreeSome's base cases and child recursion, so its own decision count stays low
// (the health-gate Complex Method cap) despite four distinct checks.
function isEmptyOrNonObject(node) {
  return !node || typeof node !== 'object';
}
function matchesTypedNode(node, pred) {
  return typeof node.type === 'string' && pred(node);
}
function childMatches(node, key, pred) {
  return !isMetaKey(key) && subtreeSome(node[key], pred);
}
// subtreeSome(node, pred) -> true when any typed AST node in this subtree (arrays included) satisfies
// pred. The ONE recursive subtree scan both detectors below share (no per-detector clone).
function subtreeSome(node, pred) {
  if (Array.isArray(node)) return node.some((x) => subtreeSome(x, pred));
  if (isEmptyOrNonObject(node)) return false;
  if (matchesTypedNode(node, pred)) return true;
  for (const key of Object.keys(node)) {
    if (childMatches(node, key, pred)) return true;
  }
  return false;
}

function keyName(key) {
  if (!key) return '';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return '';
}

// isDeadlineNode(node) -> a budget/deadline/timeout/signal identifier or property key (so
// fetchFn(url, { deadlineMs }) and llmCall(req, signal) read as self-bounded, exempt from the gate).
function isDeadlineNode(node) {
  if (node.type === 'Identifier') return DEADLINE_RX.test(node.name);
  if (node.type === 'Property') { const k = keyName(node.key); return Boolean(k) && DEADLINE_RX.test(k); }
  return false;
}

// isHttpNode(node) -> a string literal that is an http(s) URL or a curl/wget command (a spawn shelling
// out to the network).
function isHttpNode(node) {
  return node.type === 'Literal' && typeof node.value === 'string' && (HTTP_RX.test(node.value) || SHELL_HTTP_RX.test(node.value));
}

function hasOwnDeadlineArg(call) { return subtreeSome(call.arguments, isDeadlineNode); }

function isSpawnHttp(call) {
  return SPAWN_NAMES.has(spawnName(call.callee)) && subtreeSome(call.arguments, isHttpNode);
}

const PROMISE_CHAIN_METHODS = new Set(['then', 'catch', 'finally']);
// isMemberCall(node) -> true when node is a CallExpression whose callee is a member access. Split out so
// isPromiseChainCall carries no 4-term guard of its own (Complex Conditional cap).
function isMemberCall(node) {
  return Boolean(node) && node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression';
}
// isPromiseChainCall(node) -> true when node is a .then()/.catch()/.finally() call, so the trailing
// promise-combinator chain in rootAwaitedCall is unwrapped without a multi-term conditional inline.
function isPromiseChainCall(node) {
  if (!isMemberCall(node)) return false;
  return PROMISE_CHAIN_METHODS.has(propName(node.callee));
}
// rootAwaitedCall(argNode) -> the base CallExpression an `await` ultimately awaits, unwrapping trailing
// promise-combinator chains (X.then()/.catch()/.finally()), or null when the awaited value is not a call.
function rootAwaitedCall(node) {
  let cur = node;
  while (isPromiseChainCall(cur)) cur = cur.callee.object;
  return cur && cur.type === 'CallExpression' ? cur : null;
}

// ── flaggers ────────────────────────────────────────────────────────────────────────────────────────
function flagAwait(node, wrapped, relPath, violations) {
  if (wrapped) return; // the await is lexically inside a deadline wrapper's arguments -> exempt
  const call = rootAwaitedCall(node.argument);
  if (!call || !isKnownExternalCallee(call.callee)) return;
  if (hasOwnDeadlineArg(call)) return; // self-bounded: carries its own deadline/timeout/signal arg
  violations.push({ file: relPath, line: lineOf(node), kind: 'undeadlined-await',
    message: 'awaited external call is not inside a raceWithDeadline/withDeadline wrapper and carries no deadline argument (Rule 9); a slow dependency would HANG the mint' });
}

function flagSpawn(node, wrapped, relPath, violations) {
  if (wrapped || !isSpawnHttp(node)) return;
  violations.push({ file: relPath, line: lineOf(node), kind: 'undeadlined-spawn',
    message: 'child-process spawn shells out to http/curl outside any deadline wrapper (Rule 9); an unbounded external step can hang the mint' });
}

// ── walk: carry a `wrapped` flag that is set true only inside a deadline wrapper's argument subtree ────
function childWrapped(node, key, wrapped) {
  if (wrapped) return true;
  return node.type === 'CallExpression' && key === 'arguments' && isWrapperCallee(node.callee);
}

// visitNodeForDeadline/walkChildrenForDeadline split out of walk so its own decision count stays low
// (the health-gate Complex Method/Bumpy Road caps) despite dispatching two detectors and recursing.
function visitNodeForDeadline(node, wrapped, relPath, violations) {
  if (node.type === 'AwaitExpression') flagAwait(node, wrapped, relPath, violations);
  else if (node.type === 'CallExpression') flagSpawn(node, wrapped, relPath, violations);
}
function walkChildrenForDeadline(node, wrapped, relPath, violations) {
  for (const key of Object.keys(node)) {
    if (isMetaKey(key)) continue;
    walk(node[key], childWrapped(node, key, wrapped), relPath, violations);
  }
}
function walk(node, wrapped, relPath, violations) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, wrapped, relPath, violations); return; }
  if (typeof node.type !== 'string') return;
  visitNodeForDeadline(node, wrapped, relPath, violations);
  walkChildrenForDeadline(node, wrapped, relPath, violations);
}

function scanContent(relPath, src) {
  if (!useAcorn) throw new Error(relPath + ': acorn unavailable and DEADLINE_AUDIT refuses to approximate deadline detection (an under-report is an unearned zero, Constitution Rule 4)');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true }); }
  catch (e) { throw new Error(relPath + ': acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero violations)'); }
  const violations = [];
  walk(ast, false, relPath, violations);
  return { violations };
}

function scanTree(dirs) {
  return scanTreeWith(dirs, SKIP_DIRS, scanContent);
}

function selfTest() {
  if (!useAcorn) {
    let refused = false;
    try { scanContent('selftest.js', 'async function f(x){ return await x.llmCall(1); }'); }
    catch (e) { refused = true; /* FAIL-OPEN: the throw is the measured refusal signal (acorn mandatory), captured on purpose. */ }
    return { pass: refused, detail: refused ? 'no-acorn engine correctly REFUSES (exit 2), never a zero' : 'no-acorn engine did not refuse - it must never approximate' };
  }
  const bad = [
    'async function f(fetchFn, u){ return await fetchFn(u); }',                      // undeadlined awaited fetch
    'async function g(o, r){ return await o.llmCall(r); }',                          // undeadlined awaited injected llm call
    'async function h(fetchFn, u){ return await fetchFn(u).catch(() => null); }',    // .catch chain still undeadlined
    'const cp = require("child_process"); cp.spawnSync("curl", ["https://x.example"]);', // spawn shelling to http
  ];
  const good = [
    'async function a(fetchFn, u){ return await withDeadline(() => fetchFn(u), 5000); }',  // wrapped
    'async function b(fetchFn, u){ return await fetchFn(u, { deadlineMs: 9000 }); }',       // self-bounded arg
    'async function c(page, u){ await page.goto(u); }',                                     // page.goto is not a known external ident
    'const m = /x/.exec(String(s));',                                                       // regex .exec is not a spawn
    'async function d(raceWithDeadline, work){ return await raceWithDeadline(work, 9000); }', // awaited wrapper itself
  ];
  const badOk = bad.every((s) => scanContent('t.js', s).violations.length === 1);
  const goodOk = good.every((s) => scanContent('t.js', s).violations.length === 0);
  return {
    pass: badOk && goodOk,
    detail: (badOk && goodOk)
      ? 'catches undeadlined awaits of fetchFn/llmCall (incl .catch chains) and spawn-to-http; clears wrapped calls, self-bounded args, page.goto, regex .exec and awaited wrappers (engine: acorn)'
      : 'FAILED: badOk=' + badOk + ' goodOk=' + goodOk,
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'deadline-audit', ruleId: 'deadline-audit/' + v.kind, file: v.file,
    startLine: v.line, endLine: v.line, level: 'error', message: v.message, snippet: v.kind,
  }));
}

function main() {
  try {
    runGateCli({
      name: 'deadline-audit',
      selfTest,
      scan: scanTree,
      toFindings,
      scanDirs: SCAN_DIRS,
      summary: (r) => r.scanned + ' files, ' + r.violations.length + ' undeadlined external-call site(s) (engine: ' + (useAcorn ? 'acorn' : 'refuse') + ')',
      calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded undeadlined site(s) found',
      violationLine: (v) => 'DEADLINE [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.message,
    });
  } catch (e) {
    // FAIL-CLOSED: an acorn refusal or a parse failure is a broken-tool state (exit 2), never a zero.
    console.error('deadline-audit REFUSES: ' + e.message);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { scanContent, scanTree, selfTest, toFindings, isKnownExternalCallee, isSpawnHttp, rootAwaitedCall };
