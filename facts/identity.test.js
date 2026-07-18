'use strict';
// facts/identity.test.js - node:test suite for the single-door IDENTITY producer.
// Run: node --test facts/
//
// The two canonical failures from the old estate MUST appear here as rejected:
//   - "luxury-aesthetic-clinic-for-radiant-skin-amp-body" (marketing headline + entity residue)
//   - "price-list" (generic page furniture as a slug)
// Both are caution C-003 classes: a slug must never derive from a page title.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const identity = require('./identity.js');
const { resolveIdentity, CONFIDENCE } = identity;

function bundleOf(overrides) {
  return Object.assign(
    {
      domain: 'example.co.uk',
      corpus: { pages: [], footerText: '' },
      registers: {},
    },
    overrides
  );
}

const FACT_FIELDS = ['display_name', 'legal_name', 'company_number', 'registered_office', 'slug'];
const VALID_CONFIDENCES = new Set(['register', 'corroborated', 'weak', 'abstain']);

function assertFactShape(result) {
  for (const f of FACT_FIELDS) {
    assert.ok(result[f] && typeof result[f] === 'object', f + ' is a fact object');
    assert.ok(VALID_CONFIDENCES.has(result[f].confidence), f + ' has a graded confidence');
    assert.ok(Array.isArray(result[f].evidence), f + ' carries an evidence array');
    if (result[f].confidence === 'abstain') {
      assert.equal(result[f].value, null, f + ': abstain means value null, never a guess');
    } else {
      assert.notEqual(result[f].value, null, f + ': a non-abstain fact carries a value');
      assert.ok(result[f].evidence.length >= 1, f + ': a non-abstain fact carries evidence');
    }
  }
}

// ---------------------------------------------------------------------------------
// Rung 1: register match corroborated on-page -> confidence 'register'
// ---------------------------------------------------------------------------------
test('register row corroborated by footer name and company number wins at register confidence', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'kingsleynapley.co.uk',
    corpus: {
      pages: [{
        url: 'https://kingsleynapley.co.uk/',
        title: 'Kingsley Napley | Top London Law Firm',
        text: 'We advise individuals and businesses.',
        jsonLd: [],
      }],
      footerText: '© 2026 Kingsley Napley LLP. Kingsley Napley LLP is authorised and regulated by the Solicitors Regulation Authority. Registered in England and Wales, company number OC311168. Registered office: 20 Bonhill Street, London.',
    },
    registers: {
      companiesHouse: {
        company_name: 'KINGSLEY NAPLEY LLP',
        company_number: 'OC311168',
        registered_office: '20 Bonhill Street, London, EC2A 4DN',
      },
    },
  }));
  assertFactShape(result);
  assert.equal(result.display_name.value, 'Kingsley Napley LLP');
  assert.equal(result.display_name.confidence, CONFIDENCE.REGISTER);
  assert.ok(result.display_name.evidence.some((e) => e.kind === 'register'));
  assert.equal(result.legal_name.value, 'KINGSLEY NAPLEY LLP');
  assert.equal(result.legal_name.confidence, CONFIDENCE.REGISTER);
  assert.equal(result.company_number.value, 'OC311168');
  assert.equal(result.company_number.confidence, CONFIDENCE.REGISTER);
  assert.equal(result.registered_office.value, '20 Bonhill Street, London, EC2A 4DN');
  assert.equal(result.slug.value, 'kingsley-napley-llp');
  assert.equal(result.slug.confidence, CONFIDENCE.REGISTER);
});

test('uncorroborated register row that shares no domain token is ignored, never attached', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: {
      pages: [{ url: 'https://smithlegal.co.uk/', title: 'Smith Legal', text: 'Advice.', jsonLd: [] }],
      footerText: '',
    },
    registers: {
      companiesHouse: { company_name: 'ACME WIDGETS LTD', company_number: '12345678' },
    },
  }));
  assert.notEqual(result.display_name.value, 'Acme Widgets LTD');
  assert.equal(result.legal_name.confidence, CONFIDENCE.ABSTAIN);
  assert.equal(result.company_number.confidence, CONFIDENCE.ABSTAIN);
  assert.ok(result.notes.some((n) => n.includes('row ignored')), 'the ignored row is recorded, never silent');
});

test('register row tied to the domain but with no on-page identifier attaches at weak only', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: { pages: [], footerText: '' },
    registers: {
      companiesHouse: { company_name: 'SMITH LEGAL LTD', company_number: '09876543' },
    },
  }));
  assert.equal(result.display_name.value, 'Smith Legal LTD');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.legal_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.company_number.value, '09876543');
  assert.equal(result.company_number.confidence, CONFIDENCE.WEAK);
});

