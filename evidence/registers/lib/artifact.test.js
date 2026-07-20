'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { buildArtifact, redactHeaders, GENESIS_HASH } = require('./artifact');

test('redactHeaders: Authorization and Ocp-Apim-Subscription-Key values are redacted, others pass through', () => {
  const out = redactHeaders({ Authorization: 'Basic secret==', 'Ocp-Apim-Subscription-Key': 'topsecret', Accept: 'application/json' });
  assert.equal(out.Authorization, 'REDACTED');
  assert.equal(out['Ocp-Apim-Subscription-Key'], 'REDACTED');
  assert.equal(out.Accept, 'application/json');
});

test('buildArtifact: carries the exact required fields and chains onto genesis by default', () => {
  const a = buildArtifact({
    requestUrl: 'https://api.company-information.service.gov.uk/company/00445790',
    headers: { Authorization: 'Basic abc==' },
    status: 200,
    responseHeaders: { date: 'Mon, 20 Jul 2026 10:00:00 GMT' },
    body: { company_number: '00445790', company_status: 'active' },
    canary: { ok: true, label: 'x' },
  });
  assert.equal(a.request_url, 'https://api.company-information.service.gov.uk/company/00445790');
  assert.equal(a.redacted_headers.Authorization, 'REDACTED');
  assert.equal(a.status, 200);
  assert.equal(a.response_date, 'Mon, 20 Jul 2026 10:00:00 GMT');
  assert.equal(typeof a.body_sha256, 'string');
  assert.equal(a.body_sha256.length, 64);
  assert.equal(typeof a.body_gzip_b64, 'string');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(Buffer.from(a.body_gzip_b64, 'base64')).toString('utf8')), { company_number: '00445790', company_status: 'active' });
  assert.deepEqual(a.canary_result, { ok: true, label: 'x' });
  assert.equal(a.prev_hash, GENESIS_HASH);
  assert.equal(typeof a.hash, 'string');
  assert.equal(a.hash.length, 64);
});

test('buildArtifact: chains onto the supplied prevHash, and two artifacts with different prevHash never collide', () => {
  const base = { requestUrl: 'u', headers: {}, status: 200, responseHeaders: {}, body: { a: 1 } };
  const a1 = buildArtifact(base);
  const a2 = buildArtifact(Object.assign({}, base, { prevHash: a1.hash }));
  assert.equal(a2.prev_hash, a1.hash);
  assert.notEqual(a1.hash, a2.hash);
});

test('buildArtifact: the SAME logical body hashes identically regardless of key order (stable canonicalisation)', () => {
  const a1 = buildArtifact({ requestUrl: 'u', headers: {}, status: 200, responseHeaders: {}, body: { a: 1, b: 2 } });
  const a2 = buildArtifact({ requestUrl: 'u', headers: {}, status: 200, responseHeaders: {}, body: { b: 2, a: 1 } });
  assert.equal(a1.body_sha256, a2.body_sha256);
});

test('buildArtifact: a null response body still produces a valid hashed artifact, never throws', () => {
  const a = buildArtifact({ requestUrl: 'u', headers: {}, status: 404, responseHeaders: {}, body: null });
  assert.equal(a.status, 404);
  assert.equal(typeof a.body_sha256, 'string');
});
