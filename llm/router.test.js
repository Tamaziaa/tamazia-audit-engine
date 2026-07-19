'use strict';
// llm/router.test.js - node:test suite for the deterministic routing shell.
// Run: node --test llm/router.test.js
//
// Providers are SCRIPTED FAKES (no network). Covers: free-first ordering, single-attempt no-retry
// discipline (E-238), the per-call hard deadline (Rule 9 / C-040), gate-validated selection, the
// veto-to-reject quorum over DISTINCT families (Rule 12 gate 5 / C-133), curated-fact immunity
// (C-131), and the fail-closed rejects (insufficient families / insufficient valid votes).

const test = require('node:test');
const assert = require('node:assert/strict');

const router = require('./router.js');

// makeProvider(name, family, impl, opts): a scripted provider that counts its calls. `impl(task, ctx,
// self)` returns the response (or throws / returns a never-resolving promise to model a hang).
function makeProvider(name, family, impl, opts = {}) {
  const p = Object.assign({ name, family, calls: 0 }, opts);
  p.call = async (task, ctx) => { p.calls += 1; return impl(task, ctx, p); };
  return p;
}
const ok = (name, family, text) => makeProvider(name, family, () => ({ ok: true, text }));
const fail = (name, family) => makeProvider(name, family, () => ({ ok: false, error: 'boom' }));
const throws = (name, family) => makeProvider(name, family, () => { throw new Error('kaboom'); });
const hang = (name, family) => makeProvider(name, family, () => new Promise(() => {}));

// ---- route: ordering and fallover ----

