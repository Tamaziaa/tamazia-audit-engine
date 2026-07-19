'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const {
  propose, evaluateSpec, KIND, MIN_PAGES_FOR_ABSENCE, isNonEnglishGated, pathHasSegment, matchUrlPath,
  isMatchedRegisterRow, singularise, tokenMatchesConcept, registerTargetFor, sentenceVerdict, obligationConcerns,
  presenceState, findWindowedTokenSetQuote,
} = require('./propose.js');
const ds = require('./detection-spec.js');
const coverageContract = require('../../evidence/crawler/coverage-contract.js');
// The real DOM-lane predicates, so the dom_node tests below carry the AUTHENTIC finding tier the lane
// stamps (W6), never a hand-typed one - the test proves the real wiring, not a fixture's assumption.
const { formNode, imgNode, controlNode, htmlNode } = require('../../evidence/browser/dom-assert.js');

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
    assert.ok(['quote', 'coverage_proof', 'network_event', 'register_absence'].includes(c.artifact.type));
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
  // D2: tier1_fetched + truncated ride the artifact and every pages_checked entry is a REAL crawled URL
  // (no '(footer)' sentinel) so breach/verifiers/coverage-proof.js can cross-check it against the corpus.
  assert.strictEqual(c.artifact.tier1_fetched, true);
  assert.strictEqual(c.artifact.truncated, false);
  const crawledUrls = new Set(b.corpus.pages.map((p) => p.url));
  assert.ok(c.artifact.pages_checked.every((u) => crawledUrls.has(u)), 'every pages_checked entry is an actually-crawled page URL');
});

test('a fired coverage_proof candidate VERIFIES end-to-end through breach/verifiers (D2 contract)', () => {
  const { verifyCandidate } = require('../verifiers/quote-match.js');
  const b = bundle();
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.ABSENCE_BREACH)[0];
  const r = verifyCandidate(c, b);
  assert.strictEqual(r.verified, true, 'the proposer coverage_proof shape must verify against the coverage-proof verifier');
  assert.strictEqual(r.code, 'coverage_proof_verified');
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

test('absence-breach is SUPPRESSED when truncation telemetry is UNKNOWN (missing), never emitted as truncated:false', () => {
  // The crawler always sets corpus.truncated; a bundle that OMITS it never told us the corpus is complete,
  // so an absence claim cannot be proven and is demoted (fail-closed, ledger decision 2, C-024).
  const cat = { records: [{ id: 'FAKE_ACT_2099_PRESENCE_ONLY', regulator: {}, citation: {},
    website_obligations: [{ duty: 'Publish the required provider disclosure', elements: ["'authorised widget provider' wording present"], evidence_type: 'presence' }] }] };
  const b = bundle();
  const cov = coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: false });
  delete b.corpus.truncated; // truncation state is now UNKNOWN
  const cands = propose(b, cat, cov);
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0, 'no absence claim on an unknown-truncation corpus');
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /UNKNOWN/i.test(c.suppressed_reason)), 'the interlock demotes on unknown truncation');
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

// ── dom_node lane: the W6 risk tier rides onto the artifact (deterministic vs risk) ──────────────────
test('a dom_node candidate carries the finding TIER from the DOM lane (risk for insecure-form, deterministic for image-alt)', () => {
  const cat = { records: [{ id: 'FAKE_DOM_2099', regulator: {}, citation: {}, website_obligations: [
    { duty: 'Transmit personal data over a secure transport connection',
      elements: ['secure transport security uses https and tls, not plaintext http', 'forms submit over an encrypted https connection not a plaintext http action'], evidence_type: 'behavioural' },
    { duty: 'The website must be accessible to screen reader users with disabilities',
      elements: ['content is accessible to disabled and screen reader users'], evidence_type: 'behavioural' },
  ] }] };
  // Build both nodes through the REAL dom-assert predicates so each carries the tier the lane truly stamps.
  const insecureForm = formNode({ selector: 'form#signup', snippet: '<form action="http://x/y">', pageScheme: 'https:', actionScheme: 'http:' });
  const missingAlt = imgNode({ selector: 'main > img:nth-of-type(1)', snippet: '<img src="/hero.png">', hasAlt: false });
  const b = bundle({ browser: { lane: { ran: true, reason: null }, observed: [], consentControl: { found: false, healthy: null, url: null },
    domLane: { ran: true, reason: null }, domNodes: [insecureForm, missingAlt] } });
  const doms = fired(propose(b, cat, coverageFor(b, cat)), KIND.BEHAVIOURAL).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  const form = doms.find((c) => c.artifact.rule_id === 'insecure-form');
  const alt = doms.find((c) => c.artifact.rule_id === 'image-alt');
  assert.ok(form, 'the insecure-form node routes to the transport-security duty and STILL becomes a candidate');
  assert.strictEqual(form.artifact.tier, 'risk', 'a confirmed insecure form carries tier=risk onto the artifact (Art 32 risk indicator)');
  assert.strictEqual(form.artifact.state, 'violation', 'detection state is unchanged: the insecure form IS present (never silently under-reported)');
  assert.ok(alt, 'the image-alt node routes to the accessibility duty');
  assert.strictEqual(alt.artifact.tier, 'deterministic', 'a missing alt is a deterministic accessibility breach');
});

// ── register (bundle.registers) ─────────────────────────────────────────────────────────────────────
test('register fires a WEAK candidate on a definitive no_match note (C-004), carrying a register_absence artifact', () => {
  const b = bundle();
  b.registers = { notes: [{ register: 'frb', kind: 'no_match', reason: 'no candidate cleared the name match', detail: null }] };
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER)[0];
  assert.ok(c, 'a definitive no-match yields a register candidate');
  assert.strictEqual(c.confidence_hint, 'weak', 'a no-match is not proof of non-registration');
  assert.strictEqual(c.artifact.type, 'register_absence');
  assert.strictEqual(c.artifact.register, 'frb');
  assert.strictEqual(c.artifact.lane, 'no_match');
  assert.strictEqual(c.artifact.note.kind, 'no_match');
});

