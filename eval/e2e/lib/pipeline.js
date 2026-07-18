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

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const identity = require('../../../facts/identity.js');
const jurisdiction = require('../../../facts/jurisdiction.js');
const sector = require('../../../facts/sector.js');
const capabilities = require('../../../facts/capabilities.js');
const coverageContract = require('../../../evidence/crawler/coverage-contract.js');
const { factsToPayload, hasReadableCorpus } = require('../../reference-set/run-facts.js');
const { loadProposeStage, loadVerifyStage, loadAdjudicateStage } = require('./breach-stages.js');
const { defaultScriptedLlmCall } = require('./scripted-llm.js');
const { loadCatalogueRecords } = require('./catalogue-records.js');

const BREACH_WORKER = path.join(__dirname, 'breach-worker.js');

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

// verifiedCandidatesFrom(result) -> the UNWRAPPED candidate objects out of a breach/verifiers
// verifyAll()-shaped outcome ({verified:[{candidate,verified,code,reason}], rejected:[...]}). Rob's
// ledger decision 6: the adjudicate stage receives the raw candidates, not the verifier's result
// envelopes, so the caller unwraps `.candidate` here. An entry with no `.candidate` (a test double, or
// a different-shaped verifier) contributes its whole self as a fallback so nothing is silently dropped;
// a stage that did not land (output null) or a non-verifyAll shape yields []. Never crashes.
function verifiedCandidatesFrom(result) {
  const out = result.output;
  const entries = (out && Array.isArray(out.verified)) ? out.verified : [];
  return entries.map((e) => (e && e.candidate !== undefined ? e.candidate : e)).filter((c) => c != null);
}

// adjudicatedFindings(result) -> the finding[] an adjudicate-stage outcome yielded. Tolerant of BOTH
// the real breach/adjudicator/adjudicate.js shape ({findings, report}) and a bare findings[] a test
// double may return. An unwired/errored/empty stage yields [].
function adjudicatedFindings(result) {
  const out = result.output;
  if (out && Array.isArray(out.findings)) return out.findings; // adjudicate.js {findings, report}
  if (Array.isArray(out)) return out;                          // a test double returning findings[] directly
  return [];
}

// perRuleCoverageArg(coverage) -> the per-rule coverage object breach/proposers/propose.js reads
// (it looks up coverage.rules[].state by record_id). runCoverageStage yields {site, perRule, degraded};
// propose wants `perRule` ({rules, summary}), or an empty-rules object when per-rule coverage was
// degraded (no catalogue records) so propose falls back to 'unknown' coverage, never a crash.
function perRuleCoverageArg(coverage) {
  return (coverage && coverage.perRule) ? coverage.perRule : { rules: [] };
}

// usesInjectedLoaders(opts) -> true when a test has injected any breach-stage loader. Injected fakes
// never hang, so those runs stay IN-PROCESS (fast, deterministic, no subprocess); only the REAL,
// unhardened breach modules need the subprocess Rule-9 guard.
function usesInjectedLoaders(opts) {
  return Boolean(opts.proposeLoaded || opts.verifyLoaded || opts.adjudicateLoaded);
}

// runBreachLane(bundle, coverage, opts) -> {propose, verify, adjudicate, findings}. Dispatcher: runs
// the lane IN-PROCESS by default (tests, injected loaders, and the `--breach-inline` CLI path), and in
// an execFileSync-bounded CHILD PROCESS when opts.breachTimeoutMs > 0 and no loaders are injected (the
// real CLI path - a hard Rule-9 deadline around a breach module that can hang synchronously; see
// breach-worker.js). `opts.breachInProcess:true` forces in-process (the worker sets this so it never
// re-spawns itself).
async function runBreachLane(bundle, coverage, opts) {
  const wantSubprocess = !opts.breachInProcess
    && !usesInjectedLoaders(opts)
    && Number.isFinite(opts.breachTimeoutMs)
    && opts.breachTimeoutMs > 0;
  if (wantSubprocess) return runBreachLaneSubprocess(bundle, coverage, opts);
  return runBreachLaneInProcess(bundle, coverage, opts);
}

