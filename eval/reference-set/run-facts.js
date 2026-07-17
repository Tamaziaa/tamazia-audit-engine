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
//     UNREACHABLE  no fixture on disk for a verified firm                            (allowed, logged)
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

// -------------------------------------------------------------------------------------------------
// Turn the four facts outputs into the tolerant payload shape verify.js reads, applying the one
// piece of canonicalisation the facts layer owes the comparator: lift the engine's emitted sector
// node to its canonical FAMILY key. The reference set's `sector` is a family; sub-sector granularity
// differs between the engine's three-tier tree and the human descriptors, so sub_sector is left for
// the informational column (below) and never fed to the contradiction check - never contradict.
// -------------------------------------------------------------------------------------------------
function factsToPayload(domain, facts) {
  const emitted = facts.sector && facts.sector.value; // { sector, sub_sector } | null
  let sectorFamily = null;
  if (emitted && emitted.sector) {
    sectorFamily = canonSector(sector.familyOf(TREE, emitted.sector));
  }

  const bound = (facts.jurisdiction && Array.isArray(facts.jurisdiction.bound))
    ? facts.jurisdiction.bound.map((b) => b && b.jurisdiction).filter(Boolean)
    : [];

  const id = facts.identity || {};
  const legalName = id.legal_name && id.legal_name.value != null ? id.legal_name.value : null;
  const companyNumber = id.company_number && id.company_number.value != null ? id.company_number.value : null;

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
  return (a && b && (a === b || a.includes(b) || b.includes(a))) ? 'match' : 'abstain';
}

function capsSummary(caps) {
  const preds = caps && caps.predicates ? caps.predicates : {};
  let present = 0;
  let total = 0;
  for (const k of Object.keys(preds)) {
    total++;
    if (preds[k] && preds[k].present === 'yes') present++;
  }
  return { present, total };
}

// -------------------------------------------------------------------------------------------------
// Per-firm run. Returns a row; throws only escape to the caller which records them as ERROR rows.
// -------------------------------------------------------------------------------------------------
function runFirm(firm, fixturesDir) {
  // Fail closed on an unsafe path component before it ever reaches path.join (traversal guard);
  // every domain in reference-set.json is a plain hostname, so this never fires in practice.
  if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(firm.domain)) {
    throw new Error('unsafe path component: ' + JSON.stringify(firm.domain));
  }
  const fixturePath = path.join(fixturesDir, firm.domain + '.json');
  if (!fs.existsSync(fixturePath)) {
    return { domain: firm.domain, role: firm.role, status: 'UNREACHABLE', detail: 'no fixture on disk', report: null };
  }

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (e) {
    return { domain: firm.domain, role: firm.role, status: 'ERROR', detail: 'fixture unreadable: ' + e.message, report: null };
  }

  // An unreachable bundle (bot-walled or SPA shell: no readable corpus) is a legitimate, allowed
  // category. The tolerant doors (identity/jurisdiction/sector) abstain across the board on it;
  // deriveCapabilities requires a corpus by contract, so on a corpus-less bundle capabilities is
  // simply not applicable and reads as abstained - it is NOT an error. A door throwing on a bundle
  // that DOES carry a corpus is a real integration breakage and surfaces as ERROR below.
  const hasCorpus = bundle && bundle.corpus && typeof bundle.corpus === 'object'
    && Array.isArray(bundle.corpus.pages) && bundle.corpus.pages.length > 0;
  const bundleUnreachable = !hasCorpus || bundle.unreachable === true;

  let facts;
  try {
    facts = {
      identity: identity.resolveIdentity(bundle),
      jurisdiction: jurisdiction.resolveJurisdiction(bundle),
      sector: sector.resolveSector(bundle),
      capabilities: hasCorpus ? capabilities.deriveCapabilities(bundle) : null,
    };
  } catch (e) {
    return { domain: firm.domain, role: firm.role, status: 'ERROR', detail: 'a facts door threw: ' + e.message, report: null };
  }

  const payload = factsToPayload(firm.domain, facts);
  const report = verifyPayload(payload, canonicaliseFirm(firm));

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

