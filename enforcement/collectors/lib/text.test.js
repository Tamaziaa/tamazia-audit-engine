'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripHtmlToText, firstMatch, firstCurlyQuote } = require('./text');

test('stripHtmlToText drops script and style content entirely', () => {
  const html = '<html><head><style>.x{color:red}</style><script>evil()</script></head><body><h1>Title</h1><p>Body text</p></body></html>';
  const text = stripHtmlToText(html);
  assert.doesNotMatch(text, /evil\(\)/);
  assert.doesNotMatch(text, /color:red/);
  assert.match(text, /Title/);
  assert.match(text, /Body text/);
});

test('stripHtmlToText unescapes common named and numeric entities', () => {
  assert.equal(stripHtmlToText('Fish &amp; Chips'), 'Fish & Chips');
  assert.equal(stripHtmlToText('&#163;100,000'), '£100,000');
  assert.equal(stripHtmlToText('&rsquo;'), '’');
});

test('stripHtmlToText throws on a non-string input (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  assert.throws(() => stripHtmlToText(null), TypeError);
  assert.throws(() => stripHtmlToText(undefined), TypeError);
  assert.throws(() => stripHtmlToText(42), TypeError);
});

test('firstMatch returns the first capture group or null', () => {
  assert.equal(firstMatch('Date 15 July 2026', /Date (\d{1,2} \w+ \d{4})/), '15 July 2026');
  assert.equal(firstMatch('no date here', /Date (\d{1,2} \w+ \d{4})/), null);
});

test('firstCurlyQuote extracts the first sufficiently long curly-quoted span', () => {
  const text = 'The ad said “Short” and later “Book your Botox today from only £49”.';
  assert.equal(firstCurlyQuote(text), 'Book your Botox today from only £49');
});

test('firstCurlyQuote returns null when no quote meets the minimum length (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  const text = 'The ad said “Hi” and nothing else was quoted.';
  assert.equal(firstCurlyQuote(text), null);
});
