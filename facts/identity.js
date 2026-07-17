'use strict';
// facts/identity.js - THE single door for the IDENTITY fact (Constitution Rule 1).
//
// This module is the only producer of display_name, legal_name, company_number,
// registered_office and slug. It is a pure function over an EvidenceBundle: it never
// fetches the network, never queries a register, never guesses. Register data arrives
// pre-fetched on bundle.registers; page data arrives on bundle.corpus.
//
// THE LADDER (highest confidence first; the winning rung is recorded in evidence):
//   1. registers.companiesHouse row, corroborated by an on-page identifier
//      (the company number appearing in the corpus, or the register name matching an
//      on-page candidate). Confidence 'register'.
//   2. schema.org Organization / LegalService legalName or name from page jsonLd.
//   3. ogSiteName.
//   4. footer identity block ("(c) X Ltd", "X LLP is authorised and regulated by",
//      company number with context words).
//   5. <title>, split on the site's own separator, marketing tails removed.
//   6. domain stem - always-clean last resort, confidence 'weak'.
// Two or more independent on-page rungs agreeing -> 'corroborated'. A single source
// -> 'weak'. Nothing safe -> 'abstain'. Abstention is a first-class outcome: a missing
// field is fine, a wrong one ends the company (caution C-001, C-002, C-003).
//
// REJECTION (a rejected candidate falls through; it never poisons the result):
//   - generic page furniture (Office, Home, Contact, About, Menu, Price List, Welcome...)
//   - marketing headlines longer than 6 words
//   - strings carrying HTML entity residue (&amp; / &#x27; ...) - these are scrape
//     artefacts, never names; they produced the live "luxury-aesthetic-clinic-for-
//     radiant-skin-amp-body" and "price-list" slugs (caution C-003)
//   - candidates sharing no token with the domain, unless register-corroborated (C-002)
//
// The slug derives ONLY from the resolved display_name, never from a page title.
//
// Vocabulary: word lists come from facts/vocabulary.js (one door for vocabulary).
// If that module is absent at load time (parallel P1 build), a frozen inline fallback
// is used, the source is recorded in VOCABULARY_SOURCE and in every result's notes,
// and the loader throws loudly if vocabulary.js is present but missing a required
// export. Nothing degrades silently.

// ---------------------------------------------------------------------------------
// Vocabulary (one door; guarded loader with recorded fallback)
// ---------------------------------------------------------------------------------
const REQUIRED_VOCABULARY_EXPORTS = [
  'GENERIC_PAGE_TERMS',
  'LEGAL_ENTITY_SUFFIXES',
  'MARKETING_TAIL_TERMS',
  'REGULATED_BY_PHRASES',
  'COMPANY_NUMBER_CONTEXT_TERMS',
  'PUBLIC_SUFFIX_SECOND_LEVEL',
  'TITLE_SMALL_WORDS',
  'KEEP_UPPERCASE_TOKENS',
];

const FALLBACK_VOCABULARY = Object.freeze({
  GENERIC_PAGE_TERMS: Object.freeze([
    'home', 'homepage', 'home page', 'welcome', 'index', 'untitled', 'site', 'website',
    'contact', 'contact us', 'about', 'about us', 'menu', 'blog', 'news', 'our team',
    'team', 'people', 'careers', 'jobs', 'services', 'our services', 'office', 'offices',
    'branch', 'branches', 'location', 'locations', 'price list', 'prices', 'pricing',
    'fees', 'faq', 'faqs', 'gallery', 'testimonials', 'reviews', 'book now',
    'book online', 'shop', 'store', 'search', 'privacy policy', 'terms', 'cookies',
  ]),
  LEGAL_ENTITY_SUFFIXES: Object.freeze([
    'ltd', 'limited', 'llp', 'plc', 'lp', 'llc', 'inc', 'incorporated', 'cic', 'cio',
    'company', 'co', 'partnership', 'pllc', 'gmbh', 'sarl', 'bv', 'pty',
  ]),
  MARKETING_TAIL_TERMS: Object.freeze([
    'solicitors', 'lawyers', 'law firm', 'barristers', 'accountants', 'dentists',
    'clinic', 'specialists', 'experts', 'consultants', 'advisors', 'advisers',
    'official site', 'official website', 'top', 'leading', 'best', 'luxury', 'premier',
    'trusted', 'award-winning', 'award winning', 'no.1', 'no 1', 'number one',
  ]),
  REGULATED_BY_PHRASES: Object.freeze([
    'authorised and regulated by', 'authorized and regulated by', 'regulated by',
    'authorised by', 'licensed by', 'licenced by', 'registered with',
  ]),
  COMPANY_NUMBER_CONTEXT_TERMS: Object.freeze([
    'company number', 'company no', 'company registration', 'registered number',
    'registration number', 'registered in england', 'registered in scotland',
    'registered in wales', 'registered in northern ireland', 'companies house',
    'registered office', 'company reg',
  ]),
  PUBLIC_SUFFIX_SECOND_LEVEL: Object.freeze([
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
    'gov.uk', 'ac.uk', 'com.au', 'co.nz', 'co.za', 'com.sg', 'co.ae', 'com.sa', 'co.in',
  ]),
  TITLE_SMALL_WORDS: Object.freeze([
    'and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'a', 'an', 'by', '&',
  ]),
  KEEP_UPPERCASE_TOKENS: Object.freeze([
    'UK', 'USA', 'US', 'UAE', 'LLP', 'LLC', 'PLC', 'LTD', 'NHS', 'IT', 'HR', 'PR', 'AI',
    'BDO', 'KPMG', 'PWC', 'EY',
  ]),
});