// runBreachLaneInProcess(bundle, coverage, opts) -> the real, in-process lane. opts may override
// proposeLoaded/verifyLoaded/adjudicateLoaded (dependency injection for tests - see pipeline.test.js)
// and llmCall (always SCRIPTED; see scripted-llm.js - this harness never makes a real network/LLM call).
async function runBreachLaneInProcess(bundle, coverage, opts) {
  const proposeLoaded = opts.proposeLoaded || loadProposeStage(opts.rootDir);
  const proposeResult = await runOptionalStage('propose', proposeLoaded,
    () => [bundle, opts.catalogueRecords || [], perRuleCoverageArg(coverage)]);

  const verifyLoaded = opts.verifyLoaded || loadVerifyStage(opts.rootDir);
  const candidates = proposedCandidates(proposeResult);
  const verifyResult = await runOptionalStage('verify', verifyLoaded, () => [candidates, bundle]);

  // Rob's ledger decision 6: unwrap the verifier's `.candidate`s, pass the bundle + a scripted llmCall,
  // read `.findings`. The adjudicate signature is adjudicate(candidates, bundle, { llmCall, ... }).
  const adjudicateLoaded = opts.adjudicateLoaded || loadAdjudicateStage(opts.rootDir);
  const verifiedCandidates = verifiedCandidatesFrom(verifyResult);
  const llmCall = opts.llmCall || defaultScriptedLlmCall;
  const adjudicateResult = await runOptionalStage('adjudicate', adjudicateLoaded, () => [verifiedCandidates, bundle, { llmCall }]);

  return {
    propose: proposeResult,
    verify: verifyResult,
    adjudicate: adjudicateResult,
    findings: adjudicatedFindings(adjudicateResult),
  };
}

// rehydrateStage(s) -> a full stage-outcome object (the shape runOptionalStage returns) rebuilt from
// the worker's trimmed {ran,skipped,error,reason,source}. output is null (never serialised back).
function rehydrateStage(s) {
  const o = s || {};
  return { ran: Boolean(o.ran), skipped: Boolean(o.skipped), error: o.error || null, reason: o.reason || null, output: null, source: o.source || null };
}

// breachLaneError(reason) -> a whole-lane error result: all three stages recorded as errored with the
// same reason (a subprocess timeout or crash). breachLaneComplete is then false, so judge.js reports
// every known_breach as SKIPPED (never MISSED, never reproduced): the lane did not complete, so it
// proves nothing about breaches - it never fabricates a pass (caution.md C-037).
function breachLaneError(reason) {
  const err = () => ({ ran: false, skipped: false, error: reason, reason: null, output: null, source: null });
  return { propose: err(), verify: err(), adjudicate: err(), findings: [] };
}

