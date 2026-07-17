#!/usr/bin/env node
'use strict';
// catalogue/linters/citation-completeness.js - Constitution Rule 14 (provenance-mandatory
// catalogue rows) + caution.md C-104 (no legal number enters the catalogue without a source
// URL verified at authoring time).
//
// Checks, per COM record:
//   1. status === 'candidate'  -> citation.url is present and its host ends with one of
//      OFFICIAL_HOSTS. A candidate row is one authored but not yet human-promoted; it is the
//      row most likely to carry an unverified or lazily-sourced citation, so this is where the
//      gate is strictest. "Anything not allowlistable is a linter finding, never silently
//      allowed" - there is no fallback heuristic here, only the frozen list below.
//   2. provenance.sources      -> non-empty (every row, any status: Rule 14 binds unconditionally).
//   3. penalty.currency + penalty.basis -> both present (every row: a penalty object with no
//      basis is a bare number nobody can trace back to a mechanism - caution.md C-099/C-104).
//   4. enforcement[]           -> every entry carries both url and date (every row).
//
// SECONDARY (informational, still reported, never silently dropped): enforcement[].url and
// regulator.register_url are ALSO checked against OFFICIAL_HOSTS and reported under distinct
// rule ids (enforcement-host-unofficial / register-host-unofficial). The mandatory contract
// above only requires this for citation.url on candidate rows; the secondary checks surface
// real, already-observed defects in the committed packs (a law-firm's own commentary site, an
// industry news blog, a private membership body) that a human should see, without pretending
// they are the same class of blocking failure as an unofficial LAW citation.
//
// OFFICIAL_HOSTS was built by reading EVERY citation/enforcement/register host actually cited
// across all 7 packs (the 6 QA'd cells + uk-tech-media-industrial) and keeping only genuine
// statutory/regulatory/court/legislature bodies - never a law firm's own site, a news outlet, a
// vendor blog, or a trade/membership association, however reputable. ".gov" and ".gov.uk" are
// modelled as GENERIC suffixes (not one entry per US state or UK regulator subdomain): both are
// restricted top-level/second-level namespaces a private party cannot register, so "ends in
// .gov"/"ends in .gov.uk" is itself a genuine, principled official-source test, exactly like
// trusting *.gov.uk already does for legislation.gov.uk. Every other allowlist entry is a named,
// individually-recognised statutory regulator, ombudsman, court, or bar/professional-conduct
// body cited in the real packs.
const OFFICIAL_HOSTS = Object.freeze([
  // Generic restricted government namespaces (UK + US). nhs.uk registration is restricted to
  // NHS bodies (nic.uk policy), the same restricted-namespace logic as gov.uk.
  'gov.uk',
  'gov',
  'nhs.uk',
  // UK statutory / recognised regulators and redress bodies actually cited in the packs.
  'legislation.gov.uk',
  'sra.org.uk',
  'gmc-uk.org',
  'cqc.org.uk',
  'gdc-uk.org',
  'pharmacyregulation.org',
  'asa.org.uk',
  'cap.org.uk',
  'fca.org.uk',
  'ico.org.uk',
  'hcpc-uk.org',
  'rcvs.org.uk',
  'optical.org',
  'clc-uk.org',
  'cilexregulation.org.uk',
  'barstandardsboard.org.uk',
  'legalombudsman.org.uk',
  'ipso.co.uk',
  'ofcom.org.uk',
  'gassaferegister.co.uk',
  'caa.co.uk',
  // US statutory regulators, courts and bar-discipline bodies actually cited in the packs
  // (most are already covered by the generic ".gov" suffix above; kept explicit too so the
  // allowlist stays self-documenting and survives a future move away from the generic rule).
  'ecfr.gov',
  'federalregister.gov',
  'govinfo.gov',
  'ftc.gov',
  'hhs.gov',
  'ada.gov',
  'fda.gov',
  'justice.gov',
  'americanbar.org',
  'calbar.ca.gov',
  'nycourts.gov',
  'texasbar.com',
  'floridabar.org',
  'iardc.org',
]);