function loadVocabulary() {
  let mod = null;
  try {
    mod = require('./vocabulary');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).indexOf('vocabulary') !== -1) {
      // Typed, recorded absence (never silent): facts/vocabulary.js has not landed in
      // this working tree yet. Use the frozen fallback and say so on every result.
      return { source: 'inline-fallback', lists: FALLBACK_VOCABULARY };
    }
    // A present-but-broken vocabulary module must block, never degrade (Rule 4).
    throw err;
  }
  const missing = REQUIRED_VOCABULARY_EXPORTS.filter(
    (k) => !Array.isArray(mod[k]) || mod[k].length === 0
  );
  if (missing.length) {
    throw new Error(
      'facts/identity.js: facts/vocabulary.js is present but is missing required exports: '
      + missing.join(', ')
      + '. Extend the vocabulary module (one door for word lists); do not inline strings here.'
    );
  }
  const lists = {};
  for (const k of REQUIRED_VOCABULARY_EXPORTS) {
    lists[k] = Object.freeze(mod[k].map((s) => String(s)));
  }
  return { source: 'facts/vocabulary.js', lists: Object.freeze(lists) };
}

const VOCABULARY = loadVocabulary();
const V = VOCABULARY.lists;
const VOCABULARY_SOURCE = VOCABULARY.source;

const CONFIDENCE = Object.freeze({
  REGISTER: 'register',
  CORROBORATED: 'corroborated',
  WEAK: 'weak',
  ABSTAIN: 'abstain',
});

