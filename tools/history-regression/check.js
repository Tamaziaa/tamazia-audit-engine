#!/usr/bin/env node
'use strict';
/**
 * HISTORY-REGRESSION: every historical failure class must name a live guarding gate, forever.
 *
 * The old estate died of the same ~256 defects, 6 corroborated ACT facts and 5 engine-semantic
 * domain-gate classes over and over. docs/failure-ledger/crossref.json maps each to a failure
 * class and the ONE file in THIS repo that catches its class. This checker reads that ledger and
 * makes "a historical failure class with no live guarding gate" a CI-visible state that cannot be
 * quietly forgotten.
 *
 * WHAT FAILS THE BUILD (exit 1):
 *   1. no-gate-named       a class whose catching_gate is empty or the literal "MISSING".
 *                          Nobody has even named the gate that must exist. This is the pure
 *                          "catching_gate MISSING" case from the spec.
 *   2. guarded-gate-missing a class marked status=guarded whose catching_gate file does NOT exist
 *                          in the tree. A guarded class is CLAIMING live protection; if the file
 *                          is gone, the claim is a lie (a deleted gate, a typo'd path, a false
 *                          "we cover this"). This is the "names a file that does not exist" case,
 *                          scoped to the classes that assert they are protected.
 *   3. gap-no-phase        a class marked status=gap with no phase (P0..P9) that closes it. A gap
 *                          with no committed phase is an unowned hole, not a plan.
 *   4. gap-gate-landed     a class marked status=gap whose planned catching_gate NOW EXISTS. The
 *                          gate arrived; the ledger must be flipped to guarded (and the crossref
 *                          rebuilt) so the ledger never understates live coverage.
 *   5. bad-status / unknown-class / defect-class-mismatch  structural integrity of the ledger.
 *
 * WHAT IS REPORTED BUT DOES NOT FAIL (the honest deferred state, Constitution Rule 4 phasing):
 *   a class marked status=gap whose planned catching_gate does not exist YET, and which carries a
 *   valid future phase. These are the genuinely-unguardable-until-Pn classes (render truth-pack,
 *   the mint pipeline, the LLM chain). They are printed loudly and counted every single run, so
 *   the gap is impossible to forget, but they do not turn CI permanently red at P0 - a red build
 *   nobody can make green is theatre (caution.md C-163). The GAPS.md file ranks them for the
 *   phases that must close them.
 *
 * This split is deliberate and matches the task's honesty rule: do not force-fit a class to a live
 * gate it is not actually policed by; mark it gap with the phase, and let this checker keep the
 * hole visible until the phase lands (at which point rule 4 forces the ledger to catch up).
 *
 * Modes (the tools/lib/gate-cli.js dialect; see tools/swallow-gate/check.js for the same contract):
 *   node tools/history-regression/check.js                 validate the committed crossref, exit 1
 *                                                          on any integrity violation
 *   node tools/history-regression/check.js --calibrate     validate the seeded broken fixture
 *                                                          (tools/history-regression/fixtures/) and
 *                                                          REQUIRE the fabricated missing gate is
 *                                                          caught; zero violations found = exit 1
 *   node tools/history-regression/check.js --json <path>   also write findings JSON for the sweep
 */
const fs = require('fs');
const path = require('path');

const { parseGateArgs, ROOT } = require('../lib/gate-cli');

const NAME = 'history-regression';
const CROSSREF = path.join(ROOT, 'docs', 'failure-ledger', 'crossref.json');
const FIXTURE = path.join(__dirname, 'fixtures', 'crossref.broken.json');
const PHASE_RX = /^P[0-9]$/;

