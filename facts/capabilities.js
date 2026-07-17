'use strict';
/**
 * facts/capabilities.js - the ONE producer of the CAPABILITIES fact.
 *
 * Evidence-backed activity predicates that gate capability-scoped laws. This module
 * exists to kill the caution class where capability-scoped law attached on vibes:
 * the EU AI Act attached to a dentist, Modern Slavery reporting duties attached to
 * SMEs, and consumer law re-attached to the B2B firms it meant to exclude (caution.md
 * C-055, C-057, C-058, C-060, C-071).
 *
 * Contract:
 *   deriveCapabilities(evidenceBundle) -> {
 *     fact: 'CAPABILITIES',
 *     predicates: { <tag>: { tag, present: true|false|'unknown',
 *                            confidence: 'register'|'corroborated'|'weak'|'abstain',
 *                            evidence: [{ kind, source, url?, signal?, quote? }] } },
 *     exclusions: { smb_likely: { value, confidence, evidence } },
 *     meta: {...}
 *   }
 *
 * Doctrine (constitution Rules 3, 4, 6, 13; caution.md sections 1-3):
 *  - UNKNOWN is honest and the default. A predicate is true only on a verbatim-quotable
 *    signal: every corpus evidence quote is an exact substring of the scanned page text,
 *    so it survives a Gate-2 style exact re-match.
 *  - present:false is itself a claim and is only asserted where the corpus is deep
 *    enough (MIN_PAGES_FOR_ABSENCE) and a positive counter-signal exists (the
 *    b2c/b2b_only pair), never as a casual absence.
 *  - Trigger tokens are word-boundary anchored (C-059); every signal regex ships with
 *    its own positive sample and the test suite proves each regex matches it (C-050).
 *  - Registers never flip a content predicate to true on their own; a register row can
 *    only corroborate an on-site quote (C-060: a structured signal never satisfies a
 *    content trigger without a real subject match in the corpus).
 *  - Pure function over the EvidenceBundle. No network, no clock, no environment.
 *  - Upstream gates this module relies on (documented, not re-implemented here):
 *    page.text must be stripped visible text (C-012) and non-English corpora must be
 *    gated to compliance_unassessed before facts run (C-022).
 *
 * Vocabulary linkage: the ACTIVITY_TAGS vocabulary in facts/vocabulary.js is the
 * naming authority. When that module is present, this module fails closed at load if
 * any tag emitted here is not in the vocabulary (drift guard). If the module file is
 * absent (parallel build), the degradation is typed and visible via VOCABULARY_LINKED
 * and meta.vocabularyLinked, never silent.
 */

const CAPABILITY_TAGS = Object.freeze([
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
]);