function printTable(rows) {
  const H = ['domain', 'role', 'sector', 'sub', 'jur', 'caps', 'result'];
  const W = [28, 10, 12, 9, 12, 7, 11];
  console.log(H.map((h, i) => pad(h, W[i])).join(' '));
  console.log(W.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    if (r.status === 'UNREACHABLE') {
      console.log([pad(r.domain, W[0]), pad(r.role, W[1]), pad('-', W[2]), pad('-', W[3]), pad('-', W[4]), pad('-', W[5]), pad('UNREACHABLE', W[6])].join(' '));
      continue;
    }
    if (r.status === 'ERROR') {
      console.log([pad(r.domain, W[0]), pad(r.role, W[1]), pad('-', W[2]), pad('-', W[3]), pad('-', W[4]), pad('-', W[5]), pad('ERROR', W[6])].join(' '));
      continue;
    }
    const sec = statusOf(r.report, 'sector');
    const jur = statusOf(r.report, 'jurisdictions_bound');
    const capCell = r.caps ? (r.caps.present + '/' + r.caps.total) : 'n/a';
    const resultCell = r.status === 'OK' && r.bundle_unreachable ? 'OK*' : r.status;
    console.log([
      pad(r.domain, W[0]),
      pad(r.role, W[1]),
      pad(sec === 'CONTRADICT' ? 'CONTRADICT' : sec, W[2]),
      pad(r.sub_sector_note || '-', W[3]),
      pad(jur === 'CONTRADICT' ? 'CONTRADICT' : (r.bound.length ? jur + ':' + r.bound.join('/') : jur), W[4]),
      pad(capCell, W[5]),
      pad(resultCell, W[6]),
    ].join(' '));
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
    errored: rows.filter((r) => r.status === 'ERROR').length,
    matches,
    abstentions,
    contradictions,
  };
}

// -------------------------------------------------------------------------------------------------
// CLI.
// -------------------------------------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  const opts = { json: false, set: DEFAULT_SET, fixtures: DEFAULT_FIXTURES, domain: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--set') opts.set = args[++i];
    else if (a === '--fixtures') opts.fixtures = args[++i];
    else if (a === '--domain') opts.domain = args[++i];
    else { console.error('Unknown argument: ' + a); return 2; }
  }

  let refSet;
  try {
    refSet = loadReferenceSet(opts.set);
  } catch (e) {
    console.error('Cannot read reference set ' + opts.set + ': ' + e.message);
    return 2;
  }
  if (!fs.existsSync(opts.fixtures)) {
    console.error('Fixtures directory not found: ' + opts.fixtures);
    return 2;
  }

  let firms = refSet.firms || [];
  if (opts.domain) {
    const found = findFirm(refSet, opts.domain);
    if (!found) { console.error('Domain "' + opts.domain + '" is not in the reference set.'); return 2; }
    firms = [found];
  }

  const rows = firms.map((f) => runFirm(f, opts.fixtures));
  const summary = summarise(rows);
  const errored = rows.filter((r) => r.status === 'ERROR');

  if (opts.json) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log('reference-set run-facts: the four facts doors vs hand-verified ground truth');
    console.log('law: match or abstain, never contradict (canonicalised through facts/vocabulary.js)\n');
    printTable(rows);
    const unreachableBundles = rows.filter((r) => r.status === 'OK' && r.bundle_unreachable).length;
    console.log('');
    console.log('legend: match/abstain per the reference law; OK* = reachable-firm expectations met by '
      + 'abstention because the fixture bundle is unreachable (bot-walled / SPA shell); caps n/a = no corpus to derive from');
    console.log('summary: ' + summary.firms + ' firms | ' + summary.ok + ' ok (' + unreachableBundles + ' on unreachable bundles) | '
      + summary.contradicting + ' contradicting | ' + summary.unreachable + ' no-fixture | ' + summary.errored + ' errored');
    console.log('         ' + summary.matches + ' matches, ' + summary.abstentions + ' abstentions (allowed), '
      + summary.contradictions + ' contradictions');
    if (summary.contradictions > 0) {
      console.log('\ncontradictions (each fails the gate):');
      for (const r of rows) {
        if (!r.report) continue;
        for (const c of r.report.contradictions) {
          console.log('  FAIL  ' + r.domain + '  [' + c.check + ']  ' + c.detail);
        }
      }
    }
    for (const r of errored) console.log('\nERROR  ' + r.domain + ': ' + r.detail);
    console.log('');
    console.log(summary.errored > 0
      ? 'RESULT: ERROR - a facts door threw or a fixture was unreadable'
      : (summary.contradictions > 0
        ? 'RESULT: CONTRADICTION - the facts layer contradicted hand-verified ground truth'
        : 'RESULT: OK (no contradictions; abstentions and unreachable fixtures allowed)'));
  }

  if (summary.errored > 0) return 2;
  return summary.contradictions > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { factsToPayload, canonicaliseFirm, subSectorNote, runFirm, summarise };
