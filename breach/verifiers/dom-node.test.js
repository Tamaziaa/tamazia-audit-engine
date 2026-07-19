'use strict';
// breach/verifiers/dom-node.test.js - node:test for the dom_node artifact verifier (Rule 3 / C-080).
// Run: node --test breach/verifiers/dom-node.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyDomNode, DOM_CODES, runCalibration } = require('./dom-node');

// A real observed violation node, exactly as evidence/browser/dom-assert.js would emit it.
const realNode = {
  rule_id: 'image-alt',
  selector: 'main > img:nth-of-type(1)',
  snippet: '<img src="/hero.png">',
  wcag_sc: '1.1.1',
  state: 'violation',
};

function bundleWith(domNodes, laneRan) {
  return { browser: { domLane: { ran: laneRan !== false, reason: null }, domNodes } };
}
function candFor(over) {
  return { record_id: 'UK_EQUALITY_ACCESSIBILITY', artifact: Object.assign({ type: 'dom_node' }, over) };
}

test('a dom_node candidate matching an observed violation entry is verified', () => {
  const r = verifyDomNode(candFor({ rule_id: realNode.rule_id, selector: realNode.selector, snippet: realNode.snippet }), bundleWith([realNode]));
  assert.equal(r.verified, true);
  assert.equal(r.code, DOM_CODES.DOM_NODE_VERIFIED);
});

test('missing identity fields (rule_id/selector/snippet) are rejected before any bundle lookup', () => {
  const bundle = bundleWith([realNode]);
  const bads = [
    {},
    { rule_id: 'image-alt' },
    { rule_id: 'image-alt', selector: 'img' },
    { rule_id: '', selector: 'img', snippet: '<img>' },
    { rule_id: 'image-alt', selector: 'img', snippet: '' },
  ];
  for (const bad of bads) {
    const r = verifyDomNode(candFor(bad), bundle);
    assert.equal(r.verified, false);
    assert.equal(r.code, DOM_CODES.DOM_NODE_MISSING_FIELDS);
  }
});

test('a DOM lane that never ran cannot back-fill a claim, even if domNodes happens to be non-empty', () => {
  const r = verifyDomNode(candFor({ rule_id: realNode.rule_id, selector: realNode.selector, snippet: realNode.snippet }), bundleWith([realNode], false));
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_LANE_ABSENT);
});

test('an entirely absent bundle.browser is rejected as lane-absent, never a crash', () => {
  const r = verifyDomNode(candFor({ rule_id: 'image-alt', selector: 'img', snippet: '<img>' }), {});
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_LANE_ABSENT);
});

test('a fabricated selector the lane never observed is REJECTED as dom_node_not_observed', () => {
  const r = verifyDomNode(candFor({ rule_id: 'image-alt', selector: 'img:nth-of-type(99)', snippet: '<img src="fake.png">' }), bundleWith([realNode]));
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_NODE_NOT_OBSERVED);
});

test('a fabricated rule_id on a real selector is dom_node_not_observed (rule_id is part of the identity)', () => {
  const r = verifyDomNode(candFor({ rule_id: 'label', selector: realNode.selector, snippet: realNode.snippet }), bundleWith([realNode]));
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_NODE_NOT_OBSERVED);
});

test('a drifted snippet on a real (rule_id, selector) is REJECTED as dom_node_mismatch', () => {
  const r = verifyDomNode(candFor({ rule_id: realNode.rule_id, selector: realNode.selector, snippet: '<img src="/DIFFERENT.png">' }), bundleWith([realNode]));
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_NODE_MISMATCH);
});

test('an INCOMPLETE observed node can never back a hard violation (dom_node_mismatch), Rule 10', () => {
  // The lane graded this exact (rule_id, selector, snippet) as needs-review, not a violation.
  const incomplete = { rule_id: 'color-contrast', selector: 'p:nth-of-type(2)', snippet: '<p>hi</p>', wcag_sc: '1.4.3', state: 'incomplete' };
  const r = verifyDomNode(candFor({ rule_id: incomplete.rule_id, selector: incomplete.selector, snippet: incomplete.snippet }), bundleWith([incomplete]));
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_NODE_MISMATCH, 'an incomplete observation is a mismatch for a violation candidate, never verified');
});

test('the exact-match requires ALL of rule_id, selector and snippet - a snippet-only match on a different selector fails', () => {
  const other = { rule_id: 'image-alt', selector: 'footer > img:nth-of-type(1)', snippet: realNode.snippet, wcag_sc: '1.1.1', state: 'violation' };
  const r = verifyDomNode(candFor({ rule_id: realNode.rule_id, selector: realNode.selector, snippet: realNode.snippet }), bundleWith([other]));
  assert.equal(r.verified, false, 'the snippet alone must not satisfy the match when the selector differs');
  assert.equal(r.code, DOM_CODES.DOM_NODE_NOT_OBSERVED);
});

test('one violation among several observed entries verifies (some-match, not all-match)', () => {
  const nodes = [
    { rule_id: 'label', selector: 'input:nth-of-type(1)', snippet: '<input>', wcag_sc: '1.3.1', state: 'violation' },
    realNode,
    { rule_id: 'html-has-lang', selector: 'html', snippet: '<html>', wcag_sc: '3.1.1', state: 'violation' },
  ];
  const r = verifyDomNode(candFor({ rule_id: realNode.rule_id, selector: realNode.selector, snippet: realNode.snippet }), bundleWith(nodes));
  assert.equal(r.verified, true);
});

test('the verifier never throws on malformed candidate/bundle input', () => {
  for (const badCand of [undefined, null, 0, '', [], { artifact: 'nope' }, { artifact: { type: 'dom_node' } }]) {
    assert.doesNotThrow(() => verifyDomNode(badCand, {}));
    const r = verifyDomNode(badCand, {});
    assert.equal(r.verified, false, 'malformed input can never verify');
  }
});

// The calibration self-test the earn-your-zero runner drives: the seeded fabricated node is rejected.
test('runCalibration catches the seeded p4-verifier fabricated dom_node fixture', () => {
  const findings = runCalibration();
  assert.ok(findings.length >= 1, 'the fabricated-domnode fixture must produce a finding (an earned zero)');
  assert.ok(findings.some((f) => /fabricated-domnode/.test(f.file)), 'the fabricated-domnode fixture is among the caught fixtures');
});
