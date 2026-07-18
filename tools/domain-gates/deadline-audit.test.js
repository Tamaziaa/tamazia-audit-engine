'use strict';
// deadline-audit.test.js - the Rule 9 external-deadline gate. Exercised as a node:test module (not only
// via --calibrate) so npm test proves it still catches the seeded fixture and clears wrapped calls.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('./deadline-audit.js');

const FIXTURE = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures', 'p3-gate-deadline-audit.js');

test('self-test is earned: catches undeadlined external awaits + spawn-to-http, clears wrapped calls', () => {
  const r = gate.selfTest();
  assert.equal(r.pass, true, r.detail);
});

test('the seeded fixture is caught (>=1 undeadlined external-call site)', () => {
  const src = fs.readFileSync(FIXTURE, 'utf8');
  const v = gate.scanContent('p3-gate-deadline-audit.js', src).violations;
  assert.ok(v.length >= 1, 'the seeded undeadlined await must be caught');
  assert.ok(v.some((x) => x.kind === 'undeadlined-await'), 'an undeadlined await is among them');
});

test('an undeadlined await of an injected external caller is flagged', () => {
  assert.equal(gate.scanContent('t.js', 'async function f(fetchFn, u){ return await fetchFn(u); }').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'async function g(o, r){ return await o.llmCall(r); }').violations.length, 1);
});

test('a call wrapped in a deadline wrapper is NOT flagged', () => {
  assert.equal(gate.scanContent('t.js', 'async function a(fetchFn, u){ return await withDeadline(() => fetchFn(u), 5000); }').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'async function a(fetchFn, u){ return await raceWithDeadline(Promise.resolve().then(() => fetchFn(u)), 9000); }').violations.length, 0);
});

test('a self-bounded call carrying its own deadline/signal arg is NOT flagged', () => {
  assert.equal(gate.scanContent('t.js', 'async function b(fetchFn, u){ return await fetchFn(u, { deadlineMs: 9000 }); }').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'async function b(fetchFn, u, signal){ return await fetchFn(u, { signal }); }').violations.length, 0);
});

test('non-external identifiers (page.goto, browser.newPage, regex .exec) are spared (near-zero FP)', () => {
  assert.equal(gate.scanContent('t.js', 'async function c(page, u){ await page.goto(u); await page.settle(1); }').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'async function c(b){ const p = await b.newPage(); return p; }').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'const m = /x/.exec(String(s)); const n = re.exec(t);').violations.length, 0);
});

test('a spawn shelling out to http/curl is flagged; a benign spawn is not', () => {
  assert.equal(gate.scanContent('t.js', 'const cp = require("child_process"); cp.spawnSync("curl", ["https://x.example"]);').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'const cp = require("child_process"); cp.spawnSync("python3", ["-c", "import yaml"]);').violations.length, 0);
});

test('a .catch/.then chain does not launder an undeadlined external await', () => {
  assert.equal(gate.scanContent('t.js', 'async function h(fetchFn, u){ return await fetchFn(u).catch(() => null); }').violations.length, 1);
});

test('the real evidence/browser/observe.js is deadline-clean (external work goes through raceWithDeadline)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'evidence', 'browser', 'observe.js'), 'utf8');
  assert.equal(gate.scanContent('evidence/browser/observe.js', src).violations.length, 0);
});

test('a malformed source is fail-closed (throws), never counted as zero violations', () => {
  assert.throws(() => gate.scanContent('bad.js', 'async function ( { ) not js'));
});
