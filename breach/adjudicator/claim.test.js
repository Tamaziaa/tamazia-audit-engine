'use strict';
// breach/adjudicator/claim.test.js - node:test for the Gate-3 atomic-claim door (P3-tail Wave-2 FINAL
// UNIT). Proves the framing correction: a presence-breach hypothesis becomes the affirmative breach
// claim the offending quote ENTAILS (not the obligation duty it contradicts), deterministically and
// catalogue-grounded, while absence/coverage_proof keep the existing duty basis.
//   node --test breach/adjudicator/claim.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  atomicClaimFor, claimBasisFor, bridgeTextFor, isPresenceBreach, dutyText, firstClause,
  affirmativeFromDuty, fallbackClaim, FALLBACK_FRAME,
} = require('./claim.js');

// A compiled-catalogue-shaped record with a "Do not X" prohibition duty (the UK_MHRA_POM_AD_BAN shape,
// hand-built so this unit test never depends on the live catalogue - C-211).
function prohibitionRecord() {
  return {
    name: 'A synthetic prohibition record (harness self-test only, not a real law)',
    website_obligations: [
      { duty: 'Do not advertise any prescription only medicine to the public; remove product names and indirect references from public pages', evidence_type: 'absence' },
    ],
  };
}
function quoteCandidate(over) {
  return Object.assign({ duty_idx: 0, kind: 'presence-breach', artifact: { type: 'quote', text: 'an offending phrase' } }, over || {});
}
function coverageCandidate(over) {
  return Object.assign({ duty_idx: 0, kind: 'absence-breach', artifact: { type: 'coverage_proof' } }, over || {});
}

// ── isPresenceBreach: the artifact is ground truth (Rule 3) ───────────────────────────────────────────
test('isPresenceBreach: a verbatim quote artifact is a presence-breach; coverage/register/observed/none are not', () => {
  assert.equal(isPresenceBreach({ artifact: { type: 'quote' } }), true);
  assert.equal(isPresenceBreach({ artifact: { type: 'corpus_quote' } }), true, 'port alias');
  assert.equal(isPresenceBreach({ artifact: { type: 'coverage_proof' } }), false);
  assert.equal(isPresenceBreach({ artifact: { type: 'register_row' } }), false);
  assert.equal(isPresenceBreach({ artifact: { type: 'network_event' } }), false);
  assert.equal(isPresenceBreach({}), false);
  assert.equal(isPresenceBreach(null), false);
});

// ── presence-breach: the atomic breach claim (the core fix) ───────────────────────────────────────────
test('atomicClaimFor: a "Do not X" presence-breach duty becomes the affirmative "This website does X" breach claim', () => {
  const claim = atomicClaimFor(prohibitionRecord(), quoteCandidate());
  assert.equal(claim, 'This website does advertise any prescription only medicine to the public');
  assert.equal(claimBasisFor(prohibitionRecord(), quoteCandidate()), 'prohibition-verb');
});

test('atomicClaimFor: the atomic claim is AFFIRMATIVE - it carries NO prohibition operator (the C-048 direction: a compliant page cannot entail it)', () => {
  const claim = atomicClaimFor(prohibitionRecord(), quoteCandidate());
  // It must NOT read as the duty (which an offending quote contradicts); it must read as the breach.
  assert.ok(!/\bdo not\b/i.test(claim), 'no "do not" - it is the breach assertion, not the prohibition');
  assert.ok(!/\bmust not\b|\bremove\b|\bnever\b/i.test(claim), 'no other prohibition/removal operator');
  assert.notEqual(claim, prohibitionRecord().website_obligations[0].duty, 'the hypothesis is NOT the duty text');
});

test('atomicClaimFor: the claim is CATALOGUE-DERIVED - its substantive remainder is verbatim from the record duty (F3c, no invented content)', () => {
  const rec = prohibitionRecord();
  const claim = atomicClaimFor(rec, quoteCandidate());
  const remainder = claim.replace(/^This website does /, '');
  const duty = rec.website_obligations[0].duty;
  assert.ok(duty.includes(remainder), 'every substantive word of the claim comes verbatim from the catalogue duty: ' + JSON.stringify(remainder));
});

test('atomicClaimFor: a "Firms must not X" duty (operator not at clause start) still inverts to "This website does X"', () => {
  const rec = { name: 'r', website_obligations: [{ duty: 'Advertisers must not name a prescription only medicine in public copy' }] };
  assert.equal(atomicClaimFor(rec, quoteCandidate()), 'This website does name a prescription only medicine in public copy');
});

