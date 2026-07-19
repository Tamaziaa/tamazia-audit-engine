'use strict';
// facts/jurisdiction.test.js - node:test suite for the single-door JURISDICTION producer.
// Run: node --test facts/
//
// The Aman-approved Tier matrix is the spec under test (PRD section 3, caution C-006..C-023):
//   Tier A (weight 5) each ALONE binds; Tier B (weight 3) binds only in TWO INDEPENDENT kinds;
//   Tier C (weight 1) NEVER binds and feeds serves[] only. serves[] is separate from bound[].
//
// The two canonical failures from the old estate MUST appear here as rejected:
//   - the Mills & Reeve ghost-US footer (C-009): "incorporated in England and Wales" never binds
//     the United States, whatever marketing prose mentions the US.
//   - the fichtelegal DIFC-Courts advocacy class (C-010): court advocacy is not establishment and
//     never attaches a free zone or displaces the AE federal regime.
//
// ZERO inlined vocabulary: jurisdiction tokens, labels and routing tokens come from the module's
// own exports (TIER_WEIGHTS, VOCAB_SOURCE, internals) and from facts/vocabulary.js (the one door).
// Corpus text below is TEST INPUT (adversarial pages/footers), not vocabulary word-lists.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const jurisdiction = require('./jurisdiction.js');
const { resolveJurisdiction, TIER_WEIGHTS, VOCAB_SOURCE, internals } = jurisdiction;

// The one door for vocabulary. We read routing tokens / labels / extension codes from here so the
// test never re-authors a vocabulary string of its own.
const vocab = require('./vocabulary.js');

// The self-testing calibration fixture (the adversarial known-bad corpus). Wired in below so a
// regression in any trap fails `node --test`, not only the standalone fixture runner.
const calibrationFixture = require(
  path.resolve(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures', 'p1-jurisdiction-anchored-nexus.js')
);

// --- helpers ---------------------------------------------------------------

function bundleOf(overrides) {
  return Object.assign(
    { domain: 'example.com', corpus: { pages: [], footerText: '' }, registers: {} },
    overrides
  );
}

function pageBundle(text, overrides) {
  return bundleOf(Object.assign(
    { corpus: { pages: [{ url: 'https://example.com/', title: 'Home', text, jsonLd: [] }], footerText: '' } },
    overrides
  ));
}

function footerBundle(footerText, overrides) {
  return bundleOf(Object.assign({ corpus: { pages: [], footerText } }, overrides));
}

function boundCodes(out) {
  return out.bound.map((b) => b.jurisdiction);
}

function findBound(out, code) {
  return out.bound.find((b) => b.jurisdiction === code) || null;
}

function bKinds(entry) {
  return new Set(entry.tier_evidence.filter((e) => e.tier === 'B').map((e) => e.kind));
}

const VALID_CONFIDENCE = new Set(vocab.CONFIDENCE_LEVELS);

// ===========================================================================
// Output contract / shape
// ===========================================================================

test('output has the four contract keys with the right shapes', () => {
  const out = resolveJurisdiction(bundleOf({}));
  assert.ok(Array.isArray(out.bound), 'bound is an array');
  assert.ok(Array.isArray(out.serves), 'serves is an array');
  assert.ok(Array.isArray(out.sub_jurisdictions), 'sub_jurisdictions is an array');
  assert.equal(typeof out.abstained, 'boolean', 'abstained is a boolean');
});

test('every bound entry carries jurisdiction, tier_evidence[], graded confidence and a numeric score', () => {
  const out = resolveJurisdiction(footerBundle('Authorised and regulated by the SRA, number 512345.'));
  assert.ok(out.bound.length >= 1, 'a Tier-A footer binds');
  for (const b of out.bound) {
    assert.equal(typeof b.jurisdiction, 'string');
    assert.ok(Array.isArray(b.tier_evidence) && b.tier_evidence.length >= 1);
    assert.ok(VALID_CONFIDENCE.has(b.confidence), 'confidence is a vocabulary grade');
    assert.equal(typeof b.score, 'number');
    for (const e of b.tier_evidence) {
      assert.ok(['A', 'B', 'C'].includes(e.tier), 'evidence tier is A/B/C');
      assert.equal(typeof e.kind, 'string');
      assert.equal(typeof e.source, 'string');
      assert.equal(e.weight, TIER_WEIGHTS[e.tier], 'evidence weight matches the tier weight table');
    }
  }
});

test('evidence weights are exactly the module tier-weight table (A=5, B=3, C=1)', () => {
  // Read the numbers from the module, never inline them.
  assert.equal(TIER_WEIGHTS.A, 5);
  assert.equal(TIER_WEIGHTS.B, 3);
  assert.equal(TIER_WEIGHTS.C, 1);
  assert.ok(TIER_WEIGHTS.A > TIER_WEIGHTS.B && TIER_WEIGHTS.B > TIER_WEIGHTS.C);
});

// ===========================================================================
// Tier A: each signal alone is sufficient to bind
// ===========================================================================

test('Tier A: a usable register row binds, register-backed confidence', () => {
  const out = resolveJurisdiction(bundleOf({
    registers: { companiesHouse: { name: 'Acme Ltd', company_number: '12345678' } },
    domain: 'acme.co.uk',
  }));
  const uk = findBound(out, 'UK');
  assert.ok(uk, 'UK binds off a Companies House row');
  assert.equal(uk.confidence, 'register', 'a register row grades register');
  assert.ok(uk.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'register'));
  assert.equal(out.abstained, false);
});

