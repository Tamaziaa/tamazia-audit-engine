'use strict';
// eval/e2e/lib/redteam.test.js
//   node --test eval/e2e/lib/redteam.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadRedTeamFixtures,
  targetGateUnavailable,
  pendingGateReason,
  resolveBundle,
  mustNotTerms,
  evaluateMustNot,
  runRedTeamEntry,
  runRedTeamLane,
} = require('./redteam');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-redteam-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return { dir, path: p };
}

test('loadRedTeamFixtures: an absent file is an honest whole-lane skip, never a crash', () => {
  const r = loadRedTeamFixtures(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json'));
  assert.deepStrictEqual(r, { present: false, entries: [] });
});

test('loadRedTeamFixtures: malformed JSON is present but carries a parseError, never throws', () => {
  const f = tmpFile('bad.json', '{ not valid json');
  const r = loadRedTeamFixtures(f.path);
  assert.strictEqual(r.present, true);
  assert.match(r.parseError, /./);
});

test('loadRedTeamFixtures: a bare top-level array is accepted', () => {
  const f = tmpFile('array.json', JSON.stringify([{ id: 'a' }, { id: 'b' }]));
  const r = loadRedTeamFixtures(f.path);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.entries.length, 2);
});

test('loadRedTeamFixtures: an {entries:[...]} shape is accepted', () => {
  const f = tmpFile('entries.json', JSON.stringify({ entries: [{ id: 'a' }] }));
  const r = loadRedTeamFixtures(f.path);
  assert.strictEqual(r.entries.length, 1);
});

test('loadRedTeamFixtures: an unrecognised top-level shape carries a parseError', () => {
  const f = tmpFile('weird.json', JSON.stringify({ somethingElse: true }));
  const r = loadRedTeamFixtures(f.path);
  assert.match(r.parseError, /unrecognised top-level shape/);
});

test('targetGateUnavailable: no target_gate named -> always attempt (null)', () => {
  assert.strictEqual(targetGateUnavailable({}, []), null);
});

test('targetGateUnavailable: names a stage that ran -> null (proceed)', () => {
  const stageTable = [{ stage: 'facts', status: 'ran' }];
  assert.strictEqual(targetGateUnavailable({ target_gate: 'facts' }, stageTable), null);
});

test('targetGateUnavailable: names a stage that is skipped -> returns the gate name', () => {
  const stageTable = [{ stage: 'propose', status: 'skipped' }];
  assert.strictEqual(targetGateUnavailable({ target_gate: 'propose' }, stageTable), 'propose');
});

test('targetGateUnavailable: names a stage absent from the table entirely -> fails closed (unavailable)', () => {
  assert.strictEqual(targetGateUnavailable({ target_gate: 'adjudicate' }, []), 'adjudicate');
});

test('targetGateUnavailable: an unrecognised gate NAME is not one of ours -> null (proceed)', () => {
  assert.strictEqual(targetGateUnavailable({ target_gate: 'not-a-real-stage' }, []), null);
});

test('targetGateUnavailable: an OBJECT-shaped target_gate (the real landed file\'s shape) is a harmless no-op (null)', () => {
  assert.strictEqual(targetGateUnavailable({ target_gate: { gate: 'llm/gate.js', status: 'pending_harness' } }, []), null);
});

test('pendingGateReason: current_status: pending_gate is the authoritative skip signal', () => {
  assert.match(pendingGateReason({ current_status: 'pending_gate' }), /pending_gate/);
});

test('pendingGateReason: target_gate.status: pending_gate is also authoritative', () => {
  assert.match(pendingGateReason({ target_gate: { gate: 'breach/verifiers/quote-match.js', status: 'pending_gate' } }), /pending_gate/);
});

test('pendingGateReason: any other status (live, pending_harness, shell_this_wave) is not a skip signal', () => {
  assert.strictEqual(pendingGateReason({ current_status: 'verified_caught_live', target_gate: { status: 'live' } }), null);
  assert.strictEqual(pendingGateReason({ target_gate: { status: 'pending_harness' } }), null);
});

test('resolveBundle: an inline bundle object is used directly', () => {
  const bundle = { domain: 'x' };
  assert.strictEqual(resolveBundle({ bundle }, '/nowhere'), bundle);
});

