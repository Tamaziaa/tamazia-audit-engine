'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for breach/adjudicator/adjudicate.js (W6).
//
// THE DISEASE (caution.md C-048 + Constitution Rule 6/Rule 10): a RISK-based legal duty asserted as a
// hard breach FALSE-ACCUSES. An https page whose form posts to an http action is a transport-security
// RISK INDICATOR under UK GDPR Art 32 - a risk-based duty needing the controller's own assessment, not an
// automatic breach. The dom_node lane observes that insecure form deterministically (the form IS present),
// but its LEGAL characterisation is not deterministic. If the adjudicator lets a risk-indicator dom_node
// take the observed-fact bypass and ship as a hard `violation`, it accuses a firm that may have
// compensating controls - the exact C-048 class this repo exists to stop. The mirror danger is
// over-correction: demoting EVERY dom_node to needs-review would silently lose the real, deterministic
// accessibility violations (a missing alt attribute IS a WCAG 1.1.1 breach). The adjudicator must:
//   - quarantine the risk-indicator insecure-form node to `needs_review` (NEVER `violation`), keeping its
//     dom_node artifact (Rule 3, evidence-backed) and never calling the model (there is no text to judge);
//   - STILL ship the deterministic missing-alt node as a hard `violation` (the guard is not vacuously safe);
//   - emit exactly one finding per input candidate, each in the closed three-state enum.
// A detector that lets a risk node ship as a violation - or that demotes the deterministic one - has not
// earned its zero (Constitution Rule 4).
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p3-adjudicator-invented-finding.js): calibrate()
// returns findings on a correct catch, [] (misses printed to stderr) on any regression. Standalone:
// `node eval/calibration-known-bad/fixtures/p4-risk-domnode-never-hard-violation.js` exits 1 on a miss.
// Self-sufficient (candidates only, no compiled catalogue), so it runs safely BEFORE the catalogue compile.

const path = require('path');
const { adjudicate } = require(path.resolve(__dirname, '..', '..', '..', 'breach', 'adjudicator', 'adjudicate.js'));

// Two dom_node candidates exactly as breach/proposers/propose.js emits them (the observed node fields
// spread under a canonical dom_node type, carrying the finding tier evidence/browser/dom-assert.js stamps).
function inputCandidates() {
  return [
    // RISK: an https page whose form posts to an http action - a confirmed observation, but a risk-based
    // (Art 32) characterisation. It MUST quarantine to needs_review, never ship as a hard violation.
    { _probe: 'risk', record_id: 'UK_DATA_SECURITY_TRANSPORT', code: 'ART32_TRANSPORT', description: 'a form on an https page submits to an http action',
      artifact: { type: 'dom_node', rule_id: 'insecure-form', selector: 'form#enquiry', snippet: '<form action="http://clinic.example/submit">', wcag_sc: null, state: 'violation', tier: 'risk' } },
    // DETERMINISTIC control: a missing alt. The DOM fact IS the breach, so a hard violation MUST still ship
    // - this proves the guard demotes ONLY risk-tier nodes, never every dom_node (the over-correction).
    { _probe: 'deterministic', record_id: 'FAKE_A11Y_2099', code: 'WCAG_1_1_1', description: 'an image with no alt attribute',
      artifact: { type: 'dom_node', rule_id: 'image-alt', selector: 'main > img:nth-of-type(1)', snippet: '<img src="/hero.png">', wcag_sc: '1.1.1', state: 'violation', tier: 'deterministic' } },
  ];
}

async function runTrials() {
  const misses = [];
  const input = inputCandidates();
  let llmCalls = 0;
  const { findings, report } = await adjudicate(input, { domain: 'clinic.example', sector: 'healthcare', country: 'UK' }, {
    // The model must NEVER be invoked: both nodes are observations (one bypasses to violation, one routes to
    // review). A caller that throws proves it was never reached on the safe path.
    llmCall: async () => { llmCalls += 1; throw new Error('the model must NEVER be called for a dom_node observation'); },
    deadlineMs: 4000, now: () => Date.now(),
  });

  if (findings.length !== input.length) {
    misses.push('FILTER-ONLY BROKEN: |output|=' + findings.length + ' != |input|=' + input.length);
    return misses; // a size mismatch invalidates the rest of the assertions
  }

  const risk = findings.find((f) => f._probe === 'risk');
  if (!risk || risk.state !== 'needs_review') {
    misses.push('CRITICAL (C-048): the risk-indicator insecure-form node did NOT quarantine to needs_review - a risk-based Art 32 duty must never be asserted as a hard breach: got ' + JSON.stringify(risk && risk.state));
  }
  if (risk && risk.state === 'violation') {
    misses.push('CRITICAL: a risk indicator SHIPPED AS A HARD VIOLATION via the observed-fact bypass - the exact C-048 false accusation W6 exists to close');
  }
  if (risk && !risk.artifact) misses.push('the risk finding lost its dom_node artifact - a needs-review item must stay evidence-backed (Rule 3)');

  const det = findings.find((f) => f._probe === 'deterministic');
  if (!det || det.state !== 'violation') {
    misses.push('OVER-CORRECTION: the deterministic missing-alt node did NOT ship as a hard violation - the guard is demoting every dom_node instead of only risk-tier ones: got ' + JSON.stringify(det && det.state));
  }

  if (llmCalls !== 0) misses.push('the model was invoked for a dom_node observation (it must never be - the node is a fact, not a text reading)');

  const badState = findings.find((f) => !['violation', 'needs_review', 'pass'].includes(f.state));
  if (badState) misses.push('a finding carries a state outside the closed three-state enum: ' + JSON.stringify(badState.state));

  if (report.risk_review !== 1) misses.push('report.risk_review should count exactly one quarantined risk indicator: got ' + JSON.stringify(report.risk_review));
  return misses;
}

async function calibrate() {
  const misses = await runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p4-risk-domnode-never-hard-violation',
    message: 'trap caught: a risk-indicator insecure-form node quarantines to needs_review (never a hard Art 32 violation, C-048) while a deterministic missing-alt node still ships as a violation; the model is never called for either (Rule 6/Rule 10)',
  }];
}

module.exports = { inputCandidates, runTrials, calibrate };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p4-risk-domnode-never-hard-violation: trap MISSED - a risk-indicator dom_node is not structurally barred from a hard violation');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p4-risk-domnode-never-hard-violation', findings }));
    process.exit(0);
  });
}
