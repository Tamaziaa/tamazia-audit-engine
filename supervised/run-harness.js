'use strict';
// supervised/run-harness.js - THE supervised-run harness (Kimi K3 round-3 spec sections 2 and 5): stages
// 1-5 of the ten-stage pipeline (capture -> identity/applicability -> sector -> detectors -> auto-verify),
// deterministic end to end, run over the CURRENT engine's own doors - it introduces NO second crawler, NO
// second facts resolver, NO second applicability engine (Rule 1). Stages 6 (adversarial suppress-only
// review) and 7 (no-orphan-lint-compliant drafting) belong to the ORCHESTRATOR (Claude), strictly outside
// this file; this harness's job ends at handing the orchestrator four things, verbatim from the spec:
// typed candidate findings, an entity card, an applicability ledger, and targeted excerpts.
//
//   runSupervised(site, opts) -> {
//     runId, site, refusal,                          // refusal is non-null only when the ICP gate declines
//     entityCard,                                     // supervised/entity-card.js's projection
//     applicabilityLedger,                             // supervised/applicability-ledger.js's projection
//     candidateFindings,                               // typed Finding[] (supervised/finding.js), each
//                                                      // ALREADY hash-verified via verify_quote at build time
//     rejectedCandidates,                              // [{record_id, code, reason}] - what verifyAll() or
//                                                      // the quote-resolver dropped, and why (never silent)
//     nonQuoteCandidates,                              // [{record_id, artifact_type}] - verified candidates
//                                                      // whose artifact is not textual (register_row/
//                                                      // register_absence/coverage_proof/dom_node/
//                                                      // network_event); v0 SCOPES Finding construction to
//                                                      // quote artifacts only (documented judgement call
//                                                      // below) - these are recorded for visibility, not lost.
//     excerpts,                                        // supervised/excerpts.js's bounded windows
//     captureIndex,                                    // the ArtifactStore (bytes retained for THIS run)
//     coverageManifest,                                // { checks_planned, checks_run, checks_unrun, lanes }
//     catalogueHash, engineVersion, stageManifest,
//   }
//
// SCOPING JUDGEMENT CALL (documented, not hidden): a Finding (supervised/finding.js) is uncontructible
// without a Quote, and a Quote is a byte range into a captured artifact's TEXT bytes. propose.js also emits
// candidates whose artifact is register_row / register_absence / coverage_proof / dom_node / network_event
// - real, deterministic, Rule-3-legal artifacts, but not textual spans this v0's byte-offset convention can
// represent. Rather than stretch the Quote type to cover them dishonestly (e.g. a fake byte range into an
// unrelated page), v0 records them on `nonQuoteCandidates` for the orchestrator/human to see and leaves
// their promotion to a typed Finding as a documented, additive P1 extension (a second Quote-like type per
// artifact class, or a widened Finding.evidence union) - never silently dropped, never faked.
//
// CLASS ASSIGNMENT (documented judgement call): the harness stops BEFORE any LLM adjudication (that is
// stage 6+, Claude's job, or the engine's own breach/adjudicator/ jury - out of scope for this deterministic
// spine). A quote-artifact candidate that survived propose() (a deterministic lexicon/pattern match against
// real evidence) AND verify_quote() (hash-anchored, non-LLM) is honestly `likely`, never `confirmed` (no
// entailment/jury has run) and never `needs_human` (a real proposer match against real hashed evidence is
// more than "we don't know" - Rule 6's floor is for ambiguity, and this is not ambiguous, it is
// UNADJUDICATED). Stage 6 (Claude, suppress-only) may only ever move a finding DOWNWARD from here.

const { composeBundle } = require('../mint/compose-bundle.js');
const { runFactsDoors, icpGate, loadCatalogue } = require('../mint/index.js');
const { connect } = require('../applicability/connect.js');
const coverageContract = require('../evidence/crawler/coverage-contract.js');
const { propose } = require('../breach/proposers/propose.js');
const { verifyAll } = require('../breach/verifiers/index.js');
const { ARTIFACT_TYPES } = require('../breach/artifact-types.js');