test('route returns the first successful provider', async () => {
  const r = await router.route({}, { providers: [ok('a', 'groq', 'A'), ok('b', 'gemini', 'B')], deadlineMs: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'a');
  assert.equal(r.text, 'A');
});

test('route imposes free-first order even when a paid provider is listed first', async () => {
  const paid = ok('paid', 'anthropic', 'PAID');
  const free = ok('free', 'groq', 'FREE');
  const r = await router.route({}, { providers: [paid, free], deadlineMs: 500 });
  assert.equal(r.provider, 'free');
  assert.equal(paid.calls, 0, 'the free provider succeeded first, so the paid one is never called');
});

test('route falls over a throwing provider to the next', async () => {
  const bad = throws('bad', 'groq');
  const good = ok('good', 'gemini', 'G');
  const r = await router.route({}, { providers: [bad, good], deadlineMs: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'good');
  assert.equal(bad.calls, 1, 'a failed provider is tried exactly once - no retry storm');
});

test('route falls over an empty-text provider', async () => {
  const empty = ok('empty', 'groq', '   ');
  const good = ok('good', 'gemini', 'G');
  const r = await router.route({}, { providers: [empty, good], deadlineMs: 500 });
  assert.equal(r.provider, 'good');
});

test('route returns no_providers when the chain is empty', async () => {
  const r = await router.route({}, { providers: [], deadlineMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_providers');
});

test('route returns all_providers_exhausted with an attempts ledger when every provider fails', async () => {
  const r = await router.route({}, { providers: [fail('a', 'groq'), throws('b', 'gemini')], deadlineMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'all_providers_exhausted');
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].outcome, 'boom', 'the attempt ledger carries the provider\'s own error, not a generic code');
  assert.equal(r.attempts[1].outcome, 'threw:kaboom');
});

// ---- route: the hard deadline (Rule 9) ----

test('route abandons a hanging provider at the deadline and the next succeeds', async () => {
  const t0 = Date.now();
  const r = await router.route({}, { providers: [hang('stuck', 'groq'), ok('fast', 'gemini', 'F')], deadlineMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'fast');
  assert.equal(r.attempts[0].outcome, 'timeout');
  assert.ok(Date.now() - t0 < 2000, 'the mint is not held hostage by the stuck provider');
});

test('assertDeadline: a non-positive or non-finite deadline throws (a cap must shout, C-025)', async () => {
  await assert.rejects(() => router.route({}, { providers: [ok('a', 'groq', 'A')], deadlineMs: 0 }));
  await assert.rejects(() => router.route({}, { providers: [ok('a', 'groq', 'A')], deadlineMs: NaN }));
});

// ---- route: gate-validated selection ----

test('route skips a provider whose response fails the injected gate and picks the next valid one', async () => {
  const validate = (raw) => (raw && raw.text === 'GOOD' ? { ok: true, value: { v: 'GOOD' } } : { ok: false, violations: [{ code: 'stub_reject' }] });
  const r = await router.route({}, { providers: [ok('bad', 'groq', 'BAD'), ok('good', 'gemini', 'GOOD')], deadlineMs: 500, validate });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'good');
  assert.deepEqual(r.value, { v: 'GOOD' });
  assert.equal(r.attempts[0].outcome.startsWith('gate_reject'), true);
});

test('route emits an attempt record to the log sink for every provider', async () => {
  const seen = [];
  await router.route({}, { providers: [fail('a', 'groq'), ok('b', 'gemini', 'B')], deadlineMs: 500, log: (rec) => seen.push(rec) });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].provider, 'a');
  assert.equal(seen[1].outcome, 'ok');
});

// ---- ordering helpers ----

test('orderProviders is stable and free-first', () => {
  const list = [ok('q', 'qwen'), ok('g1', 'groq'), ok('g2', 'groq'), ok('cf', 'cloudflare')];
  const order = router.orderProviders(list).map((p) => p.name);
  assert.deepEqual(order, ['cf', 'g1', 'g2', 'q']);
});

test('distinctFamilyProviders picks the first provider of each family only', () => {
  const list = [ok('g1', 'groq'), ok('g2', 'groq'), ok('gem', 'gemini'), ok('cf', 'cloudflare')];
  const jurors = router.distinctFamilyProviders(router.orderProviders(list), 2).map((p) => p.name);
  assert.deepEqual(jurors, ['cf', 'g1']);
});

test('distinctFamilyProviders skips providers with an empty or missing family (no fake independence)', () => {
  const list = [ok('anon1', ''), ok('anon2'), ok('g', 'groq'), makeProvider('nully', null)];
  const jurors = router.distinctFamilyProviders(router.orderProviders(list), 3).map((p) => p.name);
  assert.deepEqual(jurors, ['g'], 'only the provider with a real family is a juror; the family-less ones are not counted');
});

// ---- quorum ----

const violationVote = (name, family) => makeProvider(name, family, () => ({ ok: true, text: 'violation' }));
const reviewVote = (name, family) => makeProvider(name, family, () => ({ ok: true, text: 'needs-review' }));
const verdictValidate = (raw) => ({ ok: true, value: { verdict: (raw && raw.text) || '' } });

test('quorum: a curated fact is immune - the jury is never even convened (C-131)', async () => {
  const spy = violationVote('a', 'groq');
  const r = await router.quorum({ curated: true }, { providers: [spy], n: 2, validate: verdictValidate });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'immune');
  assert.equal(spy.calls, 0);
});

test('quorum: rejects when there are fewer independent families than n (C-133 / C-083 fail-closed)', async () => {
  const r = await router.quorum({}, { providers: [violationVote('g1', 'groq'), violationVote('g2', 'groq')], n: 2, validate: verdictValidate });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'reject');
  assert.ok(r.reason.startsWith('insufficient_independent_families'));
});

test('quorum: a family-less provider cannot pad the jury - it falls closed (Rule 12 gate 5)', async () => {
  // One real family (groq) plus a provider that declares no family. The undeclared provider must NOT
  // count as an independent juror, so a jury of n=2 is short one real family and rejects fail-closed.
  const anon = makeProvider('anon', '', () => ({ ok: true, text: 'violation' }));
  const r = await router.quorum({}, { providers: [violationVote('g', 'groq'), anon], n: 2, validate: verdictValidate });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'reject');
  assert.ok(r.reason.startsWith('insufficient_independent_families'));
  assert.equal(anon.calls, 0, 'the family-less provider is never even called');
});

