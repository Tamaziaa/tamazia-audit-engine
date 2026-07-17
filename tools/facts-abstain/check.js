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
const safePath = require('../lib/safe-path');
const identity = require('../../facts/identity.js');
const jurisdiction = require('../../facts/jurisdiction.js');
const sector = require('../../facts/sector.js');

// looksUnreachable(bundle) -> true when this gate's abstention doctrine applies: the bundle says
// so itself, or a fetched page carries zero visible text ANYWHERE this gate is willing to call
// "content" (the SPA-shell class). CR-40 (CodeRabbit PR #3, tools/facts-abstain/check.js#L39-L41):
// this must include corpus.footerText - a page whose body text is blank but whose CAPTURED footer
// carries real content (company number, registered office, etc - exactly the surface
// facts/identity.js's own footer-text detection reads) is NOT the bot-walled/SPA-shell class this
// gate exists to police; treating it as unreachable would wrongly force abstention on a genuinely
// readable page.
function looksUnreachable(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (bundle.unreachable === true) return true;
  const pages = bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const pageText = pages.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
  const footerText = bundle.corpus && typeof bundle.corpus.footerText === 'string' ? bundle.corpus.footerText : '';
  const text = (pageText + footerText).trim();
  return pages.length > 0 && text.length === 0;
}

// bundlesIn(parsed) -> [bundle, ...]. Accepts either the calibration fixture's {bundles:[...]}
// wrapper or a single bare EvidenceBundle (the "loads a bundle JSON given as argv" shape).
function bundlesIn(parsed) {
  if (parsed && Array.isArray(parsed.bundles)) return parsed.bundles;
  if (parsed && typeof parsed === 'object' && parsed.corpus) return [parsed];
  return [];
}

// REAL_RESOLVERS: the production facts modules this gate polices in every real scan (CLI runs,
// the eval/calibration-known-bad/ fixture run, and the "real-module" test in check.test.js). The
// ONLY door through which checkBundle talks to facts/identity.js, facts/jurisdiction.js and
// facts/sector.js - selfTest below never imports this constant, keeping the two concerns (does the
// GATE'S OWN LOGIC catch a non-abstain emission; does the REAL production code currently abstain)
// structurally separate (CR-42).
const REAL_RESOLVERS = {
  resolveIdentity: (bundle) => identity.resolveIdentity(bundle),
  resolveJurisdiction: (bundle) => jurisdiction.resolveJurisdiction(bundle),
  resolveSector: (bundle) => sector.resolveSector(bundle),
};