test('atomicClaimFor: a "remove Y" first-clause duty inverts via the removal template to "... includes Y"', () => {
  const rec = { name: 'r', website_obligations: [{ duty: 'Remove all prescription only medicine names from public pages' }] };
  const claim = atomicClaimFor(rec, quoteCandidate());
  assert.equal(claim, "This website's public content includes all prescription only medicine names from public pages");
  assert.equal(claimBasisFor(rec, quoteCandidate()), 'removal-verb');
});

test('atomicClaimFor: a duty matching NEITHER transform falls back to the documented deterministic template (honest, still affirmative)', () => {
  const rec = { name: 'r', website_obligations: [{ duty: 'Prescription only medicines are strictly off-limits in consumer marketing' }] };
  const claim = atomicClaimFor(rec, quoteCandidate());
  assert.ok(claim.startsWith(FALLBACK_FRAME), 'uses the fallback frame');
  assert.ok(claim.includes('Prescription only medicines are strictly off-limits in consumer marketing'), 'embeds the duty clause verbatim');
  assert.equal(claimBasisFor(rec, quoteCandidate()), 'fallback');
});

// ── FINAL UNIT iteration 2: bridgeTextFor - the record's OWN verbatim duty text as the Gate-3 SECOND
// premise (the rule-text bridge), for a presence-breach ONLY (the same duty_idx door as the hypothesis) ─
test('bridgeTextFor: a presence-breach gets the record\'s verbatim duty text as the bridge (Rule 2, no authored content)', () => {
  const rec = prohibitionRecord();
  assert.equal(bridgeTextFor(rec, quoteCandidate()), rec.website_obligations[0].duty, 'the bridge is the catalogue duty verbatim');
});

test('bridgeTextFor: absence/coverage/register/observed/none get NO bridge (their hypothesis IS the duty; a duty premise would self-entail)', () => {
  const rec = prohibitionRecord();
  assert.equal(bridgeTextFor(rec, coverageCandidate()), '', 'coverage_proof (absence) gets no bridge');
  assert.equal(bridgeTextFor(rec, { duty_idx: 0, artifact: { type: 'register_row' } }), '', 'register gets no bridge');
  assert.equal(bridgeTextFor(rec, { duty_idx: 0, artifact: { type: 'network_event' } }), '', 'observed gets no bridge');
  assert.equal(bridgeTextFor(rec, {}), '', 'no artifact -> no bridge');
});

test('bridgeTextFor: honours duty_idx and tolerates a finding-shaped view (description carries the selected duty, what adjudicate.js passes)', () => {
  const rec = { website_obligations: [{ duty: 'first duty' }, { duty: 'second duty' }] };
  assert.equal(bridgeTextFor(rec, { duty_idx: 1, artifact: { type: 'quote' } }), 'second duty', 'reads website_obligations[duty_idx].duty');
  const finding = { description: 'Do not advertise a prescription only medicine to the public', artifact: { type: 'quote', text: 'q' } };
  assert.equal(bridgeTextFor(finding, finding), finding.description, 'the finding-shaped bridge is its own description');
});

test('bridgeTextFor: the bridge (full duty) differs from the atomic claim - two distinct premises, never a self-entailment', () => {
  const rec = prohibitionRecord();
  assert.notEqual(bridgeTextFor(rec, quoteCandidate()), atomicClaimFor(rec, quoteCandidate()), 'the rule-text bridge is the duty; the hypothesis is the inverted atomic claim');
});

test('bridgeTextFor: never throws and degrades to empty on a null record/candidate', () => {
  assert.equal(bridgeTextFor(null, null), '');
  assert.doesNotThrow(() => bridgeTextFor(null, quoteCandidate()));
  assert.equal(typeof bridgeTextFor(null, quoteCandidate()), 'string');
});

// ── non-presence-breach: the existing basis is UNCHANGED ──────────────────────────────────────────────
test('atomicClaimFor: a coverage_proof (absence-breach) candidate keeps the existing basis - the duty text, unchanged', () => {
  const rec = prohibitionRecord();
  const claim = atomicClaimFor(rec, coverageCandidate());
  assert.equal(claim, rec.website_obligations[0].duty, 'absence/coverage_proof hypothesis is unchanged (spec F1)');
  assert.equal(claimBasisFor(rec, coverageCandidate()), 'existing-duty');
});

