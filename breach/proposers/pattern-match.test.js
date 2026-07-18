'use strict';
// breach/proposers/pattern-match.test.js - node:test for the anchoring + matching primitives.
// Run: node --test breach/proposers/pattern-match.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const pm = require('./pattern-match.js');

test('anchorToken word-boundary-wraps and escapes a token', () => {
  assert.equal(pm.anchorToken('sra'), '\\bsra\\b');
  assert.equal(pm.anchorToken('under-18'), '\\bunder-18\\b');
  assert.equal(pm.anchorToken('a.b'), '\\ba\\.b\\b');
});

test('buildAnchoredRegex builds a \\b-bounded, whitespace-flexible phrase', () => {
  assert.equal(pm.buildAnchoredRegex('authorised widget provider'), '\\bauthorised\\W+widget\\W+provider\\b');
  const re = new RegExp(pm.buildAnchoredRegex('authorised widget provider'), 'i');
  assert.ok(re.test('an authorised   widget provider;'));
  assert.ok(!re.test('authorisedwidgetprovider'));
  assert.equal(pm.buildAnchoredRegex('   '), null);
});

test("compileRegex compiles an anchored-regex and a token-set 'any', but returns null for 'all'", () => {
  assert.ok(pm.compileRegex({ kind: 'anchored-regex', value: '\\btonic\\b' }) instanceof RegExp);
  assert.ok(pm.compileRegex({ kind: 'token-set', value: { tokens: ['complaint', 'ombudsman'], mode: 'any' } }) instanceof RegExp);
  assert.equal(pm.compileRegex({ kind: 'token-set', value: { tokens: ['a', 'b'], mode: 'all' } }), null, "'all' has no single-regex form");
  assert.equal(pm.compileRegex({ kind: 'url-path', value: '/x' }), null);
});

test('tokenContains is a linear single-token check', () => {
  assert.equal(pm.tokenContains('we hold a certification here', 'certification'), true);
  assert.equal(pm.tokenContains('nothing relevant', 'certification'), false);
  assert.equal(pm.tokenContains('the specialist team', 'special'), false, 'anchored: never a substring match');
});

test("matchesText: 'all' requires every token, 'any' requires one, both LINEAR (no co-occurrence mega-regex)", () => {
  const all = { kind: 'token-set', value: { tokens: ['certification', 'specialist'], mode: 'all' } };
  assert.equal(pm.matchesText(all, 'a certification as a specialist'), true);
  assert.equal(pm.matchesText(all, 'a certification only'), false);
  const any = { kind: 'token-set', value: { tokens: ['complaint', 'ombudsman'], mode: 'any' } };
  assert.equal(pm.matchesText(any, 'contact the ombudsman'), true);
  assert.equal(pm.matchesText(any, 'nothing relevant'), false);
  assert.equal(pm.matchesText({ kind: 'anchored-regex', value: '\\bno\\W+win\\W+no\\W+fee\\b' }, 'we offer no win no fee'), true);
  assert.equal(pm.matchesText({ kind: 'url-path', value: '/x' }, 'anything'), false);
  assert.equal(pm.matchesText(null, 'x'), false);
});

test('LINEARITY: matching a huge corpus with an absent "all" token-set is fast, never a backtracking hang', () => {
  const all = { kind: 'token-set', value: { tokens: ['certification', 'specialist', 'retained'], mode: 'all' } };
  const big = 'the firm advises clients on many complex matters every single day. '.repeat(20000); // ~1.3M chars
  const t0 = Date.now();
  assert.equal(pm.matchesText(all, big), false);
  assert.ok(Date.now() - t0 < 800, 'linear, not catastrophic backtracking (took ' + (Date.now() - t0) + 'ms)');
});
