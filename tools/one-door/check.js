#!/usr/bin/env node
'use strict';
/**
 * ONE-DOOR: the semantic-duplication detector. THE most valuable analyser in the fleet.
 *
 * jscpd sees textual clones. This sees SEMANTIC clones: two different pieces of code that both PRODUCE the
 * same client-visible fact. The stale door is the one the client sees. This class has already shipped a P0
 * three times on the old estate: the ghost jurisdiction, the "Sector regulator" label, and the GBP 17.5M
 * fine that never reached the client.
 *
 * The contract lives in facts.json: every client-visible fact -> its ONE allowed producer path. Any file
 * outside the allowed producer that matches a fact's producer patterns is a second door, and this check
 * exits non-zero.
 *
 * Modes:
 *   node tools/one-door/check.js                      scan the engine source tree, exit 1 on any violation
 *   node tools/one-door/check.js --json <path>        also write findings JSON for the sweep normaliser
 *   node tools/one-door/check.js --calibrate          scan eval/calibration-known-bad/fixtures/ and REQUIRE
 *                                                     that seeded violations are found. Zero found = exit 1.
 *                                                     A zero you did not earn is a lie.
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');
const safePath = require('../lib/safe-path');

const FACTS_PATH = path.join(__dirname, 'facts.json');
const SCAN_DIRS = ['catalogue', 'evidence', 'facts', 'applicability', 'breach', 'llm', 'payload', 'mint', 'render-proof', 'enforcement'];

// THE CONSUMER-CALL-SITE EXEMPTION (why this gate must not fire on a legitimate caller).
// A fact tagged "kind":"producer-fn" in facts.json (jurisdiction, sector, identity, capabilities) carries
// FUNCTION-NAME patterns. A function-name pattern matches a producer BOTH where it is defined and where it
// is CALLED, and only the definition is a second door. Each such pattern anchors the producer NAME in a
// (?<pname>...) named group so scanContent can locate the name and apply ONE precise, two-part rule:
//   a match is EXEMPT (a consumer member-call, NOT a violation) if and only if BOTH
//     1. the producer name is immediately preceded (skipping only whitespace) by a member-access
//        operator '.' or '?.'  (a genuine '.', never the '..' of a spread), AND
//     2. the producer name is immediately followed (skipping only whitespace) by an invocation '('.
// Everything else stays a violation: a bare 'resolveSector(bundle)' call (no leading dot), an assigned
// producer 'const resolveSector = (...)', an object-literal export 'module.exports = { resolveSector }',
// a method-shorthand definition, and - THE FALSE-NEGATIVE TRAP - an 'exports.resolveIdentity = ...' export,
// which HAS a leading dot BUT is followed by ' =', not '('. Never exempt on the leading dot alone. The
// DATA-LITERAL facts (fine, regulator, law-title, host, element-checklist) carry no pname anchor and keep
// their historical first-match-anywhere firing: a fine or regulator literal is never a "call site".

// compilePattern(fact, source, producerFnFact) -> { rx, producerFn, source }. A FUNCTION-NAME pattern (its
// fact marked kind:"producer-fn" AND the pattern carrying a (?<pname>...) producer-name anchor) is compiled
// global + hasIndices ('gmd') so scanContent can walk EVERY match and read the producer NAME's [start,end]
// from m.indices.groups.pname; every other pattern keeps its historical single-line 'm' semantics. Patterns
// are catalogue-controlled (this repo's own committed tools/one-door/facts.json, never network/runtime
// input): compiling them IS this gate's whole purpose. A malformed pattern must fail loud and typed here,
// not bubble up as an opaque SyntaxError several stack frames away from its cause.
function compilePattern(fact, source, producerFnFact) {
  const producerFn = producerFnFact && /\(\?<pname>/.test(source);
  try {
    return { rx: new RegExp(source, producerFn ? 'gmd' : 'm'), producerFn, source };
  } catch (e) {
    throw new Error('tools/one-door/facts.json: fact ' + JSON.stringify(fact.id) + ' has a pattern that does not compile: ' + JSON.stringify(source) + ' (' + e.message + ')');
  }
}

function loadFacts(factsPath) {
  // A manifest we cannot parse has NOT declared zero facts. Fail loud.
  const doc = JSON.parse(fs.readFileSync(factsPath || FACTS_PATH, 'utf8'));
  if (!Array.isArray(doc.facts) || doc.facts.length === 0) throw new Error('facts.json declares no facts');
  return doc.facts.map((f) => {
    const producerFnFact = f.kind === 'producer-fn';
    return {
      id: f.id,
      label: f.label,
      allowed: f.allowed_producers || [],
      patterns: f.patterns.map((p) => compilePattern(f, p, producerFnFact)),
    };
  });
}

function isAllowed(relPath, fact) {
  return fact.allowed.some((a) => (a.endsWith('/') ? relPath.startsWith(a) : relPath === a));
}

// isConsumerCallSite(content, nameStart, nameEnd) -> true when the producer NAME token spanning
// [nameStart, nameEnd) is a CONSUMER member-call: immediately preceded (skipping only whitespace) by a
// member-access operator '.' or '?.' AND immediately followed (skipping only whitespace) by '('. This is
// the WHOLE exemption discriminator (see the two-part rule documented above compilePattern). It is
// deliberately conservative and errs toward a violation: a spread 'f(...bar(x))' (the dot is part of '..'),
// a bare 'bar(x)' (no leading dot) and an 'exports.bar =' export (followed by '=', not '(') are all
// NON-consumer sites and stay violations.
function isConsumerCallSite(content, nameStart, nameEnd) {
  let i = nameStart - 1;
  while (i >= 0 && /\s/.test(content[i])) i--;             // skip ONLY whitespace, backwards
  if (i < 0 || content[i] !== '.') return false;            // must sit behind a member-access dot ('.' or '?.')
  if (i >= 1 && content[i - 1] === '.') return false;       // '..'/'...' is a spread/range, not member access
  let j = nameEnd;
  while (j < content.length && /\s/.test(content[j])) j++;  // skip ONLY whitespace, forwards
  return j < content.length && content[j] === '(';          // must be an invocation
}

// firstMatch(rx, content) -> { index, source } of the first match, or null. DATA-LITERAL patterns keep
// their historical first-match-anywhere semantics: a fine / regulator / law literal is a second door
// wherever it appears and is never a "call site".
function firstMatch(rx, content) {
  const m = rx.exec(content);
  return m ? { index: m.index, source: rx.source } : null;
}

// firstNonExemptMatch(rx, content) -> the first match of a FUNCTION-NAME pattern that is NOT an exempt
// consumer call site, or null when every match is exempt. rx is global + hasIndices. A match with no
// captured pname (a bare 'function foo' DEFINITION branch, which carries no name anchor) is a definite
// violation. A match whose pname token is a member-call (isConsumerCallSite) is exempt; every other match
// (bare call, export, object-literal, re-derivation) is a violation. Runs per-pattern because a producer-fn
// fact still owns data-literal patterns alongside its one function-name pattern.
function firstNonExemptMatch(rx, content) {
  rx.lastIndex = 0; // matchAll clones the regex, but reset defensively so no leftover lastIndex skips a match
  for (const m of content.matchAll(rx)) {
    const span = m.indices && m.indices.groups ? m.indices.groups.pname : null;
    if (!span) return { index: m.index, source: rx.source };                  // no name anchor => not a call site
    if (!isConsumerCallSite(content, span[0], span[1])) return { index: span[0], source: rx.source };
  }
  return null; // every occurrence was an exempt consumer member-call: this door did not fire
}

// Scan one file's content. Returns violations: a NON-EXEMPT match for a fact's producer pattern in a file
// that is not the fact's one allowed door. One violation per fact per file (the door is the unit, not the
// match). A producer-fn pattern fires only on a non-consumer-call-site occurrence (the exemption above); a
// data-literal pattern fires on its first match, exactly as it always has.
function scanContent(relPath, content, facts) {
  const out = [];
  for (const fact of facts) {
    if (isAllowed(relPath, fact)) continue;
    let hit = null;
    for (const p of fact.patterns) {
      hit = p.producerFn ? firstNonExemptMatch(p.rx, content) : firstMatch(p.rx, content);
      if (hit) break; // one violation per fact per file is enough; the door is the unit, not the match
    }
    if (!hit) continue;
    const line = content.slice(0, hit.index).split('\n').length;
    out.push({
      fact: fact.id,
      label: fact.label,
      file: relPath,
      line,
      pattern: hit.source,
      excerpt: content.slice(hit.index, hit.index + 120).split('\n')[0],
      allowed: fact.allowed.join(', '),
    });
  }
  return out;
}

const { listJsFiles } = require('../lib/fswalk');

function scanTree(dirs, facts) {
  const violations = [];
  let scanned = 0;
  for (const dir of dirs) {
    // dir is either one of SCAN_DIRS above (a single-segment literal name) or gate-cli's
    // multi-segment CALIBRATE_DIR ('eval/calibration-known-bad/fixtures') under --calibrate:
    // resolveSafeRelativePath covers both (safeJoin's single-PATH-COMPONENT contract would wrongly
    // reject the multi-segment calibrate path).
    for (const abs of listJsFiles(safePath.resolveSafeRelativePath(ROOT, dir, { label: 'one-door scan dir' }), { skipTests: true })) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      violations.push(...scanContent(rel, fs.readFileSync(abs, 'utf8'), facts));
    }
  }
  return { violations, scanned };
}

// Self-test: prove the detector can see the class it exists to catch, using synthetic content in memory.
// If this fails, every green run this tool has ever produced is suspect.
function selfTest() {
  const facts = loadFacts();
  const bad = scanContent('breach/rogue.js',
    "const fine_high_gbp = 17500000;\nconst regulator = 'Information Commissioner';\n", facts);
  const badFn = scanContent('evidence/rogue2.js',
    "function detectJurisdiction(domain) { return 'UK'; }\n", facts);
  const good = scanContent('catalogue/compiled.js',
    "const fine_high_gbp = 17500000;\nconst regulator = 'Information Commissioner';\n", facts);
  // The consumer-call-site exemption, proven BOTH directions (the discriminator this gate turns on):
  //   a member-call to the one door is NOT a second door (must be exempt) ...
  const consumerCall = scanContent('breach/consumer.js', "x.resolveJurisdiction(bundle);\n", facts);
  //   ... but an export DEFINITION (leading dot, followed by ' =', NOT '(') MUST still be caught. This is
  //   the false-negative trap: never exempt on the leading dot alone.
  const exportDef = scanContent('evidence/rogue3.js', "exports.resolveIdentity = function (b) { return b; };\n", facts);
  const pass = bad.length >= 2 && badFn.length >= 1 && good.length === 0
    && consumerCall.length === 0 && exportDef.length >= 1;
  return {
    pass,
    detail: 'synthetic second doors: ' + bad.length + ' violations (want >=2) + ' + badFn.length
      + ' jurisdiction-fn def (want >=1); allowed door: ' + good.length + ' (want 0); consumer member-call: '
      + consumerCall.length + ' (want 0, exempt); export-definition: ' + exportDef.length + ' (want >=1, caught)',
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'one-door',
    ruleId: 'multiple-producers:' + v.fact,
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    level: 'error',
    message: 'TWO DOORS: "' + v.label + '" produced outside its one allowed door (' + v.allowed + '). The stale door is the one the client sees.',
    snippet: v.excerpt,
  }));
}

function main() {
  const facts = loadFacts();
  runGateCli({
    name: 'one-door',
    selfTest,
    scan: (dirs) => scanTree(dirs, facts),
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' files scanned, ' + facts.length + ' facts declared, ' + r.violations.length + ' violations',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded violations found',
    violationLine: (v) => 'TWO DOORS [' + v.fact + '] ' + v.file + ':' + v.line + '  (allowed: ' + v.allowed + ')  ' + v.excerpt,
  });
}

if (require.main === module) main();
module.exports = { loadFacts, scanContent, scanTree, selfTest, toFindings };
