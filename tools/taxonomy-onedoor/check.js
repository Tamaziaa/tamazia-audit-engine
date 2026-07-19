#!/usr/bin/env node
'use strict';
/**
 * TAXONOMY-ONEDOOR: the one-door principle extended to VOCABULARY (Kimi WS0, blueprint 2.3; Constitution
 * Rule 22). The shared taxonomy package (taxonomy/index.js), deriving its sector names from
 * facts/vocabulary.js, is the ONE door for the sector PATH tree and the jurisdiction AXES. A module that
 * declares its OWN copy of that vocabulary is a second door, and "two sources of truth for sector names
 * become a compile error, which is what they always should have been."
 *
 * This gate flags, outside the allowed doors (taxonomy/ and facts/vocabulary.js), high-precision second
 * doors that carry ZERO false positives on the current tree:
 *   1. a valid multi-segment SECTOR-PATH string literal (e.g. 'healthcare.aesthetics.injectables') -
 *      confirmed via taxonomy.isSectorPath, so a signal name like 'ecommerce.jsonld_product_offers' (not a
 *      real path) is never flagged;
 *   2. a JURISDICTION-AXES declaration (a `JURISDICTION_AXES =`, a re-defined `sectorPathMatches`, or an
 *      `establishment_jurisdiction`/`audience_jurisdiction` constant / a `relation: 'establishment'|
 *      'audience'` axis literal) that re-derives the taxonomy's axis vocabulary in another module.
 *
 * Modes (the shared gate-cli contract): normal scan of the engine source dirs (exit 1 on any violation);
 * --calibrate scans eval/calibration-known-bad/fixtures/ and REQUIRES the seeded stray literal is caught;
 * --json <path> also writes findings for the sweep normaliser.
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');
const { listJsFiles } = require('../lib/fswalk');
const safePath = require('../lib/safe-path');
const taxonomy = require('../../taxonomy/index.js');

// The engine source dirs a second door could hide in. taxonomy/ IS scanned (CodeRabbit PR #33: a
// taxonomy/rogue.js sibling must not be able to redeclare vocabulary unseen), with ONLY taxonomy/index.js
// exempt as the door; facts/ is scanned because facts/vocabulary.js is the other door and everything else
// under facts/ must import, not re-declare. Tests are skipped by listJsFiles(skipTests).
const SCAN_DIRS = ['applicability', 'breach', 'catalogue', 'evidence', 'facts', 'llm', 'mint', 'payload', 'render-proof', 'taxonomy'];
// The exact one-door producer files (not a directory prefix): only taxonomy/index.js and facts/vocabulary.js
// may declare the shared taxonomy/jurisdiction vocabulary.
const ALLOWED_DOORS = ['taxonomy/index.js', 'facts/vocabulary.js'];

// A candidate quoted dotted literal: two or more lowercase-hyphen segments joined by dots. The gate then
// confirms each candidate is a REAL taxonomy path before flagging (precision: a non-path dotted string is
// left alone).
const DOTTED_LITERAL = /['"`]([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]+)+)['"`]/g;
// Jurisdiction-axis second-door DECLARATIONS (definitions/re-derivations, not consumer references). The
// sectorPathMatches pattern catches BOTH the function-declaration form and the const/let/var/property
// ASSIGNMENT form (`const sectorPathMatches = () => ...`, `sectorPathMatches:`), which the earlier
// function-only pattern missed (CodeRabbit PR #33). A consumer member-call `taxonomy.sectorPathMatches(...)`
// is followed by '(' not '[:=]', and a destructure `{ sectorPathMatches }` by '}' not '[:=]', so neither
// trips - only a re-definition/re-assignment does.
const AXIS_DECLARATIONS = [
  { rx: /\bJURISDICTION_AXES\b\s*[:=]/, label: 'a JURISDICTION_AXES declaration' },
  { rx: /\bfunction\s+sectorPathMatches\b|\bsectorPathMatches\s*[:=]/, label: 'a redefinition of sectorPathMatches' },
  { rx: /\b(?:establishment|audience)_jurisdiction\b\s*[:=]/, label: 'an establishment/audience_jurisdiction constant' },
  { rx: /\brelation\s*[:=]\s*['"`](?:establishment|audience)['"`]/, label: "a relation: 'establishment'|'audience' axis literal" },
];

function isAllowed(relPath) {
  return ALLOWED_DOORS.some((a) => (a.endsWith('/') ? relPath.startsWith(a) : relPath === a));
}

// lineOf(content, index) -> the 1-based line number of a character offset.
function lineOf(content, index) { return content.slice(0, index).split('\n').length; }

// scanSectorPathLiterals(relPath, content) -> a violation per REAL sector-path literal in the file.
function scanSectorPathLiterals(relPath, content) {
  const out = [];
  for (const m of content.matchAll(DOTTED_LITERAL)) {
    const candidate = m[1];
    if (!taxonomy.isSectorPath(candidate)) continue; // only a real taxonomy path is a second door
    out.push({ file: relPath, line: lineOf(content, m.index), kind: 'sector-path literal', excerpt: candidate });
  }
  return out;
}
// scanAxisDeclarations(relPath, content) -> a violation per jurisdiction-axis declaration in the file.
function scanAxisDeclarations(relPath, content) {
  const out = [];
  for (const { rx, label } of AXIS_DECLARATIONS) {
    const m = rx.exec(content);
    if (m) out.push({ file: relPath, line: lineOf(content, m.index), kind: label, excerpt: content.slice(m.index, m.index + 60).split('\n')[0] });
  }
  return out;
}

function scanContent(relPath, content) {
  if (isAllowed(relPath)) return [];
  return [...scanSectorPathLiterals(relPath, content), ...scanAxisDeclarations(relPath, content)];
}

function scanTree(dirs) {
  const violations = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const abs of listJsFiles(safePath.resolveSafeRelativePath(ROOT, dir, { label: 'taxonomy-onedoor scan dir' }), { skipTests: true })) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      violations.push(...scanContent(rel, fs.readFileSync(abs, 'utf8')));
    }
  }
  return { violations, scanned };
}

// selfTest: a real sector-path literal and an axis declaration in a non-door file are caught (including a
// rogue taxonomy/ sibling and the arrow-assignment form of sectorPathMatches); the same literal in the
// index.js door is NOT; a non-path dotted literal is NOT (the precision guard).
function selfTest() {
  const badPath = scanContent('breach/rogue.js', "const s = 'healthcare.aesthetics.injectables';\n");
  const badAxis = scanContent('facts/rogue.js', "const JURISDICTION_AXES = { country: 'US' };\n");
  const rogueSibling = scanContent('taxonomy/rogue.js', "const s = 'healthcare.aesthetics.injectables';\n");
  const arrowRedef = scanContent('breach/rogue2.js', "const sectorPathMatches = (a, b) => a === b;\n");
  const inDoor = scanContent('taxonomy/index.js', "const p = 'healthcare.aesthetics.injectables';\n");
  const nonPath = scanContent('facts/capabilities.js', "signal: 'ecommerce.jsonld_product_offers',\n");
  const pass = badPath.length >= 1 && badAxis.length >= 1 && rogueSibling.length >= 1 && arrowRedef.length >= 1
    && inDoor.length === 0 && nonPath.length === 0;
  return {
    pass,
    detail: 'stray sector-path literal: ' + badPath.length + ' (want >=1); axis declaration: ' + badAxis.length
      + ' (want >=1); rogue taxonomy sibling: ' + rogueSibling.length + ' (want >=1); arrow-form redefinition: '
      + arrowRedef.length + ' (want >=1); same literal in the index.js door: ' + inDoor.length
      + ' (want 0); non-path dotted literal: ' + nonPath.length + ' (want 0)',
  };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'taxonomy-onedoor',
    ruleId: 'taxonomy-second-door',
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    level: 'error',
    message: 'TAXONOMY SECOND DOOR: ' + v.kind + ' declared outside the shared taxonomy (taxonomy/ + facts/vocabulary.js). Import from taxonomy/index.js; do not re-declare the sector/jurisdiction vocabulary (Rule 22, blueprint 2.3).',
    snippet: v.excerpt,
  }));
}

function main() {
  runGateCli({
    name: 'taxonomy-onedoor',
    selfTest,
    scan: (dirs) => scanTree(dirs),
    toFindings,
    scanDirs: SCAN_DIRS,
    summary: (r) => r.scanned + ' files scanned, ' + r.violations.length + ' taxonomy second door(s)',
    calibrateSummary: (r) => r.scanned + ' fixture files, ' + r.violations.length + ' seeded second door(s) found',
    violationLine: (v) => 'TAXONOMY SECOND DOOR [' + v.kind + '] ' + v.file + ':' + v.line + '  ' + v.excerpt,
  });
}

if (require.main === module) main();
module.exports = { scanContent, scanTree, selfTest, toFindings };