// checkBundle(bundle, source, resolvers = REAL_RESOLVERS) -> finding[]. Never throws: a facts
// module throwing on an unreachable bundle IS itself a finding, not a crash that hides the disease
// this gate exists to report (Constitution Rule 4). `resolvers` is an injectable {resolveIdentity,
// resolveJurisdiction, resolveSector} triple (CR-42): production code and the calibration fixture
// run always use REAL_RESOLVERS; selfTest below injects DELIBERATELY FAULTY stubs instead, so this
// gate's self-test proves its OWN detection logic, not a currently-live production bug that a
// future fix could silently make disappear.
function checkBundle(bundle, source, resolvers) {
  const R = resolvers || REAL_RESOLVERS;
  const findings = [];
  // recordFinding: named so the repo-wide swallow-gate AST scan (tools/swallow-gate/check.js)
  // recognises the catch blocks below as RECORDING, not swallowing - a facts module throwing on
  // an unreachable bundle is itself a finding this gate must surface, never hide.
  const recordFinding = (rule, message) => findings.push({ file: source, rule, message });
  const domain = (bundle && bundle.domain) || '(no domain)';

  try {
    const id = R.resolveIdentity(bundle);
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
    const jur = R.resolveJurisdiction(bundle);
    if (!jur.abstained) {
      recordFinding('facts-abstain/jurisdiction-non-abstain', domain + ': facts/jurisdiction.js bound [' + jur.bound.map((b) => b.jurisdiction).join(',') + '] on an unreachable bundle; it must abstain');
    }
  } catch (e) {
    recordFinding('facts-abstain/jurisdiction-threw', domain + ': facts/jurisdiction.js threw instead of abstaining: ' + e.message);
  }

  try {
    const sec = R.resolveSector(bundle);
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
//
// CR-41 (fail closed): a scan that never actually looked at anything must never report a clean
// "0 violation(s)" pass. Every one of the following is now folded into `violations` (as a
// facts-abstain/scan-error finding, the SAME channel a real non-abstain-emission finding uses, so
// runGateCli's exit code and --json output both pick it up with no second door to forget):
//   - zero paths/dirs supplied at all (a bare `node tools/facts-abstain/check.js` with no args)
//   - a supplied path that does not exist
//   - a DIRECTLY named file (not discovered while walking a directory) that fails to read or parse
//     as JSON, or that parses but is not a recognised EvidenceBundle/`{bundles:[...]}` shape
// The ONE case that stays a silent skip: a file discovered while walking a MIXED DIRECTORY (gate-cli
// hands this gate the shared eval/calibration-known-bad/fixtures/ directory, which legitimately
// holds fixtures belonging to every other gate too) that is not this gate's shape - that is
// recognised, not swallowed, exactly like catalogue/linters/lib.js's own "not a rule/record" case.
// recordScanError(violations, file, message) - named so the repo-wide swallow-gate AST scan
// (tools/swallow-gate/check.js) recognises every catch block below as RECORDING, not swallowing:
// a scan that could not read its input IS a finding this gate must surface, never a silent skip.
function recordScanError(violations, file, message) {
  violations.push({ file, rule: 'facts-abstain/scan-error', message });
}

function scan(pathsOrDirs) {
  const violations = [];
  let bundlesSeen = 0;
  let unreachableSeen = 0;
  const inputs = pathsOrDirs || [];

  if (inputs.length === 0) {
    recordScanError(violations, '(no input)', 'no path(s) or directory(ies) supplied - nothing was scanned; a scan that never ran must never report a clean pass');
  }

  for (const p of inputs) {
    let abs;
    try {
      safePath.assertSafeRelativePath(p, { label: 'facts-abstain scan path' });
      abs = path.resolve(ROOT, p);
    } catch (e) {
      recordScanError(violations, String(p), e.message);
      continue;
    }
    if (!fs.existsSync(abs)) {
      recordScanError(violations, String(p), 'path does not exist: ' + p);
      continue;
    }
    const isDir = fs.statSync(abs).isDirectory();
    const files = isDir
      ? fs.readdirSync(abs).filter((f) => f.endsWith('.json')).map((f) => safePath.safeJoin(abs, [f], { label: 'facts-abstain bundle filename' }))
      : [abs];
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        if (isDir) continue; // FAIL-OPEN: a file discovered while walking a MIXED DIRECTORY legitimately belongs to another gate (a directory scan is expected to hold fixtures this gate does not own); a file the CALLER named DIRECTLY carries no such excuse and fails closed instead (CR-41), recorded just below.
        recordScanError(violations, rel, 'failed to read/parse as JSON: ' + e.message);
        continue;
      }
      const bundles = bundlesIn(parsed);
      if (bundles.length === 0 && !isDir) {
        recordScanError(violations, rel, 'not a recognised EvidenceBundle or {bundles:[...]} wrapper shape');
      }
      for (const bundle of bundles) {
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

// Self-test (CR-42, CodeRabbit PR #3: "the gate can only pass while the behaviour it is intended
// to prevent remains in production"). This proves the GATE'S OWN detection logic (checkBundle) -
// never the real facts/identity.js|jurisdiction.js|sector.js modules - correctly flags a non-abstain
// emission, a thrown error, and correctly clears a genuinely abstaining response, on a synthetic
// unreachable bundle. Deliberately FAULTY stub resolvers are injected (never REAL_RESOLVERS) so a
// future FIX to the real production bug this gate was built to catch can never silently break this
// self-test: this test's job is "can the gate see the class", not "does today's production code
// still have the bug". The REAL modules are exercised separately and unconditionally by the
// eval/calibration-known-bad/fixtures/p1-reference-fixtures-unreachable-bundle.json calibration run
// (wired in eval/calibration-known-bad/run.js) and by check.test.js's own "real-module" test.
function selfTest() {
  const unreachableBundle = {
    domain: 'selftest-unreachable.example',
    unreachable: true,
    corpus: { pages: [{ url: 'https://selftest-unreachable.example/', title: 'Attention Required!', text: 'Checking your browser before accessing.', jsonLd: [] }], footerText: '' },
    registers: {},
  };

  const faultyNonAbstainResolvers = {
    resolveIdentity: () => ({ display_name: { value: 'Faulty Stub Co', confidence: 'weak' } }),
    resolveJurisdiction: () => ({ abstained: false, bound: [{ jurisdiction: 'UK' }] }),
    resolveSector: () => ({ value: 'law-firms', confidence: 'weak' }),
  };
  const faultyThrowingResolvers = {
    resolveIdentity: () => { throw new Error('synthetic injected failure'); },
    resolveJurisdiction: () => { throw new Error('synthetic injected failure'); },
    resolveSector: () => { throw new Error('synthetic injected failure'); },
  };
  const correctlyAbstainingResolvers = {
    resolveIdentity: () => ({ display_name: { value: null, confidence: 'abstain' } }),
    resolveJurisdiction: () => ({ abstained: true, bound: [] }),
    resolveSector: () => ({ value: null, confidence: 'abstain' }),
  };

  const nonAbstainF = checkBundle(unreachableBundle, 'selftest', faultyNonAbstainResolvers);
  const throwF = checkBundle(unreachableBundle, 'selftest', faultyThrowingResolvers);
  const abstainingF = checkBundle(unreachableBundle, 'selftest', correctlyAbstainingResolvers);

  const ordinaryIsNotUnreachable = looksUnreachable({
    domain: 'ordinary.example',
    corpus: { pages: [{ url: 'https://ordinary.example/', title: 'Ordinary Co', text: 'A perfectly ordinary reachable page with real content.', jsonLd: [] }] },
    registers: {},
  }) === false;

  // CR-40: blank page text but a NON-EMPTY captured footer must NOT be treated as unreachable.
  const footerTextIsReachable = looksUnreachable({
    domain: 'footer-only.example',
    corpus: { pages: [{ url: 'https://footer-only.example/', title: '', text: '', jsonLd: [] }], footerText: 'Footer Co Ltd, company number 12345678, registered office 1 Example Street' },
  }) === false;

  // CR-41: an empty scan input must itself be a failure, never a clean pass.
  const emptyScanFailsClosed = scan([]).violations.some((v) => v.rule === 'facts-abstain/scan-error');

  const pass = nonAbstainF.some((f) => f.rule === 'facts-abstain/identity-non-abstain')
    && nonAbstainF.some((f) => f.rule === 'facts-abstain/jurisdiction-non-abstain')
    && nonAbstainF.some((f) => f.rule === 'facts-abstain/sector-non-abstain')
    && throwF.some((f) => f.rule === 'facts-abstain/identity-threw')
    && throwF.some((f) => f.rule === 'facts-abstain/jurisdiction-threw')
    && throwF.some((f) => f.rule === 'facts-abstain/sector-threw')
    && abstainingF.length === 0
    && ordinaryIsNotUnreachable
    && footerTextIsReachable
    && emptyScanFailsClosed;

  return {
    pass,
    detail: pass
      ? 'catches an injected non-abstain emission, an injected thrown error, and clears a genuinely abstaining response, against injected FAULTY stub resolvers (never the real facts modules); correctly does not misclassify an ordinary reachable bundle or a footer-only bundle as unreachable; and an empty scan input fails closed rather than passing clean'
      : 'FAILED: ' + JSON.stringify({ nonAbstainF, throwF, abstainingF, ordinaryIsNotUnreachable, footerTextIsReachable, emptyScanFailsClosed }),
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

module.exports = { looksUnreachable, bundlesIn, checkBundle, scan, selfTest, toFindings, REAL_RESOLVERS };
