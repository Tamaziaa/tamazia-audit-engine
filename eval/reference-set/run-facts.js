#!/usr/bin/env node
'use strict';
// eval/reference-set/run-facts.js - run the FACTS LAYER over the reference set.
//
// verify.js checks an already-built engine PAYLOAD against the hand-verified set. This harness
// closes the loop one stage earlier: for every fixture EvidenceBundle in eval/reference-set/fixtures/
// it RUNS the four facts doors directly -
//
//     facts/identity.js       -> legal_name, company_number
//     facts/jurisdiction.js   -> bound jurisdictions (the nexus)
//     facts/sector.js         -> sector family + sub-sector
//     facts/capabilities.js   -> capability predicates (exercised; never fabricates)
//
// and compares what they produce against reference-set.json under the ONE law the whole estate lives by:
//
//     MATCH        a door asserts a value and it agrees with the verified expectation
//     ABSTAIN      a door omits or marks needs-review a value the set expects       (allowed, logged)
//     OK*          a door's expectations are met by abstention because the CAPTURED bundle is an
//                  explicit unreachable (bot-walled / SPA shell)                     (allowed, logged)
//     MISSING      no fixture on disk for a verified firm - an uncovered gap         (FAIL, exit 2)
//     CONTRADICT   a door asserts a value that disagrees with a verified expectation (FAIL, exit 1)
//
// Canonicalisation is via facts/vocabulary.js (the single vocabulary door): the engine's sector
// tree speaks in canonical family keys ('law-firms'), the reference set records human aliases
// ('legal'); both sides pass through canonicalSector() before they are compared, so a vocabulary
// alias never masquerades as a contradiction. The comparison itself delegates to verify.js's
// verifyPayload() so this harness and the CI payload gate judge by exactly the same rules.
//
// Usage:
//   node eval/reference-set/run-facts.js [--set <reference-set.json>] [--fixtures <dir>] [--domain <d>] [--json]
//
// Exit codes: 0 = no contradictions (abstentions + unreachable allowed),
//             1 = at least one door contradicted hand-verified ground truth,
//             2 = a door threw, or a runner/data error (unreadable set, no fixtures dir, ...).

const fs = require('fs');
const path = require('path');

const identity = require('../../facts/identity.js');
const jurisdiction = require('../../facts/jurisdiction.js');
const sector = require('../../facts/sector.js');
const capabilities = require('../../facts/capabilities.js');
const vocabulary = require('../../facts/vocabulary.js');
const { verifyPayload, loadReferenceSet, findFirm } = require('./verify.js');

const DEFAULT_SET = path.join(__dirname, 'reference-set.json');
const DEFAULT_FIXTURES = path.join(__dirname, 'fixtures');

// The canonical sector tree, loaded once through the sector door (which loads it through the
// vocabulary door). familyOf() climbs a sub-family to its top family key.
const TREE = sector.loadVocabulary().TREE;

function canonSector(s) {
  if (s == null) return null;
  const c = vocabulary.canonicalSector(s);
  return c || s;
}

// deriveSectorFamily(facts) -> the canonicalised sector FAMILY key the sector door emitted, or
// null when the door produced no sector value. Split out of factsToPayload (health-gate caps).
function deriveSectorFamily(facts) {
  const emitted = facts.sector && facts.sector.value; // { sector, sub_sector } | null
  let sectorFamily = null;
  if (emitted && emitted.sector) {
    sectorFamily = canonSector(sector.familyOf(TREE, emitted.sector));
  }
  return sectorFamily;
}

// deriveBoundJurisdictions(facts) -> the jurisdiction door's bound list, projected to the code array.
function deriveBoundJurisdictions(facts) {
  return (facts.jurisdiction && Array.isArray(facts.jurisdiction.bound))
    ? facts.jurisdiction.bound.map((b) => b && b.jurisdiction).filter(Boolean)
    : [];
}
// factValueOrNull(fact) -> a facts-door field's value, or null when the door had no confident value.
function factValueOrNull(fact) {
  return fact && fact.value != null ? fact.value : null;
}
// deriveIdentityFields(facts) -> {legalName, companyNumber} off the identity door's output.
function deriveIdentityFields(facts) {
  const id = facts.identity || {};
  return { legalName: factValueOrNull(id.legal_name), companyNumber: factValueOrNull(id.company_number) };
}

