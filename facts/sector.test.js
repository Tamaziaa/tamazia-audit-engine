'use strict';
// facts/sector.test.js - node:test suite for the SECTOR single door + THE ICP GATE.
//
// Vocabulary strategy: the canonical tree lives in facts/vocabulary.js (a sibling module, one
// door for the tree). These tests run the behaviour suite against an INJECTED test vocabulary
// whose detect regexes mirror the proven old-estate shapes, so the suite is hermetic and green
// regardless of the sibling's exact wording. When facts/vocabulary.js is present, the
// calibration fixtures are ALSO replayed against the real vocabulary and the served-cells
// manifest is checked for key sync; when it is absent those integration tests skip LOUDLY.
//
// Run: node --test facts/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sector = require('./sector.js');

let REAL_VOCAB = null;
try {
  REAL_VOCAB = require('./vocabulary.js');
} catch (_err) {
  // FAIL-OPEN: the vocabulary sibling module may not have landed yet; its absence is reported
  // loudly below and the integration tests skip with a stated reason instead of passing silently.
  REAL_VOCAB = null;
}
if (!REAL_VOCAB) {
  console.warn('[sector.test] facts/vocabulary.js is NOT present: integration tests against the real vocabulary are skipped. The behaviour suite runs on the injected test vocabulary.');
}

// Injected test vocabulary: detect regex shapes ported from the old estate
// (registry/sector.js TREE + firm-profile.js _SECTOR_KW), trimmed to the parents the tests use.
const TEST_VOCABULARY = {
  TREE: {
    'law-firms': {
      label: 'Solicitors & law firms', regulators: ['SRA'],
      sub: { solicitors: { detect: /solicitor|conveyancing|probate|\blaw firm\b|legal advice/i } },
    },
    barristers: {
      label: 'Barristers & chambers', regulators: ['BSB'],
      sub: { general: { detect: /barrister|\bchambers\b|direct access|public access|instruct(ing)? counsel/i } },
    },
    healthcare: {
      label: 'Healthcare', regulators: ['CQC', 'GMC'],
      sub: {
        'general-practice': { detect: /\bgp\b|general practice|family (doctor|medicine)|private gp/i },
        telemedicine: { detect: /telemedicine|telehealth|online (doctor|gp|consultation)|remote (consultation|appointment)|virtual (gp|doctor|clinic)/i },
        'hospital-care': { detect: /\bhospitals?\b|medical centre|clinic\b|oncolog|cancer (care|treatment|clinic|centre)|cqc registered/i },
      },
    },
    dental: {
      label: 'Dental', parent: 'healthcare', regulators: ['GDC'],
      sub: { 'general-dental': { detect: /\bdentist|dental (practice|clinic|surgery|care)/i } },
    },
    aesthetics: {
      label: 'Aesthetics', parent: 'healthcare', regulators: ['ASA', 'MHRA'],
      sub: { injectables: { detect: /botox|dermal filler|lip filler|anti[- ]wrinkle injection/i } },
    },
    finance: {
      label: 'Financial services', regulators: ['FCA'],
      sub: {
        banking: { detect: /\bbank\b|current account|savings account/i },
        'wealth-management': { detect: /wealth (management|manager|adviser)|portfolio management/i },
      },
    },
    'real-estate': {
      label: 'Real estate', regulators: ['TPO'],
      sub: { sales: { detect: /estate agent|homes for sale|properties for sale/i } },
    },
    marketing: {
      label: 'Marketing & advertising', regulators: ['ASA'],
      sub: { general: { detect: /marketing agency|advertising agency|\bseo agency\b|digital marketing/i } },
    },
    hospitality: {
      label: 'Hotels & hospitality', regulators: ['CMA'],
      sub: { hotel: { detect: /\bhotel\b|book (a|your) room|guest rooms/i } },
    },
  },
};

function bundleOf(text, extras = {}) {
  return Object.assign({
    domain: 'example.example',
    corpus: { pages: [{ url: 'https://example.example/', title: 'Example', text, jsonLd: [] }] },
    registers: {},
  }, extras);
}

function resolve(bundle, options = {}) {
  return sector.resolveSector(bundle, Object.assign({ vocabulary: TEST_VOCABULARY }, options));
}

const LAW_TEXT = 'Our solicitors provide conveyancing and probate services across the North West. Ask our law firm for legal advice today.';
const HOSPITAL_TEXT = 'Welcome to Harbourview Hospital, a leading private hospital and medical centre. Our general practice team offers same day GP appointments, and our oncology department provides cancer care to patients across the region. The clinic is CQC registered.';

// ---------------------------------------------------------------------------------------------
// Two-cue deny-by-default (E-005/E-006 port)
// ---------------------------------------------------------------------------------------------

test('two-cue winner attaches with corroborated confidence and text-cue evidence', () => {
  const r = resolve(bundleOf(LAW_TEXT));
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.equal(r.value.sub_sector, 'solicitors');
  assert.equal(r.confidence, 'corroborated');
  assert.ok(r.evidence.length >= 2);
  assert.ok(r.evidence.every((e) => e.kind === 'text-cue' && e.source && e.quote));
  assert.deepEqual(r.contradictions, []);
});

