'use strict';
// runtime/observability/otel.js - OpenTelemetry wiring stub, staged.
//
// No OTEL_EXPORTER_OTLP_ENDPOINT is provisioned yet. Wired from day one per the blueprint ("OTel
// wiring from day one"), meaning the call sites and the initialisation contract exist now, not
// that a collector is deployed - there is no free-tier OTel collector in the current stack
// (Cloudflare/GitHub/Neon/R2/n8n/Oracle-Hetzner) and standing one up is a separate, later decision
// once traffic volume makes distributed tracing worth the operational cost (mirrors the
// Temporal-adoption threshold in the blueprint: falsifiable, not "someday").

let initialised = false;

function initOtel({ endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT, serviceName = 'tamazia-runtime' } = {}) {
  if (!endpoint) {
    console.warn('initOtel: no OTEL_EXPORTER_OTLP_ENDPOINT configured, tracing disabled');
    return { active: false, serviceName };
  }
  let sdkModule;
  try {
    sdkModule = require('@opentelemetry/sdk-node');
  } catch {
    console.warn('initOtel: OTEL endpoint is set but @opentelemetry/sdk-node is not installed in this image');
    return { active: false, serviceName };
  }
  if (!initialised) {
    // Real SDK bring-up (exporter construction, sdk.start()) is intentionally left for the follow-
    // up task that also stands up a collector; this stub proves the call site and the guard logic
    // now so no future PR has to invent the "is OTel configured" branching from scratch.
    initialised = true;
  }
  return { active: true, serviceName, sdkModule: Boolean(sdkModule) };
}

module.exports = { initOtel };
