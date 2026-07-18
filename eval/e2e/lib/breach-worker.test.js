'use strict';
// eval/e2e/lib/breach-worker.test.js
//   node --test eval/e2e/lib/breach-worker.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { trimStage } = require('./breach-worker');

const WORKER = path.join(__dirname, 'breach-worker.js');

test('trimStage: keeps only the serialisable stage-outcome fields', () => {
  const out = trimStage({ ran: true, skipped: false, error: null, reason: 'r', output: { huge: 'dropped' }, source: 's' });
  assert.deepStrictEqual(out, { ran: true, skipped: false, error: null, reason: 'r', source: 's' });
  assert.strictEqual('output' in out, false, 'the (possibly large, possibly circular) output must not be serialised back');
});

function runWorker(job, timeoutMs) {
  const jobFile = path.join(os.tmpdir(), 'e2e-worker-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    const stdout = execFileSync(process.execPath, [WORKER, jobFile], { timeout: timeoutMs || 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, parsed: JSON.parse(stdout.toString('utf8')) };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    try { fs.unlinkSync(jobFile); } catch (_e) { /* best-effort */ }
  }
}

test('breach-worker: runs the real breach lane on an EMPTY catalogue and emits parseable {propose,verify,adjudicate,findings}', () => {
  const bundle = { domain: 'worker.test', corpus: { pages: [{ url: 'https://worker.test/', text: 'hello world' }] }, registers: {} };
  const r = runWorker({ bundle, catalogueRecords: [], perRuleCoverage: { rules: [] } });
  assert.strictEqual(r.ok, true, 'the worker should exit 0 and print JSON');
  assert.strictEqual(r.parsed.propose.ran, true);
  assert.strictEqual(r.parsed.verify.ran, true);
  assert.strictEqual(r.parsed.adjudicate.ran, true);
  assert.deepStrictEqual(r.parsed.findings, []);
});

test('breach-worker: a missing job-file argument exits non-zero (a breach-lane error for the parent)', () => {
  let status = 0;
  try {
    execFileSync(process.execPath, [WORKER], { stdio: 'pipe' });
  } catch (e) {
    status = e.status;
  }
  assert.strictEqual(status, 2);
});

test('breach-worker: an unreadable job file exits non-zero, never a silent clean result', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json');
  let status = 0;
  try {
    execFileSync(process.execPath, [WORKER, missing], { stdio: 'pipe' });
  } catch (e) {
    status = e.status;
  }
  assert.strictEqual(status, 2);
});
