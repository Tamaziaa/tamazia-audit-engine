#!/usr/bin/env node
'use strict';
// eval/reality-corpus/run.js - THE REALITY-VALIDATION GATE (Kimi K3 blueprint section 3; the safety
// net that would have caught the 0/19 regression documented in EMPIRICAL-BREACH-AUDITS/RETEST-2026-07-19.md
// in ten minutes, per AGENT-CONTEXT-PACK-2026-07-19.md's mandate for this workstream).
//
// WHAT THIS IS: a corpus runner that takes the labelled sites in eval/reality-corpus/sites/*.yml (see
// eval/reality-corpus/README.md for the format), runs the REAL engine's facts doors
// (facts/identity.js, facts/jurisdiction.js, facts/sector.js), the REAL applicability engine
// (applicability/connect.js) and the REAL breach lane (reusing eval/e2e/lib/pipeline.js's
// runPipeline, in-process, scripted-LLM-decline by default - no network, no real LLM call) against a
// hand-built EvidenceBundle snapshot per site (eval/reality-corpus/fixtures/<slug>.json), and scores
// the output against the corpus's hand-verified labels using eval/reality-corpus/lib/metrics.js's pure
// functions.
//
// REPLAY-MODE LIMITATION (documented, not hidden - see the README and CONSTITUTION Rule 17 "done means
// verified"): the fixtures in eval/reality-corpus/fixtures/*.json are MANUAL TRANSCRIPTIONS of the exact
// quotes verified in EMPIRICAL-BREACH-AUDITS/*.md, not a captured WARC/HAR of a live crawl, and they
// carry no bundle.browser (no captured network events, no DOM). This means:
//   - facts/sector.js, facts/jurisdiction.js, facts/identity.js and applicability/connect.js run for
//     real, against real (if hand-excerpted) page text - the sector/jurisdiction/applicability numbers
//     below are genuine engine output, not simulated.
//   - the breach lane's BEHAVIOURAL obligations (pre-consent cookies/trackers, DOM accessibility) have
//     no browser lane to observe, so those checks report `unassessable_lane_incomplete`, never a false
//     "missed" - breach/proposers/propose.js's own evalBehavioural() suppression is what triggers this,
//     not a shortcut in this harness (see breach/proposers/propose.js's laneRan()).
//   - text-evidenced and register-absence breaches (SRA/OISC/GDC/CQC/RPC-family disclaimers, MHRA/CAP
//     price-led promotion) ARE fully assessable from these snapshots.
// A follow-up (tracked in the PR body, not silently deferred) is to capture real Playwright+network
// snapshots per site so PECR/DOM breaches become assessable too; until then the coverage-adjusted
// recall figure below is HONESTLY partial, and is reported as such rather than padded.
//
// USAGE:
//   node eval/reality-corpus/run.js                 human-readable scorecard, exit 0/1 per budgets.json
//   node eval/reality-corpus/run.js --json           machine-readable scorecard on stdout
//   node eval/reality-corpus/run.js --site <slug>    run one site only
//   node eval/reality-corpus/run.js --lint           parse every corpus YAML + validate required fields, no engine run
//
// EXIT CODES (see budgets.json for the numbers this enforces):
//   0 = every hard budget met (false_accusations 0, sector_refusal_rate 0, recall >= baseline)
//   1 = at least one hard budget missed - THIS IS DATA, NOT A FLEET FAILURE (see AGENT-CONTEXT-PACK's
//       instruction to keep the corpus scorecard separate from the green fleet); a CI step that runs
//       this file is EXPECTED to go red while the sector-abstain regression is unfixed, and that red is
//       the entire point of building this gate.
//   2 = usage/data error (bad YAML, missing fixture set entirely, budgets.json unreadable)

const fs = require('fs');
const path = require('path');

const yaml = require('./lib/yaml.js');
const metrics = require('./lib/metrics.js');
const identity = require('../../facts/identity.js');
const jurisdiction = require('../../facts/jurisdiction.js');
const sector = require('../../facts/sector.js');
const connect = require('../../applicability/connect.js').connect;
const { runPipeline } = require('../e2e/lib/pipeline.js');
const { loadCatalogueRecords } = require('../e2e/lib/catalogue-records.js');

const SITES_DIR = path.join(__dirname, 'sites');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const BUDGETS_PATH = path.join(__dirname, 'budgets.json');

// The canonical sector tree, loaded once through the sector door itself (the same pattern
// eval/reference-set/run-facts.js uses) - never a second copy of the tree (Rule 1/22).
const SECTOR_TREE = sector.loadVocabulary().TREE;

