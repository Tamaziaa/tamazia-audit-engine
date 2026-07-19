'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for evidence/browser/dom-assert.js's
// `label` predicate (WCAG 1.3.1).
//
// THE DISEASE (repetition-audit-2026-07-19.md, legal-uk.md Fix 2, hidden-defects.md DG-02): the label
// predicate fired 6/6 false "missing label" violations on a real WPForms/Elementor contact form whose
// inputs ALL carried a correct `<label for="id">`. Root cause: the predicate trusted a SINGLE signal
// (the browser's native `el.labels` collection, which is ID-RESOLUTION based and silently returns EMPTY
// for a control whose id is duplicated elsewhere in the document - a real page-builder pattern) for the
// whole "wrapping or for/id" route, and it shipped straight to a hard `violation` at deterministic tier
// with no adjudicator safety net. This is the worst class this project tracks: accusing the compliant.
//
// A checker that has "fixed" this must PROVE BOTH a positive AND a negative control on the SAME predicate:
//   - POSITIVE: a genuinely unlabelled input STILL yields the violation (the fix did not trade a false
//     accusation for a false negative that lets real WCAG 1.3.1 breaches through unflagged);
//   - NEGATIVE (x6): a wrapping label, an aria-label, an aria-labelledby, an explicit for/id match, a
//     title attribute, and hidden/submit/button/reset/image control types ALL yield NOTHING;
//   - THE REGRESSION ITSELF: native `.labels` empty (the duplicate-id class) but an independent
//     `label[for="id"]` document query finds real text -> must NOT false-accuse.
// A detector still trusting the single old signal fails the regression case even while it passes trivial
// wrapping-label sanity checks, so that case is the load-bearing trap here.
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p4-risk-domnode-never-hard-violation.js):
// calibrate() returns findings on a correct catch, [] (misses printed to stderr) on any regression.
// Standalone: `node eval/calibration-known-bad/fixtures/p6-domassert-label-no-false-accusation.js` exits
// 1 on a miss. Self-sufficient (drives the real module's pure predicates directly, no compiled catalogue
// or browser needed), so it runs safely BEFORE the catalogue compile in CI.

const path = require('path');
const { controlNode } = require(path.resolve(__dirname, '..', '..', '..', 'evidence', 'browser', 'dom-assert.js'));

// bareControl(): every labelling-route field explicitly empty/false - the baseline every scenario diffs from.
function bareControl(over) {
  return Object.assign({
    selector: 'input#field', snippet: '<input id="field">', controlType: 'text',
    labelElementText: '', forIdLabelText: '', wrappingLabelText: '', ariaLabelText: '', ariaLabelledbyText: '', titleText: '',
    hasLabelElementRef: false, hasForIdLabelRef: false, hasWrappingLabelRef: false,
    hasAriaLabelAttr: false, hasAriaLabelledbyAttr: false, hasTitleAttr: false,
  }, over || {});
}

function runTrials() {
  const misses = [];

  // POSITIVE: a genuinely unlabelled input must still be caught.
  const unlabelled = controlNode(bareControl());
  if (!unlabelled || unlabelled.state !== 'violation') {
    misses.push('POSITIVE CONTROL FAILED: a genuinely unlabelled input did not yield a violation - got ' + JSON.stringify(unlabelled));
  }

  // NEGATIVE x6: every valid labelling route, tested independently, yields nothing.
  const negatives = [
    ['wrapping label (.labels)', bareControl({ labelElementText: 'Your Name', hasLabelElementRef: true })],
    ['explicit for/id', bareControl({ forIdLabelText: 'Your Phone No', hasForIdLabelRef: true })],
    ['ancestor-walk wrapping label', bareControl({ wrappingLabelText: 'Email address', hasWrappingLabelRef: true })],
    ['aria-label', bareControl({ ariaLabelText: 'Search', hasAriaLabelAttr: true })],
    ['aria-labelledby', bareControl({ ariaLabelledbyText: 'Postcode', hasAriaLabelledbyAttr: true })],
    ['title', bareControl({ titleText: 'Enter your postcode', hasTitleAttr: true })],
  ];
  for (const [name, desc] of negatives) {
    const node = controlNode(desc);
    if (node !== null) misses.push('NEGATIVE CONTROL FAILED (' + name + '): a correctly-labelled input was flagged - ' + JSON.stringify(node));
  }
  for (const controlType of ['hidden', 'submit', 'button', 'reset', 'image']) {
    const node = controlNode(bareControl({ controlType }));
    if (node !== null) misses.push('NEGATIVE CONTROL FAILED (' + controlType + '): a non-labellable control type was flagged - ' + JSON.stringify(node));
  }

  // THE REGRESSION TRAP: native .labels EMPTY (duplicate-id class) but an explicit for/id match exists.
  // This is the exact WPForms shape legal-uk.md Fix 2 documented: 6/6 real fields false-accused this way.
  const wpformsField = bareControl({
    selector: 'input#wpforms-1523-field_1', snippet: '<input id="wpforms-1523-field_1">',
    forIdLabelText: 'Name', hasForIdLabelRef: true,
    labelElementText: '', hasLabelElementRef: false, // simulates .labels resolving EMPTY (duplicate id)
  });
  const wpformsResult = controlNode(wpformsField);
  if (wpformsResult !== null) {
    misses.push('CRITICAL REGRESSION (legal-uk.md Fix 2 class): native .labels empty but a real for/id label exists, and the control was STILL FLAGGED - got ' + JSON.stringify(wpformsResult));
  }

  return misses;
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p6-domassert-label-no-false-accusation',
    message: 'trap caught: a genuinely unlabelled input still yields a violation (positive control), every valid labelling route (wrapping/for-id/aria-label/aria-labelledby/title, plus the duplicate-id class where native .labels resolves empty but an explicit for/id match exists) yields NOTHING (negative controls), and non-labellable control types are never checked',
  }];
}

module.exports = { bareControl, runTrials, calibrate };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p6-domassert-label-no-false-accusation: trap MISSED - the label predicate is not structurally barred from false-accusing a correctly-labelled control');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p6-domassert-label-no-false-accusation', findings }));
  process.exit(0);
}
