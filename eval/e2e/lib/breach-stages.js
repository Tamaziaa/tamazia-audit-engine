'use strict';
// eval/e2e/lib/breach-stages.js - optional loaders for the Wave-2 breach lane (propose/verify/
// adjudicate). Wave 2 lands IN PARALLEL with this harness (docs/P3-ACCEPTANCE.md wave 2/3); every
// loader here is a PROBE, never an assumption: it looks for a real, documented export at a well-known
// path and, absent that, returns an honest {available:false, reason}. The pipeline stage then reports
// `skipped`, never a fabricated pass (Constitution Rule 4; caution.md C-037: absence must be visible,
// never silent).
//
// STAGE_CONTRACT below documents, for each stage, the ONE canonical path and export name this harness
// looks for TODAY. The moment a real module lands at that path with that export, the stage activates
// automatically - no other file needs to change. If a stage lands at a different path/export name,
// only STAGE_CONTRACT needs editing (one seam, Rule 1 doctrine).
//
// STATE AS OF THIS HARNESS'S BUILD (poll again before trusting this list - modules land continuously):
//   propose     breach/proposers/    only .gitkeep - NOT landed. Stage reports skipped.
//   verify      breach/verifiers/index.js re-exports quote-match.js's verifyAll(candidates, bundle) ->
//               {verified:[{candidate,verified,code,reason}], rejected:[...]}. LANDED - wired for real.
//   adjudicate  breach/adjudicator/ has evidence-kind.js (classifyEvidenceKind) and verdict.js
//               (parseVerdict) as pure building blocks, plus llm/gate.js (validateResponse) and
//               llm/prompts/adjudicate.js (buildAdjudicationPrompt) - but NO composing index.js yet
//               that takes (verified, {llmCall}) and returns findings[]. Stage reports skipped until
//               that composing entry point lands.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const STAGE_CONTRACT = {
  propose: { relPath: 'breach/proposers/index.js', exportName: 'propose' },
  verify: { relPath: 'breach/verifiers/index.js', exportName: 'verifyAll' },
  adjudicate: { relPath: 'breach/adjudicator/index.js', exportName: 'adjudicate' },
};

// loadOptionalModule(rootDir, relPath, exportName) -> {available, run, source, reason}. A Wave-2
// module landing or not is ordinary, expected harness input, never an exceptional condition - this
// never throws.
function loadOptionalModule(rootDir, relPath, exportName) {
  const root = rootDir || REPO_ROOT;
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    return { available: false, reason: 'module not landed yet: ' + relPath };
  }
  let mod;
  try {
    mod = require(abs);
  } catch (e) {
    // FAIL-OPEN: a module that EXISTS but throws on require() is a real integration bug, not an
    // absence. Recorded with its message and reported as unavailable (never a silent skip, caution
    // C-037); the harness keeps running so one broken module cannot take down the whole run.
    return { available: false, reason: 'module present but failed to load (' + relPath + '): ' + e.message };
  }
  if (typeof mod[exportName] !== 'function') {
    return { available: false, reason: relPath + ' is present but exports no ' + exportName + '() function yet' };
  }
  return { available: true, run: mod[exportName], source: relPath };
}

function loadProposeStage(rootDir) {
  const c = STAGE_CONTRACT.propose;
  return loadOptionalModule(rootDir, c.relPath, c.exportName);
}
function loadVerifyStage(rootDir) {
  const c = STAGE_CONTRACT.verify;
  return loadOptionalModule(rootDir, c.relPath, c.exportName);
}
function loadAdjudicateStage(rootDir) {
  const c = STAGE_CONTRACT.adjudicate;
  return loadOptionalModule(rootDir, c.relPath, c.exportName);
}

module.exports = {
  loadOptionalModule,
  loadProposeStage,
  loadVerifyStage,
  loadAdjudicateStage,
  STAGE_CONTRACT,
  REPO_ROOT,
};
