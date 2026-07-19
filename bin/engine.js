#!/usr/bin/env node
'use strict';
// bin/engine.js - THE Mint Gate v0 CLI (Kimi K3 round-3 spec: "engine run --site <url> --mode supervised",
// "engine packet --run-id <id>", "engine replay --run-id <id>"). Thin: every command is a direct call into
// supervised/ - this file adds no logic of its own beyond argv parsing and JSON/exit-code plumbing, so the
// SAME behaviour is reachable from node:test with no process spawn (see bin/engine.test.js).
//
// OFFLINE dress-rehearsal seam: any command that captures accepts --fixture-html <url>=<file> to replay a
// site's STORED raw HTML through the REAL crawl/facts/detector pipeline with the register + browser lanes
// stubbed - no live network, no Chromium, fully reproducible (the CI-safe, PII-safe rehearsal path). With
// no --fixture-html the live transports run. --mode defaults to 'supervised' (v0's only lane).
//
// Commands:
//   engine run --site <url> [--mode supervised] [--fixture-html <url>=<file>] [--run-id <id>] [--catalogue-path <p>] [--manifest-dir <p>]
//     Runs the supervised harness (stages 1-5) end to end and prints the run summary as JSON.
//   engine packet --run-id <id> [--manifest-dir <p>] [--out <path>]
//     Regenerates the review packet HTML from a re-run over the SAME site (a packet is a live view, not a
//     manifest replay - it needs the ArtifactStore's real bytes, which is why `packet` accepts --site too,
//     defaulting to the run_id's own recorded site).
//   engine sign --run-id <id> --overall SIGN|HOLD --decisions <path-to-json>
//     Records a human signature (supervised/signature-store.js) from a JSON file
//     ({findingDecisions:[{finding_id,decision,reason_code}], signer, note}).
//   engine replay --run-id <id> --site <url>
//     Re-runs stages 1-5 fresh (to obtain a live ArtifactStore - v0's documented replay scope, see
//     supervised/replay.js's header) and re-checks every shipped finding's verify_quote.
//   engine mint --run-id <id> --site <url> [--stub-persist=false]
//     Evaluates the mint gate (supervised/mint-gate.js) and reports proceed/refuse.

const fs = require('fs');
const path = require('path');

const { runSupervised } = require('../supervised/run-harness.js');
const { buildPacketHtml } = require('../supervised/packet.js');
const { recordSignature } = require('../supervised/signature-store.js');
const { replayRun } = require('../supervised/replay.js');
const { mintGate } = require('../supervised/mint-gate.js');
const { ManifestStore } = require('../supervised/manifest-store.js');
const { lintNoOrphanClaims } = require('../supervised/orphan-lint.js');

