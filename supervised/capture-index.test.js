'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { buildCaptureIndex, normaliseWhitespace, sha256Hex, evidenceIdFor, ArtifactStore } = require('./capture-index.js');

function bundleWithPages(pages) {
  return { domain: 'example.com', corpus: { pages } };
}

test('buildCaptureIndex hashes every page and the hash matches an independent sha256 of the normalised text', () => {
  const bundle = bundleWithPages([{ url: 'https://example.com/', text: 'Hello   World\n\nThis is a page.' }]);
  const store = buildCaptureIndex(bundle);
  const artifacts = store.list();
  assert.strictEqual(artifacts.length, 1);
  const expected = sha256Hex(Buffer.from(normaliseWhitespace('Hello   World\n\nThis is a page.'), 'utf8'));
  assert.strictEqual(artifacts[0].sha256, expected);
  assert.strictEqual(artifacts[0].evidence_id, evidenceIdFor('https://example.com/', 'static'));
});

test('extra pages beyond the first are ALL hashed, not just the first (spec: extra-page requests are allowed and must be hashed too)', () => {
  const bundle = bundleWithPages([
    { url: 'https://example.com/', text: 'home page text here' },
    { url: 'https://example.com/privacy', text: 'privacy page text here' },
    { url: 'https://example.com/contact', text: 'contact page text here' },
  ]);
  const store = buildCaptureIndex(bundle);
  assert.strictEqual(store.list().length, 3);
});

test('a page with no readable text is recorded as a typed LaneError, never a silent skip that looks like success', () => {
  const bundle = bundleWithPages([{ url: 'https://example.com/', text: '   \n  ' }]);
  const store = buildCaptureIndex(bundle);
  assert.strictEqual(store.list().length, 0);
  assert.strictEqual(store.errors.length, 1);
  assert.strictEqual(store.errors[0].reasonCode, 'empty_page');
  assert.strictEqual(store.errors[0].lane, 'capture');
});

test('a page with no url is recorded as a LaneError rather than hashed under a guessed key', () => {
  const bundle = bundleWithPages([{ text: 'orphan text with no url' }]);
  const store = buildCaptureIndex(bundle);
  assert.strictEqual(store.list().length, 0);
  assert.strictEqual(store.errors[0].reasonCode, 'malformed_page');
});

test('an unreachable crawl stage (per stageManifest) is recorded as a LaneError on the store', () => {
  const bundle = bundleWithPages([]);
  const stageManifest = [{ stage: 'crawl', ran: true, unreachable: true, reason: 'dns_failure' }];
  const store = buildCaptureIndex(bundle, { stageManifest });
  assert.ok(store.errors.some((e) => e.reasonCode === 'site_unreachable' && e.detail === 'dns_failure'));
});

test('a tampered artifact byte is detectable: the stored sha256 no longer matches recomputed bytes', () => {
  const bundle = bundleWithPages([{ url: 'https://example.com/', text: 'original untampered text' }]);
  const store = buildCaptureIndex(bundle);
  const artifact = store.list()[0];
  const tampered = Buffer.from(artifact.bytes); tampered[0] = tampered[0] ^ 0xff;
  assert.notStrictEqual(sha256Hex(tampered), artifact.sha256);
});

test('toJSON() never carries raw bytes (manifest hygiene: hash is the proof, not a second copy of the corpus)', () => {
  const bundle = bundleWithPages([{ url: 'https://example.com/', text: 'some real text content' }]);
  const store = buildCaptureIndex(bundle);
  const json = store.toJSON();
  assert.strictEqual(json.artifacts[0].bytes, undefined);
  assert.ok(json.artifacts[0].sha256.length === 64);
});

test('ArtifactStore.fromArtifactRecords rehydrates a store usable by get()', () => {
  const rec = { evidence_id: 'x', url: 'https://a/', lane: 'static', sha256: sha256Hex(Buffer.from('t')), length: 1, bytes: Buffer.from('t') };
  const store = ArtifactStore.fromArtifactRecords([rec]);
  assert.strictEqual(store.get('x'), rec);
  assert.strictEqual(store.get('missing'), null);
});

test('evidenceIdFor is deterministic across two independent computations of the same url/lane', () => {
  assert.strictEqual(evidenceIdFor('https://a.com/', 'static'), evidenceIdFor('https://a.com/', 'static'));
  assert.notStrictEqual(evidenceIdFor('https://a.com/', 'static'), evidenceIdFor('https://b.com/', 'static'));
});

test('sha256Hex matches node crypto directly (no silent second hash algorithm)', () => {
  const buf = Buffer.from('cross-check');
  assert.strictEqual(sha256Hex(buf), crypto.createHash('sha256').update(buf).digest('hex'));
});
