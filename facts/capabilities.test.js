'use strict';
// facts/capabilities.test.js - node:test suite for the CAPABILITIES single door.
// Run: node --test facts/
// Covers: regex self-health (the C-050 dead-regex class), verbatim-quotable evidence
// (Gate-2 style exact re-match), honest UNKNOWN defaults, the b2c/b2b_only suppressor
// pair (C-058), the uses_ai blog exclusion, smb_likely exclusion thresholds (C-071),
// register corroboration limits (C-060), fail-closed input validation, determinism,
// and the two known-bad calibration fixtures under eval/calibration-known-bad/fixtures/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  deriveCapabilities,
  CAPABILITY_TAGS,
  SIGNALS,
  LARGE_ORG_SIGNALS,
  FOOD_CONTEXT_RE,
  FOOD_ORDER_RE,
  MIN_PAGES_FOR_ABSENCE,
} = require('./capabilities.js');

const FIXTURES_DIR = path.resolve(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures');

function page(url, text, jsonLd) {
  return { url, title: '', text, jsonLd: jsonLd || [] };
}

function bundleOf(pages, extra) {
  return Object.assign({ domain: 'example.co.uk', corpus: { pages }, registers: {} }, extra || {});
}

// Filler pages so absence-dependent logic has a deep-enough corpus without adding signals.
function fillerPages(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(page('https://example.co.uk/page-' + i, 'General information about our work and how to get in touch with the team.'));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regex self-health: every signal must match its own declared positive sample
// (a regex that cannot match its own positive is the C-050 dead-regex disease).
// ---------------------------------------------------------------------------
test('every signal regex matches its declared positive sample', () => {
  for (const tag of Object.keys(SIGNALS)) {
    for (const signal of SIGNALS[tag]) {
      assert.ok(signal.re.test(signal.positive), tag + '.' + signal.id + ' must match its positive: ' + signal.positive);
      assert.equal(signal.re.global, false, tag + '.' + signal.id + ' must not be a global regex (lastIndex state)');
    }
  }
  for (const signal of LARGE_ORG_SIGNALS) {
    assert.ok(signal.re.test(signal.positive), 'smb_likely.' + signal.id + ' must match its positive');
  }
  assert.ok(FOOD_CONTEXT_RE.test('see our menu'), 'food context regex health');
  assert.ok(FOOD_ORDER_RE.test('order online today'), 'food order regex health');
});

test('emitted tag set is exactly the specified capability vocabulary', () => {
  assert.deepEqual(
    [...CAPABILITY_TAGS].sort(),
    ['b2b_only', 'b2c', 'biometrics', 'child_directed', 'cookies_present', 'ecommerce',
      'financial_promotion', 'health_claims', 'payments', 'runs_ads', 'sells_food_online',
      'sells_travel_packages', 'ugc', 'uses_ai'].sort()
  );
});

test('if facts/vocabulary.js exists, every capability tag is in its ACTIVITY_TAGS', (t) => {
  const vocabPath = path.resolve(__dirname, 'vocabulary.js');
  if (!fs.existsSync(vocabPath)) {
    t.skip('facts/vocabulary.js not present yet (parallel build); capabilities.js records vocabularyFailure');
    return;
  }
  // If the file exists, capabilities.js already threw at load on any drift; assert the link flag.
  const fresh = require('./capabilities.js');
  assert.equal(fresh.VOCABULARY_LINKED, true);
});

// ---------------------------------------------------------------------------
// Honest defaults and input validation
// ---------------------------------------------------------------------------
test('a signal-free corpus yields unknown/abstain for every predicate', () => {
  const result = deriveCapabilities(bundleOf([page('https://example.co.uk/', 'Welcome to our website.')]));
  for (const tag of CAPABILITY_TAGS) {
    assert.equal(result.predicates[tag].present, 'unknown', tag + ' must default to unknown');
    assert.equal(result.predicates[tag].confidence, 'abstain', tag + ' must default to abstain');
    assert.deepEqual(result.predicates[tag].evidence, [], tag + ' must carry no evidence');
  }
  // One page is below the absence floor: smb_likely must abstain too.
  assert.equal(result.exclusions.smb_likely.value, 'unknown');
  assert.equal(result.exclusions.smb_likely.confidence, 'abstain');
});

test('malformed bundles fail closed with a TypeError', () => {
  assert.throws(() => deriveCapabilities(null), TypeError);
  assert.throws(() => deriveCapabilities({}), TypeError);
  assert.throws(() => deriveCapabilities({ corpus: {} }), TypeError);
  assert.throws(() => deriveCapabilities({ corpus: { pages: 'not-an-array' } }), TypeError);
});

test('pages without usable text are skipped, not fatal', () => {
  const result = deriveCapabilities(bundleOf([
    { url: 'https://example.co.uk/broken' },
    page('https://example.co.uk/', 'Add to basket and proceed to checkout.'),
  ]));
  assert.equal(result.meta.pagesScanned, 1);
  assert.equal(result.predicates.b2c.present, true);
});

// ---------------------------------------------------------------------------
// Verbatim-quotable evidence (Gate-2 discipline)
// ---------------------------------------------------------------------------
test('every corpus evidence quote is an exact substring of the scanned page text', () => {
  const texts = {
    'https://example.co.uk/shop': 'Browse the range, Add To Basket, then Proceed to Checkout. Free returns on every order. We accept Visa and Mastercard.',
    'https://example.co.uk/help': 'We use cookies to run the site. Read our Cookie Policy. Leave a review of your visit.',
  };
  const result = deriveCapabilities(bundleOf(Object.keys(texts).map((u) => page(u, texts[u]))));
  let quotesChecked = 0;
  for (const tag of CAPABILITY_TAGS) {
    for (const ev of result.predicates[tag].evidence) {
      if (ev.kind !== 'corpus' || !ev.quote) continue;
      assert.ok(texts[ev.source].includes(ev.quote), tag + ' quote must be verbatim: ' + ev.quote);
      quotesChecked += 1;
    }
  }
  assert.ok(quotesChecked >= 4, 'expected several verbatim quotes, got ' + quotesChecked);
});

// ---------------------------------------------------------------------------
// b2c / b2b_only suppressor pair (C-058)
// ---------------------------------------------------------------------------
test('b2c true on real consumer transaction signals, corroborated across signals', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/shop', 'Add to basket now. Free returns within 30 days.'),
  ]));
  assert.equal(result.predicates.b2c.present, true);
  assert.equal(result.predicates.b2c.confidence, 'corroborated');
  assert.equal(result.predicates.b2b_only.present, false);
});

