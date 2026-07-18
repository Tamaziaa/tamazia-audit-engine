'use strict';
/**
 * p3-proposer-unanchored-pattern.js - the C-009 / C-019 / C-059 calibration fixture for the breach
 * proposer's DetectionSpec validator (breach/proposers/detection-spec.js validateSpec).
 *
 * The old estate shipped bare, unanchored patterns that substring-matched their way into false
 * accusations: /^EU/ matched "EUROPEAN" (C-019), "post" matched "postcode" and "pay" matched "payroll"
 * (C-059), and coverage-contract's classify substring-matched "cost" to pricing (C-044). A DetectionSpec
 * carrying such a pattern must be REJECTED by validateSpec, not merely warned about: an unanchored
 * pattern is unrepresentable in what propose.js is allowed to run.
 *
 * breach/proposers/detection-spec.test.js and breach/proposers/propose.test.js load this fixture and
 * assert: every spec in bad[] fails validateSpec with an anchoring reason, and the anchored twin in
 * good passes. Both directions are calibrated (C-203). No real law text: FAKE_ACT_2099 ids only (C-071).
 */

// bad[] - each spec carries exactly one unanchored/bare pattern; validateSpec MUST reject each one.
const bad = [
  {
    why: 'anchored-regex value is a bare token with no \\b, ^ or $ (the /^EU/->EUROPEAN class, C-019)',
    spec: {
      record_id: 'FAKE_ACT_2099_BARE_REGEX',
      duty_idx: 0,
      evidence_type: 'absence',
      surface: 'visible_text',
      patterns: [{ kind: 'anchored-regex', value: 'tonic', negation_guarded: true }],
      page_class: 'any',
    },
  },
  {
    why: 'token-set carries a 2-char token below the anchoring floor (the "post"->postcode class, C-059)',
    spec: {
      record_id: 'FAKE_ACT_2099_SHORT_TOKEN',
      duty_idx: 0,
      evidence_type: 'presence',
      surface: 'visible_text',
      patterns: [{ kind: 'token-set', value: { tokens: ['eu', 'notice'], mode: 'all' }, negation_guarded: false }],
      page_class: 'privacy',
    },
  },
  {
    why: 'url-path is a bare word, not a rooted path segment (the "cost"->/cost-of-living class, C-044)',
    spec: {
      record_id: 'FAKE_ACT_2099_BARE_PATH',
      duty_idx: 0,
      evidence_type: 'presence',
      surface: 'visible_text',
      patterns: [{ kind: 'url-path', value: 'cost', negation_guarded: false }],
      page_class: 'pricing',
    },
  },
];

// good - the anchored twin of bad[0]: an explicit \b-bounded phrase regex. validateSpec MUST accept it.
const good = {
  record_id: 'FAKE_ACT_2099_ANCHORED',
  duty_idx: 0,
  evidence_type: 'absence',
  surface: 'visible_text',
  patterns: [{ kind: 'anchored-regex', value: '\\bmiracle\\W+tonic\\b', negation_guarded: true }],
  page_class: 'any',
};

module.exports = { bad, good };
