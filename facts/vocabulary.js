'use strict';
// facts/vocabulary.js - THE single door for the facts-layer VOCABULARY (Constitution Rule 1).
//
// This module is the ONE producer of the shared, non-legal token vocabularies the facts layer
// reads: the canonical sector TREE and its detect regexes, sector aliases, the jurisdiction and
// sub-jurisdiction code sets, the family-alias fold, nexus relation types, the activity-tag set,
// the confidence and finding-state enums, and the country-name token extensions. Every consumer
// (facts/identity.js, facts/jurisdiction.js, facts/sector.js, facts/capabilities.js) reads its
// vocabulary from here and nowhere else, so no two doors can drift.
//
// WHAT THIS MODULE IS NOT (Constitution Rule 2, catalogue-only law facts): it holds NO law names,
// NO citations, NO fines, NO penalty bands and NO regulator strings. The sector TREE carries only
// display labels and detection regexes; the client-facing regulator name and every law title come
// from the compiled catalogue, never from here. The old estate stapled `regulators:['SRA']` and
// framework short-codes onto its sector registry; that class of literal is deliberately dropped.
//
// DOCTRINE:
//  - Pure data + pure validators. No network, no clock, no environment, no dependency.
//  - Everything exported is DEEP-FROZEN: a consumer cannot mutate the shared vocabulary.
//  - The validators FAIL CLOSED (Constitution Rule 4): assertVocab throws on an unknown value or
//    an unknown kind. Ambiguity is never resolved to a default; it raises.
//  - Every detect regex is word-boundary anchored on every alternation (the C-059 discipline) and
//    ships a known-positive sample, proven by vocabulary.test.js (the C-050 dead-regex guard).
//
// Ported and merged from the old estate registries (registry/sector.js TREE + SUB_EXCLUSIVE +
// SECTOR_ALIASES + CANONICAL_SECTORS + canonicalSector + resolveSubSector guards, registry/
// jurisdiction.js FAMILY_ALIAS + famCanon + EU set, registry/nexus.js NEXUS_TYPES, registry/
// subjurisdiction.js US-state + UK-nation + free-zone data, registry/vocab.js enum shapes),
// stripped of every catalogue-owned law fact.

// ---------------------------------------------------------------------------------
// deepFreeze: recursively freeze plain objects and arrays. RegExp objects are frozen
// in place (their source/flags/lastIndex are non-enumerable so recursion never touches
// them, and consumers only ever read a fresh copy via new RegExp). Fail closed on cycles.
// ---------------------------------------------------------------------------------
function deepFreeze(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  const s = seen || new Set();
  if (s.has(value)) return value;
  s.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], s);
  return Object.freeze(value);
}

// =================================================================================
// 1. IDENTITY vocabulary (consumed by facts/identity.js).
//    These lists are the naming authority for the identity ladder's rejection gate.
//    Each MUST be a non-empty array of strings (identity.js REQUIRED_VOCABULARY_EXPORTS).
// =================================================================================

const GENERIC_PAGE_TERMS = [
  'home', 'homepage', 'home page', 'welcome', 'index', 'untitled', 'site', 'website',
  'contact', 'contact us', 'about', 'about us', 'menu', 'blog', 'news', 'our team',
  'team', 'people', 'careers', 'jobs', 'services', 'our services', 'office', 'offices',
  'branch', 'branches', 'location', 'locations', 'price list', 'prices', 'pricing',
  'fees', 'faq', 'faqs', 'gallery', 'testimonials', 'reviews', 'book now',
  'book online', 'shop', 'store', 'search', 'privacy policy', 'terms', 'cookies',
];

const LEGAL_ENTITY_SUFFIXES = [
  'ltd', 'limited', 'llp', 'plc', 'lp', 'llc', 'inc', 'incorporated', 'cic', 'cio',
  'company', 'co', 'partnership', 'pllc', 'gmbh', 'sarl', 'bv', 'pty',
];

const MARKETING_TAIL_TERMS = [
  'solicitors', 'lawyers', 'law firm', 'barristers', 'accountants', 'dentists',
  'clinic', 'specialists', 'experts', 'consultants', 'advisors', 'advisers',
  'official site', 'official website', 'top', 'leading', 'best', 'luxury', 'premier',
  'trusted', 'award-winning', 'award winning', 'no.1', 'no 1', 'number one',
];

const REGULATED_BY_PHRASES = [
  'authorised and regulated by', 'authorized and regulated by', 'regulated by',
  'authorised by', 'licensed by', 'licenced by', 'registered with',
];

const COMPANY_NUMBER_CONTEXT_TERMS = [
  'company number', 'company no', 'company registration', 'registered number',
  'registration number', 'registered in england', 'registered in scotland',
  'registered in wales', 'registered in northern ireland', 'companies house',
  'registered office', 'company reg',
];

const PUBLIC_SUFFIX_SECOND_LEVEL = [
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'gov.uk', 'ac.uk', 'com.au', 'co.nz', 'co.za', 'com.sg', 'co.ae', 'com.sa', 'co.in',
];

const TITLE_SMALL_WORDS = [
  'and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'a', 'an', 'by', '&',
];

const KEEP_UPPERCASE_TOKENS = [
  'UK', 'USA', 'US', 'UAE', 'LLP', 'LLC', 'PLC', 'LTD', 'NHS', 'IT', 'HR', 'PR', 'AI',
  'BDO', 'KPMG', 'PWC', 'EY',
];

