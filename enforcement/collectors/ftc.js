'use strict';
// enforcement/collectors/ftc.js - the FTC (US Federal Trade Commission) case/press-release
// collector. Parses one ftc.gov/news-events/news/press-releases/... article page.
//
// FTC press releases do not follow one rigid label/value template the way ICO's do; this parser
// therefore looks for two independently-verifiable signals and only emits a row when BOTH are
// found: (a) a dollar settlement figure ("pay $X million/billion"), and (b) a publication date on
// the line immediately preceding the page's "Tags:" block (a structural element every FTC press
// release page carries). Entity extraction prefers a "<jurisdiction> company <Name>" sentence
// (the FTC's own standard phrasing for naming a defendant); if that sentence is absent, it falls
// back to the portion of the <title> before the settlement verb, which is a weaker signal and is
// intentionally still deterministic (not an LLM guess) - a page with neither a recognisable company
// sentence nor a title pattern still fails closed to a null entity, which drops the row.

const { stripHtmlToText } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');

const SOURCE = 'FTC';
const REGULATOR = 'Federal Trade Commission';
const ARCHIVE_URL = 'https://www.ftc.gov/news-events/news/press-releases';

// FTC press releases name the FTC Act s.5 UDAP theory in nearly all consumer-protection actions;
// this collector deliberately does not try to parse count-specific statutory citations out of free
// narrative prose (too unreliable without a fixed template) and instead attaches the one law_id the
// FTC's own consumer-protection programme is built on, which is already a catalogue record
// (US_FTC_ACT_S5_UDAP). A future pass with more fixtures can refine this per-count.
const DEFAULT_LAW_ID = 'US_FTC_ACT_S5_UDAP';

const AMOUNT_RX = /pay\s*\$\s*([\d.,]+)\s*(million|billion)?/i;
const DATE_BEFORE_TAGS_RX = /\n([A-Z][a-z]+ \d{1,2}, \d{4})\nTags:/;
const COMPANY_SENTENCE_RX = /(?:[A-Z][a-z]+ company|US company|Massachusetts-based subsidiary)\s+([A-Z][\w.,()'-]+(?:\s+[A-Z][\w.,()'-]+){0,3})/;
const TITLE_FALLBACK_RX = /^(.*?)\s+(?:to Pay|Agrees to|Will Pay|Settles?)\b/i;

function amountOf(match) {
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (/billion/i.test(match[2] || '')) return n * 1_000_000_000;
  if (/million/i.test(match[2] || '')) return n * 1_000_000;
  return n;
}

function entityOf(text) {
  const sentenceMatch = COMPANY_SENTENCE_RX.exec(text);
  if (sentenceMatch) return sentenceMatch[1].replace(/[.,]$/, '').trim();
  const titleLine = text.split('\n')[0] || '';
  const titleMatch = TITLE_FALLBACK_RX.exec(titleLine);
  return titleMatch ? titleMatch[1].trim() : null;
}

// missingRequiredFtcSignals(amount, dateMatch, entity) -> boolean. True when any one of the three
// independently-verifiable signals this collector's module doc describes is absent - a page missing
// any one of them fails closed to zero rows rather than a partially-guessed row.
function missingRequiredFtcSignals(amount, dateMatch, entity) {
  if (amount === null) return true;
  if (!dateMatch) return true;
  return !entity;
}

function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const amount = amountOf(AMOUNT_RX.exec(text));
  const dateMatch = DATE_BEFORE_TAGS_RX.exec(text);
  const entity = entityOf(text);
  if (missingRequiredFtcSignals(amount, dateMatch, entity)) return [];

  const decisionDate = isoDateOf(dateMatch[1]);
  const row = {
    id: `FTC-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: 'US',
    law_ids: [DEFAULT_LAW_ID],
    entity_name: entity,
    offending_quote: null,
    decision_date: decisionDate,
    penalty_amount: amount,
    currency: 'USD',
    url: ctx.url,
    sha256: ctx.sha256,
    summary: `FTC settlement: ${entity} to pay $${amount.toLocaleString('en-US')} (${DEFAULT_LAW_ID}).`,
  };
  return [row];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoDateOf(dateStr) {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(dateStr);
  const mm = String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0');
  return `${m[3]}-${mm}-${String(Number(m[2])).padStart(2, '0')}`;
}

function collect(opts = {}) {
  return collectFromSource({ source: SOURCE, url: opts.url || ARCHIVE_URL, deadlineMs: opts.deadlineMs, fetchImpl: opts.fetchImpl, parse });
}

module.exports = { SOURCE, REGULATOR, ARCHIVE_URL, parse, collect, DEFAULT_LAW_ID };
