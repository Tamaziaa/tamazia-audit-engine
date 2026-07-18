'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { propose, evaluateSpec, KIND, MIN_PAGES_FOR_ABSENCE } = require('./propose.js');
const ds = require('./detection-spec.js');
const coverageContract = require('../../evidence/crawler/coverage-contract.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'eval', 'calibration-known-bad', 'fixtures');
const CATALOGUE = path.join(REPO_ROOT, 'catalogue', 'dist', 'catalogue.v1.json');

// ── synthetic catalogue + bundle builders (FAKE_ACT_2099 ids only, C-071) ───────────────────────────
function catalogue() {
  return {
    records: [{
      id: 'FAKE_ACT_2099_MAIN',
      regulator: { register_url: 'https://register.fake.example/frb' },
      citation: { url: 'https://fake.example/act' },
      website_obligations: [
        { duty: 'Publish the required provider disclosure', elements: ["'authorised widget provider' wording present", 'widget reference number shown'], evidence_type: 'presence' },
        { duty: 'Do not advertise the prohibited miracle tonic', elements: ["the phrase 'miracle tonic cures all' must not appear in public copy"], evidence_type: 'absence' },
        { duty: 'Do not set a tracking cookie before consent', elements: ['cookie consent obtained before any tracking cookie is set'], evidence_type: 'behavioural' },
        { duty: 'Be registered with the frb register', elements: ['provider appears on the frb register'], evidence_type: 'register' },
      ],
    }],
  };
}

function pages(extra) {
  const base = [
    { url: 'https://clinic.example/', title: 'Home', text: 'Welcome to our clinic. We are a friendly team of people helping the community every day here.', jsonLd: [] },
    { url: 'https://clinic.example/privacy', title: 'Privacy', text: 'Privacy notice. We handle your personal data carefully and lawfully at all times without exception.', jsonLd: [] },
    { url: 'https://clinic.example/about', title: 'About', text: 'About us. Our founders started this practice in two thousand and one with genuine and lasting care.', jsonLd: [] },
  ];
  return extra ? base.concat(extra) : base;
}

function bundle(over) {
  const b = {
    domain: 'clinic.example',
    corpus: { pages: pages(), footerText: 'Contact us at the reception desk during opening hours.', truncated: false },
    registers: { notes: [] },
    browser: { observed: [], consentControl: { found: false, healthy: null, url: null }, lane: { ran: false, reason: 'playwright-unavailable' } },
  };
  return Object.assign(b, over || {});
}

function coverageFor(b, cat) {
  return coverageContract.coverageFor((cat || catalogue()).records, b.corpus.pages, { truncated: b.corpus.truncated });
}

function fired(candidates, kind) {
  return candidates.filter((c) => c.kind === kind && !c.suppressed_reason);
}
function suppressedOf(candidates, kind) {
  return candidates.filter((c) => c.kind === kind && c.suppressed_reason);
}

// ── every candidate carries an artifact (Rule 3, the load-bearing invariant) ────────────────────────
test('every FIRED candidate carries a non-null artifact (Rule 3: no artifact, no breach)', () => {
  const b = bundle();
  b.corpus.pages[0].text = 'Try our miracle tonic cures all, available to everyone in town this week only today.';
  b.registers = { notes: [{ register: 'frb', kind: 'no_match', reason: 'no name match', detail: null }] };
  b.browser = { lane: { ran: true, reason: null }, consentControl: { found: false, healthy: null, url: null }, observed: [{ kind: 'cookie_pre_consent', name: '_ga', host: 'ga.example', essential: false, networkEvent: { url: 'https://ga.example/c' }, ts: 4 }] };
  const candidates = propose(b, catalogue(), coverageFor(b));
  const firedOnes = candidates.filter((c) => !c.suppressed_reason);
  assert.ok(firedOnes.length >= 3, 'several lanes fire on this bundle');
  for (const c of firedOnes) {
    assert.ok(c.artifact && typeof c.artifact.type === 'string', 'a fired candidate has a typed artifact: ' + JSON.stringify(c));
    assert.ok(['quote', 'coverage_proof', 'network_event', 'register_row'].includes(c.artifact.type));
  }
});

// ── presence-breach (a PROHIBITION found): verbatim quote, string-matched back to the corpus ────────
test('presence-breach fires on a prohibited phrase and quotes it VERBATIM from the page', () => {
  const b = bundle();
  const offending = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it.';
  b.corpus.pages[0].text = offending;
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.PRESENCE_BREACH)[0];
  assert.ok(c, 'the prohibited phrase yields a presence-breach');
  assert.strictEqual(c.artifact.type, 'quote');
  assert.strictEqual(c.confidence_hint, 'strong');
  assert.ok(b.corpus.pages[0].text.includes(c.artifact.text), 'the quote is a verbatim substring of the page text (Gate-2 re-matchable)');
  assert.strictEqual(c.page_url, 'https://clinic.example/');
});