test('a single cue abstains: deny by default, no professional-services fallback', () => {
  const r = resolve(bundleOf('Contact our law firm today for an initial chat about your situation.'));
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

test('a cross-family tie abstains, never picks a side', () => {
  const r = resolve(bundleOf('Our law firm handles disputes. We also operate a bank on the high street.'));
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

test('same-family runner-up does not block a specific child sector', () => {
  const r = resolve(bundleOf('Our dental practice is a modern dental clinic. The dentist team and the wider clinic offer dental care for the whole family at our medical centre.'));
  // dental (child of healthcare) and healthcare both score; healthcare is the same family so it
  // must not veto; the deeper node wins on the family tie.
  assert.ok(r.value, 'expected a resolved sector, got abstain');
  assert.equal(sector.familyOf(TEST_VOCABULARY.TREE, r.value.sector), 'healthcare');
  assert.equal(r.value.sector, 'dental');
});

// ---------------------------------------------------------------------------------------------
// Visible text only (C-012)
// ---------------------------------------------------------------------------------------------

test('titles, og:site_name and jsonLd never classify: head noise abstains', () => {
  const r = resolve({
    domain: 'example.example',
    corpus: {
      pages: [{
        url: 'https://example.example/',
        title: 'Best law firm solicitors conveyancing probate legal advice',
        ogSiteName: 'Law Firm & Solicitors',
        jsonLd: [{ '@type': 'LegalService', name: 'Solicitors' }],
        text: 'Welcome.',
      }],
    },
    registers: {},
  });
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

test('footer text IS a detection surface (C-034)', () => {
  const r = resolve({
    domain: 'example.example',
    corpus: {
      pages: [{ url: 'https://example.example/', title: 'Home', text: 'Our solicitors are here to help with probate.' }],
      footerText: 'A law firm offering legal advice. Authorised professionals.',
    },
    registers: {},
  });
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.ok(r.evidence.some((e) => e.source === 'footer'));
});

// ---------------------------------------------------------------------------------------------
// Own-identity guard: client-industry mentions never classify the subject
// ---------------------------------------------------------------------------------------------

test('own-identity guard: "law firm SEO" on a marketing agency resolves marketing, not law-firms', () => {
  const r = resolve(bundleOf('We are a digital marketing agency based in Manchester. As a specialist seo agency we deliver law firm SEO, and our campaigns win new enquiries. Talk to our advertising agency team.'));
  assert.equal(r.value && r.value.sector, 'marketing');
});

test('own-identity guard: "marketing for dental practices" and "websites for solicitors" attach nothing', () => {
  const r = resolve(bundleOf('We provide marketing for dental practices and websites for solicitors, with monthly reporting you can trust.'));
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

test('own-identity guard: "we help law firms" is a client mention, not an identity', () => {
  const helper = sector._isClientIndustryMention;
  const t1 = 'We help law firms grow their client base.';
  assert.equal(helper(t1, t1.indexOf('law firms'), t1.indexOf('law firms') + 'law firm'.length), true);
  const t2 = 'We help patients recover at our clinic every day.';
  assert.equal(helper(t2, t2.indexOf('clinic'), t2.indexOf('clinic') + 'clinic'.length), false);
});

// ---------------------------------------------------------------------------------------------
// Sub-sector precedence guards (port of registry/sector.js resolveSubSector)
// ---------------------------------------------------------------------------------------------

test('barrister guard: unambiguous barrister signals without solicitor self-ID resolve barristers', () => {
  const r = resolve(bundleOf('Our law firm offers legal advice, probate and conveyancing support. Our barrister team accepts direct access instructions and the chambers welcomes new clients.'));
  assert.ok(r.value, 'expected a resolved sector');
  assert.equal(r.value.sector, 'barristers');
  assert.equal(r.value.sub_sector, 'general');
});

test('solicitor self-ID defeats the barrister guard', () => {
  const r = resolve(bundleOf('Our solicitors offer legal advice, probate and conveyancing. We sometimes instruct counsel from chambers on complex matters.'));
  assert.ok(r.value, 'expected a resolved sector');
  assert.equal(r.value.sector, 'law-firms');
  assert.equal(r.value.sub_sector, 'solicitors');
});

test('telemedicine precedence: telehealth-led care resolves telemedicine, not general-practice', () => {
  const r = resolve(bundleOf('Our online doctor service offers virtual GP consultations seven days a week. Book a remote appointment with our general practice team at the clinic.'));
  assert.ok(r.value, 'expected a resolved sector');
  assert.equal(r.value.sector, 'healthcare');
  assert.equal(r.value.sub_sector, 'telemedicine');
});

// ---------------------------------------------------------------------------------------------
// WS-Signals: NPI (NPPES) taxonomy decisively sets/overrides the healthcare SUB-sector
// (KIMI-K3-DEEP-BLUEPRINT-2026-07-20 §B2: "these are Tier-A/A- deterministic sector facts that
// OVERRIDE the text classifier"). registers.npi is matched on the register's own self-reported
// taxonomy description text (facts/sector.js's _npiSubSector), never a hand-guessed NUCC code.
// ---------------------------------------------------------------------------------------------

// Deliberately drops HOSPITAL_TEXT's "general practice ... GP appointments" clause so the
// text-only sub-sector resolves 'hospital-care' unambiguously (proven below), leaving a clean
// baseline for the NPI-override test to actually exercise a genuine text-vs-register disagreement.
const HOSPITAL_ONLY_TEXT = 'Welcome to Harbourview Hospital, a leading private hospital and medical centre. Our oncology department provides cancer care to patients across the region. The clinic is CQC registered.';

test('baseline: HOSPITAL_ONLY_TEXT resolves hospital-care from text alone, with no register present', () => {
  const r = resolve(bundleOf(HOSPITAL_ONLY_TEXT));
  assert.equal(r.value.sector, 'healthcare');
  assert.equal(r.value.sub_sector, 'hospital-care');
});

test('NPI taxonomy OVERRIDES a weaker text-derived sub-sector (Family Medicine -> general-practice)', () => {
  const r = resolve(bundleOf(HOSPITAL_ONLY_TEXT, {
    registers: { npi: { id: '1999999999', name: 'HARBOURVIEW CLINIC', taxonomy_code: '207Q00000X', taxonomy_desc: 'Family Medicine' } },
  }));
  assert.equal(r.value.sector, 'healthcare');
  // HOSPITAL_ONLY_TEXT alone resolves 'hospital-care' via text cues; the register decisively wins.
  assert.equal(r.value.sub_sector, 'general-practice');
  assert.ok(r.evidence.some((e) => e.source === 'npi' && /overrides/i.test(e.quote)));
});

test('NPI taxonomy sets the sub-sector when the text alone gave none (Psychiatry -> mental-health)', () => {
  const r = resolve(bundleOf('Welcome to our practice. CQC registered.', {
    registers: {
      cqc: { matched: true },
      npi: { id: '1888888888', name: 'EXAMPLE BEHAVIORAL HEALTH', taxonomy_code: '2084P0800X', taxonomy_desc: 'Psychiatry' },
    },
  }));
  assert.equal(r.value.sector, 'healthcare');
  assert.equal(r.value.sub_sector, 'mental-health');
});

test('NPI taxonomy is IGNORED outside the healthcare family (a law firm with a stray npi row is not re-classified)', () => {
  const r = resolve(bundleOf(LAW_TEXT, {
    registers: { npi: { id: '1777777777', name: 'IRRELEVANT ORG', taxonomy_code: '207Q00000X', taxonomy_desc: 'Family Medicine' } },
  }));
  assert.equal(r.value.sector, 'law-firms');
  assert.equal(r.value.sub_sector, 'solicitors');
});

test('an ambiguous/unmatched NPI taxonomy description never overrides the text-derived sub-sector (deny by default)', () => {
  const r = resolve(bundleOf(HOSPITAL_ONLY_TEXT, {
    registers: { npi: { id: '1666666666', name: 'HARBOURVIEW CLINIC', taxonomy_code: '261QM1300X', taxonomy_desc: 'Clinic/Center, Multi-Specialty' } },
  }));
  assert.equal(r.value.sector, 'healthcare');
  assert.equal(r.value.sub_sector, 'hospital-care'); // the text-derived sub-sector stands unmodified
});

test('_npiSubSector: falls back through secondary taxonomies when the primary one is unmatched', () => {
  const registers = {
    npi: {
      taxonomy_desc: 'Clinic/Center, Multi-Specialty',
      taxonomies: [
        { code: '261QM1300X', desc: 'Clinic/Center, Multi-Specialty', primary: true },
        { code: '152W00000X', desc: 'Optometrist', primary: false },
      ],
    },
  };
  const result = sector._npiSubSector(registers);
  assert.ok(result);
  assert.equal(result.sub, 'optometry');
});

test('_npiSubSector: absent register, or absent registers.npi, returns null', () => {
  assert.equal(sector._npiSubSector({}), null);
  assert.equal(sector._npiSubSector(null), null);
});

// ---------------------------------------------------------------------------------------------
// Register cross-check (C-004, C-014, C-016)
// ---------------------------------------------------------------------------------------------

test('an agreeing decisive register upgrades confidence to register', () => {
  const r = resolve(bundleOf(LAW_TEXT, { registers: { sra: { matched: true } } }));
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.equal(r.confidence, 'register');
  assert.ok(r.evidence.some((e) => e.kind === 'register' && e.source === 'sra'));
});

test('a contradicting decisive register downgrades to abstain: a contradicted sector never ships', () => {
  const r = resolve(bundleOf(HOSPITAL_TEXT, { registers: { sra: { matched: true } } }));
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
  assert.ok(r.contradictions.some((c) => c.kind === 'register-contradiction'));
});

test('contradicting Companies House SIC codes downgrade to abstain', () => {
  const r = resolve(bundleOf(LAW_TEXT, { registers: { companiesHouse: { sicCodes: ['86210'] } } }));
  assert.equal(r.value, null);
  assert.ok(r.contradictions.some((c) => c.kind === 'register-contradiction'));
});

test('agreeing SIC codes upgrade a two-cue text win to register confidence', () => {
  const r = resolve(bundleOf(LAW_TEXT, { registers: { companiesHouse: { sicCodes: ['69102'] } } }));
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.equal(r.confidence, 'register');
});

test('a decisive register alone resolves the family when the text abstains (C-014)', () => {
  const r = resolve(bundleOf('Welcome to our practice. We put people first.', { registers: { cqc: { matched: true } } }));
  assert.equal(r.value && r.value.sector, 'healthcare');
  assert.equal(r.value.sub_sector, null);
  assert.equal(r.confidence, 'register');
});

test('disagreeing decisive registers abstain with a contradiction', () => {
  const r = resolve(bundleOf('Welcome to our practice.', { registers: { sra: { matched: true }, cqc: { matched: true } } }));
  assert.equal(r.value, null);
  assert.ok(r.contradictions.some((c) => c.kind === 'register-contradiction'));
});

test('single text cue corroborated by an agreeing SIC family attaches as weak', () => {
  const r = resolve(bundleOf('Visit our medical centre in Leeds for a warm welcome.', { registers: { companiesHouse: { sicCodes: ['86900'] } } }));
  assert.ok(r.value, 'expected a weak resolution');
  assert.equal(sector.familyOf(TEST_VOCABULARY.TREE, r.value.sector), 'healthcare');
  assert.equal(r.confidence, 'weak');
});

test('SIC codes alone never resolve a sector', () => {
  const r = resolve(bundleOf('A warm welcome to our website.', { registers: { companiesHouse: { sicCodes: ['69102'] } } }));
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

// ---------------------------------------------------------------------------------------------
// Hint handling: a queue hint is never evidence
// ---------------------------------------------------------------------------------------------

test('a hint that contradicts the evidence is flagged, and the evidence wins', () => {
  const r = resolve(bundleOf(HOSPITAL_TEXT), { hint: 'law-firms' });
  assert.equal(r.value && r.value.sector, 'healthcare');
  assert.ok(r.contradictions.some((c) => c.kind === 'hint-contradiction'));
});

test('an agreeing hint adds nothing and flags nothing', () => {
  const r = resolve(bundleOf(LAW_TEXT), { hint: 'law-firms' });
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.deepEqual(r.contradictions, []);
});

test('a hint never resurrects a sector on a cueless page', () => {
  const r = resolve(bundleOf('A warm welcome to our website. Get in touch.'), { hint: 'healthcare' });
  assert.equal(r.value, null);
  assert.ok(r.contradictions.some((c) => c.kind === 'hint-unconfirmed'));
});

// ---------------------------------------------------------------------------------------------
// THE ICP GATE: auditableCell over facts/served-cells.json
// ---------------------------------------------------------------------------------------------

test('ICP gate: UK x served sector is auditable', () => {
  const g = sector.auditableCell({ sector: 'law-firms', sub_sector: 'solicitors', jurisdictions_bound: ['UK'] });
  assert.equal(g.auditable, true);
  assert.match(g.reason, /UK x law-firms/);
});

test('ICP gate: GB normalises to UK', () => {
  const g = sector.auditableCell({ sector: 'healthcare', sub_sector: null, jurisdictions_bound: ['GB'] });
  assert.equal(g.auditable, true);
});

test('ICP gate: a non-UK jurisdiction refuses with the activates note', () => {
  const g = sector.auditableCell({ sector: 'law-firms', sub_sector: 'solicitors', jurisdictions_bound: ['EU'] });
  assert.equal(g.auditable, false);
  assert.match(g.reason, /activates: P5 EU wave/);
});

test('ICP gate: UK plus EU is auditable for the UK cell and names the unserved remainder', () => {
  const g = sector.auditableCell({ sector: 'healthcare', sub_sector: 'telemedicine', jurisdictions_bound: ['UK', 'EU'] });
  assert.equal(g.auditable, true);
  assert.match(g.reason, /EU/);
});

test('ICP gate: an unresolved sector refuses with a stated reason', () => {
  const g = sector.auditableCell({ sector: null, sub_sector: null, jurisdictions_bound: ['UK'] });
  assert.equal(g.auditable, false);
  assert.match(g.reason, /abstained/);
});

test('ICP gate: no bound jurisdiction refuses with a stated reason', () => {
  const g = sector.auditableCell({ sector: 'law-firms', sub_sector: null, jurisdictions_bound: [] });
  assert.equal(g.auditable, false);
  assert.match(g.reason, /no bound jurisdiction/);
});

test('ICP gate: a sector outside the manifest refuses rather than guessing', () => {
  const g = sector.auditableCell({ sector: 'gambling', sub_sector: null, jurisdictions_bound: ['UK'] });
  assert.equal(g.auditable, false);
  assert.match(g.reason, /not in the served-cells manifest/);
});

test('served-cells manifest shape: every cell is explicit about served, and UK cells are phase-1', () => {
  const cells = sector.SERVED_CELLS.cells;
  assert.ok(Array.isArray(cells) && cells.length > 0);
  for (const c of cells) {
    assert.equal(typeof c.served, 'boolean');
    assert.ok(c.jurisdiction && c.sector);
    if (c.served === false) assert.ok(c.activates, 'unserved cell must carry an activates note: ' + JSON.stringify(c));
    if (c.jurisdiction === 'UK') assert.equal(c.served, true);
  }
});

// ---------------------------------------------------------------------------------------------
// LLM-assist seam: accepted, never called by default, closed-world, fail-closed
// ---------------------------------------------------------------------------------------------

test('LLM seam: the hook is never called when the deterministic path resolves', async () => {
  let called = false;
  const r = await sector.resolveSectorWithLlm(bundleOf(LAW_TEXT), {
    vocabulary: TEST_VOCABULARY,
    classifyWithLlm: async () => { called = true; return { sector: 'hospitality' }; },
  });
  assert.equal(called, false);
  assert.equal(r.value && r.value.sector, 'law-firms');
});

test('LLM seam: the hook is never called past a register contradiction', async () => {
  let called = false;
  const r = await sector.resolveSectorWithLlm(bundleOf(HOSPITAL_TEXT, { registers: { sra: { matched: true } } }), {
    vocabulary: TEST_VOCABULARY,
    classifyWithLlm: async () => { called = true; return { sector: 'healthcare' }; },
  });
  assert.equal(called, false);
  assert.equal(r.value, null);
});

test('LLM seam: an out-of-tree selection is unrepresentable and the abstention stands', async () => {
  const r = await sector.resolveSectorWithLlm(bundleOf('A warm welcome to our website.'), {
    vocabulary: TEST_VOCABULARY,
    classifyWithLlm: async () => ({ sector: 'astrology' }),
  });
  assert.equal(r.value, null);
  assert.equal(r.confidence, 'abstain');
});

test('LLM seam: an in-tree selection on an abstain is capped at weak', async () => {
  const r = await sector.resolveSectorWithLlm(bundleOf('A warm welcome to our website.'), {
    vocabulary: TEST_VOCABULARY,
    classifyWithLlm: async () => ({ sector: 'healthcare', evidence: 'welcome copy' }),
  });
  assert.equal(r.value && r.value.sector, 'healthcare');
  assert.equal(r.confidence, 'weak');
  assert.ok(r.evidence.some((e) => e.kind === 'llm-selection'));
});

test('LLM seam: a hook crash fails closed to abstention and records a typed degradation', async () => {
  const r = await sector.resolveSectorWithLlm(bundleOf('A warm welcome to our website.'), {
    vocabulary: TEST_VOCABULARY,
    classifyWithLlm: async () => { throw new Error('provider down'); },
  });
  assert.equal(r.value, null);
  assert.ok(Array.isArray(r.degraded) && r.degraded[0].step === 'classifyWithLlm');
});

// ---------------------------------------------------------------------------------------------
// Vocabulary dependency: fail closed, one door for the tree
// ---------------------------------------------------------------------------------------------

test('string detect patterns are supported, and a malformed one fails closed (C-050)', () => {
  const stringVocab = { TREE: { 'law-firms': { sub: { solicitors: { detect: 'solicitor|conveyancing|probate|\\blaw firm\\b' } } } } };
  const ok = sector.resolveSector(bundleOf(LAW_TEXT), { vocabulary: stringVocab });
  assert.equal(ok.value && ok.value.sector, 'law-firms');
  const badVocab = { TREE: { 'law-firms': { sub: { solicitors: { detect: '([' } } } } };
  assert.throws(() => sector.resolveSector(bundleOf(LAW_TEXT), { vocabulary: badVocab }), (err) => err.code === 'E_VOCABULARY_BAD_DETECT');
});

test('an injected vocabulary without a TREE fails closed', () => {
  assert.throws(() => sector.resolveSector(bundleOf(LAW_TEXT), { vocabulary: {} }), (err) => err.code === 'E_VOCABULARY_MALFORMED');
});

test('default vocabulary loading fails closed when facts/vocabulary.js is absent', (t) => {
  if (REAL_VOCAB) {
    const v = sector.loadVocabulary();
    assert.ok(v.TREE && Object.keys(v.TREE).length > 0);
    return;
  }
  assert.throws(() => sector.resolveSector(bundleOf(LAW_TEXT)), (err) => err.code === 'E_VOCABULARY_MISSING');
  t.diagnostic('facts/vocabulary.js absent: verified the door refuses rather than degrades');
});

// ---------------------------------------------------------------------------------------------
// Calibration fixtures (eval/calibration-known-bad/fixtures/p1-sector-*.json), replayed against
// the injected vocabulary always, and against the real vocabulary when it is present.
// ---------------------------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures');
const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => /^p1-sector-.*\.json$/.test(f)).sort();

test('p1-sector calibration fixtures exist', () => {
  assert.ok(fixtureFiles.length >= 2, 'expected the p1-sector fixtures under eval/calibration-known-bad/fixtures/');
});

const vocabularies = [['injected-test-vocabulary', TEST_VOCABULARY]];
if (REAL_VOCAB && (REAL_VOCAB.TREE || REAL_VOCAB.tree)) vocabularies.push(['real-vocabulary', REAL_VOCAB]);

for (const file of fixtureFiles) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
  for (const [vocabName, vocab] of vocabularies) {
    test('calibration ' + fx.id + ' [' + vocabName + ']', () => {
      // Explicit object literal over the one option key these fixtures actually carry (`hint`),
      // rather than Object.assign/spread of the whole fixture-provided options object: fixtures
      // are local JSON but the flagged pattern still reads as an insecure merge to static
      // analysis, and this repo has no fixture that needs any other resolveSector() option.
      const opts = fx.options || {};
      const r = sector.resolveSector(fx.bundle, { vocabulary: vocab, hint: opts.hint });
      if (fx.expect.abstain === true) {
        assert.equal(r.value, null, fx.id + ': must abstain, got ' + JSON.stringify(r.value));
        assert.equal(r.confidence, 'abstain');
      }
      if (fx.expect.abstain === false) {
        assert.ok(r.value, fx.id + ': must resolve, got abstain');
      }
      if (fx.expect.sector) {
        assert.equal(r.value && r.value.sector, fx.expect.sector, fx.id + ': wrong sector');
      }
      for (const kind of fx.expect.contradiction_kinds || []) {
        assert.ok(r.contradictions.some((c) => c.kind === kind), fx.id + ': expected contradiction ' + kind + ', got ' + JSON.stringify(r.contradictions));
      }
      if (fx.expect.confidence_in) {
        assert.ok(fx.expect.confidence_in.includes(r.confidence), fx.id + ': confidence ' + r.confidence + ' not in ' + fx.expect.confidence_in.join('/'));
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Integration with the real vocabulary (skips loudly when absent)
// ---------------------------------------------------------------------------------------------

test('served-cells sector keys exist in the real vocabulary tree', (t) => {
  if (!REAL_VOCAB || !(REAL_VOCAB.TREE || REAL_VOCAB.tree)) {
    t.skip('facts/vocabulary.js absent: manifest-to-tree sync cannot be verified yet');
    return;
  }
  const tree = REAL_VOCAB.TREE || REAL_VOCAB.tree;
  const missing = sector.SERVED_CELLS.cells
    .filter((c) => c.served === true && c.sector !== '*')
    .map((c) => c.sector)
    .filter((s) => !tree[s]);
  assert.deepEqual(missing, [], 'served-cells sectors missing from the vocabulary tree: ' + missing.join(', '));
});

// ---------------------------------------------------------------------------------------------
// Domain self-identity (C-013 own-identity-before-keywords; the C-006 immigrationlawyersusa class).
// These exercise the REAL vocabulary because the DOMAIN_SELF_IDENTITY map lives there (one door);
// they skip LOUDLY when facts/vocabulary.js is absent. resolveSector is called with NO injected
// vocabulary so the real self-identity data is in play. The invariant under test: the firm's own
// domain naming what it IS can win the two-cue MARGIN over a rival family that appears only as
// incidental body mentions, WITHOUT ever lowering the two-cue floor or resolving a sector alone.
// ---------------------------------------------------------------------------------------------

function realBundle(domain, text) {
  return { domain, corpus: { pages: [{ url: 'https://' + domain + '/', title: 'x', text, jsonLd: [] }] }, registers: {} };
}
const REAL_VOCAB_PRESENT = !!(REAL_VOCAB && (REAL_VOCAB.TREE || REAL_VOCAB.tree));

test('domain self-identity: a US immigration law firm with heavy student-visa/education content resolves law-firms', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent: real-vocabulary self-identity cannot be verified yet'); return; }
  // Two law cues in the body, but the founder-bio education vocabulary (high school, undergraduate,
  // university, college) out-counts them 4-to-2. The "lawyers" in the domain is the firm's own
  // identity and must break the margin the way it could not in the immigrationlawyersusa failure.
  const r = sector.resolveSector(realBundle('castellano-immigration-lawyers.com',
    'Immigration lawyers helping families. We are an immigration law firm in Miami. '
    + 'Nothing on this site is legal advice. Our founder completed her high school education, earned an '
    + 'undergraduate degree at a state university, and attended the College of Law. We assist clients with '
    + 'student visas and university applications.'));
  assert.equal(r.value && r.value.sector, 'law-firms', 'the firm self-identifies as lawyers in its domain');
  assert.ok(r.evidence.some((e) => e.kind === 'domain-self-identity'), 'must record the domain self-identity evidence');
  assert.deepEqual(r.contradictions, []);
});

test('domain self-identity: a genuine university still resolves education (self-identity never misfires)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('oakfield-university.ac.uk',
    'Oakfield University is a leading university and college. We offer undergraduate and postgraduate degree '
    + 'programmes for pupils leaving secondary school. Apply to our university today.'));
  assert.equal(r.value && r.value.sector, 'education');
  assert.ok(!r.evidence.some((e) => e.kind === 'domain-self-identity'), 'a university domain carries no legal self-identity token');
});

test('domain self-identity: a page mentioning lawyers only in passing does not flip to law-firms', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  // A consultancy that merely works alongside lawyers (and "helps law firms", a client mention the
  // own-identity guard already discounts). Its domain is not legal; law is not its identity.
  const r = sector.resolveSector(realBundle('harbourpoint-consulting.com',
    'Harbourpoint is a management consultancy and advisory firm. Our consultants and management consulting '
    + 'team work alongside lawyers and accountants on complex projects. We help law firms grow, too.'));
  assert.ok(r.value && r.value.sector !== 'law-firms', 'a passing mention of lawyers must not classify the subject as a law firm');
  assert.equal(r.value.sector, 'professional-services');
});

test('domain self-identity FLOOR: a legal domain token with under two law body cues resolves nothing', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  // The deny-by-default floor is never lowered: a "lawyers" domain with a single passing law cue and
  // no corroborating body evidence abstains. Self-identity breaks a margin; it never resolves alone.
  const r = sector.resolveSector(realBundle('find-a-lawyers-directory.com',
    'Welcome to our directory. Browse local businesses and read reviews. Get in touch to be listed. '
    + 'We mention legal advice once here in passing.'));
  assert.equal(r.value, null, 'one law cue is below the two-cue floor even with a self-identifying domain');
  assert.equal(r.confidence, 'abstain');
});

// ---------------------------------------------------------------------------------------------
// P6 connection-integrity (uk-tech-media-industrial wave): the new detection leaves added for
// digital-agencies/media-platform/fitness/automotive/energy/manufacturing/construction sub-sectors.
// Runs against the REAL vocabulary (skips loudly when absent). Two directions of proof:
//  1. A genuine sample of each new firm type classifies into the correct sector and sub-sector.
//  2. A healthcare, a legal and a real-estate sample - each carrying an adversarial phrase deliberately
//     chosen to brush against a new leaf's vocabulary (PPE, clinical waste, a studio apartment, a
//     residents' gym) - never misclassifies sector or sub-sector into a new leaf. This is the C-059
//     anti-misclassification proof the P6 gate requires.
// ---------------------------------------------------------------------------------------------

test('P6: a genuine gym resolves fitness/gyms (UK_CCR_FITNESS_DISTANCE / UK_CRA_UNFAIR_TERMS_FITNESS target)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('ironclad-gym.co.uk',
    'Join Ironclad Gym today. Our gym membership includes access to a fitness studio for spin studio '
    + 'classes, plus a sports club social area. Sign up online for a rolling monthly membership.'));
  assert.equal(r.value && r.value.sector, 'fitness');
  assert.equal(r.value && r.value.sub_sector, 'gyms');
});

test('P6: a genuine VOD/streaming service resolves media/vod (UK_ODPS_NOTIFICATION target)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('streambox.example',
    'Watch on StreamBox: a video on demand service with thousands of shows and movies. Our streaming '
    + 'service lets you stream TV and movies on any device, plus catch-up TV on our catchup service so '
    + 'you never miss a programme.'));
  assert.equal(r.value && r.value.sector, 'media');
  assert.equal(r.value && r.value.sub_sector, 'vod');
});

test('P6: a genuine car dealer resolves automotive/car-dealers (UK_FCA_MOTOR_FINANCE_PROMOTIONS target)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('thornfield-motors.co.uk',
    'Browse our used cars for sale at Thornfield Motors, a main dealer for three leading brands. We '
    + 'also offer vehicle leasing and van sales for business customers, plus PCP finance from GBP 199 a '
    + 'month.'));
  assert.equal(r.value && r.value.sector, 'automotive');
  assert.equal(r.value && r.value.sub_sector, 'car-dealers');
});

