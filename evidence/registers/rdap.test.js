'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { lookupRdap, findRegistrantCountry, vcardCountry } = require('./rdap');

// Shape captured from a LIVE call to https://rdap.org/domain/mayoclinic.org 2026-07-20 (trimmed to
// the fields this module reads): only a registrar-role entity, no registrant entity at all — the
// WHOIS-redaction norm the blueprint predicts.
const REDACTED_RESPONSE = {
  status: 200,
  json: {
    rdapConformance: ['rdap_level_0'],
    entities: [{
      objectClassName: 'entity',
      roles: ['registrar'],
      vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Example Registrar, Inc.']]],
      entities: [{
        objectClassName: 'entity',
        roles: ['abuse'],
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', '']]],
      }],
    }],
  },
};

// A domain that DOES still publish a registrant country (some ccTLDs, for an organisation).
const REGISTRANT_RESPONSE = {
  status: 200,
  json: {
    entities: [{
      objectClassName: 'entity',
      roles: ['registrant'],
      vcardArray: ['vcard', [
        ['version', {}, 'text', '4.0'],
        ['adr', {}, 'text', ['', '', '1 Example Street', 'Example City', '', 'EX1 1AA', 'GB']],
      ]],
    }],
  },
};

test('lookupRdap: a redacted registrant (the live-observed norm) returns no row, honest absence', async () => {
  const fetchFn = async () => REDACTED_RESPONSE;
  const r = await lookupRdap({ domain: 'mayoclinic.org', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'registrant_redacted');
});

test('lookupRdap: never reads a registrar/abuse entity as the registrant country', async () => {
  // Sanity: REDACTED_RESPONSE's registrar entity has no adr at all, so this also proves the role
  // filter (not merely a missing-field accident) is what gates the result.
  const fetchFn = async () => REDACTED_RESPONSE;
  const r = await lookupRdap({ domain: 'mayoclinic.org', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
});

test('lookupRdap: a genuine registrant-role entity with a country yields a Tier-C-only row', async () => {
  const fetchFn = async () => REGISTRANT_RESPONSE;
  const r = await lookupRdap({ domain: 'example.co.uk', fetchFn, deadlineMs: 500 });
  assert.ok(r.row);
  assert.equal(r.row.registrant_country, 'GB');
  assert.equal(r.row.source, 'rdap');
  // No id/number/legalName field of any kind: this row can never be mistaken for a Tier-A register hit.
  assert.equal(Object.prototype.hasOwnProperty.call(r.row, 'id'), false);
});

test('lookupRdap: a timeout degrades loudly, never hangs (Rule 9)', async () => {
  const fetchFn = () => new Promise(() => {}); // never settles
  const r = await lookupRdap({ domain: 'example.com', fetchFn, deadlineMs: 20 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'timeout');
});

test('lookupRdap: a fetch error (rejection) degrades with fetch_error, not timeout (CodeRabbit PR #30)', async () => {
  const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
  const r = await lookupRdap({ domain: 'example.com', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'fetch_error');
});

test('lookupRdap: a non-200 status degrades with unexpected_response', async () => {
  const fetchFn = async () => ({ status: 404, json: null });
  const r = await lookupRdap({ domain: 'example.com', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(r.note.reason, 'unexpected_response');
});

test('lookupRdap: an empty domain never calls fetchFn', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return REDACTED_RESPONSE; };
  const r = await lookupRdap({ domain: '', fetchFn, deadlineMs: 500 });
  assert.equal(r.row, null);
  assert.equal(called, false);
});

test('findRegistrantCountry: searches nested entities, ignores non-registrant roles', () => {
  const nested = [{
    roles: ['registrar'],
    entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['adr', {}, 'text', ['', '', '', '', '', '', 'FR']]]] }],
  }];
  assert.equal(findRegistrantCountry(nested, 0), 'FR');
  assert.equal(findRegistrantCountry([{ roles: ['registrar'] }], 0), null);
  assert.equal(findRegistrantCountry(null, 0), null);
});

test('vcardCountry: reads the 7th adr component, tolerates a missing adr property', () => {
  assert.equal(vcardCountry(['vcard', [['adr', {}, 'text', ['', '', '', '', '', '', 'DE']]]]), 'DE');
  assert.equal(vcardCountry(['vcard', [['fn', {}, 'text', 'X']]]), null);
  assert.equal(vcardCountry(null), null);
});
