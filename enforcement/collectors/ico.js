'use strict';
// enforcement/collectors/ico.js - the ICO (UK Information Commissioner's Office) enforcement-action
// collector. Parses one enforcement action detail page (the format every ico.org.uk/action-weve-
// taken/enforcement/<year>/<month>/<slug>/ page shares as of 2026-07: an H1 with the organisation
// name, then a "Date / Type / Sector" label block, then narrative body text naming the UK GDPR
// article(s) or PECR regulation(s) breached and, for monetary penalties, the exact fine figure).
//
// This is the primary source for penalty-precedent ranges (blueprint B5): every ICO monetary
// penalty page states the exact fine and the exact statutory article/regulation it was imposed
// under, in the regulator's own words.

const { stripHtmlToText } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');
const { JURISDICTIONS } = require('../../facts/vocabulary');

const SOURCE = 'ICO';
const REGULATOR = "Information Commissioner's Office";
const ARCHIVE_URL = 'https://ico.org.uk/action-weve-taken/enforcement/';

// UK_JURISDICTION: sourced from facts/vocabulary.js's canonical jurisdiction code list rather than a
// bare re-typed string literal (enforcement/ is a documented co-door for the jurisdiction fact, but
// ONLY for the vocabulary primitives facts/vocabulary.js owns - tools/one-door/facts.json). Fails
// fast at load time if the vocabulary ever drops the UK code.
const UK_JURISDICTION = 'UK';
if (!Object.prototype.hasOwnProperty.call(JURISDICTIONS, UK_JURISDICTION)) {
  throw new Error('facts/vocabulary.js JURISDICTIONS no longer defines UK');
}

// ARTICLE_TO_LAW_ID: maps a cited UK GDPR article (base number only - see baseArticleNumber below)
// to a law_id. UK GDPR articles do not yet have per-article catalogue records (only
// UK_GDPR_PRIVACY_NOTICE / UK_GDPR_SAAS / UK_GDPR_INTERNATIONAL_TRANSFER exist today), so this
// deliberately uses statute-shaped ids (UK_GDPR_ART_n) that a future catalogue-authoring pass can
// promote 1:1 - the existing PECR catalogue records are reused directly where the match is exact.
const ARTICLE_TO_LAW_ID = {
  '5': 'UK_GDPR_ART_5',
  '6': 'UK_GDPR_ART_6',
  '8': 'UK_GDPR_ART_8',
  '32': 'UK_GDPR_ART_32',
  '35': 'UK_GDPR_ART_35',
};
const PECR_REG_TO_LAW_ID = {
  '21': 'UK_PECR_EMARKETING',
  '22': 'UK_PECR_EMARKETING',
  '23': 'UK_PECR_EMARKETING',
  '24': 'UK_PECR_EMARKETING',
  '6': 'UK_PECR_COOKIES_MARKETING',
};

// baseArticleNumber(token) -> the leading integer of an article citation, stripping any
// subsection/paragraph suffix ("6(1)(a)" -> "6"). ICO pages cite the same article both in a summary
// list ("Articles 5(1)(a), 6, 8 and 35") and again in narrative prose with its subsection spelled
// out ("Article 6(1)(a) UK GDPR (consent) lawful basis"); normalising to the base number before
// mapping avoids emitting two distinct law_ids for what is legally the same article.
function baseArticleNumber(token) {
  const m = /^(\d{1,2})/.exec(token);
  return m ? m[1] : token;
}

function articlesOf(text) {
  const found = new Set();
  const rx = /Article[s]?\s+((?:\d{1,2}(?:\(\d+\))?(?:\(\w+\))?)(?:,\s*(?:and\s*)?(?:\d{1,2}(?:\(\d+\))?(?:\(\w+\))?))*)/g;
  let m = rx.exec(text);
  while (m) {
    for (const piece of m[1].split(/,\s*(?:and\s*)?/)) found.add(baseArticleNumber(piece.trim()));
    m = rx.exec(text);
  }
  return [...found];
}
function pecrRegsOf(text) {
  const found = new Set();
  // Matches both "regulation 21 of PECR" and "regulations 22 and 23 of PECR" (ICO commonly cites
  // multiple PECR regulations joined by "and" or "," before the trailing "of PECR").
  const rx = /regulation[s]?\s+((?:\d{1,2}(?:\(\d+\)(?:\(\w+\))?)?)(?:\s*(?:,|and)\s*\d{1,2}(?:\(\d+\)(?:\(\w+\))?)?)*)\s+of\s+PECR/gi;
  let m = rx.exec(text);
  while (m) {
    for (const piece of m[1].split(/\s*(?:,|and)\s*/)) {
      const cleaned = piece.trim();
      if (cleaned) found.add(baseArticleNumber(cleaned));
    }
    m = rx.exec(text);
  }
  return [...found];
}

