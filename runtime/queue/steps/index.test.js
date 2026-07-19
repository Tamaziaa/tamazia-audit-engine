'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const steps = require('./index.js');

test('STAGES lists all eight pipeline stages in pipeline order', () => {
  assert.deepEqual(steps.STAGES, [
    'intake', 'evidence', 'facts', 'applicability', 'breach', 'payload', 'render', 'mint',
  ]);
});

test('every stage in STAGES has a corresponding exported function', () => {
  for (const stage of steps.STAGES) {
    assert.equal(typeof steps[stage], 'function', `expected steps.${stage} to be a function`);
  }
});

test('each placeholder step rejects with NotImplementedError rather than silently succeeding', async () => {
  for (const stage of steps.STAGES) {
    await assert.rejects(
      () => steps[stage]({ jobId: 'x', url: 'https://example.com', pipelineVersion: 'test' }),
      steps.NotImplementedError,
    );
  }
});

test('NotImplementedError carries the stage name (known-bad fixture: never abstain silently)', async () => {
  try {
    await steps.mint({});
    assert.fail('expected mint() to throw');
  } catch (err) {
    assert.ok(err instanceof steps.NotImplementedError);
    assert.equal(err.stage, 'mint');
  }
});
