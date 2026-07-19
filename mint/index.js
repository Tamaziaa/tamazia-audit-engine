'use strict';
// mint/index.js - THE single-URL live mint (Constitution Rules 5, 6, 7, 9, 11, 12, 13, 15, 17). It
// assembles the audit end to end and persists it, and it is ONE of the two reachability entry points
// (mint/worker.js is the other): requiring it makes every evidence / facts / applicability / breach / llm /
// payload module in the audit path reachable from the mint, so the Rule-5 reachability walk ARMS (C-154/
// C-250). A module not reached from here and not in DORMANT.md fails the sweep.
//
//   mint(url, opts) -> { status, done, payload, row, slug, hash, stageManifest, refusal, postWrite, report }
//
// THE ORDER (each step reads the last; no step re-derives a fact another produced - Rule 1):
//   composeBundle            the four evidence lanes -> the EvidenceBundle + stageManifest (C-037/C-041).
//   facts doors              identity / jurisdiction / sector / capabilities (pure, over the bundle).
//   sector.auditableCell     THE ICP gate (Aman's directive): a non-served (sector x jurisdiction) cell
//                            REFUSES with { status:'refused', refusal } - no fabrication, silence is free.
//   applicability.connect    the catalogue filtered to the records that BIND this firm (Rule 13); its
//                            counts { frameworksAssessed, frameworksBinding, rulesChecked } thread WHOLE
//                            into compose (never re-derived).
//   coverage                 site-level + per-rule coverage over the APPLICABLE records only.
//   propose -> verifyAll     candidates carrying deterministic artifacts (Rule 3), then the artifact gate.
//   breach/enrich            each verified candidate joined to its compiled catalogue record (Rule 2).
//   adjudicate               filter-only, { llmCall, providers, jury:true } - the LOCKED founder decision:
//                            Gate-3 + Gate-5 jury anchored on Ministral at this seam. An observed fact
//                            (the PECR pre-consent breach) bypasses the model to a violation (C-084).
//   compose                  the contract-valid v1.1 payload (T3a); generatedAt is injected (no clock in
//                            pure code); validatePayload MUST be empty or compose throws (fail closed).
//   persist                  R2 object + idempotent Neon row (idempotency key url+ENGINE_VERSION, Rule 15).
//   assertMinted             row read-back + live 200 + truth-pack; done:true ONLY when all three green.
//
// Every live-fetch / browser / LLM / DB surface is dependency-injected via opts, so node:test drives the
// WHOLE mint over fakes with no network (see mint/mint-e2e.test.js).

const { composeBundle } = require('./compose-bundle.js');
const identity = require('../facts/identity.js');
const jurisdiction = require('../facts/jurisdiction.js');
const sector = require('../facts/sector.js');
const capabilities = require('../facts/capabilities.js');
const { connect } = require('../applicability/connect.js');
const conflicts = require('../applicability/conflicts.js');
const coverageContract = require('../evidence/crawler/coverage-contract.js');
const { propose } = require('../breach/proposers/propose.js');
const { verifyAll } = require('../breach/verifiers/index.js');
const { enrichVerifiedCandidates } = require('../breach/enrich.js');
const { adjudicate } = require('../breach/adjudicator/adjudicate.js');
const { compose } = require('../payload/composer/compose.js');
const { validatePayload } = require('../payload/contract');
const { buildChain } = require('../llm/providers/chain.js');
const { buildLlmCall } = require('./llm-seam.js');
const { persist } = require('./persist.js');
const { assertMinted } = require('./post-write-assertions.js');

const ADJUDICATE_DEADLINE_MS = 60000; // total adjudication ceiling (Rule 8/9); a CAP, never a floor.
const LLM_CALL_DEADLINE_MS = 20000;   // per-call ceiling handed to the llm seam.