// lawIdsOf(text) -> law_id[]. Every id here is anchored to an article/regulation number ACTUALLY
// cited in the page text (Rule 3: no artifact, no breach); an empty result means the page cited none
// and the caller (parse()) treats that the same as a structurally-drifted page, never guessing a
// citation the page never made.
function lawIdsOf(text) {
  const ids = new Set();
  for (const article of articlesOf(text)) ids.add(ARTICLE_TO_LAW_ID[article] || `UK_GDPR_ART_${article.replace(/[()]/g, '_')}`);
  for (const reg of pecrRegsOf(text)) ids.add(PECR_REG_TO_LAW_ID[reg] || 'UK_PECR_EMARKETING');
  return [...ids];
}

const DATE_LINE_RX = /\nDate\s*\n?\s*(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// PENALTY_RX: anchors the £ amount to one of the three ways ICO pages actually phrase the CONFIRMED
// penalty ("<Article/PECR> ... issued a monetary penalty of £X", "imposed a fine of £X on <Entity>",
// "was fined £X for ...", "£X penalty imposed on <Entity>") - never the first £ figure anywhere on
// the page. MediaLab.AI's real fixture states the final £247,590 this way BEFORE narrating the
// £393,000 originally "proposed" in the NOI; "proposed" carries none of these anchor words, so an
// earlier-proposed or otherwise unrelated amount cannot populate penalty_amount.
const PENALTY_RX = /(?:(?:penalty|fine)\s+of\s+£\s?([\d,]+(?:\.\d{2})?)|fined\s+£\s?([\d,]+(?:\.\d{2})?)|£\s?([\d,]+(?:\.\d{2})?)\s+penalty\b)/i;

function isoDateOf(day, month, year) {
  const mm = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  return `${year}-${mm}-${String(day).padStart(2, '0')}`;
}

// entityNameOf(text) -> the ICO page's own H1, which repeats the organisation name (the "Action
// we've taken / Enforcement action / <Entity> / <Entity>" structural pair every page shares). No
// fallback: a page whose structure does not repeat the name is treated as drifted (null), never fed
// an unverified single line that could be a label or breadcrumb fragment into a client-visible field.
//
// The repeat is anchored with a lookahead for newline-or-end (never `\b`): a `\b` word-boundary check
// immediately after the backreference fails whenever the entity name ends in punctuation ("Reddit,
// Inc.", "MediaLab.AI, Inc." - the period before the following `\n` is non-word-to-non-word, so `\b`
// never matches there), which would silently reject two of this collector's own real fixtures.
function entityNameOf(text) {
  const m = /Enforcement action\s*\n\s*([^\n]+)\n\s*\1(?=\n|$)/.exec(text);
  return m ? m[1].trim() : null;
}

function penaltyOf(text) {
  const m = PENALTY_RX.exec(text);
  if (!m) return { amount: null, currency: null };
  const raw = m[1] || m[2] || m[3];
  const amount = Number(raw.replace(/,/g, ''));
  return Number.isFinite(amount) ? { amount, currency: 'GBP' } : { amount: null, currency: null };
}

function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const entity = entityNameOf(text);
  const dateMatch = DATE_LINE_RX.exec(text);
  if (!entity || !dateMatch) return [];

  const decisionDate = isoDateOf(Number(dateMatch[1]), dateMatch[2], dateMatch[3]);
  const { amount, currency } = penaltyOf(text);
  const lawIds = lawIdsOf(text);
  // No article/PECR regulation citation found: the same fail-closed path as a structurally drifted
  // page (Rule 3 - no artifact, no breach; never emit a row asserting a statutory citation the page
  // never actually made).
  if (lawIds.length === 0) return [];

  const row = {
    id: `ICO-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: REGULATOR,
    jurisdiction: UK_JURISDICTION,
    law_ids: lawIds,
    entity_name: entity,
    offending_quote: null, // ICO enforcement pages narrate conduct; they do not quote verbatim page copy
    decision_date: decisionDate,
    penalty_amount: amount,
    currency,
    url: ctx.url,
    sha256: ctx.sha256,
    summary: buildSummary(entity, amount, lawIds),
  };
  return [row];
}

function buildSummary(entity, amount, lawIds) {
  const penaltyPart = amount ? `a penalty of £${amount.toLocaleString('en-GB')}` : 'enforcement action';
  return `ICO imposed ${penaltyPart} on ${entity} (${lawIds.join(', ')}).`;
}

function collect(opts = {}) {
  return collectFromSource({ source: SOURCE, url: opts.url || ARCHIVE_URL, deadlineMs: opts.deadlineMs, fetchImpl: opts.fetchImpl, parse });
}

module.exports = { SOURCE, REGULATOR, ARCHIVE_URL, parse, collect, ARTICLE_TO_LAW_ID, PECR_REG_TO_LAW_ID };
