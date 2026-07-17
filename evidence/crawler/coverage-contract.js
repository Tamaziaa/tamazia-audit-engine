'use strict';
/**
 * coverage-contract.js - coverage as BLOCKING DATA, not reporting theatre (caution.md C-029).
 *
 * The reconciliation gate used to check "was the site reachable", not "did we read the page the rule
 * needs", so absence rules fired on pages nobody read. Here every catalogue rule declares the page-class
 * its website obligations need, and coverageFor() answers per rule: `covered` (that class was crawled) or
 * `screened` (it was not; NEVER a breach input). Wave-2 treats `screened` as a HARD BLOCK: no screened
 * rule may become a breach.
 *
 * classify() (caution.md C-044) matches PATH SEGMENTS with anchored tokens, never loose substrings, so
 * /feedback does not credit 'fees', /cost-of-living does not credit 'pricing', /returning-customers does
 * not credit 'returns'. Pure and deterministic: no network, no clock, no env.
 *
 * The absence-demotion interlock (caution.md C-024/C-033): a rule whose evidence would be an ABSENCE claim
 * is demoted to `screened` (needs-review) when the corpus was truncated, and any page-class that exists
 * only inside an unparsed document (evidence/documents 'no-parser') is treated as NOT covered.
 */

const BASE_REQUIRED = ['homepage', 'privacy'];
const SECTOR_REQUIRED = {
  'law-firms': ['complaints', 'pricing'], barristers: ['complaints'], finance: ['terms'],
  insurance: ['terms'], ecommerce: ['terms', 'returns'], retail: ['terms'],
  healthcare: ['privacy'], 'real-estate': ['fees'],
};

function requiredClasses(sector) {
  const extra = SECTOR_REQUIRED[String(sector || '').toLowerCase()] || [];
  return [...new Set([...BASE_REQUIRED, ...extra])];
}