// ---------------------------------------------------------------------------------
// RT-F-CONTRADICTORY-ENTITY: a name-core match must NOT corroborate a register row that
// an on-page identifier contradicts (number mismatch or Ltd-vs-LLP form). C-004/C-005.
// ---------------------------------------------------------------------------------
test('RT-F: on-page number contradicting the register number is not register confidence; number abstains', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'contradict-legal.co.uk',
    corpus: {
      pages: [{
        url: 'https://contradict-legal.co.uk/',
        title: 'Contradict Legal Ltd',
        text: 'Contradict Legal Ltd is a firm of solicitors based in Leeds.',
        jsonLd: [],
        ogSiteName: 'Contradict Legal Ltd',
      }],
      footerText: 'Contradict Legal Ltd, a private limited company registered in England and Wales. Company No. 09999999.',
    },
    registers: {
      companiesHouse: { legal_name: 'CONTRADICT LEGAL LLP', company_number: 'OC399999', type: 'llp', status: 'active' },
    },
  }));
  assertFactShape(result);
  // the register row (OC399999) is contradicted by the on-page number (09999999): not corroborated
  assert.notEqual(result.legal_name.confidence, CONFIDENCE.REGISTER);
  assert.notEqual(result.legal_name.confidence, CONFIDENCE.CORROBORATED);
  assert.equal(result.company_number.confidence, CONFIDENCE.ABSTAIN);
  assert.equal(result.company_number.value, null);
  assert.ok(result.notes.some((n) => n.includes('CONTRADICTS')), 'the contradiction is recorded, never silent');
});

test('RT-F: register form (LLP) contradicting the on-page form (Ltd) demotes off register even with no on-page number', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'harptonlegal.co.uk',
    corpus: {
      pages: [{
        url: 'https://harptonlegal.co.uk/',
        title: 'Harpton Legal Ltd',
        text: 'Harpton Legal Ltd advises businesses.',
        jsonLd: [],
        ogSiteName: 'Harpton Legal Ltd',
      }],
      footerText: '',
    },
    registers: {
      companiesHouse: { company_name: 'HARPTON LEGAL LLP', company_number: 'OC556677' },
    },
  }));
  assert.notEqual(result.legal_name.confidence, CONFIDENCE.REGISTER);
  assert.notEqual(result.legal_name.confidence, CONFIDENCE.CORROBORATED);
  assert.equal(result.company_number.value, null);
  assert.ok(result.notes.some((n) => n.includes('entity_form_mismatch')));
});

test('RT-F guard is not over-eager: a matching on-page number keeps register confidence', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'kingsleynapley.co.uk',
    corpus: {
      pages: [{
        url: 'https://kingsleynapley.co.uk/',
        title: 'Kingsley Napley | Top London Law Firm',
        text: 'We advise individuals and businesses.',
        jsonLd: [],
      }],
      footerText: '© 2026 Kingsley Napley LLP. Registered in England and Wales, company number OC311168.',
    },
    registers: {
      companiesHouse: { company_name: 'KINGSLEY NAPLEY LLP', company_number: 'OC311168', registered_office: '20 Bonhill Street, London, EC2A 4DN' },
    },
  }));
  assert.equal(result.legal_name.confidence, CONFIDENCE.REGISTER);
  assert.equal(result.company_number.value, 'OC311168');
  assert.equal(result.company_number.confidence, CONFIDENCE.REGISTER);
});

test('entityForm reads the canonical strong incorporation form and ignores ambiguous suffixes', () => {
  assert.equal(identity.entityForm('CONTRADICT LEGAL LLP'), 'LLP');
  assert.equal(identity.entityForm('Contradict Legal Ltd'), 'LTD');
  assert.equal(identity.entityForm('Some Firm Limited'), 'LTD');
  assert.equal(identity.entityForm('Widget Trading Company'), null);
  assert.equal(identity.entityForm('Just A Name'), null);
  // a legal-form WORD used as ordinary vocabulary earlier in the name is NOT a terminal entity form:
  assert.equal(identity.entityForm('Limited Edition Legal'), null, 'a leading "Limited" is a trading-name word, not a suffix');
  assert.equal(identity.entityForm('Limited Edition Design Studios'), null);
  assert.equal(identity.entityForm('Limited Edition Design Ltd'), 'LTD', 'but a genuine TRAILING Ltd is still read');
});

