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
// corpusVisibleText(bundle) -> { pageCount, text }: the count of captured pages and ALL the visible
// text this gate is willing to call "content" (every page's text PLUS corpus.footerText, per CR-40),
// trimmed. Extracted so looksUnreachable stays a thin decision under the caps.
function corpusVisibleText(bundle) {
  const corpus = (bundle && bundle.corpus) || {};
  const pages = Array.isArray(corpus.pages) ? corpus.pages : [];
  const pageText = pages.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
  const footerText = typeof corpus.footerText === 'string' ? corpus.footerText : '';
  return { pageCount: pages.length, text: (pageText + footerText).trim() };
}

function looksUnreachable(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (bundle.unreachable === true) return true;
  const { pageCount, text } = corpusVisibleText(bundle);
  return pageCount > 0 && text.length === 0;
}

// bundlesIn(parsed) -> [bundle, ...]. Accepts either the calibration fixture's {bundles:[...]}
// wrapper or a single bare EvidenceBundle (the "loads a bundle JSON given as argv" shape).
function bundlesIn(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.bundles)) return parsed.bundles;
  if (parsed.corpus) return [parsed];
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
// checkIdentity/checkJurisdiction/checkSector: one resolver each, split out of checkBundle so no single
// unit exceeds the caps. `record(rule, message)` is the shared recorder; each catch RECORDS via it (a
// facts module throwing on an unreachable bundle is itself a finding this gate must surface, never
// swallow). recordFinding is named to match the swallow-gate RECORDER pattern (record[A-Z_]...) so its
// AST scan reads every catch below as RECORDING, not silently swallowing.
function checkIdentity(bundle, resolveIdentity, domain, recordFinding) {
  let id;
  try {
    id = resolveIdentity(bundle);
  } catch (e) {
    recordFinding('facts-abstain/identity-threw', domain + ': facts/identity.js threw instead of abstaining: ' + e.message);
    return;
  }
  for (const field of ['display_name', 'legal_name', 'company_number', 'registered_office', 'slug']) {
    const f = id[field];
    if (f && f.confidence !== 'abstain') {
      recordFinding('facts-abstain/identity-non-abstain', domain + ': facts/identity.js emitted ' + field + '=' + JSON.stringify(f.value) + ' at confidence ' + f.confidence + ' on an unreachable bundle; it must abstain');
    }
  }
}

function checkJurisdiction(bundle, resolveJurisdiction, domain, recordFinding) {
  try {
    const jur = resolveJurisdiction(bundle);
    if (!jur.abstained) {
      recordFinding('facts-abstain/jurisdiction-non-abstain', domain + ': facts/jurisdiction.js bound [' + jur.bound.map((b) => b.jurisdiction).join(',') + '] on an unreachable bundle; it must abstain');
    }
  } catch (e) {
    recordFinding('facts-abstain/jurisdiction-threw', domain + ': facts/jurisdiction.js threw instead of abstaining: ' + e.message);
  }
}

function checkSector(bundle, resolveSector, domain, recordFinding) {
  try {
    const sec = resolveSector(bundle);
    if (sec.confidence !== 'abstain') {
      recordFinding('facts-abstain/sector-non-abstain', domain + ': facts/sector.js emitted sector=' + JSON.stringify(sec.value) + ' at confidence ' + sec.confidence + ' on an unreachable bundle; it must abstain');
    }
  } catch (e) {
    recordFinding('facts-abstain/sector-threw', domain + ': facts/sector.js threw instead of abstaining: ' + e.message);
  }
}