test('C-058 traps never fire b2c: consultation and customer language is not consumer evidence', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/', 'Book a consultation today. Our customers trust us. Talk to our customer services team.'),
  ]));
  assert.equal(result.predicates.b2c.present, 'unknown');
});

test('b2b_only true only with explicit b2b language, no consumer signals, and a deep corpus', () => {
  const pages = fillerPages(2).concat([
    page('https://example.co.uk/about', 'We are a business-to-business supplier. Business customers only.'),
  ]);
  const result = deriveCapabilities(bundleOf(pages));
  assert.equal(result.predicates.b2b_only.present, true);
  assert.equal(result.predicates.b2b_only.confidence, 'corroborated');
  assert.equal(result.predicates.b2c.present, false);
});

test('b2b_only abstains when the corpus is too thin to prove the absence half', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/', 'We are a business-to-business supplier.'),
  ]));
  assert.equal(result.predicates.b2b_only.present, 'unknown');
  assert.equal(result.predicates.b2b_only.confidence, 'abstain');
  assert.ok(result.predicates.b2b_only.evidence.length >= 1, 'the b2b signal is still recorded as context');
  assert.ok(MIN_PAGES_FOR_ABSENCE > 1);
});

test('consumer signals defeat b2b_only even when b2b language is present', () => {
  const pages = fillerPages(2).concat([
    page('https://example.co.uk/', 'A B2B platform. Also: add to basket for instant purchase.'),
  ]);
  const result = deriveCapabilities(bundleOf(pages));
  assert.equal(result.predicates.b2c.present, true);
  assert.equal(result.predicates.b2b_only.present, false);
});

