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
const THRESHOLD_RX = /\bturnover\b|\brevenue\b|\bemployee(?:s)?\s*(?:count|number)?\b|\bnumber of employees\b|\bcompany size\b|\bsize of (?:the )?(?:company|business|firm)\b|\bsmall (?:and medium-sized )?(?:business(?:es)?|enterprises?)\b|\bSMEs?\b|\bstaff (?:count|number|headcount)\b|\bheadcount\b|\bfewer than \d|\bmore than \d+\s*(?:employees|staff)\b|\bGBP\s?\d[\d,]*\s*(?:m|million|k)\b|\b£\s?\d[\d,]*\s*(?:m|million|k)\b|\$\s?\d[\d,]*\s*(?:m|million|k)\b/i;

function textMentionsThreshold(record) {
  const haystacks = [];
  if (typeof record.name === 'string') haystacks.push(record.name);
  if (Array.isArray(record.applies_when)) {
    for (const a of record.applies_when) if (typeof a === 'string') haystacks.push(a);
  }
  if (Array.isArray(record.excluded_when)) {
    for (const e of record.excluded_when) if (typeof e === 'string') haystacks.push(e);
  }
  return haystacks.some((h) => THRESHOLD_RX.test(h));
}

function hasNonEmptyExcludedWhen(record) {
  return Array.isArray(record.excluded_when) && record.excluded_when.some((e) => typeof e === 'string' && e.trim().length > 0);
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// checkRecord(record, locator) -> finding[] (never throws)
function checkRecord(record, locator) {
  const findings = [];
  const id = typeof record.id === 'string' ? record.id : '<no id>';
  const add = (rule, message, severity) => findings.push({ locator, id, rule, message, severity });

  if (textMentionsThreshold(record) && !hasNonEmptyExcludedWhen(record)) {
    add(
      'threshold-excluded-when-missing',
      'name/applies_when/excluded_when mentions a turnover/revenue/employee-count/company-size threshold but excluded_when is empty - a size-gated law with no modelled "below threshold, excluded" entry attaches to every firm regardless of size (the Modern Slavery Act-on-an-SME class, caution.md C-071)'
    );
  }

  const penalty = lib.isPlainObject(record.penalty) ? record.penalty : {};
  if (isFiniteNumber(penalty.statutory_max) && penalty.typical_low === null && penalty.typical_high === null) {
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
  return { violations, scanned: entries.length, parseErrors };
}

function selfTest() {
  const missingExcluded = {
    id: 'CAL_SELFTEST_THRESHOLD',
    name: 'Modern Slavery Act 2015 (transparency statement)',
    applies_when: ['organisation with annual turnover of GBP 36 million or more'],
    excluded_when: [],
    penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
  };
  const good = {
    id: 'CAL_SELFTEST_THRESHOLD_GOOD',
    name: 'Modern Slavery Act 2015 (transparency statement)',
    applies_when: ['organisation with annual turnover of GBP 36 million or more'],
    excluded_when: ['annual turnover below GBP 36 million'],
    penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP', basis: 'no financial penalty', max_is_rare: false },
  };
  const bandMissing = {
    id: 'CAL_SELFTEST_BAND',
    name: 'Some statutory regime',
    applies_when: ['processes personal data'],
    excluded_when: [],
    penalty: { typical_low: null, typical_high: null, statutory_max: 17500000, currency: 'GBP', basis: 'statutory maximum', max_is_rare: true },
  };
  const noThreshold = {
    id: 'CAL_SELFTEST_NOTHRESH',
    name: 'A universal privacy notice duty',
    applies_when: ['processes personal data of UK residents'],
    excluded_when: [],
    penalty: { typical_low: 1000, typical_high: 2000, statutory_max: 5000, currency: 'GBP', basis: 'x', max_is_rare: false },
  };

  const missingF = checkRecord(missingExcluded, 'selftest');
  const goodF = checkRecord(good, 'selftest');
  const bandF = checkRecord(bandMissing, 'selftest');
  const noThreshF = checkRecord(noThreshold, 'selftest');

  const pass = missingF.some((f) => f.rule === 'threshold-excluded-when-missing')
    && goodF.filter((f) => f.rule === 'threshold-excluded-when-missing').length === 0
    && bandF.some((f) => f.rule === 'typical-band-missing')
    && noThreshF.length === 0;

  return {
    pass,
    detail: pass
      ? 'catches a threshold mention with empty excluded_when, clears one with a populated excluded_when, catches a statutory_max with no typical band, and stays silent on a record with no threshold and a full penalty band'
      : 'FAILED one or more self-test cases: ' + JSON.stringify({ missingF, goodF, bandF, noThreshF }),
  };
}

const toFindings = lib.makeToFindings('catalogue-threshold-guard');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'threshold-guard');
}

if (require.main === module) main();

module.exports = { THRESHOLD_RX, textMentionsThreshold, hasNonEmptyExcludedWhen, checkRecord, scan, selfTest, toFindings };
