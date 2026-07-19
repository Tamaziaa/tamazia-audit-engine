'use strict';
// probes/ai-readiness.js - deterministic, zero-key AI/entity-readiness probe. Faithful port of the old
// estate's producer: cowork-os-fresh src/lib/audit/ai-readiness.js `aiReadiness`. Measures whether AI
// answer engines CAN find, crawl, trust and cite the firm: robots.txt AI-crawler access (GPTBot/
// ClaudeBot/PerplexityBot/Google-Extended/CCBot/...), llms.txt presence, Organization/LocalBusiness
// entity schema + sameAs, and a Wikidata knowledge-graph anchor. No API key required anywhere in this
// probe (Rule 10: this is the one GEO signal that never abstains for want of a key).

const { fetchDeadlined, fetchJson, cleanDomain } = require('./lib/net.js');
const { jsonLdHasType } = require('./onpage-signals.js');

const AI_BOTS = [
  { ua: 'GPTBot', engine: 'ChatGPT (OpenAI)' }, { ua: 'OAI-SearchBot', engine: 'ChatGPT Search' },
  { ua: 'ChatGPT-User', engine: 'ChatGPT browsing' }, { ua: 'Google-Extended', engine: 'Gemini / AI Overviews' },
  { ua: 'ClaudeBot', engine: 'Claude' }, { ua: 'anthropic-ai', engine: 'Claude (legacy)' },
  { ua: 'PerplexityBot', engine: 'Perplexity' }, { ua: 'CCBot', engine: 'Common Crawl (feeds most LLMs)' },
  { ua: 'Bytespider', engine: 'TikTok / Doubao' }, { ua: 'Applebot-Extended', engine: 'Apple Intelligence' },
];

// applyRobotsLine(line, state) -> mutates state.groups/state.cur for one parsed robots.txt line. A
// user-agent line opens a new group whenever the current one already saw a rule (a fresh UA block);
// a disallow line attaches to whatever group is currently open. Same precedence as the original
// if/else-if chain: a line cannot be both, so a UA match always short-circuits the disallow check.
function applyRobotsLine(line, state) {
  const mUA = line.match(/^user-agent:\s*(.+)$/i);
  if (mUA) {
    if (!state.cur || state.cur.hasRule) { state.cur = { agents: [], dis: [], hasRule: false }; state.groups.push(state.cur); }
    state.cur.agents.push(mUA[1].trim().toLowerCase());
    return;
  }
  const mDis = line.match(/^disallow:\s*(.*)$/i);
  if (mDis && state.cur) { state.cur.hasRule = true; state.cur.dis.push(mDis[1].trim()); }
}

