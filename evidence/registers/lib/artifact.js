'use strict';
// evidence/registers/lib/artifact.js — THE hash-chained evidence artifact for a register call
// (register-establishment lane). Every request this directory makes against a real register HTTP
// endpoint is wrapped into one artifact record here: {request_url, redacted_headers, status,
// response_date, body_sha256, body_gzip_b64, canary, prev_hash, hash}. The chain is a simple
// content-addressed linked list (each artifact's `hash` folds in the PREVIOUS artifact's `hash`,
// genesis = '0'.repeat(64)) so a later party can prove NOTHING in the run's register evidence was
// re-ordered or swapped after the fact, without needing a second store — the same "hash over exact
// stored bytes" doctrine supervised/capture-index.js already applies to crawled page text (Rule 1:
// one canonicalisation rule, reused, not reinvented — see stableStringify there).
//
// Secrets never enter an artifact (Rule 16, this is a PUBLIC repo): redactHeaders() strips every
// Authorization / Ocp-Apim-Subscription-Key value before the record is built, so an artifact can be
// safely persisted, logged, or shipped in a PR diff (fixtures only — a real run's artifacts live in
// the run manifest directory, never in git).

const crypto = require('crypto');
const zlib = require('zlib');

const GENESIS_HASH = '0'.repeat(64);

// REDACT_HEADER_NAMES: header names whose VALUE is a credential and must never survive into an
// artifact. Matched case-insensitively; the header key itself (informative) is kept.
const REDACT_HEADER_NAMES = new Set(['authorization', 'ocp-apim-subscription-key']);

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// redactHeaders(headers) -> a shallow copy with every credential-bearing value replaced by
// 'REDACTED'; a header not in REDACT_HEADER_NAMES passes through unchanged (most register calls
// carry no other sensitive header, but this stays a denylist, not an allowlist, so an unexpected
// future header is not silently dropped from the audit trail it if turns out harmless).
function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = REDACT_HEADER_NAMES.has(String(k).toLowerCase()) ? 'REDACTED' : v;
  }
  return out;
}

// bodyBytesOf(value) -> a Buffer for whatever the register call returned as its parsed JSON body
// (or null). Canonicalised with sorted keys via JSON.stringify's replacer so the same logical body
// always hashes to the same bytes regardless of key order a given fetch transport happened to
// produce (mirrors capture-index.js's stableStringify doctrine, reimplemented small and dependency-
// free here rather than imported — this module must stay usable with no supervised/ dependency).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function bodyBytesOf(json) {
  return Buffer.from(json === undefined ? 'null' : stableStringify(json), 'utf8');
}

// buildArtifact({requestUrl, headers, status, responseHeaders, body, canary, prevHash}) -> the
// artifact record, hash-chained onto prevHash (defaults to GENESIS_HASH for the first call in a
// run). `responseHeaders.date` is trusted as the response time (Rule 15 doctrine: a register call
// carries no local clock read — the far side's own Date header is the only honest timestamp for
// "when this evidence was fetched", exactly as caution.md's trusted-time class requires).
function buildArtifact({ requestUrl, headers, status, responseHeaders, body, canary, prevHash }) {
  const bodyBytes = bodyBytesOf(body);
  const bodyGzip = zlib.gzipSync(bodyBytes);
  const record = {
    request_url: requestUrl,
    redacted_headers: redactHeaders(headers),
    status,
    response_date: (responseHeaders && responseHeaders.date) || null,
    body_sha256: sha256Hex(bodyBytes),
    body_gzip_b64: bodyGzip.toString('base64'),
    canary_result: canary || null,
    prev_hash: prevHash || GENESIS_HASH,
  };
  record.hash = sha256Hex(stableStringify(record));
  return record;
}

module.exports = { buildArtifact, redactHeaders, sha256Hex, stableStringify, GENESIS_HASH };
