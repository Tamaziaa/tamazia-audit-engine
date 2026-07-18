'use strict';
// p3-gate-module-state.js - SEEDED KNOWN-BAD for tools/no-module-state/check.js (caution.md C-153).
// The _WARN / _SWARN / _lastDomain singletons below are the exact disease: module-scope state mutated
// per audit from a function, so it leaks into the next build. The gate MUST catch each mutation; a run
// that reports zero here means the gate cannot see the class it exists to catch (Rule 4).
//
// This file is DATA (a calibration fixture), never wired into the mint. loadOnce is the clean control:
// a guarded write-once memoisation must NOT be flagged.

let _WARN = 0;         // a per-audit counter that is never reset between builds
const _SWARN = [];     // a mutable module-scope accumulator (the C-153 _SWARN singleton)
let _lastDomain = null; // reassigned per audit from a function

// BAD: increments and pushes onto module-scope state - warning counts are wrong for audit two onward.
function recordWarning(msg) {
  _WARN++;
  _SWARN.push(msg);
}

// BAD: an unguarded reassignment of module-scope state from a function.
function setDomain(domain) {
  _lastDomain = domain;
}

// CLEAN CONTROL: a guarded write-once memoisation of an immutable value - must NOT be flagged.
let _built = null;
function loadOnce() {
  if (_built) return _built;
  _built = { ready: true };
  return _built;
}

module.exports = { recordWarning, setDomain, loadOnce };
