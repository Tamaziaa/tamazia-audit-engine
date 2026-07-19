'use strict';
// enforcement/collectors/ocr.js - the HHS OCR (US Department of Health and Human Services, Office
// for Civil Rights) HIPAA resolution-agreement / breach-portal collector.
//
// LIVE FETCH STATUS (2026-07-20): hhs.gov returns HTTP 403 to every request this session made,
// including a realistic browser User-Agent and a Wayback Machine snapshot lookup - a genuine,
// verified block, not a code defect (see this workstream's PR report for the full attempt log).
// The parser below is built and tested against a SYNTHETIC fixture
// (fixtures/ocr/synthetic-resolution-agreement.html) modelled on OCR's own published press-release
// template (title "HHS' Office for Civil Rights Settles ... Investigation with <Entity>", a
// "paid $X to OCR" settlement-amount sentence, and a "corrective action plan ... monitored for N
// years" sentence - the real, consistent shape of OCR's press releases, confirmed via multiple real
// press-release titles found through search but NOT fetchable this session). The synthetic fixture
// uses a clearly fictional entity name so it cannot be mistaken for a real case; NO row derived from
// it is written to the committed seed store (enforcement/data/enforcement-actions.ndjson) - only
// rows with a genuinely fetched, hashed source enter that file. This collector is committed
// collect-ready: pointing fetchImpl/url at a live, reachable HHS page (e.g. from an allow-listed
// egress IP once the founder resolves the block) requires no code change.

const { stripHtmlToText } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');

const SOURCE = 'OCR';
const REGULATOR = 'HHS Office for Civil Rights';
const ARCHIVE_URL = 'https://www.hhs.gov/hipaa/for-professionals/compliance-enforcement/agreements/index.html';

const DEFAULT_LAW_ID = 'US_HIPAA_TRACKING';

const AMOUNT_RX = /paid\s*\$\s*([\d,]+)\s*to OCR/i;
const TITLE_ENTITY_RX = /Settles?\s+(?:.*?\s+)?(?:Investigation|Investigations?)\s+(?:with|of)\s+([A-Z][\w.,()'&\s-]+?)(?:\s+Breach|\s+for|\s+over|\s*\||\s*$)/;
const DATE_RX = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoDateOf(month, day, year) {
  const mm = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  return `${year}-${mm}-${String(Number(day)).padStart(2, '0')}`;
}

function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const amountMatch = AMOUNT_RX.exec(text);
  const entityMatch = TITLE_ENTITY_RX.exec(text);
  const dateMatch = DATE_RX.exec(text);
  if (!amountMatch || !entityMatch || !dateMatch) return [];

  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return [];

  const row = {
    id: `OCR-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: 'US',
    law_ids: [DEFAULT_LAW_ID],
    entity_name: entityMatch[1].trim(),
    offending_quote: null,
    decision_date: isoDateOf(dateMatch[1], dateMatch[2], dateMatch[3]),
    penalty_amount: amount,
    currency: 'USD',
    url: ctx.url,
    sha256: ctx.sha256,
    summary: `HHS OCR HIPAA resolution agreement: ${entityMatch[1].trim()} paid $${amount.toLocaleString('en-US')} to OCR.`,
  };
  return [row];
}

function collect(opts = {}) {
  return collectFromSource({ source: SOURCE, url: opts.url || ARCHIVE_URL, deadlineMs: opts.deadlineMs, fetchImpl: opts.fetchImpl, parse });
}

module.exports = { SOURCE, REGULATOR, ARCHIVE_URL, parse, collect, DEFAULT_LAW_ID };
