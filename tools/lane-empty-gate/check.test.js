'use strict';
// tools/lane-empty-gate/check.test.js - the lane-empty gate flags a catch that returns an empty array and
// spares a catch that returns a LaneError and a bare return-[] outside a catch.

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./check.js');

test('self-test earns its zero (catches catch-return-[], spares LaneError returns and non-catch return-[])', () => {
  const st = gate.selfTest();
  assert.ok(st.pass, st.detail);
});

test('flags a catch that returns an empty array literal', () => {
  const v = gate.scanContent('evidence/rogue.js', 'function f(){ try { return g(); } catch (e) { record(e); return []; } }');
  assert.equal(v.violations.length, 1);
});

test('flags a catch that returns new Array()', () => {
  const v = gate.scanContent('evidence/rogue.js', 'function f(){ try { g(); } catch (e) { report(e); return new Array(); } }');
  assert.equal(v.violations.length, 1);
});

test('does NOT flag a catch that returns a typed LaneError value', () => {
  const v = gate.scanContent('evidence/ok.js', 'function f(){ try { return g(); } catch (e) { return laneError("boom"); } }');
  assert.equal(v.violations.length, 0);
});

test('does NOT flag a bare return-[] outside a catch (a legitimate empty-collection return)', () => {
  const v = gate.scanContent('evidence/ok.js', 'function f(){ if (!m) return []; return g(); }');
  assert.equal(v.violations.length, 0);
});

test('does NOT flag new Array(n) sized allocation', () => {
  const v = gate.scanContent('evidence/ok.js', 'function f(){ try { g(); } catch (e) { report(e); return new Array(5); } }');
  assert.equal(v.violations.length, 0);
});

test('does NOT attribute a callback return-[] declared inside the catch to the catch', () => {
  const v = gate.scanContent('evidence/ok.js', 'function f(){ try { g(); } catch (e) { record(e); arr.forEach(function(){ return []; }); } }');
  assert.equal(v.violations.length, 0);
});

test('counts a nested catch return-[] exactly once (not once per enclosing catch)', () => {
  const v = gate.scanContent('evidence/rogue.js', 'function f(){ try { g(); } catch (e) { try { h(); } catch (e2) { record(e2); return []; } } }');
  assert.equal(v.violations.length, 1);
});

test('the real evidence lane tree has zero empty-array error-path returns', () => {
  const res = gate.scanTree(['evidence']);
  assert.equal(res.violations.length, 0, 'lane empty returns: ' + JSON.stringify(res.violations));
});