// -------------------------------------------------------------------------------------------------
// Turn the four facts outputs into the tolerant payload shape verify.js reads, applying the one
// piece of canonicalisation the facts layer owes the comparator: lift the engine's emitted sector
// node to its canonical FAMILY key. The reference set's `sector` is a family; sub-sector granularity
// differs between the engine's three-tier tree and the human descriptors, so sub_sector is left for
// the informational column (below) and never fed to the contradiction check - never contradict.
// -------------------------------------------------------------------------------------------------
function factsToPayload(domain, facts) {
  const sectorFamily = deriveSectorFamily(facts);
  const bound = deriveBoundJurisdictions(facts);
  const { legalName, companyNumber } = deriveIdentityFields(facts);

  return {
    meta: { domain, sector: sectorFamily || null },
    identity: { legal_name: legalName, company_number: companyNumber },
    jurisdiction: { bound },
    // The facts layer produces no frameworks and no findings: those stages live downstream. Passing
    // empty lists makes every expected framework / known breach an honest abstention and lets every
    // known_non_breach read as correctly-not-asserted, exactly as the three-state doctrine requires.
    frameworks: [],
    findings: [],
  };
}

// A shallow firm clone whose expected.sector is canonicalised to the same family vocabulary the
// engine emits, so the reference alias ('legal') and the engine family ('law-firms') compare equal.
function canonicaliseFirm(firm) {
  const exp = (firm && firm.expected) || {};
  return Object.assign({}, firm, {
    expected: Object.assign({}, exp, {
      sector: exp.sector != null ? canonSector(exp.sector) : exp.sector,
    }),
  });
}

// subSectorTokensMatch(a, b) -> true when two normalised tokens agree exactly or one contains the
// other (loose match; both non-empty). Boolean lives in a RETURN, not a ternary test (COND guard).
function subSectorTokensMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// The informational sub-sector read: match if the engine's mid-tier sector descriptor agrees with
// the verified sub-sector under a loose token compare; otherwise ABSTAIN. It never contradicts.
function subSectorNote(emitted, expectedSub) {
  if (expectedSub == null) return null; // set does not pin a sub-sector
  if (!emitted || !emitted.sector) return 'abstain';
  const famKey = sector.familyOf(TREE, emitted.sector);
  // The engine descriptor the reference sub-sector corresponds to: the sub-family node when the
  // emitted sector sits under a family, else the emitted leaf sub_sector.
  const descriptor = emitted.sector === famKey ? emitted.sub_sector : emitted.sector;
  if (!descriptor) return 'abstain';
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(descriptor);
  const b = norm(expectedSub);
  return subSectorTokensMatch(a, b) ? 'match' : 'abstain';
}

// predicateIsPresent(pred) -> true when a capability predicate entry is marked present.
function predicateIsPresent(pred) {
  return pred && pred.present === 'yes';
}
function capsSummary(caps) {
  const preds = caps && caps.predicates ? caps.predicates : {};
  let present = 0;
  let total = 0;
  for (const k of Object.keys(preds)) {
    total++;
    if (predicateIsPresent(preds[k])) present++;
  }
  return { present, total };
}

// pageHasVisibleText(page) -> true when a page object carries non-empty visible text (named so
// Array.prototype.some can take it directly; an inline arrow rolls complexity into the caller).
function pageHasVisibleText(page) {
  return page && typeof page.text === 'string' && page.text.trim() !== '';
}
// footerHasVisibleText(corpus) -> true when the corpus's footerText carries non-empty visible text.
function footerHasVisibleText(corpus) {
  return typeof corpus.footerText === 'string' && corpus.footerText.trim() !== '';
}

// hasReadableCorpus(bundle) -> true when the bundle carries OBSERVED VISIBLE TEXT: at least one page
// with non-empty text, or a non-empty footerText. Readability is a property of observed text, never
// of page COUNT: a bundle of blank page objects is NOT readable, and footer-only evidence with no
// pages IS. This mirrors facts/capabilities.js buildSurfaces, which scans exactly these surfaces, so
// the harness and the capabilities door agree on what "readable" means. Absence of readable text and
// presence of unreadable evidence must never be conflated (CR: absence != observation).
function hasReadableCorpus(bundle) {
  const corpus = bundle && bundle.corpus;
  if (!corpus || typeof corpus !== 'object') return false;
  const pages = Array.isArray(corpus.pages) ? corpus.pages : [];
  const hasPageText = pages.some(pageHasVisibleText);
  const hasFooterText = footerHasVisibleText(corpus);
  return hasPageText || hasFooterText;
}

