'use strict';
// enforcement/collectors/gdprhub.js - the GDPRhub (noyb) DPA-decision-summary collector.
//
// LIVE FETCH STATUS (2026-07-20): gdprhub.eu serves every request this session behind Anubis
// (a proof-of-work anti-bot challenge requiring JavaScript execution) - a genuine, verified block,
// not a code defect (see this workstream's PR report for the attempt log; a Wayback Machine lookup
// for the same page also failed). The parser below is built and tested against a SYNTHETIC fixture
// (fixtures/gdprhub/synthetic-decision.html) modelled on GDPRhub's own documented decision-summary
// format (a decision infobox naming the DPA, the country, the fine, and the GDPR article(s) held
// infringed - GDPRhub's own public "Decisions" template, https://gdprhub.eu). The synthetic fixture
// uses a clearly fictional entity name so it cannot be mistaken for a real case; NO row derived from
// it is written to the committed seed store. This collector is committed collect-ready: once the
// Anubis challenge is solvable in an automated context (a headless-browser lane, out of scope for
// this workstream) or a mirror becomes reachable, pointing fetchImpl/url at a live page requires no
// code change.

const { stripHtmlToText } = require('./lib/text');
const { collectFromSource } = require('./lib/framework');

const SOURCE = 'GDPRHUB';
const REGULATOR_PREFIX = 'DPA decision summarised by GDPRhub';
const ARCHIVE_URL = 'https://gdprhub.eu/index.php?title=Category:DPA_Decision';

const ARTICLE_TO_LAW_ID = {
  '5': 'EU_GDPR_ART_5',
  '6': 'EU_GDPR_ART_6',
  '13': 'EU_GDPR_ART_13',
  '17': 'EU_GDPR_ART_17',
  '32': 'EU_GDPR_ART_32',
};

const DPA_RX = /DPA:\s*([^\n]+)/;
const COUNTRY_RX = /Country:\s*([^\n]+)/;
const FINE_RX = /Fine:\s*€\s*([\d.,]+)/;
const DATE_RX = /Decided:\s*(\d{4})-(\d{2})-(\d{2})/;
const PARTY_RX = /Party:\s*([^\n]+)/;
const ARTICLE_RX = /Article\s*(\d{1,2})/g;

function lawIdsOf(text) {
  const found = new Set();
  let m = ARTICLE_RX.exec(text);
  while (m) {
    found.add(ARTICLE_TO_LAW_ID[m[1]] || `EU_GDPR_ART_${m[1]}`);
    m = ARTICLE_RX.exec(text);
  }
  return found.size > 0 ? [...found] : ['EU_GDPR_ART_5'];
}

// missingRequiredGdprhubFields(fields) -> boolean. True when any one of the five infobox fields the
// synthetic-decision template carries (DPA, country, fine, date, party) failed to match - a page
// missing any one of them fails closed to zero rows.
function missingRequiredGdprhubFields(fields) {
  if (!fields.dpaMatch) return true;
  if (!fields.countryMatch) return true;
  if (!fields.fineMatch) return true;
  if (!fields.dateMatch) return true;
  return !fields.partyMatch;
}

function parse(html, ctx) {
  const text = stripHtmlToText(html);
  const dpaMatch = DPA_RX.exec(text);
  const countryMatch = COUNTRY_RX.exec(text);
  const fineMatch = FINE_RX.exec(text);
  const dateMatch = DATE_RX.exec(text);
  const partyMatch = PARTY_RX.exec(text);
  if (missingRequiredGdprhubFields({ dpaMatch, countryMatch, fineMatch, dateMatch, partyMatch })) return [];

  const amount = Number(fineMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return [];

  const row = {
    id: `GDPRHUB-${ctx.sha256.slice(0, 12)}`,
    source: SOURCE,
    regulator: `${REGULATOR_PREFIX} (${dpaMatch[1].trim()})`,
    jurisdiction: countryMatch[1].trim(),
    law_ids: lawIdsOf(text),
    entity_name: partyMatch[1].trim(),
    offending_quote: null,
    decision_date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
    penalty_amount: amount,
    currency: 'EUR',
    url: ctx.url,
    sha256: ctx.sha256,
    summary: `${dpaMatch[1].trim()} fined ${partyMatch[1].trim()} €${fineMatch[1]} (summarised by GDPRhub).`,
  };
  return [row];
}

function collect(opts = {}) {
  return collectFromSource({ source: SOURCE, url: opts.url || ARCHIVE_URL, deadlineMs: opts.deadlineMs, fetchImpl: opts.fetchImpl, parse });
}

module.exports = { SOURCE, ARCHIVE_URL, parse, collect, ARTICLE_TO_LAW_ID };
