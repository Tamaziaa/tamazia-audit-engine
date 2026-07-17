'use strict';
// evidence/browser/oracle.test.js - node:test suite for the licence-clean tracker + cookie oracle.
// Run: node --test evidence/browser/oracle.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORACLE_META, TRACKER_HOSTS, isTrackerHost, classifyCookieName, classifyCookie, oracleMeta,
} = require('./oracle.js');

// ── isTrackerHost: parsed by label suffix, never a substring ──────────────────────────────────────

test('isTrackerHost: a known tracker registrable domain and its subdomains match', () => {
  assert.equal(isTrackerHost('google-analytics.com'), true);
  assert.equal(isTrackerHost('www.google-analytics.com'), true);
  assert.equal(isTrackerHost('region1.google-analytics.com'), true);
  assert.equal(isTrackerHost('connect.facebook.net'), true);
});

test('isTrackerHost: an exact tracker subdomain matches but the parent search domain does NOT (no over-flagging)', () => {
  assert.equal(isTrackerHost('bat.bing.com'), true);
  assert.equal(isTrackerHost('www.bing.com'), false, 'bing.com search traffic must not be flagged as tracking');
});

test('isTrackerHost: a non-tracker host and rubbish input are false (no substring leakage)', () => {
  assert.equal(isTrackerHost('example.com'), false);
  assert.equal(isTrackerHost('notgoogle-analytics.com.evil.example'), false);
  assert.equal(isTrackerHost(''), false);
  assert.equal(isTrackerHost(null), false);
  assert.equal(isTrackerHost(undefined), false);
});

test('isTrackerHost: a look-alike that merely CONTAINS a tracker domain as a substring is not matched', () => {
  // "google-analytics.com" appears as a substring of this host, but the registrable owner is
  // evil.example, so a substring matcher would wrongly flag it. The label-suffix walk does not.
  assert.equal(isTrackerHost('google-analytics.com.evil.example'), false);
});

// ── classifyCookieName: known non-essential vs essential vs unknown (abstain) ─────────────────────

test('classifyCookieName: well-known analytics/marketing cookies are non_essential with a platform', () => {
  assert.equal(classifyCookieName('_ga').verdict, 'non_essential');
  assert.equal(classifyCookieName('_ga_ABC123').verdict, 'non_essential');
  assert.equal(classifyCookieName('_gid').verdict, 'non_essential');
  assert.equal(classifyCookieName('_fbp').verdict, 'non_essential');
  assert.equal(classifyCookieName('_hjSessionUser_123').verdict, 'non_essential');
  assert.equal(classifyCookieName('_ga').platform, 'Google Analytics');
});

test('classifyCookieName: strictly-necessary cookies are essential (never a breach candidate)', () => {
  for (const n of ['PHPSESSID', 'JSESSIONID', 'csrftoken', 'XSRF-TOKEN', '__Host-session', '__Secure-x', '__cf_bm']) {
    assert.equal(classifyCookieName(n).verdict, 'essential', n + ' must be essential');
  }
});

test('classifyCookieName: the consent record itself is essential (reg.6(4) exempt), so it is never a breach', () => {
  assert.equal(classifyCookieName('OptanonConsent').verdict, 'essential');
  assert.equal(classifyCookieName('CookieConsent').verdict, 'essential');
});

test('classifyCookieName: an unrecognised cookie ABSTAINS (unknown), never assumed non-essential (Rule 6)', () => {
  assert.equal(classifyCookieName('bespoke_widget_state').verdict, 'unknown');
  assert.equal(classifyCookieName('').verdict, 'unknown');
  assert.equal(classifyCookieName(null).verdict, 'unknown');
});

// ── classifyCookie: name + domain-host combination ────────────────────────────────────────────────

test('classifyCookie: an unknown-named cookie on a known tracker HOST is promoted to non_essential', () => {
  const r = classifyCookie({ name: 'xyz', domain: '.doubleclick.net' });
  assert.equal(r.verdict, 'non_essential');
});

test('classifyCookie: an unknown-named cookie on a first-party host stays unknown (no over-claim)', () => {
  const r = classifyCookie({ name: 'xyz', domain: 'www.example.com' });
  assert.equal(r.verdict, 'unknown');
});

test('classifyCookie: an essential-named cookie stays essential even on a tracker host (essential wins)', () => {
  const r = classifyCookie({ name: 'PHPSESSID', domain: '.doubleclick.net' });
  assert.equal(r.verdict, 'essential');
});

// ── ORACLE_META: licence hygiene (C-043) ──────────────────────────────────────────────────────────

test('ORACLE_META: source names this module and the licence is a clean own-authored statement', () => {
  assert.match(ORACLE_META.source, /tamazia-authored/);
  assert.match(ORACLE_META.licence, /own-authored/);
  assert.equal(oracleMeta(), ORACLE_META);
});

test('ORACLE_META: no NonCommercial/AGPL/ShareAlike/known-NC-source token ships in the runtime provenance', () => {
  const banned = /noncommercial|cc[- ]by[- ]sa|share[- ]?alike|agpl|tracker\s*radar|ghostery|cookiedatabase|easyprivacy|easylist/i;
  for (const v of [ORACLE_META.source, ORACLE_META.licence, ORACLE_META.note]) {
    assert.equal(banned.test(v), false, 'banned licence/source token in provenance value: ' + v);
  }
});

test('ORACLE_META and the host set are frozen (single door, immutable data)', () => {
  assert.equal(Object.isFrozen(ORACLE_META), true);
  assert.equal(Object.isFrozen(TRACKER_HOSTS), true);
  assert.throws(() => { ORACLE_META.licence = 'tampered'; });
});
