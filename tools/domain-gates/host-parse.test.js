'use strict';
// host-parse.test.js - the host-substring gate (GAPS host-substring / caution.md C-009).
// Run as node:test so npm test proves the gate still catches the seeded p3-crawl-host-substring fixture
// and clears legitimate parsed-host / scheme / prose comparisons.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('./host-parse.js');

const HOST_FIXTURE = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures', 'p3-crawl-host-substring.js');

test('self-test is earned: catches host-substring, clears scheme/dot/parsed comparisons (acorn)', () => {
  const r = gate.selfTest();
  assert.equal(r.pass, true, r.detail);
});

test('scanContent catches every seeded host-substring in p3-crawl-host-substring.js', () => {
  const src = fs.readFileSync(HOST_FIXTURE, 'utf8');
  const v = gate.scanContent('p3-crawl-host-substring.js', src).violations;
  assert.ok(v.length >= 3, 'the .includes(domain), .includes("linkedin.com") and .endsWith(registrable) cases are all caught');
  assert.ok(v.every((x) => x.kind === 'host-substring'));
});

test('a host compared by substring is flagged; a parsed-host comparison is not', () => {
  assert.equal(gate.scanContent('t.js', 'const a = url.includes(domain);').violations.length, 1);
  assert.equal(gate.scanContent('t.js', "const b = href.includes('linkedin.com');").violations.length, 1);
  assert.equal(gate.scanContent('t.js', 'const c = new URL(u).hostname === domain;').violations.length, 0, 'the correct parsed comparison is spared');
});

test('a scheme, dot or prose search is not a host-substring (spared)', () => {
  assert.equal(gate.scanContent('t.js', "const f = u.indexOf('://');").violations.length, 0);
  assert.equal(gate.scanContent('t.js', "const g = h.includes('.');").violations.length, 0);
  assert.equal(gate.scanContent('t.js', "const k = text.includes('privacy');").violations.length, 0);
});

test('the safe-fetch door itself is not scanned by the engine tree (it IS the allowed host producer)', () => {
  // The gate excludes tools/ from its scan dirs; a direct scan of a legitimate parsed comparison is clean.
  const parsed = 'const same = new URL(u).hostname === new URL(v).hostname;';
  assert.equal(gate.scanContent('facts/x.js', parsed).violations.length, 0);
});
