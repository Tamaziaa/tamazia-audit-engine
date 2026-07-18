'use strict';
// eval/e2e/lib/catalogue-records.js - loads the compiled catalogue's records[] for the coverage stage.
//
// Constitution Rule 2 (catalogue-only law facts): this harness never authors a law name, citation or
// obligation of its own. The compiled artifact (catalogue/dist/catalogue.v1.json, catalogue/compile.js)
// is the only source; this file only reads it. Records are handed to evidence/crawler/coverage-
// contract.js's coverageFor() exactly as compiled - no filtering by sector/jurisdiction applicability
// here, because the applicability/ attachment engine has not landed (applicability/.gitkeep only at the
// time this harness was written). A landed breach/proposers/ module is expected to do its own
// sector/jurisdiction filtering before proposing; this loader's job is only to hand over the raw,
// catalogue-verified obligation set so per-rule COVERAGE (did we crawl enough to check it) can be
// computed regardless of attachment.

const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOGUE_PATH = path.join(__dirname, '..', '..', '..', 'catalogue', 'dist', 'catalogue.v1.json');

// loadCatalogueRecords(catalogueVPath) -> the compiled catalogue's records[] array. Never throws: a
// missing, unreadable or malformed artifact degrades to [] with a loud console.error (Constitution
// Rule 4 - the coverage stage falls back to site-level-only coverage on this, never a crash of the
// whole harness; see eval/e2e/lib/pipeline.js's runCoverageStage).
function loadCatalogueRecords(catalogueVPath) {
  const p = catalogueVPath || DEFAULT_CATALOGUE_PATH;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (e) {
    // FAIL-OPEN: the compiled catalogue is expected to exist (P2 shipped catalogue/dist/catalogue.v1.json),
    // but a missing/unreadable/malformed artifact must degrade per-rule coverage detail, never crash the
    // whole harness (Constitution Rule 4). Site-level coverage still runs without it.
    console.error('[eval/e2e] could not load compiled catalogue (' + p + '): ' + e.message + ' - per-rule coverage will be skipped');
    return [];
  }
}

module.exports = { loadCatalogueRecords, DEFAULT_CATALOGUE_PATH };
