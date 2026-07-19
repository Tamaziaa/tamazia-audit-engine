'use strict';
// runtime/worker/src/hmac.js - HMAC report-link signer/verifier for the Worker runtime.
//
// This is a runtime-layer utility, distinct from the engine's own mint/ HMAC usage (which signs
// persisted report URLs at mint time). Here it signs a short-lived job-status link so a submitter
// can poll `/status/<jobId>?sig=...` without authentication, while a forged or reused jobId+sig
// pair is rejected. One door: every route that needs a signature calls these two functions, never
// re-implements HMAC inline.
//
// Uses Web Crypto (available in the Workers runtime, no npm dependency).

async function importHmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signJobId(jobId, secret) {
  if (!jobId || !secret) {
    throw new Error('signJobId requires jobId and secret');
  }
  const key = await importHmacKey(secret);
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(jobId));
  return toHex(sig);
}

// hasVerifiableInputs(jobId, providedSigHex, secret) -> true only when all three are present, so
// verifyJobSignature's guard clause reads as one named check rather than a three-way OR.
function hasVerifiableInputs(jobId, providedSigHex, secret) {
  return Boolean(jobId) && Boolean(providedSigHex) && Boolean(secret);
}

// constantTimeEqualHex(a, b) -> true when two hex strings are identical, comparing every character
// regardless of an early mismatch so comparison time cannot leak how much of the signature was
// correct (the constant-time-compare doctrine for secret verification).
function constantTimeEqualHex(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyJobSignature(jobId, providedSigHex, secret) {
  if (!hasVerifiableInputs(jobId, providedSigHex, secret)) {
    return false;
  }
  const expected = await signJobId(jobId, secret);
  return constantTimeEqualHex(expected, providedSigHex);
}

module.exports = { signJobId, verifyJobSignature };