// ---------------------------------------------------------------------------
// uses_ai: product signal only, never blog prose
// ---------------------------------------------------------------------------
test('uses_ai fires on a real product signal outside blog paths', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/product', 'Meet our AI assistant. The AI-powered engine drafts your reports.'),
  ]));
  assert.equal(result.predicates.uses_ai.present, true);
  assert.equal(result.predicates.uses_ai.confidence, 'corroborated');
});

test('uses_ai never fires on blog pages or the bare word AI', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/blog/ai-trends', 'AI-powered tools are everywhere. Generative AI will change everything.'),
    page('https://example.co.uk/services', 'We advise on strategy. Read our thinking about AI.'),
  ]));
  assert.equal(result.predicates.uses_ai.present, 'unknown');
});

// ---------------------------------------------------------------------------
// Compound and structured signals
// ---------------------------------------------------------------------------
test('sells_food_online needs food context AND an ordering action on the same page', () => {
  const foodOnly = deriveCapabilities(bundleOf([page('https://example.co.uk/', 'See our menu and our dishes.')]));
  assert.equal(foodOnly.predicates.sells_food_online.present, 'unknown');

  const orderOnly = deriveCapabilities(bundleOf([page('https://example.co.uk/', 'Order online for next-day dispatch of stationery.')]));
  assert.equal(orderOnly.predicates.sells_food_online.present, 'unknown');

  const both = deriveCapabilities(bundleOf([page('https://example.co.uk/', 'Browse the takeaway menu and order online for delivery.')]));
  assert.equal(both.predicates.sells_food_online.present, true);
  assert.equal(both.predicates.sells_food_online.confidence, 'weak');
});

test('jsonLd Product-with-offers is ecommerce evidence with kind jsonld', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/p/widget', 'A quality widget for the discerning buyer.', [
      { '@type': 'Product', name: 'Widget', offers: { '@type': 'Offer', price: '19.99' } },
    ]),
  ]));
  assert.equal(result.predicates.ecommerce.present, true);
  assert.equal(result.predicates.ecommerce.evidence[0].kind, 'jsonld');
});

test('unparseable jsonLd strings are recorded as typed failures, never swallowed', () => {
  const result = deriveCapabilities(bundleOf([
    page('https://example.co.uk/', 'Plain page.', ['{not json']),
  ]));
  assert.equal(result.meta.failures.length, 1);
  assert.equal(result.meta.failures[0].stage, 'jsonld-parse');
});

// ---------------------------------------------------------------------------
// Register corroboration (C-060: registers strengthen, never create)
// ---------------------------------------------------------------------------
test('an FCA register row corroborates an on-site financial promotion quote', () => {
  const withQuote = deriveCapabilities(bundleOf(
    [page('https://example.co.uk/invest', 'Your capital is at risk.')],
    { registers: { fca: { frn: '123456' } } }
  ));
  assert.equal(withQuote.predicates.financial_promotion.present, true);
  assert.equal(withQuote.predicates.financial_promotion.confidence, 'corroborated');
  assert.ok(withQuote.predicates.financial_promotion.evidence.some((ev) => ev.kind === 'register'));
});

test('a register row alone never flips a content predicate to true', () => {
  const registerOnly = deriveCapabilities(bundleOf(
    [page('https://example.co.uk/', 'General information about the firm.')],
    { registers: { fca: { frn: '123456' }, cqc: { locationId: 'X' } } }
  ));
  assert.equal(registerOnly.predicates.financial_promotion.present, 'unknown');
  assert.equal(registerOnly.predicates.financial_promotion.confidence, 'abstain');
  assert.equal(registerOnly.predicates.health_claims.present, 'unknown');
});

