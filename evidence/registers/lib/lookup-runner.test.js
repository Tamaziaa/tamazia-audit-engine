'use strict';
// evidence/registers/lib/lookup-runner.test.js: the shared execution flow every register module
// calls through (guard -> key check -> deadline fetch -> C-004 judge -> bounded fallback) had NO
// dedicated test before this file (flagged in docs/P3-RETROSPECTIVE.md item #8 and its punch-list
// item #8: "Dedicated tests for lib/lookup-runner.js and lib/notes.js... the shared path every
// register lookup runs through has no direct suite"). This suite is register-agnostic on purpose:
// it exercises runLookup() directly against a minimal fake register spec, so a fix or regression
// here is caught once, independently of any one submodule's own tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const { runLookup } = require('./lookup-runner');

// A minimal, realistic fake register spec. `name` is deliberately the field name so the shared
// name-match gate (bestCandidate) has something real to score against.
function baseSpec(overrides) {
  return Object.assign(
    {
      register: 'test_register',
      query: 'Kingsley Napley LLP',
      deadlineMs: 500,
      extractCandidates: (json) => (Array.isArray(json && json.items) ? json.items.map((it) => ({ name: it.name, raw: it })) : []),
      buildRow: (candidate) => ({ matched_name: candidate.name }),
    },
    overrides
  );
}

function scriptedFetch(responses) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, requestKey: options && options.requestKey, headers: options && options.headers });
    const idx = Math.min(calls.length - 1, responses.length - 1);
    const r = responses[idx];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchFn, calls };
}

const MATCH_JSON = { items: [{ name: 'Kingsley Napley LLP' }] };
const NONMATCH_JSON = { items: [{ name: 'Kingsley Carpets Ltd' }] };

test('runLookup: query_too_short short-circuits before any fetchFn call', async () => {
  const { fetchFn, calls } = scriptedFetch([{ status: 200, json: MATCH_JSON }]);
  const spec = baseSpec({ query: 'ab', fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(calls.length, 0);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'no_match');
  assert.equal(r.note.reason, 'query_too_short');
});

test('runLookup: requiredKeyNote.present === false degrades loudly without ever calling fetchFn', async () => {
  const { fetchFn, calls } = scriptedFetch([{ status: 200, json: MATCH_JSON }]);
  const spec = baseSpec({
    fetchFn,
    requiredKeyNote: { present: false, reason: 'missing_key', detail: 'no key configured' },
    buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }),
  });
  const r = await runLookup(spec);
  assert.equal(calls.length, 0);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'missing_key');
  assert.equal(r.note.detail, 'no key configured');
});