test('Tier A: an on-site authorisation statement WITH a number binds (corroborated)', () => {
  const out = resolveJurisdiction(footerBundle('Authorised and regulated by the Solicitors Regulation Authority, SRA number 512345.'));
  const uk = findBound(out, 'UK');
  assert.ok(uk, 'the authorisation statement binds UK');
  assert.equal(uk.confidence, 'corroborated', 'on-site Tier A is corroborated, not register');
  assert.ok(uk.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'authorisation'));
});

test('Tier A: a registered-office block anchored by a named country binds', () => {
  const out = resolveJurisdiction(footerBundle('Registered office in Germany. Preise ab 500 EUR.'));
  const de = findBound(out, 'DE');
  assert.ok(de, 'the registered-office block binds Germany');
  assert.ok(de.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'registered_office'));
});

test('Tier A: a registered-office block anchored ONLY by a country-distinctive postcode binds', () => {
  const out = resolveJurisdiction(footerBundle('Registered office: 10 Downing Street, SW1A 2AA.'));
  const uk = findBound(out, 'UK');
  assert.ok(uk, 'a UK postcode anchors the statutory block even with no country word');
  assert.ok(uk.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'registered_office'));
});

test('Tier A: "incorporated in <country>" binds the named country', () => {
  const out = resolveJurisdiction(footerBundle('The company is incorporated in the Netherlands.'));
  const nl = findBound(out, 'NL');
  assert.ok(nl, 'incorporated-in binds NL');
  assert.ok(nl.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'incorporated_in'));
});

// ===========================================================================
// Tier A guards: claims that must NOT reach Tier A
// ===========================================================================

test('an authorisation claim with NO number stays Tier C and never binds (C-014)', () => {
  const out = resolveJurisdiction(footerBundle('Authorised and regulated by the Financial Conduct Authority.'));
  assert.equal(out.abstained, true, 'no number => no Tier A => abstain');
  assert.deepEqual(boundCodes(out), []);
});

test('a bare authority mention in prose never binds (a firm writing about the FCA is not regulated by it)', () => {
  const out = resolveJurisdiction(pageBundle('We often deal with the Financial Conduct Authority on behalf of clients.'));
  assert.equal(out.abstained, true);
  assert.deepEqual(boundCodes(out), []);
});

test('empty-register non-match: a bare {} register response is not a match (C-004)', () => {
  const out = resolveJurisdiction(bundleOf({ registers: { companiesHouse: {} } }));
  assert.equal(out.abstained, true);
  assert.ok(!boundCodes(out).includes('UK'));
});

test('a register row with an id but no name, or a name but no id, is not usable (C-004)', () => {
  const idOnly = resolveJurisdiction(bundleOf({ registers: { companiesHouse: { company_number: '12345678' } } }));
  const nameOnly = resolveJurisdiction(bundleOf({ registers: { companiesHouse: { name: 'Acme Ltd' } } }));
  assert.ok(!boundCodes(idOnly).includes('UK'), 'id without a name does not bind');
  assert.ok(!boundCodes(nameOnly).includes('UK'), 'name without an id does not bind');
});

// ===========================================================================
// Tier B: two INDEPENDENT kinds bind; one kind (or two of the same kind) does not
// ===========================================================================

