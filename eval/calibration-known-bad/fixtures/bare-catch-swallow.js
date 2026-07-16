'use strict';
// CALIBRATION FIXTURE (known-bad, deliberately committed): silent-swallow class.
// The bare catches below discard the error entirely - the "165 silent swallows" disease.
// The silent-swallow AST gate MUST report at least one finding in this file when run
// with --calibrate, or the gate has not earned its zero.
// This file is never imported by engine code.

const fs = require('fs');

function readCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (e) {} // BAD: error swallowed, caller cannot tell "no cache" from "corrupt cache"
  return null;
}

function pingRegistry(url) {
  try {
    // pretend network call
    return { url, ok: true };
  } catch {} // BAD: optional-catch-binding swallow, same disease
  return { url, ok: false };
}

function persistState(statePath, state) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state));
    return true;
  } catch (err) {
    // BAD: caught, logged nowhere, rethrown nowhere, and success is reported anyway
    return true;
  }
}

module.exports = { readCache, pingRegistry, persistState };