// =================================================================================
// 2. SECTOR tree (consumed by facts/sector.js). Ported from registry/sector.js, stripped
//    of catalogue-owned regulators + frameworks. Each sub node carries a detect regex and a
//    known-positive `sample` (proven by vocabulary.test.js). Parent nodes with a `parent`
//    field are children of another parent in the same tree (dental/aesthetics -> healthcare).
//    Sector keys stay in sync with the served-cells manifest (sector.test.js asserts it).
// =================================================================================

const SECTORS = {
  'law-firms': {
    label: 'Solicitors & law firms',
    sub: {
      solicitors: {
        detect: /\bsolicitors?\b|\bconveyancing\b|\bprobate\b|\blaw firm\b|\blegal advice\b/i,
        sample: 'our solicitors provide conveyancing and probate; ask our law firm for legal advice',
      },
    },
  },
  barristers: {
    label: 'Barristers & chambers',
    sub: {
      general: {
        detect: /\bbarristers?\b|\bchambers\b|\bk\.?c\.?\b|\bq\.?c\.?\b|\bdirect access\b|\bpublic access\b|\binstruct(?:ing)? counsel\b/i,
        sample: 'our barrister team at chambers accepts direct access and instructing counsel',
      },
    },
  },
  healthcare: {
    label: 'Healthcare',
    sub: {
      'general-practice': {
        detect: /\bgp\b|\bgeneral practice\b|\bfamily (?:doctor|medicine)\b|\bprivate gp\b/i,
        sample: 'our general practice team and private GP offer same-day appointments',
      },
      telemedicine: {
        detect: /\btele(?:medicine|health)\b|\bonline (?:doctor|gp|consultation)\b|\bremote (?:consultation|appointment)\b|\bvirtual (?:gp|doctor|clinic)\b/i,
        sample: 'our telemedicine service offers an online doctor and virtual GP consultation',
      },
      'hospital-care': {
        detect: /\bhospitals?\b|\bmedical centre\b|\bclinic\b|\boncolog(?:y|ist)\b|\bcancer (?:care|treatment|clinic|centre)\b|\bcqc registered\b/i,
        sample: 'a private hospital and medical centre; the clinic is CQC registered with cancer care',
      },
      'fertility-ivf': {
        detect: /\bivf\b|\bfertility\b|\breproductive medicine\b|\begg (?:freezing|donor)\b|\bicsi\b/i,
        sample: 'our fertility clinic offers IVF and egg freezing',
      },
      'mental-health': {
        detect: /\bmental health\b|\bpsychiatr(?:y|ist|ic)\b|\bpsycholog(?:y|ist|ical)\b|\bcounsell?ing\b|\bpsychotherap(?:y|ist)\b/i,
        sample: 'mental health support with psychology and counselling',
      },
      pharmacy: {
        detect: /\bpharmac(?:y|ist|ies)\b|\bchemist\b|\bdispensing\b/i,
        sample: 'our pharmacy and dispensing chemist',
      },
    },
  },
  dental: {
    label: 'Dental',
    parent: 'healthcare',
    sub: {
      'general-dental': {
        detect: /\bdentists?\b|\bdental (?:practice|clinic|surgery|care)\b/i,
        sample: 'our dental practice and dentist offer dental care',
      },
      orthodontics: {
        detect: /\borthodont(?:ic|ics|ist)\b|\bbraces\b|\binvisalign\b|\bteeth straighten(?:ing)?\b/i,
        sample: 'orthodontics and braces, including Invisalign teeth straightening',
      },
      'cosmetic-dentistry': {
        detect: /\bcosmetic dent(?:istry|al)\b|\bveneers\b|\bteeth whitening\b|\bsmile makeover\b/i,
        sample: 'cosmetic dentistry: veneers, teeth whitening and a smile makeover',
      },
    },
  },
  aesthetics: {
    label: 'Aesthetics',
    parent: 'healthcare',
    sub: {
      injectables: {
        detect: /\bbotox\b|\bbotulinum\b|\bdermal filler\b|\blip filler\b|\banti[- ]wrinkle injection\b|\bprofhilo\b/i,
        sample: 'Botox, dermal filler and anti-wrinkle injection treatments',
      },
      'laser-skin': {
        detect: /\blaser (?:hair|skin)\b|\bipl\b|\bmicroneedling\b|\bchemical peel\b/i,
        sample: 'laser hair removal, IPL, microneedling and chemical peel',
      },
      'cosmetic-surgery': {
        detect: /\bcosmetic surgery\b|\bliposuction\b|\brhinoplasty\b|\bbreast (?:augmentation|implant)\b|\btummy tuck\b/i,
        sample: 'cosmetic surgery including liposuction and rhinoplasty',
      },
    },
  },
  finance: {
    label: 'Financial services',
    sub: {
      banking: {
        detect: /\bbank\b|\bcurrent account\b|\bsavings account\b|\boverdraft\b/i,
        sample: 'open a current account or savings account with our bank',
      },
      'wealth-management': {
        detect: /\bwealth (?:management|manager|adviser)\b|\bprivate bank\b|\bportfolio management\b|\binvestment management\b/i,
        sample: 'wealth management and portfolio management for private clients',
      },
      insurance: {
        detect: /\binsurance\b|\binsurer\b|\bunderwrit(?:e|ing|er)\b|\bicobs\b/i,
        sample: 'insurance cover from a leading insurer',
      },
      ifa: {
        detect: /\bindependent financial advis(?:er|or|ory)\b|\bifa\b|\bfinancial planner\b|\bmortgage adviser\b/i,
        sample: 'an independent financial adviser and mortgage adviser',
      },
      fintech: {
        detect: /\bfintech\b|\bpayment (?:app|platform|gateway)\b|\bneobank\b|\be[- ]money\b|\bopen banking\b/i,
        sample: 'a fintech payment platform using open banking',
      },
    },
  },
  'real-estate': {
    label: 'Real estate',
    sub: {
      sales: {
        detect: /\bproperties for sale\b|\bestate agents?\b|\bhomes for sale\b|\bfor sale by\b/i,
        sample: 'estate agents with homes for sale and properties for sale',
      },
      lettings: {
        detect: /\bletting(?:s)?\b|\bto let\b|\brental propert(?:y|ies)\b|\btenanc(?:y|ies)\b|\blandlords?\b/i,
        sample: 'lettings and rental property for landlords and tenancy',
      },
      'property-management': {
        detect: /\bproperty management\b|\bblock management\b|\bservice charge\b|\bmanaging agent\b/i,
        sample: 'property management and block management as your managing agent',
      },
    },
  },
  accounting: {
    label: 'Accounting & audit',
    sub: {
      general: {
        detect: /\baccountants?\b|\baccountancy\b|\bbookkeep(?:er|ing)\b|\bchartered accountant\b|\btax advis(?:er|or|ory)\b|\baudit firm\b/i,
        sample: 'chartered accountants offering accountancy, bookkeeping and tax advisory',
      },
    },
  },
  'professional-services': {
    label: 'Professional services',
    sub: {
      general: {
        detect: /\bconsultancy\b|\bconsulting firm\b|\badvisory (?:firm|services)\b|\bmanagement consult(?:ing|ants|ancy)\b|\bchartered surveyor\b/i,
        sample: 'a management consultancy and advisory firm',
      },
    },
  },
  hospitality: {
    label: 'Hotels & hospitality',
    sub: {
      hotel: {
        detect: /\bhotels?\b|\binn\b|\bresort\b|\bb&b\b|\bbed and breakfast\b|\bguesthouse\b/i,
        sample: 'a boutique hotel and resort with a guesthouse',
      },
      restaurant: {
        detect: /\brestaurant\b|\bcafe\b|\bbistro\b|\btakeaway\b|\bdining\b|\bmenu\b/i,
        sample: 'our restaurant and cafe; view the takeaway menu',
      },
      travel: {
        detect: /\bholidays?\b|\btour operator\b|\btravel agent\b|\batol\b|\babta\b|\bpackage (?:holiday|trip)\b/i,
        sample: 'a tour operator and travel agent with ATOL package holiday cover',
      },
    },
  },
  education: {
    label: 'Education',
    sub: {
      school: {
        detect: /\bschool\b|\bnursery\b|\bkindergarten\b|\bpupils\b|\bkey stage\b|\bprimary school\b|\bsecondary school\b/i,
        sample: 'our primary school and nursery for pupils at key stage one',
      },
      'higher-education': {
        detect: /\buniversity\b|\bcollege\b|\bundergraduate\b|\bpostgraduate\b|\bdegree (?:course|programme)\b/i,
        sample: 'a university and college with undergraduate and postgraduate degree courses',
      },
    },
  },
  charity: {
    label: 'Charity & non-profit',
    sub: {
      general: {
        detect: /\bcharity\b|\bcharitable\b|\bnon-?profit\b|\bngo\b|\bfundraising\b/i,
        sample: 'a registered charity and non-profit with fundraising',
      },
    },
  },
  energy: {
    label: 'Energy & utilities',
    sub: {
      general: {
        detect: /\benergy supplier\b|\butility\b|\belectricity supplier\b|\brenewable energy\b|\bsolar (?:panel|energy)\b|\bofgem\b/i,
        sample: 'an energy supplier offering renewable energy and solar panels',
      },
    },
  },
  transport: {
    label: 'Transport & logistics',
    sub: {
      general: {
        detect: /\blogistics\b|\bhaulage\b|\bfreight\b|\bcourier\b|\bfleet management\b|\btransport (?:company|services)\b/i,
        sample: 'a logistics and haulage firm with freight and courier services',
      },
    },
  },
  aviation: {
    label: 'Aviation',
    sub: {
      general: {
        detect: /\baviation\b|\bairline\b|\baircraft\b|\bairport\b|\bcharter flight\b/i,
        sample: 'an aviation airline operating aircraft and charter flights',
      },
    },
  },
  media: {
    label: 'Media & broadcasting',
    sub: {
      general: {
        detect: /\bbroadcast(?:er|ing)?\b|\bpublishing house\b|\bnewspaper\b|\bmagazine\b|\bmedia (?:company|agency|group)\b/i,
        sample: 'a broadcasting and publishing house running a newspaper and magazine',
      },
    },
  },
  marketing: {
    label: 'Marketing & advertising',
    sub: {
      general: {
        detect: /\bmarketing agency\b|\badvertising agency\b|\bseo agency\b|\bdigital marketing\b|\bbranding agency\b/i,
        sample: 'a digital marketing agency and advertising agency, a specialist SEO agency',
      },
    },
  },
  manufacturing: {
    label: 'Manufacturing',
    sub: {
      general: {
        detect: /\bmanufactur(?:e|ing|er)\b|\bfactory\b|\bproduction plant\b|\bindustrial equipment\b|\bfabrication\b/i,
        sample: 'a manufacturer running a factory and production plant for fabrication',
      },
    },
  },
  construction: {
    label: 'Construction',
    sub: {
      general: {
        detect: /\bconstruction (?:company|firm)\b|\bbuilding contractor\b|\bcivil engineering\b|\bgroundwork\b|\bbuilders?\b/i,
        sample: 'a construction company and building contractor doing civil engineering',
      },
    },
  },
  fitness: {
    label: 'Fitness & wellness',
    sub: {
      general: {
        detect: /\bgym\b|\bfitness (?:studio|centre|club)\b|\bpersonal train(?:er|ing)\b|\bpilates studio\b|\byoga studio\b/i,
        sample: 'a gym and fitness studio with personal training and a yoga studio',
      },
    },
  },
  ecommerce: {
    label: 'E-commerce',
    sub: {
      general: {
        detect: /\becommerce\b|\be-commerce\b|\bonline store\b|\badd to (?:cart|basket)\b|\bonline shop\b/i,
        sample: 'our online store; add to basket in the e-commerce online shop',
      },
    },
  },
  retail: {
    label: 'Retail',
    sub: {
      general: {
        detect: /\bretail(?:er)?\b|\bhigh street store\b|\bboutique\b|\bshopfront\b/i,
        sample: 'a retailer with a boutique and shopfront',
      },
    },
  },
  saas: {
    label: 'SaaS & cloud',
    sub: {
      general: {
        detect: /\bsaas\b|\bsoftware as a service\b|\bcloud platform\b|\bsubscription software\b|\bweb app\b/i,
        sample: 'a SaaS cloud platform delivering subscription software as a service',
      },
    },
  },
  tech: {
    label: 'Technology',
    sub: {
      general: {
        detect: /\btech (?:company|startup)\b|\bsoftware (?:company|house)\b|\bit services\b|\bapp development\b/i,
        sample: 'a tech startup and software house offering IT services and app development',
      },
    },
  },
  automotive: {
    label: 'Automotive',
    sub: {
      general: {
        detect: /\bcar dealership\b|\bautomotive\b|\bgarage\b|\bvehicle (?:repair|service)\b|\bauto repair\b/i,
        sample: 'a car dealership and automotive garage for vehicle repair',
      },
    },
  },
  food: {
    label: 'Food & beverage',
    sub: {
      general: {
        detect: /\bfood (?:business|producer|manufactur(?:er|ing))\b|\bcatering\b|\bgrocery\b|\bfood delivery\b/i,
        sample: 'a food producer and catering business offering food delivery',
      },
    },
  },
};

