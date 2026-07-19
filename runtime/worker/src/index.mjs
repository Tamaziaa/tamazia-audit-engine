// runtime/worker/src/index.js - Tamazia audit intake Worker entry point (WS-Runtime, STAGED).
//
// Cloudflare Workers Modules format requires an ES `export default` entry point even though the
// rest of this runtime layer (and the engine repo generally) is plain CommonJS; the two helper
// modules below are CommonJS and are pulled in via `require`, which esbuild (wrangler's bundler,
// nodejs_compat enabled) supports. This file is the one permitted exception to "plain CommonJS"
// and only because the platform mandates it for the entry point - no logic beyond routing lives
// here.
//
// Role (Kimi blueprint section D): front door only. Accepts an audit request, validates it,
// enqueues a job onto the `audit-requests` Cloudflare Queue, and returns a job id immediately.
// It never runs the pipeline itself - Playwright, NLI, and the step functions all live on the VM.
// This Worker is not bound to the tamazia.co.uk route (see wrangler.toml); it is reachable only at
// its workers.dev preview URL until a founder-approved route change.

const { signJobId, verifyJobSignature } = require('./hmac.js');
const { verifyTurnstileToken } = require('./turnstile.js');

const JSON_HEADERS = { 'content-type': 'application/json' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function newJobId() {
  // crypto.randomUUID is available in the Workers runtime.
  return crypto.randomUUID();
}

// parseIntakePayload(request) -> { payload, error }. `error` is a ready-to-return 400 Response
// when the body is not valid JSON; `payload` is the parsed body otherwise (error is then null).
async function parseIntakePayload(request) {
  try {
    return { payload: await request.json(), error: null };
  } catch (err) {
    return { payload: null, error: jsonResponse({ error: 'invalid_json', detail: String(err) }, 400) };
  }
}

// isWellFormedUrl(url) -> true when `url` parses as an absolute URL, so a malformed value is
// rejected before it ever reaches a queue consumer or the browser lane on the VM.
function isWellFormedUrl(url) {
  try {
    new URL(url); // only whether this throws matters here
    return true;
  } catch {
    return false;
  }
}

// checkTurnstile(request, env, token) -> a 403 Response when Turnstile is configured and the
// token fails verification, else null (pass - including the "not configured yet" staging
// default: TURNSTILE_SECRET_KEY not yet provisioned in this environment, so the gate is a no-op
// rather than a hard failure, keeping the staged Worker testable by curl before the founder wires
// the Turnstile site key. Recorded here, not silently assumed: see DEPLOY-RUNBOOK.md "founder
// actions").
async function checkTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return null;
  }
  const remoteIp = request.headers.get('cf-connecting-ip') || undefined;
  const verdict = await verifyTurnstileToken(token, env.TURNSTILE_SECRET_KEY, remoteIp);
  if (verdict.success) {
    return null;
  }
  return jsonResponse({ error: 'turnstile_failed', reason: verdict.reason }, 403);
}

// buildIntakeJob(url) -> the queue payload for a newly accepted audit request.
function buildIntakeJob(url) {
  return {
    jobId: newJobId(),
    url,
    enqueuedAt: new Date().toISOString(),
    // Typed step-function contract placeholder (binds to WS0 payload v1.2 once that lands):
    // intake -> evidence -> facts -> applicability -> breach -> payload -> render -> mint.
    pipelineVersion: 'ws-runtime-v0',
  };
}

// intakeAcceptedBody(job, env) -> the 202 response body, including a signed status URL when a
// report-link HMAC secret is provisioned.
async function intakeAcceptedBody(job, env) {
  const sig = env.REPORT_HMAC_SECRET ? await signJobId(job.jobId, env.REPORT_HMAC_SECRET) : null;
  return {
    jobId: job.jobId,
    status: 'queued',
    statusUrl: sig ? `/status/${job.jobId}?sig=${sig}` : `/status/${job.jobId}`,
  };
}

async function handleIntake(request, env) {
  const { payload, error: parseError } = await parseIntakePayload(request);
  if (parseError) {
    return parseError;
  }

  const { url, turnstileToken } = payload || {};
  if (!url || typeof url !== 'string') {
    return jsonResponse({ error: 'missing_url' }, 400);
  }
  if (!isWellFormedUrl(url)) {
    return jsonResponse({ error: 'malformed_url' }, 400);
  }

  const turnstileFailure = await checkTurnstile(request, env, turnstileToken);
  if (turnstileFailure) {
    return turnstileFailure;
  }

  const job = buildIntakeJob(url);
  if (!env.AUDIT_QUEUE) {
    return jsonResponse({ error: 'queue_not_bound' }, 500);
  }
  await env.AUDIT_QUEUE.send(job);

  return jsonResponse(await intakeAcceptedBody(job, env), 202);
}

async function handleStatus(request, env, jobId) {
  const sig = new URL(request.url).searchParams.get('sig');
  if (env.REPORT_HMAC_SECRET) {
    const ok = await verifyJobSignature(jobId, sig, env.REPORT_HMAC_SECRET);
    if (!ok) {
      return jsonResponse({ error: 'bad_signature' }, 403);
    }
  }
  // Job status itself lives in Neon (pg-boss job table), which this Worker does not query
  // directly in the staged build - the VM step functions own that read path. Staged response is
  // an honest "not wired yet" rather than a fabricated status, per the engine's abstention-first
  // doctrine carried into the runtime layer.
  return jsonResponse({ jobId, status: 'unknown_staged_worker_does_not_query_neon_yet' }, 200);
}

async function handleHealthz(env) {
  return jsonResponse({
    ok: true,
    environment: env.ENVIRONMENT || 'unknown',
    queueBound: Boolean(env.AUDIT_QUEUE),
    bucketBound: Boolean(env.AUDITS_BUCKET),
  });
}

async function router(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/healthz') {
    return handleHealthz(env);
  }
  if (request.method === 'POST' && pathname === '/audit') {
    return handleIntake(request, env);
  }
  const statusMatch = pathname.match(/^\/status\/([a-f0-9-]+)$/);
  if (request.method === 'GET' && statusMatch) {
    return handleStatus(request, env, statusMatch[1]);
  }
  return jsonResponse({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, _ctx) {
    try {
      return await router(request, env);
    } catch (err) {
      // Every catch rethrows, records, or carries a written FAIL-OPEN justification (constitution
      // rule carried into the runtime). Here: an unexpected error must not leak a stack trace to
      // an untrusted caller, and must not silently succeed - it is recorded as a 500 with a
      // generic body. Cloudflare's own Worker logs (wrangler tail / Logpush) retain the detail.
      console.error('unhandled_worker_error', err);
      return jsonResponse({ error: 'internal_error' }, 500);
    }
  },
};
