'use strict';
// breach/dom-node-lane.test.js - the dom_node artifact END TO END, without Playwright (T2a).
//
// Proves the fourth Rule-3 artifact flows through the whole breach chain: a synthetic bundle carrying one
// observed image-alt VIOLATION (as evidence/browser/dom-assert.js would emit) plus a synthetic accessibility
// behavioural obligation -> propose() emits ONE dom_node candidate -> verifyAll() ACCEPTS it against
// bundle.browser.domNodes -> adjudicate() ships it as a `violation` via the observed-fact BYPASS, with the
// injected llmCall NEVER called (an observed DOM fact is not a reading of text). No real browser involved:
// the bundle IS the lane's output, so this is a pure, deterministic end-to-end proof.
// Run: node --test breach/dom-node-lane.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { propose } = require('./proposers/propose.js');
const { verifyAll } = require('./verifiers/index.js');
const { adjudicate } = require('./adjudicator/adjudicate.js');
const coverageContract = require('../evidence/crawler/coverage-contract.js');

// A synthetic accessibility behavioural obligation (FAKE_ id only, C-071 - no real law name needed; the
// duty text carries the accessibility tokens the dom_node router intersects).
function catalogue() {
  return {
    records: [{
      id: 'FAKE_A11Y_2099',
      regulator: {},
      citation: {},
      website_obligations: [{
        duty: 'The website must be accessible to users with disabilities, including screen reader users',
        elements: ['content is accessible to disabled and screen reader users'],
        evidence_type: 'behavioural',
      }],
    }],
  };
}

// A three-page readable corpus (satisfies the readable-bundle floor) plus the DOM lane's output: one
// image-alt violation and one color-contrast INCOMPLETE (which must never become a candidate, Rule 10).
const REAL_NODE = { rule_id: 'image-alt', selector: 'main > img:nth-of-type(1)', snippet: '<img src="/hero.png">', wcag_sc: '1.1.1', state: 'violation' };
function bundle() {
  return {
    domain: 'clinic.example',
    corpus: {
      pages: [
        { url: 'https://clinic.example/', title: 'Home', text: 'Welcome to our clinic, a friendly team helping the local community every single day here.', jsonLd: [] },
        { url: 'https://clinic.example/about', title: 'About', text: 'About our practice and the people who founded it many years ago with real and lasting care.', jsonLd: [] },
        { url: 'https://clinic.example/contact', title: 'Contact', text: 'Contact the reception desk during opening hours for an appointment or any general enquiry today.', jsonLd: [] },
      ],
      footerText: 'Contact us at reception.',
      truncated: false,
    },
    registers: { notes: [] },
    browser: {
      lane: { ran: true, reason: null },
      observed: [],
      consentControl: { found: false, healthy: null, url: null },
      domLane: { ran: true, reason: null },
      domNodes: [
        REAL_NODE,
        { rule_id: 'color-contrast', selector: 'p:nth-of-type(2)', snippet: '<p>text</p>', wcag_sc: '1.4.3', state: 'incomplete' },
      ],
    },
  };
}

function coverageFor(b, cat) {
  return coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: b.corpus.truncated });
}

test('propose emits exactly one dom_node candidate (the violation), never the incomplete node (Rule 10)', () => {
  const b = bundle();
  const cat = catalogue();
  const fired = propose(b, cat, coverageFor(b, cat)).filter((c) => !c.suppressed_reason);
  assert.equal(fired.length, 1, 'one accessibility violation, no candidate for the incomplete contrast node');
  assert.equal(fired[0].artifact.type, 'dom_node');
  assert.equal(fired[0].artifact.rule_id, 'image-alt');
  assert.equal(fired[0].artifact.state, 'violation');
});

test('verifyAll ACCEPTS the dom_node candidate against bundle.browser.domNodes', () => {
  const b = bundle();
  const cat = catalogue();
  const candidates = propose(b, cat, coverageFor(b, cat)).filter((c) => !c.suppressed_reason);
  const { verified, rejected } = verifyAll(candidates, b);
  assert.equal(verified.length, 1, 'the observed violation verifies');
  assert.equal(rejected.length, 0);
  assert.equal(verified[0].code, 'dom_node_verified');
});

test('adjudicate ships the verified dom_node as a violation via the observed-fact BYPASS (llm never called)', async () => {
  const b = bundle();
  const cat = catalogue();
  const candidates = propose(b, cat, coverageFor(b, cat)).filter((c) => !c.suppressed_reason);
  const { verified } = verifyAll(candidates, b);

  let llmCalls = 0;
  const llmCall = async () => { llmCalls += 1; throw new Error('the model must NEVER be called for an observed DOM fact (C-084)'); };

  const { findings, report } = await adjudicate(verified.map((v) => v.candidate), b, { llmCall });
  assert.equal(findings.length, 1, 'filter-only: one finding per input candidate');
  assert.equal(findings[0].state, 'violation', 'an observed DOM fact ships as a hard violation');
  assert.equal(findings[0].adjudicated, true);
  assert.equal(findings[0].artifact.type, 'dom_node', 'the finding still carries its dom_node artifact');
  assert.equal(report.observed_fact, 1);
  assert.equal(report.text_derived, 0, 'a bypassing observation is never routed to text adjudication');
  assert.equal(llmCalls, 0, 'the injected llmCall must not be invoked for a bypassing observation');
});

test('a FABRICATED dom_node candidate is rejected by verifyAll and never reaches a violation', async () => {
  const b = bundle();
  // A candidate citing a selector the lane never observed (a fabricated node).
  const fabricated = { record_id: 'FAKE_A11Y_2099', kind: 'behavioural', artifact: { type: 'dom_node', rule_id: 'image-alt', selector: 'footer > img:nth-of-type(9)', snippet: '<img src="/ghost.png">', wcag_sc: '1.1.1', state: 'violation' } };
  const { verified, rejected } = verifyAll([fabricated], b);
  assert.equal(verified.length, 0, 'a fabricated DOM node never verifies (Rule 3: no artifact, no breach)');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].code, 'dom_node_not_observed');
});