// =================================================================================
// 2b. Regex compilation door (Constitution Rule 1 extended to pattern compilation): the ONLY
//    `new RegExp(...)` construction over a detect pattern in the whole facts layer lives here.
//    compileDetectGlobal derives the global+case-insensitive variant every matchAll-based
//    consumer needs (the distinct-cue counting in facts/sector.js _scoreSectors) from either an
//    already-compiled `detect` RegExp (the shipped tree above) or a raw string (a test-injected
//    vocabulary, the C-050 dead-regex class); a malformed string throws E_VOCABULARY_BAD_DETECT
//    rather than being silently skipped (Rule 4, fail closed).
//
//    Every SECTORS node's compiled global variant is precomputed ONCE below, before the
//    deep-freeze pass, and exposed as a `detectGlobal` sibling alongside the untouched `detect`
//    source (so existing vocabulary tests reading `.detect` stay green). facts/sector.js reads
//    `detectGlobal` directly for the shipped tree and never constructs a RegExp of its own; this
//    function remains the fallback compiler for any vocabulary it is handed at runtime (an
//    injected test tree, or a raw string detect).
//
//    A frozen GLOBAL regex is safe to share and reuse across calls with String.matchAll (the
//    spec clones the regex internally and only READS the shared object's lastIndex, which stays
//    0 forever on a frozen object); it is NOT safe with .test()/.exec(), which WRITE lastIndex on
//    the object itself and throw on a frozen one. facts/sector.js's matchAll-based scorer relies
//    on the former; its single `.test()` call site (resolveSubSector) uses the plain, non-global
//    `detect` source directly instead, never the global variant.
// =================================================================================

