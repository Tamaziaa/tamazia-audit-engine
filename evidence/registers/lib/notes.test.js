'use strict';
// evidence/registers/lib/notes.test.js: makeNote() had no dedicated test before this file
// (docs/P3-RETROSPECTIVE.md punch-list item #8). Small module, small suite: the shape it returns,
// the optional best-effort log() side channel, and that a throwing log() never breaks the caller.
const test = require('node:test');
const assert = require('node:assert/strict');

const { makeNote } = require('./notes');

test('makeNote: returns the shared {register, kind, reason, detail} shape', () => {
  const note = makeNote({ register: 'cqc', kind: 'degraded', reason: 'missing_key', detail: 'no key configured' });
  assert.deepEqual(note, { register: 'cqc', kind: 'degraded', reason: 'missing_key', detail: 'no key configured' });
});

test('makeNote: a null/omitted detail normalises to null, never undefined', () => {
  const note = makeNote({ register: 'fca', kind: 'skipped', reason: 'sector_not_applicable' });
  assert.equal(note.detail, null);
});

test('makeNote: an optional log() function is invoked with the note plus a level and source', () => {
  const seen = [];
  const note = makeNote({ register: 'gleif', kind: 'no_match', reason: 'no_candidates_returned', detail: 'x', log: (entry) => seen.push(entry) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].level, 'warn');
  assert.equal(seen[0].source, 'evidence/registers');
  assert.equal(seen[0].register, 'gleif');
  assert.equal(seen[0].reason, 'no_candidates_returned');
  assert.deepEqual(note, { register: 'gleif', kind: 'no_match', reason: 'no_candidates_returned', detail: 'x' });
});

test('makeNote: a throwing log() is swallowed (FAIL-OPEN, documented in the module) and the note is still returned intact', () => {
  const note = makeNote({
    register: 'sra',
    kind: 'degraded',
    reason: 'timeout',
    detail: 'no response within the call deadline',
    log: () => { throw new Error('logger exploded'); },
  });
  assert.deepEqual(note, { register: 'sra', kind: 'degraded', reason: 'timeout', detail: 'no response within the call deadline' });
});

test('makeNote: a non-function log is ignored, not called, not thrown on', () => {
  assert.doesNotThrow(() => {
    const note = makeNote({ register: 'ico', kind: 'degraded', reason: 'missing_endpoint', detail: null, log: 'not-a-function' });
    assert.equal(note.register, 'ico');
  });
});
