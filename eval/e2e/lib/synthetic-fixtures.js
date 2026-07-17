'use strict';
// eval/e2e/lib/synthetic-fixtures.js - loads the "+ synthetic additions" half of the fixtureBundle
// stage (docs/P3-ACCEPTANCE.md point 1): self-contained {bundle, expected} pairs under
// eval/e2e/fixtures/ that are not real firms from eval/reference-set/reference-set.json, used to
// exercise scenarios the real crawled corpus does not (yet) cover.
//
// Each file is read-only, own-authored data (Constitution Rule 16: no secrets, no real prospect PII -
// these are fabricated domains and text, never a real firm).

const fs = require('fs');
const path = require('path');

const { assertSafePathComponent } = require('../../../tools/lib/safe-path.js');

// loadOneSyntheticFixture(dir, f) -> {file, domain, role, bundle, expected, notes} for a well-formed
// fixture, or {file, error} for a malformed one. Never throws: a bad fixture file is reported as its
// own row by the caller, not a crash of the whole run.
function loadOneSyntheticFixture(dir, f) {
  assertSafePathComponent(f, { label: 'synthetic fixture filename' });
  const abs = path.join(dir, f);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return { file: f, error: 'unreadable JSON: ' + e.message };
  }
  if (!data || typeof data !== 'object' || !data.bundle || !data.expected) {
    return { file: f, error: 'fixture missing required "bundle" and/or "expected" fields' };
  }
  return {
    file: f,
    domain: data.domain || f.replace(/\.json$/, ''),
    role: data.role || 'synthetic',
    bundle: data.bundle,
    expected: data.expected,
    notes: data.notes || null,
  };
}

// loadSyntheticFixtures(dir) -> [{file, domain, role, bundle, expected, notes}|{file, error}, ...] for
// every *.json file under dir, sorted by filename for stable output. An absent directory yields []:
// no synthetic additions is a valid, honest state (the reference-set fixtures alone are still a
// complete run), not an error.
function loadSyntheticFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => loadOneSyntheticFixture(dir, f));
}

module.exports = { loadSyntheticFixtures, loadOneSyntheticFixture };