test('a fired register_absence candidate VERIFIES end-to-end through breach/verifiers (D3 contract)', () => {
  const { verifyCandidate } = require('../verifiers/quote-match.js');
  const b = bundle();
  b.registers = { notes: [{ register: 'frb', kind: 'no_match', reason: 'no candidate cleared the name match', detail: null }] };
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER)[0];
  const r = verifyCandidate(c, b);
  assert.strictEqual(r.verified, true, 'the proposer register_absence shape must verify against the register-absence verifier');
  assert.strictEqual(r.code, 'register_absence_verified');
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

// HIGH-9: the gate must never fire a breach candidate, but the abstention itself must be VISIBLE
// (a recorded suppression per compiled spec), never a bare [] indistinguishable from "nothing to say".
test('a non-English-gated bundle FIRES nothing but records a VISIBLE suppression per spec (C-022, HIGH-9)', () => {
  const b = bundle();
  b.compliance_unassessed = true;
  const cands = propose(b, catalogue(), coverageFor(b));
  assert.ok(cands.length > 0, 'the gate is visible: it returns recorded suppressions, never a bare []');
  assert.ok(cands.every((c) => c.suppressed_reason && !c.artifact), 'every entry is a suppression, none fires a breach');
  assert.ok(cands.every((c) => /C-022/.test(c.suppressed_reason)), 'every suppression cites the non-English gate');
});

// ── hidden-defects.md RANK 6 / repetition-audit DG-04b: corpus.language is now a REAL producer output
// (evidence/crawler/language.js, wired at the one crawl.js producing door) rather than a field nothing
// ever assigned. isNonEnglishGated already read bundle.corpus.language; these prove the gate ACTUALLY
// FIRES once that field carries a real value, with a positive control (non-English -> gated) and a
// negative control (English -> the SAME violating content still fires normally, so the fix does not
// over-gate every audit into silence).
test('POSITIVE CONTROL: corpus.language set to a non-English tag gates the breach lane to a visible suppression, never a fired candidate', () => {
  const b = bundle();
  // the exact prohibited phrase from the catalogue fixture below, present in the corpus - proves the
  // gate suppresses REAL violating content, not merely an already-empty bundle.
  b.corpus.pages[0].text = 'Achetez notre tonique miracle qui guerit tout des aujourd hui sans exception.';
  b.corpus.language = 'fr';
  const cands = propose(b, catalogue(), coverageFor(b));
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).length, 0, 'a confidently non-English corpus.language must gate the whole breach lane, exactly like compliance_unassessed');
  assert.ok(cands.length > 0 && cands.every((c) => c.suppressed_reason), 'the gate abstention is recorded (HIGH-9), not a bare []');
});

// HIGH-9: the exact reported regex vector - 'English' (word char after 'en') and 'en_US' (underscore is
// a \b word char) both wrongly failed the old `/^en\b/i` test and were gated even though the corpus IS
// English. Both must now run normally (not gate), same as the existing 'en'/absent negative control.
test('HIGH-9 regression: corpus.language "English" and "en_US" are NOT gated (the old \\b-anchored regex missed them)', () => {
  const offending = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it.';
  for (const lang of ['English', 'en_US', 'en-GB', 'en']) {
    const b = bundle();
    b.corpus.pages[0].text = offending;
    b.corpus.language = lang;
    assert.strictEqual(isNonEnglishGated(b), false, JSON.stringify(lang) + ' must not be gated');
    const fired1 = fired(propose(b, catalogue(), coverageFor(b)), KIND.PRESENCE_BREACH);
    assert.ok(fired1.length >= 1, JSON.stringify(lang) + ' still detects a real violation - not vacuously gated');
  }
  // and the genuinely non-English tags still gate, unaffected by the fix
  for (const lang of ['fr', 'fr-FR', 'de']) {
    const b = bundle();
    b.corpus.language = lang;
    assert.strictEqual(isNonEnglishGated(b), true, JSON.stringify(lang) + ' must still be gated');
  }
});

test('NEGATIVE CONTROL: corpus.language "en" (or absent) runs normally - the fix does not over-gate English audits', () => {
  const offending = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it.';
  const withLang = bundle();
  withLang.corpus.pages[0].text = offending;
  withLang.corpus.language = 'en';
  const withoutLang = bundle();
  withoutLang.corpus.pages[0].text = offending;
  for (const b of [withLang, withoutLang]) {
    const fired1 = fired(propose(b, catalogue(), coverageFor(b)), KIND.PRESENCE_BREACH);
    assert.ok(fired1.length >= 1, 'an English (or unlabelled) corpus still detects a real violation - the gate is not vacuously suppressing everything');
  }
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

  // direction 1: the ORIGINAL 3-page crawl (home/about/services) never reaches the complaints
  // page-class, so the record is screened (this is the CALIBRATION test's own baseline, reproved here
  // so this test stands on its own).
  const covOriginal = coverageContract.coverageFor(fx.catalogue.records, fx.bundle.corpus.pages, { truncated: fx.bundle.corpus.truncated });
  assert.strictEqual(covOriginal.rules.find((r) => r.id === fx.expect.record_id).state, 'screened', 'the original crawl never reaches the complaints page-class');

  // direction 2: add a page that classifies to the 'complaints' page-class (evidence/crawler/
  // coverage-contract.js classify() keys on the path token 'ombudsman', one of the two alternatives in
  // its complaints rule) - deliberately NOT a literal '/complaints' path. detection-spec.js separately
  // derives a url-path pattern of EXACTLY '/complaints' for this record's "findable" element, so a page
  // AT that path would satisfy the presence check by its mere existence and mask whether the disclosure
  // text itself is what fires the breach (verified against the live coverageContract/propose API,
  // caution.md C-192, before writing this assertion). The added page's own text still carries none of
  // the disclosure content, so the SAME missing disclosure this record needs is genuinely still absent.
  const ombudsmanPage = {
    url: 'https://screened.example/ombudsman', title: 'Ombudsman scheme',
    text: 'This page is a placeholder and does not yet contain the information visitors may be looking for here.',
    jsonLd: [],
  };
  const pages = fx.bundle.corpus.pages.concat([ombudsmanPage]);
  const b = { ...fx.bundle, corpus: { ...fx.bundle.corpus, pages } };
  const covCovered = coverageContract.coverageFor(fx.catalogue.records, pages, { truncated: b.corpus.truncated });
  assert.strictEqual(covCovered.rules.find((r) => r.id === fx.expect.record_id).state, 'covered', 'adding a complaints-class page flips the SAME record to covered');

  // ... and now that it is covered, the SAME missing disclosure actually FIRES an absence-breach -
  // proving the screen (not some other gate) was what suppressed it in direction 1.
  const forRecord = propose(b, fx.catalogue, covCovered).filter((c) => c.record_id === fx.expect.record_id);
  const firedOnes = fired(forRecord, KIND.ABSENCE_BREACH);
  assert.strictEqual(firedOnes.length, 1, 'the covered rule with the still-missing disclosure fires exactly one absence-breach');
  assert.strictEqual(firedOnes[0].suppressed_reason, null);
  assert.strictEqual(firedOnes[0].artifact.type, 'coverage_proof');
  assert.ok(firedOnes[0].artifact.pages_checked.includes(ombudsmanPage.url), 'the coverage_proof cites the actually-crawled complaints-class page');
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

// ── A1 POLARITY SCOPING (P3-tail Wave-2, C-238): a PRESENCE-breach (a found prohibited quote) is
//    self-sufficient Rule 3 evidence and is NEVER gated by the corpus-size floor or the C-024
//    truncation interlock; an ABSENCE-breach (a missing requirement) on the SAME corpus IS. Both
//    directions are proven on one thin/truncated corpus so the polarity split cannot silently regress. ─
test('A1: a presence-breach FIRES on a 1-page sub-floor corpus while the absence-breach on the same corpus is floored', () => {
  const b = bundle();
  b.corpus.pages = pages().slice(0, 1); // one page: below MIN_PAGES_FOR_ABSENCE
  b.corpus.pages[0].text = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it here.';
  const cands = propose(b, catalogue(), coverageFor(b));
  const pf = fired(cands, KIND.PRESENCE_BREACH);
  assert.strictEqual(pf.length, 1, 'the found prohibited quote fires despite the sub-floor corpus (not gated by the floor)');
  assert.strictEqual(pf[0].artifact.type, 'quote');
  assert.ok(b.corpus.pages[0].text.includes(pf[0].artifact.text), 'the quote is a verbatim substring (Gate-2 re-matchable)');
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0, 'the opposite polarity never fires on a 1-page corpus');
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /floor|page/i.test(c.suppressed_reason)), 'the absence claim is suppressed by the floor');
});

