#!/usr/bin/env node
'use strict';
/**
 * FACT-LINEAGE: single producer asserted in CI; the renderer introduces no facts.
 *
 * Reads payload/schema/facts-lineage.json, the declared lineage of every fact that reaches a client:
 *
 *   {
 *     "facts": {
 *       "<fact-id>": {
 *         "producer": "facts/jurisdiction.js",        one module, one door
 *         "consumers": ["payload/composer/...", ...]  optional, informational
 *       }
 *     }
 *   }
 *
 * Checks, when the manifest exists:
 *   1. every fact declares exactly ONE producer (a string, not a list)
 *   2. the producer file exists in the repo (a lineage pointing at a ghost is a lie)
 *   3. no two facts share an id (JSON.parse already guarantees this; kept for the array form)
 *   4. cross-check against tools/one-door/facts.json: every fact declared there must appear here with the
 *      same door, once the manifest exists
 *
 * The manifest does not exist yet in P0. Absence is a WARNING and exit 0: this checker must run green on
 * the near-empty repo today, and the payload schema owner will land the manifest in P4. The moment the file
 * exists, every check above becomes blocking.
 *
 * Modes:
 *   node tools/fact-lineage/check.js                  check, exit 1 on violations (exit 0 + WARNING if absent)
 *   node tools/fact-lineage/check.js --json <path>    also write findings JSON for the sweep normaliser
 */
const fs = require('fs');
const path = require('path');

const { parseGateArgs, ROOT } = require('../lib/gate-cli');
const safePath = require('../lib/safe-path');

const MANIFEST = path.join(ROOT, 'payload', 'schema', 'facts-lineage.json');
const ONE_DOOR_FACTS = path.join(ROOT, 'tools', 'one-door', 'facts.json');

function loadManifest(p) {
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Accept both the object form {facts: {id: {...}}} and an array form [{id, producer, ...}].
  if (Array.isArray(doc.facts)) {
    const map = {};
    for (const f of doc.facts) {
      if (map[f.id]) throw new Error('duplicate fact id in lineage manifest: ' + f.id);
      map[f.id] = f;
    }
    return map;
  }
  if (doc.facts && typeof doc.facts === 'object') return doc.facts;
  throw new Error('facts-lineage.json has no facts key (object or array expected)');
}

function check(manifestPath) {
  const violations = [];
  const facts = loadManifest(manifestPath);
  const ids = Object.keys(facts);
  if (ids.length === 0) violations.push({ fact: '(none)', message: 'lineage manifest exists but declares zero facts: an empty manifest is a confident zero' });

  for (const id of ids) {
    const f = facts[id];
    const producer = f.producer;
    if (typeof producer !== 'string' || producer.length === 0) {
      violations.push({ fact: id, message: 'fact must declare exactly ONE producer as a string; got ' + JSON.stringify(producer) });
      continue;
    }
    if (Array.isArray(f.producers) || /,/.test(producer)) {
      violations.push({ fact: id, message: 'more than one producer declared: that is two doors by construction' });
    }
    // producer is a repo-relative path read from a committed manifest (payload/schema/
    // facts-lineage.json), not network input, but it must still stay inside the repo tree: an
    // absolute path or a ".." escape is rejected as its own violation rather than silently
    // resolved outside the tree the lineage is meant to describe.
    if (!safePath.isSafeRelativePath(producer)) {
      violations.push({ fact: id, message: 'declared producer is not a safe in-repo relative path: ' + JSON.stringify(producer) });
      continue;
    }
    const abs = safePath.resolveSafeRelativePath(ROOT, producer, { label: 'fact-lineage producer' });
    if (!fs.existsSync(abs)) {
      violations.push({ fact: id, message: 'declared producer does not exist: ' + producer + ' (a lineage pointing at a ghost is a lie)' });
    }
  }

  // Cross-check against the one-door manifest: the two declarations must agree.
  if (fs.existsSync(ONE_DOOR_FACTS)) {
    const od = JSON.parse(fs.readFileSync(ONE_DOOR_FACTS, 'utf8'));
    for (const f of od.facts || []) {
      const here = facts[f.id];
      if (!here) {
        violations.push({ fact: f.id, message: 'declared in tools/one-door/facts.json but missing from the lineage manifest' });
        continue;
      }
      const allowed = f.allowed_producers || [];
      const ok = allowed.some((a) => (a.endsWith('/') ? String(here.producer).startsWith(a) : here.producer === a));
      if (!ok) violations.push({ fact: f.id, message: 'lineage producer ' + here.producer + ' disagrees with one-door allowed door ' + allowed.join(', ') });
    }
  }
  return { violations, declared: ids.length };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: 'fact-lineage',
    ruleId: 'lineage:' + v.fact,
    file: 'payload/schema/facts-lineage.json',
    startLine: 0,
    endLine: 0,
    level: 'error',
    message: '[' + v.fact + '] ' + v.message,
    snippet: v.fact,
  }));
}

function main() {
  const { writeJson } = parseGateArgs(process.argv);

  if (!fs.existsSync(MANIFEST)) {
    console.log('  fact-lineage: WARNING: payload/schema/facts-lineage.json does not exist yet (expected in P0; the payload schema owner lands it in P4). 0 facts checked. This becomes blocking the moment the file exists.');
    writeJson([]);
    process.exit(0);
  }

  const { violations, declared } = check(MANIFEST);
  writeJson(toFindings(violations));
  console.log('  fact-lineage: ' + declared + ' facts declared, ' + violations.length + ' violations');
  for (const v of violations) console.error('  LINEAGE [' + v.fact + '] ' + v.message);
  process.exit(violations.length > 0 ? 1 : 0);
}

if (require.main === module) main();
module.exports = { check, loadManifest, toFindings };