// ---------------------------------------------------------------------------
// smb_likely exclusion signal (C-071 consumers)
// ---------------------------------------------------------------------------
test('smb_likely true (weak) on a deep single-site corpus with no group signals', () => {
  const result = deriveCapabilities(bundleOf(fillerPages(MIN_PAGES_FOR_ABSENCE)));
  assert.equal(result.exclusions.smb_likely.value, true);
  assert.equal(result.exclusions.smb_likely.confidence, 'weak');
  assert.equal(result.exclusions.smb_likely.evidence[0].kind, 'absence');
});

test('group/multi-office signals defeat smb_likely with verbatim evidence', () => {
  const result = deriveCapabilities(bundleOf(fillerPages(2).concat([
    page('https://example.co.uk/about', 'Our offices in London, Manchester and Dubai serve the group of companies.'),
  ])));
  assert.equal(result.exclusions.smb_likely.value, false);
  assert.equal(result.exclusions.smb_likely.confidence, 'corroborated');
  assert.ok(result.exclusions.smb_likely.evidence.every((ev) => ev.quote || ev.kind === 'register'));
});

test('a plc register row defeats smb_likely at register confidence', () => {
  const result = deriveCapabilities(bundleOf(
    fillerPages(MIN_PAGES_FOR_ABSENCE),
    { registers: { companiesHouse: { companyType: 'plc' } } }
  ));
  assert.equal(result.exclusions.smb_likely.value, false);
  assert.equal(result.exclusions.smb_likely.confidence, 'register');
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------
test('deriveCapabilities is deterministic for identical bundles', () => {
  const make = () => bundleOf([
    page('https://example.co.uk/shop', 'Add to basket. We accept Visa. We use cookies.'),
    page('https://example.co.uk/blog/post', 'Thoughts about generative AI.'),
  ]);
  assert.deepEqual(deriveCapabilities(make()), deriveCapabilities(make()));
});

// ---------------------------------------------------------------------------
// Known-bad calibration fixtures (eval/calibration-known-bad/fixtures/p1-capabilities-*)
// exercised on every test run: the module must hold its expectations on each.
// ---------------------------------------------------------------------------
const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => /^p1-capabilities-.*\.json$/.test(f));

test('at least two p1-capabilities calibration fixtures exist', () => {
  assert.ok(fixtureFiles.length >= 2, 'expected p1-capabilities-*.json fixtures in ' + FIXTURES_DIR);
});

for (const file of fixtureFiles) {
  test('calibration fixture holds: ' + file, () => {
    const doc = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    assert.ok(doc.bundle, file + ' must carry a bundle');
    assert.ok(doc._expectations && doc._expectations.predicates, file + ' must carry expectations');
    const result = deriveCapabilities(doc.bundle);
    for (const tag of Object.keys(doc._expectations.predicates)) {
      const expectation = doc._expectations.predicates[tag];
      const predicate = result.predicates[tag];
      assert.ok(predicate, file + ': predicate ' + tag + ' missing from output');
      if (Object.prototype.hasOwnProperty.call(expectation, 'never')) {
        assert.notEqual(predicate.present, expectation.never, file + ': ' + tag + ' must never be ' + expectation.never);
      }
      if (Array.isArray(expectation.present_one_of)) {
        assert.ok(
          expectation.present_one_of.includes(predicate.present),
          file + ': ' + tag + ' present=' + JSON.stringify(predicate.present) + ' not in ' + JSON.stringify(expectation.present_one_of)
        );
      }
      if (predicate.present === true) {
        assert.ok(predicate.evidence.length > 0, file + ': a true ' + tag + ' must carry evidence');
        for (const ev of predicate.evidence) {
          if (ev.kind !== 'corpus' || !ev.quote) continue;
          const pages = doc.bundle.corpus.pages || [];
          const texts = pages.map((p) => p.text).concat([doc.bundle.corpus.footerText || '']);
          assert.ok(texts.some((txt) => typeof txt === 'string' && txt.includes(ev.quote)),
            file + ': evidence quote for ' + tag + ' must be verbatim in the fixture corpus');
        }
      }
    }
  });
}
