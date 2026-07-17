'use strict';
// catalogue/linters/lib.test.js - node:test suite for the shared catalogue-linter loader
// (catalogue/linters/lib.js). Run: node --test catalogue/linters/lib.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('./lib.js');

// ---------------------------------------------------------------------------------
// resolveJsonFiles / resolveManyJsonFiles
// ---------------------------------------------------------------------------------

test('resolveJsonFiles: expands a real "<dir>/*.json" glob to a sorted, deduplicated file list', () => {
  const files = lib.resolveJsonFiles(lib.DEFAULT_PACK_GLOB);
  assert.ok(Array.isArray(files));
  const sorted = [...files].sort();
  assert.deepEqual(files, sorted);
});

test('resolveJsonFiles: an absent directory/file resolves to an empty array, never a throw', () => {
  assert.deepEqual(lib.resolveJsonFiles('catalogue/does-not-exist-xyz'), []);
  assert.deepEqual(lib.resolveJsonFiles('catalogue/does-not-exist-xyz.json'), []);
});

test('resolveJsonFiles: throws on a ".." traversal segment rather than silently resolving outside the repo (SCAN path-traversal)', () => {
  assert.throws(() => lib.resolveJsonFiles('../../../etc'));
  assert.throws(() => lib.resolveJsonFiles('catalogue/../../etc/passwd'));
});

test('resolveManyJsonFiles: merges and de-duplicates several patterns into one sorted list', () => {
  const files = lib.resolveManyJsonFiles([lib.DEFAULT_PACK_GLOB, lib.DEFAULT_PACK_GLOB]);
  const unique = Array.from(new Set(files));
  assert.deepEqual(files, unique);
});

// ---------------------------------------------------------------------------------
// recordsFromFile / loadRecords: shape detection, and parse errors are RECORDED not thrown
// ---------------------------------------------------------------------------------

test('recordsFromFile: an invalid-JSON file yields a parseError, never a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-lib-test-'));
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ not valid json');
  try {
    const r = lib.recordsFromFile(file);
    assert.ok(typeof r.parseError === 'string');
    assert.ok(r.parseError.includes('invalid JSON'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordsFromFile: a fixture belonging to a different gate (neither COM record, legacy rule, nor a records[] wrapper) is recognised as zero entries, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-lib-test-'));
  const file = path.join(dir, 'other-gate.json');
  fs.writeFileSync(file, JSON.stringify({ some: 'unrelated shape' }));
  try {
    const r = lib.recordsFromFile(file);
    assert.deepEqual(r.entries, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRecords: an unreadable/unparseable file is reported in parseErrors, and never appears in entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-lib-test-'));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json');
  try {
    const { entries, parseErrors } = lib.loadRecords([dir]);
    assert.deepEqual(entries, []);
    assert.equal(parseErrors.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------
// parseErrorViolations (CR-7): a file a linter could not even read must fail its gate through the
// SAME violations channel a real content defect uses.
// ---------------------------------------------------------------------------------

test('parseErrorViolations: converts a "rel: reason" parseError string into a uniform violation carrying the file and the reason separately', () => {
  const v = lib.parseErrorViolations(['catalogue/packs/broken.json: invalid JSON: Unexpected token']);
  assert.equal(v.length, 1);
  assert.equal(v[0].file, 'catalogue/packs/broken.json');
  assert.equal(v[0].locator, 'catalogue/packs/broken.json');
  assert.equal(v[0].rule, 'linter-parse-error');
  assert.equal(v[0].message, 'invalid JSON: Unexpected token');
});

test('parseErrorViolations: a malformed parseError string with no "sep: reason" shape still degrades to a violation rather than throwing', () => {
  const v = lib.parseErrorViolations(['no separator here at all']);
  assert.equal(v.length, 1);
  assert.equal(v[0].file, 'no separator here at all');
});

test('parseErrorViolations: an empty/undefined list yields zero violations', () => {
  assert.deepEqual(lib.parseErrorViolations([]), []);
  assert.deepEqual(lib.parseErrorViolations(undefined), []);
});

test('parseErrorViolations output flows through makeToFindings as an error-severity finding (no `severity` field defaults to error)', () => {
  const toFindings = lib.makeToFindings('catalogue-test');
  const findings = toFindings(lib.parseErrorViolations(['x.json: read failed: EACCES']));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'error');
  assert.equal(findings[0].tool, 'catalogue-test');
});

// ---------------------------------------------------------------------------------
// hostMatchesAllowlist / urlHost
// ---------------------------------------------------------------------------------

test('hostMatchesAllowlist: matches an exact host and any subdomain of an allowlisted suffix, never a lookalike', () => {
  assert.equal(lib.hostMatchesAllowlist('ico.org.uk', ['ico.org.uk']), true);
  assert.equal(lib.hostMatchesAllowlist('www.ico.org.uk', ['ico.org.uk']), true);
  assert.equal(lib.hostMatchesAllowlist('evil-ico.org.uk', ['ico.org.uk']), false);
  assert.equal(lib.hostMatchesAllowlist('', ['ico.org.uk']), false);
});

test('urlHost: extracts a hostname from a valid URL and returns null for a malformed one, never throws', () => {
  assert.equal(lib.urlHost('https://www.legislation.gov.uk/x'), 'www.legislation.gov.uk');
  assert.equal(lib.urlHost('not a url'), null);
});

// ---------------------------------------------------------------------------------
// makeToFindings
// ---------------------------------------------------------------------------------

test('makeToFindings: a violation with severity "warning" maps to level "warning"; anything else maps to "error"', () => {
  const toFindings = lib.makeToFindings('catalogue-test');
  const findings = toFindings([
    { rule: 'r1', file: 'f1', id: 'ID1', locator: 'f1', message: 'm1', severity: 'warning' },
    { rule: 'r2', file: 'f2', id: 'ID2', locator: 'f2', message: 'm2' },
  ]);
  assert.equal(findings[0].level, 'warning');
  assert.equal(findings[1].level, 'error');
});
