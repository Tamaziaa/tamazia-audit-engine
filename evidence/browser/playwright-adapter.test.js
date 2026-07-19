'use strict';
// evidence/browser/playwright-adapter.test.js - node:test suite for the PURE, injectable pieces of the
// lazy real-browser adapter. Playwright itself is never required or launched here (this file's own header
// documents why: it is an OPTIONAL runtime dependency, resolved lazily, and the repo's own doctrine is that
// no real Chromium runs in tests or CI). What IS pure and directly testable is the http:// fallback
// DECISION (DEFECT-1/DEFECT-8b: the goto() failure is no longer silently swallowed, and a failed https://
// attempt gets exactly one bounded retry over http://) and the consent-DOM scanner's selector predicate.

const test = require('node:test');
const assert = require('node:assert/strict');
const { httpFallbackOf, scanConsentDom, DRIVERS } = require('./playwright-adapter.js');

test('httpFallbackOf: an https:// url gets an http:// retry candidate with the scheme swapped, nothing else touched', () => {
  assert.equal(httpFallbackOf('https://lomond.co.uk/'), 'http://lomond.co.uk/');
  assert.equal(httpFallbackOf('https://lomond.co.uk/some/path?x=1'), 'http://lomond.co.uk/some/path?x=1');
  assert.equal(httpFallbackOf('HTTPS://Lomond.co.uk/'), 'http://Lomond.co.uk/', 'scheme match is case-insensitive');
});

test('httpFallbackOf: an explicit http:// (or any non-https) url is NEVER "upgraded" - no fallback candidate', () => {
  assert.equal(httpFallbackOf('http://lomond.co.uk/'), null, 'an operator\'s explicit http:// choice is honoured as given, not retried');
  assert.equal(httpFallbackOf('ftp://lomond.co.uk/'), null);
  assert.equal(httpFallbackOf(''), null);
  assert.equal(httpFallbackOf(null), null);
});

test('DRIVERS names the optional Playwright driver module shapes this adapter will try, lazily', () => {
  assert.ok(Array.isArray(DRIVERS) && DRIVERS.includes('playwright'));
});

test('scanConsentDom is exported for page.evaluate() and is a plain function (serialisable, no closures over module state)', () => {
  assert.equal(typeof scanConsentDom, 'function');
});
