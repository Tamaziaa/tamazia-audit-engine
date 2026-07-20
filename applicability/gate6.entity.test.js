'use strict';
// applicability/gate6.entity.spec.js — pins Kimi KIMI-FINAL-BATCH-2026-07-20.md §1c/E7: an
// UNCONFIRMED entity-resolution proposal must NOT let any establishment-dependent record mint (fail
// closed exactly as today); only a CONFIRMED-A verdict unlocks it. connect.js itself is UNCHANGED by
// this batch (§1c: "applicability/connect.js is not edited") — this spec proves the additive path
// through facts/jurisdiction.js's applyEntityResolution() reaches connect()'s existing gate 6
// (hasEstablishmentEvidence) with no new code in connect.js at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { connect } = require('./connect.js');
const { resolveJurisdiction, applyEntityResolution } = require('../facts/jurisdiction.js');
const { resolveEntity, VERDICTS } = require('../facts/entity/resolve.js');

// establishmentRecord(): a catalogue-shaped record that requires 'established_in' nexus in UK — the
// exact nexus gate 6 (hasEstablishmentEvidence) exists to police (Tier-A register/on-site evidence
// only; a mere serves/postcode signal never satisfies it).
function establishmentRecord() {
  return {
    id: 'EST-1',
    jurisdiction: 'UK',
    sub_jurisdiction: null,
    sector: ['universal'],
    sub_sector: [],
    activity_tags: [],
    required_nexus: ['established_in'],
    citation: { act: 'Companies Act 2006', section: 's.82', url: 'https://legislation.gov.uk/x' },
    website_obligations: [{ duty: 'd1', elements: ['e'], evidence_type: 'presence' }],
  };
}

function emptyBundle(pages) {
  return { corpus: { pages }, registers: {} };
}

const FOOTER_WITH_CRN = 'Acme Dental Care Ltd, Company No. 12345678, registered in England and Wales. Registered office: 1 High Street, London, SW1A 1AA.';
const GOOD_PROPOSAL = {
  candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '12345678', source_quote: 'Acme Dental Care Ltd, Company No. 12345678' }],
  privacy_controller: null, sector_evidence: [], sector: 'unknown', sub_sector: 'unknown',
};
const CH_PROFILE_ACTIVE = {
  status: 200,
  json: {
    company_number: '12345678', company_name: 'ACME DENTAL CARE LTD', company_status: 'active',
    registered_office_address: { address_line_1: '1 High Street', locality: 'London', postal_code: 'SW1A 1AA' },
    sic_codes: ['86230'],
  },
};
function geminiFetchImpl(proposal) {
  return async (_url, _options, _signal, extract) => ({ ok: true, text: extract({ candidates: [{ content: { parts: [{ text: JSON.stringify(proposal) }] } }] }) });
}
function chFetchFn(url) {
  if (url.includes('/officers')) return { status: 200, json: { items: [{ name: 'SMITH, John' }] } };
  if (url.includes('persons-with-significant-control')) return { status: 200, json: { items: [] } };
  return CH_PROFILE_ACTIVE;
}

