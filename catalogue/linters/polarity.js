#!/usr/bin/env node
'use strict';
// catalogue/linters/polarity.js - the rule-polarity linter (caution.md C-046/C-047/C-048).
//
// SEMANTIC DOCTRINE (read this before touching the regexes below):
//   evidence_type describes WHAT THE CHECK LOOKS FOR on the client's website, not what the law
//   requires in the abstract:
//     - 'presence'    the duty names REQUIRED content; the breach fires when that content is
//                      MISSING from the site (e.g. "publish a privacy notice").
//     - 'absence'     the duty names PROHIBITED content; the breach fires when that content IS
//                      PRESENT on the site (e.g. "do not advertise prescription-only medicine").
//     - 'register'    the duty is proved/disproved against a register row rather than page text
//                      (treated as a presence-family check for polarity purposes: the thing that
//                      must be TRUE is either shown or it is not).
//     - 'behavioural' the duty is proved by an observed action (a network event, a DOM state
//                      change) rather than static text; polarity language checks do not apply to
//                      behavioural duties, since "the site must not do X" and "the site must do
//                      X" can BOTH legitimately carry evidence_type 'behavioural' depending on
//                      what fires the check (caution.md C-085: evidence KIND, not duty prose,
//                      decides confirmation logic for observed facts).
//
// Lint 1 (polarity mismatch): a duty containing PROHIBITION language (must not / may not /
// prohibited / shall not / is an offence to / ban(ned) on) must be typed 'absence'. A duty
// containing REQUIREMENT language (must publish/display/include/state/provide / required to)
// must be typed 'presence' or 'register'. A mismatch is reported with the duty quoted verbatim
// so a human can see exactly what was misread.
//
// Lint 2 (negation-guard warning, the Botox U18 class - caution.md C-048/C-060): an 'absence'
// obligation whose duty text ALSO contains self-declaration/compliance-claim wording ("we do
// not...", "confirms they are over...", "complies with...") is flagged as NEGATION-GUARD-NEEDED.
// This is a WARNING, not a hard mismatch: the duty is correctly typed 'absence', but a naive
// text-presence check over such wording is at real risk of matching the SITE'S OWN COMPLIANT
// SELF-DECLARATION ("we do not treat under-18s") and firing a false breach on the very sentence
// that proves compliance. The catalogue compiler / rule author must wire an explicit negation
// guard (distinguish "the site claims X is true" from "X is actually true") before this duty is
// safe to check with a bare text-presence regex.
//
// A SEPARATE, NARROWER check covers the pre-Compliance-Object-Model "legacy flat rule" shape
// (style/regex_pattern/framework_short, no website_obligations) that predates this catalogue and
// is still committed as a calibration fixture (eval/calibration-known-bad/fixtures/
// rule-polarity-inverted.json, wired into eval/calibration-known-bad/run.js). No record in
// catalogue/packs/*.json uses this shape; the check exists solely so this linter still earns its
// zero against that pre-existing fixture instead of silently reporting nothing on a shape it
// does not otherwise touch.
const lib = require('./lib');

const PROHIBITION_RX = /\bmust not\b|\bmay not\b|\bprohibited\b|\bshall not\b|\bis an offence to\b|\bban(?:ned)? on\b/i;
const REQUIREMENT_RX = /\bmust (?:publish|display|include|state|provide)\b|\brequired to\b/i;

