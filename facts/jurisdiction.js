'use strict';
/**
 * facts/jurisdiction.js
 * THE single door for the JURISDICTION fact (Constitution Rule 1 + Rule 13; one-door manifest
 * tools/one-door/facts.json). Pure function over an EvidenceBundle; never touches the network.
 *
 * The Aman-approved Tier matrix (PRD section 3, caution.md C-006..C-023):
 *   Tier A (weight 5, each ALONE sufficient to bind):
 *     - an official register entry for that country (registers.*), with a real identifier (C-004)
 *     - an on-site authorisation statement naming a recognised authority WITH a number
 *       ("authorised and regulated by the SRA, no. 12345")
 *     - a registered-office / incorporated-in statement in a statutory disclosure block,
 *       anchored to a named country (or a country-distinctive postcode) in the SAME span
 *   Tier B (weight 3): office address with a country-format postcode, local phone country code,
 *     ccTLD, pricing currency. Binding needs TWO INDEPENDENT Tier-B signals: different KINDS,
 *     never two of the same kind (C-007).
 *   Tier C (weight 1): marketing prose, individual bar admissions, case studies, bare authority
 *     mentions. NEVER binds, in any combination. Tier C feeds serves[] (marketing reach) only.
 *
 * serves[] is a separate output from bound[] (C-008): no consumer may attach law from serves.
 *
 * Anchored nexus (C-009, the Mills & Reeve ghost-US class): "incorporated in" binds ONLY to a
 * country named inside the establishment span itself. A UK footer saying "incorporated in
 * England and Wales" can never bind the US, whatever else the corpus mentions.
 *
 * Sub-jurisdictions: US states only on observable state nexus (office address with state + ZIP,
 * or registration in the establishment span); state mentions and bar admissions render advisory.
 * UK devolved nation resolves from the postcode area. DIFC/ADGM free-zone establishment is a
 * distinct typed nexus that DISPLACES the AE federal data-protection regime (the E-221 doctrine,
 * C-064): at most one free zone attaches (DIFC takes precedence), "DIFC Courts" advocacy is never
 * establishment (C-010, the fichtelegal class), and service-offer prose ("we help you set up in
 * the DIFC") never establishes (C-011).
 *
 * Output: { bound: [{jurisdiction, tier_evidence[], confidence, score}], serves[],
 *           sub_jurisdictions[], abstained }. Every evidence entry carries {tier, kind, weight,
 *           source, quote?}. Confidence grades: 'register' (register-backed Tier A),
 *           'corroborated' (on-site Tier A, or two independent Tier-B kinds), 'weak' (serves
 *           entries only). Empty bound[] means abstained: true; there is NO default jurisdiction
 *           (C-006: on conflict or silence this module abstains, it never guesses).
 */

const fs = require('fs');
const path = require('path');

// facts/vocabulary.js is the shared token vocabulary for the facts layer. It is loaded when
// present; while it has not landed (P1 modules build in parallel) the frozen internal defaults
// below apply, and VOCAB_SOURCE records which source supplied the tokens. If vocabulary.js
// exports COUNTRY_TOKENS as a map of jurisdiction code -> array of RegExp, those EXTEND the
// internal lists; nothing else is consumed. This is a data seam, not a second producer: only
// this module turns tokens into the JURISDICTION fact.
const VOCABULARY_PATH = path.join(__dirname, 'vocabulary.js');
const vocabulary = fs.existsSync(VOCABULARY_PATH) ? require('./vocabulary.js') : null;
const VOCAB_SOURCE = vocabulary ? 'facts/vocabulary.js' : 'internal-defaults';

const TIER_WEIGHTS = Object.freeze({ A: 5, B: 3, C: 1 });

// ---------------------------------------------------------------------------
// Token tables (internal defaults; extendable via facts/vocabulary.js COUNTRY_TOKENS)
// ---------------------------------------------------------------------------

// Case matters for the short forms: /\bUS\b/i would match "contact us" and /\bUK\b/ inside
// prose is safe only because \b blocks "ukraine". Short-form tokens are case-SENSITIVE.
const INTERNAL_COUNTRY_TOKENS = {
  UK: [
    /\b(?:united kingdom|great britain|england(?:\s+(?:and|&)\s+wales)?|scotland|northern ireland)\b/i,
    /(?<!new south )\bwales\b/i,
    /\bU\.?K\.?(?![\w.])/,
  ],
  IE: [
    /\brepublic of ireland\b/i,
    /(?<!northern )\bireland\b/i,
    /\b[ée]ire\b/i,
  ],
  US: [
    /\bunited states(?: of america)?\b/i,
    /\bU\.?S\.?(?:A\.?)?(?![\w.])/,
    /\b(?:delaware|california|new york|texas|florida|illinois|massachusetts|nevada|new jersey)\b/i,
  ],
  AE: [
    /\b(?:united arab emirates|dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i,
    /\bU\.?A\.?E\.?(?![\w.])/,
  ],
  DE: [/\b(?:germany|deutschland)\b/i],
  FR: [/\bfrance\b/i],
  NL: [/\b(?:the netherlands|netherlands|nederland)\b/i],
  ES: [/\bspain\b/i],
  IT: [/\bitaly\b/i],
};

function buildCountryTokens() {
  const merged = {};
  for (const [code, list] of Object.entries(INTERNAL_COUNTRY_TOKENS)) merged[code] = list.slice();
  const extra = vocabulary && vocabulary.COUNTRY_TOKENS;
  if (extra && typeof extra === 'object') {
    for (const [code, list] of Object.entries(extra)) {
      if (!Array.isArray(list)) continue;
      const regs = list.filter((r) => r instanceof RegExp);
      if (regs.length) merged[code] = (merged[code] || []).concat(regs);
    }
  }
  return merged;
}
const COUNTRY_TOKENS = buildCountryTokens();

// EU membership of the member states this module models (UK is NOT a member).
const EU_MEMBERS = Object.freeze(['IE', 'DE', 'FR', 'NL', 'ES', 'IT']);
const EUROZONE = EU_MEMBERS; // of the modelled set, all six use the euro

// US state names accepted as establishment anchors ("incorporated in Delaware") and as
// advisory mentions. Deliberately excludes ambiguous names (Georgia, Washington).
const US_STATE_NAMES = Object.freeze({
  delaware: 'DE', california: 'CA', 'new york': 'NY', texas: 'TX', florida: 'FL',
  illinois: 'IL', massachusetts: 'MA', nevada: 'NV', 'new jersey': 'NJ',
});
const US_STATE_NAME_RX = new RegExp('\\b(' + Object.keys(US_STATE_NAMES).join('|') + ')\\b', 'i');

const US_STATE_CODES = ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS '
  + 'MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC').split(' ');