// ---------------------------------------------------------------------------------
// Rungs 2-3: on-page corroboration grading
// ---------------------------------------------------------------------------------
test('jsonLd Organization + ogSiteName agreeing -> corroborated', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithandjones.co.uk',
    corpus: {
      pages: [{
        url: 'https://smithandjones.co.uk/',
        title: 'Welcome',
        text: 'Chartered accountants.',
        jsonLd: [{ '@type': 'Organization', name: 'Smith & Jones' }],
        ogSiteName: 'Smith & Jones',
      }],
      footerText: '',
    },
  }));
  assert.equal(result.display_name.value, 'Smith & Jones');
  assert.equal(result.display_name.confidence, CONFIDENCE.CORROBORATED);
  const kinds = new Set(result.display_name.evidence.map((e) => e.kind));
  assert.ok(kinds.has('jsonld') && kinds.has('og_site_name'), 'evidence names both agreeing sources');
  assert.equal(result.slug.value, 'smith-and-jones');
});

test('a lone title candidate tied to the domain is weak, and the strapline segment is dropped', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'kingsleynapley.co.uk',
    corpus: {
      pages: [{
        url: 'https://kingsleynapley.co.uk/',
        title: 'Kingsley Napley | Top London Law Firm',
        text: 'About us.',
        jsonLd: [],
      }],
      footerText: '',
    },
  }));
  assert.equal(result.display_name.value, 'Kingsley Napley');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.slug.value, 'kingsley-napley');
});

test('schema.org legalName populates legal_name at weak when no register confirms it', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'brownpartners.co.uk',
    corpus: {
      pages: [{
        url: 'https://brownpartners.co.uk/',
        title: 'Brown Partners',
        text: '',
        jsonLd: [{ '@type': 'LegalService', name: 'Brown Partners', legalName: 'Brown Partners LLP' }],
      }],
      footerText: '',
    },
  }));
  assert.equal(result.legal_name.value, 'Brown Partners LLP');
  assert.equal(result.legal_name.confidence, CONFIDENCE.WEAK);
});

// ---------------------------------------------------------------------------------
// Rejection: the canonical C-003 failures MUST be refused
// ---------------------------------------------------------------------------------
test('CANONICAL: marketing headline with &amp; is never the display name and never the slug', () => {
  const headline = 'Luxury Aesthetic Clinic for Radiant Skin &amp; Body';
  const result = resolveIdentity(bundleOf({
    domain: 'aurora-aesthetics.co.uk',
    corpus: {
      pages: [{
        url: 'https://aurora-aesthetics.co.uk/',
        title: headline + ' | Price List',
        text: 'Book your consultation today.',
        jsonLd: [],
        ogSiteName: headline,
      }],
      footerText: '',
    },
  }));
  assertFactShape(result);
  assert.notEqual(result.display_name.value, headline);
  assert.notEqual(result.slug.value, 'luxury-aesthetic-clinic-for-radiant-skin-amp-body');
  assert.notEqual(result.slug.value, 'price-list');
  assert.ok(
    result.rejected.some((r) => r.reason === 'html_entity_residue'),
    'the entity-bearing headline is recorded as rejected'
  );
  // the honest fall-through: the clean domain stem at weak confidence
  assert.equal(result.display_name.value, 'Aurora Aesthetics');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.slug.value, 'aurora-aesthetics');
});

test('CANONICAL: a bare "Price List" title is generic page furniture, never a name or slug', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'aurora-aesthetics.co.uk',
    corpus: {
      pages: [{ url: 'https://aurora-aesthetics.co.uk/prices', title: 'Price List', text: '', jsonLd: [] }],
      footerText: '',
    },
  }));
  assert.notEqual(result.display_name.value, 'Price List');
  assert.notEqual(result.slug.value, 'price-list');
  assert.ok(result.rejected.some(
    (r) => r.value === 'Price List' && r.reason === 'generic_page_furniture'
  ));
  assert.equal(result.slug.value, 'aurora-aesthetics');
});

test('generic page furniture is rejected across rungs ("Bristol Office" as ogSiteName)', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'birketts.co.uk',
    corpus: {
      pages: [{
        url: 'https://birketts.co.uk/bristol',
        title: 'Home',
        text: '',
        jsonLd: [],
        ogSiteName: 'Bristol Office',
      }],
      footerText: '',
    },
  }));
  assert.notEqual(result.display_name.value, 'Bristol Office');
  assert.ok(result.rejected.some((r) => r.value === 'Bristol Office'));
  assert.equal(result.display_name.value, 'Birketts');
});