test('resolveBundle: input.bundle (the real landed file\'s shape) is preferred and used directly', () => {
  const bundle = { domain: 'x' };
  assert.strictEqual(resolveBundle({ input: { bundle } }, '/nowhere'), bundle);
});

test('resolveBundle: entry.fixture resolves relative to fixturesDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-redteam-'));
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ domain: 'x' }));
  const bundle = resolveBundle({ fixture: 'x.json' }, dir);
  assert.deepStrictEqual(bundle, { domain: 'x' });
});

test('resolveBundle: entry.domain looks up <domain>.json under fixturesDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-redteam-'));
  fs.writeFileSync(path.join(dir, 'example.com.json'), JSON.stringify({ domain: 'example.com' }));
  const bundle = resolveBundle({ domain: 'example.com' }, dir);
  assert.deepStrictEqual(bundle, { domain: 'example.com' });
});

test('resolveBundle: nothing resolvable yields null', () => {
  assert.strictEqual(resolveBundle({}, '/nowhere'), null);
});

function fakePipelineResult(findings) {
  return { breach: { findings }, payload: { meta: { domain: 'x' } }, coverage: {} };
}

test('mustNotTerms: gathers every STRING value and every string inside an array value', () => {
  const terms = mustNotTerms({
    must_not: {
      match_any: ['a', 'b'],
      attach_a_framework_with_id: 'c',
      a_pure_boolean_flag: true,
      another_boolean_flag: false,
    },
  });
  assert.deepStrictEqual(terms.sort(), ['a', 'b', 'c']);
});

test('mustNotTerms: a must_not made entirely of boolean flags yields no terms (the real RT-B1/RT-E shape)', () => {
  assert.deepStrictEqual(mustNotTerms({ must_not: { flag_one: true, flag_two: true } }), []);
});

test('mustNotTerms: a missing must_not yields no terms, never throws', () => {
  assert.deepStrictEqual(mustNotTerms({}), []);
});

test('evaluateMustNot: no match_any clause is honestly skipped', () => {
  const r = evaluateMustNot({}, fakePipelineResult([]));
  assert.strictEqual(r.status, 'skipped');
});

test('evaluateMustNot: a forbidden token in findings escapes', () => {
  const r = evaluateMustNot({ must_not: { match_any: ['FAKE_STATUTE_2099'] } }, fakePipelineResult([{ id: 'f', framework: 'FAKE_STATUTE_2099' }]));
  assert.strictEqual(r.status, 'escaped');
});

test('evaluateMustNot: no forbidden token anywhere is caught', () => {
  const r = evaluateMustNot({ must_not: { match_any: ['FAKE_STATUTE_2099'] } }, fakePipelineResult([]));
  assert.strictEqual(r.status, 'caught');
});

test('runRedTeamEntry: skips honestly when the target gate is unavailable', async () => {
  const row = await runRedTeamEntry({ id: 'RT1', target_gate: 'adjudicate' }, { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => { throw new Error('must not run'); } });
  assert.strictEqual(row.status, 'skipped');
});

test('runRedTeamEntry: skips honestly when no bundle can be resolved', async () => {
  const row = await runRedTeamEntry({ id: 'RT2' }, { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => { throw new Error('must not run'); } });
  assert.strictEqual(row.status, 'skipped');
});

test('runRedTeamEntry: reports error (not skipped, not caught) when the pipeline itself throws', async () => {
  const row = await runRedTeamEntry(
    { id: 'RT3', bundle: {} },
    { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => { throw new Error('pipeline exploded'); } }
  );
  assert.strictEqual(row.status, 'error');
  assert.match(row.reason, /pipeline exploded/);
});

test('runRedTeamEntry: reports escaped when the pipeline output matches a forbidden token', async () => {
  const row = await runRedTeamEntry(
    { id: 'RT4', bundle: {}, must_not: { match_any: ['FAKE_LAW'] } },
    { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => fakePipelineResult([{ id: 'f', framework: 'FAKE_LAW' }]) }
  );
  assert.strictEqual(row.status, 'escaped');
});

test('runRedTeamEntry: reports caught when the gate genuinely held', async () => {
  const row = await runRedTeamEntry(
    { id: 'RT5', bundle: {}, must_not: { match_any: ['FAKE_LAW'] } },
    { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => fakePipelineResult([]) }
  );
  assert.strictEqual(row.status, 'caught');
});

