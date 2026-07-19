#!/usr/bin/env node
'use strict';
/**
 * breach/verifiers/dom-node.js - verifies a `dom_node` artifact (Constitution Rule 3: "a failing DOM
 * node" is the fourth thing a breach finding may carry as its deterministic artifact; caution.md C-080).
 *
 * Contract (candidate.artifact when type === 'dom_node'):
 *   { type: 'dom_node', rule_id, selector, snippet, wcag_sc?, state? }
 * The identifying triple mirrors an entry emitted by the axe-style assertion lane
 * (evidence/browser/dom-assert.js), stored on the bundle as:
 *   bundle.browser.domNodes[]  -> [{ rule_id, selector, snippet, wcag_sc, state }]  (state in violation|incomplete)
 *   bundle.browser.domLane     -> { ran, reason }                                    (the lane's own honesty record)
 *
 * verifyDomNode never RE-DERIVES the DOM fact (that stays evidence/browser/dom-assert.js's one door): it
 * only proves the candidate's cited node is one the lane ACTUALLY observed AS A VIOLATION, by exact field
 * match against bundle.browser.domNodes. It fails CLOSED (Rule 4):
 *   dom_node_missing_fields  the artifact is missing rule_id / selector / snippet.
 *   dom_lane_absent          the DOM lane did not run (domLane.ran !== true); there is nothing to verify
 *                            against, and an un-run lane can never back-fill a claim (C-041).
 *   dom_node_not_observed    the lane ran but flagged NO node with this (rule_id, selector) at all - a
 *                            fabricated selector/rule the lane never saw.
 *   dom_node_mismatch        the lane flagged this (rule_id, selector) BUT the cited snippet differs, or
 *                            the observed node's state is not `violation` (e.g. the lane graded it
 *                            `incomplete`/needs-review - it can never back-fill a hard violation, Rule 10).
 *
 * The reason codes are defined LOCALLY here rather than in breach/verifiers/result.js because result.js's
 * CODES object is frozen and outside this change's file scope; the shared `accepted`/`rejected` envelope
 * builders (which do not validate the code against CODES) are reused so the result shape is identical to
 * every sibling verifier. Pure data: no I/O, no clock, no env, no law/fine/regulator literal (Rule 2).
 */
const { accepted, rejected } = require('./result');

const DOM_CODES = Object.freeze({
  DOM_NODE_VERIFIED: 'dom_node_verified',
  DOM_NODE_MISSING_FIELDS: 'dom_node_missing_fields',
  DOM_LANE_ABSENT: 'dom_lane_absent',
  DOM_NODE_NOT_OBSERVED: 'dom_node_not_observed',
  DOM_NODE_MISMATCH: 'dom_node_mismatch',
});

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}
function hasMissingIdentityFields(artifact) {
  return !artifact || !isNonEmptyString(artifact.rule_id) || !isNonEmptyString(artifact.selector) || !isNonEmptyString(artifact.snippet);
}
function domLaneDidNotRun(browser) {
  return !browser || !browser.domLane || browser.domLane.ran !== true;
}
function domNodesOf(browser) {
  return Array.isArray(browser.domNodes) ? browser.domNodes : [];
}

// sameElementCheck(entry, artifact) -> the entry is the SAME (rule_id, selector) DOM check as the artifact
// cites (the element + check identity, before the snippet/state cross-check). An EQUALITY test throughout,
// never a substring/includes test (a selector is compared by exact identity, never by token - GAPS
// host-substring's sibling doctrine for selectors).
function sameElementCheck(entry, artifact) {
  return Boolean(entry) && typeof entry === 'object' && entry.rule_id === artifact.rule_id && entry.selector === artifact.selector;
}
// exactViolationMatch(entry, artifact) -> the entry is the exact cited node AND the lane graded it a
// violation (an `incomplete`/needs-review node can NEVER back a hard violation candidate - Rule 10).
function exactViolationMatch(entry, artifact) {
  return sameElementCheck(entry, artifact) && entry.snippet === artifact.snippet && entry.state === 'violation';
}