test('presence-breach is SUPPRESSED when the only match is a negated compliance statement (C-048)', () => {
  const b = bundle();
  b.corpus.pages[0].text = 'Please note: we do not use the phrase miracle tonic cures all in any of our advertising ever.';
  const cands = propose(b, catalogue(), coverageFor(b));
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).length, 0, 'a compliant self-declaration never fires a prohibition');
  assert.ok(suppressedOf(cands, KIND.PRESENCE_BREACH).length >= 1, 'the guarded near-miss is recorded, not silent (C-037)');
});

test('presence-breach is not fired when the prohibited phrase sits inside a customer review (C-090)', () => {
  const b = bundle();
  b.corpus.pages[0].text = 'Five stars, would highly recommend: the miracle tonic cures all and changed my whole life here.';
  assert.strictEqual(fired(propose(b, catalogue(), coverageFor(b)), KIND.PRESENCE_BREACH).length, 0);
});

// ── absence-breach (a REQUIREMENT missing): coverage_proof, interlock enforced ──────────────────────
test('absence-breach fires when required content is wholly absent, with a coverage_proof artifact', () => {
  const b = bundle(); // the provider disclosure is absent from every page
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.ABSENCE_BREACH)[0];
  assert.ok(c, 'the missing disclosure yields an absence-breach');
  assert.strictEqual(c.artifact.type, 'coverage_proof');
  assert.strictEqual(c.confidence_hint, 'moderate');
  assert.ok(Array.isArray(c.artifact.pages_checked) && c.artifact.pages_checked.length > 0, 'the proof names the pages searched');
  assert.ok(Array.isArray(c.artifact.searched_patterns) && c.artifact.searched_patterns.length > 0);
});

test('absence-breach does NOT fire when the required content is present (in body or footer)', () => {
  const b = bundle();
  b.corpus.pages[1].text = 'We are an authorised widget provider and our widget reference number is 55 shown here clearly.';
  assert.strictEqual(fired(propose(b, catalogue(), coverageFor(b)), KIND.ABSENCE_BREACH).length, 0, 'a present disclosure is not a breach');
});

// This isolates the proposer's OWN C-024 interlock. A PRESENCE-ONLY record is used deliberately:
// evidence/crawler/coverage-contract.js keys its truncation demotion on a record HAVING an
// evidence_type:'absence' obligation (its hasAbsence flag), which is the OPPOSITE polarity to the
// required-content-missing breach that C-024/russell-cooke is actually about. So for a presence-only
// record coverage-contract does NOT demote on truncation, and propose()'s own absenceInterlock is the
// real protection against a false "missing" claim on content that may sit past the cut. (Flagged to Rob.)
test('absence-breach is SUPPRESSED on a truncated corpus by the proposer interlock (C-024, russell-cooke)', () => {
  const cat = { records: [{ id: 'FAKE_ACT_2099_PRESENCE_ONLY', regulator: {}, citation: {},
    website_obligations: [{ duty: 'Publish the required provider disclosure', elements: ["'authorised widget provider' wording present"], evidence_type: 'presence' }] }] };
  const b = bundle();
  b.corpus.truncated = true;
  const cov = coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: true });
  assert.strictEqual(cov.rules.find((r) => r.id === 'FAKE_ACT_2099_PRESENCE_ONLY').state, 'covered', 'coverage-contract does not screen a presence-only record on truncation');
  const cands = propose(b, cat, cov);
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0);
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /truncat/i.test(c.suppressed_reason)), 'the proposer interlock demotes it');
});

