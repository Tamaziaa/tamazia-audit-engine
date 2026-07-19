-- runtime/queue/schema.sql - staged pg-boss + step-observability schema.
--
-- STAGED, NOT APPLIED. See README.md for why this has not been run against NEON_URL.
--
-- pg-boss manages its own tables inside a dedicated schema (default: "pgboss") the first time
-- `boss.start()` runs against a database - that DDL ships inside the pg-boss package itself and is
-- intentionally not hand-copied here (it changes across pg-boss versions; hand-copying it would
-- create a second source of truth, violating the one-door principle this repo enforces
-- everywhere else). This file only creates the schema namespace and the engine-specific
-- observability table that step functions write to.

CREATE SCHEMA IF NOT EXISTS pgboss;

-- runtime_jobs_audit: one typed row per pipeline-stage attempt. pg-boss's own job table stores an
-- opaque JSON payload and is designed for queue mechanics (visibility timeout, retry count), not
-- for typed per-stage inspection. This side table is additive-only (Neon shared-DB rule) and never
-- touches audit_*, compliance_*, framework_*, classifier_*, pointer_*, scanner_cache, or leads.
CREATE TABLE IF NOT EXISTS pgboss.runtime_jobs_audit (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL,
  stage TEXT NOT NULL CHECK (
    stage IN ('intake', 'evidence', 'facts', 'applicability', 'breach', 'payload', 'render', 'mint')
  ),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'retrying', 'abandoned')),
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_summary TEXT,
  engine_version TEXT,
  CONSTRAINT runtime_jobs_audit_attempt_positive CHECK (attempt >= 1)
);

CREATE INDEX IF NOT EXISTS runtime_jobs_audit_job_id_idx ON pgboss.runtime_jobs_audit (job_id);
CREATE INDEX IF NOT EXISTS runtime_jobs_audit_stage_status_idx
  ON pgboss.runtime_jobs_audit (stage, status);
