'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signJobId, verifyJobSignature } = require('./hmac.js');

test('signJobId produces a stable hex signature for the same jobId+secret', async () => {
  const sig1 = await signJobId('job-123', 'test-secret');
  const sig2 = await signJobId('job-123', 'test-secret');
  assert.equal(sig1, sig2);
  assert.match(sig1, /^[0-9a-f]{64}$/);
});

test('signJobId differs across jobIds', async () => {
  const sigA = await signJobId('job-a', 'test-secret');
  const sigB = await signJobId('job-b', 'test-secret');
  assert.notEqual(sigA, sigB);
});

test('verifyJobSignature accepts a genuine signature', async () => {
  const sig = await signJobId('job-real', 'shared-secret');
  const ok = await verifyJobSignature('job-real', sig, 'shared-secret');
  assert.equal(ok, true);
});

test('verifyJobSignature rejects a forged signature (known-bad fixture)', async () => {
  const forged = 'a'.repeat(64);
  const ok = await verifyJobSignature('job-real', forged, 'shared-secret');
  assert.equal(ok, false);
});

test('verifyJobSignature rejects a signature minted under a different secret', async () => {
  const sig = await signJobId('job-real', 'secret-one');
  const ok = await verifyJobSignature('job-real', sig, 'secret-two');
  assert.equal(ok, false);
});

test('verifyJobSignature rejects reuse against a different jobId', async () => {
  const sig = await signJobId('job-original', 'shared-secret');
  const ok = await verifyJobSignature('job-different', sig, 'shared-secret');
  assert.equal(ok, false);
});

test('signJobId throws on missing arguments (abstains rather than signing garbage)', async () => {
  await assert.rejects(() => signJobId('', 'secret'));
  await assert.rejects(() => signJobId('job-1', ''));
});

test('verifyJobSignature returns false (not throw) on missing arguments', async () => {
  assert.equal(await verifyJobSignature('', 'sig', 'secret'), false);
  assert.equal(await verifyJobSignature('job-1', '', 'secret'), false);
  assert.equal(await verifyJobSignature('job-1', 'sig', ''), false);
});