const lib = require('./lib');

function citationHostOfficial(url) {
  const host = lib.urlHost(url);
  if (!host) return false;
  return lib.hostMatchesAllowlist(host, OFFICIAL_HOSTS);
}

// Every check below has the exact same shape: (record, locator, id) -> finding[]. checkRecord
// (the aggregator, at the foot of this section) just concatenates them. Split out of the former
// single checkRecord (Constitution Rule 4/tools/health-gate/check.js caps): each check reads
// independently and none of the underlying rule/message logic changed, only where it lives.

// 1. candidate rows require an official-host citation.url (Constitution Rule 14 / caution.md C-104)
function checkCitation(record, locator, id) {
  const findings = [];
  const add = (rule, message) => findings.push({ locator, id, rule, message });
  if (record.status === 'candidate') {
    const url = record.citation && record.citation.url;
    if (typeof url !== 'string' || url.trim().length === 0) {
      add('citation-missing', 'candidate record has no citation.url');
    } else if (!citationHostOfficial(url)) {
      const host = lib.urlHost(url);
      add('citation-host-unofficial', 'candidate record citation.url host ' + JSON.stringify(host || url) + ' is not on OFFICIAL_HOSTS: ' + url);
    }
  }
  return findings;
}

// 2. provenance.sources non-empty (every row, any status: Rule 14 binds unconditionally)
function checkProvenance(record, locator, id) {
  const findings = [];
  const add = (rule, message) => findings.push({ locator, id, rule, message });
  const sources = record.provenance && record.provenance.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    add('provenance-sources-empty', 'provenance.sources is missing or empty');
  }
  return findings;
}

// 3. penalty.currency + penalty.basis present (every row)
function checkPenaltyFields(record, locator, id) {
  const findings = [];
  const add = (rule, message) => findings.push({ locator, id, rule, message });
  const penalty = record.penalty || {};
  if (typeof penalty.currency !== 'string' || penalty.currency.trim().length === 0) {
    add('penalty-currency-missing', 'penalty.currency is missing');
  }
  if (typeof penalty.basis !== 'string' || penalty.basis.trim().length === 0) {
    add('penalty-basis-missing', 'penalty.basis is missing');
  }
  return findings;
}

// enforcementUrlMissing/enforcementDateMissing: named predicates (each RETURNS a boolean, so the
// multi-operator test lives in the predicate, not in an if/else-if TEST position) pulled out of
// checkEnforcementEntries' former forEach callback (Constitution Rule 4/tools/health-gate/check.js
// caps: the anonymous callback carried this file's whole per-entry decision tree).
function enforcementUrlMissing(e) {
  return !e || typeof e.url !== 'string' || e.url.trim().length === 0;
}
function enforcementDateMissing(e) {
  return !e || typeof e.date !== 'string' || e.date.trim().length === 0;
}

// checkEnforcementEntry(e, i, add) - one enforcement[] entry's url/date checks. Named and
// extracted out of the former forEach callback so its decisions are counted against this small
// unit, not against checkEnforcementEntries itself.
function checkEnforcementEntry(e, i, add) {
  const tag = 'enforcement[' + i + ']';
  if (enforcementUrlMissing(e)) {
    add('enforcement-url-missing', tag + ' has no url');
  } else if (!citationHostOfficial(e.url)) {
    // secondary/informational: report honestly, do not silently allow, but keep distinct.
    const host = lib.urlHost(e.url);
    add('enforcement-host-unofficial', tag + '.url host ' + JSON.stringify(host || e.url) + ' is not on OFFICIAL_HOSTS: ' + e.url);
  }
  if (enforcementDateMissing(e)) {
    add('enforcement-date-missing', tag + ' has no date');
  }
}