test('marketing headlines longer than six words are rejected even without entities', () => {
  const long = 'Radiant Skin Experts Serving The Whole South West';
  const result = resolveIdentity(bundleOf({
    domain: 'radiantskin.co.uk',
    corpus: {
      pages: [{ url: 'https://radiantskin.co.uk/', title: long, text: '', jsonLd: [], ogSiteName: long }],
      footerText: '',
    },
  }));
  assert.notEqual(result.display_name.value, long);
  assert.ok(result.rejected.some((r) => r.reason === 'marketing_headline_too_long'));
});

test('a candidate sharing no token with the domain is rejected unless register-corroborated', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: {
      pages: [{
        url: 'https://smithlegal.co.uk/',
        title: 'Totally Different Brand',
        text: '',
        jsonLd: [],
        ogSiteName: 'Totally Different Brand',
      }],
      footerText: '',
    },
  }));
  assert.notEqual(result.display_name.value, 'Totally Different Brand');
  assert.ok(result.rejected.some((r) => r.reason === 'no_token_shared_with_domain'));
  assert.equal(result.display_name.value, 'Smithlegal');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
});

test('entity residue detector catches named, decimal and hex entities', () => {
  assert.ok(identity.hasEntityResidue('Miami&#x27;s Top Clinic'));
  assert.ok(identity.hasEntityResidue('Skin &amp; Body'));
  assert.ok(identity.hasEntityResidue('A&#8217;s Firm'));
  assert.ok(!identity.hasEntityResidue('Smith & Jones'));
  assert.ok(!identity.hasEntityResidue('Marks & Spencer Group'));
});

// ---------------------------------------------------------------------------------
// Footer identity block
// ---------------------------------------------------------------------------------
test('footer "X LLP is authorised and regulated by" yields the firm, weak on its own', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'hartleybrown.co.uk',
    corpus: {
      pages: [{ url: 'https://hartleybrown.co.uk/', title: 'Welcome', text: '', jsonLd: [] }],
      footerText: 'Hartley Brown LLP is authorised and regulated by the Solicitors Regulation Authority.',
    },
  }));
  assert.equal(result.display_name.value, 'Hartley Brown LLP');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.legal_name.value, 'Hartley Brown LLP');
  assert.ok(result.legal_name.evidence.some((e) => e.kind === 'footer' && e.quote));
});

test('footer copyright line and regulated-by line agreeing -> corroborated display name', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'hartleybrown.co.uk',
    corpus: {
      pages: [{
        url: 'https://hartleybrown.co.uk/',
        title: 'Welcome',
        text: '',
        jsonLd: [],
        ogSiteName: 'Hartley Brown LLP',
      }],
      footerText: '© 2026 Hartley Brown LLP. All rights reserved.',
    },
  }));
  assert.equal(result.display_name.value, 'Hartley Brown LLP');
  assert.equal(result.display_name.confidence, CONFIDENCE.CORROBORATED);
});

test('a company number needs context words: bare 8-digit strings are not company numbers', () => {
  const withContext = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: {
      pages: [{ url: 'https://smithlegal.co.uk/', title: 'Smith Legal', text: '', jsonLd: [] }],
      footerText: 'Smith Legal Ltd. Registered in England, company number 09876543.',
    },
  }));
  assert.equal(withContext.company_number.value, '09876543');
  assert.equal(withContext.company_number.confidence, CONFIDENCE.WEAK);

  const noContext = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: {
      pages: [{ url: 'https://smithlegal.co.uk/', title: 'Smith Legal', text: 'Ref 20260716 was quoted.', jsonLd: [] }],
      footerText: '',
    },
  }));
  assert.equal(noContext.company_number.confidence, CONFIDENCE.ABSTAIN);
});

test('two distinct contextual company numbers with no register to arbitrate -> abstain', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithlegal.co.uk',
    corpus: {
      pages: [{
        url: 'https://smithlegal.co.uk/about',
        title: 'Smith Legal',
        text: 'Smith Legal Services Ltd, company number 11111111.',
        jsonLd: [],
      }],
      footerText: 'Smith Legal Holdings Ltd, registered number 22222222.',
    },
  }));
  assert.equal(result.company_number.confidence, CONFIDENCE.ABSTAIN);
  assert.ok(result.notes.some((n) => n.includes('conflict')));
});

