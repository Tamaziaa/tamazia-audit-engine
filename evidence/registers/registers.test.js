'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchRegisters, resolveQuery, tryUkRegisters, runCalibration } = require('./registers');

function fetchFnFromMap(map) {
  return async (url, options) => {
    const key = options && options.requestKey;
    return map[key] || { status: 200, json: {} };
  };
}

test('fetchRegisters requires opts.fetchFn (Rule 9: no raw network call is ever made by this module)', async () => {
  await assert.rejects(() => fetchRegisters({ domain: 'x.co.uk' }, {}), /requires opts\.fetchFn/);
});

test('resolveQuery prefers a company-name hint over the domain-stem fallback', () => {
  assert.equal(resolveQuery({ company: 'Kingsley Napley LLP', domain: 'kingsleynapley.co.uk' }), 'Kingsley Napley LLP');
  assert.equal(resolveQuery({ domain: 'kingsleynapley.co.uk' }), 'kingsleynapley');
});

test('tryUkRegisters: absent/UK/GB country hints try; an explicit other country does not', () => {
  assert.equal(tryUkRegisters({}), true);
  assert.equal(tryUkRegisters({ country: 'UK' }), true);
  assert.equal(tryUkRegisters({ country: 'gb' }), true);
  assert.equal(tryUkRegisters({ country: 'US' }), false);
});

test('fetchRegisters: a UK law-firm bundle populates companiesHouse + sra + gleif and carries notes for the rest', async () => {
  const fetchFn = fetchFnFromMap({
    'companies_house.search': { status: 200, json: { items: [{ title: 'KINGSLEY NAPLEY LLP', company_number: '00930093', company_status: 'active' }] } },
    'sra.organisations': { status: 200, json: [{ organisationName: 'KINGSLEY NAPLEY LLP', sraNumber: '500046' }] },
    'gleif.lei_records': { status: 200, json: { data: [] } },
  });
  const bundle = await fetchRegisters(
    { domain: 'kingsleynapley.co.uk', company: 'Kingsley Napley LLP', country: 'UK', sector: 'law-firms' },
    { fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' }, log: () => {} }
  );
  assert.ok(bundle.companiesHouse);
  assert.equal(bundle.companiesHouse.company_number, '00930093');
  assert.ok(bundle.sra);
  assert.equal(bundle.sra.sra_number, '500046');
  assert.equal(bundle.gleif, undefined);
  assert.ok(Array.isArray(bundle.notes));
  // cqc/fca are sector-skipped (law-firms is neither health nor finance); gleif returned zero candidates.
  const byRegister = Object.fromEntries(bundle.notes.map((n) => [n.register, n]));
  assert.equal(byRegister.cqc.kind, 'skipped');
  assert.equal(byRegister.fca.kind, 'skipped');
  assert.equal(byRegister.gleif.reason, 'no_candidates_returned');
  assert.equal(byRegister.ico.kind, 'degraded'); // no keys.ico configured in this estate today
});

test('fetchRegisters: a non-UK country hint skips every UK-only register but still tries GLEIF, NPI and RDAP', async () => {
  const fetchFn = fetchFnFromMap({ 'gleif.lei_records': { status: 200, json: { data: [] } } });
  const bundle = await fetchRegisters(
    { domain: 'example.com', company: 'Example Corp Inc', country: 'US' },
    { fetchFn, deadlineMs: 500, keys: {}, log: () => {} }
  );
  assert.equal(bundle.companiesHouse, undefined);
  assert.equal(bundle.sra, undefined);
  assert.equal(bundle.cqc, undefined);
  assert.equal(bundle.fca, undefined);
  assert.equal(bundle.ico, undefined);
  assert.equal(bundle.npi, undefined);
  assert.equal(bundle.rdap, undefined);
  // GLEIF and NPI (US-hinted, worldwide/self-gating) and RDAP (domain-keyed, always attempted)
  // all ran and each found nothing: exactly three notes.
  assert.equal(bundle.notes.length, 3);
  const registersNoted = bundle.notes.map((n) => n.register).sort();
  assert.deepEqual(registersNoted, ['gleif', 'npi', 'rdap']);
});

test('fetchRegisters: C-004 end-to-end -- a non-empty, non-matching companiesHouse response yields no row on the bundle', async () => {
  const fetchFn = fetchFnFromMap({
    'companies_house.search': { status: 200, json: { items: [{ title: 'KINGSLEY CARPETS LTD', company_number: '01234567', company_status: 'active' }] } },
    'sra.organisations': { status: 200, json: [] },
    'gleif.lei_records': { status: 200, json: { data: [] } },
  });
  const bundle = await fetchRegisters(
    { domain: 'kingsleynapley-example.co.uk', company: 'Kingsley Napley LLP', country: 'UK', sector: 'law-firms' },
    { fetchFn, deadlineMs: 500, keys: { companiesHouse: 'test-key' } }
  );
  assert.equal(bundle.companiesHouse, undefined);
  const chNote = bundle.notes.find((n) => n.register === 'companies_house');
  assert.equal(chNote.reason, 'below_threshold');
});

test('runCalibration: the shipped p3-register-*.json fixtures each earn a finding (the earn-your-zero contract)', async () => {
  const findings = await runCalibration();
  assert.ok(findings.length >= 2, 'expected at least one finding per shipped p3-register-*.json fixture');
  assert.ok(findings.every((f) => f.rule === 'register-nonmatch-rejected'));
});
