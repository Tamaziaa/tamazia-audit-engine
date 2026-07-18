'use strict';
// acorn-scan.test.js - the shared source-tree walk for the acorn domain gates.

const test = require('node:test');
const assert = require('node:assert');

const { scanTreeWith } = require('./acorn-scan.js');

test('scanTreeWith walks a dir, skips test files, applies scanContent and aggregates violations', () => {
  const seen = [];
  const scanContent = (rel) => {
    seen.push(rel);
    return { violations: rel.endsWith('crawler/pool.js') ? [{ file: rel }] : [] };
  };
  const { violations, scanned } = scanTreeWith(['evidence/crawler'], /^node_modules$/, scanContent);
  assert.ok(scanned > 0, 'it scanned files');
  assert.ok(seen.some((r) => r.endsWith('crawler/pool.js')), 'it reached a real source file');
  assert.ok(!seen.some((r) => r.endsWith('.test.js')), 'test files are skipped (skipTests)');
  assert.equal(violations.length, 1, 'per-file violations are aggregated');
  assert.equal(violations[0].file.replace(/\\/g, '/'), 'evidence/crawler/pool.js');
});
