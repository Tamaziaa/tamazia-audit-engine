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

// robotsBlocks(robotsTxt) -> fullBlock(uaLower) predicate. Ported line-for-line from the old estate's
// UA-group parser: most-specific matching group wins, falling back to '*'.
function robotsBlocks(robotsTxt) {
  const lines = String(robotsTxt || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups = []; let cur = null;
  for (const l of lines) {
    const mUA = l.match(/^user-agent:\s*(.+)$/i);
    const mDis = l.match(/^disallow:\s*(.*)$/i);
    if (mUA) { if (!cur || cur.hasRule) { cur = { agents: [], dis: [], hasRule: false }; groups.push(cur); } cur.agents.push(mUA[1].trim().toLowerCase()); }
    else if (mDis && cur) { cur.hasRule = true; cur.dis.push(mDis[1].trim()); }
  }
  return {
    fullBlock: (uaLower) => {
      const g = groups.find((x) => x.agents.includes(uaLower)) || groups.find((x) => x.agents.includes('*'));
      return !!g && g.dis.includes('/');
    },
  };
}

async function getText(domain, path, deadlineMs) {
  const r = await fetchDeadlined('https://' + domain + path, { deadlineMs: deadlineMs || 10000 });
  return r.ok ? r.text : null;
}

// wikidataEntity(name) -> { checked, present, qid? }. Faithful port of the old estate's `wikidataEntity`
// two-step search-then-claims lookup for an official-website (P856) claim matching the domain.
async function wikidataEntity(name, domain) {
  if (!name) return { checked: false, present: false };
  const su = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=' + encodeURIComponent(name);
  const sr = await fetchJson(su, { deadlineMs: 8000 });
  if (!sr.ok) return { checked: false, present: false };
  const ids = ((sr.json && sr.json.search) || []).map((x) => x.id).filter(Boolean).slice(0, 7);
  if (!ids.length) return { checked: true, present: false };
  const gu = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=' + ids.join('|');
  const gr = await fetchJson(gu, { deadlineMs: 8000 });
  if (!gr.ok) return { checked: false, present: false };
  const ents = (gr.json && gr.json.entities) || {};
  const dom = cleanDomain(domain);
  for (const qid of ids) {
    const p856 = ents[qid] && ents[qid].claims && ents[qid].claims.P856;
    if (!p856) continue;
    for (const c of p856) {
      const url = String((((c.mainsnak || {}).datavalue || {}).value) || '');
      if (cleanDomain(url) === dom) return { checked: true, present: true, qid };
    }
  }
  return { checked: true, present: false };
}

// aiReadinessProbe({domain, company, corpus, env}) -> { ok:true, score, blocked_ai_bots, has_llms_txt,
// has_org_schema, has_same_as, in_wikidata, has_localbusiness, has_service, has_faq } | { ok:false, reason }.
async function aiReadinessProbe({ domain, company, corpus } = {}) {
  const dom = cleanDomain(domain);
  if (!dom) return { ok: false, reason: 'no_domain' };
  let score = 100;
  const [robots, llms] = await Promise.all([getText(dom, '/robots.txt'), getText(dom, '/llms.txt')]);
  const blockedBots = [];
  if (robots != null) {
    const { fullBlock } = robotsBlocks(robots);
    for (const b of AI_BOTS) if (fullBlock(b.ua.toLowerCase())) blockedBots.push(b);
  }
  if (blockedBots.length) score -= Math.min(40, blockedBots.length * 8);
  const hasLlms = !!(llms && llms.length > 20);
  if (!hasLlms) score -= 8;

  const pages = (corpus && Array.isArray(corpus.pages)) ? corpus.pages : [];
  const dPages = pages.filter((p) => cleanDomain(p && p.url) === dom);
  const home = dPages[0] || pages[0] || null;
  const jsonLd = home ? home.jsonLd : null;
  const hasOrg = jsonLdHasType(jsonLd, /Organization|LocalBusiness|LegalService|MedicalBusiness|ProfessionalService|Corporation/i);
  const hasLocalBusiness = jsonLdHasType(jsonLd, /LocalBusiness|LegalService|MedicalBusiness|Dentist|ProfessionalService/i);
  const hasService = jsonLdHasType(jsonLd, /Service|Offer|Product|OfferCatalog/i);
  const hasFaq = jsonLdHasType(jsonLd, /FAQPage|QAPage/i);
  const hasSameAs = JSON.stringify(jsonLd || {}).includes('"sameAs"');
  if (!hasOrg) score -= 15;
  if (!hasSameAs) score -= 8;

  const wikidata = await wikidataEntity(company, dom).catch(() => ({ checked: false, present: false }));
  if (!wikidata.present) score -= 12;

  score = Math.max(0, Math.min(100, score));
  return {
    ok: true, score, blocked_ai_bots: blockedBots.map((b) => b.ua), has_llms_txt: hasLlms,
    has_org_schema: hasOrg, has_same_as: hasSameAs, in_wikidata: !!wikidata.present,
    has_localbusiness: hasLocalBusiness, has_service: hasService, has_faq: hasFaq,
  };
}

module.exports = { aiReadinessProbe, robotsBlocks, wikidataEntity, AI_BOTS };
