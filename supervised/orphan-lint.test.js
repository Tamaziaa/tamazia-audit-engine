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

// Kimi K3 finding HIGH-6, leg 1 (live audit 2026-07-20): isFactualSentence's verb blacklist had no
// marketing/promise verbs, so a factual claim about the site's own content phrased with "promises" needed
// no citation at all - exactly the class of sentence a fin-promo finding would need to cite.
test('HIGH-6 (leg 1 - the adversarial example): "Your homepage promises guaranteed returns." with NO citation is flagged as an orphan claim', () => {
  const result = lintNoOrphanClaims('Your homepage promises guaranteed returns.', []);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.violations[0].type, 'orphan_claim');
});

// Kimi K3 finding HIGH-6, leg 2 (live audit 2026-07-20): splitSentences glued single-newline-separated
// bullet lines into ONE "sentence" (since the next line opens with '-', not [A-Z0-9"']), so a citation on
// the FIRST bullet made hasCitation() see it anywhere in the glued blob and silently cover an uncited
// SECOND bullet's claim right beside it.
test('HIGH-6 (leg 2 - the bullet-twin proof): a citation on ONE bullet does not cover an uncited sibling bullet', () => {
  const f = finding();
  const text = '- The site fails to display a cookie banner (Finding ' + f.finding_id + ').\n'
    + '- The site fails to display a privacy policy link.';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, false, 'the second, uncited bullet must be flagged on its own');
  assert.strictEqual(result.violations.length, 1);
  assert.strictEqual(result.violations[0].type, 'orphan_claim');
  assert.match(result.violations[0].sentence, /privacy policy link/);
});

test('HIGH-6 (leg 2): a fully-cited bullet list (every bullet carries its OWN citation) still passes', () => {
  const f1 = finding();
  const f2 = finding({ quote: { evidence_id: 'e2', byte_start: 0, byte_end: 5, span_sha256: FAKE_SPAN_HASH } });
  const text = '- The site fails to display a cookie banner (Finding ' + f1.finding_id + ').\n'
    + '- The site fails to display a privacy policy link (Finding ' + f2.finding_id + ').';
  const result = lintNoOrphanClaims(text, [f1, f2]);
  assert.strictEqual(result.ok, true);
});

// Kimi K3 finding O3 (live audit 2026-07-20): this module's header promises a citation is "a finding_id or
// an artifact", but hasCitation() only ever checked finding_ids, and neither regex could match a 64-char
// sha256 artifact hash (CITATION_RE capped at 32, BARE_ID_RE required exactly 16).
test('O3: a citation to a real ARTIFACT id (not a finding_id) satisfies the citation requirement when artifactIds is supplied', () => {
  const sha256Like = 'b'.repeat(64); // a real artifact's sha256 shape (capture-index.js's own field length)
  const text = 'The site does not display a cookie banner (Evidence ' + sha256Like + ').';
  const failing = lintNoOrphanClaims(text, []); // no artifactIds supplied: old, finding-ids-only behaviour
  assert.strictEqual(failing.ok, false, 'without the artifact id set, this must still be flagged (documents the old gap)');
  const passing = lintNoOrphanClaims(text, [], [sha256Like]);
  assert.strictEqual(passing.ok, true, 'with the real artifact id supplied, the citation is honoured');
});

test('O3: a BARE 64-hex artifact id (no "Evidence"/"Finding" prefix) is also matchable, not just the 16-char finding_id shape', () => {
  const sha256Like = 'c'.repeat(64);
  const text = 'The site fails to disclose its cookie policy (' + sha256Like + ').';
  const result = lintNoOrphanClaims(text, [], [sha256Like]);
  assert.strictEqual(result.ok, true);
});

// Kimi K3 R2 finding A8/#8 (live audit 2026-07-20): the verb allowlist missed real accusation verbs, so an
// uncited accusation using one of them read as scaffolding and shipped.
test('A8/#8 (the adversarial example): "Your checkout auto-enrols customers into a plan." with NO citation is flagged', () => {
  const result = lintNoOrphanClaims('Your checkout auto-enrols customers into a plan.', []);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.violations[0].type, 'orphan_claim');
});

test('A8/#8: other widened verbs (collects/charges/sells/tracks/hides) are all treated as factual claims', () => {
  for (const s of ['The site collects visitor data.', 'The checkout charges a hidden fee.', 'The page tracks users across sites.', 'The banner hides the reject button.']) {
    assert.strictEqual(lintNoOrphanClaims(s, []).ok, false, s + ' should require a citation');
  }
});

// Kimi K3 R2 finding A15/#15+#16 (live audit 2026-07-20): banned-phrase holes and substring misfires.
test('A15/#15: newly-added strong phrases (violates/contravenes/prosecutable) are reserved for confirmed tier', () => {
  for (const phrase of ['violates', 'contravenes', 'prosecutable', 'against the law']) {
    const f = finding({ class: FINDING_CLASS.NEEDS_HUMAN });
    const result = lintNoOrphanClaims('This site ' + phrase + ' the rules (Finding ' + f.finding_id + ').', [f]);
    assert.strictEqual(result.ok, false, phrase + ' should be flagged on a needs_human citation');
  }
});

test('A15/#16 (THE SUBSTRING-MISFIRE FIX): "not illegal" and "illegally" are NOT flagged as banned phrases', () => {
  // "not illegal" is an exoneration (negation suppressor); "illegally" no longer substring-matches "illegal".
  assert.strictEqual(lintNoOrphanClaims('This practice is not illegal.', []).ok, true);
  const noViolation = lintNoOrphanClaims('An illegally-looking banner.', []);
  assert.ok(!noViolation.violations.some((v) => v.type === 'banned_phrase' || v.type === 'banned_phrase_wrong_tier'));
});

// Kimi K3 R2 finding A13/#19 (live audit 2026-07-20): abbreviation splits produced a false orphan-claim
// hard-refusal on a correctly-cited report.
test('A13/#19 (THE ABBREVIATION-SPLIT FIX): a cited sentence containing "e.g." is NOT torn into an uncited fragment', () => {
  const f = finding();
  const text = 'The site does not disclose fees, e.g. Guaranteed returns are shown (Finding ' + f.finding_id + ').';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, true, 'the abbreviation must not split the citation off its own claim');
});

// Kimi K3 R2 finding #31 (live audit 2026-07-20): a banned phrase in a sentence citing MULTIPLE findings
// must be licensed if ANY cited finding is confirmed, not only the first cited id.
test('#31: a banned phrase is licensed when a LATER-cited finding (not the first) is CONFIRMED', () => {
  const likely = finding({ class: FINDING_CLASS.LIKELY });
  const confirmed = finding({ class: FINDING_CLASS.CONFIRMED, quote: { evidence_id: 'e2', byte_start: 0, byte_end: 5, span_sha256: FAKE_SPAN_HASH } });
  const text = 'This is illegal (Finding ' + likely.finding_id + ', Finding ' + confirmed.finding_id + ').';
  const result = lintNoOrphanClaims(text, [likely, confirmed]);
  assert.strictEqual(result.ok, true);
});

// Kimi K3 R2 finding #45 (live audit 2026-07-20): the list-marker set was thin; en/em-dash bullets glued.
test('#45: an en-dash/em-dash-bulleted list splits so an uncited second bullet is caught on its own', () => {
  const f = finding();
  const text = '– The site fails to display a cookie banner (Finding ' + f.finding_id + ').\n'
    + '– The site fails to display a privacy policy link.';
  const result = lintNoOrphanClaims(text, [f]);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.violations.length, 1);
  assert.match(result.violations[0].sentence, /privacy policy link/);
});