test('runLookup: happy path -- a matching candidate on a 200 response returns a row stamped with source/fetched_at/query/match', async () => {
  const { fetchFn } = scriptedFetch([{ status: 200, json: MATCH_JSON }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/search', headers: { A: '1' }, requestKey: 'search' }) });
  const r = await runLookup(spec);
  assert.equal(r.note, null);
  assert.ok(r.row);
  assert.equal(r.row.matched_name, 'Kingsley Napley LLP');
  assert.equal(r.row.source, 'test_register');
  assert.equal(r.row.query, 'Kingsley Napley LLP');
  assert.ok(r.row.fetched_at);
  assert.equal(r.row.match.name_matched, 'Kingsley Napley LLP');
});

test('runLookup: a timeout degrades loudly with reason timeout, never a thrown error to the caller', async () => {
  const fetchFn = () => new Promise(() => {}); // never resolves
  const spec = baseSpec({ fetchFn, deadlineMs: 20, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'timeout');
});

test('runLookup: a thrown/rejected fetchFn degrades loudly with reason fetch_error, never propagates', async () => {
  const fetchFn = async () => { throw new Error('network exploded'); };
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'fetch_error');
  assert.match(r.note.detail, /network exploded/);
});

test('runLookup: a non-200 status with a JSON {message} body surfaces that message in the note detail (C-181: a causeless error is itself a defect)', async () => {
  const { fetchFn } = scriptedFetch([{ status: 400, json: { message: 'Unspecified query parameter foo is not allowed.' } }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'unexpected_response');
  assert.equal(r.note.detail, 'register answered with status 400: Unspecified query parameter foo is not allowed.');
});

test('runLookup: a non-200 status with NO body falls back to the bare status, unchanged from before', async () => {
  const { fetchFn } = scriptedFetch([{ status: 503, json: null }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.note.detail, 'register answered with status 503');
});

test('runLookup: zero candidates on a well-formed response is a loud no_match, not a row', async () => {
  const { fetchFn } = scriptedFetch([{ status: 200, json: { items: [] } }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'no_match');
  assert.equal(r.note.reason, 'no_candidates_returned');
});

test('runLookup: a below-threshold candidate (C-004) is a loud no_match, not a row', async () => {
  const { fetchFn } = scriptedFetch([{ status: 200, json: NONMATCH_JSON }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/x', headers: {}, requestKey: 'x' }) });
  const r = await runLookup(spec);
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'no_match');
  assert.equal(r.note.reason, 'below_threshold');
});

// ---- Bounded single alternate-shape fallback (generic; CQC is its first real consumer) ----

test('runLookup: with no buildFallbackRequest, an HTTP 400 behaves exactly as before (single call, unexpected_response)', async () => {
  const { fetchFn, calls } = scriptedFetch([{ status: 400, json: null }]);
  const spec = baseSpec({ fetchFn, buildRequest: () => ({ url: 'https://example.test/primary', headers: {}, requestKey: 'primary' }) });
  const r = await runLookup(spec);
  assert.equal(calls.length, 1);
  assert.equal(r.note.reason, 'unexpected_response');
});

test('runLookup: buildFallbackRequest present + primary HTTP 400 -> exactly one further call, never a third whatever it answers', async () => {
  const { fetchFn, calls } = scriptedFetch([
    { status: 400, json: null },
    { status: 400, json: null },
  ]);
  const spec = baseSpec({
    fetchFn,
    buildRequest: () => ({ url: 'https://example.test/primary', headers: {}, requestKey: 'primary' }),
    buildFallbackRequest: () => ({ url: 'https://example.test/fallback', headers: {}, requestKey: 'fallback' }),
    fallbackReason: 'alt_shape_rejected',
    fallbackDetailPrefix: 'the primary shape was rejected',
  });
  const r = await runLookup(spec);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestKey, 'primary');
  assert.equal(calls[1].requestKey, 'fallback');
  assert.equal(r.row, null);
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'alt_shape_rejected');
});

test('runLookup: the bounded fallback can still return a genuine matched row alongside its degraded note', async () => {
  const { fetchFn, calls } = scriptedFetch([
    { status: 400, json: null },
    { status: 200, json: MATCH_JSON },
  ]);
  const spec = baseSpec({
    fetchFn,
    buildRequest: () => ({ url: 'https://example.test/primary', headers: {}, requestKey: 'primary' }),
    buildFallbackRequest: () => ({ url: 'https://example.test/fallback', headers: {}, requestKey: 'fallback' }),
    fallbackReason: 'alt_shape_rejected',
    fallbackDetailPrefix: 'the primary shape was rejected',
  });
  const r = await runLookup(spec);
  assert.equal(calls.length, 2);
  assert.ok(r.row, 'a genuine match on the fallback still produces a row');
  assert.equal(r.row.matched_name, 'Kingsley Napley LLP');
  assert.equal(r.note.kind, 'degraded');
  assert.equal(r.note.reason, 'alt_shape_rejected');
  assert.match(r.note.detail, /the primary shape was rejected/);
  assert.match(r.note.detail, /retry succeeded/);
});

test('runLookup: buildFallbackRequest present but the primary status is NOT 400 (e.g. 500) -> no fallback attempted', async () => {
  const { fetchFn, calls } = scriptedFetch([{ status: 500, json: null }]);
  const spec = baseSpec({
    fetchFn,
    buildRequest: () => ({ url: 'https://example.test/primary', headers: {}, requestKey: 'primary' }),
    buildFallbackRequest: () => ({ url: 'https://example.test/fallback', headers: {}, requestKey: 'fallback' }),
    fallbackReason: 'alt_shape_rejected',
    fallbackDetailPrefix: 'the primary shape was rejected',
  });
  const r = await runLookup(spec);
  assert.equal(calls.length, 1, 'a 500 is a different failure class; only an exact 400 triggers the bounded fallback');
  assert.equal(r.note.reason, 'unexpected_response');
});

test('runLookup: buildFallbackRequest present but the primary call times out -> no fallback attempted (a timeout is not an HTTP 400)', async () => {
  const fetchFn = () => new Promise(() => {});
  const spec = baseSpec({
    fetchFn,
    deadlineMs: 20,
    buildRequest: () => ({ url: 'https://example.test/primary', headers: {}, requestKey: 'primary' }),
    buildFallbackRequest: () => ({ url: 'https://example.test/fallback', headers: {}, requestKey: 'fallback' }),
    fallbackReason: 'alt_shape_rejected',
    fallbackDetailPrefix: 'the primary shape was rejected',
  });
  const r = await runLookup(spec);
  assert.equal(r.note.reason, 'timeout');
});
