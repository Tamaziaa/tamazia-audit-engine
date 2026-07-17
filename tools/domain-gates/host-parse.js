#!/usr/bin/env node
'use strict';
/**
 * HOST-PARSE gate: the host-substring class dies here (GAPS.md `host-substring`, caution.md C-009).
 *
 * "Is this URL on this site" must be decided by PARSING the URL and comparing the HOSTNAME, never by a
 * substring/token test. `url.includes(domain)` is TRUE for https://evil.com/linkedin.com; `host.endsWith
 * (domain)` is TRUE for notreed.co.uk vs reed.co.uk. The old estate bound the wrong company's identity
 * and the wrong country's law off exactly these. The ONE door is tools/lib/safe-fetch.js (isSameHost /
 * sameRegistrableSite / registrableDomain / hostOf); this gate fails CI on any host comparison done by
 * substring OUTSIDE that door.
 *
 * DETECTION (acorn AST): a string-search call - .includes / .indexOf / .search / .match / .startsWith /
 * .endsWith - whose FIRST argument is host-ish:
 *   - an identifier named domain/dom/host/hostname/site/registrable/apex/fqdn, or
 *   - a member expression ending .hostname/.host/.domain, or
 *   - a bare-hostname string literal (linkedin.com, reed.co.uk).
 * A scheme check (u.indexOf('://'), href.startsWith('/')) and a dot check (h.includes('.')) are NOT
 * host-substring: their argument is not a host, so they are spared. Comparing PARSED hostnames
 * (new URL(u).hostname === domain) never appears as a string-search call, so it is spared too.
 *
 * Engine: acorn is MANDATORY (ships transitively via eslint). Without it the gate REFUSES (exit 2) rather
 * than approximate - under-reporting a host-substring is an unearned zero (Constitution Rule 4). A string
 * literal that merely CONTAINS `.includes(` is invisible to acorn, so no false hit from comments/strings.
 *
 * Modes (tools/lib/gate-cli.js dialect):
 *   node tools/domain-gates/host-parse.js               scan the engine source, exit 1 on any violation
 *   node tools/domain-gates/host-parse.js --json <path> also write findings JSON for the sweep normaliser
 *   node tools/domain-gates/host-parse.js --calibrate   scan eval/calibration-known-bad/fixtures/ and
 *                                                        REQUIRE the seeded host-substring to be caught
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');
const { listJsFiles } = require('../lib/fswalk');

// Engine-side host-comparison surfaces. tools/ is excluded: the parsed-host DOOR (safe-fetch.js) and the
// gates themselves legitimately parse hosts; scanning them would flag the one place this is allowed.
const SCAN_DIRS = ['evidence', 'facts', 'applicability', 'breach', 'llm', 'mint', 'payload'];
const SKIP_DIRS = /^(node_modules|\.git|out|packs|dist|fixtures)$/;

const SEARCH_METHODS = new Set(['includes', 'indexOf', 'search', 'match', 'startsWith', 'endsWith']);
const HOST_IDENT_RX = /^_?(domain|dom|host|hostname|site|registrable|apex|fqdn)$/i;
const HOST_MEMBER_RX = /^(hostname|host|domain)$/i;
// A bare-hostname literal: label(.label)+ ending in a >=2-char alpha TLD. Deliberately does NOT match
// '://', '/', '.', 'http', a path or a scheme - those are not hosts, so those calls are not the class.
const HOSTNAME_LITERAL_RX = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;

let acorn = null;
try { acorn = require('acorn'); }
catch (e) { acorn = null; /* FAIL-OPEN: acorn=null is the typed failure state captured HERE; scanContent() then REFUSES (exit 2) so the SYSTEM fails closed. acorn ships transitively via eslint, so this branch does not fire in a normal install. */ }
const FORCE_REFUSE = process.env.HOST_PARSE_ENGINE === 'refuse';
const useAcorn = Boolean(acorn) && !FORCE_REFUSE;

// ── acorn: collect every CallExpression node (compact generic walk, positions preserved) ──────────────
function collectCalls(root) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (typeof n.type !== 'string') return;
    if (n.type === 'CallExpression') out.push(n);
    for (const k of Object.keys(n)) { if (k !== 'loc' && k !== 'start' && k !== 'end') walk(n[k]); }
  })(root);
  return out;
}

