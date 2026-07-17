'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for facts/jurisdiction.js.
//
// This is not planted bad code: it is the corpus of ADVERSARIAL INPUTS that destroyed the old
// engine, and the single door must refuse every trap on every run. Primary class: the Mills &
// Reeve ghost-US footer (caution.md C-009), where an unanchored /incorporated in/ judged six of
// seven real UK/EU/UAE law-firm footers "established in the United States" and served a UK firm
// US ABA rules. Also seeded: the fichtelegal DIFC-Courts advocacy class (C-010), the
// service-offer establishment class (C-011), the Tier-C-never-binds rule, the empty-register
// non-match (C-004) and the confident-default-jurisdiction disease (C-006).
//
// DIALECT (earn-your-zero polarity, matching eval/calibration-known-bad/run.js semantics):
//   calibrate() returns a findings ARRAY. One finding is emitted per trap the module CORRECTLY
//   refuses. If ANY trap is missed (the module binds the poison jurisdiction), calibrate()
//   returns an EMPTY array and writes the misses to stderr, so a runner that requires non-empty
//   findings fails exactly when the module has regressed. run.js may adopt this fixture with an
//   internal entry: require the fixture, call calibrate(), judge findings.length.
//   Standalone: `node eval/calibration-known-bad/fixtures/p1-jurisdiction-anchored-nexus.js`
//   exits 1 on any miss.

const path = require('path');
const { resolveJurisdiction } = require(path.resolve(__dirname, '..', '..', '..', 'facts', 'jurisdiction.js'));

// The six real footers from the old estate's nexus-anchoring corpus, verbatim classes.
const FOOTERS = Object.freeze({
  'mills-reeve (UK)': 'Mills & Reeve LLP is a limited liability partnership incorporated in England and Wales. Company number OC326013. Our office in Cambridge.',
  'birketts (UK)': 'Birketts LLP is a limited liability partnership registered in England and Wales. SRA Registration No: 441849.',
  'russell-cooke (UK)': 'Russell-Cooke LLP is incorporated in England and Wales, registered office 2 Putney Hill, London.',
  'freeths (UK)': 'Freeths LLP, incorporated in England and Wales with registered number OC304688.',
  'al-tamimi (AE)': 'Al Tamimi & Company. Our offices in Dubai and Abu Dhabi. We advise clients on US LLC formation and Delaware incorporation.',
  'franklin (FR)': 'Cabinet Franklin, based in France. Our office in Paris. Inscrit au Barreau de Paris.',
});

function bundleOf(footer, pageText, domain) {
  return {
    corpus: {
      pages: pageText ? [{ url: 'https://' + (domain || 'example.com') + '/', title: 'Home', text: pageText, jsonLd: [] }] : [],
      footerText: footer || '',
    },
    registers: {},
    domain: domain || 'example.com',
  };
}

const TRIALS = [];
for (const [firm, footer] of Object.entries(FOOTERS)) {
  TRIALS.push({
    name: 'ghost-us:' + firm,
    // the nav-menu mention that fed the old Tier-C leak rides along on every trial
    bundle: bundleOf(footer, 'M&R Global | USA and Canada', 'example.com'),
    mustNotBind: ['US'],
    detail: 'a non-US footer must never bind the United States (C-009)',
  });
}
TRIALS.push({
  name: 'difc-courts-advocacy (fichtelegal class)',
  bundle: bundleOf(
    'Our litigators are registered with the DIFC Courts and appear regularly before the DIFC Courts. Based in Dubai.',
    'Call us on +971 4 123 4567. Consultations from AED 500.',
    'example.com'
  ),
  mustNotBind: [],
  mustNotSubJurisdiction: ['DIFC', 'ADGM'],
  detail: 'court advocacy is not free-zone establishment; no displacement of the federal regime (C-010)',
});
TRIALS.push({
  name: 'service-offer-establishment',
  bundle: bundleOf('', 'We help you set up in the DIFC. Company formation services for the UAE and the United Kingdom.', 'example.com'),
  mustNotBind: ['UK', 'AE'],
  mustNotSubJurisdiction: ['DIFC', 'ADGM'],
  detail: 'selling establishment services proves nothing about the seller (C-011)',
});
TRIALS.push({
  name: 'tier-c-never-binds',
  bundle: bundleOf('', 'We advise clients across the Middle East and in Dubai. Our partners are admitted to the New York bar. Case study: a client in Germany.', 'example.com'),
  mustNotBind: ['AE', 'US', 'DE', 'EU'],
  mustAbstain: true,
  detail: 'marketing prose, bar admissions and case studies never attach law in any combination',
});
TRIALS.push({
  name: 'empty-register-non-match',
  bundle: { corpus: { pages: [], footerText: '' }, registers: { companiesHouse: {} }, domain: 'example.com' },
  mustNotBind: ['UK'],
  mustAbstain: true,
  detail: 'a bare non-empty register response with no name and no identifier is not a match (C-004)',
});
TRIALS.push({
  name: 'confident-default',
  bundle: { corpus: { pages: [], footerText: '' }, registers: {}, domain: 'example.com' },
  mustNotBind: ['UK', 'US', 'EU', 'AE', 'IE'],
  mustAbstain: true,
  detail: 'no evidence means abstention, never a default jurisdiction (C-006)',
});

function runTrials() {
  const misses = [];
  for (const trial of TRIALS) {
    const out = resolveJurisdiction(trial.bundle);
    const boundCodes = out.bound.map((b) => b.jurisdiction);
    for (const code of trial.mustNotBind || []) {
      if (boundCodes.includes(code)) {
        misses.push(trial.name + ': bound the poison jurisdiction "' + code + '" (' + trial.detail + ')');
      }
    }
    for (const code of trial.mustNotSubJurisdiction || []) {
      if (out.sub_jurisdictions.some((s) => s.code === code)) {
        misses.push(trial.name + ': attached forbidden sub-jurisdiction "' + code + '" (' + trial.detail + ')');
      }
    }
    if (trial.mustAbstain && !out.abstained) {
      misses.push(trial.name + ': expected abstention, got bound [' + boundCodes.join(', ') + ']');
    }
  }
  return misses;
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return []; // empty findings = the gate has not earned its zero; a strict runner fails
  }
  return TRIALS.map((trial) => ({
    file: __filename,
    rule: 'p1-jurisdiction-anchored-nexus',
    message: 'trap caught: ' + trial.name + ' (' + trial.detail + ')',
  }));
}

module.exports = { FOOTERS, TRIALS, bundleOf, runTrials, calibrate };

if (require.main === module) {
  const misses = runTrials();
  if (misses.length > 0) {
    console.error('p1-jurisdiction-anchored-nexus: ' + misses.length + ' trap(s) MISSED');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p1-jurisdiction-anchored-nexus', findings: calibrate() }));
  process.exit(0);
}
