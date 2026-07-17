#!/usr/bin/env node
'use strict';
/**
 * FACTS-ABSTAIN: the unreachable/empty-bundle abstention gate.
 *
 * Calibration id: p1-unreachable-bundle-abstain (eval/calibration-known-bad/run.js), fixture
 * eval/calibration-known-bad/fixtures/p1-reference-fixtures-unreachable-bundle.json.
 *
 * A bot-walled page (caution.md C-038: jarir.com, empty corpus) or an unrendered SPA shell
 * (C-032: royalparkpartners.com, zero visible text) must never be asserted against: every facts
 * module fed such a bundle must ABSTAIN on every fact. This checker runs facts/identity.js,
 * facts/jurisdiction.js and facts/sector.js over every bundle it is given that LOOKS unreachable
 * (bundle.unreachable === true, or a non-empty pages[] whose visible text is entirely blank) and
 * reports a finding for every non-abstain emission it sees - the seeded disease this gate exists
 * to catch (facts/identity.js's rung-6 domain-stem fallback is "always clean" for a genuinely
 * reachable site with only a weak signal, but it fires just as readily on a page nobody ever
 * actually read, which is exactly the class this gate polices).
 *
 * Modes (the tools/lib/gate-cli.js dialect; see tools/swallow-gate/check.js for the same contract):
 *   node tools/facts-abstain/check.js <bundle.json> [<bundle.json>|<dir> ...]   scan real bundle
 *                                     file(s), exit 1 on any non-abstain emission
 *   node tools/facts-abstain/check.js --calibrate    scan eval/calibration-known-bad/fixtures/ and
 *                                     REQUIRE the seeded unreachable bundles to be caught
 *   ... --json <path>   also write findings JSON for the sweep normaliser
 */
const fs = require('fs');
const path = require('path');

const { runGateCli, ROOT } = require('../lib/gate-cli');
const identity = require('../../facts/identity.js');
const jurisdiction = require('../../facts/jurisdiction.js');
const sector = require('../../facts/sector.js');

// looksUnreachable(bundle) -> true when this gate's abstention doctrine applies: the bundle says
// so itself, or a fetched page carries zero visible text (the SPA-shell class).
function looksUnreachable(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (bundle.unreachable === true) return true;
  const pages = bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const text = pages.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  return pages.length > 0 && text.length === 0;
}

// bundlesIn(parsed) -> [bundle, ...]. Accepts either the calibration fixture's {bundles:[...]}
// wrapper or a single bare EvidenceBundle (the "loads a bundle JSON given as argv" shape).
function bundlesIn(parsed) {
  if (parsed && Array.isArray(parsed.bundles)) return parsed.bundles;
  if (parsed && typeof parsed === 'object' && parsed.corpus) return [parsed];
  return [];
}

// checkBundle(bundle, source) -> finding[]. Never throws: a facts module throwing on an
// unreachable bundle IS itself a finding, not a crash that hides the disease this gate exists to
// report (Constitution Rule 4).
function checkBundle(bundle, source) {
  const findings = [];
  // recordFinding: named so the repo-wide swallow-gate AST scan (tools/swallow-gate/check.js)
  // recognises the catch blocks below as RECORDING, not swallowing - a facts module throwing on
  // an unreachable bundle is itself a finding this gate must surface, never hide.
  const recordFinding = (rule, message) => findings.push({ file: source, rule, message });
  const domain = (bundle && bundle.domain) || '(no domain)';

  try {
    const id = identity.resolveIdentity(bundle);
    for (const field of ['display_name', 'legal_name', 'company_number', 'registered_office', 'slug']) {
      const f = id[field];
      if (f && f.confidence !== 'abstain') {
        recordFinding('facts-abstain/identity-non-abstain', domain + ': facts/identity.js emitted ' + field + '=' + JSON.stringify(f.value) + ' at confidence ' + f.confidence + ' on an unreachable bundle; it must abstain');
      }
    }
  } catch (e) {
    recordFinding('facts-abstain/identity-threw', domain + ': facts/identity.js threw instead of abstaining: ' + e.message);
  }

  try {
    const jur = jurisdiction.resolveJurisdiction(bundle);
    if (!jur.abstained) {
      recordFinding('facts-abstain/jurisdiction-non-abstain', domain + ': facts/jurisdiction.js bound [' + jur.bound.map((b) => b.jurisdiction).join(',') + '] on an unreachable bundle; it must abstain');
    }
  } catch (e) {
    recordFinding('facts-abstain/jurisdiction-threw', domain + ': facts/jurisdiction.js threw instead of abstaining: ' + e.message);
  }

  try {
    const sec = sector.resolveSector(bundle);
    if (sec.confidence !== 'abstain') {
      recordFinding('facts-abstain/sector-non-abstain', domain + ': facts/sector.js emitted sector=' + JSON.stringify(sec.value) + ' at confidence ' + sec.confidence + ' on an unreachable bundle; it must abstain');
    }
  } catch (e) {
    recordFinding('facts-abstain/sector-threw', domain + ': facts/sector.js threw instead of abstaining: ' + e.message);
  }

  return findings;
}