// case-sensitive: a state code + ZIP is a US office address ("New York, NY 10118")
const US_ADDRESS_RX = new RegExp('\\b(' + US_STATE_CODES.join('|') + ')\\s+(\\d{5})(?:-\\d{4})?\\b');

// The full spelled-out US state -> code map, for the SPELLED-OUT address form ("Van, Texas 75790").
// Real US footers write the state name in full at least as often as the two-letter code; the code-only
// US_ADDRESS_RX missed every one of those (healthcare-US Defect D: "488 West Main Ste. 101 Van, Texas
// 75790"). Ambiguous names (Georgia the country, Washington the person/DC) are safe HERE because the
// detector requires an adjacent 5-digit ZIP, which a country/surname mention never carries: the ZIP is
// the disambiguator. Separate from the deliberately-narrow US_STATE_NAMES prose set (which stays 9
// unambiguous names, because it is read WITHOUT a ZIP anchor in establishment spans and Tier-C prose).
const US_STATE_NAME_TO_CODE = Object.freeze({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
});
// Longest names first so "new york" wins over any shorter prefix; case-insensitive (prose casing varies).
const US_STATE_NAME_ADDRESS_RX = new RegExp(
  '\\b(' + Object.keys(US_STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length).join('|')
  + ')\\b[\\s,]{1,3}(\\d{5})(?:-\\d{4})?(?!\\d)', 'i'
);

const UK_POSTCODE_RX = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/; // case-sensitive by design
const IE_EIRCODE_RX = /\b(?:D6W|[ACDEFHKNPRTVWXY]\d{2})\s?[ACDEFHKNPRTVWXY0-9]{4}\b/;
const IE_CONTEXT_RX = /\b(?:ireland|dublin|cork|galway|limerick|waterford)\b/i;

// UK devolved nation from the postcode AREA (reserved-vs-devolved competence is the
// applicability layer's concern; this module only states the observed nation).
const UK_AREA_SCOTLAND = ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'];
const UK_AREA_WALES = ['CF', 'LD', 'LL', 'NP', 'SA'];
const UK_AREA_NI = ['BT'];

// Phone country codes, longest prefix first at match time.
const PHONE_CODES = Object.freeze({ 971: 'AE', 353: 'IE', 44: 'UK', 49: 'DE', 33: 'FR', 31: 'NL', 34: 'ES', 39: 'IT', 1: 'US' });
// A country-code phone number. {0,3} between digit groups (not the old {0,1}) tolerates real-world
// separators: "+44 (0) 7896 085 553" carries " (" and ") " runs the old single-separator form could
// not span, so a genuine UK number stalled at "44" and never reached the 6-digit floor, silently
// costing the phone Tier-B kind (empirical legal-UK Fix 4: postcode + this phone should have bound UK).
const PHONE_RX = /(?:\+|\b00)(\d(?:[\s().-]{0,3}\d){6,14})/g;

