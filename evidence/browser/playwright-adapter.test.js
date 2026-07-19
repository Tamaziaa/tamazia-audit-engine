'use strict';
// evidence/browser/playwright-adapter.test.js - node:test suite for the PURE, injectable pieces of the
// lazy real-browser adapter. Playwright itself is never required or launched here (this file's own header
// documents why: it is an OPTIONAL runtime dependency, resolved lazily, and the repo's own doctrine is that
// no real Chromium runs in tests or CI). What IS pure and directly testable is the http:// fallback
// DECISION (DEFECT-1/DEFECT-8b: the goto() failure is no longer silently swallowed, and a failed https://
// attempt gets exactly one bounded retry over http://) and the consent-DOM scanner's selector predicate.

const test = require('node:test');
const assert = require('node:assert/strict');
const { httpFallbackOf, scanConsentDom, DRIVERS, gotoUrl } = require('./playwright-adapter.js');

// fakeGotoPage(behaviours) -> a minimal page exposing only goto(url), which pops one scripted behaviour per
// call ('ok' resolves, an Error rejects). gotoUrl only ever calls page.goto(url), so this fake is sufficient
// to drive its full orchestration with no real browser (CodeRabbit PR #25 comment 3610860881).
function fakeGotoPage(behaviours) {
  const calls = [];
  const queue = behaviours.slice();
  return {
    calls,
    async goto(url) {
      calls.push(url);
      const next = queue.shift();
      if (next instanceof Error) throw next;
    },
  };
}

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

// ── gotoUrl orchestration (DEFECT-1/DEFECT-8b): drives the full https->http fallback over a fake page ────

test('gotoUrl: the https:// attempt succeeds - resolves after exactly one goto() call, no fallback attempted', async () => {
  const page = fakeGotoPage(['ok']);
  await gotoUrl(page, 'https://lomond.co.uk/');
  assert.deepEqual(page.calls, ['https://lomond.co.uk/']);
});

test('gotoUrl: the https:// attempt REJECTS and the http:// fallback SUCCEEDS - resolves without throwing, goto() called exactly twice (CodeRabbit PR #25 comment 3610860881)', async () => {
  const page = fakeGotoPage([new Error('Protocol error (Page.navigate): Cannot navigate to invalid URL'), 'ok']);
  await assert.doesNotReject(() => gotoUrl(page, 'https://lomond.co.uk/'));
  assert.deepEqual(page.calls, ['https://lomond.co.uk/', 'http://lomond.co.uk/'], 'first the original https url, then exactly the http fallback');
});

test('gotoUrl: BOTH attempts reject - throws ONE combined, informative error naming both failures, never swallowed', async () => {
  const page = fakeGotoPage([new Error('https failure'), new Error('http failure')]);
  await assert.rejects(() => gotoUrl(page, 'https://lomond.co.uk/'), (err) => {
    assert.match(err.message, /navigation failed on both https and http/);
    assert.match(err.message, /https failure/);
    assert.match(err.message, /http failure/);
    return true;
  });
  assert.deepEqual(page.calls, ['https://lomond.co.uk/', 'http://lomond.co.uk/']);
});

test('gotoUrl: an explicit http:// input that rejects gets NO fallback attempt - propagates the original error as-is (one goto() call)', async () => {
  const page = fakeGotoPage([new Error('net::ERR_CONNECTION_REFUSED')]);
  await assert.rejects(() => gotoUrl(page, 'http://lomond.co.uk/'), /ERR_CONNECTION_REFUSED/);
  assert.deepEqual(page.calls, ['http://lomond.co.uk/'], 'no http:// "fallback" of an already-http input');
});