test('Tier B: two independent kinds (cctld + phone + currency) bind, corroborated', () => {
  const out = resolveJurisdiction(pageBundle('Call +44 20 7946 0000. Prices from £500 per audit.', { domain: 'x.co.uk' }));
  const uk = findBound(out, 'UK');
  assert.ok(uk, 'independent Tier-B kinds bind UK');
  assert.equal(uk.confidence, 'corroborated');
  assert.ok(bKinds(uk).size >= 2, 'binding required at least two distinct Tier-B kinds');
});

test('Tier B: a single kind (ccTLD alone) never binds', () => {
  const out = resolveJurisdiction(bundleOf({ domain: 'x.co.uk' }));
  assert.equal(out.abstained, true, 'one Tier-B kind is not enough');
  assert.deepEqual(boundCodes(out), []);
});

test('Tier B independence: two of the SAME kind count once and never bind (C-007)', () => {
  // Two UK phone numbers are two matches of ONE kind ("phone"); they must not fake a second kind.
  const out = resolveJurisdiction(pageBundle('Call +44 20 7946 0000 or +44 161 555 0000.'));
  assert.equal(out.abstained, true, 'same-kind repetition never reaches two independent kinds');
  assert.deepEqual(boundCodes(out), []);
});

// ===========================================================================
// Tier C: never binds, feeds serves[] only; serves[] is separate from bound[]
// ===========================================================================

test('Tier C: marketing prose, bar admissions and case studies never attach law in any combination', () => {
  const out = resolveJurisdiction(pageBundle(
    'We advise clients across the Middle East and in Dubai. Our partners are admitted to the New York bar. Case study: a client in Germany.'
  ));
  assert.equal(out.abstained, true, 'Tier C never binds');
  for (const poison of ['AE', 'US', 'DE', 'EU']) {
    assert.ok(!boundCodes(out).includes(poison), poison + ' must not bind off Tier-C prose');
  }
});

test('serves[] is separate from bound[]: a serves-only jurisdiction is never in bound', () => {
  const out = resolveJurisdiction(pageBundle('We serve clients across Europe and the Middle East, including Germany.'));
  assert.equal(out.abstained, true);
  const served = out.serves.map((s) => s.jurisdiction);
  assert.ok(served.includes('DE'), 'Germany is a marketing-reach entry in serves');
  assert.ok(!boundCodes(out).includes('DE'), 'a served jurisdiction did not leak into bound');
  assert.ok(served.some((s) => s.startsWith('region:')), 'region reach lands in serves');
});

// ===========================================================================
// Ghost-US regression (C-009, the Mills & Reeve class)
// ===========================================================================

test('ghost-US: "incorporated in England and Wales" + a US marketing line binds UK only', () => {
  const out = resolveJurisdiction(bundleOf({
    corpus: {
      pages: [{ url: 'https://example.com/', text: 'M&R Global | USA and Canada', jsonLd: [] }],
      footerText: 'Mills & Reeve LLP is a limited liability partnership incorporated in England and Wales. Company number OC326013. Our office in Cambridge.',
    },
  }));
  assert.ok(boundCodes(out).includes('UK'), 'UK binds off the anchored incorporated-in span');
  assert.ok(!boundCodes(out).includes('US'), 'the US marketing line must never bind the United States');
  assert.deepEqual(boundCodes(out), ['UK'], 'bound is UK and nothing else');
});

test('anchored nexus: the country must be named INSIDE the establishment span', () => {
  // Delaware inside the span binds US; a bare US mention in another sentence does not add a nexus.
  const out = resolveJurisdiction(pageBundle('Incorporated in Delaware. We also love the United States.'));
  assert.ok(boundCodes(out).includes('US'), 'Delaware in the span binds US');
  const us = findBound(out, 'US');
  assert.ok(us.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'incorporated_in'));
});

// ===========================================================================
// Fichtelegal regression (C-010) + service-offer guard (C-011)
// ===========================================================================