test('A1: a presence-breach FIRES on a TRUNCATED corpus while the absence-breach on the same corpus is C-024 demoted', () => {
  const b = bundle(); // 3 pages (>= floor) so ONLY truncation, not the floor, can gate the absence claim
  b.corpus.truncated = true;
  b.corpus.pages[0].text = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it here.';
  // Coverage is computed the way the harness does (run-real-proof.js / pipeline.js both pass {}), so the
  // coverage-contract's own truncation demotion stays dormant and this isolates propose()'s OWN interlock
  // (absenceInterlock reads bundle.corpus.truncated). NOTE: coverage-contract.js's truncation demotion is
  // keyed on hasAbsence (a PROHIBITION obligation), the OPPOSITE polarity to the C-024 absence class; if
  // coverage were computed with {truncated:true} it would screen this prohibition-bearing record and
  // wrongly eat the presence-breach - a dormant coverage-contract wart flagged to Rob (see the C-024
  // isolation test below and propose.test.js's russell-cooke note), not a propose() defect.
  const cov = coverageContract.coverageFor(catalogue().records, b.corpus.pages, {});
  const cands = propose(b, catalogue(), cov);
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).length, 1, 'the found prohibited quote fires despite truncation (a cut only removes text)');
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0, 'the opposite polarity never fires on a truncated corpus');
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /truncat/i.test(c.suppressed_reason)), 'the absence claim is demoted by the C-024 interlock');
});

test('CALIBRATION: the truncation-polarity fixture fires the presence-breach and suppresses the absence-breach (A1/A2/C-238)', () => {
  const file = path.join(FIXTURES, 'p3-proposer-truncation-polarity.json');
  assert.ok(fs.existsSync(file), 'the calibration fixture must exist');
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Coverage computed as the harness does (pass {}); propose() reads fx.bundle.corpus.truncated (true)
  // for its OWN absence interlock. See the A1 truncated test above for why {} (not {truncated:true}).
  const cov = coverageContract.coverageFor(fx.catalogue.records, fx.bundle.corpus.pages, {});
  const cands = propose(fx.bundle, fx.catalogue, cov);
  const pe = fx.expect.presence_breach;
  const ae = fx.expect.absence_breach;
  const presenceFired = cands.filter((c) => c.record_id === fx.expect.record_id && c.duty_idx === pe.duty_idx && !c.suppressed_reason);
  assert.strictEqual(presenceFired.length, pe.fired, 'A1: the presence-breach fires on the thin + truncated corpus');
  assert.strictEqual(presenceFired[0].artifact.type, pe.artifact_type);
  const absenceFired = cands.filter((c) => c.record_id === fx.expect.record_id && c.duty_idx === ae.duty_idx && !c.suppressed_reason);
  const absenceSupp = cands.filter((c) => c.record_id === fx.expect.record_id && c.duty_idx === ae.duty_idx && c.suppressed_reason);
  assert.strictEqual(absenceFired.length, ae.fired, 'A2/C-024: the absence-breach never fires on the thin + truncated corpus');
  assert.ok(absenceSupp.some((c) => new RegExp(ae.reason_matches, 'i').test(c.suppressed_reason)), 'the absence claim is demoted with a floor/truncation reason');
});

// ── A3: the committed eval/e2e synthetic fixture proposes exactly the one real prohibition finding.
//    Locks that the synthetic control matches a REAL compiled prohibition spec (UK_MHRA_POM_AD_BAN) and
//    that its 1-page corpus yields exactly one non-suppressed, Gate-2-verifiable presence-breach (also
//    the A1 thin-corpus proof: a single page yields the presence finding and no absence-breach). ───────
test('A3: the committed synthetic fixture proposes exactly 1 verified presence-breach (UK_MHRA_POM_AD_BAN)', () => {
  const { verifyCandidate } = require('../verifiers/quote-match.js');
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const synthPath = path.join(REPO_ROOT, 'eval', 'e2e', 'fixtures', 'synthetic-quote-breach.json');
  const fx = JSON.parse(fs.readFileSync(synthPath, 'utf8'));
  const b = fx.bundle;
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: b.corpus.truncated });
  const firedOnes = propose(b, catalogueArtifact, cov).filter((c) => !c.suppressed_reason && c.artifact);
  assert.strictEqual(firedOnes.length, 1, 'exactly one non-suppressed candidate on the 1-page corpus');
  const c = firedOnes[0];
  assert.strictEqual(c.kind, KIND.PRESENCE_BREACH);
  assert.strictEqual(c.record_id, 'UK_MHRA_POM_AD_BAN', 'it matches the real compiled prohibition spec');
  assert.strictEqual(c.artifact.type, 'quote');
  assert.ok(b.corpus.pages[0].text.includes(c.artifact.text), 'the quote is a verbatim substring of the page (Gate-2 re-matchable)');
  const token = fx.expected.known_breaches[0].match_any[0];
  assert.ok(c.artifact.text.includes(token), 'the known_breach match token is a discriminating substring of the quote');
  assert.strictEqual(verifyCandidate(c, b).verified, true, 'the synthetic presence-breach verifies end-to-end (Gate-2 quote re-match)');
});