test('quorum: a unanimous, un-vetoed jury accepts', async () => {
  const r = await router.quorum({}, { providers: [violationVote('g', 'groq'), violationVote('m', 'gemini')], n: 2, validate: verdictValidate });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'accept');
  assert.equal(r.votes.length, 2);
});

test('quorum: any single veto rejects (default polarity - a non-violation verdict vetoes)', async () => {
  const r = await router.quorum({}, { providers: [violationVote('g', 'groq'), reviewVote('m', 'gemini')], n: 2, validate: verdictValidate });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'reject');
  assert.ok(r.reason.includes('veto'));
});

test('quorum: rejects when a juror response fails the gate (too few valid votes)', async () => {
  const bad = makeProvider('m', 'gemini', () => ({ ok: true, text: 'x' }));
  const validate = (raw) => (raw && raw.text === 'violation' ? { ok: true, value: { verdict: 'violation' } } : { ok: false, violations: [{ code: 'reject' }] });
  const r = await router.quorum({}, { providers: [violationVote('g', 'groq'), bad], n: 2, validate });
  assert.equal(r.ok, false);
  assert.ok(r.reason.startsWith('insufficient_valid_votes'));
});

test('quorum: honours a custom vetoRule', async () => {
  const vetoRule = (vote) => ({ veto: vote.value.verdict === 'violation', reason: 'custom' });
  const r = await router.quorum({}, { providers: [violationVote('g', 'groq'), violationVote('m', 'gemini')], n: 2, validate: verdictValidate, vetoRule });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('custom'));
});

test('quorum: n must be a positive integer', async () => {
  await assert.rejects(() => router.quorum({}, { providers: [violationVote('g', 'groq')], n: 0, validate: verdictValidate }));
});

test('defaultVeto: an explicit veto flag and a non-violation verdict both veto; a violation does not', () => {
  assert.equal(router.defaultVeto({ value: { veto: true } }).veto, true);
  assert.equal(router.defaultVeto({ value: { verdict: 'needs-review' } }).veto, true);
  assert.equal(router.defaultVeto({ value: { verdict: 'violation' } }).veto, false);
});

// ---- the Ministral anchor (founder decision 2026-07-19): route() prefers it, quorum() requires it ----

test('hoistFamilyFirst moves the anchor family to the FRONT of a free-first order (Ministral primary)', () => {
  const ordered = router.orderProviders([ok('m', 'mistral'), ok('g', 'groq'), ok('cf', 'cloudflare')]);
  const hoisted = router.hoistFamilyFirst(ordered, 'mistral').map((p) => p.name);
  assert.equal(hoisted[0], 'm', 'mistral (paid, normally last free-first) is hoisted to the front');
  assert.deepEqual(hoisted.slice(1).sort(), ['cf', 'g'], 'the rest keep their free-first order');
});

test('hoistFamilyFirst with no anchor returns the list unchanged (free-first default stands)', () => {
  const ordered = router.orderProviders([ok('g', 'groq'), ok('cf', 'cloudflare')]);
  assert.deepEqual(router.hoistFamilyFirst(ordered, null).map((p) => p.name), ordered.map((p) => p.name));
});

test('route with anchorFamily tries Ministral FIRST even though it is paid and free providers are listed', async () => {
  const ministral = ok('ministral', 'mistral', 'M'); // paid family -> normally sorts LAST free-first
  const free = ok('free', 'groq', 'FREE');
  const r = await router.route({}, { providers: [free, ministral], deadlineMs: 500, anchorFamily: 'mistral' });
  assert.equal(r.provider, 'ministral', 'the anchor is tried first');
  assert.equal(free.calls, 0, 'the anchor succeeded, so the free provider is never called');
});

