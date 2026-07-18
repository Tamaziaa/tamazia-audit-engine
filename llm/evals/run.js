#!/usr/bin/env node
'use strict';
// llm/evals/run.js - THE blocking precision + abstain-rate harness for the LLM-touched gates
// (PRD tool #9; Constitution Rule 11 + Rule 12 gates 3/4/5; caution.md C-146). It replays a fixture
// suite of adjudication, entailment, structural-gate and jury-immunity tasks through the DETERMINISTIC
// shells (breach/adjudicator, llm/entailment, llm/gate, llm/router) with SCRIPTED providers - NO
// network, no model, no keys. Every prompt/model change is gated here on precision and abstain-rate.
//
// THE CONTRACT (why this is the enforcement point Rule 12 names):
//   - known-breach tasks MUST ship a positive (a violation / an entailment). These are the true
//     positives.
//   - known-clean tasks carry TEMPTING-but-wrong evidence (a practice-area page, a fabricated
//     disproof, a fluent-but-neutral premise) and MUST NOT ship a positive. A clean task that ships
//     is a FALSE POSITIVE - and a single false positive is a bug (axe-core doctrine, Rule 10).
//   - gate tasks (out-of-set citation, quote drift, garbage) MUST be refused by the structural gate.
//   - curated-immunity tasks MUST return 'immune': the jury may never veto a catalogue fact (C-131).
//
// EXIT: 1 when precision < 1.0 on the seeded set, when any immunity veto fires, or when any fixture's
// actual outcome does not match its declared expectation (a known-breach that stopped shipping is a
// regression too); 0 when every fixture matches and precision is a clean 1.0; 2 on a harness error.
//
// Usage: node llm/evals/run.js [--json]

const fs = require('fs');
const path = require('path');

const { adjudicate } = require('../../breach/adjudicator/adjudicate.js');
const { checkEntailment } = require('../entailment.js');
const { validateResponse } = require('../gate.js');
const { quorum } = require('../router.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SHELL_DEADLINE_MS = 5000; // a CAP for the scripted shells; they resolve synchronously anyway.

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

// classificationResult(fx, passed, shipped, detail): the common result shape for the three
// classification kinds (adjudication/entailment/gate). expectPositive is set from the fixture class:
// only a known-breach is expected to ship a positive; everything else must abstain/refuse.
function classificationResult(fx, passed, shipped, detail) {
  return { name: fx.name, kind: fx.kind, passed, shipped, expectPositive: fx.class === 'known-breach', abstained: !shipped, immunityVeto: false, detail };
}

// requestVerdictEnum(request): the closed verdict enum a request declares, or null. Split out so the
// scripted call below carries no 4-term member-access chain of its own (Complex Conditional cap).
function requestVerdictEnum(request) {
  const props = request && request.schema && request.schema.properties;
  const verdict = props && props.verdict;
  return (verdict && verdict.enum) || null;
}

// scriptedAdjudicatorCall(fx): the scripted llmCall for an adjudication fixture. An entailment request
// (its closed 3-label verdict enum) is answered with a gate-valid pass, so a scripted breach is not
// demoted to needs_review; every other request returns the fixture's scripted verdicts unchanged.
function scriptedAdjudicatorCall(fx) {
  return async (request) => {
    const enumSet = requestVerdictEnum(request);
    if (Array.isArray(enumSet) && enumSet.includes('entailment')) {
      return { source_id: (request.allowedSourceIds || [])[0] || '', verdict: 'entailment' };
    }
    return fx.scripted_verdicts;
  };
}

async function runAdjudication(fx) {
  // Gate 3 (checkEntailment) runs AFTER a breach verdict; the scripted call answers the entailment leg
  // (see scriptedAdjudicatorCall). Entailment-FAILURE behaviour is exercised by the entailment fixtures.
  const llmCall = fx.scripted_verdicts ? scriptedAdjudicatorCall(fx) : null;
  const { findings } = await adjudicate(fx.candidates, fx.bundle, { llmCall, deadlineMs: SHELL_DEADLINE_MS });
  const states = findings.map((f) => f.state);
  return classificationResult(fx, arraysEqual(states, fx.expect.states), states.includes('violation'), 'states=[' + states.join(',') + ']');
}

async function runEntailment(fx) {
  const llmCall = async () => fx.scripted_response;
  const results = await checkEntailment(fx.claims, { llmCall, deadlineMs: SHELL_DEADLINE_MS });
  const oks = results.map((r) => r.ok);
  const detail = 'ok=[' + oks.join(',') + '] verdict=[' + results.map((r) => r.verdict).join(',') + ']';
  return classificationResult(fx, arraysEqual(oks, fx.expect.ok), oks.includes(true), detail);
}

function runGate(fx) {
  const res = validateResponse(fx.response, { schema: fx.schema, allowedSourceIds: fx.allowedSourceIds, sources: fx.sources, minQuoteLen: fx.minQuoteLen });
  const detail = 'ok=' + res.ok + ' violations=[' + (res.violations || []).map((v) => v.code).join(',') + ']';
  return classificationResult(fx, res.ok === fx.expect.ok, res.ok === true, detail);
}

async function runImmunity(fx) {
  const providers = (fx.providers || []).map((p) => ({ name: p.name, family: p.family, call: async () => JSON.stringify(p.reply) }));
  const r = await quorum(fx.task, { providers, n: 2, deadlineMs: SHELL_DEADLINE_MS });
  const want = fx.expect.verdict || 'immune';
  const immunityVeto = r.verdict !== 'immune';
  return { name: fx.name, kind: fx.kind, passed: r.verdict === want, shipped: null, expectPositive: null, abstained: false, immunityVeto, detail: 'verdict=' + r.verdict + (r.reason ? ' reason=' + r.reason : '') };
}

const RUNNERS = { adjudication: runAdjudication, entailment: runEntailment, gate: runGate, 'quorum-immunity': runImmunity };

// dispatch(fx): route one fixture to its runner. A runner that throws is a FAILED fixture that shipped
// nothing (never a silent skip and never a false positive) - the failure is recorded, never swallowed.
async function dispatch(fx) {
  const runner = RUNNERS[fx.kind];
  if (!runner) throw new Error('unknown fixture kind: ' + JSON.stringify(fx.kind) + ' (' + fx.name + ')');
  try {
    return await runner(fx);
  } catch (e) {
    // FAIL-OPEN: a runner throw is RECORDED as a FAILED fixture (passed:false, shipped:false, the cause
    // in `detail`), so a broken fixture fails the harness LOUDLY and is never swallowed into a pass or a
    // false positive (Rule 4: a failure may never report success).
    return { name: fx.name, kind: fx.kind, passed: false, shipped: false, expectPositive: fx.class === 'known-breach', abstained: true, immunityVeto: false, detail: 'ERROR: ' + String((e && e.message) || e).slice(0, 160) };
  }
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) throw new Error('fixtures dir missing: ' + FIXTURES_DIR);
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')));
}