// ---------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------
function tidy(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// Entity residue means the string was scraped, not authored: it is never a name.
// We reject rather than decode (decoding is how "amp" reached a live slug).
const ENTITY_RX = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;
function hasEntityResidue(s) {
  return ENTITY_RX.test(String(s || ''));
}

function wordCount(s) {
  return tidy(s).split(/\s+/).filter(Boolean).length;
}

const PUB2 = new Set(V.PUBLIC_SUFFIX_SECOND_LEVEL.map((x) => x.toLowerCase()));
function domainStem(domain) {
  let d = String(domain || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .split('/')[0].split(':')[0];
  if (!d) return '';
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length >= 3 && PUB2.has(parts.slice(-2).join('.'))) return parts[parts.length - 3];
  return parts[parts.length - 2];
}

const SMALL = new Set(V.TITLE_SMALL_WORDS.map((x) => x.toLowerCase()));
const KEEP_UPPER = new Set(V.KEEP_UPPERCASE_TOKENS.map((x) => x.toUpperCase()));
function titleCase(s) {
  return tidy(s).split(/\s+/).filter(Boolean).map((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (!bare) return w;
    if (KEEP_UPPER.has(bare.toUpperCase())) return w.toUpperCase();
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}

function compact(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

const SUFFIX_BODY = '\\b(?:' + V.LEGAL_ENTITY_SUFFIXES.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b\\.?';
const SUFFIX_RX = new RegExp(SUFFIX_BODY, 'gi');
const SUFFIX_TEST_RX = new RegExp(SUFFIX_BODY, 'i'); // stateless .test()
function stripLegalSuffixes(s) {
  return tidy(String(s || '').replace(SUFFIX_RX, ' '));
}

// Normalised comparison key for name agreement across sources and registers.
function normName(s) {
  return compact(stripLegalSuffixes(String(s || '').replace(/&/g, ' and ')));
}

function nameTokens(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
}
function initialsOf(s) {
  return String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();
}

// A candidate must be tied to the domain: shares a token of 4+ chars with the stem,
// or the compacted forms contain one another (short real names: "BDO" / bdo.co.uk),
// or its initials are the stem (acronym sites). Register-corroborated names are exempt.
function sharesTokenWithDomain(candidate, domain) {
  const stem = compact(domainStem(domain));
  if (!stem) return true; // no domain to check against -> do not reject on this rule
  const cand = compact(stripLegalSuffixes(candidate));
  if (!cand) return false;
  if (stem.includes(cand) || cand.includes(stem)) return true;
  if (cand.length >= 3 && initialsOf(candidate) === stem) return true;
  return nameTokens(stripLegalSuffixes(candidate)).some((t) => stem.includes(t));
}

const GENERIC_TERMS = new Set(
  V.GENERIC_PAGE_TERMS.concat(V.MARKETING_TAIL_TERMS).map((x) => x.toLowerCase())
);
function isGenericTerm(s) {
  let t = tidy(s).toLowerCase().replace(/^(?:the|our|my)\s+/, '');
  t = t.replace(/\s+/g, ' ');
  if (GENERIC_TERMS.has(t)) return true;
  // "<word> office" / "<word> branch" is page furniture, not a firm (the "Bristol
  // Office" live defect, caution C-002).
  if (/^[a-z]+\s+(?:office|branch)$/.test(t)) return true;
  return false;
}

// Starts with a superlative marketing opener ("Top London Law Firm", "Luxury ...").
const MARKETING_OPENER_RX = new RegExp(
  '^(?:' + V.MARKETING_TAIL_TERMS
    .filter((x) => x.split(' ').length <= 2)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);

const MAX_DISPLAY_NAME_WORDS = 6;

// null when the candidate is acceptable, else the reason it was rejected.
function rejectReason(candidate, domain, opts) {
  const fromRegister = Boolean(opts && opts.fromRegister);
  const v = tidy(candidate);
  if (!v) return 'empty';
  if (v.length < 2) return 'too_short';
  if (v.length > 120) return 'too_long';
  if (hasEntityResidue(v)) return 'html_entity_residue';
  if (!fromRegister) {
    if (isGenericTerm(v)) return 'generic_page_furniture';
    if (wordCount(v) > MAX_DISPLAY_NAME_WORDS) return 'marketing_headline_too_long';
    if (!sharesTokenWithDomain(v, domain)) return 'no_token_shared_with_domain';
  }
  return null;
}

// ---------------------------------------------------------------------------------
// Extraction from the EvidenceBundle (all pure; jsonLd arrives already parsed)
// ---------------------------------------------------------------------------------
const ORG_TYPES = new Set([
  'organization', 'organisation', 'legalservice', 'localbusiness', 'corporation',
  'professionalservice', 'attorney', 'accountingservice', 'financialservice',
  'medicalbusiness', 'medicalorganization', 'dentist', 'physician',
  'realestateagent', 'insuranceagency', 'ngo', 'educationalorganization',
]);

function walkJsonLd(node, out, depth) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node['@graph'])) walkJsonLd(node['@graph'], out, depth + 1);
  const rawType = node['@type'];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter(Boolean)
    .map((t) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
  if (types.some((t) => ORG_TYPES.has(t))) {
    const legal = typeof node.legalName === 'string' ? tidy(node.legalName) : '';
    const nm = typeof node.name === 'string' ? tidy(node.name)
      : (node.name && typeof node.name['@value'] === 'string' ? tidy(node.name['@value']) : '');
    if (legal || nm) out.push({ name: legal || nm, legalName: legal || null });
  }
  for (const k of ['publisher', 'provider', 'parentOrganization', 'author', 'about', 'mainEntity', 'brand']) {
    if (node[k] && typeof node[k] === 'object') walkJsonLd(node[k], out, depth + 1);
  }
}

function collectJsonLdOrgs(pages) {
  const out = [];
  for (const p of pages) {
    const found = [];
    for (const block of (Array.isArray(p.jsonLd) ? p.jsonLd : [])) {
      walkJsonLd(block, found, 0);
    }
    for (const f of found) out.push({ name: f.name, legalName: f.legalName, url: p.url || null });
  }
  return out;
}

// The site's own separator, then generic and marketing segments removed. Segments
// tied to the domain are preferred: that is the firm's name, not the strapline.
const TITLE_SEPARATOR_RX = /\s*[|–—·•:]\s*|\s+-\s+/;
function titleCandidates(title, domain) {
  const t = tidy(title);
  if (!t) return [];
  const segs = t.split(TITLE_SEPARATOR_RX).map((s) => tidy(s)).filter(Boolean);
  const pool = segs.length ? segs : [t];
  const cleaned = pool
    .map((s) => tidy(s.replace(/^(?:home|welcome(?:\s+to)?)\s*[:|-]?\s*/i, '')))
    .filter(Boolean)
    .filter((s) => !(MARKETING_OPENER_RX.test(s) && pool.length > 1));
  const tied = cleaned.filter((s) => sharesTokenWithDomain(s, domain) && !isGenericTerm(s));
  return tied.concat(cleaned.filter((s) => tied.indexOf(s) === -1));
}

// Footer identity block: "(c) 2026 X Ltd", "X LLP is authorised and regulated by...".
const SUFFIX_ALT = V.LEGAL_ENTITY_SUFFIXES
  .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const COPYRIGHT_RX = new RegExp(
  '(?:\\u00a9|\\(c\\)|copyright)\\s*(?:\\d{4}(?:\\s*[\\u2013-]\\s*\\d{4})?)?\\s*(?:by\\s+)?'
  + '([A-Za-z0-9][^|\\n]{1,119}?)'
  + '(?=\\s*(?:\\.(?:\\s|$)|\\||\\n|,?\\s+all\\s+rights|$))',
  'i'
);

function parseFooterIdentity(footerText, domain) {
  const out = { copyright: null, regulated: null };
  const text = String(footerText || '');
  if (!text.trim()) return out;

  const cm = COPYRIGHT_RX.exec(text);
  if (cm && cm[1]) {
    const name = tidy(cm[1]).replace(/[.,;]\s*$/, '');
    if (name) out.copyright = { name, quote: tidy(cm[0]).slice(0, 160) };
  }

  for (const phrase of V.REGULATED_BY_PHRASES) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const rx = new RegExp(
      '([A-Za-z0-9][A-Za-z0-9&\'\\u2019.,\\- ]{1,119}?)\\s+(?:is|are)\\s+' + esc + '\\b([^|\\n.]{0,80})',
      'i'
    );
    const m = rx.exec(text);
    if (m && m[1]) {
      // Keep only the last sentence-ish chunk before "is <phrase>".
      const pre = m[1].split(/[.|\n]/).pop();
      const name = tidy(pre).replace(/^(?:the|and)\s+/i, '');
      if (name) {
        out.regulated = { name, quote: tidy(m[0]).slice(0, 160), phrase };
        break;
      }
    }
  }
  // A footer name is only trusted when it carries a legal suffix or ties to the
  // domain; enforced by the caller via rejectReason + suffix checks.
  void domain;
  return out;
}

const COMPANY_NUMBER_RX = /\b([A-Z]{2}\d{6}|\d{8})\b/g;
function findCompanyNumbers(bundle) {
  const found = new Map(); // number -> [{kind, source, quote}]
  const surfaces = [];
  const corpus = bundle && bundle.corpus ? bundle.corpus : {};
  if (typeof corpus.footerText === 'string' && corpus.footerText.trim()) {
    surfaces.push({ kind: 'footer', source: 'corpus.footerText', text: corpus.footerText });
  }
  for (const p of (Array.isArray(corpus.pages) ? corpus.pages : [])) {
    if (p && typeof p.text === 'string' && p.text.trim()) {
      surfaces.push({ kind: 'page', source: p.url || 'corpus.pages', text: p.text });
    }
  }
  for (const s of surfaces) {
    COMPANY_NUMBER_RX.lastIndex = 0;
    let m;
    while ((m = COMPANY_NUMBER_RX.exec(s.text)) !== null) {
      const idx = m.index;
      const windowText = s.text.slice(Math.max(0, idx - 120), idx + m[0].length + 120);
      const low = windowText.toLowerCase();
      const inContext = V.COMPANY_NUMBER_CONTEXT_TERMS.some((t) => low.indexOf(t.toLowerCase()) !== -1);
      if (!inContext) continue; // a bare 8-digit string with no context is not a company number
      const num = m[1].toUpperCase();
      if (!found.has(num)) found.set(num, []);
      found.get(num).push({ kind: s.kind, source: s.source, quote: tidy(windowText).slice(0, 160) });
    }
  }
  return found;
}

function formatOffice(v) {
  if (typeof v === 'string') return tidy(v) || null;
  if (v && typeof v === 'object') {
    const parts = [
      v.care_of, v.po_box, v.premises, v.address_line_1, v.address_line_2,
      v.locality, v.region, v.postal_code, v.country,
    ].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

// Flexible reader for the pre-fetched Companies House row (field names vary by fetcher).
function readCompaniesHouseRow(registers) {
  const row = registers && typeof registers === 'object' ? registers.companiesHouse : null;
  if (!row || typeof row !== 'object') return null;
  const name = tidy(row.legal_name || row.company_name || row.title || row.name || '');
  const numRaw = row.company_number || row.companyNumber || row.number || '';
  const number = tidy(String(numRaw)).toUpperCase() || null;
  const office = formatOffice(
    row.registered_office != null ? row.registered_office
      : (row.registered_office_address != null ? row.registered_office_address
        : row.registeredOffice)
  );
  if (!name && !number) return null;
  return { name: name || null, number, office };
}

// ---------------------------------------------------------------------------------
// Slug: kebab-case of the resolved display_name. NEVER the page title (caution C-003).
// ---------------------------------------------------------------------------------
const SLUG_RX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function kebab(s) {
  const out = tidy(s).toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SLUG_RX.test(out) ? out : null;
}

// ---------------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------------
function fact(value, confidence, evidence) {
  return { value: value == null ? null : value, confidence, evidence: evidence || [] };
}
function abstainFact() {
  return fact(null, CONFIDENCE.ABSTAIN, []);
}

function sanitisePages(corpus) {
  const pages = corpus && Array.isArray(corpus.pages) ? corpus.pages : [];
  return pages
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      url: typeof p.url === 'string' ? p.url : null,
      title: typeof p.title === 'string' ? p.title : null,
      text: typeof p.text === 'string' ? p.text : '',
      jsonLd: Array.isArray(p.jsonLd) ? p.jsonLd : [],
      ogSiteName: typeof p.ogSiteName === 'string' ? p.ogSiteName : null,
    }));
}

