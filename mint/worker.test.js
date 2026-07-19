'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runWorker, mintOne, parseArgs } = require('./worker.js');

// a fake mint injected into the worker so node:test drives the batch loop with no network.
const fakeMint = (url) => Promise.resolve({ status: 'minted_pending_render', done: false, slug: url.replace(/\W+/g, '-'), hash: 'abc12345', refusal: null });

test('parseArgs reads urls from the argv and honours --deadline-ms (clamped, never absurd)', () => {
  const a = parseArgs(['node', 'worker.js', 'a.example', 'b.example', '--deadline-ms', '5000']);
  assert.deepStrictEqual(a.urls, ['a.example', 'b.example']);
  assert.strictEqual(a.deadlineMs, 5000);
  assert.strictEqual(parseArgs(['n', 'w', 'x', '--deadline-ms', '99999999']).deadlineMs, 600000, 'clamped to a sane ceiling');
});

test('parseArgs reads urls from a --file list, skipping blank and # comment lines', () => {
  // a private mkdtempSync directory, not a predictable os.tmpdir() filename (CodeQL
  // js/insecure-temporary-file: a fixed name is a symlink/race sink); mirrors the pattern
  // eval/e2e/lib/pipeline.js jobFilePath() uses.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-worker-test-'));
  const f = path.join(dir, 'urls.txt');
  fs.writeFileSync(f, 'a.example\n\n# a comment\nb.example\n');
  try {
    const a = parseArgs(['node', 'worker.js', '--file', f]);
    assert.deepStrictEqual(a.urls, ['a.example', 'b.example']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runWorker mints each url sequentially and writes ONE JSON line per url (never a payload, never a secret)', async () => {
  const lines = [];
  const results = await runWorker(['node', 'worker.js', 'a.example', 'b.example'], (s) => lines.push(s), fakeMint);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(lines.length, 2);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.url, 'a.example');
  assert.strictEqual(parsed.status, 'minted_pending_render');
  assert.strictEqual(parsed.done, false);
  assert.strictEqual('payload' in parsed, false, 'the line carries no payload');
});

test('an empty run is a no-op honestly reported, never an error', async () => {
  const lines = [];
  const results = await runWorker(['node', 'worker.js'], (s) => lines.push(s), fakeMint);
  assert.strictEqual(results.length, 0);
  assert.match(lines[0], /no urls supplied/);
});

test('KNOWN-BAD calibration: a mint that hangs past the per-mint deadline is a recorded timeout line, never a hung batch (Rule 9)', async () => {
  const hangs = () => new Promise(() => {}); // never resolves
  const line = await mintOne('slow.example', 30, hangs);
  assert.strictEqual(line.status, 'timeout');
  assert.strictEqual(line.done, false);
  assert.match(line.error, /deadline/);
});

test('KNOWN-BAD: a mint that THROWS is a recorded error line, never a crash of the batch (Rule 4)', async () => {
  const boom = () => Promise.reject(new Error('kaboom'));
  const line = await mintOne('bad.example', 1000, boom);
  assert.strictEqual(line.status, 'error');
  assert.match(line.error, /kaboom/);
});
