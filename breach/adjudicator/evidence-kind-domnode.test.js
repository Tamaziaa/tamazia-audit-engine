'use strict';
// breach/adjudicator/evidence-kind-domnode.test.js - dom_node classification (T2a). A NEW file (the
// existing evidence-kind.test.js suite is left untouched): it verifies that once real dom_node artifacts
// flow, the classifier routes an ENRICHED dom_node violation candidate to observation/bypass, and that a
// masquerading declared-kind is still quarantined (the C-084/C-085 anti-masquerade invariant holds for the
// new artifact type, not just the port-alias literal already covered by the existing suite).
// Run: node --test breach/adjudicator/evidence-kind-domnode.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyEvidenceKind, OBSERVED_ARTIFACT_TYPES } = require('./evidence-kind.js');
const { ARTIFACT_TYPES } = require('../artifact-types.js');

// An enriched dom_node violation candidate exactly as breach/proposers/propose.js emits it: the observed
// node fields spread under a canonical dom_node type.
function domNodeCandidate(over) {
  return {
    record_id: 'UK_EQUALITY_ACCESSIBILITY',
    kind: 'behavioural',
    artifact: {
      rule_id: 'image-alt', selector: 'main > img:nth-of-type(1)', snippet: '<img src="/hero.png">',
      wcag_sc: '1.1.1', state: 'violation', type: ARTIFACT_TYPES.DOM_NODE,
    },
  };
}

test('DOM_NODE is a canonical artifact type AND is in the adjudicator OBSERVED set', () => {
  assert.equal(ARTIFACT_TYPES.DOM_NODE, 'dom_node');
  assert.ok(OBSERVED_ARTIFACT_TYPES.has('dom_node'), 'dom_node must classify as an observed fact');
});

test('an enriched dom_node violation candidate classifies as observation and BYPASSES the model (C-084)', () => {
  const c = classifyEvidenceKind(domNodeCandidate());
  assert.equal(c.kind, 'observation', 'a failing DOM node is a directly-observed fact, not a text reading');
  assert.equal(c.bypass, true, 'an observed DOM fact ships as a violation carrying its artifact, never adjudicated as text');
  assert.equal(c.valid, true);
});

test('a dom_node candidate that DECLARES observed-behaviour (agreeing kind) is valid and bypasses', () => {
  const c = classifyEvidenceKind(Object.assign(domNodeCandidate(), { evidence_kind: 'observed-behaviour' }));
  assert.equal(c.kind, 'observation');
  assert.equal(c.bypass, true);
  assert.equal(c.valid, true);
});

test('MASQUERADE: a dom_node artifact mislabelled `absence` is REJECTED, never silently dropped (C-085)', () => {
  const c = classifyEvidenceKind(Object.assign(domNodeCandidate(), { evidence_kind: 'absence' }));
  assert.equal(c.valid, false, 'a declared kind disagreeing with the dom_node artifact must be rejected');
  assert.equal(c.bypass, false, 'a masquerade must NEVER bypass the model');
  assert.equal(c.kind, 'observation', 'the artifact governs the resolved kind');
  assert.match(c.reason, /mismatch/i);
});

test('MASQUERADE the other way: a TEXT (quote) artifact declaring itself a dom_node observation is rejected', () => {
  // The dangerous vector: a fabrication-prone text claim dressing itself as an un-arguable DOM fact.
  const c = classifyEvidenceKind({
    record_id: 'X', evidence_kind: 'observation',
    artifact: { type: ARTIFACT_TYPES.QUOTE, text: 'we are fully accessible', surface: 'visible_text' },
  });
  assert.equal(c.valid, false);
  assert.equal(c.bypass, false);
  assert.equal(c.kind, 'absence', 'the quote artifact governs: it is the adjudicated text class');
});
