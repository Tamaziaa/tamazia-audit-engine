'use strict';
// enforcement/store/store.js - THE one reader/writer for the committed EnforcementAction NDJSON
// store (Constitution Rule 1). Pure functions over an explicit path; no module-level state, no
// implicit default file handle held open across calls (tools/no-module-state discipline).
//
// The store is NDJSON (one JSON object per line) so it diffs cleanly in PRs and appends cheaply.
// Every row is validated against enforcement/store/schema.js on both read and write - a store file
// hand-edited into invalid JSON, or with a row missing a required field, is a load error, not a
// row silently dropped (Rule 4: fail closed).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { assertValidRow } = require('./schema');

const DEFAULT_STORE_PATH = path.join(__dirname, '..', 'data', 'enforcement-actions.ndjson');

// readStoreFile(storePath) -> string | null. null means "no file yet" (a legitimate empty store),
// any other read failure rethrows. Split out of loadStore so the only try/catch in the read path is
// this one, narrowly-scoped, ENOENT check (CodeScene Complex Method: keeps loadStore itself flat).
function readStoreFile(storePath) {
  try {
    return fs.readFileSync(storePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// parseStoreLine(line, index, storePath) -> EnforcementAction. Throws SyntaxError on unparseable
// JSON, TypeError (via assertValidRow) on a row that parses but fails the schema - both errors carry
// the 1-based line number so a hand-edited store file's exact bad line is immediately findable.
function parseStoreLine(line, index, storePath) {
  let row;
  try {
    row = JSON.parse(line);
  } catch (err) {
    throw new SyntaxError(`${storePath}:${index + 1}: invalid JSON (${err.message})`);
  }
  try {
    assertValidRow(row);
  } catch (err) {
    throw new TypeError(`${storePath}:${index + 1}: invalid EnforcementAction row (${err.message})`);
  }
  return row;
}

// loadStore(storePath = DEFAULT_STORE_PATH) -> EnforcementAction[]. Throws on a missing file, an
// unparseable line, or a row that fails assertValidRow - never returns a partial list silently.
function loadStore(storePath = DEFAULT_STORE_PATH) {
  const raw = readStoreFile(storePath);
  if (raw === null) return [];
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const rows = lines.map((line, index) => parseStoreLine(line, index, storePath));
  assertNoDuplicateIds(rows, storePath);
  return rows;
}

function assertNoDuplicateIds(rows, storePath) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`${storePath}: duplicate EnforcementAction.id "${row.id}"`);
    }
    seen.add(row.id);
  }
}

// appendRow(row, storePath = DEFAULT_STORE_PATH) -> void. Validates the row, validates it does not
// collide with an existing id, then appends one NDJSON line. Rewrites nothing else in the file, so
// a failed append never corrupts prior rows.
function appendRow(row, storePath = DEFAULT_STORE_PATH) {
  assertValidRow(row);
  const existing = loadStore(storePath);
  if (existing.some((r) => r.id === row.id)) {
    throw new Error(`EnforcementAction.id "${row.id}" already exists in ${storePath}`);
  }
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(storePath, line, 'utf8');
}

// writeStore(rows, storePath = DEFAULT_STORE_PATH) -> void. Validates every row THEN writes the
// whole file atomically (write to a temp path, rename over). Used by collector-expansion runs that
// merge freshly collected rows with the committed seed.
function writeStore(rows, storePath = DEFAULT_STORE_PATH) {
  if (!Array.isArray(rows)) throw new TypeError('writeStore requires an array of rows');
  for (const row of rows) assertValidRow(row);
  assertNoDuplicateIds(rows, storePath);
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  // CodeQL js/insecure-temporary-file: pid+timestamp alone is a guessable name (symlink-preplant
  // risk); add a crypto-random suffix AND open with the exclusive 'wx' flag so the write refuses to
  // follow a pre-existing path (attacker-planted or otherwise) instead of silently overwriting it.
  const tmpPath = `${storePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  fs.writeFileSync(tmpPath, body, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmpPath, storePath);
}

module.exports = { DEFAULT_STORE_PATH, loadStore, appendRow, writeStore };
