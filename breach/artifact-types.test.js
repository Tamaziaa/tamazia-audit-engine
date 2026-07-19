'use strict';
// breach/artifact-types.test.js - node:test for the one-door artifact-type enum.
// Run: node --test breach/artifact-types.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { ARTIFACT_TYPES, isArtifactType } = require('./artifact-types.js');

test('the closed enum is exactly the six canonical artifact types, and it is frozen', () => {
  assert.ok(Object.isFrozen(ARTIFACT_TYPES));
  assert.deepEqual(
    Object.values(ARTIFACT_TYPES).slice().sort(),
    ['coverage_proof', 'dom_node', 'network_event', 'quote', 'register_absence', 'register_row']
  );
});

test('the enum values are unique strings', () => {
  const values = Object.values(ARTIFACT_TYPES);
  assert.equal(new Set(values).size, values.length);
  for (const v of values) assert.equal(typeof v, 'string');
});

test('the frozen enum object cannot be mutated: a strict-mode write throws rather than silently succeeding', () => {
  assert.throws(() => { ARTIFACT_TYPES.SMUGGLED = 'smuggled'; }, TypeError);
  assert.equal(ARTIFACT_TYPES.SMUGGLED, undefined);
});

test('isArtifactType accepts every canonical type and rejects everything else', () => {
  for (const v of Object.values(ARTIFACT_TYPES)) assert.equal(isArtifactType(v), true);
  // 'dom_node' IS now canonical (the failing-DOM-node artifact, T2a); it is asserted valid by the loop
  // above. The remaining old-estate literals are NOT canonical artifact types (they are port aliases
  // handled only by the adjudicator's evidence-kind classifier, never by this one-door enum).
  for (const bad of ['corpus_quote', 'network_request', 'cookie_jar_entry', 'failing_dom_node', '', null, undefined, 5, {}]) {
    assert.equal(isArtifactType(bad), false, JSON.stringify(bad) + ' must not be a canonical artifact type');
  }
});