test('fichtelegal: "registered with the DIFC Courts" is advocacy, not free-zone establishment', () => {
  const out = resolveJurisdiction(footerBundle(
    'Our litigators are registered with the DIFC Courts and appear regularly before the DIFC Courts. Based in Dubai.'
  ));
  assert.ok(!out.sub_jurisdictions.some((s) => s.code === 'DIFC'), 'no DIFC sub-jurisdiction attaches');
  assert.ok(!out.sub_jurisdictions.some((s) => s.code === 'ADGM'), 'no ADGM sub-jurisdiction attaches');
  // and therefore no federal-regime displacement is asserted
  assert.ok(!out.sub_jurisdictions.some((s) => Array.isArray(s.displaces) && s.displaces.includes(vocab.AE_FEDERAL_DP_TOKEN)));
});

test('service-offer guard: selling establishment ("we help you set up in the DIFC") proves nothing', () => {
  const out = resolveJurisdiction(pageBundle('We help you set up in the DIFC. Company formation services for the UAE and the United Kingdom.'));
  assert.equal(out.abstained, true);
  for (const poison of ['UK', 'AE']) assert.ok(!boundCodes(out).includes(poison));
  assert.ok(!out.sub_jurisdictions.some((s) => s.code === 'DIFC' || s.code === 'ADGM'));
});

// ===========================================================================
// Free zones: establishment binds AE, displaces the federal regime, DIFC precedence
// ===========================================================================

test('DIFC establishment binds AE and the DIFC sub displaces the AE federal DP regime', () => {
  const out = resolveJurisdiction(footerBundle('Our firm is registered in the DIFC. Offices in Dubai.', { domain: 'x.ae' }));
  assert.ok(boundCodes(out).includes('AE'), 'a DIFC licence is an AE nexus');
  const difc = out.sub_jurisdictions.find((s) => s.code === 'DIFC');
  assert.ok(difc && difc.status === 'bound', 'DIFC attaches as a bound sub-jurisdiction');
  assert.deepEqual(difc.displaces, [vocab.AE_FEDERAL_DP_TOKEN], 'the free zone displaces the federal DP routing token');
});

test('at most one free zone attaches: DIFC takes precedence over ADGM (E-221)', () => {
  const out = resolveJurisdiction(footerBundle('Registered in the DIFC and licensed in the ADGM. Offices in Dubai and Abu Dhabi.', { domain: 'x.ae' }));
  const zones = out.sub_jurisdictions.filter((s) => s.code === 'DIFC' || s.code === 'ADGM').map((s) => s.code);
  assert.deepEqual(zones, ['DIFC'], 'only DIFC attaches when both are established');
});

test('ADGM alone attaches when it is the only established zone', () => {
  const out = resolveJurisdiction(footerBundle('Incorporated in the ADGM. Al Maryah Island, Abu Dhabi.', { domain: 'x.ae' }));
  assert.ok(boundCodes(out).includes('AE'));
  assert.ok(out.sub_jurisdictions.some((s) => s.code === 'ADGM' && s.status === 'bound'));
});

// ===========================================================================
// US sub-jurisdictions: observable nexus is bound, mentions/bar are advisory
// ===========================================================================

test('US: an office address with state + ZIP is a bound state nexus', () => {
  const out = resolveJurisdiction(pageBundle('Office: 350 Fifth Avenue, New York, NY 10118. Incorporated in Delaware.'));
  assert.ok(boundCodes(out).includes('US'));
  const ny = out.sub_jurisdictions.find((s) => s.code === 'NY');
  assert.ok(ny && ny.status === 'bound' && ny.basis === 'office_address');
});

test('US: state registration inside the establishment span is a bound state nexus', () => {
  const out = resolveJurisdiction(footerBundle('Incorporated in Delaware.'));
  const de = out.sub_jurisdictions.find((s) => s.code === 'DE');
  assert.ok(de && de.status === 'bound' && de.basis === 'state_registration');
});

test('US: a bar admission is advisory only, and only when a US parent is otherwise bound', () => {
  const out = resolveJurisdiction(pageBundle('Incorporated in Delaware. Our partners are admitted to the New York bar.'));
  assert.ok(boundCodes(out).includes('US'), 'US binds off Delaware incorporation');
  const ny = out.sub_jurisdictions.find((s) => s.code === 'NY');
  assert.ok(ny && ny.status === 'advisory' && ny.basis === 'bar_admission', 'the NY bar admission renders advisory, never bound');
});

test('US: with no bound US parent, a state mention attaches no sub-jurisdiction', () => {
  const out = resolveJurisdiction(pageBundle('Our partners are admitted to the New York bar.'));
  assert.equal(out.abstained, true, 'a bar admission alone never binds US');
  assert.deepEqual(out.sub_jurisdictions, [], 'no advisory sub without a bound parent');
});