// Homepage first: root path, else shortest path wins.
function orderPages(pages) {
  const pathLen = (u) => {
    if (typeof u !== 'string') return 999;
    try {
      const parsed = new URL(u.indexOf('://') === -1 ? 'https://' + u : u);
      const pth = parsed.pathname.replace(/\/+$/, '');
      return pth === '' ? 0 : pth.length;
    } catch (_err) {
      return 998; // unparseable URL: order it last, never throw (typed by position)
    }
  };
  return pages.slice().sort((a, b) => pathLen(a.url) - pathLen(b.url));
}

const RUNG_ORDER = ['jsonld', 'og_site_name', 'footer', 'title'];

function resolveIdentity(bundle) {
  const notes = [];
  const rejected = [];
  if (VOCABULARY_SOURCE !== 'facts/vocabulary.js') {
    notes.push('vocabulary: facts/vocabulary.js absent at load time; frozen inline fallback in use (migrate when the vocabulary module lands)');
  }

  const malformed = !bundle || typeof bundle !== 'object'
    || !bundle.corpus || typeof bundle.corpus !== 'object';
  const domain = !malformed && typeof bundle.domain === 'string' ? tidy(bundle.domain) : '';

  if (malformed || (!domain && sanitisePages(bundle.corpus).length === 0)) {
    notes.push('malformed_evidence_bundle: expected {corpus:{pages:[]}, registers, domain}; abstaining on every field');
    return {
      fact: 'identity',
      domain: domain || null,
      display_name: abstainFact(),
      legal_name: abstainFact(),
      company_number: abstainFact(),
      registered_office: abstainFact(),
      slug: abstainFact(),
      rejected,
      notes,
      vocabulary_source: VOCABULARY_SOURCE,
    };
  }

  const pages = orderPages(sanitisePages(bundle.corpus));
  const footerText = typeof bundle.corpus.footerText === 'string' ? bundle.corpus.footerText : '';
  const onPageNumbers = findCompanyNumbers(bundle);

  // --------------------------- on-page candidates (rungs 2-5) ---------------------
  const accepted = []; // {value, rung, kind, source, quote?}
  const consider = (value, rung, source, quote) => {
    const reason = rejectReason(value, domain);
    if (reason) {
      rejected.push({ value: tidy(value), rung, reason });
      return null;
    }
    const entry = { value: tidy(value), rung, source: source || null, quote: quote || null };
    accepted.push(entry);
    return entry;
  };

  const jsonLdOrgs = collectJsonLdOrgs(pages);
  const jsonLdLegalNames = [];
  for (const org of jsonLdOrgs) {
    consider(org.name, 'jsonld', org.url, null);
    if (org.legalName) jsonLdLegalNames.push({ value: tidy(org.legalName), url: org.url });
  }

  for (const p of pages) {
    if (p.ogSiteName) {
      consider(p.ogSiteName, 'og_site_name', p.url, null);
      break; // one ogSiteName is enough; templates repeat it
    }
  }

  const footer = parseFooterIdentity(footerText, domain);
  if (footer.copyright) consider(footer.copyright.name, 'footer', 'corpus.footerText', footer.copyright.quote);
  if (footer.regulated) consider(footer.regulated.name, 'footer', 'corpus.footerText', footer.regulated.quote);

  const homeTitle = (pages.find((p) => p.title) || {}).title || null;
  for (const c of titleCandidates(homeTitle, domain)) {
    if (consider(c, 'title', 'corpus.pages[].title', homeTitle ? tidy(homeTitle).slice(0, 160) : null)) break;
    // keep rejecting until one sticks or the pool is exhausted
  }

  // Group accepted candidates by normalised name to count corroboration.
  const groups = new Map();
  for (const e of accepted) {
    const key = normName(e.value);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  // ------------------------------- register rung ---------------------------------
  const reg = readCompaniesHouseRow(bundle.registers);
  let regAttachment = 'none'; // 'register' | 'weak' | 'none'
  const regEvidence = [];
  if (reg && reg.name) {
    const regReject = rejectReason(reg.name, domain, { fromRegister: true });
    if (regReject) {
      rejected.push({ value: reg.name, rung: 'register', reason: regReject });
      notes.push('companiesHouse: register row rejected (' + regReject + '); legal fields abstain');
    } else {
      const regNorm = normName(reg.name);
      const numberOnPage = Boolean(reg.number && onPageNumbers.has(reg.number));
      const nameOnPage = (regNorm && groups.has(regNorm))
        || (regNorm.length >= 6 && (
          compact(footerText).indexOf(compact(stripLegalSuffixes(reg.name))) !== -1
          || pages.some((p) => compact(p.text).indexOf(compact(stripLegalSuffixes(reg.name))) !== -1)
        ));
      regEvidence.push({ kind: 'register', source: 'registers.companiesHouse', quote: reg.name });
      if (numberOnPage) {
        regEvidence.push(Object.assign({}, onPageNumbers.get(reg.number)[0]));
      }
      if (nameOnPage && regNorm && groups.has(regNorm)) {
        const first = groups.get(regNorm)[0];
        regEvidence.push({ kind: first.rung, source: first.source, quote: first.quote || first.value });
      }
      if (numberOnPage || nameOnPage) {
        regAttachment = 'register';
      } else if (sharesTokenWithDomain(reg.name, domain)) {
        regAttachment = 'weak';
        notes.push('companiesHouse: register row ties to the domain but no on-page identifier corroborates it; attached at weak confidence only');
      } else {
        regAttachment = 'none';
        notes.push('companiesHouse: register row shares no token with the domain and nothing on-page corroborates it; row ignored (a wrong register match is worse than none)');
      }
    }
  }

  // ------------------------------- display_name ----------------------------------
  let displayName = abstainFact();
  if (regAttachment === 'register') {
    displayName = fact(titleCase(reg.name), CONFIDENCE.REGISTER, regEvidence.slice(0, 4));
  } else {
    let winner = null;
    for (const rung of RUNG_ORDER) {
      winner = accepted.find((e) => e.rung === rung) || null;
      if (winner) break;
    }
    if (winner) {
      const group = groups.get(normName(winner.value)) || [winner];
      const distinctRungs = new Set(group.map((e) => e.rung));
      const conf = distinctRungs.size >= 2 ? CONFIDENCE.CORROBORATED : CONFIDENCE.WEAK;
      const evidence = group.slice(0, 4).map((e) => ({
        kind: e.rung, source: e.source, quote: e.quote || e.value,
      }));
      displayName = fact(winner.value, conf, evidence);
    } else if (regAttachment === 'weak') {
      displayName = fact(titleCase(reg.name), CONFIDENCE.WEAK, regEvidence.slice(0, 2));
    } else {
      const stem = domainStem(domain);
      if (stem) {
        const cleaned = titleCase(stem.replace(/[-_]+/g, ' '));
        displayName = fact(cleaned, CONFIDENCE.WEAK, [{ kind: 'domain', source: domain }]);
        notes.push('display_name fell through to the domain stem: no register, schema.org, ogSiteName, footer or usable title candidate survived rejection');
      } else {
        notes.push('display_name: no candidate survived rejection and no domain stem available; abstaining');
      }
    }
  }

  // -------------------------------- legal_name -----------------------------------
  let legalName = abstainFact();
  if ((regAttachment === 'register' || regAttachment === 'weak') && reg.name) {
    const conf = regAttachment === 'register' ? CONFIDENCE.REGISTER : CONFIDENCE.WEAK;
    legalName = fact(reg.name, conf, regEvidence.slice(0, 3));
  } else {
    const suffixed = (s) => SUFFIX_TEST_RX.test(String(s || ''));
    const candidates = [];
    for (const ln of jsonLdLegalNames) {
      if (!rejectReason(ln.value, domain)) candidates.push({ value: ln.value, kind: 'jsonld', source: ln.url });
    }
    for (const f of [footer.copyright, footer.regulated]) {
      if (f && suffixed(f.name) && !rejectReason(f.name, domain)) {
        candidates.push({ value: f.name, kind: 'footer', source: 'corpus.footerText', quote: f.quote });
      }
    }
    if (candidates.length) {
      const byNorm = new Map();
      for (const c of candidates) {
        const k = normName(c.value);
        if (!byNorm.has(k)) byNorm.set(k, []);
        byNorm.get(k).push(c);
      }
      const bestKey = Array.from(byNorm.keys()).sort(
        (a, b) => byNorm.get(b).length - byNorm.get(a).length
      )[0];
      const grp = byNorm.get(bestKey);
      const distinctKinds = new Set(grp.map((c) => c.kind));
      legalName = fact(
        grp[0].value,
        distinctKinds.size >= 2 ? CONFIDENCE.CORROBORATED : CONFIDENCE.WEAK,
        grp.slice(0, 3).map((c) => ({ kind: c.kind, source: c.source, quote: c.quote || c.value }))
      );
    }
  }

  // ------------------------------ company_number ---------------------------------
  let companyNumber = abstainFact();
  if (regAttachment === 'register' && reg.number) {
    companyNumber = fact(reg.number, CONFIDENCE.REGISTER, regEvidence.slice(0, 3));
  } else if (regAttachment === 'weak' && reg.number) {
    companyNumber = fact(reg.number, CONFIDENCE.WEAK, regEvidence.slice(0, 2));
  } else {
    const distinct = Array.from(onPageNumbers.keys());
    if (distinct.length === 1) {
      const sightings = onPageNumbers.get(distinct[0]);
      const distinctSources = new Set(sightings.map((s) => s.source));
      companyNumber = fact(
        distinct[0],
        distinctSources.size >= 2 ? CONFIDENCE.CORROBORATED : CONFIDENCE.WEAK,
        sightings.slice(0, 3)
      );
    } else if (distinct.length > 1) {
      notes.push('company_number: ' + distinct.length + ' distinct contextual numbers found on-page with no register to arbitrate; abstaining (conflict is not evidence)');
    }
  }

  // ----------------------------- registered_office -------------------------------
  let registeredOffice = abstainFact();
  if ((regAttachment === 'register' || regAttachment === 'weak') && reg.office) {
    registeredOffice = fact(
      reg.office,
      regAttachment === 'register' ? CONFIDENCE.REGISTER : CONFIDENCE.WEAK,
      [{ kind: 'register', source: 'registers.companiesHouse', quote: reg.office }]
    );
  }

  // ----------------------------------- slug --------------------------------------
  let slug = abstainFact();
  if (displayName.value) {
    const s = kebab(displayName.value);
    if (s) {
      slug = fact(s, displayName.confidence, [{ kind: 'derived', source: 'display_name' }]);
    } else {
      notes.push('slug: display_name did not kebab to a clean slug; abstaining rather than shipping residue');
    }
  }

  return {
    fact: 'identity',
    domain: domain || null,
    display_name: displayName,
    legal_name: legalName,
    company_number: companyNumber,
    registered_office: registeredOffice,
    slug,
    rejected,
    notes,
    vocabulary_source: VOCABULARY_SOURCE,
  };
}

// ---------------------------------------------------------------------------------
// Calibration CLI (the earn-your-zero contract in eval/calibration-known-bad/run.js).
// `node facts/identity.js --calibrate [--json <path>]` runs every p1-identity-*.json
// fixture. Each fixture plants a poisoned candidate; a FINDING is emitted only when
// the module correctly refuses the poison. Zero findings means the rejection gate is
// broken, and the calibration runner fails CI.
// ---------------------------------------------------------------------------------
function runCalibration(fixturesDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = fixturesDir
    || path.join(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures');
  const findings = [];
  const files = fs.readdirSync(dir).filter((f) => /^p1-identity-.*\.json$/.test(f)).sort();
  for (const f of files) {
    // Fail closed on an unsafe path component before it ever reaches path.join (traversal
    // guard); every fixture name comes from the already-filtered p1-identity-*.json glob above,
    // so this never fires in practice.
    if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(f)) {
      throw new Error('unsafe path component: ' + JSON.stringify(f));
    }
    const abs = path.join(dir, f);
    const fixture = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const poison = fixture.poison || {};
    const result = resolveIdentity(fixture.bundle);
    const emittedName = result.display_name.value;
    const emittedSlug = result.slug.value;
    const forbiddenNames = [].concat(poison.display_name_forbidden || []);
    const forbiddenSlugs = [].concat(poison.slug_forbidden || []);
    const namePoisoned = forbiddenNames.some(
      (n) => emittedName && normName(emittedName) === normName(n)
    );
    const slugPoisoned = forbiddenSlugs.some((s) => emittedSlug === s);
    if (!namePoisoned && !slugPoisoned) {
      findings.push({
        file: abs,
        line: 1,
        rule: 'identity-poison-rejected',
        message: 'refused poisoned candidate '
          + JSON.stringify(forbiddenNames[0] || forbiddenSlugs[0] || '(none)')
          + '; resolved display_name=' + JSON.stringify(emittedName)
          + ' (' + result.display_name.confidence + '), slug=' + JSON.stringify(emittedSlug),
      });
    }
    // A poisoned emission produces NO finding for this fixture: the calibration
    // runner then fails, which is exactly the earn-your-zero contract.
  }
  return findings;
}

function calibrateMain(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  const findings = runCalibration();
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify({ checker: 'identity', findings }) + '\n');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--calibrate')) {
    process.exit(calibrateMain(process.argv));
  } else {
    console.error('facts/identity.js is a library. Only --calibrate is runnable from the CLI.');
    process.exit(2);
  }
}

module.exports = {
  resolveIdentity,
  runCalibration,
  // exported for tests and for the one-door lineage tracer
  rejectReason,
  sharesTokenWithDomain,
  isGenericTerm,
  hasEntityResidue,
  titleCandidates,
  parseFooterIdentity,
  findCompanyNumbers,
  collectJsonLdOrgs,
  readCompaniesHouseRow,
  domainStem,
  titleCase,
  normName,
  kebab,
  CONFIDENCE,
  MAX_DISPLAY_NAME_WORDS,
  REQUIRED_VOCABULARY_EXPORTS,
  FALLBACK_VOCABULARY,
  VOCABULARY_SOURCE,
};
