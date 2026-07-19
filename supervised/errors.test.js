'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { LaneError, MintRefusalError, ReplayIncident, FindingConstructionError } = require('./errors.js');

test('LaneError carries lane/reasonCode/detail and a descriptive message', () => {
  const e = new LaneError('capture', 'empty_page', 'no text');
  assert.strictEqual(e.name, 'LaneError');
  assert.strictEqual(e.lane, 'capture');
  assert.strictEqual(e.reasonCode, 'empty_page');
  assert.match(e.message, /capture\/empty_page/);
  assert.ok(e instanceof Error);
});

test('MintRefusalError carries reasonCode/detail/meta', () => {
  const e = new MintRefusalError('no_signature', 'nope', { runId: 'r1' });
  assert.strictEqual(e.name, 'MintRefusalError');
  assert.strictEqual(e.meta.runId, 'r1');
  assert.ok(e instanceof Error);
});

test('ReplayIncident carries findingId/reasonCode/detail', () => {
  const e = new ReplayIncident('f1', 'hash_mismatch', 'bytes changed');
  assert.strictEqual(e.name, 'ReplayIncident');
  assert.strictEqual(e.findingId, 'f1');
  assert.ok(e instanceof Error);
});

test('FindingConstructionError carries field/detail', () => {
  const e = new FindingConstructionError('quote', 'missing');
  assert.strictEqual(e.name, 'FindingConstructionError');
  assert.strictEqual(e.field, 'quote');
  assert.ok(e instanceof Error);
});