// Self-declaration / compliance-claim wording: prose that asserts "we already do/don't X" rather
// than describing the prohibited act itself. Deliberately broad - a false positive here is a
// WARNING for a human to look at, never a silent pass-through.
const SELF_DECLARATION_RX = /\bwe (?:do not|don't|never)\b|\bself[- ]?declar|\bself[- ]?certif|\bconfirms? (?:that )?(?:they|you) are\b|\bno (?:one|persons?|customers?) under\b|\bnot available to (?:anyone )?under\b|\bcomplies? with\b|\bin compliance with\b/i;

// Legacy flat-rule shape only: a prohibit-style rule whose OWN pattern text describes asking for
// or obtaining consent BEFORE an action is definitionally describing the LAWFUL workflow, not a
// breach signal (the rule-polarity-inverted.json class).
const LEGACY_COMPLIANT_CONSENT_RX = /\b(?:ask(?:s|ed)? for|obtain(?:s|ed)?)\b.{0,40}\bconsent\b.{0,40}\b(?:before|prior to)\b/i;

function checkComRecord(record, locator) {
  const findings = [];
  const id = typeof record.id === 'string' ? record.id : '<no id>';
  const obligations = Array.isArray(record.website_obligations) ? record.website_obligations : [];

  obligations.forEach((w, i) => {
    if (!w || typeof w.duty !== 'string') return;
    const tag = 'website_obligations[' + i + ']';
    const duty = w.duty;
    const evidenceType = w.evidence_type;

    // 'behavioural' is deliberately exempt from both checks below (see the SEMANTIC DOCTRINE
    // header): an observed-action duty can legitimately carry prohibition OR requirement prose
    // depending on what the observed action actually is, so duty-text polarity language does not
    // determine evidence_type validity for behavioural duties the way it does for presence/absence.
    if (evidenceType !== 'behavioural') {
      if (PROHIBITION_RX.test(duty) && evidenceType !== 'absence') {
        findings.push({
          locator, id, rule: 'polarity-prohibition-mismatch',
          message: tag + ' contains prohibition language but evidence_type is ' + JSON.stringify(evidenceType) + ' (must be "absence"): ' + JSON.stringify(duty),
        });
      }
      if (REQUIREMENT_RX.test(duty) && evidenceType !== 'presence' && evidenceType !== 'register') {
        findings.push({
          locator, id, rule: 'polarity-requirement-mismatch',
          message: tag + ' contains requirement language but evidence_type is ' + JSON.stringify(evidenceType) + ' (must be "presence" or "register"): ' + JSON.stringify(duty),
        });
      }
    }
    if (evidenceType === 'absence' && SELF_DECLARATION_RX.test(duty)) {
      findings.push({
        locator, id, rule: 'negation-guard-needed', severity: 'warning',
        message: tag + ' is typed "absence" but its duty carries self-declaration/compliance wording; a bare text-presence check risks matching the site\'s OWN compliant self-declaration (the Botox U18 class): ' + JSON.stringify(duty),
      });
    }
  });

  return findings;
}

function checkLegacyRecord(record, locator) {
  const findings = [];
  const id = typeof record.id === 'string' ? record.id : (typeof record.framework_short === 'string' ? record.framework_short : '<no id>');
  if (record.style === 'prohibit' && typeof record.regex_pattern === 'string' && LEGACY_COMPLIANT_CONSENT_RX.test(record.regex_pattern)) {
    findings.push({
      locator, id, rule: 'legacy-polarity-inverted',
      message: 'legacy flat rule is style="prohibit" but its regex_pattern describes asking for/obtaining consent BEFORE an action - that is the LAWFUL workflow, not a breach signal: ' + JSON.stringify(record.regex_pattern),
    });
  }
  return findings;
}

function scan(dirsOrPatterns) {
  const { entries, parseErrors } = lib.loadRecords(dirsOrPatterns);
  const violations = [];
  for (const entry of entries) {
    const findings = entry.shape === 'com'
      ? checkComRecord(entry.record, entry.locator)
      : checkLegacyRecord(entry.record, entry.locator);
    for (const f of findings) violations.push({ file: entry.file, ...f });
  }
  return { violations, scanned: entries.length, parseErrors };
}

function selfTest() {
  const inverted = {
    id: 'CAL_SELFTEST_PROHIBIT',
    website_obligations: [{ duty: 'It is an offence to advertise this product to the public', elements: ['x'], evidence_type: 'presence' }],
  };
  const invertedRequirement = {
    id: 'CAL_SELFTEST_REQUIRE',
    website_obligations: [{ duty: 'The firm must publish its complaints procedure', elements: ['x'], evidence_type: 'absence' }],
  };
  const negationGuard = {
    id: 'CAL_SELFTEST_NEGGUARD',
    website_obligations: [{ duty: 'We do not treat patients under the age of 18 with this product', elements: ['x'], evidence_type: 'absence' }],
  };
  const good = {
    id: 'CAL_SELFTEST_GOOD',
    website_obligations: [
      { duty: 'Do not advertise prescription-only medicine to the public', elements: ['x'], evidence_type: 'absence' },
      { duty: 'The firm must publish a privacy notice', elements: ['x'], evidence_type: 'presence' },
      // behavioural duties are exempt from polarity language checks (SEMANTIC DOCTRINE above):
      // this one carries prohibition language ("must not") but is legitimately observed-action.
      { duty: 'Firm names and domain names must not be false or misleading', elements: ['x'], evidence_type: 'behavioural' },
    ],
  };
  const legacyBad = { id: 'CAL_LEGACY', style: 'prohibit', regex_pattern: 'we (ask for|obtain) your consent before (setting|placing)( any)? cookies' };

  const invertedF = checkComRecord(inverted, 'selftest');
  const invertedReqF = checkComRecord(invertedRequirement, 'selftest');
  const negF = checkComRecord(negationGuard, 'selftest');
  const goodF = checkComRecord(good, 'selftest');
  const legacyF = checkLegacyRecord(legacyBad, 'selftest');

  const pass = invertedF.some((f) => f.rule === 'polarity-prohibition-mismatch')
    && invertedReqF.some((f) => f.rule === 'polarity-requirement-mismatch')
    && negF.some((f) => f.rule === 'negation-guard-needed')
    && goodF.length === 0
    && legacyF.some((f) => f.rule === 'legacy-polarity-inverted');

  return {
    pass,
    detail: pass
      ? 'catches an inverted prohibition, an inverted requirement, a negation-guard case, the legacy inverted-consent class, and clears correctly-typed duties'
      : 'FAILED one or more self-test cases: ' + JSON.stringify({ invertedF, invertedReqF, negF, goodF, legacyF }),
  };
}

const toFindings = lib.makeToFindings('catalogue-polarity');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'polarity');
}

if (require.main === module) main();

module.exports = { PROHIBITION_RX, REQUIREMENT_RX, SELF_DECLARATION_RX, LEGACY_COMPLIANT_CONSENT_RX, checkComRecord, checkLegacyRecord, scan, selfTest, toFindings };
