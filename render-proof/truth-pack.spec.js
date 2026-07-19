'use strict';
// render-proof/truth-pack.spec.js - THE render truth-pack CI harness (Constitution Rules 2, 3, 7, 10, 17;
// C-124). This is the file the failure-ledger and CONSTITUTION Part III name as the enforcing gate for the
// render classes (exposure-error, consistency-error, render-security-freshness, coverage-truth). It runs the
// pure checker (render-proof/truth-pack.js) against a RECORDED golden payload + rendered text, proves the
// golden passes every rule, and then EARNS ITS ZERO with one seeded known-bad per rule (Rule 4).
//
// HOW THIS RUNS. Node's default test runner does NOT discover `*.spec.js`, only `*.test.js`. So:
//   - the render-truth lane runs it explicitly:      node --test render-proof/truth-pack.spec.js
//   - `npm test` runs it too, via the one-line shim render-proof/truth-pack.test.js which requires this file,
//     so the suite is never a hollow green that no standing CI executes.
//
// FIXTURE REGENERATION (record the golden ONCE, commit it; the tests read the RECORDED artifacts):
//   node render-proof/fixtures/gen-fixtures.js
// That composes render-proof/fixtures/golden-inputs.json through the ENGINE'S OWN payload/composer/compose.js
// into render-proof/fixtures/audit-golden-v11.json (a genuine contract-valid v1.1 payload) and renders it to
// render-proof/fixtures/audit-golden-v11.rendered.txt via render-proof/fixtures/reference-render.js.
//
// WHY reference-render.js AND NOT THE WEBSITE LUX RENDERER (the honest deviation, stated once here): the
// task's canonical source is the website lux renderer (public/audit/audit-lux.js + functions/audit/_lux.js +
// _qa/qa_lux.mjs) executed in jsdom against _qa/fixtures/v11/lomond-realestate-uk-v11.json. At this commit
// NONE of those exist in the website repo (the p4-t4 lux renderer is a separate in-flight prototype), and
// jsdom - declared in the website devDependencies - is not installed there, so the lux render cannot be
// executed. reference-render.js is the faithful stand-in for the render CONTRACT (see its header); the checker
// is renderer-agnostic. When the lux renderer lands, repoint gen-fixtures.js at it (in jsdom) and re-record
// the .txt - truth-pack.js does not change. The golden firm is pseudonymous and the law names are illustrative
// fixtures, never a claim about a real firm or live law (Rule 16 / the compose.test.js tradition).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { check, formatGBP, parseGBPAmounts, collectAllowedAmounts, CEILING_PROXIMITY_CHARS, VOICE_WINDOW } = require('./truth-pack.js');
const { renderAuditText } = require('./fixtures/reference-render.js');
const { validatePayload } = require('../payload/contract');

const FIX = path.join(__dirname, 'fixtures');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIX, 'audit-golden-v11.json'), 'utf8'));
const RENDERED = fs.readFileSync(path.join(FIX, 'audit-golden-v11.rendered.txt'), 'utf8');

// A fixed injected clock one day after the golden's generatedAt: the pure checker reads no ambient clock.
const NOW = Date.parse('2026-07-20T00:00:00Z');
const FRESH_OPTS = () => ({ now: NOW, generatedAt: GOLDEN.meta.date });

// Framework names read OFF the payload (never law-name literals in this scanned file - Rule 2).
const VIOLATION_NAME = (GOLDEN.findings.find((f) => f.state === 'violation') || {}).framework;
const REVIEW_NAME = (GOLDEN.findings.find((f) => f.state === 'needs_review') || {}).framework;
const CEILING_VALUE = GOLDEN.exposureWaterfall.ceiling.value;
const HEADLINE_VALUE = GOLDEN.exposure.value;

function rulesFired(r) { return [...new Set(r.violations.map((v) => v.rule))].sort(); }
function firedGold(text, opts) { return check(GOLDEN, text === undefined ? RENDERED : text, opts || FRESH_OPTS()); }

// ── the golden must be a real v1.1 payload, and its recorded render must be current ───────────────────────

test('the golden fixture is a contract-valid v1.1 payload (a genuine composed payload, not a mock)', () => {
  assert.deepEqual(validatePayload(GOLDEN), []);
  assert.equal(typeof GOLDEN.exposure.value, 'number');
  assert.equal(typeof GOLDEN.exposureWaterfall.ceiling.value, 'number');
  assert.ok(Array.isArray(GOLDEN.findings) && GOLDEN.findings.length >= 2, 'the golden exercises a confirmed breach AND a review item');
  assert.ok(VIOLATION_NAME && REVIEW_NAME, 'the golden carries one violation and one needs_review framework');
});

test('drift lock: re-rendering the golden payload reproduces the committed .txt byte-for-byte', () => {
  assert.equal(renderAuditText(GOLDEN), RENDERED, 'the recorded render is stale - regenerate with `node render-proof/fixtures/gen-fixtures.js`');
});

test('the golden render PASSES every truth-pack rule (ok:true, zero violations)', () => {
  const r = firedGold();
  assert.equal(r.ok, true, 'unexpected violations: ' + JSON.stringify(r.violations));
  assert.deepEqual(r.violations, []);
});

// ── one seeded known-bad per rule: earn the zero (Rule 4) ─────────────────────────────────────────────────

test('KNOWN-BAD notLegalAdvice: stripping the standing line trips notLegalAdvice, and only it (C-200)', () => {
  const r = firedGold(RENDERED.replace(GOLDEN.notLegalAdvice, ''));
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['notLegalAdvice']);
});