// scan(pathsOrDirs) -> {violations, bundlesSeen, unreachableSeen}. Each entry may be a bundle
// file or a directory of *.json files (gate-cli supplies [CALIBRATE_DIR] under --calibrate).
function scan(pathsOrDirs) {
  const violations = [];
  let bundlesSeen = 0;
  let unreachableSeen = 0;
  for (const p of pathsOrDirs || []) {
    const abs = path.resolve(ROOT, p);
    const files = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
      ? fs.readdirSync(abs).filter((f) => f.endsWith('.json')).map((f) => path.join(abs, f))
      : (fs.existsSync(abs) ? [abs] : []);
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { continue; /* FAIL-OPEN: a file that is not valid JSON, or not this gate's bundle shape, belongs to another gate; never crash the whole scan on someone else's fixture. */ }
      for (const bundle of bundlesIn(parsed)) {
        bundlesSeen++;
        if (!looksUnreachable(bundle)) continue;
        unreachableSeen++;
        violations.push(...checkBundle(bundle, rel));
      }
    }
  }
  return { violations, bundlesSeen, unreachableSeen };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'facts-abstain', ruleId: v.rule, file: v.file, startLine: 0, endLine: 0,
    level: 'error', message: v.message,
  }));
}

// Self-test: prove the REAL facts modules, run through this gate's own logic, still catch the
// class (identity's domain-stem fallback firing on a bundle nobody ever actually read) - purely
// synthetic, in-memory, no fixture files.
function selfTest() {
  const bad = checkBundle({
    domain: 'selftest-unreachable.example',
    unreachable: true,
    corpus: { pages: [{ url: 'https://selftest-unreachable.example/', title: 'Attention Required!', text: 'Checking your browser before accessing.', jsonLd: [] }], footerText: '' },
    registers: {},
  }, 'selftest');
  const ordinaryIsNotUnreachable = looksUnreachable({
    domain: 'ordinary.example',
    corpus: { pages: [{ url: 'https://ordinary.example/', title: 'Ordinary Co', text: 'A perfectly ordinary reachable page with real content.', jsonLd: [] }] },
    registers: {},
  }) === false;
  const pass = bad.some((f) => f.rule === 'facts-abstain/identity-non-abstain') && ordinaryIsNotUnreachable;
  return {
    pass,
    detail: pass
      ? 'catches the domain-stem non-abstain emission on a synthetic unreachable bundle, and does not misclassify an ordinary reachable bundle as unreachable'
      : 'FAILED: ' + JSON.stringify({ bad, ordinaryIsNotUnreachable }),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a, i) => a !== '--calibrate' && a !== '--json' && argv[i - 1] !== '--json');
  runGateCli({
    name: 'facts-abstain',
    selfTest,
    scan,
    toFindings,
    scanDirs: positional,
    summary: (r) => r.bundlesSeen + ' bundle(s) seen, ' + r.unreachableSeen + ' unreachable, ' + r.violations.length + ' violation(s)',
    calibrateSummary: (r) => r.bundlesSeen + ' fixture bundle(s), ' + r.unreachableSeen + ' unreachable, ' + r.violations.length + ' seeded violation(s) found',
    violationLine: (v) => '[' + v.rule + '] ' + v.file + ': ' + v.message,
  });
}

if (require.main === module) main();

module.exports = { looksUnreachable, bundlesIn, checkBundle, scan, selfTest, toFindings };
