'use strict';
// tools/facts-abstain/check.test.js - node:test suite for the unreachable-bundle abstention gate
// (caution.md C-032/C-038). Run: node --test tools/facts-abstain/check.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./check.js');
const { CALIBRATE_DIR } = require('../lib/gate-cli');

test('looksUnreachable: true when explicitly flagged, or when a fetched page carries zero visible text; false for an ordinary reachable bundle or an empty page list', () => {
  assert.equal(gate.looksUnreachable({ unreachable: true, corpus: { pages: [{ text: 'anything' }] } }), true);
  assert.equal(gate.looksUnreachable({ corpus: { pages: [{ text: '' }] } }), true);
  assert.equal(gate.looksUnreachable({ corpus: { pages: [{ text: 'real content here' }] } }), false);
  assert.equal(gate.looksUnreachable({ corpus: { pages: [] } }), false);
  assert.equal(gate.looksUnreachable(null), false);
});

test('bundlesIn: accepts the calibration fixture\'s {bundles:[...]} wrapper and a single bare EvidenceBundle, and skips anything else', () => {
  assert.deepEqual(gate.bundlesIn({ bundles: [{ corpus: {} }, { corpus: {} }] }).length, 2);
  assert.deepEqual(gate.bundlesIn({ domain: 'x', corpus: {} }).length, 1);
  assert.deepEqual(gate.bundlesIn({ id: 'not a bundle', citation: {} }), []);
  assert.deepEqual(gate.bundlesIn(null), []);
});

test('checkBundle: facts/identity.js\'s domain-stem fallback emitting on an unreachable bundle is caught as facts-abstain/identity-non-abstain', () => {
  const bundle = {
    domain: 'unreachable-check.example',
    unreachable: true,
    corpus: { pages: [{ url: 'https://unreachable-check.example/', title: 'Attention Required!', text: 'Checking your browser before accessing.', jsonLd: [] }], footerText: '' },
    registers: {},
  };
  const findings = gate.checkBundle(bundle, 'test');
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/identity-non-abstain'));
});

test('checkBundle: never throws on a malformed or empty bundle', () => {
  assert.doesNotThrow(() => gate.checkBundle({}, 'test'));
  assert.doesNotThrow(() => gate.checkBundle(null, 'test'));
});

test('selfTest passes', () => {
  const st = gate.selfTest();
  assert.equal(st.pass, true, st.detail);
});

test('scan against eval/calibration-known-bad/fixtures catches the seeded p1-reference-fixtures-unreachable-bundle.json violation (the earn-your-zero contract)', () => {
  const res = gate.scan([CALIBRATE_DIR]);
  const hit = res.violations.find((v) => v.file.includes('p1-reference-fixtures-unreachable-bundle.json'));
  assert.ok(hit, 'expected a finding on the seeded fixture; got: ' + JSON.stringify(res.violations));
  assert.ok(res.unreachableSeen >= 2, 'expected both seeded bundles (bot-wall + SPA-shell) to be recognised as unreachable');
});

test('scan: an ordinary reachable bundle file produces zero findings (this gate never asserts against content it was never asked to abstain on)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-abstain-test-'));
  const file = path.join(dir, 'reachable.json');
  fs.writeFileSync(file, JSON.stringify({
    domain: 'reachable-check.example',
    corpus: { pages: [{ url: 'https://reachable-check.example/', title: 'Reachable Check', text: 'A perfectly ordinary reachable page with real content about our services.', jsonLd: [] }], footerText: '' },
    registers: {},
  }));
  try {
    const res = gate.scan([file]);
    assert.equal(res.unreachableSeen, 0);
    assert.deepEqual(res.violations, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
