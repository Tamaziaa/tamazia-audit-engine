'use strict';
// eval/reference-set/run-facts.test.js - readability is observed text, and the harness fails closed.
//   node --test eval/reference-set/run-facts.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { hasReadableCorpus, loadRefSetAndFixtures, selectFirms } = require('./run-facts');

test('hasReadableCorpus: blank page objects are NOT readable (page count is not readability)', () => {
  assert.strictEqual(hasReadableCorpus({ corpus: { pages: [{ url: 'x', text: '' }, { text: '   ' }] } }), false);
});

test('hasReadableCorpus: footer-only evidence with no pages IS readable', () => {
  assert.strictEqual(hasReadableCorpus({ corpus: { pages: [], footerText: 'Registered office: London.' } }), true);
});

test('hasReadableCorpus: a page with real text is readable', () => {
  assert.strictEqual(hasReadableCorpus({ corpus: { pages: [{ url: 'x', text: 'Hello world' }] } }), true);
});

test('hasReadableCorpus: no corpus at all is not readable', () => {
  assert.strictEqual(hasReadableCorpus({}), false);
});

test('selectFirms: an empty firms array fails closed (exit 2)', () => {
  const r = selectFirms({ firms: [] }, { domain: null });
  assert.strictEqual(r.exitCode, 2);
});

test('loadRefSetAndFixtures: an existing but empty fixtures directory fails closed (exit 2)', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reffix-'));
  const r = loadRefSetAndFixtures({ set: path.join(__dirname, 'reference-set.json'), fixtures: emptyDir });
  assert.strictEqual(r.exitCode, 2);
});

test('loadRefSetAndFixtures: a missing fixtures directory fails closed (exit 2)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reffix-'));
  const r = loadRefSetAndFixtures({ set: path.join(__dirname, 'reference-set.json'), fixtures: path.join(base, 'nope') });
  assert.strictEqual(r.exitCode, 2);
});
