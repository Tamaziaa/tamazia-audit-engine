'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ds = require('./detection-spec.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOGUE = path.join(REPO_ROOT, 'catalogue', 'dist', 'catalogue.v1.json');
const UNANCHORED_FIXTURE = path.join(REPO_ROOT, 'eval', 'calibration-known-bad', 'fixtures', 'p3-proposer-unanchored-pattern.js');

// ── the closed vocabularies ────────────────────────────────────────────────────────────────────────
test('the evidence-type, surface and pattern-kind vocabularies are the frozen closed sets', () => {
  assert.deepStrictEqual(ds.EVIDENCE_TYPES, ['presence', 'absence', 'behavioural', 'register']);
  assert.deepStrictEqual(ds.SURFACES, ['visible_text', 'raw_html', 'footer', 'register_row', 'browser_lane']);
  assert.deepStrictEqual(ds.PATTERN_KINDS, ['anchored-regex', 'token-set', 'url-path']);
  assert.throws(() => { ds.EVIDENCE_TYPES.push('x'); }, 'vocabularies are frozen');
});

// ── anchoring primitives (C-009/C-019/C-059) ────────────────────────────────────────────────────────
test('anchorToken word-boundary-wraps and escapes a token', () => {
  assert.strictEqual(ds.anchorToken('sra'), '\\bsra\\b');
  assert.strictEqual(ds.anchorToken('under-18'), '\\bunder-18\\b');
  assert.strictEqual(ds.anchorToken('a.b'), '\\ba\\.b\\b'); // regex special escaped
});

test('buildAnchoredRegex builds a \\b-bounded, whitespace-flexible phrase that matches its own words', () => {
  const src = ds.buildAnchoredRegex('authorised widget provider');
  assert.strictEqual(src, '\\bauthorised\\W+widget\\W+provider\\b');
  const re = new RegExp(src, 'i');
  assert.ok(re.test('we are an authorised   widget provider;'), 'matches with variable spacing/punctuation');
  assert.ok(!re.test('authorisedwidgetprovider'), 'does not match without a boundary');
});

// ── the anchoring validator (drives the p3-proposer-unanchored-pattern calibration fixture) ─────────
test('isAnchoredPatternValue rejects a bare anchored-regex and accepts an anchored one', () => {
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'anchored-regex', value: 'tonic' }).ok, false);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'anchored-regex', value: '\\btonic\\b' }).ok, true);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'anchored-regex', value: '\\b(' }).ok, false, 'a non-compiling regex is rejected (C-050)');
});

test('isAnchoredPatternValue rejects short/blank tokens and a bare url-path', () => {
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'token-set', value: { tokens: ['eu'], mode: 'all' } }).ok, false);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'token-set', value: { tokens: ['notice'], mode: 'all' } }).ok, true);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'token-set', value: { tokens: ['notice'], mode: 'sometimes' } }).ok, false, 'mode must be all/any');
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'url-path', value: 'cost' }).ok, false);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'url-path', value: '/complaints' }).ok, true);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'nonsense', value: 'x' }).ok, false, 'unknown kind rejected');
});

test('CALIBRATION: validateSpec rejects every bad spec in p3-proposer-unanchored-pattern and accepts the anchored twin', () => {
  assert.ok(fs.existsSync(UNANCHORED_FIXTURE), 'the calibration fixture must exist');
  const fixture = require(UNANCHORED_FIXTURE);
  assert.ok(Array.isArray(fixture.bad) && fixture.bad.length >= 1, 'fixture carries known-bad specs');
  for (const entry of fixture.bad) {
    const v = ds.validateSpec(entry.spec);
    assert.strictEqual(v.valid, false, 'unanchored spec must be rejected: ' + entry.why);
    assert.ok(v.errors.some((e) => /anchor|floor|segment|compile/i.test(e)), 'the rejection names the anchoring defect: ' + JSON.stringify(v.errors));
  }
  assert.strictEqual(ds.validateSpec(fixture.good).valid, true, 'the anchored twin must pass (both-directions calibration, C-203)');
});