function compileDetectGlobal(detect) {
  if (detect instanceof RegExp) {
    // detect.source already compiled successfully once (it is a live RegExp instance from the
    // shipped SECTORS tree or an injected test vocabulary, never a raw untrusted string here);
    // re-deriving the global+case-insensitive variant cannot introduce a new failure mode.
    const flags = detect.flags.includes('g') ? detect.flags : detect.flags + 'g';
    return new RegExp(detect.source, flags.includes('i') ? flags : flags + 'i');
  }
  if (typeof detect === 'string' && detect) {
    // detect is vocabulary-controlled (the shipped SECTORS tree or an injected test tree), never
    // network/runtime input: compiling it here is this function's whole purpose (deriving the
    // global scorer variant facts/sector.js needs). A malformed pattern fails loud and typed
    // (E_VOCABULARY_BAD_DETECT below), never silently, per Constitution Rule 4.
    try {
      return new RegExp(detect, 'gi');
    } catch (err) {
      const e = new Error(
        'facts/vocabulary.js compileDetectGlobal: detect pattern does not compile: '
        + JSON.stringify(detect) + ' (' + String(err && err.message) + ')'
      );
      e.code = 'E_VOCABULARY_BAD_DETECT';
      throw e;
    }
  }
  return null;
}

// Precompile the shipped tree's global variants before the deep-freeze pass at the foot of this
// module; never re-compiled at request time.
for (const _node of Object.values(SECTORS)) {
  if (_node.detect) _node.detectGlobal = compileDetectGlobal(_node.detect);
  for (const _sub of Object.values(_node.sub || {})) {
    if (_sub.detect) _sub.detectGlobal = compileDetectGlobal(_sub.detect);
  }
}