test('P6: a genuine ATOL travel agent resolves hospitality/travel (UK_ATOL_LICENSING / UK_PACKAGE_TRAVEL_2018 target, after the sector-tag fix)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('suntrail-travel.co.uk',
    'Book your next holiday with SunTrail Travel, an ATOL-protected tour operator and travel agent. We '
    + 'are ABTA members offering package holiday deals across Europe.'));
  assert.equal(r.value && r.value.sector, 'hospitality');
  assert.equal(r.value && r.value.sub_sector, 'travel');
});

test('P6: a genuine barristers chambers resolves barristers/general (UK_BSB_HANDBOOK_PUBLICITY / UK_BSB_TRANSPARENCY target, after the sector-tag fix)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('ashford-chambers.co.uk',
    'Ashford Chambers offers direct access to our barristers for individuals and businesses. We accept '
    + 'public access instructions and offer instructing counsel services without delay.'));
  assert.equal(r.value && r.value.sector, 'barristers');
});

test('P6 anti-misclassification: a healthcare sample mentioning PPE and clinical waste stays healthcare, never manufacturing/construction', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('meadowbrook-medical.co.uk',
    'Welcome to Meadowbrook Medical Centre, a private hospital and medical centre offering GP '
    + 'appointments and cancer care. The clinic is CQC registered. All staff wear appropriate personal '
    + 'protective equipment and our clinical waste removal is handled by a licensed contractor.'));
  assert.equal(r.value && r.value.sector, 'healthcare',
    'a hospital mentioning PPE/clinical waste in passing must never be pulled into manufacturing/construction');
  assert.ok(!['electronics', 'machinery', 'toys', 'ppe', 'consumer-products', 'appliances', 'lighting', 'hvac', 'electronics-retail']
    .includes(r.value && r.value.sub_sector));
  assert.ok(!['skip-hire', 'waste-removal', 'demolition', 'house-clearance'].includes(r.value && r.value.sub_sector));
});