// verifyDomNode(candidate, bundle) -> {verified, code, reason}. Fails closed on missing identity fields, an
// un-run DOM lane, a cited node with no matching observation (fabricated), or a citation that drifted from
// the observation (snippet/state mismatch). Never throws.
function verifyDomNode(candidate, bundle) {
  const artifact = candidate && candidate.artifact;
  if (hasMissingIdentityFields(artifact)) {
    return rejected(
      DOM_CODES.DOM_NODE_MISSING_FIELDS,
      'artifact.rule_id, artifact.selector and artifact.snippet are all required to identify a dom_node candidate'
    );
  }
  const browser = bundle && bundle.browser;
  if (domLaneDidNotRun(browser)) {
    return rejected(
      DOM_CODES.DOM_LANE_ABSENT,
      'bundle.browser.domLane did not run (ran !== true); there is no DOM observation to verify a dom_node against'
    );
  }
  const domNodes = domNodesOf(browser);
  if (domNodes.some((entry) => exactViolationMatch(entry, artifact))) {
    return accepted(DOM_CODES.DOM_NODE_VERIFIED, 'matched a violation entry in bundle.browser.domNodes');
  }
  if (domNodes.some((entry) => sameElementCheck(entry, artifact))) {
    return rejected(
      DOM_CODES.DOM_NODE_MISMATCH,
      'a bundle.browser.domNodes entry matches rule_id=' + JSON.stringify(artifact.rule_id)
        + ' selector=' + JSON.stringify(artifact.selector) + ' but its snippet or observed state differs'
        + ' (a drifted citation, or a non-violation observation that cannot back a hard violation)'
    );
  }
  return rejected(
    DOM_CODES.DOM_NODE_NOT_OBSERVED,
    'no entry in bundle.browser.domNodes matches rule_id=' + JSON.stringify(artifact.rule_id)
      + ' selector=' + JSON.stringify(artifact.selector) + ' (a DOM node the lane never observed)'
  );
}

// ---------------------------------------------------------------------------------
// Calibration CLI (the earn-your-zero contract, eval/calibration-known-bad/run.js dialect; mirrors
// breach/verifiers/quote-match.js's --calibrate convention exactly, but scans p4-verifier-*.json fixtures
// so the two verifier calibrations never cross-pick each other's fixtures).
// `node breach/verifiers/dom-node.js --calibrate [--json <path>]` runs every p4-verifier-*.json fixture
// under eval/calibration-known-bad/fixtures/ through verifyDomNode. Each fixture plants a candidate that
// MUST be REJECTED; a finding is emitted only when the rejection actually happens (and matches the
// fixture's expected_code, when given). Zero findings means this gate is broken. The fixtures are
// self-sufficient (candidate + bundle only): this calibration needs NO compiled catalogue, so it is safe
// to run BEFORE the catalogue compile in CI (verified: CI runs calibration first).
// ---------------------------------------------------------------------------------
function runOneFixture(file, fixture) {
  const result = verifyDomNode(fixture.candidate, fixture.bundle);
  const poison = fixture.poison || {};
  const expectedCode = poison.expected_code;
  const caught = result.verified === false && (!expectedCode || result.code === expectedCode);
  if (!caught) return [];
  return [{
    file,
    line: 1,
    rule: 'p4-verifier-domnode-rejected',
    message: 'refused the poisoned dom_node candidate (' + result.code + '): ' + result.reason,
  }];
}

function runCalibration(fixturesDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = fixturesDir || path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
  const findings = [];
  const files = fs.readdirSync(dir).filter((f) => /^p4-verifier-.*\.json$/.test(f)).sort();
  for (const f of files) {
    if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(f)) {
      throw new Error('unsafe path component: ' + JSON.stringify(f));
    }
    const abs = path.join(dir, f);
    const fixture = JSON.parse(fs.readFileSync(abs, 'utf8'));
    findings.push(...runOneFixture(abs, fixture));
  }
  return findings;
}

function calibrateMain(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  const findings = runCalibration();
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify({ checker: 'breach-verifiers-domnode', findings }) + '\n');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--calibrate')) {
    process.exit(calibrateMain(process.argv));
  } else {
    console.error('breach/verifiers/dom-node.js is a library. Only --calibrate is runnable from the CLI.');
    process.exit(2);
  }
}

module.exports = {
  verifyDomNode,
  sameElementCheck,
  exactViolationMatch,
  DOM_CODES,
  runCalibration,
  calibrateMain,
};
