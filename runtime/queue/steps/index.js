'use strict';
// runtime/queue/steps/index.js - the typed step-function skeleton, one entry per pipeline stage.
//
// intake -> evidence -> facts -> applicability -> breach -> payload -> render -> mint
//
// Each stage below is registered as its own pg-boss queue (see boss.js: stageQueueOptions), which
// gives per-stage retry/backoff/timeout and the bulkhead property the blueprint asks for: a dying
// browser-lane job in "evidence" cannot starve "facts" or "mint" workers.
//
// Bodies are NotImplemented placeholders. The typed input/output JSDoc on each is the contract
// this workstream commits to; WS0's payload v1.2 work is the source of truth once it lands, and
// these shapes are written to match the pipeline stage names already used across the engine
// (evidence/, facts/, applicability/connect.js, breach/, payload/composer, mint/) rather than
// invent a parallel vocabulary.

class NotImplementedError extends Error {
  constructor(stage) {
    super(`step "${stage}" is a staged placeholder - WS0 payload v1.2 binding not yet landed`);
    this.name = 'NotImplementedError';
    this.stage = stage;
  }
}

/**
 * @typedef {object} StageJobData
 * @property {string} jobId
 * @property {string} url
 * @property {string} pipelineVersion
 */

/**
 * intake: validates the request shape and confirms Turnstile/HMAC state already checked by the
 * Worker. Enqueues the "evidence" stage on success.
 * @param {StageJobData} data
 */
async function intake(data) {
  throw new NotImplementedError('intake');
}

/**
 * evidence: drives the warm Playwright browser-service pool on the VM to collect page HTML,
 * screenshots, and network trace/HAR for the target URL. Writes artefacts to R2 under the
 * job's key prefix.
 * @param {StageJobData & { evidenceRefs?: string[] }} data
 */
async function evidence(data) {
  throw new NotImplementedError('evidence');
}

/**
 * facts: runs the engine's facts/ extractors against collected evidence. One door per fact
 * (Constitution Rule 2) - this step calls into the existing facts/ module tree, it does not
 * reimplement extraction.
 * @param {StageJobData} data
 */
async function facts(data) {
  throw new NotImplementedError('facts');
}

/**
 * applicability: calls applicability/connect.js to bind facts to catalogue law records by
 * sector/jurisdiction relevance.
 * @param {StageJobData} data
 */
async function applicability(data) {
  throw new NotImplementedError('applicability');
}

/**
 * breach: propose -> verify -> adjudicate, per the engine's existing breach/ pipeline
 * (Constitution Rule 3: no-artifact-no-breach).
 * @param {StageJobData} data
 */
async function breach(data) {
  throw new NotImplementedError('breach');
}

/**
 * payload: composes the final payload v1.1/v1.2 contract via payload/composer.
 * @param {StageJobData} data
 */
async function payload(data) {
  throw new NotImplementedError('payload');
}

/**
 * render: produces the lux report render (website repo's functions/audit/_lux.js consumes this;
 * this step only produces the payload the renderer reads, it does not render server-side here).
 * @param {StageJobData} data
 */
async function render(data) {
  throw new NotImplementedError('render');
}

/**
 * mint: persists to Neon audit_pages + R2 (mint/persist.js), the one production-writing step in
 * the whole pipeline. STAGED: this placeholder never calls the real mint/ module against
 * production; wiring that in is the founder-gated day-15 cutover.
 * @param {StageJobData} data
 */
async function mint(data) {
  throw new NotImplementedError('mint');
}

const STAGES = Object.freeze(['intake', 'evidence', 'facts', 'applicability', 'breach', 'payload', 'render', 'mint']);

module.exports = {
  STAGES,
  NotImplementedError,
  intake,
  evidence,
  facts,
  applicability,
  breach,
  payload,
  render,
  mint,
};