// bundleHasPagesArray(bundle) -> true when bundle.corpus.pages exists and is an array (RETURN, not a ternary test - COND guard).
function bundleHasPagesArray(bundle) {
  return bundle && bundle.corpus && Array.isArray(bundle.corpus.pages);
}
// deriveFactsForBundle(bundle, hasCorpus) -> the four facts doors' output for one bundle.
// deriveCapabilities requires a scannable pages array by contract, so on a bundle with no pages to
// scan (footer-only, or an unreadable bundle) capabilities is simply not applicable (null) rather
// than invoked - it is NOT an error.
function deriveFactsForBundle(bundle, hasCorpus) {
  const pages = bundleHasPagesArray(bundle) ? bundle.corpus.pages : [];
  const canDeriveCaps = hasCorpus && pages.length > 0;
  return {
    identity: identity.resolveIdentity(bundle),
    jurisdiction: jurisdiction.resolveJurisdiction(bundle),
    sector: sector.resolveSector(bundle),
    capabilities: canDeriveCaps ? capabilities.deriveCapabilities(bundle) : null,
  };
}

// buildFirmResultRow(ctx) -> the final per-firm row. ctx = {firm, facts, payload, report,
// bundleUnreachable}, bundled (not exported; only caller is the call site below).
function buildFirmResultRow(ctx) {
  const { firm, facts, payload, report, bundleUnreachable } = ctx;
  const emitted = facts.sector && facts.sector.value;
  const emittedFamily = payload.meta.sector;
  const sub = subSectorNote(emitted, firm.expected && firm.expected.sub_sector);
  const caps = facts.capabilities ? capsSummary(facts.capabilities) : null;

  return {
    domain: firm.domain,
    role: firm.role,
    status: report.ok ? 'OK' : 'CONTRADICT',
    report,
    bundle_unreachable: bundleUnreachable,
    sector_family: emittedFamily,
    sector_node: emitted ? emitted.sector : null,
    sub_sector_note: sub,
    bound: payload.jurisdiction.bound,
    caps,
  };
}

// Per-firm run. Returns a row; throws only escape to the caller which records them as ERROR rows.
// assertSafeDomain(domain) -> throws on an unsafe path component before path.join (traversal guard).
function assertSafeDomain(domain) {
  if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(domain)) {
    throw new Error('unsafe path component: ' + JSON.stringify(domain));
  }
}

function runFirm(firm, fixturesDir) {
  assertSafeDomain(firm.domain);
  const fixturePath = path.join(fixturesDir, firm.domain + '.json');
  if (!fs.existsSync(fixturePath)) {
    // A verified firm with NO captured artefact on disk is an uncovered gap, not an abstention. Only
    // an explicitly captured unreachable bundle (a fixture that exists and is bot-walled / a SPA
    // shell) may abstain; a missing file evaluated nothing and must fail closed (CR: missing files
    // must fail; absence of a check is never a clean result).
    return { domain: firm.domain, role: firm.role, status: 'MISSING', detail: 'no fixture on disk - a verified firm with no captured artefact is an uncovered gap, not an abstention', report: null };
  }

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (e) {
    return { domain: firm.domain, role: firm.role, status: 'ERROR', detail: 'fixture unreadable: ' + e.message, report: null };
  }

  // A door throwing on a bundle that DOES carry a corpus is a real integration breakage and
  // surfaces as ERROR below; the tolerant doors (identity/jurisdiction/sector) abstain across the
  // board on a corpus-less bundle instead.
  const hasCorpus = hasReadableCorpus(bundle);
  const bundleUnreachable = !hasCorpus || bundle.unreachable === true;

  let facts;
  try {
    facts = deriveFactsForBundle(bundle, hasCorpus);
  } catch (e) {
    return { domain: firm.domain, role: firm.role, status: 'ERROR', detail: 'a facts door threw: ' + e.message, report: null };
  }

  const payload = factsToPayload(firm.domain, facts);
  const report = verifyPayload(payload, canonicaliseFirm(firm));

  return buildFirmResultRow({ firm, facts, payload, report, bundleUnreachable });
}

// -------------------------------------------------------------------------------------------------
// Table + summary rendering.
// -------------------------------------------------------------------------------------------------
function statusOf(report, check) {
  if (!report) return '-';
  if (report.contradictions.some((c) => c.check === check)) return 'CONTRADICT';
  if (report.matches.some((m) => m.check === check)) return 'match';
  if (report.abstentions.some((a) => a.check === check)) return 'abstain';
  return '-';
}

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// printPlaceholderRow(r, W, status) -> the placeholder row for UNREACHABLE/ERROR/MISSING statuses
// (the status label that varies between the original two inline blocks is now a parameter).
function printPlaceholderRow(r, W, status) {
  console.log([pad(r.domain, W[0]), pad(r.role, W[1]), pad('-', W[2]), pad('-', W[3]), pad('-', W[4]), pad('-', W[5]), pad(status, W[6])].join(' '));
}