// setArg(out, key, value) - a REPEATED flag (e.g. multiple --fixture-html <url>=<file>) accumulates into
// an array rather than the last occurrence silently overwriting every one before it; a flag given once
// stays a plain scalar, so every existing single-occurrence caller (args.site, args['run-id'], etc.) is
// unaffected. captureOptsFrom() already expects args['fixture-html'] to possibly be an array
// (`[].concat(args['fixture-html'])`) - this is the setter that actually honours that contract.
function setArg(out, key, value) {
  if (!Object.prototype.hasOwnProperty.call(out, key)) { out[key] = value; return; }
  if (Array.isArray(out[key])) { out[key].push(value); return; }
  out[key] = [out[key], value];
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { setArg(out, key, true); }
      else { setArg(out, key, next); i += 1; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function storeFrom(args) {
  return new ManifestStore({ baseDir: args['manifest-dir'] });
}

function loadCatalogueFrom(args) {
  if (!args['catalogue-path']) return undefined;
  return JSON.parse(fs.readFileSync(args['catalogue-path'], 'utf8'));
}

// requireSupervisedMode(args) - v0 runs the SUPERVISED lane only (the human-signed release path). --mode
// defaults to 'supervised'; any other value is refused (there is no unattended/auto-mint mode in v0).
function requireSupervisedMode(args) {
  const mode = typeof args.mode === 'string' ? args.mode : 'supervised';
  if (mode !== 'supervised') throw new Error('engine: v0 supports --mode supervised only (got ' + JSON.stringify(mode) + ')');
  return mode;
}

// fakeBrowserPage()/fakeBrowser() - a no-op browser for OFFLINE runs (the observe/dom-assert lanes degrade
// to a recorded LaneError rather than launching Chromium). Mirrors mint/compose-bundle.test.js's fake.
function fakeBrowser() {
  const page = {
    on() {}, async goto() {}, async settle() {}, async cookies() { return []; },
    async findConsentControl() { return { found: false }; }, async clickConsent() {}, async evaluate() { return []; },
  };
  return { async newPage() { return page; }, async close() {} };
}

// captureOptsFrom(args) - the capture-lane injections for the run. With --fixture-html <url>=<file> the
// crawl lane is fed STORED raw HTML (still parsed by the REAL evidence/crawler/crawl.js), and the register
// + browser lanes are stubbed, so the whole run is offline and reproducible with NO live network or
// Chromium (the CI-safe, PII-safe dress-rehearsal seam: a real site's captured bytes replay through the
// real pipeline; context-pack Rule 16 keeps the stored HTML itself out of the repo). With no --fixture-html
// this returns {}, so the real live transports run (mint/compose-bundle.js defaults). A stored artifact is
// served for the exact URL or the site root; any other requested page 404s (degrades honestly).
function captureOptsFrom(args) {
  if (!args['fixture-html']) return {};
  const specs = [].concat(args['fixture-html']);
  const bySite = new Map();
  for (const spec of specs) {
    const eq = String(spec).indexOf('=');
    if (eq === -1) throw new Error('engine: --fixture-html expects <url>=<file>, got ' + JSON.stringify(spec));
    bySite.set(String(spec).slice(0, eq), fs.readFileSync(String(spec).slice(eq + 1), 'utf8'));
  }
  const norm = (u) => String(u).replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  const fetchFn = async (url) => {
    const key = [...bySite.keys()].find((k) => norm(k) === norm(url));
    if (key) return { ok: true, status: 200, body: bySite.get(key), finalUrl: url, contentType: 'text/html' };
    return { ok: false, status: 404, body: '', finalUrl: url };
  };
  return { fetchFn, registersFetchFn: async () => null, launchBrowser: async () => fakeBrowser(), env: {} };
}

async function cmdRun(args) {
  if (!args.site) throw new Error('engine run: --site <url> is required');
  requireSupervisedMode(args);
  const manifestStore = storeFrom(args);
  const catalogue = loadCatalogueFrom(args);
  const result = await runSupervised(args.site, Object.assign({
    runId: typeof args['run-id'] === 'string' ? args['run-id'] : undefined,
    manifestStore, catalogue,
  }, captureOptsFrom(args)));
  process.stdout.write(JSON.stringify({
    runId: result.runId, site: result.site, refusal: result.refusal,
    candidateFindingCount: result.candidateFindings.length,
    rejectedCandidateCount: result.rejectedCandidates.length,
    nonQuoteCandidateCount: result.nonQuoteCandidates.length,
    catalogueHash: result.catalogueHash, engineVersion: result.engineVersion,
    findings: result.candidateFindings.map((f) => ({ finding_id: f.finding_id, rule_id: f.rule_id, class: f.class, quote: f.quote })),
  }, null, 2) + '\n');
  return 0;
}

// rerunScratch(site, args, ctx, suffix) -> Promise<RunResult>. `ctx` is {manifestStore, catalogue} - the
// run's PRIMARY store/catalogue, bundled into one argument (never four loose ones). Several commands
// (packet, mint, replay) need a LIVE ArtifactStore to re-read real bytes for an already-run run_id
// (capture-index.js's manifest projection is hash-only - see its own doc), so they re-run the harness
// over the SAME site. That rerun must NEVER be given the run's own runId + primary manifestStore:
// runSupervised() unconditionally appends a fresh run_start/capture/facts/... stage set on every call,
// and the manifest is an append-only legal audit trail (manifest-store.js's own doc: "editing history is
// not an option") - reusing the real run_id would silently duplicate every stage entry on each
// regeneration. A scratch run_id (`<run_id><suffix>`) with a FRESH ManifestStore (same baseDir, so it
// still lands under the same store root, just its own separate .jsonl file) keeps the rerun's manifest
// noise completely apart from the authoritative record, exactly the isolation cmdReplay already used.
async function rerunScratch(site, args, ctx, suffix) {
  const scratchStore = new ManifestStore({ baseDir: ctx.manifestStore.baseDir });
  return runSupervised(site, Object.assign({ runId: args['run-id'] + suffix, manifestStore: scratchStore, catalogue: ctx.catalogue }, captureOptsFrom(args)));
}

// runStartEntryFor(manifestStore, runId) -> the run's own 'run_start' manifest entry, or throws when no
// manifest exists for that run_id at all (a packet can only ever be built for a run that actually ran).
function runStartEntryFor(manifestStore, runId) {
  const runStart = manifestStore.readAll(runId).find((e) => e.stage === 'run_start');
  if (!runStart) throw new Error('engine packet: no manifest found for run_id ' + runId);
  return runStart;
}
// reportTextFrom(args) -> the drafted report text at --report-text, or '' when no readable file was
// given (the packet then renders "lint not run" rather than fabricating a lint result over nothing).
function reportTextFrom(args) {
  if (!args['report-text'] || !fs.existsSync(args['report-text'])) return '';
  return fs.readFileSync(args['report-text'], 'utf8');
}
// packetOutPathFor(args, manifestStore) -> --out when given, else the manifest store's own default path.
function packetOutPathFor(args, manifestStore) {
  return args.out || path.join(manifestStore.baseDir, args['run-id'] + '.packet.html');
}

async function cmdPacket(args) {
  if (!args['run-id']) throw new Error('engine packet: --run-id <id> is required');
  const manifestStore = storeFrom(args);
  const runStart = runStartEntryFor(manifestStore, args['run-id']);
  const site = args.site || runStart.site;
  const catalogue = loadCatalogueFrom(args);
  const result = await rerunScratch(site, args, { manifestStore, catalogue }, '-packet-scratch');
  const reportText = reportTextFrom(args);
  const lintResult = reportText ? lintNoOrphanClaims(reportText, result.candidateFindings) : null;
  const html = buildPacketHtml(Object.assign({}, result, { lintResult }));
  const outPath = packetOutPathFor(args, manifestStore);
  fs.writeFileSync(outPath, html, 'utf8');
  process.stdout.write(JSON.stringify({ runId: args['run-id'], packetPath: outPath, findingCount: result.candidateFindings.length }, null, 2) + '\n');
  return 0;
}

function cmdSign(args) {
  if (!args['run-id']) throw new Error('engine sign: --run-id <id> is required');
  if (!args.decisions) throw new Error('engine sign: --decisions <path.json> is required');
  const manifestStore = storeFrom(args);
  const body = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
  const entry = recordSignature(manifestStore, args['run-id'], {
    signer: args.signer || body.signer,
    overall: args.overall || body.overall,
    findingDecisions: body.findingDecisions || [],
    note: body.note,
  });
  process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
  return 0;
}

async function cmdReplay(args) {
  if (!args['run-id']) throw new Error('engine replay: --run-id <id> is required');
  const manifestStore = storeFrom(args);
  const catalogue = loadCatalogueFrom(args);
  let captureIndex = null;
  if (args.site) {
    const rerun = await rerunScratch(args.site, args, { manifestStore, catalogue }, '-replay-scratch');
    captureIndex = rerun.captureIndex;
  }
  const report = replayRun({ store: manifestStore, runId: args['run-id'], captureIndex, catalogue });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.ok ? 0 : 1;
}

// assertMintArgs(args) -> throws unless both --run-id and --site were given.
function assertMintArgs(args) {
  if (!args['run-id']) throw new Error('engine mint: --run-id <id> is required');
  if (!args.site) throw new Error('engine mint: --site <url> is required');
}

// resolvedCatalogue(catalogue) -> the caller-supplied catalogue, or the engine's own loaded default
// (mint-gate.js must always be handed a real catalogue, never undefined).
function resolvedCatalogue(catalogue) {
  return catalogue || require('../mint/index.js').loadCatalogue();
}

// attemptMint(manifestStore, args, result, catalogue) -> { code, output }. Runs the mint gate and
// reports either the outcome (code 0) or the typed refusal (code 1) - never lets a MintRefusalError
// propagate as an uncaught CLI crash, since a refusal is an expected, reportable outcome here, not a bug.
async function attemptMint(manifestStore, args, result, catalogue) {
  try {
    const outcome = await mintGate({
      store: manifestStore, runId: args['run-id'], findings: result.candidateFindings,
      captureIndex: result.captureIndex, catalogue: resolvedCatalogue(catalogue),
      coverageManifest: result.coverageManifest, stubPersist: args['stub-persist'] !== 'false',
    });
    return { code: 0, output: outcome };
  } catch (e) {
    return { code: 1, output: { proceeded: false, reasonCode: e.reasonCode || 'error', detail: e.detail || e.message } };
  }
}

async function cmdMint(args) {
  assertMintArgs(args);
  const manifestStore = storeFrom(args);
  const catalogue = loadCatalogueFrom(args);
  const result = await rerunScratch(args.site, args, { manifestStore, catalogue }, '-mint-scratch');
  const attempt = await attemptMint(manifestStore, args, result, catalogue);
  process.stdout.write(JSON.stringify(attempt.output, null, 2) + '\n');
  return attempt.code;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  if (cmd === 'run') return cmdRun(args);
  if (cmd === 'packet') return cmdPacket(args);
  if (cmd === 'sign') return cmdSign(args);
  if (cmd === 'replay') return cmdReplay(args);
  if (cmd === 'mint') return cmdMint(args);
  process.stderr.write('bin/engine.js: unknown command ' + JSON.stringify(cmd) + '. Commands: run | packet | sign | replay | mint\n');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    process.stderr.write('bin/engine.js: ' + (e && e.stack ? e.stack : String(e)) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs, cmdRun, cmdPacket, cmdSign, cmdReplay, cmdMint };