test('route with anchorFamily falls over a failing Ministral to the free chain (Ministral primary, free fallback)', async () => {
  const ministral = throws('ministral', 'mistral');
  const free = ok('free', 'groq', 'FREE');
  const r = await router.route({}, { providers: [free, ministral], deadlineMs: 500, anchorFamily: 'mistral' });
  assert.equal(r.provider, 'free', 'a failing anchor falls over to the free chain');
  assert.equal(ministral.calls, 1, 'the anchor is tried exactly once - no retry storm');
});

test('anchoredDistinctFamilies always includes the anchor; anchor absent -> anchorMissing (fail-closed)', () => {
  const ordered = router.orderProviders([ok('g', 'groq'), ok('gem', 'gemini'), ok('m', 'mistral'), ok('cf', 'cloudflare')]);
  const sel = router.anchoredDistinctFamilies(ordered, 3, 'mistral');
  assert.equal(sel.anchorMissing, false);
  assert.equal(sel.jurors[0].family, 'mistral', 'the anchor is juror[0]');
  assert.equal(sel.jurors.length, 3);
  const noAnchor = router.anchoredDistinctFamilies(router.orderProviders([ok('g', 'groq'), ok('gem', 'gemini')]), 3, 'mistral');
  assert.equal(noAnchor.anchorMissing, true, 'no mistral provider -> anchorMissing');
  assert.equal(noAnchor.jurors.length, 0);
});

test('C-133 config: a >=3-family jury anchored by Ministral is genuinely distinct across families', () => {
  const estate = [violationVote('m', 'mistral'), violationVote('g', 'groq'), violationVote('gem', 'gemini'), violationVote('cf', 'cloudflare')];
  const sel = router.selectJurors(estate, 3, 'mistral');
  const families = sel.jurors.map((p) => p.family);
  assert.equal(families.length, 3, 'exactly 3 jurors');
  assert.equal(new Set(families).size, 3, 'all 3 families are distinct (C-133 independence)');
  assert.ok(families.includes('mistral'), 'the jury is anchored by Ministral');
});

test('quorum with anchorFamily: a 3-family Ministral-anchored unanimous jury ACCEPTS', async () => {
  const providers = [violationVote('m', 'mistral'), violationVote('g', 'groq'), violationVote('gem', 'gemini')];
  const r = await router.quorum({}, { providers, n: 3, anchorFamily: 'mistral', validate: verdictValidate });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'accept');
  assert.equal(r.votes.length, 3);
  assert.ok(r.votes.some((v) => v.family === 'mistral'), 'the anchor voted');
});

test('quorum with anchorFamily: the anchor ABSENT rejects fail-closed (a violation never ships un-anchored)', async () => {
  const providers = [violationVote('g', 'groq'), violationVote('gem', 'gemini'), violationVote('cf', 'cloudflare')];
  const r = await router.quorum({}, { providers, n: 3, anchorFamily: 'mistral', validate: verdictValidate });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'reject');
  assert.ok(r.reason.startsWith('anchor_family_absent'), 'the missing anchor is the named reason');
});

test('quorum with anchorFamily: any single veto still rejects even with the anchor present', async () => {
  const providers = [violationVote('m', 'mistral'), violationVote('g', 'groq'), reviewVote('gem', 'gemini')];
  const r = await router.quorum({}, { providers, n: 3, anchorFamily: 'mistral', validate: verdictValidate });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'reject');
  assert.ok(r.reason.includes('veto'));
});

test('quorum with anchorFamily: a curated fact is STILL immune (the anchor changes nothing about immunity)', async () => {
  const providers = [violationVote('m', 'mistral'), violationVote('g', 'groq'), violationVote('gem', 'gemini')];
  const r = await router.quorum({ curated: true }, { providers, n: 3, anchorFamily: 'mistral', validate: verdictValidate });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'immune');
});