// sectorCellText(sec) -> the sector column cell text (CONTRADICT stays CONTRADICT, else as-is).
function sectorCellText(sec) {
  return sec === 'CONTRADICT' ? 'CONTRADICT' : sec;
}
// formatJurCell(jur, bound) -> the jurisdiction cell: CONTRADICT stays bare, else the label is
// suffixed with the bound jurisdiction codes when there are any.
function formatJurCell(jur, bound) {
  if (jur === 'CONTRADICT') return jur;
  return bound.length ? jur + ':' + bound.join('/') : jur;
}

// printFirmRow(r, W) -> the full data row for a firm that actually ran (not UNREACHABLE/ERROR/MISSING).
function printFirmRow(r, W) {
  const sec = statusOf(r.report, 'sector');
  const jur = statusOf(r.report, 'jurisdictions_bound');
  const capCell = r.caps ? (r.caps.present + '/' + r.caps.total) : 'n/a';
  const resultCell = r.status === 'OK' && r.bundle_unreachable ? 'OK*' : r.status;
  console.log([
    pad(r.domain, W[0]),
    pad(r.role, W[1]),
    pad(sectorCellText(sec), W[2]),
    pad(r.sub_sector_note || '-', W[3]),
    pad(formatJurCell(jur, r.bound), W[4]),
    pad(capCell, W[5]),
    pad(resultCell, W[6]),
  ].join(' '));
}

function printTable(rows) {
  const H = ['domain', 'role', 'sector', 'sub', 'jur', 'caps', 'result'];
  const W = [28, 10, 12, 9, 12, 7, 11];
  console.log(H.map((h, i) => pad(h, W[i])).join(' '));
  console.log(W.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    if (r.status === 'UNREACHABLE') { printPlaceholderRow(r, W, 'UNREACHABLE'); continue; }
    if (r.status === 'ERROR' || r.status === 'MISSING') { printPlaceholderRow(r, W, r.status); continue; }
    printFirmRow(r, W);
  }
}

function summarise(rows) {
  let matches = 0;
  let abstentions = 0;
  let contradictions = 0;
  for (const r of rows) {
    if (!r.report) continue;
    matches += r.report.matches.length;
    abstentions += r.report.abstentions.length;
    contradictions += r.report.contradictions.length;
  }
  return {
    firms: rows.length,
    ok: rows.filter((r) => r.status === 'OK').length,
    contradicting: rows.filter((r) => r.status === 'CONTRADICT').length,
    unreachable: rows.filter((r) => r.status === 'UNREACHABLE').length,
    missing: rows.filter((r) => r.status === 'MISSING').length,
    errored: rows.filter((r) => r.status === 'ERROR').length,
    matches,
    abstentions,
    contradictions,
  };
}

// -------------------------------------------------------------------------------------------------
// CLI.
// -------------------------------------------------------------------------------------------------
// parseRunFactsArgs(argv) -> {opts} on success, or {exitCode} on an unrecognised argument.
function parseRunFactsArgs(argv) {
  const args = argv.slice(2);
  const opts = { json: false, set: DEFAULT_SET, fixtures: DEFAULT_FIXTURES, domain: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--set') { opts.set = args[++i]; continue; }
    if (a === '--fixtures') { opts.fixtures = args[++i]; continue; }
    if (a === '--domain') { opts.domain = args[++i]; continue; }
    console.error('Unknown argument: ' + a);
    return { exitCode: 2 };
  }
  return { opts };
}

// loadRefSetAndFixtures(opts) -> {refSet} on success, or {exitCode} when the reference set cannot
// be read or the fixtures directory does not exist.
function loadRefSetAndFixtures(opts) {
  let refSet;
  try {
    refSet = loadReferenceSet(opts.set);
  } catch (e) {
    console.error('Cannot read reference set ' + opts.set + ': ' + e.message);
    return { exitCode: 2 };
  }
  if (!fs.existsSync(opts.fixtures)) {
    console.error('Fixtures directory not found: ' + opts.fixtures);
    return { exitCode: 2 };
  }
  // Fail closed on an existing-but-empty fixtures directory: it would otherwise produce only MISSING
  // rows and, before this guard, a misleading clean exit. A gate that evaluated no artefacts has not
  // run (CR: never report a clean result for a check that never ran).
  const fixtureFiles = fs.readdirSync(opts.fixtures).filter((f) => f.endsWith('.json'));
  if (fixtureFiles.length === 0) {
    console.error('Fixtures directory is empty (no .json bundles): ' + opts.fixtures + ' - nothing to evaluate, so the run cannot report a clean result.');
    return { exitCode: 2 };
  }
  return { refSet };
}