test('UNRESOLVED entity verdict: gate 6 stays fail-closed, establishment record excluded exactly as with no entity lane at all', async () => {
  const er = await resolveEntity({
    pages: [{ kind: 'about', text: 'Just a friendly local business, no legal details published.' }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl({ candidates: [], privacy_controller: null, sector_evidence: [], sector: 'unknown', sub_sector: 'unknown' }),
    fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(er.verdict, VERDICTS.UNRESOLVED);

  const bundle = emptyBundle([{ url: 'about', text: 'Just a friendly local business.' }]);
  const withEntity = applyEntityResolution(bundle, er);
  const jurisdiction = resolveJurisdiction(withEntity);
  const result = connect({ jurisdiction }, { records: [establishmentRecord()] });

  assert.equal(result.applicable.length, 0, 'an unconfirmed entity proposal must never unlock an establishment-gated record');
  assert.equal(result.excluded.length, 1);
});

test('CONFLICT entity verdict: gate 6 stays fail-closed (a disputed binding is never treated as establishment)', async () => {
  const conflictBytes = 'Acme Dental Care Ltd is the trading name. Data controller: Totally Different Holdings Group Ltd.';
  const er = await resolveEntity({
    pages: [{ kind: 'footer', text: conflictBytes }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl({
      candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: null, source_quote: 'Acme Dental Care Ltd is the trading name.' }],
      privacy_controller: { legal_name: 'Totally Different Holdings Group Ltd', company_number: null, source_quote: 'Data controller: Totally Different Holdings Group Ltd.' },
      sector_evidence: [], sector: 'unknown', sub_sector: 'unknown',
    }),
    fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(er.verdict, VERDICTS.CONFLICT);

  const bundle = emptyBundle([{ url: 'footer', text: conflictBytes }]);
  const jurisdiction = resolveJurisdiction(applyEntityResolution(bundle, er));
  const result = connect({ jurisdiction }, { records: [establishmentRecord()] });
  assert.equal(result.applicable.length, 0);
});

test('CONFIRMED-A entity verdict: the ONLY delta is the additive Tier-A fact — the establishment record now fires', async () => {
  const er = await resolveEntity({
    pages: [{ kind: 'footer', text: FOOTER_WITH_CRN }],
    teamText: 'Dr John Smith, principal dentist.',
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl(GOOD_PROPOSAL),
    fetchFn: async (url) => chFetchFn(url),
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(er.verdict, VERDICTS.CONFIRMED_A);

  const bundle = emptyBundle([{ url: 'footer', text: FOOTER_WITH_CRN }]);

  // Baseline: run gate 6 with an EMPTY registers bag and no entity fact applied — the batch's own
  // GO/NO-GO step (i), isolating the entity-lane's contribution from jurisdiction.js's own pre-existing
  // on-page pattern matching (this fixture's footer text also satisfies jurisdiction.js's independent
  // sentence-level Companies-Act patterns, which is expected and orthogonal to this lane — the point
  // pinned here is narrower: applyEntityResolution() with a non-CONFIRMED-A verdict is a no-op).
  const unresolvedBundle = applyEntityResolution(bundle, { verdict: 'UNRESOLVED' });
  assert.deepEqual(unresolvedBundle, bundle,
    'applyEntityResolution must be a byte-for-byte no-op on the bundle for any non-CONFIRMED-A verdict (§1c "no else")');

  // With the entity lane's CONFIRMED-A fact applied: the establishment record unlocks.
  const withEntity = applyEntityResolution(bundle, er);
  const jurisdictionWithEntity = resolveJurisdiction(withEntity);
  const result = connect({ jurisdiction: jurisdictionWithEntity }, { records: [establishmentRecord()] });
  assert.equal(result.applicable.length, 1, 'a CONFIRMED-A binding unlocks the establishment-gated record');
  assert.equal(result.applicable[0].id, 'EST-1');

  // The bound entry's evidence is the Tier-A register kind, sourced from the entity artefact.
  const ukBound = jurisdictionWithEntity.bound.find((b) => b.jurisdiction === 'UK');
  assert.ok(ukBound);
  assert.ok(ukBound.tier_evidence.some((e) => e.tier === 'A' && e.kind === 'register'));
});

test('sector_disagreement never moves the law-pack: connect() reads only jurisdiction/sector facts, not the entity artefact\'s sector field', async () => {
  const er = await resolveEntity({
    pages: [{ kind: 'footer', text: FOOTER_WITH_CRN + ' GDC number 123456.' }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl({
      candidates: GOOD_PROPOSAL.candidates, privacy_controller: null,
      sector_evidence: ['GDC number 123456'], sector: 'healthcare', sub_sector: 'dental',
    }),
    fetchFn: async (url) => chFetchFn(url),
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(er.verdict, VERDICTS.CONFIRMED_A);
  assert.ok(er.sector_disagreement, 'a non-unknown LLM sector always surfaces the review-only flag');
  assert.equal(er.sector_disagreement.flag, 'sector_disagreement');
  // connect()'s firmSectorIdentitySet is driven by facts.sector, which this test never sets — proving
  // the entity artefact's sector field has no path into applicability at all.
  const bundle = emptyBundle([{ url: 'footer', text: FOOTER_WITH_CRN }]);
  const jurisdiction = resolveJurisdiction(applyEntityResolution(bundle, er));
  const sectorRecord = Object.assign(establishmentRecord(), { id: 'EST-SECTOR', sector: ['dental'], required_nexus: ['established_in'] });
  const result = connect({ jurisdiction }, { records: [sectorRecord] }); // no facts.sector supplied
  assert.equal(result.applicable.length, 0, 'a sector-scoped record never attaches from the entity artefact alone; only facts.sector can supply sector identity');
});