// ===========================================================================
// UK devolved nation from the postcode area
// ===========================================================================

test('UK: the devolved nation resolves from the postcode area', () => {
  const out = resolveJurisdiction(bundleOf({
    registers: { companiesHouse: { name: 'Highland Co', number: 'SC123456', office: '1 George St, Edinburgh EH2 2LL' } },
    domain: 'x.scot',
  }));
  assert.ok(boundCodes(out).includes('UK'));
  assert.ok(out.sub_jurisdictions.some((s) => s.code === 'Scotland' && s.status === 'bound'));
});

// ===========================================================================
// EU derivation: a bound member state binds the supranational layer; the UK does not
// ===========================================================================

test('EU: a bound member state derives an EU binding', () => {
  const out = resolveJurisdiction(footerBundle('Registered office in Germany. Preise ab 500 EUR.'));
  assert.ok(boundCodes(out).includes('DE'));
  assert.ok(boundCodes(out).includes('EU'), 'a bound EU member state derives EU');
});

test('EU: the UK is NOT an EU member and never derives EU', () => {
  const out = resolveJurisdiction(bundleOf({
    registers: { companiesHouse: { name: 'UK Co', number: '12345678' } },
    domain: 'x.co.uk',
  }));
  assert.ok(boundCodes(out).includes('UK'));
  assert.ok(!boundCodes(out).includes('EU'), 'UK does not pull in the EU layer');
});

// ===========================================================================
// Abstention: no default jurisdiction (C-006)
// ===========================================================================

test('confident-default disease: no evidence means abstention, never a default jurisdiction', () => {
  const out = resolveJurisdiction(bundleOf({}));
  assert.equal(out.abstained, true);
  assert.deepEqual(out.bound, []);
  assert.deepEqual(out.serves, []);
  assert.deepEqual(out.sub_jurisdictions, []);
});

test('resolveJurisdiction tolerates a null / empty bundle without throwing', () => {
  for (const input of [undefined, null, {}, { corpus: null }, { corpus: { pages: null } }]) {
    const out = resolveJurisdiction(input);
    assert.equal(out.abstained, true, 'a degenerate bundle abstains, it does not crash');
    assert.deepEqual(out.bound, []);
  }
});

// ===========================================================================
// Scoring: Tier weights compose; register outranks a two-kind Tier-B bind
// ===========================================================================

test('scoring: a Tier-A register bind scores higher than a bare two-kind Tier-B bind', () => {
  const reg = resolveJurisdiction(bundleOf({
    registers: { companiesHouse: { name: 'Acme Ltd', company_number: '12345678' } }, domain: 'acme.co.uk',
  }));
  // domain example.com (no ccTLD) so DE binds on exactly two Tier-B kinds: phone + currency.
  const twoB = resolveJurisdiction(pageBundle('Call +49 30 1234567. Preise ab 500 EUR.', { domain: 'example.com' }));
  const de = findBound(twoB, 'DE');
  assert.ok(de, 'DE binds on two independent Tier-B kinds');
  assert.equal(bKinds(de).size, 2, 'exactly two Tier-B kinds (phone + currency)');
  const regScore = findBound(reg, 'UK').score;
  assert.ok(regScore > TIER_WEIGHTS.B * 2, 'a register-backed bind carries Tier-A weight');
  assert.ok(regScore >= de.score, 'register bind is not out-scored by a two-kind Tier-B bind');
});

// ===========================================================================
// Vocabulary seam (one door): the module loads facts/vocabulary.js and its COUNTRY_TOKENS extend
// ===========================================================================

test('VOCAB_SOURCE records that facts/vocabulary.js is the live token source', () => {
  assert.equal(VOCAB_SOURCE, 'facts/vocabulary.js');
});

test('the vocabulary COUNTRY_TOKENS extension is live: an extension-only code binds', () => {
  // SA (Saudi Arabia) exists ONLY in facts/vocabulary.js COUNTRY_TOKENS, not in the module's
  // internal defaults; a registered-office statement in Saudi Arabia must therefore bind SA.
  assert.ok(Object.prototype.hasOwnProperty.call(vocab.COUNTRY_TOKENS, 'SA'), 'the fixture assumes SA is an extension-only code');
  const out = resolveJurisdiction(footerBundle('Registered office in Riyadh, Saudi Arabia.'));
  assert.ok(boundCodes(out).includes('SA'), 'the extension token bound Saudi Arabia via the seam');
});

