#!/usr/bin/env node
'use strict';
// catalogue/linters/threshold-guard.js - caution.md C-071 (Modern Slavery Act applied to
// sub-GBP36m SMEs in 5 of 9 forensic audits) + the statutory-cap-as-headline class (caution.md
// C-096: "Exposure headlines used the statutory cap verbatim").
//
// Lint 1 (threshold-excluded-when-missing, BLOCKING): any record whose applies_when[],
// excluded_when[] or name mentions a turnover/revenue/employee-count/company-size threshold must
// carry a non-empty excluded_when. A law that only binds ABOVE a size threshold with no modelled
// "below the threshold, excluded" entry will attach to every firm regardless of size - exactly the
// Modern Slavery Act-on-an-SME defect this gate exists to catch.
//
// Lint 2 (typical-band-missing, WARNING): any record with a numeric penalty.statutory_max but
// penalty.typical_low AND penalty.typical_high both null. A statutory ceiling with no modelled
// typical enforcement band invites the renderer to headline the rare maximum as "your exposure"
// (caution.md C-096/C-104) instead of a realistic band; this is a warning because a genuinely
// cap-only regime (no typical-band data yet gathered) is a real, honest state, not a schema
// violation - but it must never pass silently, so a human sees it every run until filled in.
const lib = require('./lib');

// Deliberately broad: a false positive here is a BLOCKING finding demanding a human confirm an
// excluded_when entry exists, never a silent pass-through of an unmodelled size threshold.
//
// CR-13: the currency alternatives deliberately do NOT lead with \b before a non-word symbol
// (£/$). \b only fires at a transition between a word char and a non-word char; a currency symbol
// preceded by whitespace (the overwhelmingly common real case: "turnover of £99m") is a
// non-word-to-non-word transition, so a LEADING \b before £ never matches at all - proven dead by
// this file's own selfTest below. GBP keeps its leading \b (GBP is word characters, the boundary is
// real); £ and $ do not need one, since \d immediately after already anchors the match precisely
// and a currency symbol has no letter-run for a spurious mid-token match to hide inside.
// "employee(s)" alone is NOT a size signal: an endorsement "by an employee" is authorship, not
// headcount (the US_FTC_REVIEWS_ENDORSEMENTS false positive, PR #3 gate loop). The employee
// alternations therefore REQUIRE count context: a mandatory count/number/threshold qualifier or a
// leading numeral ("250 or more employees").
const THRESHOLD_RX = /\bturnover\b|\brevenue\b|\bemployee(?:s)?\s+(?:count|number|threshold)\b|\bnumber of employees\b|\b\d[\d,]*\s*(?:or more\s+)?employees\b|\bcompany size\b|\bsize of (?:the )?(?:company|business|firm)\b|\bsmall (?:and medium-sized )?(?:business(?:es)?|enterprises?)\b|\bSMEs?\b|\bstaff (?:count|number|headcount)\b|\bheadcount\b|\bfewer than \d|\bmore than \d+\s*(?:employees|staff)\b|\bGBP\s?\d[\d,]*\s*(?:m|million|k)\b|£\s?\d[\d,]*\s*(?:m|million|k)\b|\$\s?\d[\d,]*\s*(?:m|million|k)\b/i;

// BELOW_THRESHOLD_RX (CR threshold-guard.js:62): the below/under/exempt SENSE a genuine
// excluded_when carve-out must carry. A threshold KEYWORD alone in excluded_when is not enough to
// prove a sub-threshold exemption is modelled - an entry that merely RE-STATES the same ABOVE-
// threshold trigger ("organisation with annual turnover of GBP 99 million or more") matches
// THRESHOLD_RX yet models no carve-out at all. hasNonEmptyExcludedWhen therefore now requires BOTH
// a threshold token AND one of these below/under/less-than/exemption senses in the SAME entry, so a
// same-threshold-but-not-below excluded_when still leaves the record flagged.
const BELOW_THRESHOLD_RX = /\bbelow\b|\bunder\b|\bbeneath\b|\bless than\b|\bfewer than\b|\bsmaller than\b|\bup to\b|\bnot exceeding\b|\bdoes not exceed\b|\bdo(?:es)? not (?:apply|meet|reach)\b|\bat or below\b|\bunderneath\b|\bexempt\b|\bexemption\b|\bde minimis\b/i;

