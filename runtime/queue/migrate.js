'use strict';
// runtime/queue/migrate.js - applies schema.sql idempotently against NEON_URL.
//
// NOT RUN in this session against the live NEON_URL (see README.md). Requires the `pg` client,
// which is not vendored in this staged build; installing it is part of the founder's VM bootstrap
// (runtime/vm/bootstrap.sh installs runtime/queue's package.json deps before first run).

const fs = require('node:fs');
const path = require('node:path');

async function migrate(connectionString) {
  if (!connectionString) {
    throw new Error('migrate() requires a connection string (set NEON_URL to a staging branch)');
  }
  // Lazy require so `node --test` in this repo (which has no `pg` installed) can still import this
  // file's exports for unit coverage of the SQL-loading logic without needing a live database.
  const { Client } = require('pg');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function readSchemaSql() {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

if (require.main === module) {
  migrate(process.env.NEON_URL).then(
    () => console.log('runtime/queue schema applied.'),
    (err) => {
      console.error(err.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { migrate, readSchemaSql };