// ===========================================================================
// White-box internals (exposed for tests only)
// ===========================================================================

test('internals.splitSentences splits on terminal punctuation and newlines and trims', () => {
  const s = internals.splitSentences('One sentence. Two sentences!\nThird line');
  assert.deepEqual(s, ['One sentence.', 'Two sentences!', 'Third line']);
});

test('internals.matchCountries returns the country codes present in text', () => {
  assert.deepEqual(internals.matchCountries('based in france'), ['FR']);
  assert.deepEqual(internals.matchCountries('nothing here'), []);
});

test('internals.ukNation maps a postcode area to its devolved nation', () => {
  assert.equal(internals.ukNation('EH2 2LL'), 'Scotland');
  assert.equal(internals.ukNation('CF10 1EP'), 'Wales');
  assert.equal(internals.ukNation('BT1 5GS'), 'Northern Ireland');
  assert.equal(internals.ukNation('SW1A 2AA'), 'England');
});

test('internals.cctldJurisdiction resolves the ccTLD, longest suffix first', () => {
  assert.equal(internals.cctldJurisdiction('acme.co.uk'), 'UK');
  assert.equal(internals.cctldJurisdiction('https://acme.ae/path'), 'AE');
  assert.equal(internals.cctldJurisdiction('acme.com'), null);
});

test('internals.phoneJurisdiction maps the dialling prefix, longest prefix first', () => {
  assert.equal(internals.phoneJurisdiction('442079460000'), 'UK');
  assert.equal(internals.phoneJurisdiction('97141234567'), 'AE');
});

test('internals.registerIsUsable requires BOTH a real id and a name', () => {
  assert.equal(internals.registerIsUsable({ name: 'Acme Ltd', company_number: '12345678' }), true);
  assert.equal(internals.registerIsUsable({ name: 'Acme Ltd' }), false);
  assert.equal(internals.registerIsUsable({ company_number: '12345678' }), false);
  assert.equal(internals.registerIsUsable({}), false);
  assert.equal(internals.registerIsUsable(null), false);
});

// ===========================================================================
// WS-Signals (KIMI-K3-DEEP-BLUEPRINT-2026-07-20 §B3): npi (NPPES, US healthcare) is a Tier-A
// register-home like companiesHouse/sra/cqc/fca/ico; rdap (rdap.org) is capped at Tier C by
// construction and must NEVER bind on its own, however many other Tier-C signals agree.
// ===========================================================================

test('WS-Signals positive: an NPPES-matched npi register row is Tier-A US establishment evidence', () => {
  const bundle = bundleOf({
    registers: { npi: { id: '1999999999', name: 'EXAMPLE FAMILY HEALTH CLINIC', taxonomy_code: '207Q00000X' } },
  });
  const out = resolveJurisdiction(bundle);
  const us = findBound(out, 'US');
  assert.ok(us, 'npi register row must bind US');
  assert.equal(us.confidence, 'register');
  assert.ok(us.tier_evidence.some((e) => e.tier === 'A' && e.source === 'registers.npi'));
});

test('WS-Signals negative: an RDAP registrant_country ALONE never binds a jurisdiction (Tier C only, Rule 13)', () => {
  const bundle = bundleOf({ registers: { rdap: { registrant_country: 'FR', source: 'rdap' } } });
  const out = resolveJurisdiction(bundle);
  assert.equal(boundCodes(out).includes('FR'), false);
  assert.equal(out.abstained, true);
});

test('WS-Signals negative: RDAP + a second Tier-C-only signal STILL never binds (Tier C never combines up, C-014/Rule 13)', () => {
  const bundle = pageBundle('We are proud to serve clients across France and internationally.', {
    registers: { rdap: { registrant_country: 'FR', source: 'rdap' } },
  });
  const out = resolveJurisdiction(bundle);
  assert.equal(boundCodes(out).includes('FR'), false);
});

test('WS-Signals: RDAP feeds serves[] (marketing-reach) as a weak signal, never bound[]', () => {
  const bundle = bundleOf({ registers: { rdap: { registrant_country: 'DE', source: 'rdap' } } });
  const out = resolveJurisdiction(bundle);
  const servesDe = out.serves.find((s) => s.jurisdiction === 'DE');
  assert.ok(servesDe, 'a Tier-C-only RDAP hit should still surface in serves[]');
  assert.equal(servesDe.confidence, 'weak');
});

