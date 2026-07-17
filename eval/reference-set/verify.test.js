'use strict';
// eval/reference-set/verify.test.js - marketing reach must never satisfy a BINDING jurisdiction.
//   node --test eval/reference-set/verify.test.js
//
// Constitution Rule 13: serving a market is not being bound by its law. The reference-set comparator
// must contradict an engine that binds a jurisdiction the set records only as served.

const test = require('node:test');
const assert = require('node:assert');

const { verifyPayload } = require('./verify');

function firm(expected) {
  return { domain: 'example.com', role: 'test', expected };
}

test('verify: a bound jurisdiction present only in jurisdictions_serves is a contradiction', () => {
  const payload = { meta: { domain: 'example.com' }, jurisdiction: { bound: ['US'] }, frameworks: [], findings: [] };
  const report = verifyPayload(payload, firm({ jurisdictions_bound: ['GB'], jurisdictions_serves: ['US'] }));
  assert.strictEqual(report.ok, false);
  assert.ok(report.contradictions.some((c) => c.check === 'jurisdictions_bound'));
});

test('verify: a bound jurisdiction inside jurisdictions_bound matches', () => {
  const payload = { meta: { domain: 'example.com' }, jurisdiction: { bound: ['GB'] }, frameworks: [], findings: [] };
  const report = verifyPayload(payload, firm({ jurisdictions_bound: ['GB'], jurisdictions_serves: ['US'] }));
  assert.strictEqual(report.ok, true);
  assert.ok(report.matches.some((m) => m.check === 'jurisdictions_bound'));
});

test('verify: abstaining on a verified bound jurisdiction is allowed, not a contradiction', () => {
  const payload = { meta: { domain: 'example.com' }, jurisdiction: { bound: [] }, frameworks: [], findings: [] };
  const report = verifyPayload(payload, firm({ jurisdictions_bound: ['GB'] }));
  assert.strictEqual(report.ok, true);
  assert.ok(report.abstentions.some((a) => a.check === 'jurisdictions_bound'));
});