// ═══ DEFECT-4: the token router matches WHOLE TOKENS, never substrings (healthcare-us.md defect B, C-059) ═══
// The old router did `token.includes(concept)`, so "health".includes("alt")===true routed an accessibility
// DOM node (html-has-lang) to US_FTC_HBNR, manufacturing a health-data-tracking VIOLATION out of a missing
// <html lang> - a WRONGLY-SHOWN false accusation reproduced on three real sites. The router now matches whole
// token to whole token (exact or single-'s' plural), so an accessibility node reaches ONLY accessibility duties.
test('DEFECT-4(c): a genuine accessibility DOM node routes ONLY to accessibility duties, NEVER to a health-data record ("health" no longer matches "alt")', () => {
  // Real dom-assert predicates, so the nodes carry the tier the lane truly stamps (not a hand-typed one).
  const langNode = htmlNode({ selector: 'html', snippet: '<html>', lang: '' });                 // genuine html-has-lang violation
  const labelNode = controlNode({ selector: 'input#q', snippet: '<input id="q">', controlType: 'text' }); // no labelling route at all -> genuine missing-label violation (P6 descriptor shape)
  const b = bundle({ browser: { lane: { ran: true, reason: null }, observed: [], consentControl: { found: false, healthy: null, url: null },
    domLane: { ran: true, reason: null }, domNodes: [langNode, labelNode] } });
  // Two synthetic behavioural duties: one whose tokens include the WORD "health" (mirrors US_FTC_HBNR),
  // one genuinely about accessibility. Under the old substring router the health duty spuriously "concerned"
  // the accessibility node via "health".includes("alt").
  const cat = { records: [
    { id: 'FAKE_HBNR_2099', regulator: {}, citation: {}, website_obligations: [
      { duty: 'Disclose to consumers any identifiable health data shared with third-party pixels or SDKs',
        elements: ['no undisclosed transmission of identifiable health information to tracking pixels'], evidence_type: 'behavioural' } ] },
    { id: 'FAKE_ACCESS_2099', regulator: {}, citation: {}, website_obligations: [
      { duty: 'The website must be accessible to screen reader users with disabilities',
        elements: ['content is accessible to disabled and screen reader users'], evidence_type: 'behavioural' } ] },
  ] };
  const doms = fired(propose(b, cat, coverageFor(b, cat)), KIND.BEHAVIOURAL).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  assert.strictEqual(doms.filter((c) => c.record_id === 'FAKE_HBNR_2099').length, 0, 'the health-data duty NEVER cites an accessibility node (the substring false accusation is gone)');
  assert.ok(doms.some((c) => c.record_id === 'FAKE_ACCESS_2099'), 'the genuine accessibility duty STILL routes the accessibility nodes (whole-token match preserved)');
});

test('DEFECT-4(c): the REAL US_FTC_HBNR record no longer manufactures a violation from an html-has-lang node', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const langNode = { rule_id: 'html-has-lang', selector: 'html', snippet: '<html>', wcag_sc: '3.1.1', state: 'violation', tier: 'deterministic' };
  const b = bundle({ browser: { lane: { ran: true, reason: null }, observed: [], consentControl: { found: false, healthy: null, url: null },
    domLane: { ran: true, reason: null }, domNodes: [langNode] } });
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const hbnr = propose(b, catalogueArtifact, cov).filter((c) => c.record_id === 'US_FTC_HBNR' && !c.suppressed_reason && c.artifact && c.artifact.type === 'dom_node');
  assert.strictEqual(hbnr.length, 0, 'US_FTC_HBNR never cites an accessibility DOM node as health-data-tracking evidence (healthcare-us.md defect B fixed)');
});

test('DEFECT-4(d): a correctly-labelled control emits NO missing-label violation, so it produces no candidate at all', () => {
  // A control WITH an associated <label for>/aria-label passes the dom-assert predicate (returns null): no
  // violation node, so the proposer has nothing to route - the "missing label" false positive is silent.
  // (P6: dom-assert.js's label predicate descriptor shape - repetition-audit-2026-07-19.md class #3, the
  // WPForms/duplicate-id false-positive fix; see evidence/browser/dom-assert.js and its own test suite for
  // the full positive/negative-control coverage of every labelling route.)
  const labelledDescriptor = {
    selector: 'input#name', snippet: '<input id="name">', controlType: 'text',
    labelElementText: 'Name', forIdLabelText: '', wrappingLabelText: '', ariaLabelText: '', ariaLabelledbyText: '', titleText: '',
    hasLabelElementRef: true, hasForIdLabelRef: false, hasWrappingLabelRef: false,
    hasAriaLabelAttr: false, hasAriaLabelledbyAttr: false, hasTitleAttr: false,
  };
  assert.strictEqual(controlNode(labelledDescriptor), null, 'a labelled control is not a violation node');
  const b = bundle({ browser: { lane: { ran: true, reason: null }, observed: [], consentControl: { found: false, healthy: null, url: null },
    domLane: { ran: true, reason: null }, domNodes: [] } }); // labelled control -> no node at all
  const cat = { records: [{ id: 'FAKE_ACCESS_2099', regulator: {}, citation: {}, website_obligations: [
    { duty: 'The website must be accessible to disabled users', elements: ['content is accessible to disabled and screen reader users'], evidence_type: 'behavioural' } ] }] };
  const doms = fired(propose(b, cat, coverageFor(b, cat)), KIND.BEHAVIOURAL).filter((c) => c.artifact && c.artifact.type === 'dom_node');
  assert.strictEqual(doms.length, 0, 'a correctly-labelled form yields no missing-label finding');
});

// ═══ DEFECT-5: a prohibition matches the VIOLATING language (curated prohibited_phrases), not the law prose;
// it fires on Title-Case headings isProse rejects; and the negation guard protects a compliant declaration. ═══
test('DEFECT-5(a): "Book your Botox treatment" FIRES the REAL UK_MHRA_POM_AD_BAN prohibition with the phrase as the verified artifact', () => {
  const { verifyCandidate } = require('../verifiers/quote-match.js');
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const b = bundle();
  b.corpus.pages[0].text = 'Book your Botox treatment today. Our expert team welcomes new clients across the whole city every week.';
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const pom = fired(propose(b, catalogueArtifact, cov), KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'UK_MHRA_POM_AD_BAN');
  assert.strictEqual(pom.length, 1, 'the POM advertising ban fires exactly once on the public Botox advertisement');
  assert.strictEqual(pom[0].artifact.type, 'quote');
  assert.ok(/Botox/.test(pom[0].artifact.text), 'the artifact quote carries the prohibited phrase');
  assert.ok(b.corpus.pages[0].text.includes(pom[0].artifact.text), 'the quote is a verbatim substring of the page (Gate-2 re-matchable)');
  assert.strictEqual(verifyCandidate(pom[0], b).verified, true, 'the presence-breach verifies end-to-end');
});

test('DEFECT-5(a2): the prohibition fires even when the Botox claim is a Title-Case HERO HEADING isProse rejects (RANK 2)', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const heading = 'Book Botox Today';                                 // 3 words, Title-Case: isProse === false
  assert.strictEqual(ds.isProse(heading), false, 'the heading is exactly the short Title-Case string isProse rejects');
  const b = bundle();
  b.corpus.pages[0].text = heading + '\nWelcome to our clinic serving clients across the whole city area here today.';
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const pom = fired(propose(b, catalogueArtifact, cov), KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'UK_MHRA_POM_AD_BAN');
  assert.strictEqual(pom.length, 1, 'the curated prohibited phrase matches the heading a prose-gated matcher would have missed');
  assert.strictEqual(pom[0].artifact.text, heading, 'the heading itself is the quoted evidence');
});