test('KNOWN-BAD exposure-headline: the ceiling as a BARE headline figure trips exposure-headline (C-094/C-096)', () => {
  const bare = 'Your exposure could reach ' + formatGBP(CEILING_VALUE) + ' this year.\n\n' + RENDERED;
  const r = firedGold(bare);
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['exposure-headline']);
  assert.match(r.violations[0].detail, /bare headline/);
});

test('KNOWN-BAD exposure-headline: dropping the headline exposure figure also trips exposure-headline', () => {
  const r = firedGold(RENDERED.replace('Median enforcement exposure: ' + formatGBP(HEADLINE_VALUE), 'Median enforcement exposure: (see below)'));
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('exposure-headline'));
});

test('KNOWN-BAD money-provenance: a fabricated GBP figure with no payload source trips money-provenance (C-112/C-114/C-115)', () => {
  const r = firedGold(RENDERED.replace('Coverage', 'An additional charge of ' + formatGBP(999999) + ' applies.\nCoverage'));
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['money-provenance']);
});

test('KNOWN-BAD framework-provenance (rogue): a law-name-shaped string outside the payload set trips it (Rule 2)', () => {
  const r = firedGold(RENDERED.replace('Coverage', 'You may also breach the Imaginary Markets Enforcement Act.\nCoverage'));
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['framework-provenance']);
  assert.match(r.violations[0].detail, /matches no framework/);
});

test('KNOWN-BAD framework-provenance (missing): a needs_review framework whose name is absent trips it (Rule 10)', () => {
  const r = firedGold(RENDERED.split(REVIEW_NAME).join('[framework name redacted]'));
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('framework-provenance'));
  assert.match(r.violations.map((v) => v.detail).join(' '), /must show every finding/);
});

test('KNOWN-BAD voice (confident token): a confident-breach phrase by a needs_review name trips voice (C-111)', () => {
  const r = firedGold(RENDERED.replace(REVIEW_NAME, REVIEW_NAME + ' (violation confirmed)'));
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('voice'));
});

test('KNOWN-BAD voice (withheld figure): the confirmed exposure attached to a review item trips voice (C-111)', () => {
  const r = firedGold(RENDERED.replace(REVIEW_NAME, REVIEW_NAME + ' carries ' + formatGBP(HEADLINE_VALUE) + ' of confirmed exposure'));
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('voice'));
  assert.match(r.violations.map((v) => v.detail).join(' '), /withheld from a review item/);
});

test('KNOWN-BAD counts-coherence: dropping the coverage line trips counts-coherence (C-117/C-118)', () => {
  const r = firedGold(RENDERED.replace(/Screened the catalogue\..*Rules checked: \d+\./, ''));
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('counts-coherence'));
});

test('KNOWN-BAD render-security-freshness (stale): a generatedAt over the age cap trips freshness (C-122/C-123)', () => {
  const r = check(GOLDEN, RENDERED, { now: NOW, generatedAt: '2025-11-01' });
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['render-security-freshness']);
  assert.match(r.violations[0].detail, /days old/);
});

test('KNOWN-BAD render-security-freshness (missing generatedAt): an absent stamp fails closed', () => {
  const r = check(GOLDEN, RENDERED, { now: NOW });
  assert.equal(r.ok, false);
  assert.ok(rulesFired(r).includes('render-security-freshness'));
});

test('KNOWN-BAD render-security-freshness (HMAC): requireHmac with a URL lacking sig/exp trips security (C-122)', () => {
  const r = check(GOLDEN, RENDERED, Object.assign(FRESH_OPTS(), { requireHmac: true, url: 'https://tamazia.co.uk/audit/slug/hash' }));
  assert.equal(r.ok, false);
  assert.deepEqual(rulesFired(r), ['render-security-freshness']);
  assert.match(r.violations[0].detail, /sig|exp/);
});

test('requireHmac is satisfied by a URL carrying sig AND exp (the gate is real, not always-fail)', () => {
  const r = check(GOLDEN, RENDERED, Object.assign(FRESH_OPTS(), { requireHmac: true, url: 'https://tamazia.co.uk/audit/slug/hash?sig=deadbeef&exp=1999999999' }));
  assert.equal(r.ok, true, 'a signed URL must PASS: ' + JSON.stringify(r.violations));
});

// ── the checker's own contracts (pure, total, injected clock) ─────────────────────────────────────────────

test('check never throws on a null/garbage payload - it records violations, never an exception (Rule 7)', () => {
  const r = check(null, 'some £999,999 text mentioning a Rogue Enforcement Act', FRESH_OPTS());
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.violations));
});

test('check is deterministic: the same inputs return the same violations', () => {
  const a = firedGold();
  const b = firedGold();
  assert.deepEqual(a, b);
});

test('formatGBP + parseGBPAmounts round-trip and collectAllowedAmounts reads the payload figures', () => {
  assert.equal(formatGBP(500000), '£500,000');
  assert.equal(formatGBP(12500), '£12,500');
  assert.deepEqual(parseGBPAmounts('a £5,000 and £20,000 here').map((x) => x.value), [5000, 20000]);
  const allowed = collectAllowedAmounts(GOLDEN);
  assert.ok(allowed.has(HEADLINE_VALUE) && allowed.has(CEILING_VALUE));
});

test('the ceiling-proximity radius and voice window are documented, positive constants', () => {
  assert.ok(Number.isInteger(CEILING_PROXIMITY_CHARS) && CEILING_PROXIMITY_CHARS > 0);
  assert.ok(Number.isInteger(VOICE_WINDOW) && VOICE_WINDOW > 0);
});