// pagePath(page) -> the normalised path segment (leading slash, query/fragment stripped, lowercased) of a
// page object ({url}|{type}) or bare string. Classification anchors on PATH tokens, never the host.
function pagePath(page) {
  const raw = String((page && (page.url || page.type || page)) || '').toLowerCase();
  const path = raw.replace(/^https?:\/\/[^/]+/, '');
  return '/' + path.replace(/[?#].*$/, '').replace(/^\/+/, '');
}

// classify(page) -> the page-class of a fetched URL by PATH SEGMENT with anchored tokens (C-044). Accepts
// a page object ({url}|{type}) or a bare string.
function classify(page) {
  const seg = pagePath(page);
  const has = (re) => re.test(seg);
  if (has(/\b(privacy|data[-_ ]?protection|gdpr|cookie)\b/)) return 'privacy';
  if (has(/\b(complaints?|ombudsman)\b/)) return 'complaints';
  if (has(/\bfees?\b/)) return 'fees';
  if (has(/\b(pricing|prices?|tariff|cost[-_ ]?(of[-_ ]?service|guide|schedule)?|charges)\b/) && !/\bcost[-_ ]?of[-_ ]?living\b/.test(seg)) return 'pricing';
  if (has(/\b(terms|t-and-c|conditions)\b/)) return 'terms';
  if (has(/\b(returns?|refunds?)\b/)) return 'returns';
  if (/^\/?$/.test(seg) || has(/\b(home|index)\b/)) return 'homepage';
  return 'other';
}

// fetchedClassSet(crawledPages) -> the Set of page-classes present in the crawl. The homepage counts as
// present whenever ANY page was read (you always land somewhere), and 'any' is the general-corpus class.
function fetchedClassSet(crawledPages) {
  const set = new Set((crawledPages || []).map(classify));
  if ((crawledPages || []).length) { set.add('homepage'); set.add('any'); }
  return set;
}

// computeCoverage(crawledPages, sector, opts) -> site-level tri-state: 'assessable' (enough required
// classes) or 'screened' (too little coverage -> not-assessed, never a breach on unread content).
function computeCoverage(crawledPages, sector, opts = {}) {
  const required = requiredClasses(sector);
  const fetched = fetchedClassSet(crawledPages);
  const missing = required.filter((c) => !fetched.has(c));
  const ratio = required.length ? (required.length - missing.length) / required.length : 0;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.5;
  const reachable = (crawledPages || []).length > 0;
  const render_class = (!reachable || ratio < threshold) ? 'screened' : 'assessable';
  return { required, fetched_classes: [...fetched].sort(), missing, ratio: Math.round(ratio * 100) / 100, render_class, reachable };
}

// pageClassForObligation(obligation) -> the crawl page-class an on-page presence/absence duty needs,
// derived from anchored tokens in the duty + element text; 'any' when the duty is a general on-page
// requirement (assessable on the homepage/footer). register/behavioural duties return null (their
// evidence comes from the registers/browser lanes, not the crawl).
function pageClassForObligation(obligation) {
  const et = obligation && obligation.evidence_type;
  if (et !== 'presence' && et !== 'absence') return null;
  const text = ((obligation.duty || '') + ' ' + (obligation.elements || []).join(' ')).toLowerCase();
  if (/\b(privacy|data protection|gdpr|cookie|personal data)\b/.test(text)) return 'privacy';
  if (/\b(complaints?|ombudsman|redress)\b/.test(text)) return 'complaints';
  if (/\bfees?\b/.test(text)) return 'fees';
  if (/\b(pricing|price|tariff|charges|cost of service)\b/.test(text)) return 'pricing';
  if (/\b(terms|conditions)\b/.test(text)) return 'terms';
  if (/\b(returns?|refunds?)\b/.test(text)) return 'returns';
  return 'any';
}

// ruleNeeds(rule) -> { needs: [pageClass...], laneOnly: bool, hasAbsence: bool }. laneOnly means the rule
// has NO on-page text obligation (its evidence is register/behavioural), so the crawl does not gate it.
function ruleNeeds(rule) {
  const obligations = (rule && rule.website_obligations) || [];
  const needs = new Set();
  let hasAbsence = false;
  for (const o of obligations) {
    const cls = pageClassForObligation(o);
    if (cls) needs.add(cls);
    if (o && o.evidence_type === 'absence') hasAbsence = true;
  }
  return { needs: [...needs], laneOnly: needs.size === 0, hasAbsence };
}

// judgeRule(rule, fetched, ctx) -> the per-rule coverage verdict. `ctx` carries the interlock inputs:
// truncated (C-024) and unparsedClasses (C-033).
function judgeRule(rule, fetched, ctx) {
  const { needs, laneOnly, hasAbsence } = ruleNeeds(rule);
  if (laneOnly) return { id: rule.id, state: 'covered', needs: [], missing: [], reason: 'non-crawl-evidence (register/behavioural lane)' };
  const missing = needs.filter((c) => c !== 'any' && !fetched.has(c));
  const reasons = missing.map((c) => (ctx.unparsedClasses.has(c)
    ? 'page-class "' + c + '" lives only in an unparsed document (C-033)'
    : 'missing page-class "' + c + '"'));
  if (ctx.truncated && hasAbsence) reasons.push('absence claim on a truncated corpus demoted to needs-review (C-024)');
  const covered = reasons.length === 0;
  return { id: rule.id, state: covered ? 'covered' : 'screened', needs, missing, reason: covered ? 'all needed page-classes crawled' : reasons.join('; ') };
}

// coverageFor(rules, crawledPages, opts) -> { rules:[{id,state,needs,missing,reason}], summary } where
// state is covered|screened per rule. `opts.truncated` and `opts.unparsedClasses` drive the interlock.
function coverageFor(rules, crawledPages, opts = {}) {
  const fetched = fetchedClassSet(crawledPages);
  const ctx = {
    truncated: Boolean(opts.truncated),
    unparsedClasses: opts.unparsedClasses instanceof Set ? opts.unparsedClasses : new Set(opts.unparsedClasses || []),
  };
  const out = (rules || []).map((r) => judgeRule(r, fetched, ctx));
  const screened = out.filter((r) => r.state === 'screened').length;
  return { rules: out, summary: { total: out.length, covered: out.length - screened, screened } };
}

// isScreened(coverage, ruleId) -> true when wave-2 must NOT emit a breach for this rule (hard block).
function isScreened(coverage, ruleId) {
  const r = coverage && coverage.rules && coverage.rules.find((x) => x.id === ruleId);
  return Boolean(r) && r.state === 'screened';
}

// applyCoverage(findings, coverage) -> drop breach ('miss') findings when the SITE coverage is screened.
function applyCoverage(findings, coverage) {
  if (!coverage || coverage.render_class === 'assessable') return findings || [];
  return (findings || []).filter((f) => f && f.status !== 'miss');
}

module.exports = {
  BASE_REQUIRED, SECTOR_REQUIRED, requiredClasses, classify, pagePath, computeCoverage,
  coverageFor, isScreened, applyCoverage, pageClassForObligation, ruleNeeds,
};
