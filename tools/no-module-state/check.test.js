'use strict';
// check.test.js - the C-153 no-module-state gate. Exercised as a node:test module (not only via
// --calibrate) so npm test proves it still catches the seeded _WARN/_SWARN fixture and clears the
// benign singletons (require caches, guarded memoisation, module-init IIFE).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('./check.js');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'eval', 'calibration-known-bad', 'fixtures', 'p3-gate-module-state.js');

test('self-test is earned: catches accumulators/reassignments, clears the benign singletons', () => {
  const r = gate.selfTest();
  assert.equal(r.pass, true, r.detail);
});

test('the seeded _WARN/_SWARN/_lastDomain disease is caught (3 mutations), guarded cache is not', () => {
  const v = gate.scanContent('p3-gate-module-state.js', fs.readFileSync(FIXTURE, 'utf8')).violations;
  const names = v.map((x) => x.name).sort();
  assert.deepEqual(names, ['_SWARN', '_WARN', '_lastDomain'], 'exactly the three leaking bindings, not the guarded _built cache');
});

test('a module-scope counter incremented from a function is flagged', () => {
  assert.equal(gate.scanContent('t.js', 'let n = 0; function f(){ n++; }').violations.length, 1);
});

test('a mutating method on a module-scope collection is flagged', () => {
  assert.equal(gate.scanContent('t.js', 'const s = []; function g(x){ s.push(x); }').violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'const m = {}; function g(k, v){ m[k] = v; }').violations.length, 1, 'property write on a module object literal');
});

test('a guarded write-once memoisation is NOT flagged (the loadVocabulary shape)', () => {
  const src = 'let cache = null; function load(){ if (cache) return cache; cache = require("x"); return cache; }';
  assert.equal(gate.scanContent('t.js', src).violations.length, 0);
});

test('a module-load-time IIFE write is NOT flagged (the linkVocabulary shape)', () => {
  const src = 'let linked = false; let failure = null; (function link(){ failure = "x"; linked = true; })();';
  assert.equal(gate.scanContent('t.js', src).violations.length, 0);
});

test('a local counter that shadows nothing at module scope is NOT flagged', () => {
  assert.equal(gate.scanContent('t.js', 'function loop(a){ let n = 0; for (const x of a) n += 1; return n; }').violations.length, 0);
});

test('a frozen const and a plain require const are NOT tracked as mutable bindings', () => {
  assert.equal(gate.scanContent('t.js', 'const F = Object.freeze({a:1}); function r(){ return F.a; }').violations.length, 0);
  assert.equal(gate.scanContent('t.js', 'const dep = require("x"); function u(){ return dep.y(); }').violations.length, 0);
});

test('the real facts/ and evidence/ module-scope caches are clean (guarded/IIFE/require)', () => {
  for (const rel of ['facts/sector.js', 'facts/capabilities.js', 'evidence/registers/lib/name-match.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(gate.scanContent(rel, src).violations.length, 0, rel + ' must be module-state clean');
  }
});

test('a malformed source is fail-closed (throws), never counted as zero violations', () => {
  assert.throws(() => gate.scanContent('bad.js', 'let ( { ) not js'));
});