// isHostishArg(arg) -> true when `arg` names a HOST value (an identifier, a .hostname/.host/.domain
// member, or a bare-hostname literal). This is what turns a generic string search into a host test.
function isHostishArg(arg) {
  if (!arg || typeof arg !== 'object') return false;
  if (arg.type === 'Identifier') return HOST_IDENT_RX.test(arg.name);
  if (arg.type === 'MemberExpression' && arg.property && arg.property.type === 'Identifier') {
    return HOST_MEMBER_RX.test(arg.property.name);
  }
  if (arg.type === 'Literal') return typeof arg.value === 'string' && HOSTNAME_LITERAL_RX.test(arg.value);
  return false;
}

// searchMethodName(callee) -> the string-search method name (.includes etc.) this call invokes, or null.
function searchMethodName(callee) {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null;
  if (!callee.property || callee.property.type !== 'Identifier') return null;
  return SEARCH_METHODS.has(callee.property.name) ? callee.property.name : null;
}

function judgeCall(relPath, node) {
  const method = searchMethodName(node.callee);
  if (!method) return null;
  const arg0 = node.arguments && node.arguments[0];
  if (!isHostishArg(arg0)) return null;
  const line = (node.loc && node.loc.start.line) || 1;
  return {
    file: relPath, line, kind: 'host-substring', method,
    message: 'host compared by .' + method + '() substring, not a parsed host; route it through tools/lib/safe-fetch.js (isSameHost / sameRegistrableSite)',
  };
}

function scanContent(relPath, src) {
  if (!useAcorn) throw new Error(relPath + ': acorn unavailable and HOST_PARSE refuses to approximate host-substring detection (an under-report is an unearned zero, Constitution Rule 4)');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, locations: true }); }
  catch (e) { throw new Error(relPath + ': acorn cannot parse this file: ' + e.message + ' (a parse failure is NOT zero violations)'); }
  const violations = [];
  for (const call of collectCalls(ast)) { const v = judgeCall(relPath, call); if (v) violations.push(v); }
  return { violations };
}

function scanTree(dirs) {
  const violations = [];
  let scanned = 0;
  for (const dir of dirs) {
    const absDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
    for (const abs of listJsFiles(absDir, { skipDirs: SKIP_DIRS, skipTests: true })) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      violations.push(...scanContent(rel, fs.readFileSync(abs, 'utf8')).violations);
    }
  }
  return { violations, scanned };
}

// Self-test: prove the ACTIVE engine sees the class, and clears legitimate parsed/scheme/dot checks.
function selfTest() {
  if (!useAcorn) {
    let refused = false;
    try { scanContent('selftest.js', 'const x = url.includes(domain);'); }
    catch (e) { refused = true; /* FAIL-OPEN: the throw is the measured refusal signal (acorn mandatory), captured on purpose. */ }
    return { pass: refused, detail: refused ? 'no-acorn engine correctly REFUSES (exit 2), never a zero' : 'no-acorn engine did not refuse - it must never approximate' };
  }
  const bad = [
    'const a = url.includes(domain);',
    "const b = href.includes('linkedin.com');",
    'const c = host.indexOf(dom) >= 0;',
    'const d = u.endsWith(hostname);',
    'const e = x.startsWith(u.hostname);',
  ];
  const good = [
    "const f = u.indexOf('://');",            // scheme separator check
    "const g = h.includes('.');",             // dot check
    "const i = href.startsWith('/');",        // path check
    'const j = new URL(u).hostname === domain;', // the CORRECT parsed comparison
    "const k = text.includes('privacy');",    // prose search, not a host
  ];
  const badOk = bad.every((s) => scanContent('t.js', s).violations.length === 1);
  const goodOk = good.every((s) => scanContent('t.js', s).violations.length === 0);
  return {
    pass: badOk && goodOk,
    detail: (badOk && goodOk)
      ? 'catches .includes/.indexOf/.search/.startsWith/.endsWith against a host identifier / .hostname member / hostname literal; clears scheme, dot, path and parsed-hostname comparisons (engine: acorn)'
      : 'FAILED: badOk=' + badOk + ' goodOk=' + goodOk,
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'host-parse', ruleId: 'host-parse/' + v.kind, file: v.file,
    startLine: v.line, endLine: v.line, level: 'error', message: v.message, snippet: '.' + v.method + '()',
  }));
}

function main() {
  runGateCli({
    name: 'host-parse',
    selfTest,
    scan: scanTree,
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' files, ' + r.violations.length + ' host-substring violation(s) (engine: ' + (useAcorn ? 'acorn' : 'refuse') + ')',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded host-substring(s) found',
    violationLine: (v) => 'HOST-PARSE [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.message,
  });
}

if (require.main === module) main();

module.exports = { scanContent, scanTree, selfTest, toFindings, judgeCall, isHostishArg, SEARCH_METHODS };
