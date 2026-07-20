'use strict';
// facts/entity/resolve.test.js — the verification-ladder orchestrator. NETWORK-FREE throughout
// (both the LLM fetchImpl and the CH fetchFn are fakes). Covers the two proof fixtures the batch spec
// calls for (§ PROOF b/c): a KNOWN-CRN fixture -> CONFIRMED-A, and a no-CRN/no-legal-name fixture ->
// UNRESOLVED, plus the linter-rejection and conflicting-entity fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEntity, VERDICTS } = require('./resolve.js');
const chRegister = require('./chRegister.js');

const FOOTER_WITH_CRN = 'Acme Dental Care Ltd, Company No. 12345678, registered in England and Wales. Registered office: 1 High Street, London, SW1A 1AA. GDC number 123456.';

const GOOD_PROPOSAL = {
  candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: '12345678', source_quote: 'Acme Dental Care Ltd, Company No. 12345678' }],
  privacy_controller: null,
  sector_evidence: ['GDC number 123456'],
  sector: 'healthcare',
  sub_sector: 'dental',
};

function geminiFetchImpl(proposal) {
  return async (_url, _options, _signal, extract) => ({ ok: true, text: extract({ candidates: [{ content: { parts: [{ text: JSON.stringify(proposal) }] } }] }) });
}

const CH_PROFILE_ACTIVE = {
  status: 200,
  json: {
    company_number: '12345678',
    company_name: 'ACME DENTAL CARE LTD',
    company_status: 'active',
    registered_office_address: { address_line_1: '1 High Street', locality: 'London', postal_code: 'SW1A 1AA' },
    sic_codes: ['86230'],
  },
};
const OFFICERS = { status: 200, json: { items: [{ name: 'SMITH, John' }] } };

function chFetchFn(url) {
  if (url.includes('/officers')) return OFFICERS;
  if (url.includes('persons-with-significant-control')) return { status: 200, json: { items: [] } };
  return CH_PROFILE_ACTIVE;
}

test.beforeEach(() => chRegister._cacheClearForTests());

test('KNOWN-CRN fixture: footer CRN + active CH profile + corroboration -> CONFIRMED-A, establishment fact fires', async () => {
  const result = await resolveEntity({
    pages: [{ kind: 'footer', text: FOOTER_WITH_CRN }],
    teamText: 'Meet Dr John Smith, our lead dentist.',
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl(GOOD_PROPOSAL),
    fetchFn: async (url) => chFetchFn(url),
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.CONFIRMED_A);
  assert.equal(result.crn, '12345678');
  assert.equal(result.ch_name, 'ACME DENTAL CARE LTD');
  assert.equal(result.needs_human, false);
  assert.equal(result.artefact.type, 'entity_resolution');
  assert.equal(result.artefact.verdict, 'CONFIRMED-A');
  assert.ok(result.artefact.hash);
  assert.ok(result.artefact.ch.response_hashes.length > 0);
});

test('NO-CRN fixture: no legal name/number on the site -> UNRESOLVED, stays needs_human', async () => {
  const result = await resolveEntity({
    pages: [{ kind: 'about', text: 'We are a friendly local dental practice offering check-ups and treatments.' }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl({ candidates: [], privacy_controller: null, sector_evidence: [], sector: 'unknown', sub_sector: 'unknown' }),
    fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.UNRESOLVED);
  assert.equal(result.needs_human, true);
});

test('no crawled entity markers at all -> UNRESOLVED without ever calling the LLM', async () => {
  let called = false;
  const result = await resolveEntity({
    pages: [{ kind: 'about', text: 'Welcome to our website.' }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: async (...a) => { called = true; return geminiFetchImpl(GOOD_PROPOSAL)(...a); },
    fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.UNRESOLVED);
  assert.equal(called, false);
});

test('linter-rejection fixture: LLM proposes a fabricated name absent from the bytes -> UNRESOLVED', async () => {
  const fabricated = { candidates: [{ legal_name: 'Totally Fake Ltd', company_number: '12345678', source_quote: 'Totally Fake Ltd, Company No. 12345678' }], privacy_controller: null, sector_evidence: [], sector: 'unknown', sub_sector: 'unknown' };
  const result = await resolveEntity({
    pages: [{ kind: 'footer', text: FOOTER_WITH_CRN }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl(fabricated),
    fetchFn: async (url) => chFetchFn(url),
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.UNRESOLVED);
  assert.match(result.reason, /^linter_rejected:/);
});

test('conflicting-entity fixture: footer candidate and privacy_controller name different entities -> CONFLICT', async () => {
  const conflictBytes = 'Acme Dental Care Ltd is the trading name. Data controller: Totally Different Holdings Group Ltd.';
  const conflictProposal = {
    candidates: [{ legal_name: 'Acme Dental Care Ltd', company_number: null, source_quote: 'Acme Dental Care Ltd is the trading name.' }],
    privacy_controller: { legal_name: 'Totally Different Holdings Group Ltd', company_number: null, source_quote: 'Data controller: Totally Different Holdings Group Ltd.' },
    sector_evidence: [], sector: 'unknown', sub_sector: 'unknown',
  };
  const result = await resolveEntity({
    pages: [{ kind: 'footer', text: conflictBytes }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl(conflictProposal),
    fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.CONFLICT);
  assert.equal(result.reason, 'footer_vs_controller_mismatch');
  assert.equal(result.needs_human, true);
});

test('dissolved company -> CONFLICT, never a silent CONFIRMED-A on a dead entity', async () => {
  const dissolvedFetch = async (url) => {
    if (url.includes('/officers') || url.includes('persons-with-significant-control')) return { status: 200, json: { items: [] } };
    return { status: 200, json: { ...CH_PROFILE_ACTIVE.json, company_status: 'dissolved' } };
  };
  const result = await resolveEntity({
    pages: [{ kind: 'footer', text: FOOTER_WITH_CRN }],
    env: { GEMINI_API_KEY: 'k' },
    fetchImpl: geminiFetchImpl(GOOD_PROPOSAL),
    fetchFn: dissolvedFetch,
    keys: { companiesHouse: 'ch-key' },
  });
  assert.equal(result.verdict, VERDICTS.CONFLICT);
  assert.equal(result.reason, 'dissolved_entity');
});

test('artefact hash-chains onto a supplied prevHash', async () => {
  const result = await resolveEntity({
    pages: [{ kind: 'about', text: 'Nothing here.' }],
    env: {}, fetchImpl: async () => ({ ok: false }), fetchFn: async () => CH_PROFILE_ACTIVE,
    keys: {}, prevHash: 'a'.repeat(64),
  });
  assert.equal(result.artefact.prev_hash, 'a'.repeat(64));
});
