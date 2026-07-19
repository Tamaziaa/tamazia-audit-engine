'use strict';
const test = require('node:test');
const assert = require('node:assert');
const version = require('./version.js');

test('ENGINE_VERSION is the frozen WS0 engine version (Rule 15: it rides the idempotency key)', () => {
  assert.strictEqual(version.ENGINE_VERSION, 'engine-v2.7.0-ws5');
  assert.strictEqual(typeof version.ENGINE_VERSION, 'string');
});

test('the export is frozen: a consumer cannot mutate the load-bearing version (Rule 1, one door)', () => {
  assert.ok(Object.isFrozen(version));
  // Known-bad: a consumer that tries to overwrite the version must NOT succeed (silent drift is the C-107
  // stale-version class). In strict mode the assignment throws; the value is unchanged either way.
  assert.throws(() => { version.ENGINE_VERSION = 'engine-vX'; });
  assert.strictEqual(version.ENGINE_VERSION, 'engine-v2.7.0-ws5');
});
