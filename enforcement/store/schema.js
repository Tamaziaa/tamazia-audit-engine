'use strict';
// enforcement/store/schema.js - THE one producer of the EnforcementAction row shape and its
// validator (Constitution Rule 1: one door per fact). Every collector, the store writer and every
// derived-output module (enforcement/derive/) import the shape and the validator from here and
// nowhere else.
//
// WHAT THIS ROW IS: a normalised record of one real, published regulatory enforcement action
// (a ruling, a monetary penalty, a resolution agreement, a deliberation) mined from a named free
// source. It is NOT a law fact (Constitution Rule 2 forbids literal law names/fines/regulators in
// engine code outside the catalogue) - this store is deliberately outside `catalogue/`: it feeds
// PROPOSALS (enforcement/derive/lexicon.js, enforcement/derive/precedent.js) that a human/legal-QA
// step promotes into the catalogue later. Nothing in this store is auto-consumed by the live mint
// path (mission scope: this workstream produces artefacts; wiring is a later workstream).
//
// FAIL-CLOSED (Constitution Rule 4): assertValidRow THROWS on any malformed row. There is no
// "best effort" write path - a row that does not validate does not enter the store.

const SOURCES = Object.freeze([
  'ASA', // UK Advertising Standards Authority ruling archive
  'ICO', // UK Information Commissioner's Office enforcement action
  'CNIL', // France Commission Nationale de l'Informatique et des Libertes deliberation
  'GDPRHUB', // GDPRhub (noyb) DPA decision summary
  'FTC', // US Federal Trade Commission case/press release
  'OCR', // US HHS Office for Civil Rights HIPAA breach portal / resolution agreement
]);

const REQUIRED_STRING_FIELDS = [
  'id',
  'source',
  'regulator',
  'jurisdiction',
  'entity_name',
  'decision_date',
  'url',
  'sha256',
  'summary',
];

const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RX = /^[0-9a-f]{64}$/;
// A currency ISO-4217 code, OR the literal 'GBP'/'EUR'/'USD' set this store actually emits. Kept as
// a general 3-uppercase-letter check so a future source's currency is not rejected by a closed enum.
const CURRENCY_RX = /^[A-Z]{3}$/;

// isPresent(value) -> boolean. The store's own "set" test: undefined and null both mean "not
// supplied" for every optional field (offending_quote, penalty_amount, currency).
function isPresent(value) {
  if (value === undefined) return false;
  return value !== null;
}

// isBlankString(value) -> boolean. True for anything that is not a non-empty, non-whitespace-only
// string - the one shared test every string-shaped field below is validated against.
function isBlankString(value) {
  if (typeof value !== 'string') return true;
  return value.trim().length === 0;
}

// --- one small assertion per field group, each a single guard clause (CodeScene Complex
// Method/Complex Conditional/Bumpy Road Ahead: assertValidRow used to carry all of this in one
// 44-branch function; every helper below is independently readable, independently testable, and
// none chains more than one boolean operator in a single conditional). assertValidRow (below) is
// unchanged in the field order it checks and the exact message each field throws.

function assertPlainObjectRow(row) {
  if (row === null) throw new TypeError('EnforcementAction row must be a plain object');
  if (typeof row !== 'object') throw new TypeError('EnforcementAction row must be a plain object');
  if (Array.isArray(row)) throw new TypeError('EnforcementAction row must be a plain object');
}

function assertRequiredStringFieldsPresent(row) {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isBlankString(row[field])) continue;
    throw new TypeError(`EnforcementAction.${field} must be a non-empty string`);
  }
}

function assertKnownSource(row) {
  if (SOURCES.includes(row.source)) return;
  throw new TypeError(`EnforcementAction.source must be one of ${SOURCES.join(', ')}, got "${row.source}"`);
}

function assertIsoDecisionDate(row) {
  if (ISO_DATE_RX.test(row.decision_date)) return;
  throw new TypeError(`EnforcementAction.decision_date must be YYYY-MM-DD, got "${row.decision_date}"`);
}