// gateExists is injected so the calibration fixture can name gates that "exist" or "do not exist"
// deterministically without touching the real filesystem: by default it stats the real repo tree.
function realGateExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// validate(doc, gateExists) -> { violations, guarded, gap, deferred }
// Pure over its inputs (Constitution: pure functions over explicit inputs). Never reads argv,
// never exits; the CLI wrapper decides exit codes.
function validate(doc, gateExists) {
  const violations = [];
  const taxonomy = Array.isArray(doc && doc.taxonomy) ? doc.taxonomy : null;
  if (!taxonomy) {
    violations.push({ class: '(document)', kind: 'no-taxonomy', detail: 'crossref.json has no taxonomy array; nothing can be validated.' });
    return { violations, guarded: 0, gap: 0, deferred: [] };
  }

  const known = new Set(taxonomy.map((t) => t && t.class));
  const byClass = new Map(taxonomy.map((t) => [t && t.class, t]));
  let guarded = 0;
  let gap = 0;
  const deferred = []; // gap classes correctly awaiting a future phase (reported, not failed)

  for (const t of taxonomy) {
    const cls = t && t.class ? String(t.class) : '(unnamed)';
    const gate = t && typeof t.catching_gate === 'string' ? t.catching_gate.trim() : '';

    // rule 1: a class must NAME a gate.
    if (!gate || gate === 'MISSING') {
      violations.push({ class: cls, kind: 'no-gate-named', detail: 'catching_gate is empty or "MISSING": no gate has been named for this historical failure class.' });
      continue;
    }

    if (t.status === 'guarded') {
      guarded++;
      // rule 2: a guarded class must point at a file that exists.
      if (!gateExists(gate)) {
        violations.push({ class: cls, kind: 'guarded-gate-missing', detail: 'status=guarded but catching_gate "' + gate + '" does not exist. A class claiming live protection must point at a real file; a deleted or mistyped gate is a false claim of coverage.' });
      }
    } else if (t.status === 'gap') {
      gap++;
      // rule 3: a gap must carry a phase that closes it.
      if (!t.phase || !PHASE_RX.test(String(t.phase))) {
        violations.push({ class: cls, kind: 'gap-no-phase', detail: 'status=gap with no valid phase (expected P0..P9). A gap with no committed phase is an unowned hole, not a plan.' });
      } else if (gateExists(gate)) {
        // rule 4: the planned gate has landed; the ledger must be flipped to guarded.
        violations.push({ class: cls, kind: 'gap-gate-landed', detail: 'status=gap but its planned catching_gate "' + gate + '" now EXISTS. Flip this class to guarded and rebuild the crossref (npm run history:build) so the ledger does not understate live coverage.' });
      } else {
        deferred.push({ class: cls, phase: String(t.phase), gate, past_severity: t.past_severity || '?' });
      }
    } else {
      // rule 5a: status must be one of the two known values.
      violations.push({ class: cls, kind: 'bad-status', detail: 'status must be "guarded" or "gap"; got "' + String(t.status) + '".' });
    }
  }

  // rule 5b: every defect must reference a known class with a consistent gate + status.
  const defects = Array.isArray(doc.defects) ? doc.defects : [];
  for (const d of defects) {
    if (!known.has(d.class)) {
      violations.push({ class: String(d.class), kind: 'unknown-class', detail: 'defect ' + (d.id || '?') + ' is tagged with class "' + d.class + '" which has no taxonomy row.' });
      continue;
    }
    const t = byClass.get(d.class);
    if (d.catching_gate !== t.catching_gate || d.status !== t.status) {
      violations.push({ class: String(d.class), kind: 'defect-class-mismatch', detail: 'defect ' + (d.id || '?') + ' carries catching_gate/status that disagree with its class row (one door per class).' });
    }
  }

  return { violations, guarded, gap, deferred };
}

