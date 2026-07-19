'use strict';
// supervised/manifest-store.js - THE append-only run-manifest store (Kimi K3 round-3 spec section 2,
// row 10 "Log & learn"; section 4's "the run manifest is written (JSONL, local store) ... design it to be
// R2-ready later"). A local filesystem JSONL file today; the object KEY layout mirrors the shape a future
// R2 writer would use (run manifests are content-addressable by run_id, same as mint/persist.js's R2
// objects are addressed by slug+hash - see mint/persist.js's own doc for that precedent) so swapping the
// storage backend later is a one-function change (writeEntry's fs.appendFileSync call site only), never a
// redesign of the manifest shape itself.
//
// LAYOUT: <baseDir>/<run_id>.jsonl, one JSON object per line, NEVER rewritten in place (append-only - a
// manifest is a legal audit trail; editing history is not an option, Rule 17 "done means verified against
// ground truth"). Every entry carries { ts, stage, ...data }; readAll() parses every line back in order.
//
// baseDir defaults to a directory under the repo root that is NOT the production mint's storage (this is
// the SUPERVISED lane's own manifest, kept structurally apart from mint/'s Neon/R2 doors so a dress
// rehearsal can never collide with a real mint record - see mint-gate.js's STUB_PERSIST doc for the
// matching discipline on the persistence side).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE_DIR = path.join(__dirname, '..', '.supervised-runs');

// safeRunId(runId) -> throws on anything that is not a safe single path-segment id (defence against path
// traversal via a hostile run_id - the same discipline tools/lib/safe-path.js applies elsewhere in this repo).
function safeRunId(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(runId)) {
    throw new Error('manifest-store: unsafe or missing run_id: ' + JSON.stringify(runId));
  }
  return runId;
}

// newRunId(site, now) -> a fresh, sortable, collision-resistant run id: <kebab-host>-<ISO-compact>-<rand6>.
function newRunId(site, now) {
  const clock = typeof now === 'function' ? now : Date.now;
  const host = String(site || 'site').replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'site';
  const ts = new Date(clock()).toISOString().replace(/[:.]/g, '').replace('T', '-').replace('Z', '');
  const rand = crypto.randomBytes(3).toString('hex');
  return host + '-' + ts + '-' + rand;
}

class ManifestStore {
  constructor(opts) {
    const o = opts || {};
    this.baseDir = o.baseDir || DEFAULT_BASE_DIR;
    this.now = typeof o.now === 'function' ? o.now : Date.now;
  }
  _pathFor(runId) {
    return path.join(this.baseDir, safeRunId(runId) + '.jsonl');
  }
  // append(runId, stage, data) -> the entry written (with its ts stamped). Creates baseDir on first use.
  // A JSON.stringify failure (e.g. a circular structure or a BigInt) throws LOUDLY here rather than
  // writing a truncated/corrupt line (Rule 4: fail closed, never a partial manifest entry).
  append(runId, stage, data) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const entry = Object.assign({ ts: new Date(this.now()).toISOString(), stage }, data || {});
    const line = JSON.stringify(entry);
    fs.appendFileSync(this._pathFor(runId), line + '\n', 'utf8');
    return entry;
  }
  // readAll(runId) -> the full ordered list of entries, or [] if the run has no manifest yet. A malformed
  // line (should never happen given append() always writes valid JSON) throws rather than being silently
  // skipped - a corrupt manifest is a fact worth stopping on, not hiding.
  readAll(runId) {
    const p = this._pathFor(runId);
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, 'utf8');
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  // entriesOfStage(runId, stage) -> readAll() filtered to one stage name.
  entriesOfStage(runId, stage) {
    return this.readAll(runId).filter((e) => e.stage === stage);
  }
  exists(runId) {
    return fs.existsSync(this._pathFor(runId));
  }
}

module.exports = { ManifestStore, newRunId, safeRunId, DEFAULT_BASE_DIR };