test('atomicClaimFor: a register or observed candidate (were it to reach here) returns the duty, unchanged (they bypass Gate 3 anyway, C-084)', () => {
  const rec = prohibitionRecord();
  assert.equal(atomicClaimFor(rec, { duty_idx: 0, artifact: { type: 'register_row' } }), rec.website_obligations[0].duty);
  assert.equal(atomicClaimFor(rec, { duty_idx: 0, artifact: { type: 'network_event' } }), rec.website_obligations[0].duty);
});

// ── dutyText tolerance: full record vs finding-shaped view ────────────────────────────────────────────
test('dutyText: reads website_obligations[duty_idx].duty from a full record, and description from a finding-shaped view', () => {
  const rec = { website_obligations: [{ duty: 'first duty' }, { duty: 'second duty' }] };
  assert.equal(dutyText(rec, { duty_idx: 1 }), 'second duty');
  assert.equal(dutyText(rec, {}), 'first duty', 'defaults to duty_idx 0');
  assert.equal(dutyText({ description: 'the selected duty' }, {}), 'the selected duty', 'finding-shaped view');
  assert.equal(dutyText(null, null), '', 'never throws, degrades to empty');
});

test('atomicClaimFor: tolerates a finding-shaped record (adjudicate.js passes the finding as both record and candidate)', () => {
  const finding = { description: 'Do not advertise a prescription only medicine to the public', artifact: { type: 'quote', text: 'q' } };
  assert.equal(atomicClaimFor(finding, finding), 'This website does advertise a prescription only medicine to the public');
});

// ── helpers + robustness ──────────────────────────────────────────────────────────────────────────────
test('firstClause: takes the primary clause up to the first semicolon, trimmed', () => {
  assert.equal(firstClause('Do not X; remove Y; avoid Z'), 'Do not X');
  assert.equal(firstClause('no semicolon here'), 'no semicolon here');
  assert.equal(firstClause(null), '');
});

test('affirmativeFromDuty: returns null when neither transform applies; a well-formed match otherwise', () => {
  assert.equal(affirmativeFromDuty('a positive obligation with no operator'), null);
  assert.deepEqual(affirmativeFromDuty('Do not do the thing'), { claim: 'This website does do the thing', basis: 'prohibition-verb' });
  assert.deepEqual(affirmativeFromDuty('remove the thing'), { claim: "This website's public content includes the thing", basis: 'removal-verb' });
});

test('atomicClaimFor: empty/absent duty never throws and yields a bounded string', () => {
  assert.doesNotThrow(() => atomicClaimFor({ website_obligations: [{ duty: '' }] }, quoteCandidate()));
  assert.doesNotThrow(() => atomicClaimFor(null, quoteCandidate()));
  assert.equal(typeof atomicClaimFor(null, quoteCandidate()), 'string');
});

test('atomicClaimFor: pathological long/repetitive duty does not hang (linear regexes, no ReDoS - C-226)', () => {
  const rec = { website_obligations: [{ duty: 'Do not ' + 'a '.repeat(20000) + 'thing' }] };
  const t0 = Date.now();
  const claim = atomicClaimFor(rec, quoteCandidate());
  assert.ok(Date.now() - t0 < 1000, 'must complete well under a second');
  assert.ok(claim.startsWith('This website does '));
});

// ── F3c: the door authors NO law content in CODE (Rule 2 / Rule 11) ───────────────────────────────────
// The claim is proven catalogue-derived structurally above (its remainder is the record duty verbatim).
// This adds the converse: the door's executable CODE (comments stripped - the header legitimately
// documents the fix using the real U1 example) carries no law-content literal, so nothing the door emits
// can originate outside the record it was handed. The repo's own catalogue-only-literals lint enforces
// the same repo-wide; this is the module-local guard.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
test('F3c: claim.js executable code (comments stripped) contains no law-fact literal - it only re-frames catalogue text', () => {
  const code = stripComments(fs.readFileSync(path.join(__dirname, 'claim.js'), 'utf8'));
  for (const banned of ['prescription', 'medicine', 'MHRA', 'GDPR', 'Botox', 'botulinum']) {
    assert.ok(!new RegExp('\\b' + banned + '\\b', 'i').test(code), 'claim.js code must not carry the law-content literal ' + JSON.stringify(banned));
  }
  // And the ONLY fixed framing the door prepends are these law-free frames (everything else is duty text).
  assert.ok(/This website does /.test(code));
  assert.ok(/This website's public content includes /.test(code));
});
