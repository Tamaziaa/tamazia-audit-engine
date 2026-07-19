'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for the C-022 non-English honesty gate:
// evidence/crawler/language.js (the producer) + breach/proposers/propose.js's isNonEnglishGated
// (the consumer, already correct but previously fed by nothing - hidden-defects.md RANK 6,
// repetition-audit-2026-07-19.md DG-04b).
//
// THE DISEASE: propose.js has ALWAYS correctly read bundle.corpus.language and gated on it, but grep
// proved nothing in facts/, evidence/ or mint/ ever ASSIGNED that field - only comments promised it. So
// a genuinely non-English site ran English-anchored detection patterns, matched almost nothing, and
// rendered as a near-clean audit instead of the honest "unassessed" (caution.md C-022: "Sixteen
// non-English pages fed English disclosure regexes and fabricated a 16-breach GDPR cascade" - the same
// class, inverted to silent under-detection rather than over-detection, but equally dishonest).
//
// A checker that has "wired" this must prove BOTH directions on the REAL end-to-end path
// (evidence/crawler/language.js's detectLanguage() feeding a bundle that breach/proposers/propose.js
// actually evaluates), not just the pure unit in isolation:
//   - POSITIVE: a confidently non-English corpus (detected via detectLanguage(), exactly as crawl.js's
//     resolveLanguage() would produce it) gates propose() to ZERO candidates, even though the corpus
//     contains a real, on-the-nose violating phrase - proving the gate suppresses REAL content, not
//     merely an empty bundle;
//   - NEGATIVE: the SAME violating phrase in a confidently English corpus still fires normally - proving
//     the fix does not over-gate every audit into permanent silence.
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p4-risk-domnode-never-hard-violation.js):
// calibrate() returns findings on a correct catch, [] (misses printed to stderr) on any regression.
// Standalone: `node eval/calibration-known-bad/fixtures/p6-corpus-language-gate-fires.js` exits 1 on a
// miss. Self-sufficient (a hand-built synthetic catalogue + bundle, no compiled catalogue dependency),
// so it runs safely BEFORE the catalogue compile in CI.

// STRING-LITERAL requires (never path.resolve(__dirname, ...)): a dynamic require is invisible to the
// reachability gate (madge), which is exactly how correct logic has sat dead in production before.
const { propose } = require('../../../breach/proposers/propose.js');
const { detectLanguage } = require('../../../evidence/crawler/language.js');
const coverageContract = require('../../../evidence/crawler/coverage-contract.js');

const OFFENDING_PHRASE = 'Buy our miracle tonic cures all today and feel amazing within a single week of trying it.';

// A realistic-length synthetic French paragraph (hand-written, not copied from any real site), repeated
// enough times to swamp the handful of English stopwords the (deliberately English) offending phrase
// itself carries ("our", "and", "of") and still clear language.js's confident-non-English ceiling - the
// offending phrase does not need to be French, the gate must fire on the CORPUS classification, not on
// whether the violating string happens to look foreign.
const FRENCH_PROSE = Array(60).fill(
  'Nous nous engageons a proteger votre vie privee et vos donnees personnelles. Cette notice explique ' +
  'comment nous recueillons, utilisons et conservons les informations que vous nous fournissez.',
).join(' ') + ' ' + OFFENDING_PHRASE;

const ENGLISH_PROSE = Array(8).fill(
  'We are committed to protecting your privacy and your personal data. This notice explains how we ' +
  'collect, use and store the information you provide to us at every stage of our relationship with you.',
).join(' ') + ' ' + OFFENDING_PHRASE;

function catalogue() {
  return {
    records: [{
      id: 'FAKE_UDAP_2099',
      regulator: { register_url: 'https://register.fake.example/frb' },
      citation: { url: 'https://fake.example/act' },
      website_obligations: [
        { duty: 'Do not make unsupported health/performance claims', elements: ["the phrase 'miracle tonic cures all' must not appear in public copy"], evidence_type: 'absence' },
      ],
    }],
  };
}

function pages(text) {
  return [{ url: 'https://clinic.example/', title: 'Home', text, jsonLd: [] }];
}