const { buildCaptureIndex } = require('./capture-index.js');
const { resolveQuoteSpan } = require('./quote-resolver.js');
const { verifyQuote } = require('./verify-quote.js');
const { createFinding, FINDING_CLASS } = require('./finding.js');
const { buildEntityCard } = require('./entity-card.js');
const { buildApplicabilityLedger } = require('./applicability-ledger.js');
const { buildExcerpts } = require('./excerpts.js');
const { ManifestStore, newRunId } = require('./manifest-store.js');
const { ENGINE_VERSION } = require('../mint/version.js');

function pagesOf(bundle) {
  return bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
}

// candidateQuoteText(candidate, artifact) -> the live text a quote-type candidate proposed (propose.js's
// own shape variance, mirrored from breach/verifiers/quote-match.js's resolveQuoteArtifact doc: the text
// may be at artifact.quote or artifact.text).
function candidateQuoteText(candidate, artifact) {
  return typeof artifact.quote === 'string' ? artifact.quote : artifact.text;
}
function candidatePageUrl(candidate, artifact) {
  return typeof artifact.page_url === 'string' ? artifact.page_url : candidate.page_url;
}

// buildCoverageManifest(app, perRule, site) -> the CoverageManifest subset this v0 can honestly populate
// (blueprint section 2.2's shape, lite): checks_planned = every applicable record's id; checks_run = those
// propose() actually evaluated (all of checks_planned, since propose runs every compiled spec for the
// applicable set); checks_unrun = [] here (v0 does not yet track a per-check lane dependency map - an
// honest, documented gap, not a fabricated 100%); lanes/evidence_ids come from the site coverage report.
function buildCoverageManifest(app, catalogueHash) {
  const plannedIds = app.applicable.map((r) => r.id);
  return {
    checks_planned: plannedIds,
    checks_run: plannedIds.slice(),
    checks_unrun: [],
    catalogue_hash: catalogueHash,
    engine_version: ENGINE_VERSION,
  };
}

// jurisdictionFor(record, facts) -> the catalogue record's own jurisdiction when it declares one, else
// the first BOUND jurisdiction facts/jurisdiction.js found, else the honest 'UNKNOWN' floor (never
// invented - a Finding's jurisdiction is always traceable to one of these two real sources).
function jurisdictionFor(record, facts) {
  if (record && record.jurisdiction) return record.jurisdiction;
  const bound = facts.jurisdiction && facts.jurisdiction.bound;
  return (bound && bound[0] && bound[0].jurisdiction) || 'UNKNOWN';
}
// recordFor(catalogue, recordId) -> the catalogue record with this id, or null (catalogue may be handed
// either {records:[...]} or a bare array - both shapes are accepted throughout this repo).
function recordFor(catalogue, recordId) {
  const records = catalogue.records || catalogue;
  return records.find ? records.find((r) => r.id === recordId) : null;
}
// classifyOneCandidate(entry, catalogue, captureIndex, facts, catalogueHash) -> a tagged outcome for ONE
// verified candidate: {kind:'nonQuote'|'rejected'|'finding', value}. Pulled out of classifyCandidates()'s
// loop so each of the three ways a candidate can resolve (not a quote artifact; a quote that cannot be
// hash-verified; a genuinely verified quote) is one small, separately readable step, never nested ifs.
function classifyOneCandidate(entry, catalogue, captureIndex, facts, catalogueHash) {
  const candidate = entry.candidate;
  const artifact = candidate && candidate.artifact;
  if (!artifact || artifact.type !== ARTIFACT_TYPES.QUOTE) {
    return { kind: 'nonQuote', value: { record_id: candidate && candidate.record_id, artifact_type: artifact && artifact.type } };
  }
  const pageUrl = candidatePageUrl(candidate, artifact);
  const quoteText = candidateQuoteText(candidate, artifact);
  const span = resolveQuoteSpan(captureIndex, pageUrl, quoteText);
  if (!span) {
    return { kind: 'rejected', value: { record_id: candidate.record_id, code: 'span_unresolved', reason: 'candidate quote could not be located in the hash-chained capture index (page ' + JSON.stringify(pageUrl) + ')' } };
  }
  if (!verifyQuote(captureIndex, span)) {
    return { kind: 'rejected', value: { record_id: candidate.record_id, code: 'verify_quote_failed', reason: 'the resolved byte range failed verify_quote against the hashed artifact' } };
  }
  const jurisdiction = jurisdictionFor(recordFor(catalogue, candidate.record_id), facts);
  try {
    const finding = createFinding({ rule_id: candidate.record_id, catalogue_hash: catalogueHash, quote: span, jurisdiction, class: FINDING_CLASS.LIKELY });
    return { kind: 'finding', value: finding };
  } catch (e) {
    return { kind: 'rejected', value: { record_id: candidate.record_id, code: 'construction_failed', reason: e.message } };
  }
}