// Sector alias fold: any variant sourcing might emit -> a canonical top-level SECTORS key.
// Ported from registry/sector.js SECTOR_ALIASES, keeping only aliases whose target exists as a
// canonical parent node here (so canonicalSector always returns a real tree key or null).
const SECTOR_ALIASES = {
  barrister: 'barristers', conveyancer: 'law-firms', solicitor: 'law-firms', lawyer: 'law-firms',
  accountant: 'accounting', dentist: 'dental', 'estate-agent': 'real-estate', optician: 'healthcare',
  aesthetic: 'aesthetics', health: 'healthcare', technology: 'tech', 'financial-services': 'finance',
  legal: 'law-firms', law: 'law-firms', financial: 'finance', realestate: 'real-estate',
  wellness: 'fitness', fb: 'hospitality', clinic: 'healthcare', cosmetic: 'aesthetics',
  dermatology: 'aesthetics', 'medical-aesthetics': 'aesthetics', 'plastic-surgery': 'aesthetics',
  wealth: 'finance', investment: 'finance', lending: 'finance', crypto: 'finance', travel: 'hospitality',
  hotel: 'hospitality', hospitals: 'healthcare', hospital: 'healthcare', pharmacy: 'healthcare',
  telemedicine: 'healthcare', 'care-home': 'healthcare', 'care-homes': 'healthcare',
  restaurant: 'hospitality', gym: 'fitness', logistics: 'transport', airline: 'aviation',
  advertising: 'marketing', seo: 'marketing', shop: 'ecommerce', 'e-commerce': 'ecommerce',
  software: 'tech', it: 'tech', builder: 'construction', school: 'education', university: 'education',
  charitable: 'charity', 'non-profit': 'charity', nonprofit: 'charity', ngo: 'charity',
};

// The canonical sector set: the top-level nodes of the SECTORS tree. isCanonicalSector is a pure
// membership test; these keys are the ONLY sectors the served-cells manifest may reference.
const CANONICAL_SECTORS = Object.keys(SECTORS);
const CANONICAL_SECTOR_SET = new Set(CANONICAL_SECTORS);

// =================================================================================
// 2c. CANONICAL SUB-SECTORS (CR-36, CodeRabbit PR #3 on catalogue/schema.js#L105: "sector,
// sub-sector, jurisdiction and nexus identifiers come ONLY from facts/vocabulary.js"). A flat,
// deliberately RICHER vocabulary than the SECTORS tree's own `sub` detection nodes above: those
// nodes exist to CLASSIFY a crawled page from a handful of regex-detection sub-nodes per sector
// (schema.js's own header, scope decision 2, explains why enum-checking a catalogue record's
// sub_sector against THAT tree directly would reject almost every real record - a law-firms record
// authors 'attorney'/'conveyancing'/'notaries'/'immigration', none of which are detection-tree
// keys, because authoring a licensed-profession/activity taxonomy for LAW ATTACHMENT is a different
// job from detecting a sector from raw page text).
//
// This is the CANONICAL union catalogue/schema.js validates a record's sub_sector[] against: every
// SECTORS[x].sub key (so the detection tree's own vocabulary is always valid too) PLUS every
// sub_sector value actually authored across the six QA'd catalogue packs at the time this gate
// landed. Deliberately flat (not nested per top-level sector, matching schema.js's existing scope):
// a record's sub_sector[] is not required to nest under its own sector[] mapping. Adding a NEW
// sub_sector value to a future pack means adding it here first (one door, Constitution Rule 1) -
// exactly the same discipline `sector`/`activity_tags`/`required_nexus` already enforce.
const CANONICAL_SUB_SECTORS = [
  'aesthetics', 'ai-products', 'appliances', 'approved-inspectors', 'apps', 'attorney', 'banking',
  'barristers', 'boiler-installers', 'broadcast-catchup', 'builders', 'building-control',
  'building-materials', 'car-dealers', 'care-home', 'chambers', 'cilex', 'cloud-services',
  'communities', 'construction-products', 'consumer-products', 'content-studios', 'conveyancing',
  'cosmetic-dentistry', 'cosmetic-surgery', 'criminal-defence', 'demolition', 'dental',
  'digital-agencies', 'electronics', 'electronics-retail', 'email-marketing', 'employment',
  'energy-brokers', 'energy-suppliers', 'fertility', 'fertility-ivf', 'fintech', 'fire-consultants',
  'fitness-apps', 'forums', 'general', 'general-dental', 'general-practice', 'gp-clinic', 'gyms',
  'heating-engineers', 'higher-education', 'hospital', 'hospital-care', 'hotel', 'house-clearance',
  'hvac', 'ifa', 'immigration', 'influencer-marketing', 'injectables', 'insurance', 'it-services',
  'laser-skin', 'law-firm', 'law-firms', 'lead-generation', 'legal-executives', 'leisure-clubs',
  'lettings', 'licensed-conveyancers', 'lighting', 'local-news', 'machinery', 'magazines',
  'martial-arts', 'medical-devices', 'mental-health', 'motorbike-dealers', 'multi-state',
  'news-publishers', 'notaries', 'online-coaching', 'online-marketplace', 'online-travel',
  'optometry', 'orthodontics', 'personal-injury', 'personal-training', 'pharmaceutical', 'pharmacy',
  'physiotherapy', 'plumbers', 'ppe', 'probate', 'professional-services', 'property-management',
  'restaurant', 'saas', 'sales', 'school', 'search-engine', 'skip-hire', 'software-development',
  'solicitors', 'solo-practice', 'streaming', 'studios', 'supplements', 'telehealth', 'telemedicine',
  'tour-operators', 'toys', 'travel', 'travel-agents', 'ugc-platforms', 'van-sales',
  'vehicle-leasing', 'veterinary', 'video-sharing', 'vod', 'waste-removal', 'wealth-management',
  'weight-loss-programmes', 'wellness',
];
const CANONICAL_SUB_SECTOR_SET = new Set(CANONICAL_SUB_SECTORS);