// stringsOf(arr) -> the string elements of arr, or [] if arr is not an array. Pulled out of
// textMentionsThreshold below so its two former "if array, then for-loop with an inner if" blocks
// (Constitution Rule 4/tools/health-gate/check.js caps: each was a nested-conditional block on its
// own) collapse to one non-branching call site each.
function stringsOf(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => typeof x === 'string');
}

function textMentionsThreshold(record) {
  const haystacks = [];
  if (typeof record.name === 'string') haystacks.push(record.name);
  haystacks.push(...stringsOf(record.applies_when));
  haystacks.push(...stringsOf(record.excluded_when));
  return haystacks.some((h) => THRESHOLD_RX.test(h));
}

// hasNonEmptyExcludedWhen(record) -> true only when excluded_when carries a GENUINE "below the
// threshold, excluded" entry (CR-12 + CR threshold-guard.js:62) - not merely any non-empty string,
// and not merely one that re-states the SAME above-threshold trigger. A single excluded_when entry
// must carry BOTH:
//   1. a threshold TOKEN (THRESHOLD_RX - the SAME vocabulary that triggered this check: "turnover",
//      "revenue", "employees", "SME", "GBP 99 million", "£99m", ...), so a vocabulary change can
//      never silently drift the trigger and the carve-out apart; AND
//   2. a below/under/exemption SENSE (BELOW_THRESHOLD_RX) that expresses the sub-threshold carve-out
//      itself. THRESHOLD_RX alone is not enough: "organisation with annual turnover of GBP 99 million
//      or more" matches THRESHOLD_RX but is the ABOVE-threshold trigger restated, not an exemption -
//      requiring the below/exempt sense too keeps such a same-threshold-but-not-below entry from
//      wrongly clearing the record (CR threshold-guard.js:62).
// An unrelated exclusion reason (e.g. "B2B-only firms are out of scope") carries neither and so
// never satisfies this check either. A bare digit test (e.g. "\d") was deliberately rejected for the
// threshold token: it false-positived on "B2B-only" (the "2" in "B2B").
function hasNonEmptyExcludedWhen(record) {
  if (!Array.isArray(record.excluded_when)) return false;
  return record.excluded_when.some((e) =>
    typeof e === 'string' && e.trim().length > 0 && THRESHOLD_RX.test(e) && BELOW_THRESHOLD_RX.test(e));
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// statutoryMaxWithNoTypicalBand(penalty) -> boolean. Named predicate pulled out of checkRecord's
// own if TEST (the multi-operator test now lives in a RETURN, not a test position).
function statutoryMaxWithNoTypicalBand(penalty) {
  return isFiniteNumber(penalty.statutory_max) && penalty.typical_low === null && penalty.typical_high === null;
}

// checkRecord(record, locator) -> finding[] (never throws)
function checkRecord(record, locator) {
  const findings = [];
  const id = typeof record.id === 'string' ? record.id : '<no id>';
  const add = (rule, message, severity) => findings.push({ locator, id, rule, message, severity });

  if (textMentionsThreshold(record) && !hasNonEmptyExcludedWhen(record)) {
    // CR-11/CR-12: 'error' passed EXPLICITLY (not left to makeToFindings' implicit
    // undefined-defaults-to-error behaviour) - this is the blocking rule; a future refactor of the
    // shared severity default must not silently downgrade it.
    add(
      'threshold-excluded-when-missing',
      'name/applies_when/excluded_when mentions a turnover/revenue/employee-count/company-size threshold but excluded_when carries no matching below-threshold exclusion - a size-gated law with no modelled "below threshold, excluded" entry attaches to every firm regardless of size (the Modern Slavery Act-on-an-SME class, caution.md C-071)',
      'error'
    );
  }

  const penalty = lib.isPlainObject(record.penalty) ? record.penalty : {};
  if (statutoryMaxWithNoTypicalBand(penalty)) {
    add(
      'typical-band-missing',
      'penalty.statutory_max is set (' + penalty.statutory_max + ') but typical_low and typical_high are both null - a bare statutory ceiling with no typical enforcement band invites the renderer to headline the rare maximum as "your exposure" (caution.md C-096/C-104)',
      'warning'
    );
  }

  return findings;
}

function scan(dirsOrPatterns) {
  const { entries, parseErrors } = lib.loadRecords(dirsOrPatterns);
  const violations = [];
  for (const entry of entries) {
    if (entry.shape !== 'com') continue; // this linter reads applies_when/excluded_when/penalty, the COM shape only
    for (const f of checkRecord(entry.record, entry.locator)) violations.push({ file: entry.file, ...f });
  }
  // CR-7: an unreadable/unparseable file fails the gate through the same violations array a real
  // threshold defect uses.
  for (const v of lib.parseErrorViolations(parseErrors)) violations.push(v);
  return { violations, scanned: entries.length, parseErrors };
}

// selfTestFixtures() -> the named COM-record fixtures every selfTest case below is run against.
// Pulled out of selfTest as a pure data table (Constitution Rule 4/tools/health-gate/check.js
// caps: the former inline selfTest body was 79 lines).
function selfTestFixtures() {
  return {
    missingExcluded: {
      id: 'CAL_SELFTEST_THRESHOLD',
      name: 'FAKE_ACT_2099 (synthetic transparency duty)',
      applies_when: ['organisation with annual turnover of GBP 99 million or more'],
      excluded_when: [],
      penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
    },
    good: {
      id: 'CAL_SELFTEST_THRESHOLD_GOOD',
      name: 'FAKE_ACT_2099 (synthetic transparency duty)',
      applies_when: ['organisation with annual turnover of GBP 99 million or more'],
      excluded_when: ['annual turnover below GBP 99 million'],
      penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
    },
    bandMissing: {
      id: 'CAL_SELFTEST_BAND',
      name: 'Some statutory regime',
      applies_when: ['processes personal data'],
      excluded_when: [],
      penalty: { typical_low: null, typical_high: null, statutory_max: 99000000, currency: 'GBP', basis: 'statutory maximum', max_is_rare: true },
    },
    noThreshold: {
      id: 'CAL_SELFTEST_NOTHRESH',
      name: 'A universal privacy notice duty',
      applies_when: ['processes personal data of UK residents'],
      excluded_when: [],
      penalty: { typical_low: 1000, typical_high: 2000, statutory_max: 5000, currency: 'GBP', basis: 'x', max_is_rare: false },
    },
    // CR-12: an excluded_when entry that carries NO threshold keyword or number (an unrelated
    // exclusion reason) must NOT satisfy hasNonEmptyExcludedWhen - the record stays flagged.
    unrelatedExcluded: {
      id: 'CAL_SELFTEST_UNRELATED_EXCLUDED',
      name: 'FAKE_ACT_2099 (synthetic transparency duty)',
      applies_when: ['organisation with annual turnover of GBP 99 million or more'],
      excluded_when: ['B2B-only firms are out of scope'],
      penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
    },
    // CR threshold-guard.js:62: an excluded_when entry that merely RE-STATES the same ABOVE-threshold
    // trigger (matches THRESHOLD_RX but carries no below/under/exempt SENSE) must NOT satisfy
    // hasNonEmptyExcludedWhen - it models no sub-threshold carve-out at all, so the record stays flagged.
    sameThresholdNotBelow: {
      id: 'CAL_SELFTEST_SAME_THRESHOLD_NOT_BELOW',
      name: 'FAKE_ACT_2099 (synthetic transparency duty)',
      applies_when: ['organisation with annual turnover of GBP 99 million or more'],
      excluded_when: ['organisation with annual turnover of GBP 99 million or more'],
      penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
    },
    // CR-13: a bare currency-symbol threshold mention at the very START of a string (no preceding
    // word-boundary transition to anchor a leading \b) must still be recognised.
    currencyTokenStart: { name: '£99m', applies_when: [], excluded_when: [] },
    dollarTokenStart: { name: '$10m', applies_when: [], excluded_when: [] },
  };
}

// runSelfTestCases(fx) -> checkRecord() run once per fixture above.
function runSelfTestCases(fx) {
  return {
    missingF: checkRecord(fx.missingExcluded, 'selftest'),
    goodF: checkRecord(fx.good, 'selftest'),
    bandF: checkRecord(fx.bandMissing, 'selftest'),
    noThreshF: checkRecord(fx.noThreshold, 'selftest'),
    unrelatedExcludedF: checkRecord(fx.unrelatedExcluded, 'selftest'),
    sameThresholdNotBelowF: checkRecord(fx.sameThresholdNotBelow, 'selftest'),
  };
}

// missingIsBlockingErrorCheck(r) -> boolean. Named predicate pulled out of evaluateSelfTestCases'
// former inline test (the multi-operator test now lives in a RETURN, not a test position).
function missingIsBlockingErrorCheck(r) {
  return r.missingF.some((f) => f.rule === 'threshold-excluded-when-missing' && f.severity === 'error');
}

// selfTestChecks(fx, r, missingIsBlockingError) -> boolean[]. Every individual expectation the
// original selfTest asserted, as a flat list rather than one long && chain (Constitution Rule
// 4/tools/health-gate/check.js caps: the former chain carried nine decision points on its own).
function selfTestChecks(fx, r, missingIsBlockingError) {
  return [
    r.missingF.some((f) => f.rule === 'threshold-excluded-when-missing'),
    missingIsBlockingError,
    r.unrelatedExcludedF.some((f) => f.rule === 'threshold-excluded-when-missing'),
    r.sameThresholdNotBelowF.some((f) => f.rule === 'threshold-excluded-when-missing'),
    textMentionsThreshold(fx.currencyTokenStart),
    textMentionsThreshold(fx.dollarTokenStart),
    r.goodF.filter((f) => f.rule === 'threshold-excluded-when-missing').length === 0,
    r.bandF.some((f) => f.rule === 'typical-band-missing'),
    r.noThreshF.length === 0,
  ];
}

// evaluateSelfTestCases(fx, r) -> {pass, missingIsBlockingError}. Every individual expectation the
// original selfTest asserted, unchanged.
function evaluateSelfTestCases(fx, r) {
  const missingIsBlockingError = missingIsBlockingErrorCheck(r);
  const pass = selfTestChecks(fx, r, missingIsBlockingError).every(Boolean);
  return { pass, missingIsBlockingError };
}

function selfTest() {
  const fx = selfTestFixtures();
  const r = runSelfTestCases(fx);
  const { pass, missingIsBlockingError } = evaluateSelfTestCases(fx, r);

  return {
    pass,
    detail: pass
      ? 'catches a threshold mention with empty excluded_when (as a blocking error), an unrelated non-size excluded_when entry, a same-threshold-but-not-below excluded_when, £/$ threshold mentions at token start, clears a genuine below-threshold excluded_when, catches a statutory_max with no typical band, and stays silent on a record with no threshold and a full penalty band'
      : 'FAILED one or more self-test cases: ' + JSON.stringify({
        missingF: r.missingF, goodF: r.goodF, bandF: r.bandF, noThreshF: r.noThreshF,
        unrelatedExcludedF: r.unrelatedExcludedF, sameThresholdNotBelowF: r.sameThresholdNotBelowF, missingIsBlockingError,
      }),
  };
}

const toFindings = lib.makeToFindings('catalogue-threshold-guard');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'threshold-guard');
}

if (require.main === module) main();

module.exports = { THRESHOLD_RX, BELOW_THRESHOLD_RX, textMentionsThreshold, hasNonEmptyExcludedWhen, checkRecord, scan, selfTest, toFindings };
