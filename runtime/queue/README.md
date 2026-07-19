# runtime/queue - pg-boss job queue + typed step-function skeleton

Staged, not deployed. See ../../DEPLOY-RUNBOOK.md.

Per the Kimi blueprint (section D): orchestration is pg-boss (a Postgres-backed job queue) over
Neon, with explicit typed step functions rather than an agent framework or n8n. Each pipeline
stage is one job type with its own retry/backoff/timeout policy and a typed input/output shape
that will bind to WS0's payload v1.2 contracts once that work lands.

## Why this was not run against the live database

`NEON_API_KEY` is blank in both `/Users/amanigga/Desktop/TAMAZIA-REBUILD/COWORK-OS-EXECUTION/.env`
and `/Users/amanigga/Desktop/TAMAZIA-REBUILD/_audit-accuracy/.env.work` (confirmed: `wc -c` on the
value gives 0/1). Only `NEON_URL` is present, and it is a direct `psql` connection string, not a
project-level API credential - it cannot create a Neon branch, because branching is a Neon API
operation (`POST /projects/{id}/branches`), not a SQL operation. Running the pg-boss migration
below against the connection string in `NEON_URL` would very likely mean running it against the
live shared database that also holds `audit_*`, `compliance_*`, `leads`, and the agency pipeline
tables - directly contradicting the "staging Neon branch, never live" instruction. So this queue
schema was written and tested against a throwaway **local** Postgres-compatible target only (see
`migrate.test.js`), and was never pointed at `NEON_URL`.

**Founder action required:** obtain a Neon API key (console.neon.tech -> account settings ->
API keys) and add `NEON_API_KEY` to the env file. Once present, run:

```
node runtime/queue/create-branch.js         # calls Neon API, creates a "ws-runtime-staging" branch
NEON_URL="<branch-connection-string>" node runtime/queue/migrate.js
```

## Files

- `schema.sql` - pg-boss's own tables (created by the pg-boss library on first `boss.start()`,
  documented here for review) plus the engine-specific `runtime_jobs_audit` table that step
  functions write typed progress rows to (pg-boss's job table stores opaque JSON; this side table
  keeps a queryable, typed record of each pipeline stage for observability).
- `create-branch.js` - calls the Neon API (`POST /projects/{project_id}/branches`) to create an
  isolated `ws-runtime-staging` branch. Not run in this session (no `NEON_API_KEY`). Idempotent by
  branch name check.
- `boss.js` - pg-boss client factory. Zero runtime npm dependencies is the engine-wide rule; this
  is the one explicitly blueprint-mandated exception (`pg-boss` itself), scoped entirely to
  `runtime/queue/` and never imported by `facts/`, `breach/`, `applicability/`, or any other
  engine module.
- `steps/*.js` - one file per pipeline stage (intake, evidence, facts, applicability, breach,
  payload, render, mint). Each exports a typed job handler with an input/output shape comment
  block, a retry policy, and a hard per-step timeout. Bodies are placeholders (`NotImplemented`)
  until WS0's payload v1.2 contract lands; the shapes are the contract this workstream commits to.
- `migrate.js` - applies `schema.sql` idempotently (safe to re-run).
