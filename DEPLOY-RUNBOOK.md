# DEPLOY-RUNBOOK.md - WS-Runtime: Cloudflare + VM + pg-boss + n8n runtime

Staged infrastructure for the Kimi blueprint's runtime/orchestration/platform layer (section D).
Written 2026-07-19/20. No secret values appear in this file. Read alongside `runtime/*/README.md`
for per-component detail.

## What is genuinely live right now (staged, not production-cut)

| Component | State | Where |
|---|---|---|
| Cloudflare Worker (intake API) | **Deployed and responding** | `https://tamazia-audit-intake-staging.amanpareek-pareek.workers.dev` |
| Cloudflare Queue `audit-requests-staging` | **Created** (empty, bound to the Worker) | Cloudflare account `04b8...` (see `wrangler.toml`) |
| R2 binding | **Wired** to the existing `tamazia-audits` bucket, under key prefix `staging/` | same bucket the live mint pipeline already uses - no new bucket created |
| pg-boss schema + step-function skeleton | **Code staged, not migrated anywhere** | `runtime/queue/` |
| Neon staging branch | **Not created** - see "Founder actions" | - |
| Docker compose VM stack | **Code staged, config-validated, not deployed to any host** | `runtime/vm/` |
| n8n glue workflows | **Written, not imported** (API key invalid) - see "Founder actions" | `runtime/n8n/*.json` |
| GitHub Actions | **Unchanged** - already CI-only, verified, no deploy/production step added | `.github/workflows/*.yml` |
| tamazia.co.uk production route/DNS/Pages deploy | **Untouched** | confirmed below |

## Proof commands (run these to verify the claims above)

```
# (a) Worker deploys to a preview and returns a job id
curl -s https://tamazia-audit-intake-staging.amanpareek-pareek.workers.dev/healthz
curl -s -X POST https://tamazia-audit-intake-staging.amanpareek-pareek.workers.dev/audit \
  -H "Content-Type: application/json" -d '{"url":"https://example.com"}'
# -> {"jobId":"...","status":"queued","statusUrl":"/status/..."}

# malformed input is rejected, not silently accepted
curl -s -X POST https://tamazia-audit-intake-staging.amanpareek-pareek.workers.dev/audit \
  -H "Content-Type: application/json" -d '{"url":"not-a-url"}'
# -> {"error":"malformed_url"}

# (b) Neon staging branch + pg-boss migration - NOT run in this session; see "Founder actions".
#     Once NEON_API_KEY is set:
node runtime/queue/create-branch.js
NEON_URL="<branch-connection-string>" node runtime/queue/migrate.js

# (c) n8n test workflow fires - blocked on a valid N8N_API_KEY; see "Founder actions". Once fixed:
N8N_URL=... N8N_API_KEY=... node runtime/n8n/import-workflows.js
curl -s -X POST "$N8N_URL/webhook/ws-runtime-audit-complete" \
  -H "Content-Type: application/json" -d '{"jobId":"test","url":"https://example.com","status":"complete"}'

# (d) docker compose config validates - docker is not installed on this build machine, so this was
#     verified as far as possible without it: the YAML parses and all anchors (`x-worker-env`)
#     resolve correctly under a plain YAML parser (checked with Python's PyYAML, see below). Full
#     schema validation against the Compose spec still needs a real `docker compose config` run,
#     which is listed as a founder/VM-side check once the VM exists.
python3 -c "import yaml; d = yaml.safe_load(open('runtime/vm/docker-compose.yml')); print(list(d['services'].keys()))"
# -> ['worker', 'browser', 'nli', 'cron', 'caddy']
# On the VM itself, after bootstrap.sh:
cd runtime/vm && docker compose config
```

## Confirmation: nothing on live tamazia.co.uk was touched

- No DNS record was read, created, or modified (no Cloudflare DNS API call was made this session).
- No Cloudflare Pages project, deployment, or route was touched.
- `wrangler.toml` in `runtime/worker/` deliberately has **no `routes` key** - the Worker is only
  reachable at its `workers.dev` subdomain. Binding it onto the production zone is a distinct,
  future, founder-approved change, not something this session did or could silently do.
- The only Cloudflare account-level object created was the queue `audit-requests-staging`
  (namespaced, inert, and additive - creating a queue cannot affect any existing route or
  deployment) and the Worker script `tamazia-audit-intake-staging` (a new script name, does not
  overwrite `tamazia-admin`, `tamazia-audit`, or `tamazia-reply-handler`, the three scripts already
  in the account).
- No Neon DDL was run anywhere (see below - blocked on a missing API key, and the fallback of
  running it against the live `NEON_URL` was explicitly rejected as unsafe).
- No file under `mint/`, `applicability/`, `breach/`, `facts/`, `payload/`, or `catalogue/` was
  modified. This workstream added one new top-level directory, `runtime/`, and this runbook.

## Architecture recap (why it is built this way)