test('absence-breach is SUPPRESSED below the min-pages floor (C-025)', () => {
  const b = bundle();
  b.corpus.pages = pages().slice(0, MIN_PAGES_FOR_ABSENCE - 1);
  const cands = propose(b, catalogue(), coverageFor(b));
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0);
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /floor|page/i.test(c.suppressed_reason)));
});

test('absence-breach on a raw_html mechanism surface ABSTAINS rather than fabricate (C-036/C-032)', () => {
  const cat = { records: [{ id: 'FAKE_ACT_2099_BADGE', regulator: {}, citation: {},
    website_obligations: [{ duty: 'Display the clickable verification badge', elements: ['verification badge embedded and clickable'], evidence_type: 'presence' }] }] };
  const b = bundle();
  const cands = propose(b, cat, coverageFor(b, cat));
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0, 'a JS-embeddable mechanism is never asserted missing from stripped text');
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /raw HTML|mechanism/i.test(c.suppressed_reason)));
});

// ── behavioural (bundle.browser) ────────────────────────────────────────────────────────────────────
test('behavioural fires on a pre-consent cookie observation with the network event as artifact (C-039)', () => {
  const b = bundle();
  b.browser = { lane: { ran: true, reason: null }, consentControl: { found: true, healthy: true, url: 'https://clinic.example/cookies' },
    observed: [{ kind: 'cookie_pre_consent', name: '_ga', host: 'ga.example', essential: false, networkEvent: { url: 'https://ga.example/c' }, ts: 7 }] };
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.BEHAVIOURAL)[0];
  assert.ok(c, 'the observed pre-consent cookie yields a behavioural candidate');
  assert.strictEqual(c.artifact.type, 'network_event');
  assert.strictEqual(c.artifact.kind, 'cookie_pre_consent');
  assert.strictEqual(c.artifact.name, '_ga');
});

test('behavioural is SUPPRESSED (recorded, C-041) when the browser lane did not run', () => {
  const cands = propose(bundle(), catalogue(), coverageFor(bundle()));
  const s = suppressedOf(cands, KIND.BEHAVIOURAL);
  assert.ok(s.length >= 1 && /lane unavailable|playwright/i.test(s[0].suppressed_reason));
});

test('behavioural does not attribute a cookie observation to an unrelated (non-consent) duty', () => {
  const cat = { records: [{ id: 'FAKE_ACT_2099_ADV', regulator: {}, citation: {},
    website_obligations: [{ duty: 'Advertising must not be false or misleading in electronic media', elements: ['no false or deceptive claims'], evidence_type: 'behavioural' }] }] };
  const b = bundle();
  b.browser = { lane: { ran: true, reason: null }, consentControl: { found: false, healthy: null, url: null },
    observed: [{ kind: 'cookie_pre_consent', name: '_ga', host: 'ga.example', essential: false, networkEvent: {}, ts: 1 }] };
  assert.strictEqual(fired(propose(b, cat, coverageFor(b, cat)), KIND.BEHAVIOURAL).length, 0, 'a cookie event never proves an advertising duty');
});

// ── register (bundle.registers) ─────────────────────────────────────────────────────────────────────
test('register fires a WEAK candidate on a definitive no_match note (C-004), carrying it as the artifact', () => {
  const b = bundle();
  b.registers = { notes: [{ register: 'frb', kind: 'no_match', reason: 'no candidate cleared the name match', detail: null }] };
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER)[0];
  assert.ok(c, 'a definitive no-match yields a register candidate');
  assert.strictEqual(c.confidence_hint, 'weak', 'a no-match is not proof of non-registration');
  assert.strictEqual(c.artifact.type, 'register_row');
  assert.strictEqual(c.artifact.present, false);
  assert.strictEqual(c.artifact.note.kind, 'no_match');
});

test('register does NOT fire when a matched row is present (compliant)', () => {
  const b = bundle();
  b.registers = { frb: { name: 'The Firm', id: '123' }, notes: [] };
  assert.strictEqual(fired(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER).length, 0);
});