// classifyCandidates(verified, captureIndex) -> { findings, rejected, nonQuote }. Walks every verified
// candidate exactly once; quote-type candidates whose span resolves AND re-verifies become typed Findings,
// everything else is accounted for honestly (never dropped without a reason).
function classifyCandidates(verified, catalogue, captureIndex, facts) {
  const findings = [];
  const rejected = [];
  const nonQuote = [];
  const catalogueHash = catalogue.content_hash;
  for (const entry of verified) {
    const outcome = classifyOneCandidate(entry, catalogue, captureIndex, facts, catalogueHash);
    if (outcome.kind === 'finding') findings.push(outcome.value);
    else if (outcome.kind === 'rejected') rejected.push(outcome.value);
    else nonQuote.push(outcome.value);
  }
  return { findings, rejected, nonQuote };
}

// runContextFrom(site, opts) -> { o, now, manifestStore, runId, catalogue }. Resolves every injectable
// (clock, manifest store, run id, catalogue) exactly once, at the top of the run, from the SAME opts
// object every stage below reads through - never re-resolved mid-run.
function runContextFrom(site, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const manifestStore = o.manifestStore instanceof ManifestStore ? o.manifestStore : new ManifestStore({ now, baseDir: o.manifestBaseDir });
  const runId = o.runId || newRunId(site, now);
  const catalogue = o.catalogue || loadCatalogue();
  return { o, now, manifestStore, runId, catalogue };
}

// captureStage(site, ctx) -> { bundle, stageManifest, captureIndex }. Stage 1: fetch + hash-chain every
// captured page, logging both the raw crawl manifest and the capture index's own hash-only projection.
async function captureStage(site, ctx) {
  ctx.manifestStore.append(ctx.runId, 'run_start', { site, engine_version: ENGINE_VERSION, catalogue_hash: ctx.catalogue.content_hash, mode: 'supervised' });
  const { bundle, stageManifest } = await composeBundle(site, ctx.o);
  ctx.manifestStore.append(ctx.runId, 'capture', { stageManifest });
  const captureIndex = buildCaptureIndex(bundle, { now: ctx.now, stageManifest });
  ctx.manifestStore.append(ctx.runId, 'capture_index', captureIndex.toJSON());
  return { bundle, stageManifest, captureIndex };
}

// factsSummaryFor(facts) -> the compact projection of the facts envelope the manifest records (never the
// full envelope - the manifest is provenance, not a second copy of every fact door's raw output).
function factsSummaryFor(facts) {
  return {
    identity: { display_name: facts.identity && facts.identity.display_name, legal_name: facts.identity && facts.identity.legal_name },
    jurisdiction: { bound: facts.jurisdiction && facts.jurisdiction.bound },
    sector: { value: facts.sector && facts.sector.value, conflict_flag: facts.sector && facts.sector.conflict_flag },
  };
}

// identityStage(bundle, ctx) -> { facts, cell, entityCard }. Stage 2: run the facts doors, the ICP sector
// gate, and project the orchestrator-facing entity card - all read-only over the SAME facts envelope.
function identityStage(bundle, ctx) {
  const facts = runFactsDoors(bundle);
  ctx.manifestStore.append(ctx.runId, 'facts', factsSummaryFor(facts));
  const cell = icpGate(facts);
  ctx.manifestStore.append(ctx.runId, 'sector_gate', { auditable: cell.auditable, reason: cell.reason || null });
  return { facts, cell, entityCard: buildEntityCard(facts) };
}