// Sub-sector-exclusive bindings (registry/sector.js SUB_EXCLUSIVE): a marker that a downstream
// catalogue rule keyed to one sub-sector must never leak to a sibling. Data only, no law names.
const SUB_EXCLUSIVE = {
  insurance: { parent: 'finance', sub: 'insurance' },
  'fertility-ivf': { parent: 'healthcare', sub: 'fertility-ivf' },
  barristers: { parent: 'barristers', sub: 'general' },
  solicitors: { parent: 'law-firms', sub: 'solicitors' },
};

// DOMAIN self-identity tokens (the C-013 high-precision own-identity self-ID, applied to the ONE
// signal outside the visible body that names what a firm IS: its own registrable domain label).
// Each entry is [substring, sector-family]: an UNAMBIGUOUS profession word that, when it appears in
// a firm's domain, states the firm's own identity rather than an incidental body mention. Kept
// high-precision on purpose - these are words that essentially never appear inside an unrelated
// domain (a marketing agency is "seofor..." not "...solicitors..."), and facts/sector.js only ever
// lets a self-ID break the two-cue MARGIN, never resolve a sector on its own: the sector must still
// carry >= 2 distinct visible-text cues of that family, so a spurious substring corroborated by no
// body evidence changes nothing (deny-by-default and abstain stay intact).
//
// WHY (the immigrationlawyersusa class, caution C-006/C-013): a Miami immigration law firm whose
// domain, name and body all say "lawyers" was resolved EDUCATION, because its one attorney-bio page
// (high school, university, undergraduate, college) out-cued the firm's own legal identity in a raw
// body-token count. A firm's domain naming itself "immigrationlawyersusa" is stronger evidence of
// what it is than a paragraph about where a named lawyer went to school.
const DOMAIN_SELF_IDENTITY = [
  ['solicitors', 'law-firms'], ['solicitor', 'law-firms'],
  ['lawyers', 'law-firms'], ['lawyer', 'law-firms'],
  ['attorneys', 'law-firms'], ['attorney', 'law-firms'],
  ['lawfirm', 'law-firms'],
  ['barristers', 'barristers'], ['barrister', 'barristers'],
  ['dentists', 'healthcare'], ['dentist', 'healthcare'], ['dental', 'healthcare'], ['orthodont', 'healthcare'],
  ['aesthetics', 'healthcare'], ['aesthetic', 'healthcare'],
  ['pharmacy', 'healthcare'],
  ['accountants', 'accounting'], ['accountancy', 'accounting'], ['accountant', 'accounting'],
];

// sectorSelfIdFromDomain(domain) -> array of canonical sector-family keys the domain self-identifies
// with (usually zero or one). Pure: lowercases the domain and substring-matches the high-precision
// tokens above; the caller (facts/sector.js) folds the result against its live candidates. Returns
// families only; it NEVER attaches a sector by itself. A missing/odd domain yields an empty array.
function sectorSelfIdFromDomain(domain) {
  const d = String(domain == null ? '' : domain).toLowerCase();
  if (!d) return [];
  const fams = [];
  for (const [token, fam] of DOMAIN_SELF_IDENTITY) {
    if (d.indexOf(token) !== -1 && fams.indexOf(fam) === -1) fams.push(fam);
  }
  return fams;
}

// =================================================================================
// 3. JURISDICTION vocabulary (consumed by facts/jurisdiction.js via COUNTRY_TOKENS,
//    and by the wider facts layer via JURISDICTIONS / FAMILY_ALIAS / famCanon).
// =================================================================================

// Canonical jurisdiction codes the estate models. Display labels only, no law facts.
const JURISDICTIONS = {
  UK: 'United Kingdom',
  IE: 'Ireland',
  US: 'United States',
  EU: 'European Union',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  ES: 'Spain',
  IT: 'Italy',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  SG: 'Singapore',
  IN: 'India',
};

// The ONE family-alias fold (registry/jurisdiction.js FAMILY_ALIAS): country variants -> canonical
// family code. Every module that folds a jurisdiction variant reads this, never an inline copy.
const FAMILY_ALIAS = {
  GB: 'UK', GBR: 'UK', EN: 'UK', UAE: 'AE', USA: 'US', KSA: 'SA', SAU: 'SA',
};

function famCanon(j) {
  const u = String(j == null ? '' : j).toUpperCase().trim();
  return FAMILY_ALIAS[u] || u;
}

