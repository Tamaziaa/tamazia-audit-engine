'use strict';
// enforcement/collectors/asa.js - the ASA (UK Advertising Standards Authority) ruling-archive
// collector. Parses one ruling detail page (the format every www.asa.org.uk/rulings/*.html page
// shares as of 2026-07: an H1 "ASA Ruling on <Entity>" block followed immediately by the
// upheld/not-upheld verdict, the ad medium and the ruling date, then the body carrying the verbatim
// offending ad copy in curly quotes and the CAP Code rule numbers cited).
//
// This collector is the primary launch source for Discipline 2 (enforcement-driven lexicon mining,
// blueprint B4): the ASA archive publishes the EXACT quoted offending ad text and the CAP rule it
// breached, which is the highest-quality raw material for violation-lexicon phrases (POM
// advertising, misleading price claims).

const { stripHtmlToText, firstMatch, firstCurlyQuote } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');

const SOURCE = 'ASA';
const REGULATOR = 'Advertising Standards Authority';
const ARCHIVE_URL = 'https://www.asa.org.uk/rulings.html?q=&sort_order=recent';

// CAP_RULE_TO_LAW_ID: maps a cited CAP Code rule number to the closest existing catalogue law_id
// (catalogue/packs/*.json) where one already exists, so a future consumer can join this store
// straight onto the catalogue. A rule with no catalogue match yet falls back to UK_CAP_CODE (the
// general CAP Code record, also already in the catalogue) rather than inventing a new id.
const CAP_RULE_TO_LAW_ID = {
  '12.12': 'UK_MHRA_POM_AD_BAN',
  '12.11': 'UK_MHRA_POM_AD_BAN',
  '12.1': 'UK_CAP_1212_COSMETIC',
  '3.1': 'UK_CAP_CODE',
  '3.3': 'UK_CAP_CODE',
};

function lawIdsFromRuleNumbers(ruleNumbers) {
  const mapped = new Set();
  for (const rule of ruleNumbers) {
    mapped.add(CAP_RULE_TO_LAW_ID[rule] || 'UK_CAP_CODE');
  }
  return mapped.size > 0 ? [...mapped] : ['UK_CAP_CODE'];
}

// ruleNumbersOf(text) -> the distinct CAP Code rule numbers (e.g. "12.12") the ruling body cites.
function ruleNumbersOf(text) {
  const found = new Set();
  const rx = /\brule\s+(\d{1,2}\.\d{1,2})\b/gi;
  let m = rx.exec(text);
  while (m) {
    found.add(m[1]);
    m = rx.exec(text);
  }
  return [...found];
}

const MONTH_DATE_RX = /\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isoDateOf(day, month, year) {
  const mIdx = MONTHS.indexOf(month);
  const mm = String(mIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// entityNameOf(text) -> the entity named in the "Ruling on <Entity>" heading, or null if the page
// structure has drifted (the caller then produces zero rows rather than a guessed entity name).
function entityNameOf(text) {
  const m = /Ruling on\s*\n?\s*([^\n]+)/.exec(text);
  return m ? m[1].trim() : null;
}

// parse(html, ctx) -> EnforcementAction[]. ctx carries { url, sha256, fetchedAt, source } from the
// fetch framework; this function never fetches or hashes anything itself (Rule 1: one door for
// fetch/hash, enforcement/collectors/lib/fetcher.js).
function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const entity = entityNameOf(text);
  const dateMatch = MONTH_DATE_RX.exec(text);
  if (!entity || !dateMatch) return [];

  const decisionDate = isoDateOf(Number(dateMatch[1]), dateMatch[2], dateMatch[3]);
  const ruleNumbers = ruleNumbersOf(text);
  const quote = firstCurlyQuote(text, 15);
  const outcome = /Ruling on\s*\n?\s*[^\n]+\n\s*(Upheld|Not upheld|Partially upheld)/i.exec(text);

  const row = {
    id: `ASA-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: 'UK',
    law_ids: lawIdsFromRuleNumbers(ruleNumbers),
    entity_name: entity,
    offending_quote: quote,
    decision_date: decisionDate,
    penalty_amount: null,
    currency: null,
    url: ctx.url,
    sha256: ctx.sha256,
    summary: buildSummary(entity, outcome, ruleNumbers),
  };
  return [row];
}

function buildSummary(entity, outcomeMatch, ruleNumbers) {
  const outcome = outcomeMatch ? outcomeMatch[1] : 'ruling';
  const rules = ruleNumbers.length > 0 ? `CAP Code rule ${ruleNumbers.join(', ')}` : 'the CAP Code';
  return `ASA ${outcome.toLowerCase()} against ${entity} under ${rules}.`;
}

// collect(opts = {}) -> Promise<CollectResult>. Live entry point; opts.fetchImpl lets tests and the
// expansion script inject a fixture-backed or otherwise non-network fetch (see lib/framework.js).
function collect(opts = {}) {
  return collectFromSource({
    source: SOURCE,
    url: opts.url || ARCHIVE_URL,
    deadlineMs: opts.deadlineMs,
    fetchImpl: opts.fetchImpl,
    parse,
  });
}

module.exports = { SOURCE, REGULATOR, ARCHIVE_URL, parse, collect, CAP_RULE_TO_LAW_ID };