test('DEFECT-5(b): a compliant NEGATED Botox statement does NOT fire (negation guard, C-048/C-060 Botox-U18 class)', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const b = bundle();
  b.corpus.pages[0].text = 'We do not offer Botox or any other prescription-only medicine to members of the public here.';
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const cands = propose(b, catalogueArtifact, cov);
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'UK_MHRA_POM_AD_BAN').length, 0, 'a compliant "we do not offer Botox" is NEVER read as the prohibited claim being present');
  assert.ok(cands.some((c) => c.record_id === 'UK_MHRA_POM_AD_BAN' && c.suppressed_reason && /negated|review|self-declaration|C-048/i.test(c.suppressed_reason)), 'the guarded near-miss is recorded, not silent (C-037)');
});

test('DEFECT-5: the REAL CA_BPC_6157 outcome-guarantee prohibition fires on "We guarantee you will win" and is negation-guarded', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const win = bundle();
  win.corpus.pages[0].text = 'We guarantee you will win your case or you pay us nothing at all for our representation.';
  const covWin = coverageContract.coverageFor(catalogueArtifact.records, win.corpus.pages, { truncated: false });
  const fires = fired(propose(win, catalogueArtifact, covWin), KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'CA_BPC_6157');
  assert.strictEqual(fires.length, 1, 'the outcome-guarantee ban fires on the guarantee-you-will-win claim it previously MISSED');
  assert.ok(/guarantee you will win/i.test(fires[0].artifact.text), 'the artifact carries the offending guarantee phrase');
  // The negation guard: a compliant sentence that CONTAINS a prohibited phrase ("guaranteed results") but
  // NEGATES it ("we do not offer ...") must not fire - the phrase is present as a disclaimer, not a claim.
  const compliant = bundle();
  compliant.corpus.pages[0].text = 'We do not offer guaranteed results of any kind; every case turns on its own particular facts here.';
  const covOk = coverageContract.coverageFor(catalogueArtifact.records, compliant.corpus.pages, { truncated: false });
  const compCands = propose(compliant, catalogueArtifact, covOk);
  assert.strictEqual(fired(compCands, KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'CA_BPC_6157').length, 0, 'a negated "we do not offer guaranteed results" never fires (negation guard, C-048/C-060)');
  assert.ok(compCands.some((c) => c.record_id === 'CA_BPC_6157' && c.suppressed_reason && /negated|review|self-declaration|C-048/i.test(c.suppressed_reason)), 'the guarded near-miss is recorded, not silent');
});

// ═══ HIGH-10: register lane truthiness - a degraded-lane placeholder object must NEVER read as a
// compliant matched row (evalRegister/isMatchedRegisterRow) ═══════════════════════════════════════════
test('HIGH-10: isMatchedRegisterRow rejects a degraded-lane placeholder object, accepts a genuine matched row', () => {
  assert.strictEqual(isMatchedRegisterRow({ error: 'timeout' }), false, 'a degraded-lane object with no entity field is not a matched row');
  assert.strictEqual(isMatchedRegisterRow({ status: 'unavailable' }), false);
  assert.strictEqual(isMatchedRegisterRow(null), false);
  assert.strictEqual(isMatchedRegisterRow('yes'), false, 'a bare truthy string is not a row object');
  assert.strictEqual(isMatchedRegisterRow([{ name: 'x' }]), false, 'an array is not a row object');
  assert.strictEqual(isMatchedRegisterRow({ name: 'The Firm', id: '123' }), true);
  assert.strictEqual(isMatchedRegisterRow({ company_name: 'Acme Ltd' }), true);
  assert.strictEqual(isMatchedRegisterRow({ provider_name: 'Acme Clinic' }), true);
  assert.strictEqual(isMatchedRegisterRow({ organisation_name: '' }), false, 'an empty name string is not a match');
});

test('HIGH-10: a degraded-lane truthy register value with NO no_match note SUPPRESSES, never reads as compliant', () => {
  const b = bundle();
  b.registers = { frb: { error: 'timeout', ts: 12345 }, notes: [] }; // truthy, but not a genuine row shape
  const cands = propose(b, catalogue(), coverageFor(b));
  const registerCands = cands.filter((c) => c.kind === KIND.REGISTER);
  assert.strictEqual(fired(cands, KIND.REGISTER).length, 0, 'a degraded placeholder never fires a compliant clean pass nor a hard claim');
  assert.ok(registerCands.some((c) => c.suppressed_reason && /not definitively checked|C-004/i.test(c.suppressed_reason)), 'the missed non-registration is recorded as a suppression, not silently dropped');
});

test('HIGH-10: a degraded-lane truthy register value WITH a genuine no_match note still fires the weak register_absence candidate', () => {
  const b = bundle();
  b.registers = { frb: { error: 'timeout' }, notes: [{ register: 'frb', kind: 'no_match', reason: 'no candidate cleared the name match', detail: null }] };
  const c = fired(propose(b, catalogue(), coverageFor(b)), KIND.REGISTER)[0];
  assert.ok(c, 'a genuine no_match note still fires the weak candidate, the degraded placeholder never blocked it');
  assert.strictEqual(c.artifact.type, 'register_absence');
});

// ═══ HIGH-7: the negation/review guard is clause-scoped - a negation living in a DIFFERENT clause from
// the hit must not silently suppress a real violation; it downgrades to a FIRED, weak-confidence candidate
// (needs_human), never a suppression ═══════════════════════════════════════════════════════════════════
test('HIGH-7: a cross-clause negation ("We never charge admin fees, and results are guaranteed results...") FIRES at reduced confidence, not suppressed', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const b = bundle();
  b.corpus.pages[0].text = 'We never charge upfront fees, and we offer guaranteed results for every client who signs up today.';
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const cands = propose(b, catalogueArtifact, cov).filter((c) => c.record_id === 'CA_BPC_6157');
  const firedOnes = fired(cands, KIND.PRESENCE_BREACH);
  assert.strictEqual(firedOnes.length, 1, 'the hit clause ("guaranteed results") carries no negation of its own, so it FIRES rather than being suppressed by the unrelated "never charge fees" clause');
  assert.strictEqual(firedOnes[0].confidence_hint, 'weak', 'a cross-clause guard downgrades confidence rather than silently dropping the candidate (needs_human)');
  assert.ok(/guaranteed results/i.test(firedOnes[0].artifact.text));
  assert.strictEqual(cands.filter((c) => c.kind === KIND.PRESENCE_BREACH && c.suppressed_reason).length, 0, 'no PRESENCE_BREACH suppression is recorded for this record: the candidate fired, it was not swallowed');
});

