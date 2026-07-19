'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const viaIndex = require('./index.js');
const direct = require('./quote-match.js');
const { CODES } = require('./result.js');
const { DOM_CODES } = require('./dom-node.js');

// index.js is the dom_node-aware dispatch door (T2a). It re-exports quote-match.js's public API verbatim
// EXCEPT verifyCandidate/verifyAll, which it overrides to route a dom_node artifact to dom-node.js while
// delegating every other type to quote-match unchanged, and it adds verifyDomNode.
test('index.js re-exports the non-dispatch quote-match members by the SAME reference', () => {
  assert.equal(viaIndex.verifyQuote, direct.verifyQuote);
  assert.equal(viaIndex.normaliseWhitespace, direct.normaliseWhitespace);
  assert.equal(viaIndex.resolveQuoteArtifact, direct.resolveQuoteArtifact);
  assert.equal(viaIndex.CODES, direct.CODES);
});

test('index.js OVERRIDES the two dispatch entry points and ADDS verifyDomNode', () => {
  assert.notEqual(viaIndex.verifyCandidate, direct.verifyCandidate, 'verifyCandidate is the dom_node-aware override');
  assert.notEqual(viaIndex.verifyAll, direct.verifyAll, 'verifyAll is keyed off the override');
  assert.equal(typeof viaIndex.verifyDomNode, 'function');
  assert.deepEqual(Object.keys(viaIndex).sort(), Object.keys(direct).concat(['verifyDomNode']).sort());
});

test('a non-dom_node candidate still delegates to quote-match unchanged (an unknown type fails closed)', () => {
  const r = viaIndex.verifyCandidate({ rule_id: 'X', artifact: { type: 'not_a_type' } }, {});
  assert.equal(r.verified, false);
  assert.equal(r.code, CODES.UNKNOWN_ARTIFACT_TYPE);
});

test('a dom_node candidate is routed to the dom-node verifier (a fabricated node is rejected)', () => {
  const bundle = { browser: { domLane: { ran: true, reason: null }, domNodes: [] } };
  const r = viaIndex.verifyCandidate({ record_id: 'A', artifact: { type: 'dom_node', rule_id: 'image-alt', selector: 'img', snippet: '<img>' } }, bundle);
  assert.equal(r.verified, false);
  assert.equal(r.code, DOM_CODES.DOM_NODE_NOT_OBSERVED, 'dom_node routing reached dom-node.js, not quote-match');
});

test('verifyAll routes a mixed candidate set: a verified dom_node lands in verified[], a quote mismatch in rejected[]', () => {
  const node = { rule_id: 'image-alt', selector: 'img:nth-of-type(1)', snippet: '<img src=x>', wcag_sc: '1.1.1', state: 'violation' };
  const bundle = {
    browser: { domLane: { ran: true, reason: null }, domNodes: [node] },
    corpus: { pages: [{ url: 'https://x/', text: 'hello world' }] },
  };
  const domCand = { record_id: 'A', artifact: Object.assign({ type: 'dom_node' }, { rule_id: node.rule_id, selector: node.selector, snippet: node.snippet }) };
  const badQuote = { rule_id: 'B', artifact: { type: 'quote', page_url: 'https://x/', surface: 'visible_text', quote: 'not on the page at all' } };
  const { verified, rejected } = viaIndex.verifyAll([domCand, badQuote], bundle);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].candidate, domCand, 'the ORIGINAL candidate reference is carried');
  assert.equal(verified[0].code, DOM_CODES.DOM_NODE_VERIFIED);
  assert.ok(rejected.some((r) => r.candidate === badQuote));
});

test('verifyAll fails closed on a non-array candidates list (never a false clean)', () => {
  assert.throws(() => viaIndex.verifyAll(null, {}), TypeError);
});
