'use strict';
// catalogue/linters/test-helpers.js - TEST-ONLY helper shared by the linter test suites' real-pack
// smoke tests (the C-148 doctrine: an eval that never executes against real data is not coverage).
// Not required by any linter or runtime file; this module exists solely to clear a jscpd clone
// (the identical "packsDir exists or skip" block that regex-health.test.js, threshold-guard.test.js,
// citation-completeness.test.js and polarity.test.js each carried verbatim).

const fs = require('node:fs');
const path = require('node:path');

// packsDirExistsOrSkip(t, testDirname) -> true if catalogue/packs/ exists next to testDirname.
// catalogue/packs/ is STAGED INPUT DATA, not owned or written by any linter module: a fresh clone
// before the packs are staged (or a working tree where they were never restored) must SKIP the
// real-pack smoke test with a loud, explicit reason, rather than either silently passing (a
// missing directory is not "zero violations") or hard-failing the whole suite on a precondition
// outside any linter's control.
function packsDirExistsOrSkip(t, testDirname) {
  const packsDir = path.join(testDirname, '..', 'packs');
  if (!fs.existsSync(packsDir)) {
    t.skip('catalogue/packs/ is not present on disk - skipping the real-pack smoke test');
    return false;
  }
  return true;
}

module.exports = { packsDirExistsOrSkip };