// ── the ReDoS guard: derived patterns must be linear-time (Rob P0, real-corpus hang) ────────────────
test('validateSpec REJECTS a catastrophic-backtracking derived pattern (lookahead-dot-star / nested quantifier)', () => {
  const redos = [
    '(?=[\\s\\S]*sra)\\bx\\b',   // lookahead with an unbounded [\s\S]* - the exact old 'all' token-set form
    '\\bfoo.*bar\\b',            // an unbounded .* dot-star
    '\\b(a+)+\\b',               // a nested quantifier
  ];
  for (const value of redos) {
    const spec = { record_id: 'X', duty_idx: 0, evidence_type: 'absence', surface: 'visible_text', page_class: 'any',
      patterns: [{ kind: 'anchored-regex', value, negation_guarded: false }] };
    const v = ds.validateSpec(spec);
    assert.strictEqual(v.valid, false, value + ' must be rejected as a ReDoS vector');
    assert.ok(v.errors.some((e) => /backtrack|linear|lookar|nested|redos/i.test(e)), 'the rejection names the backtracking defect: ' + JSON.stringify(v.errors));
  }
  // A legitimate \b-bounded phrase with \W+ gaps and an escaped literal dot is NOT flagged.
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'anchored-regex', value: '\\bauthorised\\W+widget\\W+provider\\b' }).ok, true);
  assert.strictEqual(ds.isAnchoredPatternValue({ kind: 'anchored-regex', value: '\\ba\\.b\\b' }).ok, true, 'an escaped literal dot is fine');
});

test('matchesText is LINEAR for an "all" token-set: it tests each token, never a co-occurrence mega-regex', () => {
  const all = { kind: 'token-set', value: { tokens: ['certification', 'specialist'], mode: 'all' } };
  assert.equal(ds.matchesText(all, 'we hold a certification as a specialist firm'), true);
  assert.equal(ds.matchesText(all, 'we hold a certification'), false, 'all tokens must co-occur');
  const any = { kind: 'token-set', value: { tokens: ['complaint', 'ombudsman'], mode: 'any' } };
  assert.equal(ds.matchesText(any, 'contact the ombudsman'), true);
  assert.equal(ds.matchesText(any, 'nothing relevant here'), false);
  // compileRegex no longer produces a lookahead for an 'all' token-set (the ReDoS form is gone).
  assert.equal(ds.compileRegex(all), null, "an 'all' token-set has no single-regex form; it is matched linearly");
  const bigAbsent = 'the firm advises clients on many matters. '.repeat(20000); // ~840k chars, tokens absent
  const t0 = Date.now();
  assert.equal(ds.matchesText(all, bigAbsent), false);
  assert.ok(Date.now() - t0 < 500, 'matching a huge corpus is linear, not a backtracking hang (took ' + (Date.now() - t0) + 'ms)');
});

// ── negation, review and prose guards (ported from corpus-index.js, C-048/C-090/C-089) ──────────────
test('isNegated fires on a compliance self-declaration, not on a bare prohibited claim', () => {
  assert.ok(ds.isNegated('we do not offer this treatment to under-18s'));
  assert.ok(ds.isNegated('clients must be 18 or over to book'));
  assert.ok(!ds.isNegated('we offer this treatment to everyone today'));
});

test('looksLikeReview fires on review framing only', () => {
  assert.ok(ds.looksLikeReview('Five stars, would highly recommend this clinic to anyone.'));
  assert.ok(!ds.looksLikeReview('We publish our complaints procedure on this page.'));
});

test('isProse rejects short strings and Title-Case nav runs, accepts a real sentence', () => {
  assert.ok(!ds.isProse('Home About Contact Services'));
  assert.ok(!ds.isProse('too short'));
  assert.ok(ds.isProse('We are authorised and regulated and publish our complaints procedure here.'));
});

// ── surface + page-class routing (C-034/C-035/C-036) ────────────────────────────────────────────────
test('surfaceFor routes each evidence type to its declared surface', () => {
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'register', duty: 'appears on the register', elements: [] }), 'register_row');
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'behavioural', duty: 'do not set cookies before consent', elements: [] }), 'browser_lane');
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'presence', duty: 'display the registration number', elements: ['registration number shown'] }), 'footer');
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'presence', duty: 'display the clickable verification badge', elements: ['badge embedded'] }), 'raw_html');
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'presence', duty: 'publish a privacy notice', elements: ['notice present'] }), 'visible_text');
  assert.strictEqual(ds.surfaceFor({ evidence_type: 'absence', duty: 'do not advertise the tonic', elements: [] }), 'visible_text');
});