// A US/Canada domestic-format phone (NANP): "(813) 800-0810", "903-963-6850". US consumer sites almost
// never write the "+1" prefix PHONE_RX needs, so an ordinary domestic number never contributed a phone
// Tier-B kind and a real US firm was left one kind short of the two-kind floor (empirical legal-US
// Finding 4; healthcare-US Defect D). The area code first digit is 2-9 (NANP never starts an area code
// 0/1), so a leading-0 UK/IE domestic number can never match; the (?<![\d+]) guard stops it firing on a
// slice of a longer international number (that number binds via PHONE_RX on its own country code). This
// contributes ONE Tier-B phone kind attributed to US; binding still needs a SECOND independent US kind
// (a real US postcode from a US address), so a mere .com or a lone domestic number never binds US.
const US_DOMESTIC_PHONE_RX = /(?<![\d+])\(?([2-9]\d{2})\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;

// ccTLD suffixes, longest first.
const CCTLD_MAP = Object.freeze([
  ['.co.uk', 'UK'], ['.org.uk', 'UK'], ['.ac.uk', 'UK'], ['.gov.uk', 'UK'], ['.uk', 'UK'],
  ['.scot', 'UK'], ['.wales', 'UK'], ['.cymru', 'UK'],
  ['.ae', 'AE'], ['.ie', 'IE'], ['.de', 'DE'], ['.fr', 'FR'], ['.nl', 'NL'], ['.es', 'ES'],
  ['.it', 'IT'], ['.us', 'US'],
]);

// Pricing currency. The bare dollar sign is deliberately NOT a signal (used worldwide);
// the euro fans out across the modelled eurozone and still needs a second independent kind.
const CURRENCY_SIGNALS = Object.freeze([
  { rx: /£|\bGBP\b/, codes: ['UK'] },
  { rx: /\bAED\b|د\.إ|\bdirhams?\b/i, codes: ['AE'] },
  { rx: /US\$|\bUSD\b/, codes: ['US'] },
  { rx: /€|\bEUR\b/, codes: EUROZONE },
]);

// ---------------------------------------------------------------------------
// Statutory-disclosure and authorisation grammar
// ---------------------------------------------------------------------------

// Establishment verbs for the anchored incorporated-in span. "based" / "established" are
// deliberately excluded ("established in 1985", "based in Dubai" are prose, not statute).
// "with" is excluded so "registered with the DIFC Courts" can never read as incorporation.
const INCORP_RX = /\b(?:incorporated|registered|constituted|organi[sz]ed)\s+(?:in|under(?:\s+the\s+laws?\s+of)?)\s+([^.;:!?]{1,80})/gi;
const REGISTERED_OFFICE_RX = /\bregistered\s+office\b/i;

const AUTH_CTX_RX = /\b(?:authori[sz]ed|regulated|licen[cs]ed|registered)\b[^.]{0,40}\b(?:by|with)\b/i;
const AUTH_NUMBER_RX = /\b(?:no\.?|number|ref(?:erence)?|reg(?:istration)?|licen[cs]e|id)\b[\s:#.]*([A-Z]{0,4}\s?\d{3,9})\b/i;

// Recognised authorities whose on-site authorisation statement (with a number) is Tier A for
// the mapped jurisdiction. These are detection tokens only: the client-facing authority NAME
// always comes from the catalogue (Constitution Rule 2). Short forms are case-sensitive.
const AUTHORITY_TOKENS = Object.freeze([
  { rx: /\bsolicitors regulation authority\b/i, code: 'UK' },
  { rx: /\bSRA\b/, code: 'UK' },
  { rx: /\bfinancial conduct authority\b/i, code: 'UK' },
  { rx: /\bFCA\b/, code: 'UK' },
  { rx: /\bcare quality commission\b/i, code: 'UK' },
  { rx: /\bCQC\b/, code: 'UK' },
  { rx: /\binformation commissioner(?:'s)? office\b/i, code: 'UK' },
  { rx: /\bICO\b/, code: 'UK' },
  { rx: /\bbar standards board\b/i, code: 'UK' },
  { rx: /\bBSB\b/, code: 'UK' },
  { rx: /\bgeneral medical council\b/i, code: 'UK' },
  { rx: /\bGMC\b/, code: 'UK' },
  { rx: /\bdubai financial services authority\b/i, code: 'AE', zone: 'DIFC' },
  { rx: /\bDFSA\b/, code: 'AE', zone: 'DIFC' },
  { rx: /\bfinancial services regulatory authority\b/i, code: 'AE', zone: 'ADGM' },
  { rx: /\bFSRA\b/, code: 'AE', zone: 'ADGM' },
  { rx: /\bdubai health authority\b/i, code: 'AE' },
  { rx: /\bDHA\b/, code: 'AE' },
  { rx: /\bcentral bank of ireland\b/i, code: 'IE' },
  { rx: /\blaw society of ireland\b/i, code: 'IE' },
  { rx: /\bBaFin\b/, code: 'DE' },
  { rx: /\bsecurities and exchange commission\b/i, code: 'US' },
  { rx: /\bSEC\b/, code: 'US' },
]);

// Service-offer guard (C-010, C-011): a sentence SELLING establishment ("we help you set up in
// the DIFC", "we advise clients on US LLC formation") never proves establishment.
const SERVICE_OFFER_RX = /\b(?:we|our\s+(?:team|experts|specialists|lawyers))\s+(?:can\s+)?(?:help|assist|advise|support|guide)\b|\b(?:company|business)\s+(?:formation|set[- ]?up|setup|incorporation)\b|\bhow\s+to\s+(?:set\s?up|incorporate|register)\b/i;

// Free zones. The negative lookahead is the fichtelegal guard: a zone token immediately
// followed by "Court(s)" is litigation advocacy, never establishment.
const FREEZONE_DEFS = Object.freeze([
  { zone: 'DIFC', token: /\b(?:difc|dubai international financial centre)(?!\s+courts?)\b/i, addr: /\bgate\s+(?:village|district|avenue|building)\b/i },
  { zone: 'ADGM', token: /\b(?:adgm|abu dhabi global market)(?!\s+courts?)\b/i, addr: /\bal\s+maryah\s+island\b/i },
]);
const ESTAB_VERB_RX = /\b(?:registered|licen[cs]ed|authori[sz]ed|regulated|established|incorporated|headquartered|domiciled|based)\b/i;
// The applicability layer reads this token: an established free zone displaces the AE federal
// data-protection regime (never a stack). This is a routing token, not a law title.
const AE_FEDERAL_DP_TOKEN = 'AE_FEDERAL_DATA_PROTECTION';

const BAR_ADMISSION_RX = /\b(?:admitted|called)\s+to\s+(?:the\s+)?(?:[a-z. ]{0,25}\s)?(?:bar|roll)\b|\bbar\s+admissions?\b/i;

// US STATE-BAR AUTHORISATION (DEFECT-8, empirical legal-US Finding 3). AUTHORITY_TOKENS above named UK/
// IE/DE/SEC authorities but NO US state bar, so a US attorney stating their OWN bar admission WITH a bar
// number could never reach Tier A, and every established_in-only state advertising record (CA_RPC_CH7,
// NY_RPC_7_1, FL_BAR_*, TX_TDRPC_*, IL_RPC_7) stayed permanently unbindable. A state-bar authorisation
// binds the attorney to THAT state, which is the legally-correct establishment nexus: state bar
// advertising rules bind licensed/established attorneys, never a firm merely serving a client there - so
// the authority-token route (Tier A establishment), NOT a serves_customers_in fallback, is the correct
// fix (a serves fallback would over-bind a NY firm to CA rules for one CA client). These are detection
// tokens only; the client-facing authority NAME always comes from the catalogue (Rule 2).
const US_BAR_AUTHORITIES = Object.freeze([
  { rx: /\b(?:the\s+)?state bar of california\b|\bcalifornia state bar\b/i, state: 'CA' },
  { rx: /\bthe florida bar\b|\bflorida (?:state )?bar\b/i, state: 'FL' },
  { rx: /\b(?:the\s+)?state bar of texas\b|\btexas (?:state )?bar\b/i, state: 'TX' },
  { rx: /\bnew york state (?:bar|unified court system)\b|\bnew york (?:state )?bar\b/i, state: 'NY' },
  { rx: /\b(?:the\s+)?(?:illinois state bar|state bar of illinois)\b/i, state: 'IL' },
]);
// A bar/credential number: a legal-credential word IMMEDIATELY before 4-9 digits, so an unrelated number
// on the page (a phone, a year, a price) can never satisfy it. Mirrors the UK doctrine (C-014): an
// authorisation claim with NO number stays Tier C and never binds - a firm merely NAMING a state bar
// ("you may complain to the State Bar of California") is not regulated by it.
const US_BAR_NUMBER_RX = /\b(?:bar|attorney|admission|registration|licen[cs]e)\s*(?:no\.?|number|#|id|reg\.?)?\.?\s*#?\s*(\d{4,9})\b/i;

// Address-context words that let the (less self-evidently postal) UK/IE postcode detectors fire. 'ste',
// 'unit' and 'apt' were added (empirical: US/UK footers use "Ste. 101", "Unit 10", "Apt 4"); they are
// bare words so the trailing \b lands on the word boundary before the abbreviation's dot ("Ste." -> the
// \b sits between "e" and "."), unlike the pre-existing dotted "st\." forms which only match glued to a
// following word char. The US state+ZIP detectors do NOT depend on this gate (they self-anchor below).
const ADDRESS_CONTEXT_RX = /\b(?:office|offices|address|registered|located|street|st\.|road|rd\.|lane|avenue|ave\.|floor|suite|ste|unit|apt|house|building|square|place|park|way|quay|hill)\b/i;

const REGION_TOKENS = Object.freeze([
  { code: 'region:middle-east', rx: /\bmiddle\s+east(?:ern)?\b/i },
  { code: 'region:europe', rx: /\beurope(?:an)?\b/i },
  { code: 'region:gulf', rx: /\bgulf\b|\bGCC\b/ },
  { code: 'region:worldwide', rx: /\bworld\s?wide\b|\bglobal(?:ly)?\b|\binternational(?:ly)?\b/i },
]);

// Registers whose row is Tier A for a fixed home jurisdiction.
const REGISTER_HOMES = Object.freeze({ companiesHouse: 'UK', sra: 'UK', cqc: 'UK', fca: 'UK', ico: 'UK' });
const ISO_TO_CODE = Object.freeze({ GB: 'UK', UK: 'UK', IE: 'IE', US: 'US', USA: 'US', AE: 'AE', DE: 'DE', FR: 'FR', NL: 'NL', ES: 'ES', IT: 'IT' });
const REGISTER_ID_FIELDS = ['companyNumber', 'company_number', 'number', 'lei', 'registrationNumber', 'registration_number', 'frn', 'id'];
const REGISTER_NAME_FIELDS = ['name', 'legalName', 'legal_name', 'title', 'companyName', 'organisationName'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function splitSentences(text) {
  // The (?![0-9]) guard keeps an abbreviation-then-number together ("Bar No. 245123", "SRA No. 512345",
  // "Ste. 101"): a real sentence never starts with a bare digit, so refusing to split before one only
  // ever rejoins an abbreviation, never a genuine boundary. It stays SAFE for establishment anchoring
  // (C-009): a period followed by a LETTER still splits, so two establishment clauses ("... England.
  // Based in the USA.") are never merged into one anchoring span.
  return String(text || '')
    .split(/[\n\r]+|(?<=[.!?])\s+(?![0-9])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function matchCountries(text) {
  const out = [];
  for (const [code, regs] of Object.entries(COUNTRY_TOKENS)) {
    if (regs.some((rx) => rx.test(text))) out.push(code);
  }
  return out;
}

function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > (n || 180) ? t.slice(0, n || 180) + '…' : t;
}

function ukNation(postcode) {
  const m = String(postcode || '').toUpperCase().match(/^([A-Z]{1,2})\d/);
  if (!m) return null;
  const area = m[1];
  if (UK_AREA_NI.includes(area)) return 'Northern Ireland';
  if (UK_AREA_SCOTLAND.includes(area)) return 'Scotland';
  if (UK_AREA_WALES.includes(area)) return 'Wales';
  return 'England';
}

function cctldJurisdiction(domain) {
  const d = String(domain || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  for (const [suffix, code] of CCTLD_MAP) {
    if (d.endsWith(suffix)) return code;
  }
  return null;
}

function phoneJurisdiction(digits) {
  for (const len of [3, 2, 1]) {
    const prefix = digits.slice(0, len);
    if (PHONE_CODES[prefix]) return PHONE_CODES[prefix];
  }
  return null;
}

function registerIsUsable(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
  const hasId = REGISTER_ID_FIELDS.some((f) => rec[f] != null && String(rec[f]).trim() !== '');
  const hasName = REGISTER_NAME_FIELDS.some((f) => typeof rec[f] === 'string' && rec[f].trim() !== '');
  // C-004: a bare non-empty API response is not a match. A usable register row names the
  // entity AND carries a real identifier.
  return hasId && hasName;
}

// ---------------------------------------------------------------------------
// Signal accumulator
// ---------------------------------------------------------------------------

function newState() {
  return {
    sig: {},            // code -> { A: [], B: [], C: [] }
    zones: {},          // 'DIFC'/'ADGM' -> { evidence: [] }
    stateHits: [],      // { code, basis, source, quote } for US sub-jurisdictions
    ukPostcodes: [],    // { postcode, source, quote }
    regions: {},        // region code -> evidence[]
  };
}

function sigFor(state, code) {
  if (!state.sig[code]) state.sig[code] = { A: [], B: [], C: [] };
  return state.sig[code];
}

const EVIDENCE_CAPS = { A: 4, B: 4, C: 5 };

function addEvidence(state, code, tier, kind, source, quote) {
  const bucket = sigFor(state, code)[tier];
  if (tier === 'B' && bucket.some((e) => e.kind === kind)) return; // one entry per Tier-B kind
  if (bucket.length >= EVIDENCE_CAPS[tier]) return;
  const entry = { tier, kind, weight: TIER_WEIGHTS[tier], source };
  if (quote != null) entry.quote = clip(quote);
  bucket.push(entry);
}

// ---------------------------------------------------------------------------
// Collection passes
// ---------------------------------------------------------------------------

function collectRegisterSignals(bundle, state) {
  const registers = (bundle && bundle.registers) || {};
  for (const [key, rec] of Object.entries(registers)) {
    if (!registerIsUsable(rec)) continue;
    let code = REGISTER_HOMES[key] || null;
    if (!code && key === 'gleif') {
      const iso = (rec.legalAddress && rec.legalAddress.country)
        || (rec.entity && rec.entity.legalAddress && rec.entity.legalAddress.country)
        || rec.country;
      code = ISO_TO_CODE[String(iso || '').toUpperCase()] || null;
    }
    if (!code) continue;
    const idField = REGISTER_ID_FIELDS.find((f) => rec[f] != null && String(rec[f]).trim() !== '');
    const nameField = REGISTER_NAME_FIELDS.find((f) => typeof rec[f] === 'string' && rec[f].trim() !== '');
    addEvidence(state, code, 'A', 'register', 'registers.' + key,
      rec[nameField] + ' (' + idField + ' ' + rec[idField] + ')');
    if (code === 'UK') {
      const pc = JSON.stringify(rec).toUpperCase().match(UK_POSTCODE_RX);
      if (pc) state.ukPostcodes.push({ postcode: pc[0], source: 'registers.' + key, quote: pc[0] });
    }
  }
}

function collectDomainSignals(bundle, state) {
  const code = cctldJurisdiction(bundle && bundle.domain);
  if (code) addEvidence(state, code, 'B', 'cctld', 'domain', bundle.domain);
}

function walkJsonLd(node, depth, visit) {
  if (node == null || depth > 6) return;
  if (Array.isArray(node)) { node.forEach((n) => walkJsonLd(n, depth + 1, visit)); return; }
  if (typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((v) => walkJsonLd(v, depth + 1, visit));
}

function collectJsonLdSignals(bundle, state) {
  const pages = (bundle && bundle.corpus && bundle.corpus.pages) || [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.jsonLd)) continue;
    for (const doc of page.jsonLd) {
      walkJsonLd(doc, 0, (node) => {
        const country = node.addressCountry;
        if (country == null) return;
        const raw = typeof country === 'object' ? country.name : country;
        const upper = String(raw || '').toUpperCase().trim();
        const code = ISO_TO_CODE[upper] || matchCountries(String(raw || ''))[0] || null;
        if (!code) return;
        const quote = JSON.stringify({ addressCountry: raw, postalCode: node.postalCode || null, addressRegion: node.addressRegion || null });
        addEvidence(state, code, 'B', 'postcode', page.url || 'jsonld', quote);
        if (code === 'US' && typeof node.addressRegion === 'string') {
          const region = node.addressRegion.trim().toUpperCase();
          const st = US_STATE_CODES.includes(region) ? region : US_STATE_NAMES[node.addressRegion.trim().toLowerCase()];
          if (st) state.stateHits.push({ code: st, basis: 'office_address', source: page.url || 'jsonld', quote });
        }
        if (code === 'UK' && typeof node.postalCode === 'string') {
          state.ukPostcodes.push({ postcode: node.postalCode.toUpperCase(), source: page.url || 'jsonld', quote });
        }
      });
    }
  }
}

function collectGlobalTextSignals(docs, state) {
  const allText = docs.map((d) => d.text).join('\n');
  for (const m of allText.matchAll(PHONE_RX)) {
    const digits = m[1].replace(/\D/g, '');
    const code = phoneJurisdiction(digits);
    if (code) addEvidence(state, code, 'B', 'phone', 'corpus', m[0]);
  }
  // US/Canada domestic-format numbers carry no country code, so PHONE_RX (which needs +/00) never sees
  // them; this is the ONLY realistic phone Tier-B kind on an ordinary US small-business site. Attributed
  // to US: binding still needs a second independent US kind (a US postcode), which Canada's postal format
  // can never supply, so a NANP number never falsely binds US on its own.
  for (const m of allText.matchAll(US_DOMESTIC_PHONE_RX)) {
    addEvidence(state, 'US', 'B', 'phone', 'corpus', m[0]);
  }
  for (const doc of docs) {
    for (const cur of CURRENCY_SIGNALS) {
      const m = doc.text.match(cur.rx);
      if (!m) continue;
      const at = doc.text.indexOf(m[0]);
      const quote = doc.text.slice(Math.max(0, at - 20), at + 25);
      for (const code of cur.codes) addEvidence(state, code, 'B', 'currency', doc.source, quote);
    }
  }
}

function statesInText(text) {
  const out = [];
  const m = text.toLowerCase().match(US_STATE_NAME_RX);
  if (m) out.push(US_STATE_NAMES[m[1].toLowerCase()]);
  return out;
}

function analyseEstablishment(sentence, source, state, contributed) {
  // Anchored incorporated-in: the country must be named INSIDE the establishment span.
  for (const m of sentence.matchAll(INCORP_RX)) {
    const span = m[1];
    for (const code of matchCountries(span)) {
      addEvidence(state, code, 'A', 'incorporated_in', source, sentence);
      contributed.add(code);
    }
    for (const st of statesInText(span)) {
      state.stateHits.push({ code: st, basis: 'state_registration', source, quote: clip(sentence) });
      addEvidence(state, 'US', 'A', 'incorporated_in', source, sentence);
      contributed.add('US');
    }
  }
  // Registered-office statutory block: anchored by a named country, or by a
  // country-distinctive postcode format in the same sentence.
  if (REGISTERED_OFFICE_RX.test(sentence)) {
    const codes = matchCountries(sentence);
    if (codes.length) {
      for (const code of codes) { addEvidence(state, code, 'A', 'registered_office', source, sentence); contributed.add(code); }
    } else if (UK_POSTCODE_RX.test(sentence)) {
      addEvidence(state, 'UK', 'A', 'registered_office', source, sentence);
      contributed.add('UK');
    } else if (US_ADDRESS_RX.test(sentence)) {
      addEvidence(state, 'US', 'A', 'registered_office', source, sentence);
      contributed.add('US');
    } else if (IE_EIRCODE_RX.test(sentence) && IE_CONTEXT_RX.test(sentence)) {
      addEvidence(state, 'IE', 'A', 'registered_office', source, sentence);
      contributed.add('IE');
    }
  }
}

function analyseAuthorisation(sentence, source, state, contributed) {
  const hasContext = AUTH_CTX_RX.test(sentence);
  const hasNumber = AUTH_NUMBER_RX.test(sentence);
  for (const tok of AUTHORITY_TOKENS) {
    if (!tok.rx.test(sentence)) continue;
    if (hasContext && hasNumber) {
      addEvidence(state, tok.code, 'A', 'authorisation', source, sentence);
      contributed.add(tok.code);
      if (tok.zone) recordZone(state, tok.zone, source, sentence);
    } else {
      // C-014: a firm writing about an authority is not regulated by it. A bare mention,
      // or an authorisation claim with no number, stays Tier C and never binds.
      addEvidence(state, tok.code, 'C', 'authority_mention', source, sentence);
    }
  }
}

// analyseUsBarAuthorisation: a US state-bar authorisation naming the state's bar WITH a bar number is
// Tier-A establishment in that state (DEFECT-8). Emits the same Tier-A 'authorisation' establishment
// kind connect.js gate-6 reads, plus a BOUND state hit (basis 'bar_authorisation'). Without a number it
// is only a mention (Tier C, never binds), exactly like a UK authority claim with no number (C-014); the
// existing "admitted to the New York bar" prose therefore still renders advisory, never bound.
// _nearestPrecedingAuthState(auths, numStart) -> the state of the authority mention that most closely
// PRECEDES a bar number (real usage puts the number right after its own authority: "State Bar of
// California, Bar No. 245123"), or null. This is what stops a sentence naming two bars where only one
// carries a number from binding BOTH (CodeRabbit review, PR #28).
function _nearestPrecedingAuthState(auths, numStart) {
  let best = null;
  for (const a of auths) {
    if (a.end > numStart) continue;              // the authority mention must precede the number
    if (best && a.start <= best.start) continue; // keep the NEAREST preceding authority (largest start)
    best = a;
  }
  return best ? best.state : null;
}

function analyseUsBarAuthorisation(sentence, source, state, contributed) {
  const auths = [];
  for (const tok of US_BAR_AUTHORITIES) {
    const m = tok.rx.exec(sentence);
    if (m) auths.push({ state: tok.state, start: m.index, end: m.index + m[0].length });
  }
  if (!auths.length) return;
  // A bar number binds ONLY the nearest authority it follows; a state named without its own nearby
  // number stays a Tier-C mention (C-014), never a bound bar_authorisation.
  const numbered = new Set();
  for (const nm of sentence.matchAll(new RegExp(US_BAR_NUMBER_RX.source, 'gi'))) {
    const st = _nearestPrecedingAuthState(auths, nm.index);
    if (st) numbered.add(st);
  }
  for (const a of auths) {
    if (numbered.has(a.state)) {
      addEvidence(state, 'US', 'A', 'authorisation', source, sentence);
      contributed.add('US');
      state.stateHits.push({ code: a.state, basis: 'bar_authorisation', source, quote: clip(sentence) });
    } else {
      addEvidence(state, 'US', 'C', 'authority_mention', source, sentence);
    }
  }
}

function recordZone(state, zone, source, sentence) {
  if (!state.zones[zone]) state.zones[zone] = { evidence: [] };
  const ev = state.zones[zone].evidence;
  if (ev.length < 4) ev.push({ tier: 'A', kind: 'freezone_establishment', weight: TIER_WEIGHTS.A, source, quote: clip(sentence) });
}

function analyseFreezones(sentence, source, state) {
  for (const def of FREEZONE_DEFS) {
    const tokenHit = def.token.test(sentence);
    const addrHit = def.addr.test(sentence);
    if (addrHit || (tokenHit && ESTAB_VERB_RX.test(sentence))) {
      recordZone(state, def.zone, source, sentence);
    }
  }
}

// addUsPostcode: record a US Tier-B postcode + a bound office_address state hit for a resolved state code.
function addUsPostcode(state, code, source, sentence) {
  addEvidence(state, 'US', 'B', 'postcode', source, sentence);
  state.stateHits.push({ code, basis: 'office_address', source, quote: clip(sentence) });
}

// analyseUsAddress: a US postal address is SELF-ANCHORING - a state token (two-letter code OR a full
// state name) immediately followed by a 5-digit ZIP is unmistakably a US address, so it needs no separate
// context word, which real footers split onto the line above ("Head Office" / "... Texas 75790"),
// leaving the address line contextless (healthcare-US Defect D). The ZIP anchors both forms; binding
// still needs a SECOND independent Tier-B kind, so a lone spurious postcode can never bind on its own.
function analyseUsAddress(sentence, source, state) {
  const usCode = sentence.match(US_ADDRESS_RX);
  if (usCode) addUsPostcode(state, usCode[1], source, sentence);
  const usName = sentence.match(US_STATE_NAME_ADDRESS_RX);
  const st = usName ? US_STATE_NAME_TO_CODE[usName[1].toLowerCase()] : null;
  if (st) addUsPostcode(state, st, source, sentence);
}

function analyseTierB(sentence, source, state) {
  analyseUsAddress(sentence, source, state);
  // UK and IE postcodes still require an address-context word or the footer surface: their formats read
  // less unambiguously as postal in isolated prose than a US state+ZIP does.
  const inAddressContext = ADDRESS_CONTEXT_RX.test(sentence) || source === 'footer';
  if (!inAddressContext) return;
  const uk = sentence.match(UK_POSTCODE_RX);
  if (uk) {
    addEvidence(state, 'UK', 'B', 'postcode', source, sentence);
    state.ukPostcodes.push({ postcode: uk[0], source, quote: clip(sentence) });
  }
  if (IE_EIRCODE_RX.test(sentence) && IE_CONTEXT_RX.test(sentence)) {
    addEvidence(state, 'IE', 'B', 'postcode', source, sentence);
  }
}

function analyseTierC(sentence, source, state, contributed) {
  const isBar = BAR_ADMISSION_RX.test(sentence);
  for (const code of matchCountries(sentence)) {
    if (contributed.has(code)) continue;
    addEvidence(state, code, 'C', isBar ? 'bar_admission' : 'prose_mention', source, sentence);
  }
  if (isBar || US_STATE_NAME_RX.test(sentence.toLowerCase())) {
    for (const st of statesInText(sentence)) {
      state.stateHits.push({ code: st, basis: isBar ? 'bar_admission' : 'mention', source, quote: clip(sentence) });
    }
  }
  for (const region of REGION_TOKENS) {
    if (!region.rx.test(sentence)) continue;
    if (!state.regions[region.code]) state.regions[region.code] = [];
    if (state.regions[region.code].length < 3) {
      state.regions[region.code].push({ tier: 'C', kind: 'prose_mention', weight: TIER_WEIGHTS.C, source, quote: clip(sentence) });
    }
  }
}

function analyseSentence(sentence, source, state) {
  const contributed = new Set(); // codes that earned Tier A from THIS sentence
  const isServiceOffer = SERVICE_OFFER_RX.test(sentence);
  if (!isServiceOffer) {
    analyseEstablishment(sentence, source, state, contributed);
    analyseAuthorisation(sentence, source, state, contributed);
    analyseUsBarAuthorisation(sentence, source, state, contributed);
    analyseFreezones(sentence, source, state);
  }
  analyseTierB(sentence, source, state);
  analyseTierC(sentence, source, state, contributed);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function distinctBKinds(ev) {
  return new Set(ev.B.map((e) => e.kind)).size;
}

function confidenceFor(ev) {
  if (ev.A.some((e) => e.kind === 'register')) return 'register';
  return 'corroborated'; // on-site Tier A, or two independent Tier-B kinds
}

function buildBound(state) {
  const bound = [];
  for (const [code, ev] of Object.entries(state.sig)) {
    const bKinds = distinctBKinds(ev);
    // THE ATTACH RULE: one Tier-A signal, or two INDEPENDENT Tier-B kinds. Tier C never
    // participates. There is no default branch: anything else simply does not bind.
    if (ev.A.length >= 1 || bKinds >= 2) {
      bound.push({
        jurisdiction: code,
        tier_evidence: ev.A.concat(ev.B, ev.C),
        confidence: confidenceFor(ev),
        score: ev.A.length * TIER_WEIGHTS.A + bKinds * TIER_WEIGHTS.B + Math.min(ev.C.length, 3) * TIER_WEIGHTS.C,
      });
    }
  }
  // EU derivation: a bound member state binds the supranational layer too. UK does not.
  const members = bound.filter((b) => EU_MEMBERS.includes(b.jurisdiction));
  if (members.length && !bound.some((b) => b.jurisdiction === 'EU')) {
    bound.push({
      jurisdiction: 'EU',
      tier_evidence: members.map((b) => ({ tier: 'A', kind: 'eu_membership', weight: TIER_WEIGHTS.A, source: 'derived:' + b.jurisdiction })),
      confidence: members.some((b) => b.confidence === 'register') ? 'register' : 'corroborated',
      score: Math.max(...members.map((b) => b.score)),
    });
  }
  bound.sort((a, b) => b.score - a.score || a.jurisdiction.localeCompare(b.jurisdiction));
  return bound;
}

function buildServes(state) {
  const serves = [];
  for (const [code, ev] of Object.entries(state.sig)) {
    const reach = ev.C.filter((e) => e.kind === 'prose_mention' || e.kind === 'bar_admission');
    if (reach.length) serves.push({ jurisdiction: code, confidence: 'weak', evidence: reach });
  }
  for (const [code, evidence] of Object.entries(state.regions)) {
    serves.push({ jurisdiction: code, confidence: 'weak', evidence });
  }
  serves.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  return serves;
}

// An OBSERVABLE US state nexus binds; anything else renders advisory (Rule 13 at the state level).
// office_address / state_registration are Tier-A-strength observations; bar_authorisation is Tier-A
// establishment in that state (a bar admission WITH a number, DEFECT-8). A bare mention or numberless
// bar_admission prose is advisory.
function isObservableStateBasis(basis) {
  return basis === 'office_address' || basis === 'state_registration' || basis === 'bar_authorisation';
}

// _usStateSubs(stateHits) -> the US state sub-jurisdiction entries. Extracted from buildSubJurisdictions
// so each country's block is its own small unit (the CodeScene Complex-Method cap). Bound wins over
// advisory for the same state; the first advisory is kept when no bound hit exists.
function _usStateSubs(stateHits) {
  const states = new Map();
  for (const hit of stateHits) {
    const observable = isObservableStateBasis(hit.basis);
    const status = observable ? 'bound' : 'advisory';
    const prev = states.get(hit.code);
    if (prev && (prev.status === 'bound' || status === 'advisory')) continue; // bound wins, first advisory kept
    states.set(hit.code, {
      country: 'US', code: hit.code, status, basis: hit.basis,
      evidence: [{ tier: observable ? 'A' : 'C', kind: hit.basis, weight: observable ? TIER_WEIGHTS.A : TIER_WEIGHTS.C, source: hit.source, quote: hit.quote }],
    });
  }
  return Array.from(states.values());
}

function buildSubJurisdictions(state, boundCodes) {
  const out = [];
  if (boundCodes.has('UK')) {
    const nations = new Map();
    for (const hit of state.ukPostcodes) {
      const nation = ukNation(hit.postcode);
      if (nation && !nations.has(nation)) {
        nations.set(nation, { country: 'UK', code: nation, status: 'bound', basis: 'postcode_area', evidence: [{ tier: 'B', kind: 'postcode', weight: TIER_WEIGHTS.B, source: hit.source, quote: hit.quote }] });
      }
    }
    out.push(...nations.values());
  }
  if (boundCodes.has('US')) out.push(..._usStateSubs(state.stateHits));
  // Free zones: at most ONE attaches; DIFC takes precedence over ADGM (E-221 doctrine).
  const zone = state.zones.DIFC ? 'DIFC' : (state.zones.ADGM ? 'ADGM' : null);
  if (zone && boundCodes.has('AE')) {
    out.push({
      country: 'AE', code: zone, status: 'bound', basis: 'freezone_establishment',
      displaces: [AE_FEDERAL_DP_TOKEN],
      evidence: state.zones[zone].evidence.slice(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

function resolveJurisdiction(bundle) {
  const state = newState();
  const corpus = (bundle && bundle.corpus) || {};
  const docs = [];
  for (const page of (Array.isArray(corpus.pages) ? corpus.pages : [])) {
    if (page && typeof page.text === 'string' && page.text.trim()) {
      docs.push({ source: page.url || 'page', text: page.text });
    }
  }
  if (typeof corpus.footerText === 'string' && corpus.footerText.trim()) {
    docs.push({ source: 'footer', text: corpus.footerText });
  }

  collectRegisterSignals(bundle, state);
  collectDomainSignals(bundle, state);
  collectJsonLdSignals(bundle, state);
  collectGlobalTextSignals(docs, state);
  for (const doc of docs) {
    for (const sentence of splitSentences(doc.text)) {
      analyseSentence(sentence, doc.source, state);
    }
  }

  // Free-zone establishment is itself Tier-A AE evidence (a DIFC licence is an AE nexus).
  const establishedZone = state.zones.DIFC ? 'DIFC' : (state.zones.ADGM ? 'ADGM' : null);
  if (establishedZone) {
    const ze = state.zones[establishedZone].evidence[0];
    addEvidence(state, 'AE', 'A', 'freezone_establishment', ze.source, ze.quote);
  }

  const bound = buildBound(state);
  const boundCodes = new Set(bound.map((b) => b.jurisdiction));
  return {
    bound,
    serves: buildServes(state),
    sub_jurisdictions: buildSubJurisdictions(state, boundCodes),
    abstained: bound.length === 0,
  };
}

module.exports = {
  resolveJurisdiction,
  TIER_WEIGHTS,
  VOCAB_SOURCE,
  // exposed for white-box tests only; consumers read resolveJurisdiction() and nothing else
  internals: { splitSentences, matchCountries, ukNation, cctldJurisdiction, phoneJurisdiction, registerIsUsable },
};