test('HIGH-7: a SAME-clause negation still suppresses exactly as before (no regression)', () => {
  const catalogueArtifact = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const b = bundle();
  b.corpus.pages[0].text = 'We do not offer Botox or any other prescription-only medicine to members of the public here.';
  const cov = coverageContract.coverageFor(catalogueArtifact.records, b.corpus.pages, { truncated: false });
  const cands = propose(b, catalogueArtifact, cov);
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).filter((c) => c.record_id === 'UK_MHRA_POM_AD_BAN').length, 0);
});

test('HIGH-7: sentenceVerdict unit-level - needs_human only when the negation lives OUTSIDE the hit clause', () => {
  const specWithGuarantee = {
    record_id: 'X', duty_idx: 0, evidence_type: 'absence', page_class: null, surface: 'visible_text',
    patterns: [{ kind: 'anchored-regex', value: '\\bguaranteed\\W+results\\b', negation_guarded: true, prose_exempt: true }],
  };
  assert.strictEqual(sentenceVerdict(specWithGuarantee, 'We never charge admin fees, and your results are guaranteed results for everyone.'), 'needs_human');
  assert.strictEqual(sentenceVerdict(specWithGuarantee, 'We do not offer guaranteed results of any kind here.'), 'guarded');
  assert.strictEqual(sentenceVerdict(specWithGuarantee, 'Every client of ours receives guaranteed results within the first month here today.'), 'hit');
});

// ═══ HIGH-5: pathHasSegment/matchUrlPath must whole-token match, never substring (an underscore/
// concatenated slug must MATCH; the old code missed it and could fabricate a "missing disclosure") ═══════
test('HIGH-5: pathHasSegment matches an underscore-joined slug as a whole token (the false-absence vector)', () => {
  assert.strictEqual(pathHasSegment('https://clinic.example/complaints_policy', '/complaints'), true, 'complaints_policy must be recognised as carrying the complaints disclosure');
  assert.strictEqual(pathHasSegment('https://clinic.example/complaints-policy', '/complaints'), true, 'hyphenated form still matches (no regression)');
  assert.strictEqual(pathHasSegment('https://clinic.example/complaints', '/complaints'), true, 'exact segment still matches (no regression)');
  assert.strictEqual(pathHasSegment('https://clinic.example/about', '/complaints'), false, 'an unrelated page never matches');
});

test('HIGH-5: matchUrlPath end-to-end - a page at an underscore-joined slug satisfies a url-path presence pattern', () => {
  assert.strictEqual(matchUrlPath('/complaints', [{ url: 'https://clinic.example/complaints_policy' }, { url: 'https://clinic.example/about' }]), true);
  assert.strictEqual(matchUrlPath('/complaints', [{ url: 'https://clinic.example/about' }]), false);
});

// ═══ HIGH-8: a match rejected only by the isProse gate (a non-prose carrier: nav run / short heading for
// a NON-curated pattern) must record a VISIBLE suppression, never vanish via a bare 'skip' ═══════════════
test('HIGH-8: sentenceVerdict returns the distinct "nonprose" verdict for a non-prose_exempt hit in a non-prose carrier', () => {
  const bareSpec = {
    record_id: 'X', duty_idx: 0, evidence_type: 'absence', page_class: null, surface: 'visible_text',
    patterns: [{ kind: 'anchored-regex', value: '\\bwidget\\b', negation_guarded: true, prose_exempt: false }],
  };
  assert.strictEqual(sentenceVerdict(bareSpec, 'Widget Shop Buy Now'), 'nonprose', 'a short Title-Case run fails isProse and is NOT prose_exempt');
  assert.strictEqual(sentenceVerdict(bareSpec, 'Every widget we sell is carefully checked before it leaves our warehouse today.'), 'hit', 'genuine prose still fires normally');
});

test('HIGH-8: a presence-breach whose only hit sits in a non-prose carrier records a VISIBLE suppression, not a bare null', () => {
  const cat = { records: [{ id: 'FAKE_ACT_2099_NONPROSE', regulator: {}, citation: {}, website_obligations: [
    { duty: 'Do not advertise the prohibited "super widget" claim', elements: ['the phrase "super widget" must not appear'], evidence_type: 'absence' } ] }] };
  const b = bundle();
  b.corpus.pages[0].text = 'Super Widget Shop'; // 3 words, Title-Case: isProse === false; not prose_exempt (no curated phrase)
  const cands = propose(b, cat, coverageFor(b, cat));
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).length, 0, 'a non-prose-carrier-only hit never fires (not admissible quotable evidence)');
  assert.ok(suppressedOf(cands, KIND.PRESENCE_BREACH).some((c) => /non-prose|C-089/i.test(c.suppressed_reason)), 'the abstention is recorded, never a silent bare null (HIGH-8)');
});

// ═══ MEDIUM-11: registerTargetFor must whole-token match against parsed URL host+path / record-id
// tokens, never a raw substring test (the "ico" inside "silicon" class of false register routing) ═══════
test('MEDIUM-11: registerTargetFor does not treat a key as matched merely because it is a SUBSTRING of an unrelated word', () => {
  const record = { id: 'FAKE_SILICON_2099', regulator: { register_url: 'https://directory.example/silicon-valley-directory' }, citation: { url: 'https://fake.example/act' } };
  assert.strictEqual(registerTargetFor(record, ['ico']), null, '"ico" must not match merely because it is a substring of "silicon"');
});

test('MEDIUM-11: registerTargetFor still whole-token matches a real key in the URL path (no regression)', () => {
  const record = { id: 'FAKE_ACT_2099_MAIN', regulator: { register_url: 'https://register.fake.example/frb' }, citation: { url: 'https://fake.example/act' } };
  assert.strictEqual(registerTargetFor(record, ['frb', 'ico']), 'frb');
});

// ═══ MEDIUM-14: a zero-pattern spec (an obligation whose prose compiled to nothing) must record a VISIBLE
// suppression, never a bare null indistinguishable from a genuine compliant clean pass ══════════════════
test('MEDIUM-14: a zero-pattern presence/absence spec records a suppression, not a silent clean pass', () => {
  const cat = { records: [{ id: 'FAKE_ACT_2099_UNPATTERNABLE', regulator: {}, citation: {}, website_obligations: [
    { duty: 'Comply', elements: [], evidence_type: 'presence' },   // too short: < 2 distinctive tokens, no findability page_class -> zero patterns
    { duty: 'Do not act unlawfully', elements: [], evidence_type: 'absence' }, // no quoted phrase, no curated prohibited_phrases -> zero patterns
  ] }] };
  const b = bundle();
  const cands = propose(b, cat, coverageFor(b, cat));
  assert.strictEqual(fired(cands, KIND.ABSENCE_BREACH).length, 0);
  assert.strictEqual(fired(cands, KIND.PRESENCE_BREACH).length, 0);
  assert.ok(suppressedOf(cands, KIND.ABSENCE_BREACH).some((c) => /no detection patterns/i.test(c.suppressed_reason)), 'the zero-pattern presence obligation is a recorded suppression');
  assert.ok(suppressedOf(cands, KIND.PRESENCE_BREACH).some((c) => /no detection patterns/i.test(c.suppressed_reason)), 'the zero-pattern absence obligation is a recorded suppression');
});