// Self-test: prove, in memory, that validate() can see each violation kind it exists to catch.
// A checker that cannot see its own disease reports every clean run unearned (caution.md C-149).
function selfTest() {
  const exists = (rel) => rel === 'live/gate.js'; // only this one "exists" in the fake tree
  const cases = [
    {
      name: 'guarded gate present -> clean',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [] },
      wantKinds: [],
    },
    {
      name: 'guarded gate missing -> guarded-gate-missing',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'ghost/gate.js', status: 'guarded' }], defects: [] },
      wantKinds: ['guarded-gate-missing'],
    },
    {
      name: 'MISSING literal -> no-gate-named',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'MISSING', status: 'guarded' }], defects: [] },
      wantKinds: ['no-gate-named'],
    },
    {
      name: 'gap with phase, gate absent -> clean (deferred)',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'planned/gate.js', status: 'gap', phase: 'P3' }], defects: [] },
      wantKinds: [],
    },
    {
      name: 'gap with no phase -> gap-no-phase',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'planned/gate.js', status: 'gap' }], defects: [] },
      wantKinds: ['gap-no-phase'],
    },
    {
      name: 'gap whose gate has landed -> gap-gate-landed',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'gap', phase: 'P3' }], defects: [] },
      wantKinds: ['gap-gate-landed'],
    },
    {
      name: 'defect referencing unknown class -> unknown-class',
      doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [{ id: 'X', class: 'b', catching_gate: 'live/gate.js', status: 'guarded' }] },
      wantKinds: ['unknown-class'],
    },
  ];
  const fails = [];
  for (const c of cases) {
    const got = validate(c.doc, exists).violations.map((v) => v.kind).sort();
    const want = c.wantKinds.slice().sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(c.name + ': want [' + want + '] got [' + got + ']');
  }
  return { pass: fails.length === 0, detail: fails.join('; ') || 'all ' + cases.length + ' cases correct' };
}

function toFindings(violations) {
  return violations.map((v) => ({
    tool: NAME,
    ruleId: 'history-regression:' + v.kind,
    file: 'docs/failure-ledger/crossref.json',
    startLine: 1,
    endLine: 1,
    level: 'error',
    message: '[' + v.class + '] ' + v.detail,
  }));
}

function loadDoc(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const { calibrate, writeJson } = parseGateArgs(process.argv);

  const st = selfTest();
  if (!st.pass) {
    console.error(NAME + ' SELF-TEST FAILED: ' + st.detail);
    console.error('The checker cannot see the class it exists to catch. Every clean run it reports is unearned.');
    process.exit(2);
  }

  if (calibrate) {
    if (!fs.existsSync(FIXTURE)) {
      console.error(NAME + ' CALIBRATION FAILED: ' + path.relative(ROOT, FIXTURE) + ' does not exist. There is nothing to earn a zero against.');
      process.exit(1);
    }
    const res = validate(loadDoc(FIXTURE), realGateExists);
    writeJson(toFindings(res.violations));
    console.log('  ' + NAME + ' calibration: ' + res.violations.length + ' seeded violation(s) caught in the broken fixture');
    for (const v of res.violations) console.log('    CAUGHT [' + v.kind + '] ' + v.class + ': ' + v.detail);
    if (res.violations.length === 0) {
      console.error(NAME + ' CALIBRATION FAILED: the fixture seeds a fabricated missing gate but the checker found nothing. The seeded bad input escaped.');
      process.exit(1);
    }
    process.exit(0);
  }

  if (!fs.existsSync(CROSSREF)) {
    console.error(NAME + ': ' + path.relative(ROOT, CROSSREF) + ' does not exist. Build it with `npm run history:build`.');
    process.exit(1);
  }
  const res = validate(loadDoc(CROSSREF), realGateExists);
  writeJson(toFindings(res.violations));

  console.log('  ' + NAME + ': ' + res.guarded + ' guarded classes, ' + res.gap + ' gap classes, ' + res.violations.length + ' integrity violation(s) (self-test: earned)');
  if (res.deferred.length) {
    console.log('  ' + res.deferred.length + ' historical failure class(es) NOT YET GUARDED (visible by design, phase-owned):');
    for (const g of res.deferred.slice().sort((a, b) => a.phase.localeCompare(b.phase))) {
      console.log('    GAP  [' + g.phase + '] ' + g.class.padEnd(26) + ' -> ' + g.gate + '  (past severity ' + g.past_severity + ')');
    }
  }
  for (const v of res.violations) console.error('  VIOLATION [' + v.kind + '] ' + v.class + ': ' + v.detail);
  process.exit(res.violations.length > 0 ? 1 : 0);
}

if (require.main === module) main();
module.exports = { validate, selfTest, toFindings, realGateExists };
