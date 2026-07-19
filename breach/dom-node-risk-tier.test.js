'use strict';
// breach/dom-node-risk-tier.test.js - the RISK-tier dom_node END TO END, without Playwright (W6).
//
// The mirror of breach/dom-node-lane.test.js, proving the W6 partition on the FULL breach chain. Two nodes
// flow through propose() -> verifyAll() -> adjudicate() against real+synthetic obligations:
//   - an insecure-form VIOLATION node (an https page whose form posts to an http action) routed to the REAL
//     UK_DATA_SECURITY_TRANSPORT record (UK GDPR Art 32) MUST adjudicate to `needs_review`, carrying its
//     dom_node artifact, with the llmCall NEVER invoked - a risk indicator, never a hard violation (C-048).
//   - a missing-alt VIOLATION node routed to an accessibility duty MUST still ship as a `violation` (the
//     deterministic accessibility class is unchanged; the T2a bypass survives).
// Both nodes are built through the REAL evidence/browser/dom-assert.js predicates, so each carries the
// finding tier the lane actually stamps: this is an end-to-end proof of the real wiring, not a hand-typed
// fixture. The UK_DATA_SECURITY_TRANSPORT record is loaded from the SOURCE pack (not the compiled dist), so
// this proof is independent of the catalogue compile order and of the record's ship status.
// Run: node --test breach/dom-node-risk-tier.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { propose } = require('./proposers/propose.js');
const { verifyAll } = require('./verifiers/index.js');
const { adjudicate } = require('./adjudicator/adjudicate.js');
const { formNode, imgNode } = require('../evidence/browser/dom-assert.js');
const coverageContract = require('../evidence/crawler/coverage-contract.js');
const ukUniversalPack = require('../catalogue/packs/uk-universal.json');

// The REAL Art 32 transport-security record straight from the authored pack (status-independent: propose
// never filters on status - that is the compiler's job - so this uses the exact shipped obligation text).
const TRANSPORT_RECORD = ukUniversalPack.records.find((r) => r.id === 'UK_DATA_SECURITY_TRANSPORT');

// A synthetic accessibility behavioural obligation (FAKE_ id only, C-071) whose tokens the image-alt
// concept intersects - the deterministic mirror. Kept synthetic so the mirror does not couple to another
// real record's token wiring; the transport leg is the one the brief pins to the real record.
const A11Y_RECORD = {
  id: 'FAKE_A11Y_2099', regulator: {}, citation: {},
  website_obligations: [{
    duty: 'The website must be accessible to users with disabilities, including screen reader users',
    elements: ['content is accessible to disabled and screen reader users'],
    evidence_type: 'behavioural',
  }],
};

function catalogue() {
  return { records: [TRANSPORT_RECORD, A11Y_RECORD] };
}

// The two DOM-lane outputs, built through the real predicates so each carries its authentic tier.
const INSECURE_FORM = formNode({ selector: 'form#enquiry', snippet: '<form action="http://clinic.example/submit">', pageScheme: 'https:', actionScheme: 'http:' });
const MISSING_ALT = imgNode({ selector: 'main > img:nth-of-type(1)', snippet: '<img src="/hero.png">', hasAlt: false });

function bundle() {
  return {
    domain: 'clinic.example',
    corpus: {
      pages: [
        { url: 'https://clinic.example/', title: 'Home', text: 'Welcome to our clinic, a friendly team helping the local community every single day here.', jsonLd: [] },
        { url: 'https://clinic.example/contact', title: 'Contact', text: 'Contact the reception desk during opening hours for an appointment or any general enquiry today.', jsonLd: [] },
        { url: 'https://clinic.example/about', title: 'About', text: 'About our practice and the people who founded it many years ago with real and lasting care here.', jsonLd: [] },
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
      domNodes: [INSECURE_FORM, MISSING_ALT],
    },
  };
}

function coverageFor(b, cat) {
  return coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: b.corpus.truncated });
}

