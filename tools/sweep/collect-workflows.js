#!/usr/bin/env node
'use strict';
// tools/sweep/collect-workflows.js - parse every .github/workflows/*.yml and fail on YAML errors.
//
// Why this lane exists (caution.md C-202, PR #3): an unquoted ": " inside a step name silently
// broke ci.yml. GitHub does not fail a push for an unparsable workflow - the workflow's checks
// simply VANISH from the check-run list, and a reviewer scanning "all present checks are green"
// reads a gutted run as a full pass. A broken workflow must therefore be a LOCAL P0 finding.
//
// Parser: python3 + PyYAML (present on macOS dev machines and ubuntu-latest runners). If python3
// or PyYAML is unavailable this lane exits 2 (broken tool) rather than reporting an unearned zero.
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');

function main() {
  let files = [];
  try {
    files = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch (e) {
    // FAIL-OPEN: an absent .github/workflows directory means there is genuinely nothing to parse, so a clean
    // zero is correct; the parser gate below still refuses to report an unearned zero when a parser is missing.
    console.log('collect-workflows: no .github/workflows directory (' + e.code + ') - nothing to check.');
    return 0;
  }
  if (files.length === 0) {
    console.log('collect-workflows: 0 workflow files - nothing to check.');
    return 0;
  }

  try {
    execFileSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
  } catch (_e) {
    // FAIL-OPEN is not acceptable for a parser gate: no parser means no earned zero.
    console.error('collect-workflows: python3+PyYAML unavailable - cannot earn a zero. Exit 2 (broken tool).');
    return 2;
  }

  let bad = 0;
  for (const f of files) {
    const p = path.join(WF_DIR, f);
    const r = spawnSync('python3', ['-c', 'import sys,yaml; yaml.safe_load(open(sys.argv[1]))', p], { encoding: 'utf8' });
    if (r.status === 0) {
      console.log('  OK ' + f);
    } else {
      bad += 1;
      const msg = (r.stderr || '').trim().split('\n').slice(-3).join(' | ');
      console.error('  BROKEN ' + f + ': ' + msg);
    }
  }
  if (bad > 0) {
    console.error('collect-workflows: ' + bad + ' workflow file(s) do not parse. A broken workflow makes its checks VANISH from GitHub, not fail - this is a P0 finding.');
    return 1;
  }
  console.log('collect-workflows: all ' + files.length + ' workflow files parse.');
  return 0;
}

// selfTest: the gate must catch a known-bad workflow snippet (earn the zero).
function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfparse-'));
  const badFile = path.join(tmp, 'bad.yml');
  fs.writeFileSync(badFile, 'name: broken: because: unquoted\non: push\n');
  const r = spawnSync('python3', ['-c', 'import sys,yaml; yaml.safe_load(open(sys.argv[1]))', badFile], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { pass: r.status !== 0, detail: r.status !== 0 ? 'seeded broken YAML correctly rejected' : 'seeded broken YAML was ACCEPTED - parser cannot see the class' };
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    const st = selfTest();
    console.log('collect-workflows self-test: ' + (st.pass ? 'PASS' : 'FAIL') + ' (' + st.detail + ')');
    process.exit(st.pass ? 0 : 2);
  }
  process.exit(main());
}
module.exports = { main, selfTest };
