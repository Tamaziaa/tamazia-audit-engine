'use strict';
// applicability/conflicts.test.js - node:test suite for the C-073 family-dedupe door.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { familyKey, dedupeFamilies, familyCount } = require('./conflicts.js');

test('familyKey: normalises citation.act (trim, lower-case, collapse whitespace)', () => {
  assert.equal(familyKey({ citation: { act: '  Data  Protection   Act 2018 ' } }), 'data protection act 2018');
  assert.equal(
    familyKey({ citation: { act: 'PECR' } }),
    familyKey({ citation: { act: 'pecr' } }),
    'case-insensitive: two spellings of one act are one family',
  );
});

test('familyKey: falls back to record id when citation.act is absent, so a record never merges on an empty key', () => {
  assert.equal(familyKey({ id: 'REC_X' }), 'REC_X');
  assert.equal(familyKey({ id: 'REC_X', citation: {} }), 'REC_X');
  assert.equal(familyKey({ id: 'REC_X', citation: { act: '   ' } }), 'REC_X', 'a whitespace-only act is not a real act');
  assert.equal(familyKey({}), '', 'a record with neither act nor id degrades to the empty family key');
});

test('familyKey: distinct acts are distinct families', () => {
  assert.notEqual(
    familyKey({ citation: { act: 'Equality Act 2010' } }),
    familyKey({ citation: { act: 'Data Protection Act 2018' } }),
  );
});

test('dedupeFamilies: same-act records group into ONE family (the C-073 PECR/ICO-guidance class)', () => {
  // The exact C-073 disease: PECR and an "ICO Cookies Guidance" row both cite the one PECR statute.
  const records = [
    { id: 'PECR_REG6', citation: { act: 'Privacy and Electronic Communications Regulations 2003' } },
    { id: 'ICO_COOKIES', citation: { act: 'privacy and electronic communications regulations 2003' } },
    { id: 'DPA', citation: { act: 'Data Protection Act 2018' } },
  ];
  const families = dedupeFamilies(records);
  assert.equal(families.length, 2, 'two statutes, two families (PECR counted ONCE, not twice)');
  const pecr = families.find((f) => f.key.startsWith('privacy and electronic'));
  assert.deepEqual(pecr.records.map((r) => r.id), ['PECR_REG6', 'ICO_COOKIES'], 'both PECR rows share one family');
  assert.equal(familyCount(records), 2);
});

test('dedupeFamilies: NEVER drops a record - every input appears in exactly one group', () => {
  const records = [
    { id: 'A', citation: { act: 'Act One' } },
    { id: 'B', citation: { act: 'Act One' } },
    { id: 'C', citation: { act: 'Act Two' } },
    { id: 'D' }, // citation-less, falls back to its own id
  ];
  const families = dedupeFamilies(records);
  const total = families.reduce((n, f) => n + f.records.length, 0);
  assert.equal(total, records.length, 'no record is dropped by dedupe (families are for counting, not removal)');
  assert.equal(families.length, 3, 'Act One (x2), Act Two, and the id-keyed citation-less record');
});

test('dedupeFamilies: preserves first-seen key order and input order within a group', () => {
  const records = [
    { id: 'B1', citation: { act: 'Beta' } },
    { id: 'A1', citation: { act: 'Alpha' } },
    { id: 'B2', citation: { act: 'beta' } },
  ];
  const families = dedupeFamilies(records);
  assert.deepEqual(families.map((f) => f.key), ['beta', 'alpha'], 'first-seen key order');
  assert.deepEqual(families[0].records.map((r) => r.id), ['B1', 'B2'], 'input order within the beta family');
});

test('dedupeFamilies: tolerates a non-array / empty input without throwing', () => {
  assert.deepEqual(dedupeFamilies([]), []);
  assert.deepEqual(dedupeFamilies(null), []);
  assert.deepEqual(dedupeFamilies(undefined), []);
  assert.equal(familyCount(null), 0);
});

test('dedupeFamilies: does not mutate the input records', () => {
  const record = Object.freeze({ id: 'A', citation: Object.freeze({ act: 'Act One' }) });
  assert.doesNotThrow(() => dedupeFamilies([record]));
});