function checkBundle(bundle, source, resolvers) {
  const R = resolvers || REAL_RESOLVERS;
  const findings = [];
  const recordFinding = (rule, message) => findings.push({ file: source, rule, message });
  const domain = (bundle && bundle.domain) || '(no domain)';
  checkIdentity(bundle, R.resolveIdentity, domain, recordFinding);
  checkJurisdiction(bundle, R.resolveJurisdiction, domain, recordFinding);
  checkSector(bundle, R.resolveSector, domain, recordFinding);
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

// resolveScanTarget(p, violations) -> { files, isDir } for one input, or null (recording the reason)
// when it is an unsafe path or does not exist. A scan target is a READ path a caller names: it
// legitimately arrives ABSOLUTE (an operator naming a bundle anywhere on disk, or a test's temp
// fixture) and is used directly; assertSafeScanPath accepts absolute and traversal-guards a relative
// one, path.resolve(ROOT, abs) is a no-op for an absolute p (CR safe-path.js:43 consumer audit).
function resolveScanTarget(p, violations) {
  let abs;
  try {
    safePath.assertSafeScanPath(p, { label: 'facts-abstain scan path' });
    abs = path.resolve(ROOT, p);
  } catch (e) {
    recordScanError(violations, String(p), e.message);
    return null;
  }
  if (!fs.existsSync(abs)) {
    recordScanError(violations, String(p), 'path does not exist: ' + p);
    return null;
  }
  const isDir = fs.statSync(abs).isDirectory();
  const files = isDir
    ? fs.readdirSync(abs).filter((f) => f.endsWith('.json')).map((f) => safePath.safeJoin(abs, [f], { label: 'facts-abstain bundle filename' }))
    : [abs];
  return { files, isDir };
}

// processBundles(bundles, rel, acc) -> run checkBundle over every bundle that LOOKS unreachable,
// folding its findings into acc.violations and updating the seen counters.
function processBundles(bundles, rel, acc) {
  for (const bundle of bundles) {
    acc.bundlesSeen++;
    if (!looksUnreachable(bundle)) continue;
    acc.unreachableSeen++;
    acc.violations.push(...checkBundle(bundle, rel));
  }
}

// scanBundlesInFile(file, isDir, acc) -> parse one file and process its bundles. A parse failure on a
// file discovered while walking a MIXED DIRECTORY legitimately belongs to another gate (FAIL-OPEN,
// skip); a DIRECTLY named file carries no such excuse and fails closed (CR-41), recorded not swallowed.
function scanBundlesInFile(file, isDir, acc) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (isDir) return; // FAIL-OPEN: mixed-directory fixture belonging to another gate.
    recordScanError(acc.violations, rel, 'failed to read/parse as JSON: ' + e.message);
    return;
  }
  const bundles = bundlesIn(parsed);
  if (bundles.length === 0 && !isDir) {
    recordScanError(acc.violations, rel, 'not a recognised EvidenceBundle or {bundles:[...]} wrapper shape');
  }
  processBundles(bundles, rel, acc);
}