// parseRobotsGroups(robotsTxt) -> the UA groups (agents[] + dis[] per group), most-specific-wins order
// preserved for the caller to search.
function parseRobotsGroups(robotsTxt) {
  const lines = String(robotsTxt || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const state = { groups: [], cur: null };
  for (const l of lines) applyRobotsLine(l, state);
  return state.groups;
}

function findRobotsGroup(groups, uaLower) {
  return groups.find((x) => x.agents.includes(uaLower)) || groups.find((x) => x.agents.includes('*'));
}

function groupFullyBlocks(group) { return !!group && group.dis.includes('/'); }

// robotsBlocks(robotsTxt) -> fullBlock(uaLower) predicate. Ported line-for-line from the old estate's
// UA-group parser: most-specific matching group wins, falling back to '*'.
function robotsBlocks(robotsTxt) {
  const groups = parseRobotsGroups(robotsTxt);
  return { fullBlock: (uaLower) => groupFullyBlocks(findRobotsGroup(groups, uaLower)) };
}

async function getText(domain, path, deadlineMs) {
  const r = await fetchDeadlined('https://' + domain + path, { deadlineMs: deadlineMs || 10000 });
  return r.ok ? r.text : null;
}

// wikidataSearchIds(name) -> the candidate Wikidata QIDs for `name`, or null when the search call
// itself failed (distinct from "searched, found nothing").
async function wikidataSearchIds(name) {
  const su = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=' + encodeURIComponent(name);
  const sr = await fetchJson(su, { deadlineMs: 8000 });
  if (!sr.ok) return null;
  return ((sr.json && sr.json.search) || []).map((x) => x.id).filter(Boolean).slice(0, 7);
}

// wikidataClaimsFor(ids) -> the {qid: entity} claims map for the given QIDs, or null on a failed call.
async function wikidataClaimsFor(ids) {
  const gu = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=' + ids.join('|');
  const gr = await fetchJson(gu, { deadlineMs: 8000 });
  if (!gr.ok) return null;
  return (gr.json && gr.json.entities) || {};
}

// entityHasOfficialSite(entity, dom) -> true when the entity's P856 (official website) claims include
// a URL matching `dom`.
function entityHasOfficialSite(entity, dom) {
  const p856 = entity && entity.claims && entity.claims.P856;
  if (!p856) return false;
  return p856.some((c) => cleanDomain(String((((c.mainsnak || {}).datavalue || {}).value) || '')) === dom);
}

function findMatchingQid(ents, ids, dom) {
  return ids.find((qid) => entityHasOfficialSite(ents[qid], dom)) || null;
}

// wikidataEntity(name) -> { checked, present, qid? }. Faithful port of the old estate's `wikidataEntity`
// two-step search-then-claims lookup for an official-website (P856) claim matching the domain.
async function wikidataEntity(name, domain) {
  if (!name) return { checked: false, present: false };
  const ids = await wikidataSearchIds(name);
  if (ids === null) return { checked: false, present: false };
  if (!ids.length) return { checked: true, present: false };
  const ents = await wikidataClaimsFor(ids);
  if (ents === null) return { checked: false, present: false };
  const qid = findMatchingQid(ents, ids, cleanDomain(domain));
  return qid ? { checked: true, present: true, qid } : { checked: true, present: false };
}

// detectBlockedBots(robots) -> the AI_BOTS entries robots.txt fully disallows; [] when robots.txt was
// unreadable (an unreadable file is never treated as a block - honesty over pessimism).
function detectBlockedBots(robots) {
  if (robots == null) return [];
  const { fullBlock } = robotsBlocks(robots);
  return AI_BOTS.filter((b) => fullBlock(b.ua.toLowerCase()));
}

// homePageJsonLd(corpus, dom) -> the parsed jsonLd for the crawled homepage (or the first crawled page
// as a fallback), or null when the corpus carries nothing for this domain.
function homePageJsonLd(corpus, dom) {
  const pages = (corpus && Array.isArray(corpus.pages)) ? corpus.pages : [];
  const dPages = pages.filter((p) => cleanDomain(p && p.url) === dom);
  const home = dPages[0] || pages[0] || null;
  return home ? home.jsonLd : null;
}

// entitySignals(jsonLd) -> the schema-derived booleans this probe scores on, read straight off the
// corpus's already-parsed jsonLd (Rule 1: no second parse of raw markup).
function entitySignals(jsonLd) {
  return {
    hasOrg: jsonLdHasType(jsonLd, /Organization|LocalBusiness|LegalService|MedicalBusiness|ProfessionalService|Corporation/i),
    hasLocalBusiness: jsonLdHasType(jsonLd, /LocalBusiness|LegalService|MedicalBusiness|Dentist|ProfessionalService/i),
    hasService: jsonLdHasType(jsonLd, /Service|Offer|Product|OfferCatalog/i),
    hasFaq: jsonLdHasType(jsonLd, /FAQPage|QAPage/i),
    hasSameAs: JSON.stringify(jsonLd || {}).includes('"sameAs"'),
  };
}

// scoreReadiness(signals) -> the clamped 0-100 score, same weighting and order as the original
// deduction sequence.
function scoreReadiness({ blockedBots, hasLlms, hasOrg, hasSameAs, wikidataPresent }) {
  let score = 100;
  if (blockedBots.length) score -= Math.min(40, blockedBots.length * 8);
  if (!hasLlms) score -= 8;
  if (!hasOrg) score -= 15;
  if (!hasSameAs) score -= 8;
  if (!wikidataPresent) score -= 12;
  return Math.max(0, Math.min(100, score));
}

// aiReadinessProbe({domain, company, corpus, env}) -> { ok:true, score, blocked_ai_bots, has_llms_txt,
// has_org_schema, has_same_as, in_wikidata, has_localbusiness, has_service, has_faq } | { ok:false, reason }.
async function aiReadinessProbe({ domain, company, corpus } = {}) {
  const dom = cleanDomain(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  const [robots, llms] = await Promise.all([getText(dom, '/robots.txt'), getText(dom, '/llms.txt')]);
  const blockedBots = detectBlockedBots(robots);
  const hasLlms = !!(llms && llms.length > 20);

  const jsonLd = homePageJsonLd(corpus, dom);
  const { hasOrg, hasLocalBusiness, hasService, hasFaq, hasSameAs } = entitySignals(jsonLd);

  const wikidata = await wikidataEntity(company, dom).catch(() => ({ checked: false, present: false }));
  const score = scoreReadiness({ blockedBots, hasLlms, hasOrg, hasSameAs, wikidataPresent: !!wikidata.present });

  return {
    ok: true, score, blocked_ai_bots: blockedBots.map((b) => b.ua), has_llms_txt: hasLlms,
    has_org_schema: hasOrg, has_same_as: hasSameAs, in_wikidata: !!wikidata.present,
    has_localbusiness: hasLocalBusiness, has_service: hasService, has_faq: hasFaq,
  };
}

module.exports = { aiReadinessProbe, robotsBlocks, wikidataEntity, AI_BOTS };