// loadCatalogue() -> the compiled catalogue artifact (Rule 2: the ONE source of law facts). Required
// lazily so a caller may inject opts.catalogue (a subset in tests) without the default artifact being read.
function loadCatalogue() {
  return require('../catalogue/dist/catalogue.v1.json');
}

// runFactsDoors(bundle) -> { identity, jurisdiction, sector, capabilities }. The four pure doors over the
// bundle (capabilities only when the corpus is readable; an empty corpus abstains rather than derive from
// nothing). The mint is a CONSUMER of the facts doors (Rule 1): it CALLS each one producer (facts/*.js) and
// re-derives nothing, so tools/one-door exempts these member-call sites (a call to the door is not a second
// door).
function runFactsDoors(bundle) {
  const pages = bundle && bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  return {
    identity: identity.resolveIdentity(bundle),
    jurisdiction: jurisdiction.resolveJurisdiction(bundle),
    sector: sector.resolveSector(bundle),
    capabilities: pages.length > 0 ? capabilities.deriveCapabilities(bundle) : null,
  };
}

// icpGate(facts) -> the auditableCell verdict (Aman's directive). Reads the RESOLVED sector + bound
// jurisdictions off the fact envelopes (one door each); never re-derives them.
function icpGate(facts) {
  const secVal = facts.sector && facts.sector.value ? facts.sector.value : null;
  const bound = (facts.jurisdiction && Array.isArray(facts.jurisdiction.bound) ? facts.jurisdiction.bound : [])
    .map((b) => b && b.jurisdiction).filter(Boolean);
  return sector.auditableCell({ sector: secVal && secVal.sector, sub_sector: secVal && secVal.sub_sector, jurisdictions_bound: bound });
}

// sectorFamilyOf(facts) -> the resolved sector family string for the site-level coverage class, or null.
function sectorFamilyOf(facts) {
  return facts.sector && facts.sector.value ? facts.sector.value.sector : null;
}

// resolveLlm(opts, cfg) -> { llmCall, providers }. Injected llmCall/providers win (tests); production
// builds the free-first chain PLUS the Ministral anchor (buildChain) and wraps it in the mint llm seam.
function resolveLlm(opts, cfg) {
  if (typeof opts.llmCall === 'function' && opts.providers) return { llmCall: opts.llmCall, providers: opts.providers };
  const chain = buildChain({ env: cfg.env, log: cfg.log });
  return {
    llmCall: typeof opts.llmCall === 'function' ? opts.llmCall : buildLlmCall({ providers: chain.providers, deadlineMs: LLM_CALL_DEADLINE_MS, log: cfg.log }),
    providers: Array.isArray(opts.providers) ? opts.providers : chain.providers,
  };
}

// runBreachLane(bundle, applicable, catalogue, llm, cfg) -> the adjudicated findings[]. propose over the
// APPLICABLE records only (connect already filtered to what binds), then the artifact verifier, then the
// catalogue-enrich join (Rule 2), then the filter-only adjudicator with the Ministral-anchored Gate-3 +
// Gate-5 jury engaged (jury:true; the founder-locked decision). An observed fact bypasses to a violation.
async function runBreachLane(bundle, applicable, catalogue, llm, cfg) {
  const pages = bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const perRule = coverageContract.coverageFor(applicable, pages, {});
  const candidates = propose(bundle, applicable, perRule);
  const { verified } = verifyAll(candidates, bundle);
  const enriched = enrichVerifiedCandidates(verified.map((e) => e.candidate), catalogue.records || catalogue);
  const { findings, report } = await adjudicate(enriched, bundle, {
    llmCall: llm.llmCall, providers: llm.providers, jury: true,
    deadlineMs: cfg.adjudicateDeadlineMs, now: cfg.now, log: cfg.log,
  });
  return { findings, report };
}

