'use strict';
// evidence/browser/dom-assert-predicates.test.js - node:test for the extracted pure-predicate module
// (P6, split out of dom-assert.js to keep that file under the single-purpose file cap).
//
// This module is REACHED TWO WAYS in this repo: directly here (proving the module is independently
// sound and does not silently depend on dom-assert.js's own scope), and indirectly through
// dom-assert.js's re-export (dom-assert.test.js, which exercises the SAME functions via the public
// require('./dom-assert.js') API every real consumer uses - breach/proposers/propose.js among them).
// This file therefore stays a SHORT smoke/reachability suite, not a duplicate of dom-assert.test.js's
// exhaustive positive/negative-control coverage (avoiding the jscpd cross-file clone class, C-216).

const test = require('node:test');
const assert = require('node:assert/strict');

const predicates = require('./dom-assert-predicates.js');
const { controlNode, buildNodes, DOM_RULE_TIER, tierOf, nodeOf } = predicates;

test('the module is requirable directly (not only through dom-assert.js) and exports the full predicate set', () => {
  const expected = [
    'buildNodes', 'nodeOf', 'imgNode', 'controlNode', 'labelTextOf', 'hasAnyLabelRoute', 'EXCLUDED_CONTROL_TYPES',
    'htmlNode', 'linkNode', 'buttonNode', 'contrastNode', 'formNode', 'checkboxNode', 'parseColour',
    'contrastRatio', 'isLargeText', 'DOM_RULE_TIER', 'tierOf', 'CHECK_PREDICATE',
  ];
  for (const key of expected) assert.equal(typeof predicates[key] !== 'undefined', true, 'missing export: ' + key);
});

test('nodeOf stamps the tier from the DOM_RULE_TIER door; controlNode grades a plain descriptor with no browser', () => {
  const violation = nodeOf({ selector: 'input#x', snippet: '<input id="x">' }, 'label', 'violation');
  assert.deepEqual(Object.keys(violation).sort(), ['rule_id', 'selector', 'snippet', 'state', 'tier', 'wcag_sc']);
  assert.equal(violation.tier, 'deterministic');

  const unlabelled = controlNode({ selector: 'input#x', snippet: '<input id="x">', controlType: 'text' });
  assert.equal(unlabelled.state, 'violation', 'a descriptor with no labelling-route fields is genuinely unlabelled');

  const labelled = controlNode({
    selector: 'input#x', snippet: '<input id="x">', controlType: 'text',
    labelElementText: 'Name', hasLabelElementRef: true,
  });
  assert.equal(labelled, null, 'a resolved label route is a pass, reachable independently of dom-assert.js');
});

test('DOM_RULE_TIER + tierOf: the eight-check partition and the fail-closed default (mirrors dom-assert.test.js)', () => {
  assert.deepEqual(Object.keys(DOM_RULE_TIER).sort(), [
    'button-name', 'color-contrast', 'html-has-lang', 'image-alt', 'insecure-form', 'label', 'link-name', 'pre-ticked-consent',
  ]);
  assert.equal(tierOf('image-alt'), 'deterministic');
  assert.equal(tierOf('unmapped-future-check'), 'risk', 'fail-closed: an unclassified check never auto-ships as a hard violation');
});

test('buildNodes dispatches by the check tag and drops unknown/passing descriptors', () => {
  const nodes = buildNodes([
    { check: 'img', selector: 'img', snippet: '<img>', hasAlt: false },
    { check: 'img', selector: 'img2', snippet: '<img alt="">', hasAlt: true },
    { check: 'not-a-real-check', selector: 'x', snippet: '<x>' },
  ]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].rule_id, 'image-alt');
});
