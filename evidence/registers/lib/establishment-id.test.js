'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCompanyNumber, extractCqcProviderId } = require('./establishment-id');

test('extractCompanyNumber: anchored "Company number 12345678" extracts the digits', () => {
  assert.equal(extractCompanyNumber('Acme Ltd. Company number 12345678.'), '12345678');
});

test('extractCompanyNumber: "Registered in England and Wales No. 01234567" extracts it', () => {
  assert.equal(extractCompanyNumber('Registered in England and Wales No. 01234567'), '01234567');
});

test('extractCompanyNumber: "Company Reg. No: SC123456" extracts a Scottish-prefixed number', () => {
  assert.equal(extractCompanyNumber('Company Reg. No: SC123456'), 'SC123456');
});

test('extractCompanyNumber: a bare SC/NI/OC-prefixed number is matched even unanchored', () => {
  assert.equal(extractCompanyNumber('Some text mentioning NI654321 in passing'), 'NI654321');
});

test('extractCompanyNumber: an unanchored bare 8-digit run is NOT matched (too noisy, e.g. a phone number)', () => {
  assert.equal(extractCompanyNumber('Call us on 01234567 89 today'), null);
});

test('extractCompanyNumber: no number present returns null', () => {
  assert.equal(extractCompanyNumber('Acme Ltd sells widgets.'), null);
});

test('extractCompanyNumber: null/empty input never throws', () => {
  assert.equal(extractCompanyNumber(null), null);
  assert.equal(extractCompanyNumber(''), null);
  assert.equal(extractCompanyNumber(undefined), null);
});

test('extractCqcProviderId: the documented 1-\\d{6,10} shape is matched', () => {
  assert.equal(extractCqcProviderId('CQC Provider ID: 1-123456789'), '1-123456789');
  assert.equal(extractCqcProviderId('rated by CQC (1-101234)'), '1-101234');
});

test('extractCqcProviderId: no match returns null, never throws on odd input', () => {
  assert.equal(extractCqcProviderId('We are proud of our 5-star reviews'), null);
  assert.equal(extractCqcProviderId(null), null);
});
