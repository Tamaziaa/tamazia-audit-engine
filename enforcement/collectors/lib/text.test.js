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

test('stripHtmlToText drops a script/style block whose closing tag carries extra junk before ">" (CodeQL js/bad-tag-filter regression), never leaking its body into the extracted text (KNOWN-BAD CALIBRATION FIXTURE)', () => {
  // Real pages (and a filter-bypass technique, CWE-116/CWE-184) close a tag with attributes or
  // stray whitespace/tabs/newlines before the ">" - e.g. `</script foo="bar">` or `</script\t\n>` -
  // which a bare `</script\s*>` or `</script>` filter does not match, silently leaving the body sitting
  // in the "cleaned" text.
  const html = '<html><body><style bogus="x">.y{color:blue}</style bogus="x"><script>evil1()</script foo="bar"><script>evil2()</script\t\n ><p>Kept text</p></body></html>';
  const text = stripHtmlToText(html);
  assert.doesNotMatch(text, /color:blue/);
  assert.doesNotMatch(text, /evil1\(\)/);
  assert.doesNotMatch(text, /evil2\(\)/);
  assert.match(text, /Kept text/);
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

test('firstCurlyQuote falls back to straight ASCII quotes when the page has no curly-quoted span at all (an &quot;-encoded ad description decoded to straight " by unescapeEntities upstream)', () => {
  const text = 'The ad description read "Book your Botox today from only £49" and was assessed against the Code.';
  assert.equal(firstCurlyQuote(text), 'Book your Botox today from only £49');
});

test('firstCurlyQuote prefers a genuine curly-quoted span over a straight-quoted one elsewhere on the same page', () => {
  const text = 'A rebuttal paragraph said "not a real quote at all here" but the ad itself read “Book your Botox today from only £49”.';
  assert.equal(firstCurlyQuote(text), 'Book your Botox today from only £49');
});