// COUNTRY_TOKENS: the jurisdiction module's data seam (facts/jurisdiction.js buildCountryTokens).
// It EXTENDS the module's internal token tables with additional regexes, keyed by jurisdiction
// code; only RegExp entries are consumed. These add NEW jurisdictions (CA/AU/NZ/ZA/SG/IN and the
// wider Gulf) that the internal table omits, and reinforce the modelled set with anchored
// full-name patterns. Every pattern is anchored (\b) so it can never fire mid-word; none loosens
// the establishment-anchoring the internal short-form guards enforce.
const COUNTRY_TOKENS = {
  SA: [/\bsaudi arabia\b/i, /\bkingdom of saudi arabia\b/i, /\bksa\b/i, /\briyadh\b/i, /\bjeddah\b/i],
  QA: [/\bqatar\b/i, /\bdoha\b/i],
  KW: [/\bkuwait\b/i],
  BH: [/\bbahrain\b/i, /\bmanama\b/i],
  OM: [/\boman\b/i, /\bmuscat\b/i],
  CA: [/\bcanada\b/i, /\btoronto\b/i, /\bontario\b/i],
  AU: [/\baustralia\b/i, /\bsydney\b/i, /\bmelbourne\b/i],
  NZ: [/\bnew zealand\b/i, /\baotearoa\b/i],
  ZA: [/\bsouth africa\b/i, /\bjohannesburg\b/i],
  SG: [/\bsingapore\b/i],
  IN: [/\bindia\b/i, /\bmumbai\b/i, /\bbengaluru\b/i],
};

// =================================================================================
// 4. SUB-JURISDICTIONS (US states, UK nations, UAE free zones). Ported from
//    registry/subjurisdiction.js, stripped of the specific privacy-law titles (those are
//    catalogue facts); only the structural sub-national codes and the free-zone displacement
//    routing token remain. DIFC/ADGM DISPLACE the AE federal data-protection regime (E-221):
//    at most one free zone attaches and DIFC takes precedence.
// =================================================================================

// Routing token the applicability layer reads (facts/jurisdiction.js AE_FEDERAL_DP_TOKEN). Not a
// law title: a marker that an established free zone displaces the onshore AE federal DP regime.
const AE_FEDERAL_DP_TOKEN = 'AE_FEDERAL_DATA_PROTECTION';

const SUB_JURISDICTIONS = {
  US: {
    // The comprehensive-privacy states the estate models, incl. the P5 US-wave five (CA/NY/TX/FL/IL).
    states: {
      CA: { name: 'California' }, NY: { name: 'New York' }, TX: { name: 'Texas' },
      FL: { name: 'Florida' }, IL: { name: 'Illinois' }, VA: { name: 'Virginia' },
      CO: { name: 'Colorado' }, CT: { name: 'Connecticut' }, UT: { name: 'Utah' },
      OR: { name: 'Oregon' }, MT: { name: 'Montana' }, WA: { name: 'Washington' },
      NE: { name: 'Nebraska' }, DE: { name: 'Delaware' }, NJ: { name: 'New Jersey' },
      MD: { name: 'Maryland' }, MN: { name: 'Minnesota' }, TN: { name: 'Tennessee' },
      IA: { name: 'Iowa' }, IN: { name: 'Indiana' }, NH: { name: 'New Hampshire' },
    },
  },
  UK: {
    // Devolved nations resolved from the postcode area; data protection is reserved (UK-wide).
    nations: {
      England: { name: 'England' },
      Scotland: { name: 'Scotland' },
      Wales: { name: 'Wales' },
      'Northern Ireland': { name: 'Northern Ireland' },
    },
  },
  AE: {
    // Free zones are a distinct typed nexus that DISPLACES the AE federal DP regime; at most one
    // attaches and DIFC takes precedence over ADGM (the E-221 doctrine).
    free_zones: {
      DIFC: { name: 'Dubai International Financial Centre', precedence: 1, displaces: [AE_FEDERAL_DP_TOKEN] },
      ADGM: { name: 'Abu Dhabi Global Market', precedence: 2, displaces: [AE_FEDERAL_DP_TOKEN] },
    },
    displacement_note:
      'DIFC and ADGM free-zone establishment displaces the onshore AE federal data-protection regime '
      + '(never a stack); at most one free zone attaches and DIFC takes precedence.',
  },
};

// =================================================================================
// 5. NEXUS types (registry/nexus.js NEXUS_TYPES) - the three GDPR Art.3 relations.
// =================================================================================
const NEXUS_TYPES = ['established_in', 'serves_customers_in', 'processes_residents_of'];
const NEXUS_TYPE_SET = new Set(NEXUS_TYPES);

// =================================================================================
// 6. ACTIVITY TAGS (consumed by facts/capabilities.js as the naming authority). The 14
//    capability predicates. capabilities.js fails closed at load if any emitted tag is not here.
// =================================================================================
const ACTIVITY_TAGS = [
  'b2c',
  'b2b_only',
  'ecommerce',
  'cookies_present',
  'runs_ads',
  'uses_ai',
  'payments',
  'ugc',
  'biometrics',
  'child_directed',
  'health_claims',
  'financial_promotion',
  'sells_food_online',
  'sells_travel_packages',
];
const ACTIVITY_TAG_SET = new Set(ACTIVITY_TAGS);

// =================================================================================
// 7. Grading enums shared across the facts layer.
//    CONFIDENCE_LEVELS matches identity/jurisdiction/sector/capabilities confidence grades.
//    FINDING_STATES is the closed three-value verdict enum (Constitution Rule 10).
// =================================================================================
const CONFIDENCE_LEVELS = ['register', 'corroborated', 'weak', 'abstain'];
const CONFIDENCE_LEVEL_SET = new Set(CONFIDENCE_LEVELS);

const FINDING_STATES = ['violation', 'needs_review', 'pass'];
const FINDING_STATE_SET = new Set(FINDING_STATES);

