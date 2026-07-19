'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const citator = require('./citator-nightly.js');
const canary = require('./canary-audits.js');
const corpus = require('./corpus-replay.js');

for (const [name, mod] of [
  ['citator-nightly', citator],
  ['canary-audits', canary],
  ['corpus-replay', corpus],
]) {
  test(`${name}.run() resolves and marks its result staged:true (honest, not fabricated)`, async () => {
    const result = await mod.run();
    assert.equal(result.staged, true);
  });
}
