'use strict';
// runtime/queue/create-branch.js - create an isolated Neon staging branch via the Neon API.
//
// NOT RUN in this session: NEON_API_KEY is blank in every env file on disk (see README.md). This
// script is staged, reviewed code, ready for the founder to run once the key is added. It never
// prints a secret and never touches production data - it only calls Neon's branch-creation API,
// which is documented as free and non-disruptive to the parent branch.
//
// Usage:
//   NEON_API_KEY=... NEON_PROJECT_ID=... node runtime/queue/create-branch.js [branch-name]

const BRANCH_NAME_DEFAULT = 'ws-runtime-staging';

async function listBranches(apiKey, projectId) {
  const resp = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}/branches`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Neon list-branches failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.branches || [];
}

async function createBranch(apiKey, projectId, branchName) {
  const resp = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}/branches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch: { name: branchName },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Neon create-branch failed: HTTP ${resp.status} ${text}`);
  }
  return resp.json();
}

async function main() {
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  const branchName = process.argv[2] || BRANCH_NAME_DEFAULT;

  if (!apiKey || !projectId) {
    // FAIL-CLOSED, not open: refuses to run rather than guessing a project id or falling back to
    // an unscoped call. Recorded via non-zero exit, not a silent no-op.
    console.error('NEON_API_KEY and NEON_PROJECT_ID must both be set. Aborting, nothing created.');
    process.exitCode = 1;
    return;
  }

  const existing = await listBranches(apiKey, projectId);
  const already = existing.find((b) => b.name === branchName);
  if (already) {
    console.log(`Branch "${branchName}" already exists (id ${already.id}). No action taken.`);
    return;
  }

  const created = await createBranch(apiKey, projectId, branchName);
  console.log(`Created branch "${branchName}" (id ${created.branch && created.branch.id}).`);
  console.log('Retrieve its connection string from the Neon console or the API response, then run:');
  console.log('  NEON_URL="<branch-connection-string>" node runtime/queue/migrate.js');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { listBranches, createBranch };