Per `KIMI-K3-DEEP-BLUEPRINT-2026-07-20.md` section D: Claude Code is the builder, never the
runtime (constitution-level rule R23: "the builder never executes production"). Cloudflare is the
front door only (Worker intake, HMAC report links, Turnstile, Queues, R2 - no Playwright, no
pipeline logic). The pipeline itself (warm browser pool, NLI sidecar, step functions, cron) runs
on one VM via docker compose, orchestrated by pg-boss (a Postgres-backed job queue) over a Neon
branch, with typed step functions rather than an agent framework. n8n is explicitly **not** the
pipeline - it is the operational glue/notification layer only (72-hour law-change alerts,
audit-complete pings, a human-triggered killswitch), because n8n's untyped node-graph automation
is the wrong abstraction for the engine's typed payload contracts. GitHub Actions stays CI-only:
compile gates, corpus replay, nightly holdout, citator PRs - never production serving.

## Founder actions required (the turn-key gaps this session could not close)

These are the only gaps. Everything else in this PR is turn-key: code, tested, and - where safe to
prove without a live VM or valid credentials - already deployed and curled.

### 1. Provision the worker VM and hand over SSH (the one infrastructural action)

No Hetzner key is on file, and the old Oracle VM (150.230.118.117) most likely lost its SSH key.
Provision **one** of:
- Hetzner CX32 (~€8/month), or
- a fresh Oracle Always-Free ARM instance.

Then:
1. Give this session (or the next Claude Code session) SSH access (a key added to
   `~/.ssh/authorized_keys`, or a Tailscale auth key for `tailscale up`).
2. Run `sudo bash runtime/vm/bootstrap.sh` on the box. It installs Docker, Tailscale, UFW,
   fail2ban, then stops on first run after writing `runtime/vm/.env` from
   `runtime/vm/.env.example` so no service starts against placeholder secrets.
3. Fill in `runtime/vm/.env` with the real `NEON_URL` (or, better, the staging branch URL from
   action 2 below), R2 credentials, and the observability endpoints once they exist.
4. Re-run `bootstrap.sh` (or `docker compose up -d` directly) to bring the stack up.

### 2. Add `NEON_API_KEY` so a real Neon staging branch can be created

`NEON_API_KEY` is blank in both `COWORK-OS-EXECUTION/.env` and `_audit-accuracy/.env.work`
(confirmed: value length 0). Only `NEON_URL` (a direct connection string, not an API credential)
is present, and it appears to point at the live shared database. Branching requires the Neon API
(`POST /projects/{id}/branches`), which needs `NEON_API_KEY`. Without it, this session could not
create an isolated branch, and correctly refused to run the pg-boss migration against `NEON_URL`
instead (that would very likely have written schema into the live production database that also
holds `audit_*`, `compliance_*`, `leads`, and the agency pipeline tables).

Once a key is added (console.neon.tech -> account settings -> API keys):
```
NEON_API_KEY=... NEON_PROJECT_ID=... node runtime/queue/create-branch.js
NEON_URL="<branch-connection-string>" node runtime/queue/migrate.js
```

### 3. Regenerate `N8N_API_KEY`

The Pikapods n8n instance itself is healthy (`https://modest-magpie.pikapod.net/healthz` returns
`{"status":"ok"}`), but every authenticated API call with the key on file returns
`401 {"message":"unauthorized"}`. The key is present (289 characters) but does not authenticate -
most likely expired or rotated on the n8n side. Regenerate it in n8n (Settings -> API), update
`N8N_API_KEY` in the env file, then run:
```
node runtime/n8n/import-workflows.js
```
This creates the three workflows (idempotent - skips any that already exist by name) in an
**inactive** state; activating them (turning the webhooks live) is a separate, deliberate step the
founder should take after reviewing the destination nodes (see `runtime/n8n/README.md` - the
email/WhatsApp/Slack destination nodes are placeholders pending credentials).

### 4. Paid-fallback LLM key (if not already covered elsewhere)

The blueprint's LLM roles (Gemini Flash extraction, free-tier jury, local NLI) are a separate
workstream's concern, not this one's - flagged here only because the runtime layer's
`runtime/vm/nli/` sidecar is currently a lexical-overlap stand-in (see its README), not a real
ONNX DeBERTa model, and vendoring a real model plus any paid-fallback LLM key is out of scope for
infrastructure-as-code. No action needed from this PR; noting it so it is not lost.

### 5. Live-route cutover (when the engine is ready - not now)

When the engine reaches the day-15 verified-mint gate, binding the Worker onto the production zone
(`routes = [...]` in `wrangler.toml`) is a founder-approved, reviewed change - not something to
merge as part of this staging PR.

## Directory map

```
runtime/
  worker/            Cloudflare Worker: intake API, HMAC report links, Turnstile gate, Queue producer
    wrangler.toml
    src/index.js, hmac.js, turnstile.js (+ *.test.js)
  queue/             pg-boss schema + typed step-function skeleton (STAGED, not migrated anywhere)
    schema.sql, create-branch.js, boss.js, migrate.js, steps/index.js (+ *.test.js)
  vm/                docker compose stack for the one worker VM
    docker-compose.yml, bootstrap.sh, .env.example
    worker/Dockerfile, browser/{Dockerfile,server.js}, nli/{Dockerfile,server.js,README.md},
    cron/{Dockerfile,crontab,jobs/*.js}, caddy/Caddyfile
  n8n/               operational glue workflows (NOT the pipeline)
    README.md, import-workflows.js, ws-runtime-*.json
  observability/     pino logger, Sentry hook, Healthchecks.io pings, OTel wiring stub
    logger.js, sentry.js, otel.js, healthchecks.js (+ *.test.js)
```