function assertSha256Digest(row) {
  if (SHA256_RX.test(row.sha256)) return;
  throw new TypeError('EnforcementAction.sha256 must be a lowercase 64-hex-char sha256 digest');
}

// parseHttpUrl(value) -> URL. Throws the field-specific TypeError itself (rather than letting the
// native URL constructor's TypeError escape) so every EnforcementAction validation failure carries
// the same `EnforcementAction.<field>` message shape.
function parseHttpUrl(value) {
  try {
    return new URL(value);
  } catch (err) {
    throw new TypeError(`EnforcementAction.url must be a valid absolute URL: ${err.message}`);
  }
}

function assertHttpProtocol(parsedUrl) {
  if (parsedUrl.protocol === 'https:') return;
  if (parsedUrl.protocol === 'http:') return;
  throw new TypeError('EnforcementAction.url must be http(s)');
}

function assertValidUrl(row) {
  assertHttpProtocol(parseHttpUrl(row.url));
}

function assertLawIdsPresent(row) {
  if (Array.isArray(row.law_ids) && row.law_ids.length > 0) return;
  throw new TypeError('EnforcementAction.law_ids must be a non-empty array of strings');
}

function assertLawIdEntriesValid(row) {
  for (const lawId of row.law_ids) {
    if (!isBlankString(lawId)) continue;
    throw new TypeError('EnforcementAction.law_ids entries must be non-empty strings');
  }
}

function assertLawIds(row) {
  assertLawIdsPresent(row);
  assertLawIdEntriesValid(row);
}

function assertOffendingQuote(row) {
  if (!isPresent(row.offending_quote)) return;
  if (!isBlankString(row.offending_quote)) return;
  throw new TypeError('EnforcementAction.offending_quote, if present, must be a non-empty string');
}

function isValidPenaltyAmount(value) {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  return value >= 0;
}

function isValidCurrencyCode(value) {
  if (typeof value !== 'string') return false;
  return CURRENCY_RX.test(value);
}

function assertPenaltyAmountShape(row) {
  if (isValidPenaltyAmount(row.penalty_amount)) return;
  throw new TypeError('EnforcementAction.penalty_amount, if present, must be a non-negative finite number');
}

function assertCurrencyRequiredByPenalty(row) {
  if (isValidCurrencyCode(row.currency)) return;
  throw new TypeError('EnforcementAction.currency must be a 3-letter ISO code when penalty_amount is present');
}

// A currency without an amount is meaningless data drift, not a fact. Fail closed rather than
// silently accepting a half-filled pair.
function assertNoCurrencyWithoutPenalty(row) {
  if (!isPresent(row.currency)) return;
  throw new TypeError('EnforcementAction.currency must not be set without penalty_amount');
}

function assertPenaltyAndCurrency(row) {
  if (!isPresent(row.penalty_amount)) {
    assertNoCurrencyWithoutPenalty(row);
    return;
  }
  assertPenaltyAmountShape(row);
  assertCurrencyRequiredByPenalty(row);
}

// assertValidRow(row) -> void | throws TypeError with a field-specific message. The ONE validator
// every writer (enforcement/store/store.js appendRow, the seed loader) must call before a row is
// considered part of the store.
function assertValidRow(row) {
  assertPlainObjectRow(row);
  assertRequiredStringFieldsPresent(row);
  assertKnownSource(row);
  assertIsoDecisionDate(row);
  assertSha256Digest(row);
  assertValidUrl(row);
  assertLawIds(row);
  assertOffendingQuote(row);
  assertPenaltyAndCurrency(row);
}

// isValidRow(row) -> boolean. Non-throwing convenience wrapper for filter/scan call sites that must
// not raise mid-loop (the loop itself decides what to do with a false: reject-and-record, per Rule 4).
function isValidRow(row) {
  try {
    assertValidRow(row);
    return true;
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err; // an unexpected non-validation error must not be swallowed as "invalid row"
  }
}

module.exports = { SOURCES, REQUIRED_STRING_FIELDS, assertValidRow, isValidRow };
