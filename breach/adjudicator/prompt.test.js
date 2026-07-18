'use strict';
// breach/adjudicator/prompt.test.js - node:test for the buildPrompt/briefOf seam extracted from
// adjudicate.js (P3-tail Wave-2 Builder B, caution.md C-254). Drives the module DIRECTLY (not via
// adjudicate.js's re-exports, which breach/adjudicator/adjudicate.test.js already covers end to end) to
// prove it is a genuinely standalone, correctly-wired unit.
//   node --test breach/adjudicator/prompt.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fieldStr, hasCheckedUrls, firstCheckedUrl, briefLaw, briefOf, systemPrompt, promptRules, buildPrompt, candidateRefsFor,
} = require('./prompt.js');

test('fieldStr: coerces a present field to a string, empty on absent/null/undefined', () => {
  assert.equal(fieldStr({ x: 'y' }, 'x'), 'y');
  assert.equal(fieldStr({ x: 42 }, 'x'), '42');
  assert.equal(fieldStr({}, 'x'), '');
  assert.equal(fieldStr(null, 'x'), '');
  assert.equal(fieldStr({ x: null }, 'x'), '');
});

test('hasCheckedUrls / firstCheckedUrl: evidence_url wins over checked_urls; both absent yields ""', () => {
  assert.equal(hasCheckedUrls({ checked_urls: ['a'] }), true);
  assert.equal(hasCheckedUrls({ checked_urls: [] }), false);
  assert.equal(hasCheckedUrls({}), false);
  assert.equal(firstCheckedUrl({ evidence_url: 'https://a/', checked_urls: ['https://b/'] }), 'https://a/');
  assert.equal(firstCheckedUrl({ checked_urls: ['https://b/'] }), 'https://b/');
  assert.equal(firstCheckedUrl({}), '');
});

test('briefLaw: statutory_citation wins over framework; both bounded to 90 chars', () => {
  assert.equal(briefLaw({ statutory_citation: 'section 5', framework: 'Some Act' }), 'section 5');
  assert.equal(briefLaw({ framework: 'Some Act' }), 'Some Act');
  assert.equal(briefLaw({ statutory_citation: 'x'.repeat(200) }).length, 90);
});

test('briefOf: a PRESENCE candidate (evidence_quote set) carries a DOC-delimited quote and a sanitised page', () => {
  const f = { description: 'must not claim X', framework: 'Test Act', evidence_quote: 'we claim X', evidence_url: 'https://x.test/p' };
  const brief = briefOf(f, 3);
  assert.equal(brief.id, 3);
  assert.equal(brief.obligation, 'must not claim X');
  assert.equal(brief.law, 'Test Act');
  assert.match(brief.kind, /^PRESENCE:/);
  assert.equal(brief.evidence, 'VERBATIM FROM THE SITE: <DOC id="F3">we claim X</DOC>');
  assert.equal(brief.page, 'https://x.test/p');
});

test('briefOf: an ABSENCE candidate (no evidence_quote) carries the absence claim line', () => {
  const f = { description: 'must disclose Y' };
  const brief = briefOf(f, 0);
  assert.match(brief.kind, /^ABSENCE:/);
  assert.match(brief.evidence, /required disclosure is ABSENT/);
});

test('briefOf: an ABSENCE candidate WITH a nearest_quote DOC-delimits it too', () => {
  const f = { description: 'must disclose Y', absence_evidence: { nearest_quote: 'nearby text', pages_checked: 2 } };
  const brief = briefOf(f, 1);
  assert.equal(brief.evidence, 'NEAREST TEXT ON THE SITE: <DOC id="F1">nearby text</DOC>');
});

test('systemPrompt / promptRules / buildPrompt: produce non-empty, well-formed text carrying the briefs', () => {
  const sys = systemPrompt();
  assert.match(sys, /compliance adjudicator/);
  const rules = promptRules();
  assert.ok(Array.isArray(rules) && rules.length >= 6);
  const prompt = buildPrompt({ domain: 'x.test', sector: 'legal', country: 'UK' }, [briefOf({ description: 'd', evidence_quote: 'q' }, 0)]);
  assert.match(prompt, /FIRM: x\.test \| SECTOR: legal \| COUNTRY: UK/);
  assert.match(prompt, /CANDIDATES:/);
  assert.match(prompt, /Return STRICT JSON only:/);
  // The brief is embedded via JSON.stringify, so its own quotes are escaped in the prompt text.
  assert.match(prompt, /<DOC id=\\"F0\\">q<\/DOC>/);
});

test('candidateRefsFor: one {id, record_id, artifact} ref per batch entry, in order, never mutating the artifact reference', () => {
  const batch = [{ record_id: 'A', artifact: { type: 'quote' } }, { record_id: 'B', artifact: { type: 'absence' } }];
  const refs = candidateRefsFor(batch);
  assert.deepEqual(refs.map((r) => r.id), [0, 1]);
  assert.equal(refs[0].record_id, 'A');
  assert.equal(refs[1].record_id, 'B');
  assert.equal(refs[0].artifact, batch[0].artifact, 'the SAME artifact object reference, not a copy');
});

test('candidateRefsFor: a candidate with no record_id/artifact still yields a well-formed ref', () => {
  const [ref] = candidateRefsFor([{}]);
  assert.equal(ref.id, 0);
  assert.equal(ref.record_id, '');
  assert.equal(ref.artifact, null);
});