// ═══ MEDIUM-15: cookie_pre_consent concept binding must require a distinctive 'cookie' token in the
// obligation's OWN words - 'marketing'/'analytics'/'consent' alone must never claim a cookie observation ═
test('MEDIUM-15: a marketing/analytics-only behavioural duty (no "cookie" word) does NOT claim a pre-consent cookie observation', () => {
  const cat = { records: [{ id: 'FAKE_MARKETING_2099', regulator: {}, citation: {}, website_obligations: [
    { duty: 'Obtain consent before any marketing analytics profiling of visitors', elements: ['marketing analytics consent obtained before profiling'], evidence_type: 'behavioural' } ] }] };
  const b = bundle();
  b.browser = { lane: { ran: true, reason: null }, consentControl: { found: false, healthy: null, url: null },
    observed: [{ kind: 'cookie_pre_consent', name: '_ga', host: 'ga.example', essential: false, networkEvent: {}, ts: 1 }] };
  assert.strictEqual(fired(propose(b, cat, coverageFor(b, cat)), KIND.BEHAVIOURAL).length, 0, 'a marketing/analytics/consent duty with no "cookie" word never claims the cookie event (wrong-law binding, MEDIUM-15)');
});

test('MEDIUM-15: obligationConcerns unit-level - "marketing" alone no longer concerns cookie_pre_consent', () => {
  const marketingOnlySpec = { patterns: [{ kind: 'token-set', value: { tokens: ['marketing', 'analytics', 'consent'], mode: 'any' } }] };
  assert.strictEqual(obligationConcerns(marketingOnlySpec, 'cookie_pre_consent'), false);
  const cookieSpec = { patterns: [{ kind: 'token-set', value: { tokens: ['cookie', 'consent'], mode: 'any' } }] };
  assert.strictEqual(obligationConcerns(cookieSpec, 'cookie_pre_consent'), true);
});

// ═══ O5: singularise must never collapse two unrelated words that merely share a stripped-'s' prefix ═════
test('O5: singularise never collapses an unrelated word onto a totally different concept stem', () => {
  assert.strictEqual(singularise('alias'), 'alias', '"alias" must not collapse to "alia" (not a known concept word)');
  assert.strictEqual(singularise('news'), 'news', '"news" is protected by the <=4-char floor');
  assert.strictEqual(tokenMatchesConcept('alias', 'alia'), false);
});

test('O5: singularise still performs the LEGITIMATE plural match a real concept needs', () => {
  assert.strictEqual(singularise('readers'), 'reader', '"readers" -> "reader" is a known DOM_NODE_CONCEPTS word');
  assert.strictEqual(singularise('trackers'), 'tracker', '"trackers" -> "tracker" is a known OBSERVATION_CONCEPTS word');
  assert.strictEqual(tokenMatchesConcept('readers', 'reader'), true);
  assert.strictEqual(tokenMatchesConcept('cookies', 'cookie'), true);
});

// ═══ MEDIUM-12: presence-by-URL must not over-credit a bare disclosure page; a url-path match now needs
// corroborating disclosure TEXT on that page, and an uncorroborated page routes to needs-review (weak),
// never a hard "missing X" accusation ════════════════════════════════════════════════════════════════
function complaintsCatalogue() {
  return { records: [{ id: 'FAKE_ACT_2099_COMPLAINTS', regulator: {}, citation: {}, website_obligations: [
    { duty: 'The complaints procedure must be findable on the website',
      elements: ['complaints procedure page available on the website', 'ombudsman referral details shown'], evidence_type: 'presence' },
  ] }] };
}
function complaintsBundle(extraPages) {
  const base = [
    { url: 'https://x.example/', title: 'Home', text: 'Welcome to our clinic serving the whole community every single day of the week here.', jsonLd: [] },
    { url: 'https://x.example/about', title: 'About', text: 'About our friendly team of experienced people who have worked here for many happy years now.', jsonLd: [] },
  ];
  const pages = base.concat(extraPages);
  return { domain: 'x.example', corpus: { pages, footerText: '', truncated: false }, registers: { notes: [] },
    browser: { observed: [], consentControl: { found: false, healthy: null, url: null }, lane: { ran: false, reason: 'x' } } };
}

test('MEDIUM-12(a): a BARE /complaints page (no complaints-procedure text) does NOT credit presence and routes to NEEDS-REVIEW (weak), never a hard absence breach', () => {
  const cat = complaintsCatalogue();
  const b = complaintsBundle([{ url: 'https://x.example/complaints', title: 'Complaints', text: 'Coming soon. This page is under construction and will be available shortly for all of our visitors here.', jsonLd: [] }]);
  const cov = coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: false });
  const forRecord = propose(b, cat, cov).filter((c) => c.record_id === 'FAKE_ACT_2099_COMPLAINTS');
  const firedOnes = fired(forRecord, KIND.ABSENCE_BREACH);
  assert.strictEqual(firedOnes.length, 1, 'the uncorroborated disclosure page surfaces exactly one candidate (real absence is no longer masked by a bare page)');
  assert.strictEqual(firedOnes[0].confidence_hint, 'weak', 'a bare/partial disclosure page is NEEDS-REVIEW (weak), never a hard "missing X" accusation (MEDIUM-12)');
  assert.strictEqual(firedOnes[0].artifact.type, 'coverage_proof');
});

test('MEDIUM-12(b): a GENUINE full disclosure on the /complaints page counts present and fires NOTHING', () => {
  const cat = complaintsCatalogue();
  const b = complaintsBundle([{ url: 'https://x.example/complaints', title: 'Complaints', text: 'Our complaints procedure is set out in full here for you. Contact our ombudsman referral service for an independent review.', jsonLd: [] }]);
  const cov = coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: false });
  const forRecord = propose(b, cat, cov).filter((c) => c.record_id === 'FAKE_ACT_2099_COMPLAINTS');
  assert.strictEqual(fired(forRecord, KIND.ABSENCE_BREACH).length, 0, 'a corroborated disclosure page is present -> no breach and no needs-review');
});