test('P6 anti-misclassification: a solicitors sample stays law-firms, never barristers or any new marketing leaf', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('harrington-reeves.co.uk',
    'Harrington and Reeves Solicitors provide expert conveyancing and probate services. Our law firm '
    + 'offers legal advice to individuals and businesses across the South East. We are authorised and '
    + 'regulated by the Solicitors Regulation Authority. Read our client testimonials and case studies.'));
  assert.equal(r.value && r.value.sector, 'law-firms');
  assert.notEqual(r.value && r.value.sub_sector, 'digital-agencies');
});

test('P6 anti-misclassification: a real-estate sample with a "studio apartment" and a "residents\' gym" amenity mention stays real-estate, never fitness', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('bellview-estates.co.uk',
    "Bellview Estates is a leading estate agent with properties for sale and homes for sale across the "
    + "city. Our current listings include a stunning studio apartment with access to the building's "
    + 'residents\' gym, and a two-bedroom home to let for tenants seeking a long-term tenancy.'));
  assert.equal(r.value && r.value.sector, 'real-estate',
    'a studio-apartment listing and one incidental gym amenity mention must never tip the site into fitness');
  assert.notEqual(r.value && r.value.sub_sector, 'studios',
    'the fitness "studios" leaf must never fire on a real-estate "studio apartment"');
  assert.notEqual(r.value && r.value.sub_sector, 'gyms');
});