test('pageClassFor mirrors the coverage-contract mapping and is null for lane-only duties', () => {
  assert.strictEqual(ds.pageClassFor({ evidence_type: 'presence', duty: 'publish the privacy notice', elements: [] }), 'privacy');
  assert.strictEqual(ds.pageClassFor({ evidence_type: 'presence', duty: 'publish the complaints procedure', elements: [] }), 'complaints');
  assert.strictEqual(ds.pageClassFor({ evidence_type: 'presence', duty: 'publish something general', elements: [] }), 'any');
  assert.strictEqual(ds.pageClassFor({ evidence_type: 'register', duty: 'appears on register', elements: [] }), null);
  assert.strictEqual(ds.pageClassFor({ evidence_type: 'behavioural', duty: 'cookie consent', elements: [] }), null);
});

// ── pattern derivation polarity (the C-024-vs-C-078 asymmetry) ──────────────────────────────────────
test('a quoted phrase becomes an anchored-regex; an absence phrase is negation-guarded', () => {
  const r = ds.patternsFromElement("the phrase 'no win no fee' must not appear", 'absence', 'any');
  const anchored = r.patterns.find((p) => p.kind === 'anchored-regex');
  assert.ok(anchored, 'a quoted phrase yields an anchored-regex');
  assert.strictEqual(anchored.negation_guarded, true, 'an absence (prohibition) pattern is negation-guarded');
  assert.ok(new RegExp(anchored.value, 'i').test('we offer no win no fee representation'));
});

test('presence derives a distinctive token-set (lenient present-check); a prohibition derives NO descriptive token-set (RANK 1 paper-tiger fix)', () => {
  const pres = ds.patternsFromElement('registered office address published clearly', 'presence', 'any');
  const presTs = pres.patterns.find((p) => p.kind === 'token-set');
  assert.ok(presTs && presTs.value.mode === 'all' && presTs.value.tokens.length >= 2);
  assert.strictEqual(presTs.negation_guarded, false);
  // The descriptive-token fallback for a prohibition is DISABLED (hidden-defects.md RANK 1, the "paper
  // tiger"): patterning on the LAW'S OWN descriptive words ([unfounded,sparkle,guarantee]) described the
  // offence but never matched a real violation. An absence element with no QUOTED phrase now derives no
  // token-set at all, so with no prohibited_phrases either it is unpatternable and propose.js abstains
  // (precision floor: a missed prohibition is recoverable, a false accusation is not - C-078/C-082).
  const abs = ds.patternsFromElement('unfounded miracle sparkle guarantee claims', 'absence', 'any');
  assert.strictEqual(abs.patterns.find((p) => p.kind === 'token-set'), undefined, 'a prohibition derives no descriptive token-set from the law prose');
  assert.strictEqual(abs.unpatternable, true, 'no quoted phrase + no prohibited_phrases => unpatternable');
});

test('prohibited_phrases[] on an absence obligation compile to prose-exempt, negation-guarded anchored-regex (the curated prohibition matcher, DEFECT-5)', () => {
  const record = { id: 'FAKE_ACT_2099_PROHIB', website_obligations: [
    { duty: 'Do not name the prohibited medicine in public copy', elements: ['no prohibited medicine named'], evidence_type: 'absence', prohibited_phrases: ['Botox', 'anti-wrinkle injections'] },
  ] };
  const spec = ds.compileRecordSpecs(record)[0];
  const anchored = spec.patterns.filter((p) => p.kind === 'anchored-regex');
  assert.ok(anchored.length >= 2, 'each prohibited phrase yields an anchored-regex');
  const botox = anchored.find((p) => /Botox/i.test(p.value));
  assert.ok(botox, 'the Botox phrase is patterned as an anchored-regex');
  assert.strictEqual(botox.prose_exempt, true, 'a curated prohibited phrase matches headings/short strings (prose-exempt, RANK 2)');
  assert.strictEqual(botox.negation_guarded, true, 'a curated prohibited phrase is negation-guarded (C-048/C-060)');
  assert.ok(new RegExp(botox.value, 'i').test('Book your Botox treatment today'), 'the anchored Botox pattern matches the violating heading');
  assert.strictEqual(ds.validateSpec(spec).valid, true, 'a spec carrying prohibited_phrases is valid + anchored');
  // A non-absence obligation ignores prohibited_phrases entirely (only a PROHIBITION carries them).
  const presRec = { id: 'FAKE_ACT_2099_PRES', website_obligations: [
    { duty: 'Publish the notice', elements: ["'privacy notice' present"], evidence_type: 'presence', prohibited_phrases: ['Botox'] },
  ] };
  const presSpec = ds.compileRecordSpecs(presRec)[0];
  assert.ok(!presSpec.patterns.some((p) => /Botox/i.test(p.value || '')), 'prohibited_phrases only apply to a prohibition (absence)');
});