function loadSites() {
  const files = fs.readdirSync(SITES_DIR).filter((f) => f.endsWith('.yml')).sort();
  return files.map((f) => {
    const doc = yaml.parse(fs.readFileSync(path.join(SITES_DIR, f), 'utf8'));
    if (!doc || !doc.slug) throw new Error('eval/reality-corpus/run.js: ' + f + ' has no top-level slug: field');
    doc._file = f;
    return doc;
  });
}

function loadFixture(slug) {
  const p = path.join(FIXTURES_DIR, slug + '.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// lintSite(site) -> [error strings]. Validates the corpus format described in the README without
// running the engine - the fast check a corpus-authoring PR can run before the full gate.
function lintSite(site) {
  const errors = [];
  const required = ['slug', 'domain', 'sector_paths', 'source', 'snapshot_source'];
  for (const key of required) if (!(key in site) || site[key] == null) errors.push('missing required field: ' + key);
  if (!Array.isArray(site.establishment) || site.establishment.length === 0) errors.push('establishment[] must be a non-empty array');
  if (!Array.isArray(site.labelled_breaches)) errors.push('labelled_breaches must be an array (use [] for a clean/negative site)');
  for (const lb of (site.labelled_breaches || [])) {
    if (!lb.law_id) errors.push('a labelled_breaches entry has no law_id');
  }
  if (!Array.isArray(site.known_clean_laws)) errors.push('known_clean_laws must be an array (use [] if none)');
  return errors;
}

async function runOneSite(site, catalogueRecords, catalogueIds) {
  const fixture = loadFixture(site.slug);
  if (!fixture) {
    return { slug: site.slug, domain: site.domain, status: 'skipped_no_snapshot' };
  }

  let factsSector;
  let factsJurisdiction;
  let applicability;
  let pipelineResult;
  try {
    factsSector = sector.resolveSector(fixture);
    factsJurisdiction = jurisdiction.resolveJurisdiction(fixture);
    const factsIdentity = identity.resolveIdentity(fixture);
    applicability = connect({ identity: factsIdentity, jurisdiction: factsJurisdiction, sector: factsSector }, catalogueRecords);
  } catch (e) {
    // FAIL-CLOSED (Constitution Rule 4): a facts/applicability door throwing on this site is recorded
    // as an errored site, never silently treated as "abstained" or "clean" - both would understate a
    // real defect. Rethrown detail is kept on the row for the human-readable report.
    return { slug: site.slug, domain: site.domain, status: 'error', error: 'facts/applicability threw: ' + e.message };
  }

  try {
    pipelineResult = await runPipeline(site.domain, fixture, { catalogueRecords });
  } catch (e) {
    return { slug: site.slug, domain: site.domain, status: 'error', error: 'breach pipeline threw: ' + e.message };
  }

  const applicableIds = applicability.applicable.map((r) => r.id || r.record_id).filter(Boolean);
  const boundJurisdictions = (factsJurisdiction.bound || []).map((b) => b && b.jurisdiction).filter(Boolean);

  const sectorStatus = metrics.sectorTop1(site, factsSector && factsSector.value, (id) => sector.familyOf(SECTOR_TREE, id));
  const jurisdictionResult = metrics.jurisdictionEstablishmentBind(site, boundJurisdictions);
  const applicabilityResult = metrics.applicabilityRecall(site, applicableIds, catalogueIds);
  const breachResult = metrics.breachCoverage(site, pipelineResult.payload.findings, pipelineResult.breachLaneComplete);
  const falseAccusationHits = metrics.falseAccusations(site, pipelineResult.payload.findings);

  return {
    slug: site.slug,
    domain: site.domain,
    role: site.role || 'train',
    status: 'ran',
    sector: { status: sectorStatus, emitted: factsSector && factsSector.value, confidence: factsSector && factsSector.confidence },
    jurisdiction: jurisdictionResult,
    applicability: applicabilityResult,
    breach: breachResult,
    false_accusations: falseAccusationHits,
    breach_lane_complete: pipelineResult.breachLaneComplete,
  };
}

function aggregate(rows) {
  const ran = rows.filter((r) => r.status === 'ran');
  const skipped = rows.filter((r) => r.status === 'skipped_no_snapshot');
  const errored = rows.filter((r) => r.status === 'error');

  const sectorCorrect = ran.filter((r) => r.sector.status === 'correct').length;
  const sectorAbstain = ran.filter((r) => r.sector.status === 'abstain').length;
  const sectorWrong = ran.filter((r) => r.sector.status === 'wrong').length;
  const sectorLabelled = ran.filter((r) => r.sector.status !== 'not_labelled').length;

  const jurWithExpectation = ran.filter((r) => r.jurisdiction.recall !== null);
  const jurRecallAvg = jurWithExpectation.length === 0 ? null
    : jurWithExpectation.reduce((s, r) => s + r.jurisdiction.recall, 0) / jurWithExpectation.length;
  const wrongAttachTotal = ran.reduce((s, r) => s + r.jurisdiction.wrong_attach_count, 0);

  const appWithExpectation = ran.filter((r) => r.applicability.recall !== null);
  const appRecallAvg = appWithExpectation.length === 0 ? null
    : appWithExpectation.reduce((s, r) => s + r.applicability.recall, 0) / appWithExpectation.length;
  const catalogueGapsTotal = ran.reduce((s, r) => s + r.applicability.catalogue_gaps.length, 0);

  const breachAssessableTotal = ran.reduce((s, r) => s + r.breach.assessable_count, 0);
  const breachReproducedTotal = ran.reduce((s, r) => s + r.breach.reproduced_count, 0);
  const breachLabelledTotal = ran.reduce((s, r) => s + r.breach.labelled_count, 0);
  const coverageAdjustedRecall = breachAssessableTotal === 0 ? null : breachReproducedTotal / breachAssessableTotal;

  const falseAccusationTotal = ran.reduce((s, r) => s + r.false_accusations.length, 0);

  return {
    sites_total: rows.length,
    sites_ran: ran.length,
    sites_skipped_no_snapshot: skipped.length,
    sites_errored: errored.length,
    sector: {
      correct: sectorCorrect, abstain: sectorAbstain, wrong: sectorWrong, labelled: sectorLabelled,
      refusal_rate: sectorLabelled === 0 ? null : sectorAbstain / sectorLabelled,
      accuracy: sectorLabelled === 0 ? null : sectorCorrect / sectorLabelled,
    },
    jurisdiction: {
      establishment_recall_avg: jurRecallAvg,
      wrong_attach_total: wrongAttachTotal,
    },
    applicability: {
      recall_avg: appRecallAvg,
      catalogue_gaps_total: catalogueGapsTotal,
    },
    breach: {
      labelled_total: breachLabelledTotal,
      assessable_total: breachAssessableTotal,
      reproduced_total: breachReproducedTotal,
      coverage_adjusted_recall: coverageAdjustedRecall,
    },
    false_accusations_total: falseAccusationTotal,
  };
}

function loadBudgets() {
  return JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
}

// evaluateBudgets(summary, budgets) -> {pass: bool, failures: [string]}. Every failure names the exact
// number and the exact budget it missed - the gate must never fail silently or fail vaguely.
function evaluateBudgets(summary, budgets) {
  const failures = [];
  if (summary.false_accusations_total > budgets.false_accusations_max) {
    failures.push('false_accusations_total ' + summary.false_accusations_total + ' > max ' + budgets.false_accusations_max + ' (HARD, Constitution Rule 3/10, Kimi blueprint section 3.4)');
  }
  if (summary.sector.refusal_rate !== null && summary.sector.refusal_rate > budgets.sector_refusal_rate_max) {
    failures.push('sector.refusal_rate ' + summary.sector.refusal_rate.toFixed(3) + ' > max ' + budgets.sector_refusal_rate_max + ' (the named sector-abstain regression)');
  }
  if (summary.breach.coverage_adjusted_recall !== null && summary.breach.coverage_adjusted_recall < budgets.coverage_adjusted_recall_min) {
    failures.push('breach.coverage_adjusted_recall ' + summary.breach.coverage_adjusted_recall.toFixed(3) + ' < baseline ' + budgets.coverage_adjusted_recall_min);
  }
  if (summary.jurisdiction.wrong_attach_total > budgets.jurisdiction_wrong_attach_max) {
    failures.push('jurisdiction.wrong_attach_total ' + summary.jurisdiction.wrong_attach_total + ' > max ' + budgets.jurisdiction_wrong_attach_max);
  }
  return { pass: failures.length === 0, failures };
}

function formatRow(r) {
  if (r.status === 'skipped_no_snapshot') return r.slug.padEnd(28) + 'SKIPPED (no fixture captured)';
  if (r.status === 'error') return r.slug.padEnd(28) + 'ERROR: ' + r.error;
  const sec = r.sector.status.toUpperCase();
  const jur = r.jurisdiction.recall === null ? 'n/a' : (r.jurisdiction.recall * 100).toFixed(0) + '%';
  const app = r.applicability.recall === null ? 'n/a' : (r.applicability.recall * 100).toFixed(0) + '%';
  const brc = r.breach.coverage_adjusted_recall === null ? 'n/a(' + r.breach.labelled_count + ' unassessable/none)' : (r.breach.coverage_adjusted_recall * 100).toFixed(0) + '% (' + r.breach.reproduced_count + '/' + r.breach.assessable_count + ')';
  const fa = r.false_accusations.length > 0 ? ('FALSE-ACCUSATION x' + r.false_accusations.length) : 'clean';
  return r.slug.padEnd(28) + ('sector:' + sec).padEnd(18) + ('jur:' + jur).padEnd(10) + ('appl:' + app).padEnd(11) + ('breach:' + brc).padEnd(28) + fa;
}

async function main(argv) {
  const args = argv.slice(2);
  const jsonOut = args.includes('--json');
  const lintOnly = args.includes('--lint');
  const siteIdx = args.indexOf('--site');
  const onlySlug = siteIdx >= 0 ? args[siteIdx + 1] : null;

  let sites;
  try {
    sites = loadSites();
  } catch (e) {
    console.error('eval/reality-corpus/run.js: ' + e.message);
    process.exit(2);
  }
  if (onlySlug) sites = sites.filter((s) => s.slug === onlySlug);
  if (sites.length === 0) {
    console.error('eval/reality-corpus/run.js: no corpus sites matched (onlySlug=' + onlySlug + ')');
    process.exit(2);
  }

  if (lintOnly) {
    let anyError = false;
    for (const site of sites) {
      const errors = lintSite(site);
      if (errors.length > 0) {
        anyError = true;
        console.error(site.slug + ':');
        for (const e of errors) console.error('  - ' + e);
      }
    }
    if (anyError) process.exit(2);
    console.log('eval/reality-corpus: ' + sites.length + ' corpus file(s) lint clean.');
    process.exit(0);
    return;
  }

  const catalogueRecords = loadCatalogueRecords();
  const catalogueIds = catalogueRecords.map((r) => r.id || r.record_id).filter(Boolean);

  const rows = [];
  for (const site of sites) {
    // Sequential, not Promise.all: findings can be sizeable and this is a CI/local diagnostic tool, not
    // a latency-budgeted production path (Constitution Rule 8/9 govern the mint, not this harness).
    rows.push(await runOneSite(site, catalogueRecords, catalogueIds));
  }

  const summary = aggregate(rows);
  const budgets = loadBudgets();
  const verdict = evaluateBudgets(summary, budgets);

  if (jsonOut) {
    console.log(JSON.stringify({ rows, summary, budgets, verdict }, null, 2));
  } else {
    console.log('eval/reality-corpus scorecard (' + sites.length + ' site(s), engine ' + require('../../mint/version.js').ENGINE_VERSION + ')');
    console.log('='.repeat(100));
    for (const r of rows) console.log(formatRow(r));
    console.log('-'.repeat(100));
    console.log('sites: ' + summary.sites_ran + ' ran, ' + summary.sites_skipped_no_snapshot + ' skipped (no snapshot), ' + summary.sites_errored + ' errored');
    console.log('sector: accuracy ' + fmtPct(summary.sector.accuracy) + ', refusal_rate ' + fmtPct(summary.sector.refusal_rate) + ' (' + summary.sector.abstain + '/' + summary.sector.labelled + ' abstained)');
    console.log('jurisdiction: establishment recall avg ' + fmtPct(summary.jurisdiction.establishment_recall_avg) + ', wrong-attach total ' + summary.jurisdiction.wrong_attach_total);
    console.log('applicability: recall avg ' + fmtPct(summary.applicability.recall_avg) + ', catalogue gaps ' + summary.applicability.catalogue_gaps_total);
    console.log('breach: coverage-adjusted recall ' + fmtPct(summary.breach.coverage_adjusted_recall) + ' (' + summary.breach.reproduced_total + '/' + summary.breach.assessable_total + ' assessable of ' + summary.breach.labelled_total + ' labelled)');
    console.log('FALSE ACCUSATIONS: ' + summary.false_accusations_total + (summary.false_accusations_total > 0 ? '  <-- HARD FAIL, zero tolerance' : ''));
    console.log('='.repeat(100));
    console.log(verdict.pass ? 'RESULT: PASS (within budget)' : 'RESULT: FAIL (budget exceeded)');
    for (const f of verdict.failures) console.log('  - ' + f);
  }

  process.exit(verdict.pass ? 0 : 1);
}

function fmtPct(v) {
  return v === null ? 'n/a' : (v * 100).toFixed(1) + '%';
}

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('eval/reality-corpus/run.js: fatal: ' + e.stack);
    process.exit(2);
  });
}

module.exports = { loadSites, loadFixture, lintSite, runOneSite, aggregate, evaluateBudgets, loadBudgets };