// 4. enforcement[] entries each carry url + date (every row); url is also checked against
// OFFICIAL_HOSTS as a secondary/informational finding (reported honestly, never silently allowed).
function checkEnforcementEntries(record, locator, id) {
  const findings = [];
  const add = (rule, message) => findings.push({ locator, id, rule, message });
  const enforcement = Array.isArray(record.enforcement) ? record.enforcement : [];
  enforcement.forEach((e, i) => checkEnforcementEntry(e, i, add));
  return findings;
}

// registerUrlNeedsCheck(registerUrl) -> boolean. Named predicate pulled out of checkRegisterUrl's
// own if TEST (the multi-operator test now lives in a RETURN, not a test position).
function registerUrlNeedsCheck(registerUrl) {
  return typeof registerUrl === 'string' && registerUrl.trim().length > 0 && !citationHostOfficial(registerUrl);
}

// SECONDARY (informational): regulator.register_url is also checked against OFFICIAL_HOSTS.
function checkRegisterUrl(record, locator, id) {
  const findings = [];
  const add = (rule, message) => findings.push({ locator, id, rule, message });
  const registerUrl = record.regulator && record.regulator.register_url;
  if (registerUrlNeedsCheck(registerUrl)) {
    const host = lib.urlHost(registerUrl);
    add('register-host-unofficial', 'regulator.register_url host ' + JSON.stringify(host || registerUrl) + ' is not on OFFICIAL_HOSTS: ' + registerUrl);
  }
  return findings;
}

// checkRecord(record, locator) -> finding[] (never throws). A small aggregator over the checks
// above - it invents no rule of its own.
function checkRecord(record, locator) {
  const id = typeof record.id === 'string' ? record.id : '<no id>';
  return [
    ...checkCitation(record, locator, id),
    ...checkProvenance(record, locator, id),
    ...checkPenaltyFields(record, locator, id),
    ...checkEnforcementEntries(record, locator, id),
    ...checkRegisterUrl(record, locator, id),
  ];
}

function scan(dirsOrPatterns) {
  const { entries, parseErrors } = lib.loadRecords(dirsOrPatterns);
  const violations = [];
  for (const entry of entries) {
    if (entry.shape !== 'com') continue; // this linter only understands COM-shaped records
    for (const f of checkRecord(entry.record, entry.locator)) {
      violations.push({ file: entry.file, ...f });
    }
  }
  // CR-7: an unreadable/unparseable file fails the gate through the same violations array a real
  // citation-completeness defect uses.
  for (const v of lib.parseErrorViolations(parseErrors)) violations.push(v);
  return { violations, scanned: entries.length, parseErrors };
}

function selfTest() {
  const badCandidate = {
    id: 'CAL_SELFTEST_CITATION',
    citation: { act: 'x', section: 'y', url: 'https://example-law-blog.com/post' },
    status: 'candidate',
    provenance: { sources: ['seed'] },
    penalty: { currency: 'GBP', basis: 'x' },
    enforcement: [],
    regulator: {},
    website_obligations: [],
  };
  const good = {
    id: 'CAL_SELFTEST_CITATION_GOOD',
    citation: { act: 'x', section: 'y', url: 'https://www.legislation.gov.uk/x' },
    status: 'candidate',
    provenance: { sources: ['seed'] },
    penalty: { currency: 'GBP', basis: 'x' },
    enforcement: [],
    regulator: {},
    website_obligations: [],
  };
  const badFindings = checkRecord(badCandidate, 'selftest');
  const goodFindings = checkRecord(good, 'selftest');
  const pass = badFindings.some((f) => f.rule === 'citation-host-unofficial') && goodFindings.length === 0;
  return {
    pass,
    detail: pass ? 'catches an unofficial-host citation and clears an official one' : 'FAILED to distinguish an unofficial citation host from an official one: ' + JSON.stringify({ badFindings, goodFindings }),
  };
}

const toFindings = lib.makeToFindings('catalogue-citation-completeness');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'citation-completeness');
}

if (require.main === module) main();

module.exports = { OFFICIAL_HOSTS, citationHostOfficial, checkRecord, scan, selfTest, toFindings };