// jobFilePath() -> a fresh temp path for one subprocess job (non-throwing: path.join + a random
// suffix). Computed OUTSIDE the try/catch below since it does no I/O of its own.
function jobFilePath() {
  return path.join(os.tmpdir(), 'e2e-breach-' + process.pid + '-' + crypto.randomBytes(6).toString('hex') + '.json');
}
function writeBreachJob(jobFile, bundle, coverage, opts) {
  const job = { bundle, catalogueRecords: opts.catalogueRecords || [], perRuleCoverage: perRuleCoverageArg(coverage) };
  fs.writeFileSync(jobFile, JSON.stringify(job));
}
function runBreachWorker(jobFile, opts) {
  const stdout = execFileSync(process.execPath, [BREACH_WORKER, jobFile], {
    timeout: opts.breachTimeoutMs, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(stdout.toString('utf8'));
  return {
    propose: rehydrateStage(parsed.propose),
    verify: rehydrateStage(parsed.verify),
    adjudicate: rehydrateStage(parsed.adjudicate),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
  };
}
function isKilledError(e) {
  return Boolean(e) && (e.killed || e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM');
}
// breachSubprocessErrorReason(e, opts) -> the recorded reason string for a killed vs. a crashed
// subprocess. Split out so runBreachLaneSubprocess's own catch block stays a single call.
function breachSubprocessErrorReason(e, opts) {
  if (isKilledError(e)) {
    return 'breach lane exceeded the ' + opts.breachTimeoutMs + 'ms subprocess deadline and was killed (Rule 9); '
      + 'a synchronous hang in a real breach module - see the propose ReDoS P0 in breach/proposers/, owner R3/W2a)';
  }
  return 'breach subprocess failed: ' + String((e && e.message) || e).slice(0, 160);
}
function cleanupJobFile(jobFile) {
  try { fs.unlinkSync(jobFile); }
  catch (e) { /* FAIL-OPEN: best-effort temp cleanup; a leftover temp file in os.tmpdir() is harmless and reaped by the OS, never a correctness failure. */ }
}

// runBreachLaneSubprocess(bundle, coverage, opts) -> the real lane, bounded by a HARD wall-clock kill
// (Rule 9). A synchronous hang in a breach module cannot be interrupted in-process, so it runs in a
// child (breach-worker.js) that execFileSync kills after opts.breachTimeoutMs. A timeout or crash
// degrades THIS firm's breach lane to an honest error, never hangs the run.
function runBreachLaneSubprocess(bundle, coverage, opts) {
  const jobFile = jobFilePath();
  try {
    writeBreachJob(jobFile, bundle, coverage, opts);
    return Promise.resolve(runBreachWorker(jobFile, opts));
  } catch (e) {
    // FAIL-OPEN (Rule 9): a killed (timeout) or crashed breach subprocess degrades THIS firm's breach
    // lane to a recorded error and the run continues; it is NEVER a hang and NEVER a fabricated pass.
    return Promise.resolve(breachLaneError(breachSubprocessErrorReason(e, opts)));
  } finally {
    cleanupJobFile(jobFile);
  }
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

// breachLaneDisabled(reason) -> a whole-lane result with every stage SKIPPED (not errored): the
// operator asked (via --no-breach) not to run the breach lane. breachLaneComplete is then false, so
// judge.js reports every known_breach as SKIPPED (honest: the lane was not run), never a fabricated pass.
function breachLaneDisabled(reason) {
  const sk = () => ({ ran: false, skipped: true, error: null, reason, output: null, source: null });
  return { propose: sk(), verify: sk(), adjudicate: sk(), findings: [] };
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
 * opts (all optional; production use supplies none of the loader/llmCall overrides):
 *   rootDir, catalogueRecords, llmCall, proposeLoaded, verifyLoaded, adjudicateLoaded
 *   breachTimeoutMs  when > 0 and no loader is injected, the real breach lane runs in a subprocess
 *                    bounded by this hard wall-clock deadline (Rule 9; guards the propose ReDoS hang).
 *   breachInProcess  force the in-process lane even when breachTimeoutMs is set (the worker uses this).
 *   noBreach         skip the breach lane entirely (facts + coverage only); stages report skipped.
 */
async function runPipeline(domain, bundle, opts = {}) {
  const facts = runFactsDoors(bundle);
  const payload = factsToPayload(domain, facts);
  const catalogueRecords = opts.catalogueRecords !== undefined ? opts.catalogueRecords : loadCatalogueRecords();
  const coverage = runCoverageStage(bundle, payload.meta.sector, catalogueRecords);
  const breach = opts.noBreach
    ? breachLaneDisabled('breach lane disabled via --no-breach (facts + coverage only)')
    : await runBreachLane(bundle, coverage, { ...opts, catalogueRecords });

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
  runBreachLaneInProcess,
  runBreachLaneSubprocess,
  runOptionalStage,
  buildStageTable,
  probeStageWiring,
  bundlePages,
  verifiedCandidatesFrom,
  adjudicatedFindings,
  perRuleCoverageArg,
  breachLaneError,
  breachLaneDisabled,
};
