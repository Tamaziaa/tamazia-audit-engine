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

test('looksUnreachable (CR-40): a page with blank text but a NON-EMPTY captured footerText is NOT unreachable', () => {
  assert.equal(gate.looksUnreachable({ corpus: { pages: [{ text: '' }], footerText: 'Footer Co Ltd, company number 12345678' } }), false);
  // a blank footerText alongside blank page text is still unreachable.
  assert.equal(gate.looksUnreachable({ corpus: { pages: [{ text: '' }], footerText: '' } }), true);
  assert.equal(gate.looksUnreachable({ corpus: { pages: [{ text: '' }], footerText: '   ' } }), true);
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

// ---------------------------------------------------------------------------------
// CR-42: checkBundle accepts an injectable {resolveIdentity, resolveJurisdiction, resolveSector}
// triple, defaulting to the REAL facts modules (gate.REAL_RESOLVERS) when omitted. This is what
// lets selfTest prove the GATE'S OWN logic against deliberately faulty stubs, independent of
// whatever facts/identity.js's real production behaviour currently is.
// ---------------------------------------------------------------------------------

const UNREACHABLE_BUNDLE = {
  domain: 'injected-test.example',
  unreachable: true,
  corpus: { pages: [{ url: 'https://injected-test.example/', title: 'x', text: '', jsonLd: [] }], footerText: '' },
  registers: {},
};

test('checkBundle: with injected resolvers that emit non-abstain facts, flags all three non-abstain findings', () => {
  const faulty = {
    resolveIdentity: () => ({ display_name: { value: 'Injected Co', confidence: 'weak' } }),
    resolveJurisdiction: () => ({ abstained: false, bound: [{ jurisdiction: 'UK' }] }),
    resolveSector: () => ({ value: 'law-firms', confidence: 'weak' }),
  };
  const findings = gate.checkBundle(UNREACHABLE_BUNDLE, 'test', faulty);
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/identity-non-abstain'));
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/jurisdiction-non-abstain'));
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/sector-non-abstain'));
});

test('checkBundle: with injected resolvers that throw, flags all three "-threw" findings, never crashing', () => {
  const throwing = {
    resolveIdentity: () => { throw new Error('injected failure'); },
    resolveJurisdiction: () => { throw new Error('injected failure'); },
    resolveSector: () => { throw new Error('injected failure'); },
  };
  const findings = gate.checkBundle(UNREACHABLE_BUNDLE, 'test', throwing);
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/identity-threw'));
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/jurisdiction-threw'));
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/sector-threw'));
});

test('checkBundle: with injected resolvers that correctly abstain on everything, produces zero findings', () => {
  const abstaining = {
    resolveIdentity: () => ({ display_name: { value: null, confidence: 'abstain' } }),
    resolveJurisdiction: () => ({ abstained: true, bound: [] }),
    resolveSector: () => ({ value: null, confidence: 'abstain' }),
  };
  assert.deepEqual(gate.checkBundle(UNREACHABLE_BUNDLE, 'test', abstaining), []);
});

test('checkBundle: omitting `resolvers` defaults to gate.REAL_RESOLVERS (the production facts modules)', () => {
  const findings = gate.checkBundle(UNREACHABLE_BUNDLE, 'test');
  assert.ok(findings.some((f) => f.rule === 'facts-abstain/identity-non-abstain'), 'expected the real facts/identity.js domain-stem fallback to still fire on this unreachable bundle');
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

// ---------------------------------------------------------------------------------
// CR-41: fail closed - a scan that never actually looked at anything (no args, a missing path, an
// unreadable/invalid-JSON file DIRECTLY named, or a directly-named file that is not a recognised
// bundle shape) must produce a scan-error violation, never a silent "0 violation(s)" clean pass. A
// directory scan discovering an unrelated fixture (belonging to another gate) is the one case that
// still skips silently.
// ---------------------------------------------------------------------------------

test('scan (CR-41): zero paths supplied fails closed with a facts-abstain/scan-error violation', () => {
  const res = gate.scan([]);
  assert.ok(res.violations.some((v) => v.rule === 'facts-abstain/scan-error'));
});

test('scan (CR-41): a path that does not exist fails closed with a facts-abstain/scan-error violation', () => {
  const fsMod = require('node:fs');
  const osMod = require('node:os');
  const pathMod = require('node:path');
  const missing = pathMod.join(osMod.tmpdir(), 'facts-abstain-test-does-not-exist-xyz');
  assert.ok(!fsMod.existsSync(missing));
  const res = gate.scan([missing]);
  assert.ok(res.violations.some((v) => v.rule === 'facts-abstain/scan-error' && v.message.includes('does not exist')));
});

test('scan (CR-41): a directly-named unreadable/invalid-JSON file fails closed, unlike the same file discovered inside a mixed directory scan', () => {
  const fsMod = require('node:fs');
  const osMod = require('node:os');
  const pathMod = require('node:path');
  const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'facts-abstain-test-'));
  const file = pathMod.join(dir, 'broken.json');
  fsMod.writeFileSync(file, '{ not valid json');
  try {
    const directRes = gate.scan([file]);
    assert.ok(directRes.violations.some((v) => v.rule === 'facts-abstain/scan-error'), 'a directly-named unreadable file must fail closed');

    const dirRes = gate.scan([dir]);
    // The malformed file itself stays a legitimate per-file skip inside a mixed directory (no
    // parse-error violation for it) - but since NOTHING else was scanned either, the CR round-5
    // terminal check still refuses the empty result as a whole (0 recognised bundles).
    assert.ok(!dirRes.violations.some((v) => v.message.includes('failed to read/parse')), 'the SAME file discovered while walking a mixed directory is a legitimate skip, not this gate\'s problem');
    assert.ok(dirRes.violations.some((v) => v.message.includes('0 recognised bundles')), 'an all-skipped directory must still fail the terminal no-bundles check');
  } finally {
    fsMod.rmSync(dir, { recursive: true, force: true });
  }
});

test('scan (CR-41): a directly-named file that parses but is not a recognised bundle shape fails closed', () => {
  const fsMod = require('node:fs');
  const osMod = require('node:os');
  const pathMod = require('node:path');
  const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'facts-abstain-test-'));
  const file = pathMod.join(dir, 'not-a-bundle.json');
  fsMod.writeFileSync(file, JSON.stringify({ some: 'unrelated shape belonging to another gate' }));
  try {
    const res = gate.scan([file]);
    assert.ok(res.violations.some((v) => v.rule === 'facts-abstain/scan-error' && v.message.includes('not a recognised')));
  } finally {
    fsMod.rmSync(dir, { recursive: true, force: true });
  }
});

test('scan (CR-41/SCAN path-traversal): a ".." traversal path fails closed with a facts-abstain/scan-error violation rather than resolving outside the repo', () => {
  const res = gate.scan(['../../../etc/passwd']);
  assert.ok(res.violations.some((v) => v.rule === 'facts-abstain/scan-error'));
});

test('scan: supplied paths yielding ZERO recognised bundles fail closed, never a clean pass (CR round-5)', () => {
  const fsMod = require('node:fs');
  const osMod = require('node:os');
  const pathMod = require('node:path');
  const emptyDir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'fa-empty-'));
  try {
    const res = gate.scan([emptyDir]);
    assert.equal(res.bundlesSeen, 0);
    assert.ok(res.violations.some((v) => v.rule === 'facts-abstain/scan-error' && v.message.includes('0 recognised bundles')));
  } finally {
    fsMod.rmSync(emptyDir, { recursive: true, force: true });
  }
});
