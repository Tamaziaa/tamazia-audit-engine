'use strict';
// runtime/n8n/import-workflows.js - idempotent importer for the three WS-Runtime glue workflows.
//
// Requires N8N_URL and N8N_API_KEY in the environment (already on file in
// COWORK-OS-EXECUTION/.env, read into shell vars by the caller - never hardcoded here). Additive
// only: lists existing workflows first and skips any whose name already matches, so re-running
// this script is always safe.

const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_FILES = [
  'ws-runtime-law-change-alert.json',
  'ws-runtime-audit-complete.json',
  'ws-runtime-killswitch.json',
];

async function listExistingNames(n8nUrl, apiKey) {
  const resp = await fetch(`${n8nUrl.replace(/\/$/, '')}/api/v1/workflows?limit=250`, {
    headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`n8n list-workflows failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return new Set((data.data || []).map((w) => w.name));
}

async function createWorkflow(n8nUrl, apiKey, workflowJson) {
  const resp = await fetch(`${n8nUrl.replace(/\/$/, '')}/api/v1/workflows`, {
    method: 'POST',
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(workflowJson),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`n8n create-workflow "${workflowJson.name}" failed: HTTP ${resp.status} ${text}`);
  }
  return resp.json();
}

async function main() {
  const n8nUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!n8nUrl || !apiKey) {
    console.error('N8N_URL and N8N_API_KEY must both be set. Aborting, nothing imported.');
    process.exitCode = 1;
    return;
  }

  const existing = await listExistingNames(n8nUrl, apiKey);
  const results = [];

  for (const file of WORKFLOW_FILES) {
    const full = path.join(__dirname, file);
    const workflowJson = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (existing.has(workflowJson.name)) {
      console.log(`Skipping "${workflowJson.name}" - already exists.`);
      results.push({ name: workflowJson.name, action: 'skipped' });
      continue;
    }
    const created = await createWorkflow(n8nUrl, apiKey, workflowJson);
    console.log(`Created "${workflowJson.name}" (id ${created.id}), active: ${created.active}`);
    results.push({ name: workflowJson.name, action: 'created', id: created.id, active: created.active });
  }

  return results;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, listExistingNames, createWorkflow };
