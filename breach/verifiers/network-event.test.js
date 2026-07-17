'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyNetworkEvent } = require('./network-event');
const { CODES } = require('./result');

function bundleWith(observed, laneRan) {
  return { browser: { observed, consentControl: { found: false, healthy: null, url: null }, lane: { ran: laneRan !== false, reason: null } } };
}

const realEntry = {
  kind: 'tracker_request_pre_consent',
  name: 'www.google-analytics.com',
  host: 'www.google-analytics.com',
  essential: false,
  networkEvent: { host: 'www.google-analytics.com', url: 'https://www.google-analytics.com/collect', resourceType: 'xhr' },
  ts: 1000,
};

test('a network_event candidate matching an observed entry is verified', () => {
  const bundle = bundleWith([realEntry]);
  const r = verifyNetworkEvent({ type: 'network_event', kind: realEntry.kind, host: realEntry.host, name: realEntry.name }, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.NETWORK_EVENT_VERIFIED);
});

test('a matching candidate that also pins ts must match ts exactly', () => {
  const bundle = bundleWith([realEntry]);
  const ok = verifyNetworkEvent({ type: 'network_event', kind: realEntry.kind, host: realEntry.host, name: realEntry.name, ts: 1000 }, bundle);
  assert.equal(ok.verified, true);
  const wrongTs = verifyNetworkEvent({ type: 'network_event', kind: realEntry.kind, host: realEntry.host, name: realEntry.name, ts: 9999 }, bundle);
  assert.equal(wrongTs.verified, false);
  assert.equal(wrongTs.code, CODES.NETWORK_EVENT_NOT_FOUND);
});

test('fabricated network event REJECTED: a host/name never observed by the browser lane has no match', () => {
  const bundle = bundleWith([realEntry]);
  const r = verifyNetworkEvent({
    type: 'network_event',
    kind: 'tracker_request_pre_consent',
    host: 'connect.facebook-pixel.example',
    name: 'connect.facebook-pixel.example',
  }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.NETWORK_EVENT_NOT_FOUND);
});

test('a candidate citing the right host but the wrong kind is rejected (kind is part of the identity)', () => {
  const bundle = bundleWith([realEntry]);
  const r = verifyNetworkEvent({ type: 'network_event', kind: 'cookie_pre_consent', host: realEntry.host, name: realEntry.name }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.NETWORK_EVENT_NOT_FOUND);
});

test('missing fields (kind/host/name) are rejected before any bundle lookup', () => {
  const bundle = bundleWith([realEntry]);
  for (const bad of [{}, { kind: 'x' }, { kind: 'x', host: 'y' }, { kind: '', host: 'y', name: 'z' }]) {
    const r = verifyNetworkEvent(Object.assign({ type: 'network_event' }, bad), bundle);
    assert.equal(r.verified, false);
    assert.equal(r.code, CODES.NETWORK_EVENT_MISSING_FIELDS);
  }
});

test('a browser lane that never ran cannot back-fill a claim, even if observed happens to be non-empty', () => {
  const bundle = bundleWith([realEntry], false);
  const r = verifyNetworkEvent({ type: 'network_event', kind: realEntry.kind, host: realEntry.host, name: realEntry.name }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.NETWORK_EVENT_LANE_NOT_RUN);
});

test('an entirely absent bundle.browser is rejected as lane-not-run, never a crash', () => {
  const r = verifyNetworkEvent({ type: 'network_event', kind: 'x', host: 'y', name: 'z' }, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.NETWORK_EVENT_LANE_NOT_RUN);
});

test('a consent_control_broken entry (networkEvent:null) can still be matched on kind/host/name', () => {
  const broken = { kind: 'consent_control_broken', name: 'https://example.com/cookies', host: 'example.com', essential: null, networkEvent: null, ts: 5 };
  const bundle = bundleWith([broken]);
  const r = verifyNetworkEvent({ type: 'network_event', kind: broken.kind, host: broken.host, name: broken.name }, bundle);
  assert.equal(r.verified, true);
  assert.equal(r.code, CODES.NETWORK_EVENT_VERIFIED);
});