test('WS-Signals: a registrant_country RDAP cannot map (outside the launch code set) is dropped, never fabricated into a jurisdiction', () => {
  const bundle = bundleOf({ registers: { rdap: { registrant_country: 'ZZ', source: 'rdap' } } });
  const out = resolveJurisdiction(bundle);
  assert.equal(out.abstained, true);
  assert.equal(out.serves.length, 0);
});

// ===========================================================================
// DEFECT-3: real-world US/UK address + phone formats bind (repetition class #5, inverted
// over-abstention). Every case below carries a POSITIVE control (the real firm binds) AND the
// negative controls that keep the fix from opening a false-binding hole (a .com or a lone domestic
// number never binds). Corpus strings are the empirical sites' ACTUAL captured text.
// ===========================================================================

test('DEFECT-3 positive: a US firm with a spelled-out state + ZIP and a domestic phone binds US (healthcare-US Defect D, vanfamilymedical.com)', () => {
  // The address and the phone sit on separate footer lines, split from the "Head Office" context word.
  const out = resolveJurisdiction(pageBundle('Head Office\n\n488 West Main Ste. 101 Van, Texas 75790\n\n903-963-6850\n\ncustomerservice@van.com', { domain: 'vanfamilymedical.com' }));
  const us = findBound(out, 'US');
  assert.ok(us, 'a real US "Head Office" address + domestic phone must bind US, not abstain');
  assert.ok(bKinds(us).size >= 2, 'two independent Tier-B kinds (postcode + phone) carried the bind');
  const tx = out.sub_jurisdictions.find((s) => s.code === 'TX');
  assert.ok(tx && tx.status === 'bound', 'the spelled-out state Texas + ZIP is a bound state nexus');
});

test('DEFECT-3 positive: a US footer with a state code + ZIP and a NANP domestic phone binds US (legal-US Finding 4, avidlawyers.com)', () => {
  const out = resolveJurisdiction(pageBundle('Mincone Personal Injury Lawyers, 1925 E 6th Ave Unit 10, Tampa, FL 33605, United States. Call (813) 800-0810 today.', { domain: 'avidlawyers.com' }));
  const us = findBound(out, 'US');
  assert.ok(us, 'the plain-text US address + (813) domestic phone must bind US');
  assert.ok(bKinds(us).size >= 2, 'postcode + phone are two independent Tier-B kinds');
  assert.ok(out.sub_jurisdictions.some((s) => s.code === 'FL' && s.status === 'bound'), 'Florida is a bound state nexus');
});

test('DEFECT-3 positive: a UK "+44 (0) ..." phone with a postcode address binds UK (legal-UK Fix 4, ukimmigrationconsulting.com)', () => {
  // "+44 (0) 7896 085 553" carries a " (" and ") " run the old single-separator PHONE_RX could not span.
  const out = resolveJurisdiction(pageBundle('Queen Victoria House, 794 Cranbrook Road, Ilford, IG6 1HZ, UK. Call +44 (0) 7896 085 553.', { domain: 'ukimmigrationconsulting.com' }));
  const uk = findBound(out, 'UK');
  assert.ok(uk, 'postcode + a bracketed UK phone are two Tier-B kinds; UK must bind, not abstain');
  assert.ok(bKinds(uk).size >= 2, 'the phone kind is recovered from the bracketed "+44 (0)" format');
});

test('DEFECT-3 negative: a US domestic phone ALONE (no US address) never binds US (one Tier-B kind is not enough)', () => {
  const out = resolveJurisdiction(pageBundle('Call us on 903-963-6850 for a free quote.', { domain: 'acme.com' }));
  assert.equal(out.abstained, true, 'a lone NANP phone is one kind; it must not bind on its own');
  assert.ok(!boundCodes(out).includes('US'));
});

test('DEFECT-3 negative: a bare .com with no other evidence never binds US (a mere .com must not bind a jurisdiction)', () => {
  const out = resolveJurisdiction(bundleOf({ domain: 'acme.com', corpus: { pages: [{ url: 'https://acme.com/', text: 'Welcome to our website.', jsonLd: [] }], footerText: '' } }));
  assert.equal(out.abstained, true);
  assert.deepEqual(boundCodes(out), []);
});

