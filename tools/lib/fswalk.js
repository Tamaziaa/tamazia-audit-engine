'use strict';
/**
 * The one file walker for the tool fleet. one-door, swallow-gate and the sweep collectors all walk the tree
 * through this door; a second walker is exactly the clone class jscpd exists to catch.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SKIP = /^(node_modules|\.git|out)$/;

/**
 * List .js/.mjs/.cjs files under absDir.
 * opts.skipDirs   regex of directory NAMES to skip (default: node_modules, .git, out)
 * opts.skipTests  when true, skip *.test.js files and tests/ directories
 */
function listJsFiles(absDir, opts) {
  const o = opts || {};
  const skipDirs = o.skipDirs || DEFAULT_SKIP;
  const files = [];
  if (!fs.existsSync(absDir)) return files;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (skipDirs.test(e.name)) continue;
        if (o.skipTests && /^tests?$/.test(e.name)) continue;
        walk(p);
      } else if (/\.(js|mjs|cjs)$/.test(e.name)) {
        if (o.skipTests && /\.test\.[mc]?js$/.test(e.name)) continue;
        files.push(p);
      }
    }
  })(absDir);
  return files;
}

module.exports = { listJsFiles };