// ---------------------------------------------------------------------------------------------
// DEFECT-7 (empirical legal-US Finding 1): the legal detect vocabulary was British-only, so a US
// law firm scored zero legal cues and misclassified. Each case is a POSITIVE control (a US attorney
// site resolves law-firms) paired with the cross-sector NEGATIVE controls the task requires (a
// healthcare site and an insurance site that mention "personal injury"/"counsel"/"litigation" must
// NOT be pulled into legal). Run against the REAL vocabulary (the injected test tree omits US terms).
// ---------------------------------------------------------------------------------------------

test('DEFECT-7 positive: a US personal-injury attorney site resolves law-firms/solicitors (ask4sam.net class)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  // Brand-style domain (no "law"/"lawyer" substring), so the domain self-ID cannot rescue it - the body
  // vocabulary alone must classify, which it could not before the US terms landed.
  const r = sector.resolveSector(realBundle('ask4sam.net',
    'Our attorneys and personal injury lawyers have recovered over one billion dollars for injury '
    + 'victims. Contact our law office for litigation and trial representation. Samuel Miklos, Esq.'));
  assert.equal(r.value && r.value.sector, 'law-firms', 'a US PI attorney site must resolve legal, not healthcare/hospitality');
  assert.equal(r.value && r.value.sub_sector, 'solicitors', 'the leaf that binds us-legal records tagged attorney/law-firm via SUB_SECTOR_SYNONYMS');
});

