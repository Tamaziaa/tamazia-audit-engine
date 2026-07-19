'use strict';
// runtime/observability/healthchecks.js - Healthchecks.io cron liveness pings.
//
// Zero npm dependencies: a Healthchecks.io ping is a bare GET, no client library needed. Used by
// runtime/vm/cron/jobs/*.js to report start/success/fail for each scheduled job, so a silently
// stopped cron job (crond crashed, container OOM-killed) is caught by Healthchecks.io's own
// missed-ping alerting rather than going unnoticed.

async function pingHealthcheck(pingUrl, suffix = '') {
  if (!pingUrl) {
    // FAIL-OPEN JUSTIFICATION: liveness pinging is observability, not correctness - a cron job
    // must still run and do its work even before HEALTHCHECKS_PING_URL is provisioned (staged
    // build, no founder key yet). Recorded via console.warn, not silently ignored.
    console.warn('pingHealthcheck: no pingUrl configured, skipping ping', { suffix });
    return { skipped: true };
  }
  const target = suffix ? `${pingUrl}/${suffix}` : pingUrl;
  try {
    const resp = await fetch(target, { method: 'GET' });
    return { skipped: false, ok: resp.ok, status: resp.status };
  } catch (err) {
    // Recorded, not swallowed: a failed ping must not crash the cron job it is reporting on, but
    // it is logged so a human can see the observability channel itself is degraded.
    console.error('pingHealthcheck: ping failed', { target, error: String(err) });
    return { skipped: false, ok: false, error: String(err) };
  }
}

async function withHealthcheck(pingUrl, fn) {
  await pingHealthcheck(pingUrl, 'start');
  try {
    const result = await fn();
    await pingHealthcheck(pingUrl);
    return result;
  } catch (err) {
    await pingHealthcheck(pingUrl, 'fail');
    throw err;
  }
}

module.exports = { pingHealthcheck, withHealthcheck };