// buildPayload(bundle, facts, app, findings, cfg) -> the contract-valid v1.1 payload. compose() reads
// connect()'s counts VERBATIM (threaded whole via `applicability`), joins each finding to its catalogue
// record, and runs the contract validator on its own output (throws on any violation - fail closed).
function buildPayload(bundle, facts, app, findings, cfg) {
  const pages = bundle.corpus && Array.isArray(bundle.corpus.pages) ? bundle.corpus.pages : [];
  const site = coverageContract.computeCoverage(pages, sectorFamilyOf(facts));
  return compose({
    domain: bundle.domain, generatedAt: cfg.generatedAt, facts, applicability: app,
    findings, coverage: { site }, familyKeyFn: conflicts.familyKey,
  });
}

// normaliseOpts(opts) -> the mint's own config (clock, env, deadlines, generatedAt). generatedAt is derived
// from the INJECTED clock (never a bare Date.now reaching compose): the payload is deterministic per input.
function normaliseOpts(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  return {
    now, env: o.env || process.env, log: typeof o.log === 'function' ? o.log : null,
    generatedAt: o.generatedAt || new Date(now()).toISOString(),
    adjudicateDeadlineMs: Number.isFinite(o.adjudicateDeadlineMs) ? o.adjudicateDeadlineMs : ADJUDICATE_DEADLINE_MS,
  };
}

// refusal(reason, manifest) -> the clean non-mint outcome (an unserved cell / an unreadable site). No
// payload, no row, no fabrication (Rule 6: silence is free); the stageManifest still shows what ran.
function refusal(reason, manifest) {
  return { status: 'refused', done: false, refusal: reason, payload: null, row: null, slug: null, hash: null, stageManifest: manifest, postWrite: null, report: null };
}

/**
 * mint(url, opts) -> Promise<mint result>. See the file header for the ordered flow. opts (all optional;
 * production supplies none of the injections):
 *   fetchFn / launchBrowser / registersFetchFn   evidence-lane transports (composeBundle; default real).
 *   llmCall / providers                          the adjudication seam (default: the built free+anchor chain).
 *   sqlFn / putFn / liveFetch / truthPackFn       the persistence + post-write doors (default: the real doors).
 *   catalogue                                    the compiled catalogue (default: catalogue/dist/catalogue.v1.json).
 *   now / env / log / generatedAt / table / adjudicateDeadlineMs
 */
async function mint(url, opts = {}) {
  const cfg = normaliseOpts(opts);
  const catalogue = opts.catalogue || loadCatalogue();
  const { bundle, stageManifest } = await composeBundle(url, opts);

  const facts = runFactsDoors(bundle);
  const cell = icpGate(facts);
  if (!cell.auditable) return refusal(cell.reason, stageManifest);

  const app = connect(facts, catalogue);
  const llm = resolveLlm(opts, cfg);
  const { findings, report } = await runBreachLane(bundle, app.applicable, catalogue, llm, cfg);

  const payload = buildPayload(bundle, facts, app, findings, cfg);
  const missing = validatePayload(payload);
  if (missing.length) throw new Error('mint: compose produced a contract-invalid payload (construction bug, failing closed): ' + missing.join(', '));

  const persisted = await persist(payload, { env: cfg.env, generatedAt: cfg.generatedAt, table: opts.table, sqlFn: opts.sqlFn, putFn: opts.putFn });
  const postWrite = await assertMinted({
    row: persisted.row, payload, liveUrl: persisted.liveUrl,
    opts: { sqlFn: opts.sqlFn, liveFetch: opts.liveFetch, truthPackFn: opts.truthPackFn, table: opts.table, env: cfg.env },
  });

  return {
    status: postWrite.state, done: postWrite.done, refusal: null,
    payload, row: persisted.row, slug: persisted.slug, hash: persisted.hash,
    stageManifest, postWrite: postWrite.checks, report,
  };
}

module.exports = {
  mint,
  runFactsDoors,
  icpGate,
  runBreachLane,
  buildPayload,
  resolveLlm,
  loadCatalogue,
  normaliseOpts,
};
