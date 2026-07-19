'use strict';
// breach/adjudicator/jury.test.js - GATE 5 (Rule 12 gate 5). Scripted-fake jurors (no network): a
// unanimous distinct-family Ministral-anchored jury ships; any single no_breach/insufficient VETOES; a
// curated/immune fact bypasses the jury; too-few-families / anchor-absent / empty-estate demote
// fail-closed. This is the module's known-bad calibration too (a fabricated breach a diverse juror
// vetoes must demote, never ship).
// Run: node --test breach/adjudicator/jury.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  juryDecision, normaliseJury, isImmune, juryValidate, juryVeto, juryN, juryAnchor, JURY_MIN, ANCHOR_FAMILY,
} = require('./jury.js');

// A text-derived presence-breach finding (the highest-stakes output the jury guards).
const FINDING = {
  description: 'advertises a prescription only medicine to the public',
  evidence_quote: 'book our wrinkle-relaxing injections',
  artifact: { type: 'quote', text: 'book our wrinkle-relaxing injections' },
};
const CTX = { domain: 'test.example', sector: 'healthcare', country: 'GB' };

// juror(name, family, verdict): a scripted router-provider juror that returns the adjudicate-shaped reply
// and counts its calls. No network.
function juror(name, family, verdict) {
  const p = { name, family, calls: 0 };
  p.call = async () => { p.calls += 1; return JSON.stringify({ verdicts: [{ id: 0, verdict, reason: 'test', disproof: null }] }); };
  return p;
}

// A full, distinct-family, Ministral-anchored panel of three (the estate the founder anchored on).
function panel(v1, v2, v3) {
  return [juror('ministral', 'mistral', v1), juror('groq', 'groq', v2), juror('gemini', 'gemini', v3)];
}

test('a unanimous, un-vetoed, Ministral-anchored 3-family jury SHIPS the violation (accept)', async () => {
  const providers = panel('breach', 'breach', 'breach');
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, true);
  assert.equal(d.verdict, 'accept');
  assert.equal(d.families.length, 3, 'all three distinct families voted (C-133)');
  assert.ok(d.families.includes('mistral'), 'anchored by Ministral');
});

test('KNOWN-BAD: a single no_breach leg VETOES -> demote (a fabricated breach a diverse juror rejects)', async () => {
  const providers = panel('breach', 'no_breach', 'breach');
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, false, 'the veto withholds the violation (veto-to-reject)');
  assert.equal(d.verdict, 'reject');
  assert.match(d.reason, /veto/);
});

test('a single insufficient leg also VETOES -> demote', async () => {
  const providers = panel('breach', 'breach', 'insufficient');
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, false);
  assert.equal(d.verdict, 'reject');
});

test('IMMUNITY (C-131): a curated/immune fact BYPASSES the jury and is never vetoed - jurors are not even called', async () => {
  const immuneFinding = Object.assign({}, FINDING, { sector_relevance: 'SECTOR_CORE' });
  const providers = panel('no_breach', 'no_breach', 'no_breach'); // even an all-veto panel cannot touch it
  const d = await juryDecision(immuneFinding, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, true, 'the jury has no authority to veto a curated catalogue fact');
  assert.equal(d.verdict, 'immune');
  assert.equal(providers[0].calls, 0, 'no juror is ever consulted for an immune fact');
});

test('KEYS-ABSENT: too few distinct families (< n) demotes fail-closed (a violation never ships un-juried)', async () => {
  const providers = [juror('ministral', 'mistral', 'breach'), juror('groq', 'groq', 'breach')]; // only 2 families, need 3
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, false);
  assert.equal(d.verdict, 'reject');
  assert.match(d.reason, /insufficient_independent_families/);
});

test('ANCHOR ABSENT: three distinct families but no Ministral demotes fail-closed', async () => {
  const providers = [juror('groq', 'groq', 'breach'), juror('gemini', 'gemini', 'breach'), juror('cloudflare', 'cloudflare', 'breach')];
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, false);
  assert.match(d.reason, /anchor_family_absent/);
});

test('EMPTY ESTATE (no keys at all) demotes fail-closed', async () => {
  const d = await juryDecision(FINDING, CTX, { providers: [] }, { deadlineMs: 500 });
  assert.equal(d.ship, false);
  assert.equal(d.verdict, 'reject');
});

test('a juror whose reply is garbage is an INVALID vote -> too few valid votes -> demote', async () => {
  const bad = { name: 'ministral', family: 'mistral', call: async () => 'not json at all' };
  const providers = [bad, juror('groq', 'groq', 'breach'), juror('gemini', 'gemini', 'breach')];
  const d = await juryDecision(FINDING, CTX, { providers }, { deadlineMs: 500 });
  assert.equal(d.ship, false, 'an unparseable anchor vote cannot be counted -> fail-closed');
});

// ── unit-level pieces ──────────────────────────────────────────────────────────────────────────────
test('config defaults: >= 3 legs, anchored on Ministral (C-133)', () => {
  assert.equal(JURY_MIN, 3);
  assert.equal(ANCHOR_FAMILY, 'mistral');
  assert.equal(juryN({}), 3);
  assert.equal(juryN({ n: 5 }), 5);
  assert.equal(juryN({ n: 0 }), 3, 'a misconfigured n clamps to the fail-closed default');
  assert.equal(juryAnchor({}), 'mistral');
  assert.equal(juryAnchor({ anchorFamily: 'x' }), 'x');
});

test('juryValidate accepts a well-formed breach vote, rejects garbage and out-of-enum verdicts', () => {
  const good = juryValidate(JSON.stringify({ verdicts: [{ id: 0, verdict: 'breach' }] }));
  assert.equal(good.ok, true);
  assert.equal(good.value.verdict, 'breach');
  assert.equal(juryValidate('not json').ok, false);
  assert.equal(juryValidate(JSON.stringify({ verdicts: [{ id: 0, verdict: 'maybe' }] })).ok, false);
});

test('juryVeto affirms ONLY on breach; no_breach and insufficient both veto (veto-to-reject)', () => {
  assert.equal(juryVeto({ value: { verdict: 'breach' } }).veto, false);
  assert.equal(juryVeto({ value: { verdict: 'no_breach' } }).veto, true);
  assert.equal(juryVeto({ value: { verdict: 'insufficient' } }).veto, true);
  assert.equal(juryVeto({ value: {} }).veto, true, 'an unknown verdict vetoes (fail-closed)');
});

test('isImmune: register-verified / SECTOR_CORE / SECTOR_AGNOSTIC are immune; a plain finding is not', () => {
  assert.equal(isImmune({ sector_relevance: 'SECTOR_CORE' }), true);
  assert.equal(isImmune({ sector_relevance: 'sector_agnostic' }), true, 'case-insensitive');
  assert.equal(isImmune({ curated: true }), true);
  assert.equal(isImmune({ immune: true }), true);
  assert.equal(isImmune({ sector_relevance: 'SECTOR_OPTIONAL' }), false);
  assert.equal(isImmune({}), false);
  assert.equal(isImmune(null), false);
});

test('normaliseJury: opt-in only; true uses providers, an object carries its own config', () => {
  assert.equal(normaliseJury({}), null, 'no jury key -> not engaged');
  assert.equal(normaliseJury({ jury: false }), null);
  assert.deepEqual(normaliseJury({ jury: true, providers: [1, 2] }), { providers: [1, 2], n: undefined, anchorFamily: undefined });
  assert.deepEqual(normaliseJury({ jury: { providers: [3], n: 4, anchorFamily: 'z' } }), { providers: [3], n: 4, anchorFamily: 'z' });
});
