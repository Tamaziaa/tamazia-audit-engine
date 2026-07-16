'use strict';
// CALIBRATION FIXTURE (known-bad, deliberately committed): fabricated-fine-literal class.
// Fine amounts, regulator names and law titles may come ONLY from the compiled catalogue
// artifact. This file hard-codes a fine figure and a statutory-cap headline in code -
// the class behind the indefensible GBP 17.5M / GBP 18M cap headlines. The
// catalogue-only-literals (domain) gate MUST flag this file in --calibrate mode,
// or it has not earned its zero.
// This file is never imported by engine code.

const GDPR_MAX_FINE_GBP = 17500000; // BAD: fine literal in code, not read from the catalogue

function exposureHeadline() {
  // BAD: a currency amount and a law name composed in code, unsourced.
  return 'Exposure up to £17,500,000 under UK GDPR - the ICO can act today';
}

function regulatorLine() {
  // BAD: regulator name authored in code rather than selected from the catalogue.
  return 'Regulated by the Information Commissioner (fines up to £17.5M)';
}

module.exports = { GDPR_MAX_FINE_GBP, exposureHeadline, regulatorLine };
