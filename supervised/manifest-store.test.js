'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ManifestStore, newRunId, safeRunId } = require('./manifest-store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mintgate-manifest-'));
}

test('append() writes one JSONL line per call and readAll() returns them in order', () => {
  const store = new ManifestStore({ baseDir: tmpDir() });
  store.append('run-1', 'stage_a', { x: 1 });
  store.append('run-1', 'stage_b', { y: 2 });
  const all = store.readAll('run-1');
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].stage, 'stage_a');
  assert.strictEqual(all[1].stage, 'stage_b');
  assert.ok(all[0].ts);
});

test('readAll() on a run with no manifest returns [] rather than throwing', () => {
  const store = new ManifestStore({ baseDir: tmpDir() });
  assert.deepStrictEqual(store.readAll('never-existed'), []);
});

test('the manifest file is genuinely append-only on disk: two appends produce two lines, never a rewrite', () => {
  const dir = tmpDir();
  const store = new ManifestStore({ baseDir: dir });
  store.append('run-x', 'a', {});
  store.append('run-x', 'b', {});
  const raw = fs.readFileSync(path.join(dir, 'run-x.jsonl'), 'utf8');
  assert.strictEqual(raw.trim().split('\n').length, 2);
});

test('entriesOfStage filters by stage name', () => {
  const store = new ManifestStore({ baseDir: tmpDir() });
  store.append('run-1', 'signature', { overall: 'HOLD' });
  store.append('run-1', 'signature', { overall: 'SIGN' });
  store.append('run-1', 'other', {});
  const sigs = store.entriesOfStage('run-1', 'signature');
  assert.strictEqual(sigs.length, 2);
  assert.strictEqual(sigs[1].overall, 'SIGN');
});

test('safeRunId rejects path-traversal / unsafe run ids (defence against a hostile run_id)', () => {
  assert.throws(() => safeRunId('../../etc/passwd'));
  assert.throws(() => safeRunId('run/with/slash'));
  assert.throws(() => safeRunId(''));
  assert.strictEqual(safeRunId('valid-run.1'), 'valid-run.1');
});

test('newRunId derives a stable-looking, sortable id from the site and a fixed clock', () => {
  const id = newRunId('https://example.com/', () => 1700000000000);
  assert.match(id, /^example-com-/);
});

test('exists() is false before any append and true after', () => {
  const store = new ManifestStore({ baseDir: tmpDir() });
  assert.strictEqual(store.exists('r'), false);
  store.append('r', 'a', {});
  assert.strictEqual(store.exists('r'), true);
});
