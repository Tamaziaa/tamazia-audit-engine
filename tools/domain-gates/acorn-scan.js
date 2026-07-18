'use strict';
/**
 * acorn-scan.js - the shared source-tree walk for the acorn domain gates (budget-caps, host-parse).
 *
 * Both gates walk the same engine source dirs and apply their OWN per-file detector; only the traversal is
 * identical. That traversal lived byte-for-byte in each gate (a jscpd clone). It is extracted here so there
 * is ONE copy: each gate keeps its own scanContent(relPath, src) -> { violations } (its detection door) and
 * passes it in. Pure over its inputs; the only effect is reading files off disk via listJsFiles.
 */
const fs = require('fs');
const path = require('path');

const { ROOT } = require('../lib/gate-cli');
const { listJsFiles } = require('../lib/fswalk');

// scanTreeWith(dirs, skipDirs, scanContent) -> { violations, scanned }. Walks every non-test .js file under
// each dir (skipping skipDirs), applies scanContent to its source, and aggregates the violations. Test
// files are skipped (skipTests) so a gate never flags its own calibration fixtures' consuming tests.
function scanTreeWith(dirs, skipDirs, scanContent) {
  const violations = [];
  let scanned = 0;
  for (const dir of dirs) {
    const absDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
    for (const abs of listJsFiles(absDir, { skipDirs, skipTests: true })) {
      scanned++;
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      violations.push(...scanContent(rel, fs.readFileSync(abs, 'utf8')).violations);
    }
  }
  return { violations, scanned };
}

// The micro-helpers every acorn gate needs (isMetaKey to skip acorn's loc/start/end/range bookkeeping,
// lineOf for a 1-based report line, memberPropName for a MemberExpression's property name). Extracted
// here so the acorn domain gates share ONE copy rather than each re-declaring them (jscpd clone class).
function isMetaKey(k) { return k === 'loc' || k === 'start' || k === 'end' || k === 'range'; }
function lineOf(node) { return (node && node.loc && node.loc.start.line) || 1; }
// Each named predicate below owns one branch of memberPropName's decision, so the if-chain itself has
// no multi-term test left (the health-gate "Complex Conditional" cap).
function isMissingMemberInfo(m) {
  return !m || m.type !== 'MemberExpression' || !m.property;
}
function isPlainPropertyAccess(m) {
  return !m.computed && m.property.type === 'Identifier';
}
function isComputedLiteralAccess(m) {
  return m.computed && m.property.type === 'Literal';
}
function memberPropName(m) {
  if (isMissingMemberInfo(m)) return '';
  if (isPlainPropertyAccess(m)) return m.property.name;
  if (isComputedLiteralAccess(m)) return String(m.property.value);
  return '';
}

module.exports = { scanTreeWith, isMetaKey, lineOf, memberPropName };
