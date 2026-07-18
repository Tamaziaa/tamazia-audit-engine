'use strict';
// eval/e2e/lib/redteam-handlers.test.js
//   node --test eval/e2e/lib/redteam-handlers.test.js

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { RT_HANDLERS, abstainedFacts, buildChallengeHtml, rtBotWall, rtEssentialCookie, rtQuoteDrift, rtContradictoryEntity } = require('./redteam-handlers');

const REAL_REDTEAM_PATH = path.join(__dirname, '..', '..', 'red-team', 'fixtures.json');
const hasRealFile = fs.existsSync(REAL_REDTEAM_PATH);
const realById = hasRealFile ? Object.fromEntries(JSON.parse(fs.readFileSync(REAL_REDTEAM_PATH, 'utf8')).fixtures.map((f) => [f.id, f])) : {};

test('RT_HANDLERS: is keyed by exactly the four bespoke ids this harness wires', () => {
  assert.deepStrictEqual(Object.keys(RT_HANDLERS).sort(), [
    'RT-D-BOT-WALL', 'RT-F-CONTRADICTORY-ENTITY', 'RT-G-ESSENTIAL-COOKIE-PRECONSENT', 'RT-H-QUOTE-DRIFT',
  ]);
});

test('buildChallengeHtml: embeds the given title inside a real <title> tag', () => {
  const html = buildChallengeHtml({ title: 'Attention Required! | Cloudflare', body_text: 'blocked' });
  assert.match(html, /<title>Attention Required! \| Cloudflare<\/title>/);
  assert.match(html, /blocked/);
});

test('abstainedFacts: true when identity/jurisdiction/sector all abstain', () => {
  const facts = {
    identity: { legal_name: { value: null } },
    jurisdiction: { bound: [] },
    sector: { value: null },
  };
  assert.strictEqual(abstainedFacts(facts), true);
});

test('abstainedFacts: false when ANY of the three carries a confident value', () => {
  const facts = { identity: { legal_name: { value: 'X Ltd' } }, jurisdiction: { bound: [] }, sector: { value: null } };
  assert.strictEqual(abstainedFacts(facts), false);
});

test('rtEssentialCookie: no cookies_pre_consent is honestly skipped', () => {
  const r = rtEssentialCookie({ input: {} });
  assert.strictEqual(r.status, 'skipped');
});

test('rtEssentialCookie: a genuinely non-essential cookie escapes', () => {
  const r = rtEssentialCookie({ input: { cookies_pre_consent: [{ name: '_ga', domain: '.example.com' }] } });
  assert.strictEqual(r.status, 'escaped');
});

test('rtEssentialCookie: session/CSRF/consent cookies are caught (classified essential)', () => {
  const r = rtEssentialCookie({
    input: {
      cookies_pre_consent: [
        { name: 'sessionid', domain: '.example.com' },
        { name: 'csrftoken', domain: '.example.com' },
        { name: 'cookieconsent_status', domain: '.example.com' },
      ],
    },
  });
  assert.strictEqual(r.status, 'caught');
});

test('rtQuoteDrift: a drifted quote escapes (must have been rejected but was not) - synthetic escape case', () => {
  // Construct a scenario where the "drifted" quote IS actually present verbatim, so the real verifier
  // (correctly) accepts it - proving this test harness can tell the difference, not merely echoing pass.
  const r = rtQuoteDrift({
    input: {
      corpus_text: 'identical text on both sides',
      proposed_quote_drifted: 'identical text on both sides',
      exact_quote_control: 'identical text on both sides',
    },
  });
  assert.strictEqual(r.status, 'escaped');
  assert.match(r.reason, /accepted as a verbatim match/);
});

test('rtQuoteDrift: a verifier that rejects the exact control too is theatre, not caught', () => {
  const r = rtQuoteDrift({
    input: {
      corpus_text: 'completely unrelated corpus text',
      proposed_quote_drifted: 'something drifted',
      exact_quote_control: 'this control also does not appear anywhere',
    },
  });
  assert.strictEqual(r.status, 'escaped');
  assert.match(r.reason, /rejects everything/);
});

test('rtContradictoryEntity: catches cleanly when identity abstains/weak-confidences on a contradiction', () => {
  const r = rtContradictoryEntity({
    input: { bundle: { domain: 'clean-example.co.uk', corpus: { pages: [{ url: 'https://clean-example.co.uk/', text: 'Clean Example Ltd, a small firm.' }] }, registers: {} } },
  });
  assert.strictEqual(r.status, 'caught');
});

// ---------------------------------------------------------------------------------------------------
// Against the REAL fixture file (when present): each handler produces exactly the outcome verified by
// hand against the live modules before this file was written (see the session's own sanity check).
// ---------------------------------------------------------------------------------------------------
test('SMOKE: rtBotWall against the real RT-D-BOT-WALL fixture catches the challenge + facts abstention', { skip: !hasRealFile }, () => {
  const r = rtBotWall(realById['RT-D-BOT-WALL']);
  assert.strictEqual(r.status, 'caught');
});

test('SMOKE: rtEssentialCookie against the real RT-G fixture catches (all three cookies essential)', { skip: !hasRealFile }, () => {
  const r = rtEssentialCookie(realById['RT-G-ESSENTIAL-COOKIE-PRECONSENT']);
  assert.strictEqual(r.status, 'caught');
});

test('SMOKE: rtQuoteDrift against the real RT-H fixture catches (drift rejected, exact accepted)', { skip: !hasRealFile }, () => {
  const r = rtQuoteDrift(realById['RT-H-QUOTE-DRIFT']);
  assert.strictEqual(r.status, 'caught');
});

// RT-F is the moving target: its own current_status flips from verified_escapes_live_gate (facts still
// asserts the contradictory register row -> the handler reports 'xfail', the known tracked escape) to
// verified_caught_live once facts weighs the contradicting on-page identifier and abstains (-> 'caught').
// The INVARIANT this smoke test locks, in either world, is that the handler NEVER reports a fresh
// 'escaped' (nor 'error') on the documented fixture: a known escape is xfail, a fixed one is caught.
test('SMOKE: rtContradictoryEntity against the real RT-F fixture is caught (fixed) or xfail (known), never a fresh escape', { skip: !hasRealFile }, () => {
  const r = rtContradictoryEntity(realById['RT-F-CONTRADICTORY-ENTITY']);
  assert.ok(r.status === 'caught' || r.status === 'xfail', 'expected caught or xfail, got ' + r.status + ' (' + (r.reason || '') + ')');
  assert.notStrictEqual(r.status, 'escaped');
});
