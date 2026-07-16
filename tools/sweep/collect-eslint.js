#!/usr/bin/env node
'use strict';
/**
 * ESLint -> the one entry point. On the old estate, no-undef and no-use-before-define each caught a
 * MINT-KILLING bug that 77 green evals missed. This is not a style checker here; it is the gate that proves
 * the code can run at all.
 *
 * ESLint is an optional devDependency. If it is not installed, this collector SKIPS loudly and records the
 * skip as a note-level finding, so the ledger shows the tool was absent rather than silently pretending it
 * ran and found nothing. A skip is visible; a fake zero is not.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'tools', 'sweep', 'out', 'sarif');
const OUT_FILE = path.join(OUT_DIR, 'eslint.local.json');
const TARGETS = ['catalogue', 'evidence', 'facts', 'applicability', 'breach', 'llm', 'payload', 'mint', 'render-proof', 'eval', 'tools'].filter((d) => fs.existsSync(path.join(ROOT, d)));

function eslintBin() {
  const local = path.join(ROOT, 'node_modules', '.bin', 'eslint');
  return fs.existsSync(local) ? local : null;
}

function parseOutput(text) {
  const out = [];
  const parsed = JSON.parse(text);
  for (const f of parsed) {
    for (const m of f.messages) {
      out.push({
        tool: 'eslint',
        ruleId: m.ruleId || 'parse-error',
        file: path.relative(ROOT, f.filePath).replace(/\\/g, '/'),
        startLine: m.line,
        endLine: m.endLine || m.line,
        level: m.severity === 2 ? 'error' : 'warning',
        message: m.message,
        snippet: (m.source || m.message || '').slice(0, 120),
      });
    }
  }
  return out;
}

function main() {
  let out = [];
  const bin = eslintBin();

  if (!bin) {
    console.log('  eslint: SKIPPED (not installed; add eslint to devDependencies to arm this collector)');
    out.push({
      tool: 'eslint', ruleId: 'tool-absent', file: 'package.json', startLine: 0, level: 'note',
      message: 'eslint is not installed, so the eslint lane did NOT run. This is a skip on the record, not a zero.',
      snippet: 'eslint absent',
    });
  } else {
    let text = '';
    try {
      text = execFileSync(bin, [...TARGETS, '-f', 'json', '--no-error-on-unmatched-pattern'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 128e6 });
    } catch (e) {
      // eslint exits non-zero when it FINDS things; its findings are on stdout. Anything unparseable is loud.
      text = (e.stdout || '').toString();
      if (!text.trim()) throw new Error('eslint failed and produced no parseable output: ' + e.message + ' (this is NOT zero findings)');
    }
    out = parseOutput(text);
    console.log('  eslint findings: ' + out.length + ' (' + out.filter((x) => x.level === 'error').length + ' errors)');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
}

if (require.main === module) main();
module.exports = { parseOutput };
