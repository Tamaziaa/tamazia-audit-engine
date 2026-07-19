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

// CodeRabbit review (PR #36): a repeated URL/lane pair must never silently overwrite an already-captured
// artifact's bytes/hash/provenance in the ArtifactStore's Map (keyed by evidence_id) - the SECOND capture
// is refused with a typed error, the FIRST one's bytes are kept.
test('KNOWN-BAD CALIBRATION FIXTURE: a duplicate URL/lane capture is refused, never silently overwrites the first', () => {
  const bundle = bundleWithPages([
    { url: 'https://example.com/', text: 'the FIRST capture of this page' },
    { url: 'https://example.com/', text: 'a SECOND, different capture of the same url' },
  ]);
  const store = buildCaptureIndex(bundle);
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.list()[0].bytes.toString('utf8'), normaliseWhitespace('the FIRST capture of this page'));
  assert.ok(store.errors.some((e) => e.reasonCode === 'duplicate_evidence_id'));
});

// CodeRabbit review (PR #36): capture-index.js's own header now documents MAX_PAGES/MAX_TOTAL_BYTES as an
// outer safety ceiling (Rule 8: budgets are caps, never floors) - hitting either FAILS CLOSED (a typed
// error, capture stops) rather than silently hashing an unbounded corpus.
test('KNOWN-BAD CALIBRATION FIXTURE: exceeding MAX_PAGES stops the capture with a typed budget error, not a silent unbounded loop', () => {
  const pages = [];
  for (let i = 0; i < 205; i += 1) pages.push({ url: 'https://example.com/p' + i, text: 'page number ' + i + ' has some real readable text' });
  const store = buildCaptureIndex(bundleWithPages(pages));
  assert.ok(store.list().length <= 200);
  assert.ok(store.errors.some((e) => e.reasonCode === 'page_budget_exceeded'));
});

// ── raw-vs-normalised durability (Kimi K3 HIGH-E2) ─────────────────────────────────────────────────────

test('a page with no rawHtml captures exactly as before, honestly flagged rawAvailable:false (no fabricated raw commitment)', () => {
  const store = buildCaptureIndex(bundleWithPages([{ url: 'https://example.com/', text: 'plain text only, no raw HTML supplied' }]));
  const artifact = store.list()[0];
  assert.strictEqual(artifact.rawAvailable, false);
  assert.strictEqual(artifact.rawBytes, null);
  assert.strictEqual(artifact.rawSha256, null);
  assert.deepStrictEqual(artifact.boundaries, []);
});

test('a page WITH rawHtml gets a second, independent raw-bytes commitment, and the raw digest matches an independent sha256', () => {
  const rawHtml = '<html><body><p>We use cookies before you consent to them.</p></body></html>';
  const store = buildCaptureIndex(bundleWithPages([
    { url: 'https://example.com/privacy', text: 'We use cookies before you consent to them.', rawHtml },
  ]));
  const artifact = store.list()[0];
  assert.strictEqual(artifact.rawAvailable, true);
  assert.ok(Buffer.isBuffer(artifact.rawBytes));
  assert.strictEqual(artifact.rawSha256, sha256Hex(Buffer.from(rawHtml, 'utf8')));
  assert.strictEqual(artifact.rawBytes.toString('utf8'), rawHtml);
});

// THE phantom-join proof (HIGH-E2 test (b)): two raw sibling text nodes with NO punctuation between them
// ("Free" and "VPS", each its own <span> pill) produce a normalised sentence ("Free VPS") that never
// existed as a single rendered run - the boundary map must record that join as unpunctuated so a consumer
// (verify-quote.js's verifyRawProvenance) can refuse/flag a span crossing it.
test('a phantom join (two raw text nodes with no source punctuation between them) is detectable in the boundary map', () => {
  const rawHtml = '<div><span>Free</span><span>VPS</span></div>';
  const store = buildCaptureIndex(bundleWithPages([{ url: 'https://example.com/pricing', text: 'Free VPS', rawHtml }]));
  const artifact = store.list()[0];
  assert.strictEqual(artifact.rawAvailable, true);
  assert.ok(artifact.boundaries.length >= 1, 'expected at least one boundary between the two raw runs');
  const phantom = artifact.boundaries.find((b) => !b.punctuated);
  assert.ok(phantom, 'the Free/VPS join must be recorded as an UNPUNCTUATED boundary');
});

// THE positive control: a genuine single-source sentence split only by an INLINE mid-sentence tag (e.g. a
// bold span) but with real punctuation still present in the text on either side of any real break must NOT
// be over-flagged when the runs themselves already carry sentence structure.
test('a real sentence spanning a punctuated join is NOT flagged as a phantom join', () => {
  const rawHtml = '<p>We use cookies before you consent to them, which some visitors will find intrusive.</p><p>Read our policy.</p>';
  const text = 'We use cookies before you consent to them, which some visitors will find intrusive. Read our policy.';
  const store = buildCaptureIndex(bundleWithPages([{ url: 'https://example.com/privacy', text, rawHtml }]));
  const artifact = store.list()[0];
  const boundary = artifact.boundaries[0];
  assert.ok(boundary, 'expected a boundary between the two <p> runs');
  assert.strictEqual(boundary.punctuated, true, 'a sentence ending in "." before the join must be recognised as punctuated');
});

test('KNOWN-BAD CALIBRATION FIXTURE: a raw page over the per-page raw byte ceiling captures normalised text but drops the raw commitment (fail closed, never an unbounded raw buffer)', () => {
  const hugeRawHtml = '<p>' + 'x'.repeat(5 * 1024 * 1024) + ' real readable text</p>';
  const store = buildCaptureIndex(bundleWithPages([{ url: 'https://example.com/huge', text: 'x'.repeat(20) + ' real readable text', rawHtml: hugeRawHtml }]));
  const artifact = store.list()[0];
  assert.strictEqual(artifact.rawAvailable, false);
  assert.strictEqual(artifact.rawBytes, null);
});