// ---------------------------------------------------------------------------
// Vocabulary linkage (fail closed on drift; typed degradation on absence).
// ---------------------------------------------------------------------------
let VOCABULARY_LINKED = false;
let VOCABULARY_FAILURE = null; // typed failure state, never a silent swallow
(function linkVocabulary() {
  let vocab = null;
  try {
    vocab = require('./vocabulary.js');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('vocabulary')) {
      VOCABULARY_FAILURE = 'vocabulary-module-missing';
      return; // parallel-build degradation: typed, surfaced in every output's meta
    }
    throw err; // any other load error is a real defect: fail closed
  }
  const raw = vocab.ACTIVITY_TAGS;
  let tags = null;
  if (raw instanceof Set) tags = new Set(raw);
  else if (Array.isArray(raw)) {
    tags = new Set(raw.map((t) => (typeof t === 'string' ? t : t && (t.tag || t.id))).filter(Boolean));
  } else if (raw && typeof raw === 'object') tags = new Set(Object.keys(raw));
  if (!tags || tags.size === 0) {
    throw new Error('facts/capabilities.js: facts/vocabulary.js is present but ACTIVITY_TAGS is unreadable; failing closed');
  }
  const missing = CAPABILITY_TAGS.filter((t) => !tags.has(t));
  if (missing.length) {
    throw new Error('facts/capabilities.js: tags not in vocabulary ACTIVITY_TAGS (drift): ' + missing.join(', '));
  }
  VOCABULARY_LINKED = true;
})();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Minimum pages actually scanned before ANY absence-flavoured inference (b2b_only's
// "no consumer signals" half, smb_likely's "no group signals") may be made. Hard
// floor in code, no environment override (C-024, C-025, C-026).
const MIN_PAGES_FOR_ABSENCE = 3;
const MAX_QUOTE_CHARS = 240;
const MAX_EVIDENCE_PER_PREDICATE = 6;

// Pages that must never satisfy uses_ai: the word "AI" in a blog post is commentary,
// not a product signal (task spec; C-047 concept: subject trigger, not ambient prose).
const BLOG_PATH_RE = /\/(blog|news|insights?|articles?|resources|press|journal)([/?#]|$)/i;

// ---------------------------------------------------------------------------
// Signals. Every entry: { id, re, positive } where `positive` is a sample the
// regex MUST match (regex self-health, tested; the C-050 dead-regex class).
// All regexes are word-boundary anchored (C-059) and deliberately contextual:
// none may fire on "book a consultation" or "our customers" (C-058) or on the
// bare word "AI".
// ---------------------------------------------------------------------------
const SIGNALS = Object.freeze({
  b2c: [
    { id: 'add_to_basket', re: /\badd to (basket|cart|bag)\b/i, positive: 'Add to basket' },
    { id: 'checkout', re: /\b(proceed to checkout|secure checkout|checkout now)\b/i, positive: 'Proceed to checkout' },
    { id: 'buy_now', re: /\bbuy (now|online)\b/i, positive: 'Buy now' },
    { id: 'consumer_terms', re: /\b(consumer rights?|cooling[- ]off period|distance selling)\b/i, positive: 'your consumer rights' },
    { id: 'returns', re: /\b(free returns|returns? policy|30[- ]day (money[- ]back|returns?))\b/i, positive: 'free returns on all orders' },
    { id: 'individuals', re: /\bfor (individuals|families|households)\b/i, positive: 'plans for individuals' },
  ],
  b2b_only: [
    { id: 'b2b', re: /\b(b2b|business[- ]to[- ]business)\b/i, positive: 'a B2B payments company' },
    { id: 'trade_only', re: /\b(trade (customers )?only|wholesale only|business (customers|clients) only|exclusively for businesses)\b/i, positive: 'Business customers only' },
    { id: 'exclusive', re: /\bwe (work|partner) (exclusively|only) with (businesses|companies|enterprises|organisations)\b/i, positive: 'we work exclusively with companies' },
    { id: 'for_businesses', re: /\b(built|designed|solutions) for (businesses|enterprises|smes|companies)\b/i, positive: 'Built for businesses' },
  ],
  ecommerce: [
    { id: 'add_to_basket', re: /\badd to (basket|cart|bag)\b/i, positive: 'add to cart' },
    { id: 'online_store', re: /\bonline (store|shop)\b/i, positive: 'visit our online store' },
    { id: 'shopping_cart', re: /\bshopping (cart|basket)\b/i, positive: 'view your shopping basket' },
    { id: 'shipping', re: /\bfree (delivery|shipping) (on|over|for)\b/i, positive: 'free delivery on orders over 50' },
  ],
  cookies_present: [
    { id: 'we_use', re: /\bwe use cookies\b/i, positive: 'We use cookies to improve your experience' },
    { id: 'site_uses', re: /\bthis (web)?site uses cookies\b/i, positive: 'This website uses cookies' },
    { id: 'policy', re: /\bcookie (policy|settings|preferences|consent|banner)\b/i, positive: 'read our cookie policy' },
    { id: 'accept', re: /\b(accept|manage) (all )?cookies\b/i, positive: 'Accept all cookies' },
  ],
  runs_ads: [
    { id: 'advertise_with', re: /\badvertise with us\b/i, positive: 'Advertise with us' },
    { id: 'sponsored', re: /\bsponsored (content|post|listing|by)\b/i, positive: 'sponsored content' },
    { id: 'paid_partnership', re: /\bpaid partnership\b|#ad\b/i, positive: 'paid partnership with' },
    { id: 'ad_tech', re: /\b(remarketing|retargeting|advertising cookies|interest[- ]based advertising|personalised (ads|advertising))\b/i, positive: 'we use advertising cookies' },
  ],
  uses_ai: [
    { id: 'powered', re: /\b(ai[- ]powered|powered by (ai|artificial intelligence|machine learning|gpt))\b/i, positive: 'our AI-powered platform' },
    { id: 'our_ai', re: /\bour (ai|artificial intelligence|machine[- ]learning) (platform|assistant|model|engine|technology|tools?|algorithms?)\b/i, positive: 'our AI assistant' },
    { id: 'chatbot', re: /\b(chatbot|virtual assistant|ai assistant)\b/i, positive: 'talk to our chatbot' },
    { id: 'ml_product', re: /\b(machine[- ]learning|deep[- ]learning) (models?|platform|pipeline)\b/i, positive: 'a machine-learning model' },
    { id: 'genai', re: /\b(generative ai|ai[- ]generated (content|images?|responses?))\b/i, positive: 'generative AI features' },
  ],
  payments: [
    { id: 'pay_online', re: /\b(pay online|make a payment|payment portal)\b/i, positive: 'Pay online securely' },
    { id: 'methods', re: /\bpayment (methods|options)\b/i, positive: 'accepted payment methods' },
    { id: 'cards_accepted', re: /\bwe accept (visa|mastercard|american express|credit|debit)\b/i, positive: 'We accept Visa and Mastercard' },
    { id: 'processors', re: /\b(apple pay|google pay|paypal|klarna|direct debit)\b/i, positive: 'checkout with Apple Pay' },
    { id: 'card_payments', re: /\b(card payments?|pay by (card|credit card|debit card))\b/i, positive: 'we take card payments' },
  ],
  ugc: [
    { id: 'review_cta', re: /\b(leave|write|post) a (review|comment)\b/i, positive: 'Leave a review' },
    { id: 'forum', re: /\b(community forum|discussion (board|forum)|message board)\b/i, positive: 'join our community forum' },
    { id: 'submit', re: /\b(upload|submit|share) your (photos?|videos?|story|stories|content|experience)\b/i, positive: 'share your story' },
  ],
  biometrics: [
    { id: 'biometric', re: /\bbiometric (data|authentication|verification|identification|login)\b/i, positive: 'biometric verification' },
    { id: 'facial', re: /\bfacial recognition\b/i, positive: 'facial recognition' },
    { id: 'fingerprint', re: /\bfingerprint (scanning|recognition|authentication|reader)\b/i, positive: 'fingerprint authentication' },
    { id: 'iris', re: /\b(iris|retina) (scan(ning)?|recognition)\b/i, positive: 'iris scanning' },
    { id: 'voice', re: /\bvoice (recognition|biometrics)\b/i, positive: 'voice biometrics' },
  ],
  child_directed: [
    { id: 'for_children', re: /\bfor (kids|children)\b/i, positive: 'activities for children' },
    { id: 'age_band', re: /\b(children|kids) (aged|under) \d{1,2}\b/i, positive: 'children under 13' },
    { id: 'early_years', re: /\b(nursery|preschool|kindergarten)\b/i, positive: 'our nursery in Leeds' },
    { id: 'kids_offering', re: /\b(kids|children)['’]?s? (club|classes|zone|area)\b/i, positive: 'kids club every Saturday' },
  ],
  health_claims: [
    { id: 'clinically', re: /\bclinically (proven|shown|tested)\b/i, positive: 'clinically proven' },
    { id: 'guaranteed', re: /\bresults? (are )?guaranteed\b/i, positive: 'results guaranteed' },
    { id: 'boost', re: /\bboosts? (your )?(immune system|immunity|metabolism|energy levels)\b/i, positive: 'boosts your immune system' },
    { id: 'cure', re: /\bcures? (for )?[a-z]{3,}/i, positive: 'cures arthritis' },
    { id: 'treats_condition', re: /\b(treats?|treatment (of|for)) (acne|arthritis|anxiety|depression|pain|hair loss|wrinkles|migraines?|eczema|psoriasis)\b/i, positive: 'treatment for acne' },
    { id: 'anti_ageing', re: /\banti[- ]age?ing\b/i, positive: 'anti-ageing serum' },
    { id: 'detox', re: /\bdetox(ify|ification)?\b/i, positive: 'a 7-day detox' },
  ],
  financial_promotion: [
    { id: 'capital_risk', re: /\bcapital (is )?at risk\b/i, positive: 'your capital is at risk' },
    { id: 'apr', re: /\brepresentative \d+(\.\d+)?% apr\b|\brepresentative apr\b/i, positive: 'Representative 19.9% APR' },
    { id: 'returns', re: /\b(guaranteed returns?\b|returns? of \d+(\.\d+)?%|annual returns? (of|up to)\b)/i, positive: 'returns of 8%' },
    { id: 'invest', re: /\binvest(ment)? (opportunit(y|ies)|portfolio|platform|products?)\b/i, positive: 'an investment opportunity' },
    { id: 'isa_pension', re: /\b(stocks? and shares isa|isa allowance|pension (transfer|drawdown|pot)|annuit(y|ies))\b/i, positive: 'stocks and shares ISA' },
    { id: 'credit', re: /\b(buy now,? pay later|0% (apr|finance)|spread the cost|representative example)\b/i, positive: 'buy now pay later' },
    { id: 'frn', re: /\bfrn:? ?\d{6}\b/i, positive: 'FRN 123456' },
  ],
  sells_food_online: [
    { id: 'direct', re: /\border (food|takeaway|meals?|groceries) (online|now|for delivery)\b/i, positive: 'order food online' },
  ],
  sells_travel_packages: [
    { id: 'package', re: /\b(package holidays?|holiday packages?|all[- ]inclusive (holiday|package|resort)s?)\b/i, positive: 'package holidays to Spain' },
    { id: 'bonded', re: /\b(atol|abta) (protected|member(ship)?|number|no\.?)\b/i, positive: 'ATOL protected' },
    { id: 'tour_op', re: /\btour operator\b/i, positive: 'an independent tour operator' },
    { id: 'flight_hotel', re: /\bflight (\+|and|&) hotel\b/i, positive: 'flight + hotel deals' },
    { id: 'book_holiday', re: /\bbook your (holiday|trip|getaway|cruise)\b/i, positive: 'book your holiday today' },
  ],
});

// sells_food_online compound: a food-context token AND an ordering action on the SAME
// page. Neither alone is enough ("menu" on a print shop, "order online" on a florist).
const FOOD_CONTEXT_RE = /\b(menu|takeaway|restaurant|food delivery|meal kits?|groceries|dishes)\b/i;
const FOOD_ORDER_RE = /\b(order (online|now)|click (and|&) collect|add to (basket|cart|order)|delivery slots?)\b/i;

// smb_likely counter-signals: evidence of group/multi-office scale. Their PRESENCE
// defeats smb_likely; their absence (over a deep-enough corpus) supports it.
const LARGE_ORG_SIGNALS = Object.freeze([
  { id: 'multi_office', re: /\bour offices (in|across)\b/i, positive: 'our offices in London and Leeds' },
  { id: 'group', re: /\bgroup of companies\b/i, positive: 'part of a group of companies' },
  { id: 'subsidiaries', re: /\bsubsidiar(y|ies)\b/i, positive: 'and its subsidiaries' },
  { id: 'location_count', re: /\b\d{2,}\s+(locations|branches|offices|stores)\b/i, positive: '12 locations nationwide' },
  { id: 'global', re: /\b(global|international) (offices|presence|network of offices)\b/i, positive: 'a global presence' },
  { id: 'index_listed', re: /\b(fortune 500|ftse (100|250))\b/i, positive: 'a FTSE 100 company' },
]);

// ---------------------------------------------------------------------------
// Helpers (all pure)
// ---------------------------------------------------------------------------

// Typed failure recorder: every catch in this module routes through here so the
// degradation is visible on the emitted fact (meta.failures), never a silent swallow.
function recordFailure(failures, stage, source, err) {
  failures.push({ stage, source, error: String(err && err.message ? err.message : err) });
}

function clip(s) {
  const str = String(s);
  return str.length > MAX_QUOTE_CHARS ? str.slice(0, MAX_QUOTE_CHARS) : str;
}

function assertBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('deriveCapabilities: evidence bundle must be an object');
  }
  if (!bundle.corpus || typeof bundle.corpus !== 'object') {
    throw new TypeError('deriveCapabilities: bundle.corpus is required');
  }
  if (!Array.isArray(bundle.corpus.pages)) {
    throw new TypeError('deriveCapabilities: bundle.corpus.pages must be an array');
  }
}

// Build the scannable surfaces: pages with non-empty text, plus footerText.
function buildSurfaces(bundle) {
  const surfaces = [];
  for (const page of bundle.corpus.pages) {
    if (!page || typeof page.text !== 'string' || page.text.trim() === '') continue;
    const url = typeof page.url === 'string' ? page.url : '';
    surfaces.push({
      kind: 'corpus',
      source: url || 'page',
      url: url || null,
      text: page.text,
      jsonLd: Array.isArray(page.jsonLd) ? page.jsonLd : [],
      isBlog: url ? BLOG_PATH_RE.test(url) : false,
    });
  }
  const footer = bundle.corpus.footerText;
  if (typeof footer === 'string' && footer.trim() !== '') {
    surfaces.push({ kind: 'corpus', source: 'footerText', url: null, text: footer, jsonLd: [], isBlog: false });
  }
  return surfaces;
}

// First match of `re` in surface text, as a verbatim evidence entry.
function matchEvidence(tag, signal, surface) {
  const m = signal.re.exec(surface.text);
  if (!m) return null;
  const ev = { kind: 'corpus', source: surface.source, signal: tag + '.' + signal.id, quote: clip(m[0]) };
  if (surface.url) ev.url = surface.url;
  return ev;
}

function dedupeAndCap(evidence) {
  const seen = new Set();
  const out = [];
  for (const ev of evidence) {
    const key = (ev.signal || ev.kind) + '|' + (ev.source || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
    if (out.length >= MAX_EVIDENCE_PER_PREDICATE) break;
  }
  return out;
}

// Grade a TRUE/FALSE presence from its evidence. Two independent entries (a different
// signal or a different surface) earn 'corroborated'; one earns 'weak'.
function gradePresence(evidence) {
  if (!evidence.length) return 'abstain';
  const distinct = new Set(evidence.map((ev) => (ev.signal || ev.kind) + '|' + (ev.source || '')));
  return distinct.size >= 2 ? 'corroborated' : 'weak';
}

function unknownPredicate(tag, evidence) {
  return { tag, present: 'unknown', confidence: 'abstain', evidence: evidence || [] };
}

function collectCorpusEvidence(tag, surfaces) {
  const out = [];
  for (const signal of SIGNALS[tag] || []) {
    for (const surface of surfaces) {
      if (tag === 'uses_ai' && surface.isBlog) continue; // "AI" in a blog is not a product signal
      const ev = matchEvidence(tag, signal, surface);
      if (ev) out.push(ev);
    }
  }
  return out;
}

// sells_food_online compound scan: one evidence entry per page that has BOTH halves.
function collectFoodCompound(surfaces) {
  const out = [];
  for (const surface of surfaces) {
    const mOrder = FOOD_ORDER_RE.exec(surface.text);
    if (!mOrder) continue;
    const mFood = FOOD_CONTEXT_RE.exec(surface.text);
    if (!mFood) continue;
    const ev = {
      kind: 'corpus',
      source: surface.source,
      signal: 'sells_food_online.compound',
      quote: clip(mOrder[0]),
      context: clip(mFood[0]),
    };
    if (surface.url) ev.url = surface.url;
    out.push(ev);
  }
  return out;
}

// Structured commerce data: a schema.org Product with offers (or an Offer with a
// price) inside page jsonLd. Walks @graph one level; tolerates string entries with a
// typed parse-failure record, never a silent swallow.
function collectJsonLdCommerce(surfaces, failures) {
  const out = [];
  for (const surface of surfaces) {
    for (const raw of surface.jsonLd) {
      let node = raw;
      if (typeof raw === 'string') {
        try {
          node = JSON.parse(raw);
        } catch (err) {
          recordFailure(failures, 'jsonld-parse', surface.source, err);
          continue;
        }
      }
      if (!node || typeof node !== 'object') continue;
      const nodes = Array.isArray(node['@graph']) ? node['@graph'] : [node];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const types = [].concat(n['@type'] || []).map(String);
        const isProductWithOffers = types.includes('Product') && n.offers != null;
        const isPricedOffer = types.includes('Offer') && (n.price != null || n.priceSpecification != null);
        if (isProductWithOffers || isPricedOffer) {
          const ev = {
            kind: 'jsonld',
            source: surface.source,
            signal: 'ecommerce.jsonld_product_offers',
            quote: clip(JSON.stringify({ '@type': n['@type'], name: n.name, offers: isProductWithOffers ? true : undefined, price: n.price })),
          };
          if (surface.url) ev.url = surface.url;
          out.push(ev);
        }
      }
    }
  }
  return out;
}

function registerRowPresent(registers, key) {
  const row = registers && registers[key];
  return row != null && typeof row === 'object' && Object.keys(row).length > 0;
}

// ---------------------------------------------------------------------------
// smb_likely exclusion signal (consumed by excluded_when rules such as the
// Modern-Slavery turnover threshold class, C-071). Advisory by design: value true
// means "single-site, no group/multi-office evidence found across a deep-enough
// corpus", never a verified turnover figure.
// ---------------------------------------------------------------------------
function deriveSmbLikely(surfaces, registers, pagesScanned) {
  const largeEvidence = [];
  for (const signal of LARGE_ORG_SIGNALS) {
    for (const surface of surfaces) {
      const m = signal.re.exec(surface.text);
      if (m) {
        const ev = { kind: 'corpus', source: surface.source, signal: 'smb_likely.' + signal.id, quote: clip(m[0]) };
        if (surface.url) ev.url = surface.url;
        largeEvidence.push(ev);
      }
    }
  }
  let registerLarge = false;
  const ch = registers && registers.companiesHouse;
  if (ch && typeof ch === 'object') {
    const type = String(ch.companyType || ch.company_type || ch.type || '');
    if (/\bplc\b/i.test(type) || /public[- ]limited/i.test(type)) {
      registerLarge = true;
      largeEvidence.push({ kind: 'register', source: 'companiesHouse', signal: 'smb_likely.company_type', quote: clip(type) });
    }
  }
  if (largeEvidence.length) {
    const evidence = dedupeAndCap(largeEvidence);
    return { value: false, confidence: registerLarge ? 'register' : gradePresence(evidence), evidence };
  }
  if (pagesScanned >= MIN_PAGES_FOR_ABSENCE) {
    return {
      value: true,
      confidence: 'weak',
      evidence: [{ kind: 'absence', source: 'corpus', detail: 'no group/multi-office signal across ' + pagesScanned + ' scanned pages' }],
    };
  }
  return { value: 'unknown', confidence: 'abstain', evidence: [] };
}

// ---------------------------------------------------------------------------
// The single door
// ---------------------------------------------------------------------------
function deriveCapabilities(bundle) {
  assertBundle(bundle);
  const registers = bundle.registers && typeof bundle.registers === 'object' ? bundle.registers : {};
  const failures = [];
  const surfaces = buildSurfaces(bundle);
  const pagesScanned = surfaces.filter((s) => s.source !== 'footerText').length;

  // Corpus evidence per tag
  const corpusEv = {};
  for (const tag of CAPABILITY_TAGS) corpusEv[tag] = collectCorpusEvidence(tag, surfaces);
  corpusEv.sells_food_online = corpusEv.sells_food_online.concat(collectFoodCompound(surfaces));
  corpusEv.ecommerce = corpusEv.ecommerce.concat(collectJsonLdCommerce(surfaces, failures));

  // Register corroboration: a register row may only STRENGTHEN an on-site quote,
  // never create a true on its own (C-060).
  const registerCorroboration = { financial_promotion: 'fca', health_claims: 'cqc' };

  const predicates = {};
  for (const tag of CAPABILITY_TAGS) {
    if (tag === 'b2c' || tag === 'b2b_only') continue; // paired logic below
    let evidence = dedupeAndCap(corpusEv[tag]);
    const regKey = registerCorroboration[tag];
    const hasRegisterRow = regKey ? registerRowPresent(registers, regKey) : false;
    if (evidence.length > 0) {
      if (hasRegisterRow) {
        evidence = dedupeAndCap(evidence.concat([{ kind: 'register', source: regKey, signal: tag + '.register_row' }]));
      }
      predicates[tag] = { tag, present: true, confidence: gradePresence(evidence), evidence };
    } else if (hasRegisterRow) {
      // Register context without an on-site quote: honest abstention, context attached.
      predicates[tag] = unknownPredicate(tag, [{ kind: 'register', source: regKey, signal: tag + '.register_row' }]);
    } else {
      predicates[tag] = unknownPredicate(tag);
    }
  }

  // b2c / b2b_only pair. b2b_only is a SUPPRESSOR of consumer law, so it demands
  // explicit b2b language AND zero consumer signals AND a deep-enough corpus for the
  // absence half (C-058: "book a consultation" and "our customers" never count).
  const b2cEv = dedupeAndCap(corpusEv.b2c);
  const b2bEv = dedupeAndCap(corpusEv.b2b_only);
  if (b2cEv.length > 0) {
    predicates.b2c = { tag: 'b2c', present: true, confidence: gradePresence(b2cEv), evidence: b2cEv };
    predicates.b2b_only = { tag: 'b2b_only', present: false, confidence: gradePresence(b2cEv), evidence: b2cEv };
  } else if (b2bEv.length > 0 && pagesScanned >= MIN_PAGES_FOR_ABSENCE) {
    predicates.b2b_only = { tag: 'b2b_only', present: true, confidence: gradePresence(b2bEv), evidence: b2bEv };
    predicates.b2c = { tag: 'b2c', present: false, confidence: gradePresence(b2bEv), evidence: b2bEv };
  } else if (b2bEv.length > 0) {
    // Explicit b2b language but corpus too thin to assert the consumer-signal absence.
    predicates.b2b_only = unknownPredicate('b2b_only', b2bEv);
    predicates.b2c = unknownPredicate('b2c');
  } else {
    predicates.b2c = unknownPredicate('b2c');
    predicates.b2b_only = unknownPredicate('b2b_only');
  }

  return {
    fact: 'CAPABILITIES',
    producer: 'facts/capabilities.js',
    domain: typeof bundle.domain === 'string' ? bundle.domain : null,
    predicates,
    exclusions: { smb_likely: deriveSmbLikely(surfaces, registers, pagesScanned) },
    meta: {
      pagesScanned,
      footerScanned: surfaces.some((s) => s.source === 'footerText'),
      minPagesForAbsence: MIN_PAGES_FOR_ABSENCE,
      vocabularyLinked: VOCABULARY_LINKED,
      vocabularyFailure: VOCABULARY_FAILURE,
      failures,
    },
  };
}

module.exports = {
  deriveCapabilities,
  CAPABILITY_TAGS,
  SIGNALS,
  LARGE_ORG_SIGNALS,
  FOOD_CONTEXT_RE,
  FOOD_ORDER_RE,
  BLOG_PATH_RE,
  MIN_PAGES_FOR_ABSENCE,
  VOCABULARY_LINKED,
  VOCABULARY_FAILURE,
};