// ---------------------------------------------------------------------------------
// Abstention and malformed input (fail closed, never guess)
// ---------------------------------------------------------------------------------
test('empty bundle with a domain resolves the stem at weak; nothing else is invented', () => {
  const result = resolveIdentity(bundleOf({ domain: 'quietfirm.co.uk' }));
  assertFactShape(result);
  assert.equal(result.display_name.value, 'Quietfirm');
  assert.equal(result.display_name.confidence, CONFIDENCE.WEAK);
  assert.equal(result.legal_name.confidence, CONFIDENCE.ABSTAIN);
  assert.equal(result.company_number.confidence, CONFIDENCE.ABSTAIN);
  assert.equal(result.registered_office.confidence, CONFIDENCE.ABSTAIN);
});

test('malformed bundles abstain on every field with a recorded note', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { corpus: null }]) {
    const result = resolveIdentity(bad);
    for (const f of FACT_FIELDS) {
      assert.equal(result[f].confidence, CONFIDENCE.ABSTAIN, f + ' abstains on malformed input');
      assert.equal(result[f].value, null);
    }
    assert.ok(result.notes.some((n) => n.includes('malformed_evidence_bundle')));
  }
});

test('no domain and no pages -> full abstention, never a fabricated name', () => {
  const result = resolveIdentity({ domain: '', corpus: { pages: [] }, registers: {} });
  assert.equal(result.display_name.confidence, CONFIDENCE.ABSTAIN);
  assert.equal(result.slug.confidence, CONFIDENCE.ABSTAIN);
});

// ---------------------------------------------------------------------------------
// Slug doctrine: derives from display_name only, always clean kebab-case
// ---------------------------------------------------------------------------------
test('slug is kebab-case of display_name with & -> and, apostrophes dropped', () => {
  assert.equal(identity.kebab('Smith & Jones Ltd'), 'smith-and-jones-ltd');
  assert.equal(identity.kebab("O'Neill Partners"), 'oneill-partners');
  assert.equal(identity.kebab('Café Müller GmbH'), 'cafe-muller-gmbh');
  assert.equal(identity.kebab('  '), null);
});

test('slug always matches the clean kebab shape and mirrors display_name confidence', () => {
  const result = resolveIdentity(bundleOf({
    domain: 'smithandjones.co.uk',
    corpus: {
      pages: [{
        url: 'https://smithandjones.co.uk/',
        title: 'Smith & Jones | Accountants',
        text: '',
        jsonLd: [],
      }],
      footerText: '',
    },
  }));
  assert.match(result.slug.value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(result.slug.confidence, result.display_name.confidence);
  assert.ok(result.slug.evidence.some((e) => e.kind === 'derived' && e.source === 'display_name'));
});

// ---------------------------------------------------------------------------------
// Vocabulary seam (one door for word lists)
// ---------------------------------------------------------------------------------
test('vocabulary source is recorded, and the module prefers facts/vocabulary.js when present', () => {
  const vocabPath = path.join(__dirname, 'vocabulary.js');
  if (fs.existsSync(vocabPath)) {
    assert.equal(identity.VOCABULARY_SOURCE, 'facts/vocabulary.js');
  } else {
    assert.equal(identity.VOCABULARY_SOURCE, 'inline-fallback');
    const result = resolveIdentity(bundleOf({ domain: 'quietfirm.co.uk' }));
    assert.ok(
      result.notes.some((n) => n.includes('vocabulary')),
      'fallback vocabulary use is recorded on every result, never silent'
    );
  }
  for (const k of identity.REQUIRED_VOCABULARY_EXPORTS) {
    assert.ok(Array.isArray(identity.FALLBACK_VOCABULARY[k]) && identity.FALLBACK_VOCABULARY[k].length > 0);
  }
});

// ---------------------------------------------------------------------------------
// Calibration wiring (earn-your-zero): the p1-identity-* fixtures must be refused
// ---------------------------------------------------------------------------------
test('calibration fixtures: every planted poison is refused and produces a finding', () => {
  const fixturesDir = path.join(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures');
  const files = fs.readdirSync(fixturesDir).filter((f) => /^p1-identity-.*\.json$/.test(f));
  assert.ok(files.length >= 1, 'at least one p1-identity-* calibration fixture is wired');
  const findings = identity.runCalibration(fixturesDir);
  assert.equal(
    findings.length,
    files.length,
    'one refusal finding per fixture; zero findings means the rejection gate is broken'
  );
  for (const f of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'));
    const result = resolveIdentity(fixture.bundle);
    for (const forbidden of [].concat(fixture.poison.display_name_forbidden || [])) {
      assert.notEqual(result.display_name.value, forbidden);
    }
    for (const forbidden of [].concat(fixture.poison.slug_forbidden || [])) {
      assert.notEqual(result.slug.value, forbidden);
    }
  }
});