function bundle(text, language) {
  return {
    domain: 'clinic.example',
    corpus: { pages: pages(text), footerText: '', truncated: false, language },
    registers: { notes: [] },
    browser: { observed: [], consentControl: { found: false, healthy: null, url: null }, lane: { ran: false, reason: 'playwright-unavailable' } },
  };
}

function coverageFor(b) {
  return coverageContract.coverageFor(catalogue().records, b.corpus.pages, { truncated: b.corpus.truncated });
}

function runTrials() {
  const misses = [];

  // The real end-to-end producer: exactly what crawl.js's resolveLanguage() would compute.
  const frLanguage = detectLanguage({ htmlLang: 'fr-FR', text: FRENCH_PROSE });
  const enLanguage = detectLanguage({ htmlLang: 'en-GB', text: ENGLISH_PROSE });

  if (!frLanguage || /^en\b/i.test(frLanguage)) {
    misses.push('SETUP BROKEN: detectLanguage() did not classify the French fixture as non-English - got ' + JSON.stringify(frLanguage));
    return misses; // downstream assertions are meaningless without a real non-English classification
  }
  if (enLanguage !== 'en') {
    misses.push('SETUP BROKEN: detectLanguage() did not classify the English fixture as English - got ' + JSON.stringify(enLanguage));
    return misses;
  }

  // POSITIVE CONTROL: the gate fires end-to-end and suppresses a REAL violating phrase. HIGH-9 (2026-07-20):
  // the gate no longer returns a bare [] - it returns a VISIBLE suppression per compiled spec, so the
  // abstention itself is recorded (suppression is first-class, never silent). The invariant this trap
  // actually protects is unchanged: NOTHING may ever FIRE (no artifact-bearing candidate) on a confidently
  // non-English corpus, however real the violating phrase.
  const frBundle = bundle(FRENCH_PROSE, frLanguage);
  const frCandidates = propose(frBundle, catalogue(), coverageFor(frBundle));
  const frFired = frCandidates.filter((c) => !c.suppressed_reason);
  if (frFired.length !== 0) {
    misses.push('CRITICAL (C-022): a confidently non-English corpus did NOT gate the breach lane - propose() FIRED ' + frFired.length + ' candidate(s) instead of zero');
  }
  if (frCandidates.length === 0) {
    misses.push('HIGH-9 REGRESSION: the non-English gate returned a bare [] with no recorded suppression - the abstention must be VISIBLE (suppression is first-class, C-022/HIGH-9)');
  } else if (!frCandidates.every((c) => c.suppressed_reason && /C-022/.test(c.suppressed_reason))) {
    misses.push('HIGH-9 REGRESSION: not every candidate on the non-English corpus is a C-022-cited suppression: ' + JSON.stringify(frCandidates));
  }

  // NEGATIVE CONTROL: the SAME violating phrase in an English corpus still fires - the fix does not
  // over-gate every audit into silence.
  const enBundle = bundle(ENGLISH_PROSE, enLanguage);
  const enCandidates = propose(enBundle, catalogue(), coverageFor(enBundle));
  const enFired = enCandidates.filter((c) => !c.suppressed_reason);
  if (enFired.length < 1) {
    misses.push('OVER-CORRECTION: an English corpus with the identical violating phrase did not fire - the gate is suppressing everything, not just non-English corpora: ' + JSON.stringify(enCandidates));
  }

  return misses;
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p6-corpus-language-gate-fires',
    message: 'trap caught: evidence/crawler/language.js\'s detectLanguage() feeding a real bundle causes breach/proposers/propose.js to gate a confidently non-English corpus to ZERO candidates (even carrying a real violating phrase), while the identical phrase in a confidently English corpus still fires normally',
  }];
}

module.exports = { catalogue, bundle, coverageFor, runTrials, calibrate, FRENCH_PROSE, ENGLISH_PROSE };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p6-corpus-language-gate-fires: trap MISSED - the non-English honesty gate is not wired end-to-end');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p6-corpus-language-gate-fires', findings }));
  process.exit(0);
}
