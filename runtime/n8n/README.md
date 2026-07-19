# runtime/n8n - operational glue workflows (notification/ops layer, NOT the pipeline)

Per the Kimi blueprint (section D): "Not n8n... your pipeline is typed contracts and pure
functions; n8n is untyped node-graph automation". n8n's role here is deliberately narrow: three
operational glue workflows that receive a webhook call from the VM/Worker runtime and fan it out
to a human channel. It never touches evidence, facts, applicability, breach, payload, render, or
mint - none of the typed pipeline state passes through an n8n node graph.

## Workflows (imported into the existing Pikapods instance via the n8n API)

1. **`ws-runtime-law-change-alert`** - webhook `POST /webhook/ws-runtime-law-change` receives a
   72-hour law-change alert payload `{ title, summary, sourceUrl, jurisdiction, severity }` from
   the citator cron job and fans it out (this staged build wires the webhook trigger + a
   passthrough "no destination configured yet" no-op node; wiring the real
   email/WhatsApp/Slack destination nodes is a founder credential task - the workflow's structure
   is ready for founder to drop a credential into the destination node the next time they open the
   n8n editor).
2. **`ws-runtime-audit-complete`** - webhook `POST /webhook/ws-runtime-audit-complete` receives
   `{ jobId, url, status, reportUrl }` from the mint step function when an audit finishes, for a
   completion notification.
3. **`ws-runtime-killswitch`** - webhook `POST /webhook/ws-runtime-killswitch` receives
   `{ reason, actor }` and is meant to flip a kill flag the VM workers poll (e.g. a Neon
   `engine_flags` row, or - in the staged build - an n8n-side static-data flag surfaced via a
   second read-only webhook `GET /webhook/ws-runtime-killswitch-status`). This is a manual,
   human-triggered stop, not an automated one.

## Import mechanics

`import-workflows.js` reads the three JSON files in this directory and POSTs each to
`POST {N8N_URL}/api/v1/workflows` using `N8N_API_KEY`. It is idempotent: it first lists existing
workflows and skips (does not duplicate) any whose `name` already matches.

Workflows are created **inactive** (`active: false` is the n8n default on creation via API for
workflows containing a webhook trigger - n8n requires an explicit activation call). Activation is
listed as a founder action in ../../DEPLOY-RUNBOOK.md so a webhook is never live before the founder
has seen and approved its destination wiring.
