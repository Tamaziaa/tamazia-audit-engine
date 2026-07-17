'use strict';
// catalogue/linters/test-helpers.js - TEST-ONLY helper shared by the linter test suites' real-pack
// smoke tests (the C-148 doctrine: an eval that never executes against real data is not coverage).
// Not required by any linter or runtime file; this module exists solely to clear a jscpd clone
// (the identical "packsDir exists or skip" block that regex-health.test.js, threshold-guard.test.js,
// citation-completeness.test.js and polarity.test.js each carried verbatim).
//
// CR-10 (fail closed, caution.md C-201): catalogue/packs/ is COMMITTED, git-tracked staged data
// (`git ls-files catalogue/packs` lists all 13 files) - not a gitignored build output. Its absence
// therefore means a broken checkout or a working tree not actually cloned from repo HEAD, never a
// legitimate reason to silently SKIP the one smoke test in each linter suite that exercises real
// content. A skip here previously looked identical to "zero violations" in every green CI run; this
// helper now FAILS the test instead, so a broken tree is loud, never mistaken for a clean pass.

const fs = require('node:fs');
const path = require('node:path');

// packsDirOrFail(testDirname) -> the absolute catalogue/packs/ path next to testDirname. THROWS
// (failing the calling test, never skipping it) if the directory is missing.
function packsDirOrFail(testDirname) {
  const packsDir = path.join(testDirname, '..', 'packs');
  if (!fs.existsSync(packsDir)) {
    throw new Error(
      'catalogue/packs/ is not present on disk. This directory is committed, git-tracked staged '
      + 'data (see `git ls-files catalogue/packs`), not a build output - its absence means a broken '
      + 'checkout or a working tree not cloned from repo HEAD (caution.md C-201), not a legitimate '
      + 'reason to skip the real-pack smoke test. This test FAILS rather than silently skips.'
    );
  }
  return packsDir;
}

module.exports = { packsDirOrFail };
