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

// discoverWorkflowFiles(dir) -> { ok: true, files } when the directory exists and holds at least one
// YAML workflow, otherwise { ok: false, message }. Both failure branches are the SAME protected
// class: deleting every workflow (or the whole directory) makes the required checks VANISH from
// GitHub rather than fail (caution.md C-202), so an empty/missing set is broken configuration, never
// a clean zero. Kept pure and exported so the fail-closed contract is unit-testable.
function discoverWorkflowFiles(dir) {
  // A missing directory is checked explicitly (no catch): an absent .github/workflows is the vanished-
  // check failure, not "nothing to do". If the directory exists but is unreadable, readdirSync throws
  // and the tool aborts with a non-zero exit - still fail closed, never a false pass.
  if (!fs.existsSync(dir)) {
    return { ok: false, message: '.github/workflows is missing - deleting workflows makes required checks vanish from GitHub rather than fail. Exit 1 (broken configuration).' };
  }
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (files.length === 0) {
    return { ok: false, message: '0 workflow files under .github/workflows - the required-check set is empty, the vanished-check failure this gate exists to catch. Exit 1.' };
  }
  return { ok: true, files };
}

function main() {
  const discovered = discoverWorkflowFiles(WF_DIR);
  if (!discovered.ok) {
    console.error('collect-workflows: ' + discovered.message);
    return 1;
  }
  const files = discovered.files;

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
  // Fail closed on a parser that never ran: spawnSync sets r.error (and r.status === null) when
  // python3/PyYAML is absent, and r.status !== 0 would treat that ENOENT as a "rejection" - an
  // unearned pass. Only a real non-zero exit on the seeded broken YAML counts.
  if (r.error || r.status === null) {
    return { pass: false, detail: 'python3+PyYAML unavailable (' + (r.error ? r.error.code : 'no exit status') + ') - parser never ran, cannot earn a zero' };
  }
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
module.exports = { main, selfTest, discoverWorkflowFiles };
