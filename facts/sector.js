'use strict';
// facts/sector.js - THE single door for the SECTOR fact (Constitution Rule 1) plus THE ICP GATE.
//
// Deterministic-first port of the proven old-estate doctrine:
//   - E-005/E-006 two-cue deny-by-default (old firm-profile.js): a sector attaches only when at
//     least two DISTINCT cue matches from the vocabulary detect patterns strictly beat every
//     rival sector from a different family. A weak or tied score never selects a regulated
//     sector's laws (kills the ahdubai class: a hospital can never inherit law-firms from a
//     stray cue).
//   - Visible text only (caution C-012): cues are scored over page text and footer text, never
//     titles, ogSiteName, JSON-LD or any head noise (identity signals belong to facts/identity.js).
//   - Own-identity guard: sector words used as CLIENT-industry mentions ("law firm SEO",
//     "marketing for dentists", "we help law firms") never classify the subject.
//   - Sub-sector via the vocabulary tree with the barrister-vs-solicitor and telemedicine
//     precedence guards (ported from old registry/sector.js resolveSubSector, bugs #21/#22, A5).
//   - Register cross-check (caution C-014, C-016): SRA/CQC/FCA register presence decides the
//     sector family outright; when a register or Companies House SIC codes CONTRADICT the
//     text-derived sector, the fact is DOWNGRADED to abstain. A contradicted sector never ships.
//   - Abstention is a first-class outcome. There is no default sector; "General" does not exist.
//
// INPUT (EvidenceBundle, produced upstream; this module NEVER fetches the network):
//   { corpus: { pages: [{url, title, text, jsonLd[], ogSiteName?}], footerText? },
//     registers: { companiesHouse?, gleif?, sra?, cqc?, fca?, ico? },
//     domain }
//
// OUTPUT (the fact envelope):
//   { fact: 'sector',
//     value: { sector, sub_sector } | null,
//     confidence: 'register' | 'corroborated' | 'weak' | 'abstain',
//     evidence: [{ kind, source, quote? }],
//     contradictions: [{ kind, detail, ... }],
//     diagnostics: { candidates: [...] } }
//
// VOCABULARY DEPENDENCY (one door for the tree, Rule 1): the canonical sector tree and its
// detect regexes live in facts/vocabulary.js and ONLY there. Expected minimum interface:
//   module.exports.TREE = {
//     '<parent-id>': { label?, regulators?, parent?: '<parent-id>',
//                      sub: { '<sub-id>': { detect: RegExp|string, ... }, ... },
//                      detect?: RegExp|string },
//     ...
//   }
//   Optionally: canonicalSector(s) -> canonical parent/alias resolution.
// Loading fails CLOSED (Rule 4): a missing or malformed vocabulary throws a typed error;
// it never degrades to a silent empty tree. Tests may inject a vocabulary via options.

const SERVED_CELLS = require('./served-cells.json');
// The US attorney self-ID term fragment comes from the ONE vocabulary door (Rule 1), not a hand-rolled
// copy here: facts/vocabulary.js is a hard dependency of the whole facts layer and always present, so
// this direct read is safe even though the classification TREE is loaded lazily (loadVocabulary) to
// support test injection. Only this small term fragment is read eagerly; nothing else.
const { US_ATTORNEY_SELF_ID } = require('./vocabulary.js');

// ---------------------------------------------------------------------------------------------
// Vocabulary loading (fail closed, injectable for tests)
// ---------------------------------------------------------------------------------------------

let _vocabCache = null;

function loadVocabulary() {
  if (_vocabCache) return _vocabCache;
  let mod;
  try {
    mod = require('./vocabulary.js');
  } catch (err) {
    const e = new Error(
      'facts/sector.js: facts/vocabulary.js is missing or failed to load. The sector door cannot '
      + 'operate without the canonical tree; refusing (fail closed). Underlying error: '
      + String(err && err.message)
    );
    e.code = 'E_VOCABULARY_MISSING';
    throw e;
  }
  const tree = mod && (mod.TREE || mod.tree);
  if (!tree || typeof tree !== 'object' || Object.keys(tree).length === 0) {
    const e = new Error(
      'facts/sector.js: facts/vocabulary.js loaded but exports no non-empty TREE. Refusing (fail closed).'
    );
    e.code = 'E_VOCABULARY_MALFORMED';
    throw e;
  }
  _vocabCache = {
    TREE: tree,
    canonicalSector: typeof mod.canonicalSector === 'function' ? mod.canonicalSector : null,
    sectorSelfIdFromDomain: typeof mod.sectorSelfIdFromDomain === 'function' ? mod.sectorSelfIdFromDomain : null,
  };
  return _vocabCache;
}

function _vocab(options) {
  if (options && options.vocabulary) {
    const v = options.vocabulary;
    const tree = v.TREE || v.tree;
    if (!tree || typeof tree !== 'object' || Object.keys(tree).length === 0) {
      const e = new Error('facts/sector.js: injected vocabulary has no non-empty TREE.');
      e.code = 'E_VOCABULARY_MALFORMED';
      throw e;
    }
    return {
      TREE: tree,
      canonicalSector: typeof v.canonicalSector === 'function' ? v.canonicalSector : null,
      sectorSelfIdFromDomain: typeof v.sectorSelfIdFromDomain === 'function' ? v.sectorSelfIdFromDomain : null,
    };
  }
  return loadVocabulary();
}

