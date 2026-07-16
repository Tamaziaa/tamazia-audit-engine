#!/usr/bin/env node
'use strict';
/**
 * THE ONE EXIT POINT. tools/sweep/out/ledger.json -> tools/sweep/out/LEDGER.md.
 * Generated, never hand-edited. Regenerate with `node tools/sweep/run.js`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'sweep', 'out');

function render(d) {
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const L = [];

  L.push('# Tamazia Audit Engine, Findings Ledger');
  L.push('### Every tool. Every finding. One number each.');
  L.push('### Generated ' + d.generated_at + '. Do not hand-edit; regenerate with `node tools/sweep/run.js`.');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## THE GATE');
  L.push('');
  L.push('> **`ACT`**: **two or more independent tools agree.** That is a fact. Fix it. Work stops while ACT findings are open.');
  L.push('> **`REVIEW`**: **one tool only.** That is a lead, not a fact. It is triaged, never auto-fixed.');
  L.push('');
  L.push('A lone finding from a weak tool is noise, and a lone finding from a strong tool is still only a lead.');
  L.push('Corroboration is the whole point. Numbering is deterministic (severity DESC, corroboration DESC,');
  L.push('fingerprint ASC), and fingerprints never include line numbers, so the ledger diffs cleanly across runs.');
  L.push('');
  L.push('## THE NUMBERS');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push('| raw findings ingested | **' + d.raw_findings + '** |');
  L.push('| after fingerprint dedupe | **' + d.after_dedupe + '** |');
  L.push('| distinct defects (clustered) | **' + d.clusters + '** |');
  L.push('| **ACT** (>=2 tools) | **' + d.act + '** |');
  L.push('| REVIEW (1 tool) | ' + d.review + ' |');
  L.push('');
  L.push('### By tool');
  L.push('');
  L.push('| Tool | Findings |');
  L.push('|---|---|');
  const byTool = Object.entries(d.by_tool).sort((a, b) => b[1] - a[1]);
  if (byTool.length === 0) L.push('| (no tool reported a finding this run) | 0 |');
  for (const [t, n] of byTool) L.push('| ' + t + ' | ' + n + ' |');
  L.push('');
  L.push('### By severity (clustered)');
  L.push('');
  L.push('| Sev | Count |');
  L.push('|---|---|');
  for (const [s, n] of Object.entries(d.by_severity)) L.push('| ' + s + ' | ' + n + ' |');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## ACT: CORROBORATED BY TWO OR MORE TOOLS');
  L.push('');
  const act = d.findings.filter((x) => x.status === 'ACT');
  if (act.length === 0) {
    L.push('_None this run._');
  } else {
    L.push('| # | Sev | Corrob | Tools | Location | Finding | Fix | Status |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const f of act) {
      L.push('| **' + f.id + '** | ' + f.severity + ' | **x' + f.corroboration + '** | ' + f.tools.join(', ') +
        ' | `' + f.path + ':' + f.start_line + '` | ' + esc(f.message).slice(0, 160) + ' | _TBD_ | OPEN |');
    }
    L.push('');
    L.push('### ACT: full detail, every tool\'s own words');
    L.push('');
    for (const f of act) {
      L.push('#### ' + f.id + ' / ' + f.severity + ' / x' + f.corroboration + ': `' + f.path + ':' + f.start_line + '`');
      L.push('');
      L.push('**Category:** `' + f.category + '` / **Fingerprint:** `' + f.fingerprint.slice(0, 16) + '`');
      L.push('');
      for (const m of f.members) L.push('- **' + m.tool + '** (`' + m.rule_id + '`): ' + esc(m.message).slice(0, 300));
      L.push('');
      L.push('**Fix:** _TBD_ / **Status:** OPEN');
      L.push('');
    }
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('## REVIEW: SINGLE TOOL. A LEAD, NOT A FACT.');
  L.push('');
  const review = d.findings.filter((x) => x.status === 'REVIEW');
  if (review.length === 0) {
    L.push('_None this run._');
  } else {
    L.push('| # | Sev | Tool | Location | Finding |');
    L.push('|---|---|---|---|---|');
    for (const f of review) {
      L.push('| ' + f.id + ' | ' + f.severity + ' | ' + f.tools[0] + ' | `' + f.path + ':' + f.start_line + '` | ' +
        esc(f.message).slice(0, 130) + ' |');
    }
  }
  L.push('');
  return L.join('\n');
}

function main() {
  const d = JSON.parse(fs.readFileSync(path.join(OUT, 'ledger.json'), 'utf8'));
  const md = render(d);
  fs.writeFileSync(path.join(OUT, 'LEDGER.md'), md);
  console.log('  ledger written: ' + md.split('\n').length + ' lines, ' + d.clusters + ' numbered findings -> tools/sweep/out/LEDGER.md');
}

if (require.main === module) main();
module.exports = { render };
