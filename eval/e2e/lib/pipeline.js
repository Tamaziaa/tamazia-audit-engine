'use strict';
// eval/e2e/lib/pipeline.js - runs ONE EvidenceBundle through the full P3 stage chain:
//
//   facts (real) -> coverage (real, against the compiled catalogue) -> propose (if landed)
//   -> verify (if landed) -> adjudicate (if landed, with an injected scripted llmCall) -> findings[]
//
// This is the harness's own pipeline, not the mint's: every stage after facts/coverage is OPTIONAL
// today (docs/P3-ACCEPTANCE.md wave 2/3 lands in parallel with this harness) and reports its own
// {ran|skipped|error} outcome rather than assuming a fixed shape. A stage that is not wired yet
// contributes nothing to findings[] and is never silently treated as "ran and found nothing"
// (caution.md C-037) - see buildStageTable()/statusOf() below, and eval/e2e/lib/judge.js for how the
// caller turns an incomplete breach lane into an honest "skipped" (never "missed") expectation.
//
// facts doors are called directly (facts/identity.js, facts/jurisdiction.js, facts/sector.js,
// facts/capabilities.js are pure, synchronous, network-free per facts/README.md) and their output is
// turned into the tolerant payload shape eval/reference-set/verify.js's verifyPayload() reads via
// eval/reference-set/run-facts.js's EXPORTED factsToPayload() - reused, not re-derived, so the
// identity/jurisdiction/sector/framework comparison logic lives in exactly one place.

const identity = require('../../../facts/identity.js');
const jurisdiction = require('../../../facts/jurisdiction.js');
const sector = require('../../../facts/sector.js');
const capabilities = require('../../../facts/capabilities.js');
const coverageContract = require('../../../evidence/crawler/coverage-contract.js');
const { factsToPayload, hasReadableCorpus } = require('../../reference-set/run-facts.js');
const { loadProposeStage, loadVerifyStage, loadAdjudicateStage } = require('./breach-stages.js');
const { defaultScriptedLlmCall } = require('./scripted-llm.js');
const { loadCatalogueRecords } = require('./catalogue-records.js');

// bundlePages(bundle) -> bundle.corpus.pages[] when present, else []. Shared guard (COND: a return
// position boolean/array, never buried in a ternary test elsewhere in this file).
function bundlePages(bundle) {
  return (bundle && bundle.corpus && Array.isArray(bundle.corpus.pages)) ? bundle.corpus.pages : [];
}

// runFactsDoors(bundle) -> {identity, jurisdiction, sector, capabilities, hasCorpus}. Mirrors
// eval/reference-set/run-facts.js's private (unexported) deriveFactsForBundle() - that helper cannot
// be imported (it is not part of run-facts.js's public API and this task must not modify that file),
// so this is the one small, unavoidable duplication of "call the four facts doors": four one-line
// invocations of already-public, already-tested functions, not a re-derivation of any fact-producing
// logic of their own.
function runFactsDoors(bundle) {
  const hasCorpus = hasReadableCorpus(bundle);
  const pages = bundlePages(bundle);
  const canDeriveCaps = hasCorpus && pages.length > 0;
  return {
    identity: identity.resolveIdentity(bundle),
    jurisdiction: jurisdiction.resolveJurisdiction(bundle),
    sector: sector.resolveSector(bundle),
    capabilities: canDeriveCaps ? capabilities.deriveCapabilities(bundle) : null,
    hasCorpus,
  };
}

// runCoverageStage(bundle, sectorFamily, catalogueRecords) -> {site, perRule, degraded}. Site-level
// coverage (evidence/crawler/coverage-contract.js computeCoverage) always runs for real; per-rule
// coverage against the compiled catalogue degrades honestly (never fabricates) when no records are
// available (see eval/e2e/lib/catalogue-records.js).
function runCoverageStage(bundle, sectorFamily, catalogueRecords) {
  const pages = bundlePages(bundle);
  const site = coverageContract.computeCoverage(pages, sectorFamily);
  if (!Array.isArray(catalogueRecords) || catalogueRecords.length === 0) {
    return { site, perRule: null, degraded: 'no catalogue records available; per-rule coverage skipped (site-level coverage above is still real)' };
  }
  const perRule = coverageContract.coverageFor(catalogueRecords, pages, {});
  return { site, perRule, degraded: null };
}

