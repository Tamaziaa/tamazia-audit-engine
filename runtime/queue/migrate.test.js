'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, readSchemaSql } = require('./migrate.js');

test('readSchemaSql loads schema.sql and it mentions the pgboss schema and the audit table', () => {
  const sql = readSchemaSql();
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS pgboss/);
  assert.match(sql, /runtime_jobs_audit/);
});

test('schema.sql never issues DDL against the protected shared tables (Neon additive-only rule)', () => {
  // Strip SQL line comments first: the header comments legitimately name the protected tables to
  // explain what this file does NOT touch, so a naive substring check on the raw file would
  // false-positive on its own documentation. Checking only the executable statements is the
  // correct assertion.
  const executable = readSchemaSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();
  for (const forbidden of ['audit_pages', 'compliance_', 'framework_', 'classifier_', 'pointer_', 'scanner_cache', 'leads']) {
    assert.ok(!executable.includes(forbidden), `schema.sql executable statements must not touch ${forbidden}`);
  }
});

test('migrate() abstains (fails closed) with no connection string, never defaults to production', async () => {
  await assert.rejects(() => migrate(), /requires a connection string/);
  await assert.rejects(() => migrate(''), /requires a connection string/);
});