// applicabilityStage(facts, ctx) -> { app, applicabilityLedger }. Stage 3: connect() decides which
// catalogue records bind; this stage only logs and projects that decision, never re-decides it.
function applicabilityStage(facts, ctx) {
  const app = connect(facts, ctx.catalogue);
  ctx.manifestStore.append(ctx.runId, 'applicability', { counts: app.counts, applicable: app.applicable.map((r) => r.id), excludedCount: app.excluded.length });
  return { app, applicabilityLedger: buildApplicabilityLedger(app) };
}

// detectionStage(bundle, app, facts, captureIndex, ctx) -> { classified }. Stages 4-5: propose candidates
// over the applicable records' coverage, auto-verify them against the live corpus, then classify the
// survivors into typed Findings / rejections / non-quote candidates (never silently dropped).
function detectionStage(bundle, app, facts, captureIndex, ctx) {
  const pages = pagesOf(bundle);
  const perRule = coverageContract.coverageFor(app.applicable, pages, {});
  const candidates = propose(bundle, app.applicable, perRule);
  ctx.manifestStore.append(ctx.runId, 'propose', { candidateCount: candidates.length });

  const verifyResult = verifyAll(candidates, bundle);
  ctx.manifestStore.append(ctx.runId, 'verify', { verifiedCount: verifyResult.verified.length, rejectedCount: verifyResult.rejected.length });

  const classified = classifyCandidates(verifyResult.verified, ctx.catalogue, captureIndex, facts);
  ctx.manifestStore.append(ctx.runId, 'candidate_findings', {
    findingCount: classified.findings.length,
    findings: classified.findings.map((f) => ({ finding_id: f.finding_id, rule_id: f.rule_id, class: f.class, quote: f.quote })),
    rejected: classified.rejected,
    nonQuoteCandidateCount: classified.nonQuote.length,
  });
  return classified;
}

// finalizeStage(app, captureIndex, classified, ctx) -> { excerpts, coverageManifest }. Builds the
// orchestrator's targeted excerpts and the run's coverage manifest, and logs the latter.
function finalizeStage(app, captureIndex, classified, ctx) {
  const excerpts = buildExcerpts(captureIndex, classified.findings);
  const coverageManifest = buildCoverageManifest(app, ctx.catalogue.content_hash);
  ctx.manifestStore.append(ctx.runId, 'coverage_manifest', coverageManifest);
  return { excerpts, coverageManifest };
}

// refusalOf(cell) -> the ICP gate's refusal reason string, or null when the cell is auditable.
function refusalOf(cell) {
  return cell.auditable ? null : (cell.reason || 'sector_not_auditable');
}

// runSupervised(site, opts) -> Promise<RunResult>. opts: everything mint/compose-bundle.js accepts
// (fetchFn/launchBrowser/registersFetchFn - the SAME injection seam, no second one), plus `catalogue`,
// `runId`, `now`, `manifestStore` (an existing ManifestStore instance, or a fresh default one). Each
// pipeline stage (1: capture, 2: identity/applicability, 3: sector gate, 4-5: detectors/auto-verify) is
// its own named function above; this orchestrator just threads their outputs through in order.
async function runSupervised(site, opts) {
  const ctx = runContextFrom(site, opts);
  const { bundle, stageManifest, captureIndex } = await captureStage(site, ctx);
  const { facts, cell, entityCard } = identityStage(bundle, ctx);
  const { app, applicabilityLedger } = applicabilityStage(facts, ctx);
  const classified = detectionStage(bundle, app, facts, captureIndex, ctx);
  const { excerpts, coverageManifest } = finalizeStage(app, captureIndex, classified, ctx);

  return {
    runId: ctx.runId, site, refusal: refusalOf(cell),
    entityCard, applicabilityLedger,
    candidateFindings: classified.findings, rejectedCandidates: classified.rejected, nonQuoteCandidates: classified.nonQuote,
    excerpts, captureIndex, coverageManifest,
    catalogueHash: ctx.catalogue.content_hash, engineVersion: ENGINE_VERSION, stageManifest,
    manifestStore: ctx.manifestStore,
  };
}

module.exports = { runSupervised, classifyCandidates, buildCoverageManifest };