// runOptionalStage(stageName, loaded, buildArgs) -> {ran, skipped, error, reason, output, source}.
// `loaded` is a breach-stages.js loader result; `buildArgs()` is a thunk (called only when the stage
// IS wired) returning the real argument list for THIS stage, so each call site can supply its own
// stage-specific signature without this function needing to know any of them.
async function runOptionalStage(stageName, loaded, buildArgs) {
  if (!loaded.available) {
    return { ran: false, skipped: true, error: null, reason: loaded.reason, output: null, source: loaded.source || null };
  }
  try {
    const output = await loaded.run(...buildArgs());
    return { ran: true, skipped: false, error: null, reason: null, output, source: loaded.source || null };
  } catch (e) {
    // FAIL-OPEN: a stage module that IS wired but throws on a real invocation is a genuine integration
    // bug for THIS bundle; it is recorded (console.error, matching the swallow-gate RECORDER pattern)
    // and reported as an 'error' outcome, never silently downgraded to 'skipped' (caution.md C-037:
    // absence and breakage must never be confused) - the harness keeps running the rest of the fleet.
    console.error('[eval/e2e] ' + stageName + ' stage threw: ' + e.message);
    return { ran: false, skipped: false, error: e.message, reason: null, output: null, source: loaded.source || null };
  }
}

// proposedCandidates(result) -> the candidate[] a propose-stage outcome yielded, or [] (an unwired,
// errored or empty-output stage all honestly propose nothing).
function proposedCandidates(result) {
  return Array.isArray(result.output) ? result.output : [];
}

// verifiedEntries(result) -> the verified[] entries out of a breach/verifiers verifyAll()-shaped
// outcome ({verified:[{candidate,verified,code,reason}], rejected:[...]}). Tolerant of a stage that
// has not landed (output null) or that has landed with a different shape than expected (logged
// upstream as a stage error already; this just never crashes on a shape it cannot read).
function verifiedEntries(result) {
  const out = result.output;
  return (out && Array.isArray(out.verified)) ? out.verified : [];
}

// adjudicatedFindings(result) -> the finding[] an adjudicate-stage outcome yielded, or [].
function adjudicatedFindings(result) {
  return Array.isArray(result.output) ? result.output : [];
}

// runBreachLane(bundle, coverage, opts) -> {propose, verify, adjudicate, findings}. opts may override
// any of proposeLoaded/verifyLoaded/adjudicateLoaded (dependency injection for tests - see
// pipeline.test.js) and llmCall (always required to be SCRIPTED; see scripted-llm.js - this harness
// never makes a real network/LLM call).
async function runBreachLane(bundle, coverage, opts) {
  const proposeLoaded = opts.proposeLoaded || loadProposeStage(opts.rootDir);
  const proposeResult = await runOptionalStage('propose', proposeLoaded,
    () => [bundle, opts.catalogueRecords || [], { coverage }]);

  const verifyLoaded = opts.verifyLoaded || loadVerifyStage(opts.rootDir);
  const candidates = proposedCandidates(proposeResult);
  const verifyResult = await runOptionalStage('verify', verifyLoaded, () => [candidates, bundle]);

  const adjudicateLoaded = opts.adjudicateLoaded || loadAdjudicateStage(opts.rootDir);
  const verified = verifiedEntries(verifyResult);
  const llmCall = opts.llmCall || defaultScriptedLlmCall;
  const adjudicateResult = await runOptionalStage('adjudicate', adjudicateLoaded, () => [verified, { llmCall }]);

  return {
    propose: proposeResult,
    verify: verifyResult,
    adjudicate: adjudicateResult,
    findings: adjudicatedFindings(adjudicateResult),
  };
}

