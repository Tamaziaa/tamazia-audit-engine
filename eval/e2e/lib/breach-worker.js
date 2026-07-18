#!/usr/bin/env node
'use strict';
// eval/e2e/lib/breach-worker.js - runs ONE bundle's breach lane (propose -> verify -> adjudicate) in a
// CHILD PROCESS so a synchronous hang in a real breach module cannot hang the whole harness run.
//
// WHY A SUBPROCESS (Constitution Rule 9): breach/proposers/propose.js currently hangs synchronously on
// the real 92-record catalogue against real corpora (a catastrophic-backtracking-regex / ReDoS P0 in
// the presence/visible_text detection specs - CA_RPC_CH7 ~6s, IL_RPC_7 ~8s, NY_RPC_7_x hangs; owner:
// R3/W2a, reported to Rob). A synchronous hang cannot be bounded by an in-process Promise.race (the
// event loop is blocked, so the deadline callback never fires). The only reliable hard deadline for a
// CPU-bound synchronous dependency is a separate process with a wall-clock kill (execFileSync timeout
// -> SIGTERM), which is exactly what eval/e2e/lib/pipeline.js's runBreachLaneSubprocess wraps this in.
// Once the propose ReDoS is fixed, the in-process path (the default in tests, and `--breach-inline` on
// the CLI) is fast and this subprocess isolation is a belt-and-braces Rule-9 guard, never a floor.
//
// Contract: argv[2] is a path to a JSON job file { bundle, catalogueRecords, perRuleCoverage }. This
// worker runs the breach lane IN-PROCESS (breachInProcess:true, so it never re-spawns itself) with the
// harness's default DECLINE llmCall (no real LLM, ever), and writes a trimmed, serialisable result to
// stdout: { propose, verify, adjudicate, findings } where each stage is {ran,skipped,error,reason,source}.
// A non-zero exit or a stdout it cannot parse is treated by the parent as a breach-lane error for the firm.

const fs = require('fs');
const { runBreachLane } = require('./pipeline.js');

function trimStage(s) {
  return { ran: s.ran, skipped: s.skipped, error: s.error, reason: s.reason, source: s.source || null };
}

async function main(argv) {
  const jobFile = argv[2];
  if (!jobFile) {
    process.stderr.write('breach-worker.js: a job file path argument is required\n');
    return 2;
  }
  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  } catch (e) {
    process.stderr.write('breach-worker.js: cannot read job file: ' + e.message + '\n');
    return 2;
  }
  const coverage = { perRule: job.perRuleCoverage || { rules: [] } };
  const breach = await runBreachLane(job.bundle, coverage, {
    catalogueRecords: job.catalogueRecords || [],
    breachInProcess: true, // CRITICAL: the child runs in-process, so it never re-spawns a subprocess.
  });
  process.stdout.write(JSON.stringify({
    propose: trimStage(breach.propose),
    verify: trimStage(breach.verify),
    adjudicate: trimStage(breach.adjudicate),
    findings: breach.findings,
  }));
  return 0;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch((e) => {
    // FAIL-OPEN: any uncaught error in the worker is a real breach-lane failure for this firm; it is
    // written to stderr (the parent captures the non-zero exit as a breach-lane error), never silently
    // swallowed. The parent's runBreachLaneSubprocess records it on the firm's stage table.
    process.stderr.write('breach-worker.js: uncaught: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}

module.exports = { trimStage };