test('runRedTeamLane: an absent file is a whole-lane skip with zero rows', async () => {
  const lane = await runRedTeamLane(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json'), {});
  assert.deepStrictEqual(lane, { present: false, rows: [] });
});

test('runRedTeamLane: runs every entry in a present file and returns one row each', async () => {
  const f = tmpFile('lane.json', JSON.stringify({
    entries: [
      { id: 'a', bundle: {}, must_not: { match_any: ['forbidden-token-alpha'] } },
      { id: 'b', bundle: {}, must_not: { match_any: ['forbidden-token-beta'] } },
    ],
  }));
  const lane = await runRedTeamLane(f.path, { stageTable: [], fixturesDir: f.dir, runPipelineForBundle: async () => fakePipelineResult([]) });
  assert.strictEqual(lane.present, true);
  assert.strictEqual(lane.rows.length, 2);
  assert.ok(lane.rows.every((r) => r.status === 'caught'));
});

// ---------------------------------------------------------------------------------------------------
// Bespoke-handler dispatch: an id present in redteam-handlers.js's RT_HANDLERS is routed there BEFORE
// the generic bundle+must_not path, using its own (non-bundle-shaped) input, and never touches
// ctx.runPipelineForBundle at all.
// ---------------------------------------------------------------------------------------------------
test('runRedTeamEntry: dispatches a known id to its bespoke handler, never the generic pipeline path', async () => {
  const entry = {
    id: 'RT-H-QUOTE-DRIFT',
    input: {
      corpus_text: 'We process your personal data in accordance with our privacy policy and applicable law.',
      proposed_quote_drifted: 'We process your personal information in accordance with our privacy policy and applicable law.',
      exact_quote_control: 'We process your personal data in accordance with our privacy policy',
    },
  };
  const row = await runRedTeamEntry(entry, { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => { throw new Error('must not run - a bespoke handler must not touch the generic pipeline path'); } });
  assert.strictEqual(row.status, 'caught');
});

test('runRedTeamEntry: a bespoke handler that throws reports error, never a silent skip or a fabricated catch', async () => {
  // A malformed cookies_pre_consent (a non-array truthy value) makes rtEssentialCookie's .filter() call
  // throw a genuine TypeError - proving the dispatch's try/catch converts a real handler bug into an
  // honest 'error' row rather than crashing the whole red-team lane.
  const row = await runRedTeamEntry(
    { id: 'RT-G-ESSENTIAL-COOKIE-PRECONSENT', input: { cookies_pre_consent: 'not-an-array' } },
    { stageTable: [], fixturesDir: '/nowhere', runPipelineForBundle: async () => { throw new Error('must not run'); } }
  );
  assert.strictEqual(row.status, 'error');
  assert.match(row.reason, /bespoke handler threw/);
});

// ---------------------------------------------------------------------------------------------------
// SMOKE: the real, committed eval/red-team/fixtures.json (landed mid-build) runs end-to-end with zero
// escapes/errors under today's real pipeline wiring. This is the test that proves the whole red-team
// lane - generic evaluator AND bespoke handlers together - actually works against real, adversarial
// fixture data, not only synthetic test doubles.
// ---------------------------------------------------------------------------------------------------
test('SMOKE: the real eval/red-team/fixtures.json runs clean (zero escapes/errors) against the real pipeline', async () => {
  const fs2 = require('fs');
  const realRedTeamPath = path.join(__dirname, '..', '..', 'red-team', 'fixtures.json');
  if (!fs2.existsSync(realRedTeamPath)) return; // not landed at test time - nothing to smoke-test yet.
  const { probeStageWiring, runPipeline } = require('./pipeline.js');
  const wiring = probeStageWiring();
  const stageTable = wiring.map((w) => ({ stage: w.stage, status: w.status === 'wired' ? 'ran' : 'skipped' }));
  const fixturesDir = path.join(__dirname, '..', '..', 'reference-set', 'fixtures');
  const lane = await runRedTeamLane(realRedTeamPath, { stageTable, fixturesDir, runPipelineForBundle: (domain, bundle) => runPipeline(domain, bundle) });
  assert.strictEqual(lane.present, true);
  assert.ok(lane.rows.length > 0);
  const bad = lane.rows.filter((r) => r.status === 'escaped' || r.status === 'error');
  assert.deepStrictEqual(bad, [], 'expected zero escapes/errors against the real red-team corpus');
});