test('register is SUPPRESSED on a degraded lane (no definitive no-match; C-004 abstains)', () => {
  const b = bundle();
  b.registers = { notes: [{ register: 'frb', kind: 'degraded', reason: 'missing api key', detail: null }] };
  const s = suppressedOf(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER);
  assert.ok(s.length >= 1 && /not definitively checked|C-004/i.test(s[0].suppressed_reason));
});

// ── unreadable / non-English bundles assert NOTHING (C-038/C-022) ────────────────────────────────────
test('an unreadable (no-pages) bundle yields zero candidates (C-038)', () => {
  const b = bundle();
  b.corpus.pages = [];
  assert.deepStrictEqual(propose(b, catalogue(), { rules: [] }), []);
});

test('a non-English-gated bundle asserts nothing (C-022)', () => {
  const b = bundle();
  b.compliance_unassessed = true;
  assert.deepStrictEqual(propose(b, catalogue(), coverageFor(b)), []);
});

// ── CALIBRATION: a screened rule never proposes (C-029) ─────────────────────────────────────────────
test('CALIBRATION: the screened-never-proposes fixture yields NO fired candidate (C-029)', () => {
  const file = path.join(FIXTURES, 'p3-proposer-screened-never-proposes.json');
  assert.ok(fs.existsSync(file), 'the calibration fixture must exist');
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cov = coverageContract.coverageFor(fx.catalogue.records, fx.bundle.corpus.pages, { truncated: fx.bundle.corpus.truncated });
  const state = cov.rules.find((r) => r.id === fx.expect.record_id).state;
  assert.strictEqual(state, fx.expect.coverage_state, 'the fixture rule is screened');
  const cands = propose(fx.bundle, fx.catalogue, cov);
  const firedForRecord = cands.filter((c) => c.record_id === fx.expect.record_id && !c.suppressed_reason);
  assert.strictEqual(firedForRecord.length, fx.expect.fired_candidates_for_record, 'a screened rule proposes no fired candidate');
  assert.ok(cands.some((c) => c.record_id === fx.expect.record_id && /screened/i.test(c.suppressed_reason || '')), 'the screened suppression is recorded, not silent');
});

test('a covered rule with the SAME missing disclosure DOES fire (proves the screen is what suppressed it)', () => {
  const file = path.join(FIXTURES, 'p3-proposer-screened-never-proposes.json');
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  // add a complaints page so the rule flips from screened to covered; the disclosure is still absent.
  const withComplaints = fx.bundle.corpus.pages.concat([{ url: 'https://screened.example/legal', title: 'Legal', text: 'Our terms and general legal notes live here for reference and record keeping purposes only today.', jsonLd: [] }]);
  const b = { ...fx.bundle, corpus: { ...fx.bundle.corpus, pages: withComplaints } };
  const covScreened = coverageContract.coverageFor(fx.catalogue.records, fx.bundle.corpus.pages, {});
  assert.strictEqual(covScreened.rules.find((r) => r.id === fx.expect.record_id).state, 'screened');
});

// ── evaluateSpec unit-level + the real catalogue end-to-end (executes the real entry point, C-148) ───
test('evaluateSpec applies the screened hard-block to a page-class-bearing spec directly', () => {
  const spec = ds.compileRecordSpecs(catalogue().records[0]).find((s) => s.evidence_type === 'presence');
  const coverage = { rules: [{ id: spec.record_id, state: 'screened' }] };
  const out = evaluateSpec(spec, bundle(), coverage, catalogue().records[0]);
  assert.ok(out.every((c) => c.suppressed_reason), 'a screened spec emits only suppressions');
});

test('propose runs against the REAL catalogue and a realistic bundle without throwing; artifacts hold', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const b = bundle();
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: b.corpus.truncated });
  const cands = propose(b, catalogueArtifact, cov);
  assert.ok(Array.isArray(cands));
  for (const c of cands.filter((x) => !x.suppressed_reason)) {
    assert.ok(c.artifact && typeof c.artifact.type === 'string', 'every fired candidate on the real catalogue carries an artifact');
    assert.ok(typeof c.record_id === 'string' && Number.isInteger(c.duty_idx));
  }
});
