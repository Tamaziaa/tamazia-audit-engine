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

const FACTS_PATH = path.join(__dirname, 'facts.json');
const SCAN_DIRS = ['catalogue', 'evidence', 'facts', 'applicability', 'breach', 'llm', 'payload', 'mint', 'render-proof'];

function loadFacts(factsPath) {
  // A manifest we cannot parse has NOT declared zero facts. Fail loud.
  const doc = JSON.parse(fs.readFileSync(factsPath || FACTS_PATH, 'utf8'));
  if (!Array.isArray(doc.facts) || doc.facts.length === 0) throw new Error('facts.json declares no facts');
  return doc.facts.map((f) => ({
    id: f.id,
    label: f.label,
    allowed: f.allowed_producers || [],
    patterns: f.patterns.map((p) => new RegExp(p, 'm')),
  }));
}

function isAllowed(relPath, fact) {
  return fact.allowed.some((a) => (a.endsWith('/') ? relPath.startsWith(a) : relPath === a));
}

// Scan one file's content. Returns violations: a match for a fact's producer pattern in a file that is not
// the fact's one allowed door.
function scanContent(relPath, content, facts) {
  const out = [];
  for (const fact of facts) {
    if (isAllowed(relPath, fact)) continue;
    for (const rx of fact.patterns) {
      const m = rx.exec(content);
      if (!m) continue;
      const line = content.slice(0, m.index).split('\n').length;
      out.push({
        fact: fact.id,
        label: fact.label,
        file: relPath,
        line,
        pattern: rx.source,
        excerpt: content.slice(m.index, m.index + 120).split('\n')[0],
        allowed: fact.allowed.join(', '),
      });
      break; // one violation per fact per file is enough; the door is the unit, not the match
    }
  }
  return out;
}

const { listJsFiles } = require('../lib/fswalk');

function scanTree(dirs, facts) {
  const violations = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const abs of listJsFiles(path.join(ROOT, dir), { skipTests: true })) {
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
  const pass = bad.length >= 2 && badFn.length >= 1 && good.length === 0;
  return { pass, detail: 'synthetic second doors: ' + bad.length + ' violations (want >=2) + ' + badFn.length + ' jurisdiction-fn (want >=1); allowed door: ' + good.length + ' (want 0)' };
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
