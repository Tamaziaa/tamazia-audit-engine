'use strict';
// tools/taxonomy-onedoor/check.test.js - the vocabulary one-door gate flags a stray sector-path literal
// and an axis declaration, and does NOT flag the door or a non-path dotted literal.

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./check.js');

test('self-test earns its zero (catches the class, spares the door and non-path literals)', () => {
  const st = gate.selfTest();
  assert.ok(st.pass, st.detail);
});

test('flags a stray sector-path literal outside the taxonomy door', () => {
  const v = gate.scanContent('breach/rogue.js', "const s = 'healthcare.aesthetics.injectables';\n");
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, 'sector-path literal');
});

test('flags a JURISDICTION_AXES declaration outside the door', () => {
  const v = gate.scanContent('facts/rogue.js', "const JURISDICTION_AXES = { country: 'US' };\n");
  assert.ok(v.some((x) => /JURISDICTION_AXES/.test(x.kind)));
});

test('does NOT flag the allowed doors (taxonomy/index.js and facts/vocabulary.js)', () => {
  assert.equal(gate.scanContent('taxonomy/index.js', "const p = 'healthcare.aesthetics.injectables';\n").length, 0);
  assert.equal(gate.scanContent('facts/vocabulary.js', "const p = 'healthcare.aesthetics.injectables';\n").length, 0);
});

test('flags a rogue taxonomy/ sibling (only index.js is the door, not the whole dir)', () => {
  assert.ok(gate.scanContent('taxonomy/rogue.js', "const p = 'healthcare.aesthetics.injectables';\n").length >= 1);
});

test('flags the arrow-assignment form of a sectorPathMatches redefinition (not just the function form)', () => {
  assert.ok(gate.scanContent('breach/rogue.js', 'const sectorPathMatches = (a, b) => a === b;\n').some((x) => /sectorPathMatches/.test(x.kind)));
  // a consumer member-call is NOT a redefinition.
  assert.equal(gate.scanContent('breach/consumer.js', 'const r = taxonomy.sectorPathMatches(a, b);\n').length, 0);
});

test('does NOT flag a non-path dotted literal (a signal name)', () => {
  assert.equal(gate.scanContent('facts/capabilities.js', "signal: 'ecommerce.jsonld_product_offers',\n").length, 0);
});

test('the real engine tree (incl. the production taxonomy/ scan scope) has zero taxonomy second doors', () => {
  const res = gate.scanTree(['applicability', 'breach', 'catalogue', 'evidence', 'facts', 'llm', 'mint', 'payload', 'render-proof', 'taxonomy']);
  assert.equal(res.violations.length, 0, 'stray taxonomy vocabulary: ' + JSON.stringify(res.violations));
});