test('MEDIUM-12(c): total silence (no disclosure page at all) is STILL a hard moderate absence breach, not downgraded', () => {
  const cat = complaintsCatalogue();
  // an ombudsman-CLASS page exists (so coverage is "covered") but carries no complaints-procedure text and
  // is NOT at the /complaints url-path, so there is no disclosure page: genuine total silence.
  const b = complaintsBundle([{ url: 'https://x.example/ombudsman', title: 'Ombudsman', text: 'Placeholder page that does not yet contain the information visitors may be looking for here today.', jsonLd: [] }]);
  const cov = coverageContract.coverageFor(cat.records, b.corpus.pages, { truncated: false });
  assert.strictEqual(cov.rules.find((r) => r.id === 'FAKE_ACT_2099_COMPLAINTS').state, 'covered');
  const firedOnes = fired(propose(b, cat, cov).filter((c) => c.record_id === 'FAKE_ACT_2099_COMPLAINTS'), KIND.ABSENCE_BREACH);
  assert.strictEqual(firedOnes.length, 1);
  assert.strictEqual(firedOnes[0].confidence_hint, 'moderate', 'total silence remains a hard moderate breach - the fix only softens the PARTIAL (bare page) case, never the absent case');
});

test('MEDIUM-12: presenceState unit-level - present / partial / absent are correctly distinguished', () => {
  const ds2 = require('./detection-spec.js');
  const spec = ds2.compileRecordSpecs(complaintsCatalogue().records[0])[0];
  const bareCorroPage = [{ url: 'https://x.example/complaints', text: 'Coming soon.' }];
  const fullPage = [{ url: 'https://x.example/complaints', text: 'Our complaints procedure is here; ombudsman referral available.' }];
  assert.strictEqual(presenceState(spec, 'Our complaints procedure is documented here in full.', fullPage), 'present', 'text corroboration -> present');
  assert.strictEqual(presenceState(spec, 'nothing relevant on any page at all here today', bareCorroPage), 'partial', 'a bare disclosure page with no corroborating text -> partial');
  assert.strictEqual(presenceState(spec, 'nothing relevant on any page at all here today', [{ url: 'https://x.example/about', text: 'about us' }]), 'absent', 'no disclosure page and no text -> absent');
});

test('MEDIUM-12(c-regression): NO existing compliant-site test yields a false absence breach - the multi-element "present in body or footer" case still fires nothing', () => {
  // the existing FAKE_ACT_2099_MAIN presence obligation, disclosure present in the body (matches a strict
  // SUBSET of the alternative patterns) - must remain a clean pass, never a partial/needs-review candidate.
  const b = bundle();
  b.corpus.pages[1].text = 'We are an authorised widget provider and our widget reference number is 55 shown here clearly.';
  assert.strictEqual(fired(propose(b, catalogue(), coverageFor(b)), KIND.ABSENCE_BREACH).length, 0, 'a lenient text-present multi-element disclosure never downgrades to a false needs-review (alternatives are not treated as a strict subset)');
});

// ═══ MEDIUM-13: a prohibited token-set that co-occurs across a 2-3 SENTENCE window now produces a
// candidate (the "Results? Guaranteed." split-across-sentences class), while the negation/prose guard is
// applied to the WHOLE WINDOW so a window spanning a disclaimer never fires a false accusation ═══════════
function windowSpec() {
  return { record_id: 'FAKE_WINDOW_2099', duty_idx: 0, evidence_type: 'absence', page_class: null, surface: 'visible_text',
    patterns: [{ kind: 'token-set', value: { tokens: ['guaranteed', 'results'], mode: 'all' }, negation_guarded: true, prose_exempt: true }] };
}
function windowBundle(text) {
  return { domain: 'x.example', corpus: { pages: [{ url: 'https://x.example/', text }], truncated: false }, registers: { notes: [] }, browser: {} };
}

test('MEDIUM-13(a): "Results? Guaranteed." (tokens split across two sentences) now PRODUCES a candidate, artifact = the window text', () => {
  const out = evaluateSpec(windowSpec(), windowBundle('Wondering about our track record? Results? Guaranteed. Contact us today for more information here.'), { rules: [] }, {});
  const firedOnes = out.filter((c) => !c.suppressed_reason);
  assert.strictEqual(firedOnes.length, 1, 'the cross-sentence token co-occurrence now fires (single-sentence rule previously missed it)');
  assert.strictEqual(firedOnes[0].artifact.type, 'quote');
  assert.ok(/Results\? Guaranteed\./.test(firedOnes[0].artifact.text), 'the artifact is the 2-sentence window that carries both tokens');
});

test('MEDIUM-13(b): a window whose tokens are split across a NEGATED/disclaimer sentence does NOT fire (guard applies to the whole window)', () => {
  const out = evaluateSpec(windowSpec(), windowBundle('We never offer guaranteed outcomes of any kind. Results always vary between our individual clients here.'), { rules: [] }, {});
  assert.strictEqual(out.filter((c) => !c.suppressed_reason).length, 0, 'a window spanning a negation clause is guarded, never a false accusation');
  assert.ok(out.some((c) => c.suppressed_reason && /negated|review|self-declaration|C-048/i.test(c.suppressed_reason)), 'the guarded window is recorded, not silent (C-037)');
});

test('MEDIUM-13(c): anchored-regex phrase patterns KEEP the single-sentence rule (windowing does not span an anchored phrase across a sentence boundary)', () => {
  // an anchored-regex whose words fall in DIFFERENT sentences must NOT match via a window (only token-sets
  // window). This locks that the fix did not loosen anchored-phrase matching into a cross-sentence match.
  const anchoredSpec = { record_id: 'FAKE_ANCH_2099', duty_idx: 0, evidence_type: 'absence', page_class: null, surface: 'visible_text',
    patterns: [{ kind: 'anchored-regex', value: '\\bguaranteed\\W+results\\b', negation_guarded: true, prose_exempt: true }] };
  const out = evaluateSpec(anchoredSpec, windowBundle('Everything is guaranteed. Results speak for themselves in every single case we take on here.'), { rules: [] }, {});
  assert.strictEqual(out.filter((c) => !c.suppressed_reason).length, 0, 'an anchored phrase split across a sentence boundary does NOT fire (single-sentence rule preserved for anchored-regex)');
});

test('MEDIUM-13(c-regression): findWindowedTokenSetQuote is a no-op for a spec with NO token-set pattern (the real compiled prohibition shape) - zero production regression', () => {
  const anchoredOnly = { record_id: 'X', duty_idx: 0, evidence_type: 'absence', patterns: [{ kind: 'anchored-regex', value: '\\bbotox\\b', prose_exempt: true }] };
  const r = findWindowedTokenSetQuote(anchoredOnly, ['Book your', 'Botox treatment']);
  assert.deepStrictEqual(r, { quote: null, guarded: false, sawNonProse: false }, 'no token-set pattern -> the window pass never engages');
});