test('a findability presence element on a specific page-class yields an anchored url-path', () => {
  const r = ds.patternsFromElement('complaints procedure findable on the website', 'presence', 'complaints');
  const up = r.patterns.find((p) => p.kind === 'url-path');
  assert.ok(up && up.value === '/complaints');
});

test('an element with no distinctive tokens is unpatternable rather than a low-precision guess', () => {
  const r = ds.patternsFromElement('the the and or of to', 'presence', 'any');
  assert.strictEqual(r.unpatternable, true);
  assert.strictEqual(r.patterns.length, 0);
});

// ── spec assembly + determinism ─────────────────────────────────────────────────────────────────────
test('specForObligation binds record_id + duty_idx and carries the derived shape', () => {
  const record = { id: 'FAKE_ACT_2099_X', website_obligations: [] };
  const spec = ds.specForObligation(record, { duty: 'publish the privacy notice', elements: ["'privacy notice' present"], evidence_type: 'presence' }, 2);
  assert.strictEqual(spec.record_id, 'FAKE_ACT_2099_X');
  assert.strictEqual(spec.duty_idx, 2);
  assert.strictEqual(spec.evidence_type, 'presence');
  assert.strictEqual(spec.page_class, 'privacy');
  assert.strictEqual(ds.validateSpec(spec).valid, true);
});

test('compileRecordSpecs is deterministic (identical output for identical input)', () => {
  const record = {
    id: 'FAKE_ACT_2099_DET',
    website_obligations: [
      { duty: 'publish the privacy notice', elements: ["'privacy notice' present"], evidence_type: 'presence' },
      { duty: 'do not advertise the tonic cure', elements: ["the phrase 'miracle tonic cure' must not appear"], evidence_type: 'absence' },
    ],
  };
  assert.deepStrictEqual(ds.compileRecordSpecs(record), ds.compileRecordSpecs(record));
});

// ── the real catalogue (executes the real entry point on real data - C-148) ─────────────────────────
test('compileCatalogue compiles the real catalogue with zero rejected and every spec valid + anchored', () => {
  assert.ok(fs.existsSync(CATALOGUE), 'the compiled catalogue must exist (run npm run catalogue first)');
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const { specs, rejected } = ds.compileCatalogue(catalogue);
  assert.ok(specs.length > 100, 'the real catalogue yields a substantial spec set, got ' + specs.length);
  assert.strictEqual(rejected.length, 0, 'no derived spec is unanchored: ' + JSON.stringify(rejected.slice(0, 3)));
  for (const spec of specs) {
    assert.strictEqual(ds.validateSpec(spec).valid, true, 'every emitted spec is valid: ' + spec.record_id + '#' + spec.duty_idx);
    assert.ok(ds.EVIDENCE_TYPES.includes(spec.evidence_type));
    const laneOnly = spec.evidence_type === 'register' || spec.evidence_type === 'behavioural';
    assert.strictEqual(spec.page_class === null, laneOnly, 'page_class is null iff a non-crawl lane');
  }
});

test('compileCatalogue tolerates both the artifact shape and a bare records array', () => {
  const records = [{ id: 'FAKE_ACT_2099_A', website_obligations: [{ duty: 'publish the privacy notice', elements: ["'privacy notice' present"], evidence_type: 'presence' }] }];
  const fromArtifact = ds.compileCatalogue({ records });
  const fromArray = ds.compileCatalogue(records);
  assert.deepStrictEqual(fromArtifact.specs, fromArray.specs);
  assert.strictEqual(ds.compileCatalogue(null).specs.length, 0, 'a null catalogue yields no specs, never throws');
});
