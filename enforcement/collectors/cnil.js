'use strict';
// enforcement/collectors/cnil.js - the CNIL (France, Commission Nationale de l'Informatique et des
// Libertes) deliberation collector. Parses the ENGLISH-language article pages at cnil.fr/en/* (the
// French-only pages use a different sentence structure this module does not attempt to parse - a
// French-language variant is future work, noted in the module doc rather than guessed at).
//
// Two article shapes are supported, both observed on real fetched cnil.fr/en pages as of 2026-07:
//   (a) single-entity: "On <date>, <ENTITY> was fined <EUR> million, ..." (e.g. the IQVIA article)
//   (b) combined multi-entity: "On <date>, the CNIL issued <n> sanction decisions against <entities>,
//       imposing fines of <EUR-A> and <EUR-B> respectively" (e.g. the FREE MOBILE / FREE article)
// A page matching neither shape yields zero rows (Rule 4: fail closed, never guessed).

const { stripHtmlToText } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');

const SOURCE = 'CNIL';
const REGULATOR = 'Commission Nationale de l\'Informatique et des Libertes';
const ARCHIVE_URL = 'https://www.cnil.fr/en/thematique/cnil/sanctions';

const ARTICLE_TO_LAW_ID = {
  '5': 'EU_GDPR_ART_5',
  '14': 'EU_GDPR_ART_14',
  '25': 'EU_GDPR_ART_25',
  '32': 'EU_GDPR_ART_32',
  '34': 'EU_GDPR_ART_34',
};

// lawIdsOf(text) -> the GDPR article law_ids cited. DELIBERATELY a closed whitelist
// (ARTICLE_TO_LAW_ID), not "every 'Article N' found in the page": CNIL articles also cite the
// FRENCH DATA PROTECTION ACT's own article numbers (e.g. "Article 66 of the French Data Protection
// Act"), which are a different statute entirely and must never be relabelled as a GDPR article by
// coincidence of number. An "Article N" whose N is not in the whitelist is silently excluded rather
// than guessed at (Rule 4: fail closed) - a future pass can extend the whitelist once a national
// French-law law_id namespace exists to route non-GDPR "Article N" citations correctly instead.
function lawIdsOf(text) {
  const found = new Set();
  const rx = /Article\s+(\d{1,2})\b/g;
  let m = rx.exec(text);
  while (m) {
    if (ARTICLE_TO_LAW_ID[m[1]]) found.add(ARTICLE_TO_LAW_ID[m[1]]);
    m = rx.exec(text);
  }
  return found.size > 0 ? [...found] : ['EU_GDPR_ART_5'];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoDateOf(day, month, year) {
  const mm = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  return `${year}-${mm}-${String(day).padStart(2, '0')}`;
}

const SINGLE_ENTITY_RX = /On (\d{1,2})\s*(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4}),\s*([A-Z][A-Z0-9 .&'’-]*?)\s+was fined\s*€\s*([\d.,]+)\s*(million|thousand)?/;
const COMBINED_ENTITY_RX = /On (\d{1,2})\s*(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4}),\s*the CNIL issued\s+(?:two|\w+)?\s*sanction decisions? against\s+([^,]+),\s*imposing fines? of\s*€\s*([\d.,]+)\s*(million|thousand)?\s*and\s*€\s*([\d.,]+)\s*(million|thousand)?\s*respectively/i;

function amountOf(raw, unit) {
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (unit === 'million') return n * 1_000_000;
  if (unit === 'thousand') return n * 1_000;
  return n;
}

function parseSingleEntity(text, ctx) {
  const m = SINGLE_ENTITY_RX.exec(text);
  if (!m) return null;
  const amount = amountOf(m[5], m[6]);
  if (amount === null) return null;
  return {
    id: `CNIL-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: 'FR',
    law_ids: lawIdsOf(text),
    entity_name: m[4].trim(),
    offending_quote: null,
    decision_date: isoDateOf(Number(m[1]), m[2], m[3]),
    penalty_amount: amount,
    currency: 'EUR',
    url: ctx.url,
    sha256: ctx.sha256,
    summary: `CNIL fined ${m[4].trim()} €${m[5]} ${m[6] || ''}`.trim() + '.',
  };
}

function parseCombinedEntity(text, ctx) {
  const m = COMBINED_ENTITY_RX.exec(text);
  if (!m) return null;
  const amountA = amountOf(m[5], m[6]);
  const amountB = amountOf(m[7], m[8]);
  if (amountA === null || amountB === null) return null;
  const entities = m[4].trim();
  return {
    id: `CNIL-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: 'FR',
    law_ids: lawIdsOf(text),
    entity_name: entities,
    offending_quote: null,
    decision_date: isoDateOf(Number(m[1]), m[2], m[3]),
    penalty_amount: amountA + amountB,
    currency: 'EUR',
    url: ctx.url,
    sha256: ctx.sha256,
    summary: `CNIL issued combined sanction decisions against ${entities} totalling €${((amountA + amountB) / 1_000_000).toLocaleString('en-GB')} million.`,
  };
}

function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const row = parseSingleEntity(text, ctx) || parseCombinedEntity(text, ctx);
  return row ? [row] : [];
}

function collect(opts = {}) {
  return collectFromSource({ source: SOURCE, url: opts.url || ARCHIVE_URL, deadlineMs: opts.deadlineMs, fetchImpl: opts.fetchImpl, parse });
}

module.exports = { SOURCE, REGULATOR, ARCHIVE_URL, parse, collect, ARTICLE_TO_LAW_ID };