// A guard that fails loudly if the whole thing ever runs the model on a bypassing/risk observation.
function neverCallLlm() {
  return async () => { throw new Error('the model must NEVER be called for an observed DOM fact (C-084) or a risk indicator (W6)'); };
}

test('sanity: the real UK_DATA_SECURITY_TRANSPORT record is present and behavioural (the routing target exists)', () => {
  assert.ok(TRANSPORT_RECORD, 'UK_DATA_SECURITY_TRANSPORT must exist in the source pack');
  assert.equal(TRANSPORT_RECORD.website_obligations[0].evidence_type, 'behavioural');
});

test('propose routes the insecure-form node to the transport record as a RISK-tier dom_node candidate', () => {
  const b = bundle();
  const cat = catalogue();
  const fired = propose(b, cat, coverageFor(b, cat)).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  const form = fired.find((c) => c.record_id === 'UK_DATA_SECURITY_TRANSPORT');
  assert.ok(form, 'the insecure-form node routes to the Art 32 transport-security record');
  assert.equal(form.artifact.rule_id, 'insecure-form');
  assert.equal(form.artifact.state, 'violation', 'the insecure form IS present - detection is unchanged');
  assert.equal(form.artifact.tier, 'risk', 'it carries the risk tier onto the artifact');
});

test('END TO END: the insecure-form node adjudicates to needs_review (NOT a hard violation), llm never called', async () => {
  const b = bundle();
  const cat = catalogue();
  const candidates = propose(b, cat, coverageFor(b, cat)).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  const { verified, rejected } = verifyAll(candidates, b);
  assert.equal(rejected.length, 0, 'both observed nodes verify against bundle.browser.domNodes');

  const { findings, report } = await adjudicate(verified.map((v) => v.candidate), b, { llmCall: neverCallLlm() });

  const form = findings.find((f) => f.record_id === 'UK_DATA_SECURITY_TRANSPORT');
  assert.ok(form, 'the transport finding is present');
  assert.equal(form.state, 'needs_review', 'the risk indicator is quarantined, never a hard Art 32 violation (C-048)');
  assert.notEqual(form.state, 'violation');
  assert.equal(form.adjudicated, false, 'no model ruled on it; the legal conclusion is withheld for the controller Art 32 assessment');
  assert.equal(form.adjudication, 'risk_indicator');
  assert.match(form.adjudication_reason, /risk-indicator|C-048/i, 'the finding reads as an observation to review, not an accusation (Rule 10 voice)');
  assert.equal(form.artifact.type, 'dom_node', 'it still carries its dom_node artifact (Rule 3, evidence-backed)');
  assert.equal(form.artifact.rule_id, 'insecure-form');

  assert.equal(report.risk_review, 1, 'exactly one risk-indicator quarantine');
});

test('MIRROR: the missing-alt node still ships as a hard violation via the observed-fact bypass', async () => {
  const b = bundle();
  const cat = catalogue();
  const candidates = propose(b, cat, coverageFor(b, cat)).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  const { verified } = verifyAll(candidates, b);
  const { findings, report } = await adjudicate(verified.map((v) => v.candidate), b, { llmCall: neverCallLlm() });

  const alt = findings.find((f) => f.record_id === 'FAKE_A11Y_2099');
  assert.ok(alt, 'the accessibility finding is present');
  assert.equal(alt.state, 'violation', 'a missing alt IS the breach - it still ships as a hard violation');
  assert.equal(alt.adjudication, 'observed_fact');
  assert.equal(alt.artifact.rule_id, 'image-alt');

  // The two nodes partition cleanly: one hard violation (deterministic), one needs-review (risk).
  assert.equal(report.observed_fact, 1, 'exactly one bypassing observed fact (the accessibility violation)');
  assert.equal(report.risk_review, 1, 'exactly one risk-indicator quarantine (the insecure form)');
  assert.equal(report.violation, 1);
  assert.equal(report.needs_review, 1);
});