test('DEFECT-7 positive: a Florida PI firm using American practice terms resolves law-firms (seriousaccidents.com class)', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('seriousaccidents.com',
    'Pines Salomon are experienced personal injury attorneys. Our trial lawyers handle car accident '
    + 'litigation and wrongful death cases. Speak to an attorney at our law office today.'));
  assert.equal(r.value && r.value.sector, 'law-firms');
});

test('DEFECT-7 negative: a physiotherapy clinic that TREATS "personal injury" stays healthcare, never legal', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('meadow-physio.co.uk',
    'Our physiotherapy clinic offers physio, manual therapy and musculoskeletal rehabilitation. We '
    + 'treat personal injury cases, sports injuries and whiplash. Book physiotherapy with our team.'));
  assert.equal(r.value && r.value.sector, 'healthcare',
    'a physio clinic treating "personal injury cases" must never be pulled into legal (the two-cue floor + richer physio vocabulary win)');
  assert.notEqual(r.value && r.value.sector, 'law-firms');
});

test('DEFECT-7 negative: an insurer offering "litigation support" and "legal counsel" stays finance, never legal', (t) => {
  if (!REAL_VOCAB_PRESENT) { t.skip('facts/vocabulary.js absent'); return; }
  const r = sector.resolveSector(realBundle('shieldsure-insurance.co.uk',
    'ShieldSure is an insurance company offering home insurance and car insurance from a leading '
    + 'insurer and underwriter. We provide litigation support and legal counsel for insurance claims.'));
  assert.equal(r.value && r.value.sector, 'finance',
    'an insurer with two incidental legal phrases must stay finance: its own insurance vocabulary out-scores the legal cues');
  assert.notEqual(r.value && r.value.sector, 'law-firms');
});