// ---------------------------------------------------------------------------------------------
// Text segments: visible text only (C-012). Never titles, ogSiteName or JSON-LD.
// ---------------------------------------------------------------------------------------------

function _segments(bundle) {
  const out = [];
  const corpus = (bundle && bundle.corpus) || {};
  const pages = Array.isArray(corpus.pages) ? corpus.pages : [];
  for (const p of pages) {
    const text = p && typeof p.text === 'string' ? p.text.trim() : '';
    if (text) out.push({ source: (p && p.url) || 'page', text });
  }
  const footer = typeof corpus.footerText === 'string' ? corpus.footerText.trim() : '';
  if (footer) out.push({ source: 'footer', text: footer });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Own-identity guard: discount cue matches that describe a CLIENT industry, not the subject.
// "law firm SEO" / "SEO for law firms" / "we help law firms" on a marketing agency site must
// never classify the site as law-firms.
// ---------------------------------------------------------------------------------------------

const _SERVICE_AFTER = /^[\s,:;()&'-]{0,3}(seo|search engine optimi[sz]ation|marketing|advertising|ads?|ppc|web design|website design|websites?|branding|lead generation|content marketing|social media)\b/i;
const _SERVICE_BEFORE = /\b(seo|marketing|advertising|ppc|web design|branding|content|campaigns?|websites?|lead generation)(\s+(agency|agencies|services?|solutions?|specialists?|experts?|company|consultancy))?\s+(for|to)\s*$/i;
const _CLIENT_INTRO_BEFORE = /\b(we|our (team|agency|firm))\s+(help|helps|serve|serves|work with|works with|partner with|partners with)\s*$|\bclients?\s+(include|includes|like|such as)\s*$/i;

function _isClientIndustryMention(text, start, end) {
  const before = text.slice(Math.max(0, start - 60), start);
  const after = text.slice(end, end + 60);
  if (_SERVICE_AFTER.test(after)) return true;
  if (_SERVICE_BEFORE.test(before)) return true;
  if (_CLIENT_INTRO_BEFORE.test(before)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Cue scoring (the E-005 port): distinct cue matches per parent sector, over visible segments.
// ---------------------------------------------------------------------------------------------

// Regex compilation door delegation (Constitution Rule 1 extended to pattern compilation): the
// only place a detect pattern is turned into a live RegExp is facts/vocabulary.js's
// compileDetectGlobal. No `new RegExp(...)` construction remains in this module. The shipped
// tree already carries a precompiled `detectGlobal` sibling alongside every `detect` source
// (computed once at facts/vocabulary.js load time); this module reads that directly for the
// default tree. A test-injected vocabulary (or a raw string detect, the C-050 dead-regex class)
// has no precompiled field, so its pattern is compiled on demand through the SAME
// vocabulary-owned function - never via a local construction here.
let _compileDetectGlobalFn = null;
function _detectCompiler() {
  if (_compileDetectGlobalFn) return _compileDetectGlobalFn;
  const mod = require('./vocabulary.js');
  if (typeof mod.compileDetectGlobal !== 'function') {
    const e = new Error('facts/sector.js: facts/vocabulary.js is present but does not export compileDetectGlobal.');
    e.code = 'E_VOCABULARY_MALFORMED';
    throw e;
  }
  _compileDetectGlobalFn = mod.compileDetectGlobal;
  return _compileDetectGlobalFn;
}

// The matchAll-safe GLOBAL detector for one node/sub's detect field: prefer the sibling
// `detectGlobal` vocabulary.js precomputed (frozen; safe to share because matchAll clones the
// regex internally and only reads lastIndex, never writes it - see vocabulary.js); otherwise
// compile via the vocabulary door on demand.
function _globalDetectorOf(detect, precompiledGlobal) {
  if (precompiledGlobal instanceof RegExp) return precompiledGlobal;
  if (detect == null) return null;
  return _detectCompiler()(detect);
}

// A single stateless `.test()` call needs no global flag: reusing the tree's own frozen
// non-global `detect` object directly is always safe, because a non-global regex's `.test()`
// never reads or writes `lastIndex` (only global/sticky regexes do). Only a raw string detect
// (the injected-vocabulary case) needs compiling, and that still routes through the vocabulary
// compilation door rather than a local `new RegExp(...)`.
function _plainDetectorOf(detect) {
  if (detect instanceof RegExp) return detect;
  if (typeof detect === 'string' && detect) return _detectCompiler()(detect);
  return null;
}

function _detectorsFor(node) {
  const list = [];
  const top = _globalDetectorOf(node && node.detect, node && node.detectGlobal);
  if (top) list.push(top);
  const sub = (node && node.sub) || {};
  for (const s of Object.values(sub)) {
    const rx = _globalDetectorOf(s && s.detect, s && s.detectGlobal);
    if (rx) list.push(rx);
  }
  return list;
}

function _depthOf(tree, sector) {
  let depth = 0; let cur = tree[sector]; const seen = new Set([sector]);
  while (cur && cur.parent && tree[cur.parent] && !seen.has(cur.parent)) {
    depth += 1; seen.add(cur.parent); cur = tree[cur.parent];
  }
  return depth;
}

function familyOf(tree, sector) {
  let id = sector; const seen = new Set();
  while (id && tree[id] && tree[id].parent && tree[tree[id].parent] && !seen.has(id)) {
    seen.add(id); id = tree[id].parent;
  }
  return tree[id] ? id : (sector || null);
}

function _scoreSectors(tree, segments) {
  const candidates = [];
  for (const [sectorId, node] of Object.entries(tree)) {
    const detectors = _detectorsFor(node);
    const distinct = new Map(); // normalised cue -> {quote, source}
    for (const seg of segments) {
      for (const rx of detectors) {
        // No manual lastIndex reset: String.prototype.matchAll clones the regex internally and
        // only READS the source object's lastIndex (never writes it), so a shared/frozen global
        // regex always scans each segment fresh from 0. Resetting lastIndex here would THROW on
        // the precompiled, deep-frozen detectors facts/vocabulary.js ships (Object.freeze makes
        // lastIndex non-writable) - see facts/vocabulary.js's compileDetectGlobal doc comment.
        for (const m of seg.text.matchAll(rx)) {
          const matched = m[0];
          if (!matched || !matched.trim()) continue;
          const start = m.index; const end = start + matched.length;
          if (_isClientIndustryMention(seg.text, start, end)) continue; // own-identity guard
          const key = matched.trim().toLowerCase().replace(/\s+/g, ' ');
          if (!distinct.has(key)) {
            const ctxStart = Math.max(0, start - 30);
            const ctxEnd = Math.min(seg.text.length, end + 30);
            distinct.set(key, { quote: seg.text.slice(ctxStart, ctxEnd).trim(), source: seg.source });
          }
        }
      }
    }
    if (distinct.size > 0) {
      candidates.push({
        sector: sectorId,
        family: familyOf(tree, sectorId),
        depth: _depthOf(tree, sectorId),
        distinct: distinct.size,
        cues: Array.from(distinct.entries()).slice(0, 5).map(([cue, v]) => ({ cue, quote: v.quote, source: v.source })),
      });
    }
  }
  // Sort: most distinct cues first; on a tie, prefer the deeper (more specific) node so a dental
  // practice beats its healthcare parent instead of tying with it.
  candidates.sort((a, b) => (b.distinct - a.distinct) || (b.depth - a.depth));
  return candidates;
}

// The E-005 attachment rule with same-family tolerance: the winner must show >= minCues distinct
// own cues AND strictly beat the best rival from a DIFFERENT family (a healthcare runner-up does
// not threaten a dental top; they are the same firm seen at two depths).
//
// Domain self-identity override (the C-013 own-identity-before-keywords doctrine, the C-006
// immigrationlawyersusa class): when the firm's own domain self-identifies with a family, a
// candidate of that family that still clears the two-cue floor wins the MARGIN over a higher-scoring
// rival whose cues are incidental body mentions. The floor is never lowered (deny-by-default stays:
// the self-ID family must carry >= minCues distinct visible-text cues), so a domain substring with
// no body corroboration resolves nothing. selfIdFamilies is a Set of canonical family keys.
// _selfIdWinner: the C-013 domain self-identity override, or null when no self-ID family clears the
// two-cue floor. Pulled out so _textWinner stays flat (the CodeScene Bumpy-Road/Complex-Method caps).
function _selfIdWinner(candidates, minCues, selfIdFamilies) {
  if (!selfIdFamilies || !selfIdFamilies.size) return null;
  const own = candidates.find((c) => selfIdFamilies.has(c.family) && c.distinct >= minCues);
  if (!own) return null;
  const rival = candidates.find((c) => c.family !== own.family) || null;
  return { winner: own, rival, self_identity: own.family };
}

// _rivalFamiliesAtFloor: the set of OTHER families (distinct from `topFamily`) that each independently
// clear the two-cue floor - the multidisciplinary-conflict signal (C-007). Two or more of them means a
// conglomerate / umbrella advisory firm ("a wealth management firm and law firm and corporate services
// provider"), where picking the top family over its equally self-declared rivals would be a guess.
function _rivalFamiliesAtFloor(candidates, topFamily, minCues) {
  return new Set(candidates.filter((c) => c.family !== topFamily && c.distinct >= minCues).map((c) => c.family));
}

function _textWinner(candidates, minCues, selfIdFamilies) {
  if (!candidates.length) return { winner: null, rival: null };
  const selfId = _selfIdWinner(candidates, minCues, selfIdFamilies);
  if (selfId) return selfId;
  const top = candidates[0];
  const rival = candidates.find((c) => c.family !== top.family) || null;
  const rivalDistinct = rival ? rival.distinct : 0;
  if (top.distinct < minCues || top.distinct <= rivalDistinct) return { winner: null, rival, top };
  // Abstain on a multidisciplinary conflict (C-007); a single-sector practice (one dominant family,
  // every rival below the floor) is unaffected, so a pure US attorney firm still resolves law-firms.
  const conflict = _rivalFamiliesAtFloor(candidates, top.family, minCues);
  if (conflict.size >= 2) return { winner: null, rival, top, conflict: Array.from(conflict) };
  return { winner: top, rival };
}

// ---------------------------------------------------------------------------------------------
// Sub-sector resolution (port of old registry/sector.js resolveSubSector) with the barrister
// and telemedicine precedence guards. Pure over the vocabulary tree.
// ---------------------------------------------------------------------------------------------

const _TELE_RX = /\btele(medicine|health)\b|online (doctor|gp|consultation)|remote (consultation|appointment)|virtual (gp|doctor|clinic)/i;
const _BAR_RX = /\bbarrister|\bchambers\b|\binstruct(ing)? counsel\b|direct access|public access|\bk\.?c\.?\b|\bq\.?c\.?\b/i;
// The "this is a solicitor/attorney firm, NOT barristers chambers" guard. Extended with the US
// attorney self-identification (DEFECT-7) sourced from the ONE vocabulary door (US_ATTORNEY_SELF_ID,
// attorney/lawyer/law office): a US firm names itself with those, and must never be flipped to
// barristers by an incidental "Chambers USA" directory ranking on the page (empirical: munsch.com
// carries "Chambers USA 2026 rankings" yet is a Texas attorney firm). The bare phrase "law firm" is
// deliberately NOT included: a UK firm can pair a generic "law firm" line with a genuine barristers
// self-ID ("our barrister team ... direct access"), which must still resolve barristers. The leading
// \b on "regulated" stops it matching inside "unregulated"/"deregulated".
const _SOL_RX = new RegExp(
  '\\bsolicitor|\\bregulated by the (solicitors regulation authority|sra)\\b|\\bsra (number|no|id)\\b'
  + '|\\bsra[- ]?regulated\\b|' + US_ATTORNEY_SELF_ID.source,
  'i'
);

function resolveSubSector(tree, parent, corpusText) {
  const lc = String(corpusText || '').toLowerCase();
  if (!parent || !tree[parent]) return { parent: parent || null, sub: null };

  // Telemedicine precedence (old agent A5): a telehealth-led service that also mentions GP or
  // consultations must resolve to the telemedicine node, not general-practice.
  if (familyOf(tree, parent) === 'healthcare' && _TELE_RX.test(lc)) {
    const hc = tree.healthcare;
    if (hc && hc.sub && hc.sub.telemedicine) return { parent: 'healthcare', sub: 'telemedicine' };
  }

  // Barrister-vs-solicitor guard (old bugs #21/#22): unambiguous barrister signals with NO
  // solicitor self-identification resolve to barristers, never to law-firms/solicitors, so a
  // chambers site that also says "legal advice" cannot inherit SRA solicitor rules.
  if ((parent === 'law-firms' || parent === 'barristers') && _BAR_RX.test(lc) && !_SOL_RX.test(lc)) {
    const bn = tree.barristers;
    if (bn && bn.sub) {
      const firstSub = Object.keys(bn.sub)[0] || null;
      return { parent: 'barristers', sub: firstSub };
    }
  }

  const node = tree[parent];
  for (const [subId, s] of Object.entries(node.sub || {})) {
    const rx = _plainDetectorOf(s && s.detect);
    if (rx && rx.test(lc)) return { parent, sub: subId };
  }
  return { parent, sub: null };
}

// ---------------------------------------------------------------------------------------------
// Register cross-check (C-004, C-014, C-016). A register row DECIDES the family; a register or
// SIC contradiction of the text-derived sector downgrades the fact to abstain.
// ---------------------------------------------------------------------------------------------

function _present(x) {
  if (!x) return false;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object') return Object.keys(x).length > 0;
  return Boolean(x);
}

// Decisive regulator registers: presence implies the sector family outright.
const _REGULATOR_FAMILY = { sra: 'law-firms', cqc: 'healthcare', fca: 'finance' };

// WS-Signals (KIMI-K3-DEEP-BLUEPRINT-2026-07-20 §B2): NPI (NPPES, US healthcare) -> healthcare
// SUB-sector. Matched on the register's OWN self-reported taxonomy `desc` text (not a hand-guessed
// NUCC code), so this table never depends on this repo correctly memorising an opaque 10-character
// code: the register vouches for the words, and the words are what is matched. This is exactly the
// register-anchored cascade doctrine of §B2: "never infer what a register can tell you" — a matched
// NPI taxonomy decisively sets the healthcare sub-sector, overriding a weaker text-cue guess,
// because register data is authoritative (a Tier-A-resolvable firm must be 100% correct here).
// Deliberately conservative: broad/ambiguous taxonomy groups (e.g. "Clinic/Center, Multi-Specialty")
// are left UNMATCHED rather than guessed into one of the specific sub-sector leaves below.
const _NPI_DESC_SUBSECTOR = [
  [/\bfamily medicine\b|\bgeneral practice\b|\binternal medicine\b/i, 'general-practice'],
  [/\bpsychiatry\b|\bmental health\b|\bpsycholog(?:y|ist)\b|\bbehavioral health\b/i, 'mental-health'],
  [/\boptometrist\b|\boptometry\b/i, 'optometry'],
  [/\bphysical therap/i, 'physiotherapy'],
  [/\bpharmac(?:y|ist)\b/i, 'pharmacy'],
  [/\bhospital\b/i, 'hospital-care'],
  [/\bfertility\b|\breproductive endocrinology\b/i, 'fertility-ivf'],
  [/\bnursing (?:facility|home)\b|\bskilled nursing\b|\bassisted living\b/i, 'care-home'],
  [/\btelehealth\b|\btelemedicine\b/i, 'telemedicine'],
];

// _npiCandidateDescs(npi) -> [{desc, code}] in priority order: the primary taxonomy first, then
// every secondary taxonomy the register returned (a multi-specialty organisation's primary
// taxonomy may be a broad, unmatched group while a secondary one is specific).
function _npiCandidateDescs(npi) {
  const candidates = [];
  if (npi.taxonomy_desc) candidates.push({ desc: npi.taxonomy_desc, code: npi.taxonomy_code || null });
  for (const t of Array.isArray(npi.taxonomies) ? npi.taxonomies : []) {
    if (t && t.desc) candidates.push({ desc: t.desc, code: t.code || null });
  }
  return candidates;
}

// _matchNpiSubSector(candidate) -> {sub, desc, code} | null for ONE candidate description against
// the _NPI_DESC_SUBSECTOR regex table, or null if nothing matches it.
function _matchNpiSubSector(candidate) {
  for (const [rx, sub] of _NPI_DESC_SUBSECTOR) {
    if (rx.test(candidate.desc)) return { sub, desc: candidate.desc, code: candidate.code };
  }
  return null;
}

// _npiSubSector(registers) -> {sub, desc, code} | null. The sub-sector is only left unset when
// NOTHING the register reported (primary or any secondary taxonomy) matches.
function _npiSubSector(registers) {
  const npi = registers && registers.npi;
  if (!npi) return null;
  for (const candidate of _npiCandidateDescs(npi)) {
    const match = _matchNpiSubSector(candidate);
    if (match) return match;
  }
  return null;
}

// UK SIC 2007 prefix -> sector family. Longest prefix wins. SIC codes are self-declared at
// incorporation so they corroborate or contradict; they never solely resolve a sector.
const _SIC_FAMILY = [
  ['6910', 'law-firms'],      // legal activities
  ['6920', 'accounting'],     // accounting, bookkeeping, audit, tax
  ['7021', 'marketing'],      // public relations and communications
  ['702', 'professional-services'], // management consultancy
  ['731', 'marketing'],       // advertising
  ['86', 'healthcare'],       // human health activities
  ['87', 'healthcare'],       // residential care
  ['64', 'finance'], ['65', 'finance'], ['66', 'finance'],
  ['68', 'real-estate'],
  ['55', 'hospitality'], ['56', 'hospitality'],
  ['85', 'education'],
  ['62', 'tech'], ['631', 'tech'],
  ['4791', 'ecommerce'], ['47', 'retail'],
  ['41', 'construction'], ['42', 'construction'], ['43', 'construction'],
  ['10', 'food'], ['11', 'food'],
  ['49', 'transport'], ['52', 'transport'], ['53', 'transport'],
  ['51', 'aviation'],
  ['35', 'energy'],
  ['45', 'automotive'],
  ['931', 'fitness'],
  ['58', 'media'], ['59', 'media'], ['60', 'media'],
];

function _sicFamilies(registers) {
  const ch = registers && registers.companiesHouse;
  const codes = (ch && (ch.sicCodes || ch.sic_codes)) || [];
  const fams = new Set();
  for (const raw of Array.isArray(codes) ? codes : []) {
    const code = String(raw || '').replace(/\D/g, '');
    if (!code) continue;
    let best = null;
    for (const [prefix, fam] of _SIC_FAMILY) {
      if (code.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, fam];
    }
    if (best) fams.add(best[1]);
  }
  return fams;
}

function _decisiveRegisters(registers) {
  const out = [];
  for (const [key, fam] of Object.entries(_REGULATOR_FAMILY)) {
    if (_present(registers && registers[key])) out.push({ register: key, family: fam });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The single door: resolveSector (pure, synchronous, deterministic; NEVER touches the network).
// ---------------------------------------------------------------------------------------------

function _abstain(evidence, contradictions, diagnostics) {
  return { fact: 'sector', value: null, confidence: 'abstain', evidence, contradictions, diagnostics };
}

// Sentinel returned by the two register-contradiction strategies below to mean "abstain now, with
// evidence/contradictions exactly as already recorded", distinct from a plain `null`, which means
// "this strategy declined to fire; fall through to the next one, or to deny-by-default". Keeping
// these distinguishable is what makes resolveSector's dispatch below byte-identical to the
// original inline branching (only the deny-by-default path adds the trailing SIC evidence entry).
const ABSTAIN_NOW = Symbol('sector-abstain-now');

// Every strategy below reads/writes a single shared `ctx` object rather than each taking its own
// long parameter list: {decisive, sicFams, self_identity, bundle, evidence, contradictions}.

// _fromTextWinner(winner, ctx) -> {sector, confidence} | null. Register cross-check on the text
// winner: ANY decisive register or SIC family that contradicts the text family means null (never
// ship a contradicted sector); the caller maps null to ABSTAIN_NOW.
function _fromTextWinner(winner, ctx) {
  const { decisive, sicFams, self_identity, bundle, evidence, contradictions } = ctx;
  const fam = winner.family;
  const regConflicts = decisive.filter((d) => d.family !== fam);
  const sicConflict = sicFams.size > 0 && !sicFams.has(fam);
  for (const c of winner.cues) evidence.push({ kind: 'text-cue', source: c.source, quote: c.quote });
  if (self_identity === winner.family) {
    evidence.push({ kind: 'domain-self-identity', source: 'domain', quote: String((bundle && bundle.domain) || '') });
  }
  for (const d of decisive) evidence.push({ kind: 'register', source: d.register, quote: 'register row present' });
  if (sicFams.size > 0) evidence.push({ kind: 'register', source: 'companies-house-sic', quote: 'SIC families: ' + Array.from(sicFams).join(', ') });
  if (regConflicts.length || sicConflict) {
    contradictions.push({
      kind: 'register-contradiction',
      detail: 'text evidence resolves ' + winner.sector + ' but register evidence implies '
        + (regConflicts.map((d) => d.family + ' (' + d.register + ')').concat(sicConflict ? ['SIC ' + Array.from(sicFams).join('/')] : []).join(', ')),
      text_sector: winner.sector,
    });
    return null;
  }
  return { sector: winner.sector, confidence: (decisive.length || sicFams.has(fam)) ? 'register' : 'corroborated' };
}

// _fromDecisiveRegistersOnly(ctx) -> {sector, confidence} | null. No confident text sector: a
// decisive regulator register resolves the family outright (C-014), unless the decisive registers
// disagree among themselves (null = the caller maps this to ABSTAIN_NOW).
function _fromDecisiveRegistersOnly(ctx) {
  const { decisive, evidence, contradictions } = ctx;
  const fams = new Set(decisive.map((d) => d.family));
  if (fams.size > 1) {
    contradictions.push({ kind: 'register-contradiction', detail: 'decisive registers disagree: ' + decisive.map((d) => d.register).join(', ') });
    for (const d of decisive) evidence.push({ kind: 'register', source: d.register, quote: 'register row present' });
    return null;
  }
  for (const d of decisive) evidence.push({ kind: 'register', source: d.register, quote: 'register row present' });
  return { sector: decisive[0].family, confidence: 'register' };
}

// _fromWeakCorroboration(candidates, ctx) -> {sector, confidence} | null. Thin cross-source
// corroboration: exactly one distinct text cue, unrivalled by any cue from another family,
// agreeing with a Companies House SIC family. Two independent sources (text plus register data)
// but below the two-cue standard, so it attaches as WEAK, never more. A null here is NOT a
// contradiction (nothing to abstain loudly about); the caller falls through to deny-by-default.
function _fromWeakCorroboration(candidates, ctx) {
  const { sicFams, evidence } = ctx;
  const top = candidates[0];
  const rival = candidates.find((c) => c.family !== top.family);
  if (top.distinct !== 1 || rival || !sicFams.has(top.family)) return null;
  for (const c of top.cues) evidence.push({ kind: 'text-cue', source: c.source, quote: c.quote });
  evidence.push({ kind: 'register', source: 'companies-house-sic', quote: 'SIC families: ' + Array.from(sicFams).join(', ') });
  return { sector: top.sector, confidence: 'weak' };
}

// _selectSector(candidates, winner, ctx) -> {sector, confidence} | ABSTAIN_NOW | null. Dispatches
// to exactly one of the three resolution strategies above, in priority order (text winner, then a
// decisive register alone, then thin corroboration), so resolveSector's own body stays flat.
function _selectSector(candidates, winner, ctx) {
  if (winner) return _fromTextWinner(winner, ctx) || ABSTAIN_NOW;
  if (ctx.decisive.length) return _fromDecisiveRegistersOnly(ctx) || ABSTAIN_NOW;
  if (candidates.length) return _fromWeakCorroboration(candidates, ctx);
  return null;
}

// _resolveSubSectorForSector(tree, sector, allText, ctx) -> {parent, subSector}. Runs the
// vocabulary sub-sector match, then, for healthcare only, lets an NPI register taxonomy
// corroborate or override the text-derived sub-sector (a hard register signal beats a lexicon cue).
function _resolveSubSectorForSector(tree, sector, allText, ctx) {
  const subRes = resolveSubSector(tree, sector, allText);
  let subSector = subRes.sub || null;
  if (sector === 'healthcare') {
    const npiSub = _npiSubSector((ctx.bundle && ctx.bundle.registers) || {});
    if (npiSub) {
      if (subSector && subSector !== npiSub.sub) {
        ctx.evidence.push({
          kind: 'register',
          source: 'npi',
          quote: 'NPI taxonomy "' + npiSub.desc + '" (' + (npiSub.code || 'no code') + ') overrides the text-derived sub-sector "' + subSector + '"',
        });
      } else {
        ctx.evidence.push({ kind: 'register', source: 'npi', quote: 'NPI taxonomy: ' + npiSub.desc + ' (' + (npiSub.code || 'no code') + ')' });
      }
      subSector = npiSub.sub;
    }
  }
  return { parent: subRes.parent, subSector };
}

function resolveSector(bundle, options = {}) {
  const vocab = _vocab(options);
  const tree = vocab.TREE;
  const segments = _segments(bundle);
  const contradictions = [];
  const evidence = [];
  const allText = segments.map((s) => s.text).join('\n');

  const candidates = segments.length ? _scoreSectors(tree, segments) : [];
  const diagnostics = { candidates: candidates.slice(0, 4).map((c) => ({ sector: c.sector, distinct: c.distinct })) };

  // Domain self-identity families (C-013): the one own-identity signal outside the visible body.
  const selfIdFamilies = new Set(
    vocab.sectorSelfIdFromDomain ? (vocab.sectorSelfIdFromDomain(bundle && bundle.domain) || []) : []
  );
  const { winner, self_identity } = _textWinner(candidates, 2, selfIdFamilies);
  const decisive = _decisiveRegisters((bundle && bundle.registers) || {});
  const sicFams = _sicFamilies((bundle && bundle.registers) || {});
  const ctx = { decisive, sicFams, self_identity, bundle, evidence, contradictions };

  const outcome = _selectSector(candidates, winner, ctx);
  if (outcome === ABSTAIN_NOW) return _finish(_abstain(evidence, contradictions, diagnostics), options, tree, vocab);
  if (!outcome) {
    // Deny by default: no two-cue winner, no decisive register, no corroborated single cue.
    if (sicFams.size > 0) evidence.push({ kind: 'register', source: 'companies-house-sic', quote: 'SIC families: ' + Array.from(sicFams).join(', ') });
    return _finish(_abstain(evidence, contradictions, diagnostics), options, tree, vocab);
  }

  const { parent, subSector } = _resolveSubSectorForSector(tree, outcome.sector, allText, ctx);
  const result = {
    fact: 'sector',
    value: { sector: parent || outcome.sector, sub_sector: subSector },
    confidence: outcome.confidence,
    evidence,
    contradictions,
    diagnostics,
  };
  return _finish(result, options, tree, vocab);
}

// Hint handling: a queue/lead hint is NOT evidence. It never resolves a sector and never
// overrides one; when it disagrees with the evidence-derived result the disagreement is flagged
// so the pipeline can quarantine or re-verify upstream data (the ahdubai class).
function _finish(result, options, tree, vocab) {
  const hint = options && options.hint;
  if (hint) {
    const norm = _canonical(hint, tree, vocab);
    if (result.value && norm && familyOf(tree, norm) !== familyOf(tree, result.value.sector)) {
      result.contradictions.push({
        kind: 'hint-contradiction',
        detail: 'queue hint says ' + String(hint) + ' but evidence resolves ' + result.value.sector,
        hint: String(hint),
      });
    }
    if (!result.value && norm) {
      result.contradictions.push({
        kind: 'hint-unconfirmed',
        detail: 'queue hint says ' + String(hint) + ' but the evidence supports no sector; hint is not evidence',
        hint: String(hint),
      });
    }
  }
  return result;
}

function _canonical(sector, tree, vocab) {
  const x = String(sector || '').toLowerCase().trim().replace(/\s+/g, '-');
  if (!x) return null;
  if (vocab && vocab.canonicalSector) {
    const c = vocab.canonicalSector(x);
    if (c && tree[c]) return c;
  }
  return tree[x] ? x : null;
}

// ---------------------------------------------------------------------------------------------
// LLM-assist seam (P3 wiring). NEVER called by default: resolveSector is pure and synchronous.
// A caller that has a gated classifier (llm/gate.js rubric, catalogue-constrained) may pass it
// as options.classifyWithLlm to this async wrapper. The hook runs ONLY when the deterministic
// path abstained WITHOUT a register contradiction, it may only select a sector that exists in
// the vocabulary tree (closed world, Rule 11: selection, never authorship), and its output is
// capped at confidence 'weak'. Any hook error fails closed to the deterministic abstention and
// is recorded as a typed degradation, never swallowed.
// ---------------------------------------------------------------------------------------------

// Typed degradation recorder: a failed optional step is written onto the fact envelope so the
// pipeline (and the payload validator) can see that the LLM leg ran and failed. Never silent.
function recordDegradation(result, step, err) {
  if (!Array.isArray(result.degraded)) result.degraded = [];
  result.degraded.push({ step, error: String(err && err.message) });
}

async function resolveSectorWithLlm(bundle, options = {}) {
  const base = resolveSector(bundle, options);
  const hook = options.classifyWithLlm;
  if (typeof hook !== 'function') return base;
  if (base.value) return base;
  if (base.contradictions.some((c) => c.kind === 'register-contradiction')) return base;

  const vocab = _vocab(options);
  const tree = vocab.TREE;
  let out;
  try {
    out = await hook({ bundle, candidates: Object.keys(tree) });
  } catch (err) {
    recordDegradation(base, 'classifyWithLlm', err);
    return base;
  }
  const chosen = _canonical(out && out.sector, tree, vocab);
  if (!chosen) return base; // out-of-tree selection is unrepresentable; abstention stands
  const allText = _segments(bundle).map((s) => s.text).join('\n');
  const subRes = resolveSubSector(tree, chosen, allText);
  return {
    fact: 'sector',
    value: { sector: subRes.parent || chosen, sub_sector: subRes.sub || null },
    confidence: 'weak',
    evidence: base.evidence.concat([{ kind: 'llm-selection', source: 'classifyWithLlm', quote: String((out && out.evidence) || '').slice(0, 160) }]),
    contradictions: base.contradictions,
    diagnostics: base.diagnostics,
  };
}

// ---------------------------------------------------------------------------------------------
// THE ICP GATE (Aman's directive): auditableCell. True ONLY when the resolved
// (sector, sub_sector, jurisdiction) triple is in the served-cells dataset. No match means the
// engine refuses the audit with a stated reason. Silence is free.
// ---------------------------------------------------------------------------------------------

// Normalises an ALREADY-RESOLVED jurisdiction code for cell lookup. This is a consumer-side
// alias fold, not a producer: the jurisdiction fact itself has its one door in
// facts/jurisdiction.js and this module never derives it.
function _cellCode(j) {
  const x = String(j || '').toUpperCase().trim();
  if (x === 'GB' || x === 'GBR' || x === 'UNITED KINGDOM') return 'UK';
  if (x === 'UAE') return 'AE';
  if (x === 'USA') return 'US';
  return x;
}

function auditableCell({ sector, sub_sector, jurisdictions_bound } = {}) {
  if (!sector) {
    return { auditable: false, reason: 'sector unresolved: the engine abstained, so no served cell can match; refusing the audit' };
  }
  const bound = (Array.isArray(jurisdictions_bound) ? jurisdictions_bound : [jurisdictions_bound])
    .filter(Boolean).map(_cellCode);
  if (!bound.length) {
    return { auditable: false, reason: 'no bound jurisdiction resolved: law attaches on evidence, and with none there is no cell to serve; refusing the audit' };
  }
  const sec = String(sector).toLowerCase().trim();
  const cells = Array.isArray(SERVED_CELLS.cells) ? SERVED_CELLS.cells : [];

  for (const j of bound) {
    const hit = cells.find((c) => c.served === true && c.jurisdiction === j
      && (c.sector === sec || c.sector === '*')
      && (c.sub_sectors === '*' || (Array.isArray(c.sub_sectors) && sub_sector && c.sub_sectors.includes(sub_sector))));
    if (hit) {
      const unserved = bound.filter((b) => b !== j);
      return {
        auditable: true,
        reason: 'served cell: ' + j + ' x ' + sec + (sub_sector ? ' / ' + sub_sector : '')
          + (unserved.length ? '; note: other bound jurisdictions (' + unserved.join(', ') + ') are not yet served and stay out of scope' : ''),
        cell: { jurisdiction: j, sector: sec, sub_sector: sub_sector || null },
      };
    }
  }

  // No served cell. Prefer an "activates" note if one exists for any bound jurisdiction.
  for (const j of bound) {
    const planned = cells.find((c) => c.served === false && c.jurisdiction === j && (c.sector === sec || c.sector === '*'));
    if (planned) {
      return { auditable: false, reason: 'cell not served yet: ' + j + ' x ' + sec + '; activates: ' + (planned.activates || 'unscheduled') };
    }
  }
  const knownSector = cells.some((c) => c.sector === sec);
  if (!knownSector) {
    return { auditable: false, reason: 'sector "' + sec + '" is not in the served-cells manifest; refusing the audit rather than guessing' };
  }
  return { auditable: false, reason: 'no served cell for (' + bound.join('/') + ' x ' + sec + '); refusing the audit' };
}

module.exports = {
  resolveSector,
  resolveSectorWithLlm,
  auditableCell,
  resolveSubSector,
  familyOf,
  loadVocabulary,
  // exported for tests and the calibration harness
  _scoreSectors,
  _segments,
  _isClientIndustryMention,
  _sicFamilies,
  _npiSubSector,
  _NPI_DESC_SUBSECTOR,
  SERVED_CELLS,
};