test('DEFECT-3 negative: a UK "+44 (0)" number and a UK postcode never bind the US (the domestic-phone widening is US-scoped)', () => {
  const out = resolveJurisdiction(pageBundle('Call +44 (0) 7896 085 553. Office at 794 Cranbrook Road, Ilford, IG6 1HZ.', { domain: 'x.co.uk' }));
  assert.ok(!boundCodes(out).includes('US'), 'a leading-0 UK number can never match the NANP domestic detector (area code 2-9)');
});

test('DEFECT-3 independence: two US office postcodes are still ONE kind and never bind alone (C-007)', () => {
  const out = resolveJurisdiction(pageBundle('Offices at 350 Fifth Avenue, New York, NY 10118 and 100 Main St, San Diego, CA 92101.', { domain: 'acme.com' }));
  assert.equal(out.abstained, true, 'two postcodes are two matches of ONE kind; no second independent kind, no bind');
});

// ===========================================================================
// DEFECT-8: US state-bar authorisation is Tier-A establishment (the state advertising records are
// established_in-only). Positive: a firm publishing its bar credentials binds the state at Tier A.
// Negative: merely NAMING a state bar (a complaint route) is a Tier-C mention that never binds - and
// the pre-existing "admitted to the New York bar" prose still renders advisory, never bound.
// ===========================================================================

test('DEFECT-8 positive: a US state-bar authorisation WITH a bar number is Tier-A establishment and binds the state', () => {
  const out = resolveJurisdiction(pageBundle('John Smith is a member of the State Bar of California, Bar No. 245123.', { domain: 'smithlaw.com' }));
  const us = findBound(out, 'US');
  assert.ok(us, 'a bar authorisation with a number binds US at Tier A (established_in can now be satisfied)');
  assert.ok(us.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'authorisation'), 'the establishment kind is Tier-A authorisation');
  const ca = out.sub_jurisdictions.find((s) => s.code === 'CA');
  assert.ok(ca && ca.status === 'bound' && ca.basis === 'bar_authorisation', 'California is a BOUND state nexus off the bar authorisation');
});

test('DEFECT-8 negative: merely naming a state bar (no number) is a Tier-C mention and never binds (C-014)', () => {
  const out = resolveJurisdiction(pageBundle('If you have a concern you may file a complaint with the State Bar of California.', { domain: 'acme.com' }));
  assert.equal(out.abstained, true, 'a bare state-bar mention with no bar number never binds');
  assert.ok(!boundCodes(out).includes('US'));
});

test('DEFECT-8 negative: a sentence naming TWO state bars binds only the one whose bar number is nearby (no over-bind)', () => {
  const out = resolveJurisdiction(pageBundle('Our attorneys are members of the Florida Bar and the State Bar of California, Bar No. 245123.'));
  const ca = out.sub_jurisdictions.find((s) => s.code === 'CA');
  const fl = out.sub_jurisdictions.find((s) => s.code === 'FL');
  assert.ok(ca && ca.status === 'bound' && ca.basis === 'bar_authorisation', 'California (whose bar number follows it) is bound');
  assert.ok(!(fl && fl.status === 'bound'), 'Florida (named without its own nearby bar number) must NOT be a bound bar_authorisation');
});

test('DEFECT-8 preserved: "admitted to the New York bar" (no number) still renders advisory, never bound', () => {
  const out = resolveJurisdiction(pageBundle('Incorporated in Delaware. Our partners are admitted to the New York bar.'));
  const ny = out.sub_jurisdictions.find((s) => s.code === 'NY');
  assert.ok(ny && ny.status === 'advisory' && ny.basis === 'bar_admission', 'the numberless bar admission is advisory, never a bound bar_authorisation');
});

// ===========================================================================
// Calibration fixture wiring (item 3): the adversarial corpus must be caught EVERY run.
// ===========================================================================

test('calibration fixture: the module catches every seeded ghost-US / fichtelegal / abstention trap', () => {
  const misses = calibrationFixture.runTrials();
  assert.deepEqual(misses, [], 'no adversarial trap was missed:\n' + misses.join('\n'));
});

test('calibration fixture: calibrate() earns its zero (a finding per trap, never an empty list)', () => {
  const findings = calibrationFixture.calibrate();
  assert.ok(Array.isArray(findings) && findings.length === calibrationFixture.TRIALS.length,
    'calibrate() emits one finding per trap only when all traps are caught');
});
