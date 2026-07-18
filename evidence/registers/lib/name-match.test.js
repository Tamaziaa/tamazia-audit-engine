'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const nameMatch = require('./name-match');
const { scoreMatch, isNameMatch, bestCandidate, queryTooShort, domainStemFallback, MATCH_THRESHOLD } = nameMatch;

test('MATCH_THRESHOLD is 0.6 (documented, not accidental)', () => {
  assert.equal(MATCH_THRESHOLD, 0.6);
});

test('exact name, suffix-only difference -> score 1.0, matches', () => {
  const r = scoreMatch('Kingsley Napley LLP', 'KINGSLEY NAPLEY LLP');
  assert.equal(r.score, 1);
  assert.ok(isNameMatch('Kingsley Napley LLP', 'KINGSLEY NAPLEY LLP'));
});

test('the C-004 calibration case: "Kingsley Napley LLP" vs "Kingsley Carpets Ltd" is REJECTED', () => {
  const r = scoreMatch('Kingsley Napley LLP', 'Kingsley Carpets Ltd');
  assert.ok(r.score < MATCH_THRESHOLD, 'shared-first-word-only must score below threshold, got ' + r.score);
  assert.equal(isNameMatch('Kingsley Napley LLP', 'Kingsley Carpets Ltd'), false);
});

test('a register variant with one extra token still matches (superset variant)', () => {
  const r = scoreMatch('Kingsley Napley', 'Kingsley Napley Solicitors LLP');
  assert.ok(r.score >= MATCH_THRESHOLD, 'expected >= threshold, got ' + r.score);
  assert.ok(isNameMatch('Kingsley Napley', 'Kingsley Napley Solicitors LLP'));
});

test('an ampersand and a legal suffix normalise the same way on both sides', () => {
  assert.ok(isNameMatch('Marks & Spencer plc', 'Marks and Spencer PLC'));
});

test('a legal-suffix WORD used mid-name is NOT stripped (only TRAILING suffixes are entity suffixes)', () => {
  // "Limited" here is part of the trading name, not an entity suffix. Stripping it anywhere (the old
  // global behaviour) would collapse "Limited Edition Design" onto "Edition Design" and could match an
  // unrelated company. The trailing-anchored strip keeps the leading "limited" as a real name token.
  assert.equal(nameMatch.normaliseName('Limited Edition Design'), 'limited edition design');
  assert.equal(nameMatch.normaliseName('Limited Edition Design Ltd'), 'limited edition design', 'a TRAILING Ltd is still stripped');
  // and two distinct companies sharing only the trailing suffix do not collapse together:
  assert.equal(isNameMatch('Limited Edition Design', 'Napley Solicitors Ltd'), false);
});

test('domainStemFallback ignores credentials/port in the URL (parsed via the one URL-safe door, Rule 5)', () => {
  assert.equal(domainStemFallback('https://user:pass@kingsleynapley.co.uk:8443/x'), 'kingsleynapley');
  assert.equal(domainStemFallback('HTTP://WWW.Example.COM'), 'example');
});

test('empty or whitespace-only candidate never matches (no divide-by-zero, no crash)', () => {
  const r = scoreMatch('Kingsley Napley LLP', '');
  assert.equal(r.score, 0);
  assert.equal(isNameMatch('Kingsley Napley LLP', ''), false);
});

test('a single generic shared token against a longer name is rejected (defence in depth)', () => {
  // "Kingsley" alone vs "Kingsley Napley LLP": 1 shared token out of a 2-token union -> 0.5 < 0.6.
  const r = scoreMatch('Kingsley', 'Kingsley Napley LLP');
  assert.ok(r.score < MATCH_THRESHOLD);
});

test('queryTooShort refuses a normalised query under MIN_QUERY_LEN', () => {
  assert.equal(queryTooShort('BP'), true); // 2 chars, well under the 4-char floor
  assert.equal(queryTooShort('BDO'), true); // 3 chars, still under the floor
  assert.equal(queryTooShort('ACME'), false); // 4 chars, exactly at the floor: usable
});

test('bestCandidate picks the highest-scoring candidate and reports matched correctly', () => {
  const candidates = [
    { name: 'Kingsley Carpets Ltd' },
    { name: 'KINGSLEY NAPLEY LLP' },
  ];
  const best = bestCandidate('Kingsley Napley LLP', candidates, (c) => c.name);
  assert.equal(best.matched, true);
  assert.equal(best.nameMatched, 'KINGSLEY NAPLEY LLP');
  assert.equal(best.nameQueried, 'Kingsley Napley LLP');
});

test('bestCandidate returns matched:false when the nearest candidate is still a near-miss', () => {
  const candidates = [{ name: 'Kingsley Carpets Ltd' }];
  const best = bestCandidate('Kingsley Napley LLP', candidates, (c) => c.name);
  assert.equal(best.matched, false);
});

test('bestCandidate returns null for an empty candidate list', () => {
  assert.equal(bestCandidate('Anything', [], (c) => c.name), null);
});

test('domainStemFallback derives a plausible seed from a bare domain, never the identity fact', () => {
  assert.equal(domainStemFallback('kingsleynapley.co.uk'), 'kingsleynapley');
  assert.equal(domainStemFallback('https://www.example.com/path'), 'example');
  assert.equal(domainStemFallback(''), '');
  assert.equal(domainStemFallback(null), '');
});