function scan(pathsOrDirs) {
  const acc = { violations: [], bundlesSeen: 0, unreachableSeen: 0 };
  const inputs = pathsOrDirs || [];

  if (inputs.length === 0) {
    recordScanError(acc.violations, '(no input)', 'no path(s) or directory(ies) supplied - nothing was scanned; a scan that never ran must never report a clean pass');
  }

  for (const p of inputs) {
    const target = resolveScanTarget(p, acc.violations);
    if (!target) continue;
    for (const file of target.files) scanBundlesInFile(file, target.isDir, acc);
  }
  // Terminal fail-closed check: inputs were supplied but yielded zero recognised bundles (an empty
  // directory, or every file skipped as malformed/unrelated). A scan that examined nothing must
  // never report a clean pass - same doctrine as the no-input guard above.
  if (inputs.length > 0 && acc.bundlesSeen === 0) {
    recordScanError(acc.violations, '(no bundles)', 'supplied path(s) yielded 0 recognised bundles - nothing was actually checked; an empty scan must never report a clean pass');
  }
  return { violations: acc.violations, bundlesSeen: acc.bundlesSeen, unreachableSeen: acc.unreachableSeen };
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
// selfTestUnreachableBundle() -> the one synthetic bundle every checkBundle() case below runs
// against.
function selfTestUnreachableBundle() {
  return {
    domain: 'selftest-unreachable.example',
    unreachable: true,
    corpus: { pages: [{ url: 'https://selftest-unreachable.example/', title: 'Attention Required!', text: 'Checking your browser before accessing.', jsonLd: [] }], footerText: '' },
    registers: {},
  };
}

// selfTestResolverStubs() -> the three DELIBERATELY FAULTY/correct stub resolver triples CR-42
// requires (see the file-level comment above selfTest): never REAL_RESOLVERS.
function selfTestResolverStubs() {
  return {
    faultyNonAbstain: {
      resolveIdentity: () => ({ display_name: { value: 'Faulty Stub Co', confidence: 'weak' } }),
      resolveJurisdiction: () => ({ abstained: false, bound: [{ jurisdiction: 'UK' }] }),
      resolveSector: () => ({ value: 'law-firms', confidence: 'weak' }),
    },
    faultyThrowing: {
      resolveIdentity: () => { throw new Error('synthetic injected failure'); },
      resolveJurisdiction: () => { throw new Error('synthetic injected failure'); },
      resolveSector: () => { throw new Error('synthetic injected failure'); },
    },
    correctlyAbstaining: {
      resolveIdentity: () => ({ display_name: { value: null, confidence: 'abstain' } }),
      resolveJurisdiction: () => ({ abstained: true, bound: [] }),
      resolveSector: () => ({ value: null, confidence: 'abstain' }),
    },
  };
}

// runSelfTestCases() -> the raw per-case results selfTest evaluates. Pulled out of selfTest as its
// own step (Constitution Rule 4/tools/health-gate/check.js caps: the former inline selfTest body
// was 61 lines).
function runSelfTestCases() {
  const unreachableBundle = selfTestUnreachableBundle();
  const stubs = selfTestResolverStubs();

  const nonAbstainF = checkBundle(unreachableBundle, 'selftest', stubs.faultyNonAbstain);
  const throwF = checkBundle(unreachableBundle, 'selftest', stubs.faultyThrowing);
  const abstainingF = checkBundle(unreachableBundle, 'selftest', stubs.correctlyAbstaining);

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

  return { nonAbstainF, throwF, abstainingF, ordinaryIsNotUnreachable, footerTextIsReachable, emptyScanFailsClosed };
}

// evaluateSelfTestCases(r) -> boolean pass; every individual expectation the original selfTest
// asserted, unchanged.
function evaluateSelfTestCases(r) {
  const checks = [
    r.nonAbstainF.some((f) => f.rule === 'facts-abstain/identity-non-abstain'),
    r.nonAbstainF.some((f) => f.rule === 'facts-abstain/jurisdiction-non-abstain'),
    r.nonAbstainF.some((f) => f.rule === 'facts-abstain/sector-non-abstain'),
    r.throwF.some((f) => f.rule === 'facts-abstain/identity-threw'),
    r.throwF.some((f) => f.rule === 'facts-abstain/jurisdiction-threw'),
    r.throwF.some((f) => f.rule === 'facts-abstain/sector-threw'),
    r.abstainingF.length === 0,
    r.ordinaryIsNotUnreachable,
    r.footerTextIsReachable,
    r.emptyScanFailsClosed,
  ];
  return checks.every(Boolean);
}

function selfTest() {
  const r = runSelfTestCases();
  const pass = evaluateSelfTestCases(r);

  return {
    pass,
    detail: pass
      ? 'catches an injected non-abstain emission, an injected thrown error, and clears a genuinely abstaining response, against injected FAULTY stub resolvers (never the real facts modules); correctly does not misclassify an ordinary reachable bundle or a footer-only bundle as unreachable; and an empty scan input fails closed rather than passing clean'
      : 'FAILED: ' + JSON.stringify(r),
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