// selectFirms(refSet, opts) -> {firms} on success, or {exitCode} when --domain names a firm not
// in the reference set.
function selectFirms(refSet, opts) {
  let firms = refSet.firms || [];
  // Fail closed on an empty firm set: a reference-set gate with nobody to check evaluated nothing.
  if (firms.length === 0) {
    console.error('Reference set has an empty firms[] array - nothing to check, so the run cannot report a clean result.');
    return { exitCode: 2 };
  }
  if (opts.domain) {
    const found = findFirm(refSet, opts.domain);
    if (!found) {
      console.error('Domain "' + opts.domain + '" is not in the reference set.');
      return { exitCode: 2 };
    }
    firms = [found];
  }
  return { firms };
}

// printContradictionDetail(rows) -> the "contradictions (each fails the gate):" block.
function printContradictionDetail(rows) {
  console.log('\ncontradictions (each fails the gate):');
  for (const r of rows) {
    if (!r.report) continue;
    for (const c of r.report.contradictions) {
      console.log('  FAIL  ' + r.domain + '  [' + c.check + ']  ' + c.detail);
    }
  }
}
// resultLine(summary) -> the final RESULT: line (sequential ifs, not the original nested ternary).
function resultLine(summary) {
  if (summary.errored > 0 || summary.missing > 0) {
    return 'RESULT: ERROR - a facts door threw, a fixture was unreadable, or a verified firm had no captured fixture (uncovered gap)';
  }
  if (summary.contradictions > 0) {
    return 'RESULT: CONTRADICTION - the facts layer contradicted hand-verified ground truth';
  }
  return 'RESULT: OK (no contradictions; abstentions and unreachable fixtures allowed)';
}
// printHumanReport(rows, summary, errored) -> the full non-JSON report: header, table, legend,
// summary counts, contradiction detail and error detail.
function printHumanReport(rows, summary, errored) {
  console.log('reference-set run-facts: the four facts doors vs hand-verified ground truth');
  console.log('law: match or abstain, never contradict (canonicalised through facts/vocabulary.js)\n');
  printTable(rows);
  const unreachableBundles = rows.filter((r) => r.status === 'OK' && r.bundle_unreachable).length;
  console.log('');
  console.log('legend: match/abstain per the reference law; OK* = reachable-firm expectations met by '
    + 'abstention because the fixture bundle is unreachable (bot-walled / SPA shell); caps n/a = no corpus to derive from');
  console.log('summary: ' + summary.firms + ' firms | ' + summary.ok + ' ok (' + unreachableBundles + ' on unreachable bundles) | '
    + summary.contradicting + ' contradicting | ' + summary.missing + ' missing-fixture | ' + summary.errored + ' errored');
  console.log('         ' + summary.matches + ' matches, ' + summary.abstentions + ' abstentions (allowed), '
    + summary.contradictions + ' contradictions');
  if (summary.contradictions > 0) printContradictionDetail(rows);
  for (const r of errored) console.log('\nERROR  ' + r.domain + ': ' + r.detail);
  console.log('');
  console.log(resultLine(summary));
}

// exitCodeFor(summary) -> exit code for a completed run: 2 on ERROR/MISSING (gate did not fully
// run), else 1 on any contradiction, else 0.
function exitCodeFor(summary) {
  if (summary.errored > 0 || summary.missing > 0) return 2;
  return summary.contradictions > 0 ? 1 : 0;
}

function main(argv) {
  const parsed = parseRunFactsArgs(argv);
  if (parsed.exitCode) return parsed.exitCode;
  const { opts } = parsed;

  const loaded = loadRefSetAndFixtures(opts);
  if (loaded.exitCode) return loaded.exitCode;
  const { refSet } = loaded;

  const selected = selectFirms(refSet, opts);
  if (selected.exitCode) return selected.exitCode;
  const { firms } = selected;

  const rows = firms.map((f) => runFirm(f, opts.fixtures));
  const summary = summarise(rows);
  const errored = rows.filter((r) => r.status === 'ERROR');

  if (opts.json) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    printHumanReport(rows, summary, errored);
  }

  return exitCodeFor(summary);
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { factsToPayload, canonicaliseFirm, subSectorNote, runFirm, summarise, hasReadableCorpus, loadRefSetAndFixtures, selectFirms };