// =================================================================================
// 8. Validators (pure). isX are boolean; canonicalSector resolves; assertVocab FAILS CLOSED,
//    throwing on an unknown value or an unknown kind (Constitution Rule 4).
// =================================================================================

function isCanonicalSector(sector) {
  return CANONICAL_SECTOR_SET.has(String(sector == null ? '' : sector));
}

// isCanonicalSubSector(subSector) -> true only for a value in CANONICAL_SUB_SECTORS (CR-36). Exact
// membership, no alias-fold and no structural fallback (unlike canonicalSector above) - sub_sector
// values are already authored as flat lowercase-hyphen slugs and this validator exists to CLOSE the
// set, not to be forgiving about near-misses.
function isCanonicalSubSector(subSector) {
  return CANONICAL_SUB_SECTOR_SET.has(String(subSector == null ? '' : subSector));
}

// Resolve ANY sector string to its ONE canonical top-level sector, or null. alias -> canonical
// target; a known canonical -> itself; a variant that structurally contains a canonical key ->
// that key; otherwise null. Never guesses a default sector (deny-by-default doctrine).
function canonicalSector(sector) {
  let x = String(sector == null ? '' : sector).toLowerCase().trim().replace(/\s+/g, '-');
  if (!x) return null;
  if (Object.prototype.hasOwnProperty.call(SECTOR_ALIASES, x)) x = SECTOR_ALIASES[x];
  if (CANONICAL_SECTOR_SET.has(x)) return x;
  // structural fallback: a longer variant that contains a canonical key ("law-firms-london").
  for (const key of CANONICAL_SECTORS) {
    if (x === key || x.indexOf(key) !== -1) return key;
  }
  return null;
}

function isJurisdiction(code) {
  return Object.prototype.hasOwnProperty.call(JURISDICTIONS, famCanon(code));
}

function isActivityTag(tag) {
  return ACTIVITY_TAG_SET.has(String(tag == null ? '' : tag));
}

function isConfidenceLevel(level) {
  return CONFIDENCE_LEVEL_SET.has(String(level == null ? '' : level));
}

function isFindingState(state) {
  return FINDING_STATE_SET.has(String(state == null ? '' : state));
}

function isNexusType(type) {
  return NEXUS_TYPE_SET.has(String(type == null ? '' : type));
}

// assertVocab(kind, value): fail-closed guard. Returns the value on success; THROWS on an unknown
// kind or an unknown value. Ambiguity never resolves to a default (Constitution Rules 4 + 6).
const VOCAB_CHECKS = {
  sector: isCanonicalSector,
  jurisdiction: isJurisdiction,
  activity_tag: isActivityTag,
  confidence: isConfidenceLevel,
  finding_state: isFindingState,
  nexus: isNexusType,
};

function assertVocab(kind, value) {
  const check = VOCAB_CHECKS[String(kind == null ? '' : kind)];
  if (!check) {
    throw new Error(
      'facts/vocabulary.js assertVocab: unknown vocabulary kind ' + JSON.stringify(kind)
      + '; known kinds: ' + Object.keys(VOCAB_CHECKS).join(', ')
    );
  }
  if (!check(value)) {
    throw new Error(
      'facts/vocabulary.js assertVocab: ' + JSON.stringify(value)
      + ' is not a valid ' + kind + ' (fail closed; unknown vocabulary is never defaulted)'
    );
  }
  return value;
}

// =================================================================================
// Deep-freeze every exported structure, then export. Consumers cannot mutate the vocabulary.
// =================================================================================
const EXPORTS = {
  // identity lists (facts/identity.js REQUIRED_VOCABULARY_EXPORTS)
  GENERIC_PAGE_TERMS,
  LEGAL_ENTITY_SUFFIXES,
  MARKETING_TAIL_TERMS,
  REGULATED_BY_PHRASES,
  COMPANY_NUMBER_CONTEXT_TERMS,
  PUBLIC_SUFFIX_SECOND_LEVEL,
  TITLE_SMALL_WORDS,
  KEEP_UPPERCASE_TOKENS,
  // sector tree (facts/sector.js reads TREE; SECTORS is the same object)
  TREE: SECTORS,
  SECTORS,
  SECTOR_ALIASES,
  CANONICAL_SECTORS,
  CANONICAL_SUB_SECTORS,
  SUB_EXCLUSIVE,
  DOMAIN_SELF_IDENTITY,
  sectorSelfIdFromDomain,
  // regex compilation door (facts/sector.js delegates every detect-pattern compilation here)
  compileDetectGlobal,
  // jurisdiction (facts/jurisdiction.js reads COUNTRY_TOKENS)
  JURISDICTIONS,
  SUB_JURISDICTIONS,
  COUNTRY_TOKENS,
  FAMILY_ALIAS,
  AE_FEDERAL_DP_TOKEN,
  // shared enums
  NEXUS_TYPES,
  ACTIVITY_TAGS,
  CONFIDENCE_LEVELS,
  FINDING_STATES,
  // validators (functions are frozen but not deep-frozen)
  famCanon,
  canonicalSector,
  isCanonicalSector,
  isCanonicalSubSector,
  isJurisdiction,
  isActivityTag,
  isConfidenceLevel,
  isFindingState,
  isNexusType,
  assertVocab,
};

for (const key of Object.keys(EXPORTS)) {
  if (typeof EXPORTS[key] !== 'function') deepFreeze(EXPORTS[key]);
}

module.exports = EXPORTS;
