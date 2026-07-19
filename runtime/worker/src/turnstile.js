'use strict';
// runtime/worker/src/turnstile.js - Cloudflare Turnstile server-side verification.
//
// Anti-abuse gate on the intake endpoint (POST /audit). No network calls happen anywhere else in
// this runtime layer at request time except this one, to Cloudflare's own siteverify endpoint -
// this is infrastructure abuse-prevention, not a facts-module network call, so the engine's
// "no network at runtime for facts modules" rule does not apply here (this file is never imported
// by facts/, breach/, or any pipeline module).

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstileToken(token, secretKey, remoteIp) {
  if (!token || !secretKey) {
    return { success: false, reason: 'missing_token_or_secret' };
  }
  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }
  let resp;
  try {
    resp = await fetch(SITEVERIFY_URL, { method: 'POST', body });
  } catch (err) {
    // FAIL-OPEN JUSTIFICATION: a network fault talking to Cloudflare's own siteverify service
    // (not the audited site, not a facts source) fails the request closed for the caller - we
    // return success:false so intake rejects the request rather than silently accepting an
    // unverified submission. The caller retries; no data is fabricated or lost.
    return { success: false, reason: 'siteverify_unreachable', error: String(err) };
  }
  if (!resp.ok) {
    return { success: false, reason: `siteverify_http_${resp.status}` };
  }
  const data = await resp.json();
  return { success: Boolean(data.success), reason: data.success ? null : (data['error-codes'] || []).join(',') };
}

module.exports = { verifyTurnstileToken };