// statusOf(stageResult) -> 'skipped' | 'error' | 'ran', the one place an outcome maps to its label.
function statusOf(r) {
  if (r.skipped) return 'skipped';
  if (r.error) return 'error';
  return 'ran';
}

// buildStageTable(breach) -> the per-firm, per-run outcome table (fixtureBundle/facts/coverage always
// 'ran' by the time this is built - a facts-door or coverage throw propagates to the CALLER, which
// records the whole firm as an error row instead; see run-pipeline.js's runOneFirm).
function buildStageTable(breach) {
  const always = (stage) => ({ stage, status: 'ran', reason: null, source: null });
  const breachRow = (stage, r) => ({ stage, status: statusOf(r), reason: r.reason || r.error || null, source: r.source || null });
  return [
    always('fixtureBundle'),
    always('facts'),
    always('coverage'),
    breachRow('propose', breach.propose),
    breachRow('verify', breach.verify),
    breachRow('adjudicate', breach.adjudicate),
  ];
}

// probeStageWiring(rootDir) -> [{stage, status:'wired'|'not-wired', reason, source}, ...] for the
// TOP-LEVEL report line (run-pipeline.js): is a module PRESENT at all, independent of any one firm's
// bundle. facts/coverage are always-on wave-1 modules and are reported 'wired' unconditionally.
function probeStageWiring(rootDir) {
  const propose = loadProposeStage(rootDir);
  const verifyLoaded = loadVerifyStage(rootDir);
  const adjudicateLoaded = loadAdjudicateStage(rootDir);
  const wiring = (stage, r) => ({ stage, status: r.available ? 'wired' : 'not-wired', reason: r.reason || null, source: r.source || null });
  return [
    { stage: 'facts', status: 'wired', reason: null, source: null },
    { stage: 'coverage', status: 'wired', reason: null, source: null },
    wiring('propose', propose),
    wiring('verify', verifyLoaded),
    wiring('adjudicate', adjudicateLoaded),
  ];
}

/**
 * runPipeline(domain, bundle, opts) -> {
 *   domain, facts, coverage, breach, payload, stageTable, breachLaneComplete
 * }
 *
 * `payload` is the tolerant shape eval/reference-set/verify.js's verifyPayload() reads (meta.sector,
 * identity, jurisdiction.bound, frameworks:[], findings: the breach lane's real output).
 * `breachLaneComplete` is true only when propose AND verify AND adjudicate all actually RAN (not
 * skipped, not errored) for this bundle - eval/e2e/lib/judge.js uses it to tell an honest "skipped"
 * apart from a real "missed" on every known_breach expectation (never fabricate a pass, C-037).
 *
 * opts: { rootDir, catalogueRecords, llmCall, proposeLoaded, verifyLoaded, adjudicateLoaded }
 * (all optional; production use supplies none of them and gets the real, current wiring).
 */
async function runPipeline(domain, bundle, opts = {}) {
  const facts = runFactsDoors(bundle);
  const payload = factsToPayload(domain, facts);
  const catalogueRecords = opts.catalogueRecords !== undefined ? opts.catalogueRecords : loadCatalogueRecords();
  const coverage = runCoverageStage(bundle, payload.meta.sector, catalogueRecords);
  const breach = await runBreachLane(bundle, coverage, { ...opts, catalogueRecords });

  payload.findings = breach.findings;
  payload.coverage = coverage;

  const stageTable = buildStageTable(breach);
  const breachLaneComplete = [breach.propose, breach.verify, breach.adjudicate].every((s) => s.ran === true);

  return { domain, facts, coverage, breach, payload, stageTable, breachLaneComplete };
}

module.exports = {
  runPipeline,
  runFactsDoors,
  runCoverageStage,
  runBreachLane,
  runOptionalStage,
  buildStageTable,
  probeStageWiring,
  bundlePages,
};
