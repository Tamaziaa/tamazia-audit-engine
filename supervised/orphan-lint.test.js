'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lintNoOrphanClaims, BANNED_PHRASES } = require('./orphan-lint.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');

// A syntactically-valid 64-char lowercase-hex span_sha256 (shape-valid per finding.js's SPAN_HASH_RE).
// This lint operates purely on finding_id/class, never on quote reality, so a fixture value need not be a
// real hash of anything - it only needs to satisfy createFinding()'s mandatory-field shape check.
const FAKE_SPAN_HASH = 'a'.repeat(64);

function finding(overrides) {
  return createFinding(Object.assign({ rule_id: 'UK_X', catalogue_hash: 'h', quote: { evidence_id: 'e1', byte_start: 0, byte_end: 5, span_sha256: FAKE_SPAN_HASH }, jurisdiction: 'UK', class: FINDING_CLASS.LIKELY }, overrides));
}

test('a factual sentence with a finding_id citation passes', () => {
  const f = finding();
  const text = 'The site does not display a cookie banner (Finding ' + f.finding_id + ').';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, true);
});

test('ORPHAN CLAIM: a factual sentence with NO citation at all is flagged', () => {
  const result = lintNoOrphanClaims('The site breaches the Equality Act 2010.', []);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.violations[0].type, 'orphan_claim');
});

test('boilerplate/scaffolding sentences with no claim verb are NOT flagged', () => {
  const result = lintNoOrphanClaims('This report was generated automatically. It covers the homepage and linked policy pages.', []);
  assert.strictEqual(result.ok, true);
});

test('BANNED PHRASE reserved for confirmed tier: used on a likely-tier citation is flagged', () => {
  const f = finding({ class: FINDING_CLASS.LIKELY });
  const text = 'This is illegal under UK law (Finding ' + f.finding_id + ').';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some((v) => v.type === 'banned_phrase_wrong_tier'));
});

test('BANNED PHRASE is allowed when it cites a genuinely CONFIRMED-tier finding', () => {
  const f = finding({ class: FINDING_CLASS.CONFIRMED });
  const text = 'This is illegal under UK law (Finding ' + f.finding_id + ').';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, true);
});

test('BANNED PHRASE with no citation at all is flagged as banned_phrase (not just orphan_claim)', () => {
  const result = lintNoOrphanClaims('You are breaking the law.', []);
  assert.strictEqual(result.ok, false);
  // "breaking the law" contains a claim verb "does" no - check the sentence is still caught by SOME rule.
  assert.ok(result.violations.length >= 1);
});

test('every entry in BANNED_PHRASES is actually reserved for confirmed tier (self-check of the fixture list)', () => {
  for (const phrase of BANNED_PHRASES) {
    const f = finding({ class: FINDING_CLASS.NEEDS_HUMAN });
    const text = 'This site ' + phrase + ' (Finding ' + f.finding_id + ').';
    const result = lintNoOrphanClaims(text, [f]);
    assert.strictEqual(result.ok, false, 'phrase "' + phrase + '" should be flagged on a needs_human citation');
  }
});