// classifyOutcome(r) -> 'tp'|'fp'|'fn'|null for one classification result. Split out of
// tallyClassification so the per-result dispatch is not folded into the accumulation loop.
function classifyOutcome(r) {
  if (r.expectPositive && r.shipped) return 'tp';
  if (!r.expectPositive && r.shipped) return 'fp';
  if (r.expectPositive && !r.shipped) return 'fn';
  return null;
}
function tallyOne(counts, r) {
  const kind = classifyOutcome(r);
  if (kind) counts[kind]++;
  if (r.abstained) counts.abstained++;
}
function precisionOf(tp, fp) {
  return (tp + fp) === 0 ? 1 : tp / (tp + fp);
}
function abstainRateOf(abstained, total) {
  return total ? abstained / total : 0;
}
// tallyClassification(results): the precision + abstain-rate numbers over the classification tasks
// (adjudication/entailment/gate); immunity tasks are counted separately.
function tallyClassification(results) {
  const cls = results.filter((r) => r.expectPositive !== null);
  const counts = { tp: 0, fp: 0, fn: 0, abstained: 0 };
  for (const r of cls) tallyOne(counts, r);
  return {
    total: cls.length, tp: counts.tp, fp: counts.fp, fn: counts.fn,
    precision: precisionOf(counts.tp, counts.fp),
    abstainRate: abstainRateOf(counts.abstained, cls.length),
  };
}

// evaluate(): run every fixture and reduce to the blocking verdict object. No process side effects, so
// the node:test suite can call it directly and assert on precision/abstain-rate.
async function evaluate() {
  const fixtures = loadFixtures();
  if (fixtures.length < 12) throw new Error('the seeded set must hold at least 12 fixtures; found ' + fixtures.length);
  const results = [];
  for (const fx of fixtures) results.push(await dispatch(fx));
  const c = tallyClassification(results);
  const immunityVetoes = results.filter((r) => r.immunityVeto).length;
  const failedExpect = results.filter((r) => !r.passed);
  const ok = c.precision >= 1 && immunityVetoes === 0 && failedExpect.length === 0;
  return { ok, results, immunityVetoes, failedExpect: failedExpect.map((r) => r.name), ...c };
}

function reportHuman(v) {
  console.log('llm/evals: precision + abstain-rate harness (' + v.results.length + ' fixtures)');
  for (const r of v.results) {
    const mark = r.passed ? 'PASS' : 'FAIL';
    console.log('  ' + mark.padEnd(4) + ' [' + r.kind + '] ' + r.name + ': ' + r.detail);
  }
  console.log('  precision=' + v.precision.toFixed(3) + ' (TP=' + v.tp + ' FP=' + v.fp + ' FN=' + v.fn + ') abstain_rate=' + v.abstainRate.toFixed(3) + ' immunity_vetoes=' + v.immunityVetoes);
  if (v.ok) console.log('RESULT: OK - precision 1.000, no immunity veto, every fixture matched its expectation.');
  else console.log('RESULT: FAIL - ' + (v.fp > 0 ? v.fp + ' false positive(s); ' : '') + (v.immunityVetoes > 0 ? v.immunityVetoes + ' immunity veto(es); ' : '') + (v.failedExpect.length ? 'mismatched: ' + v.failedExpect.join(', ') : ''));
}

async function main(argv) {
  const asJson = argv.includes('--json');
  let v;
  try {
    v = await evaluate();
  } catch (e) {
    console.error('llm/evals: HARNESS ERROR - ' + String((e && e.message) || e));
    return 2;
  }
  if (asJson) console.log(JSON.stringify(v, null, 2));
  else reportHuman(v);
  return v.ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = { main, evaluate, loadFixtures, tallyClassification };
