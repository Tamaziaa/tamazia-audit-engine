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
const safePath = require('../lib/safe-path.js');

const NAME = 'history-regression';
const CROSSREF = path.join(ROOT, 'docs', 'failure-ledger', 'crossref.json');
const FIXTURE = path.join(__dirname, 'fixtures', 'crossref.broken.json');
const PHASE_RX = /^P[0-9]$/;

// gateExists is injected so the calibration fixture can name gates that "exist" or "do not exist"
// deterministically without touching the real filesystem: by default it stats the real repo tree.
// A catching_gate must be a repo-relative path INSIDE the tree: an absolute path or a "../.." escape
// is rejected before the existence check, so a class can never satisfy a guarded claim by pointing
// at an unrelated host file outside the repo (Rule: hosts/paths are validated, never trusted raw).
function realGateExists(rel) {
  // isSafeRelativePath is the non-throwing boolean form of the single path door: an absolute path or
  // a "../.." escape is rejected here (returns false), so a class can never satisfy a guarded claim by
  // pointing at a host file outside the repo.
  if (!safePath.isSafeRelativePath(rel)) return false;
  // A gate must be a real REGULAR FILE inside the repo: existsSync is true for a directory, and
  // statSync FOLLOWS symlinks, so a repo-local link pointing at an external file would still count
  // (CR round-5). lstatSync stats the entry ITSELF - a symlink's lstat is never isFile(), so only a
  // genuine in-tree regular file satisfies the claim. throwIfNoEntry:false makes a MISSING path
  // return undefined (fail closed) with no swallowing catch to justify. resolveSafeRelativePath
  // re-asserts (already known true above) and performs the actual resolve inside the shared door.
  const abs = safePath.resolveSafeRelativePath(ROOT, rel, { label: 'history-regression catching_gate' });
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  return Boolean(st) && st.isFile();
}

// validateClassIdentifiers(taxonomy) -> violations[] for missing/duplicate class ids. Run BEFORE the
// known/byClass Set+Map are built: those collapse duplicate keys silently, so two conflicting rows
// for one class would both validate while defects bind only to the last (one door per class). The
// normalisation (String, trimmed) matches the per-row cls value used elsewhere.
function validateClassIdentifiers(taxonomy) {
  const violations = [];
  const seen = new Set();
  for (const t of taxonomy) {
    const raw = t && t.class;
    const cls = typeof raw === 'string' ? raw.trim() : '';
    if (!cls) {
      violations.push({ class: '(unnamed)', kind: 'no-class', detail: 'a taxonomy row has a missing or empty class identifier; every row must name exactly one class.' });
      continue;
    }
    if (seen.has(cls)) {
      violations.push({ class: cls, kind: 'duplicate-class', detail: 'class "' + cls + '" appears in more than one taxonomy row; class identifiers must be unique (one door per class), or a conflicting row is silently dropped by the lookup map.' });
    }
    seen.add(cls);
  }
  return violations;
}

// classifyGuardedRow / classifyGapRow / validateTaxonomyRow -> the per-row rule engine, each owning
// one nesting-inducing branch so no single function exceeds the health caps.
function classifyGuardedRow(cls, gate, gateExists) {
  if (gateExists(gate)) return null; // rule 2 satisfied
  return { class: cls, kind: 'guarded-gate-missing', detail: 'status=guarded but catching_gate "' + gate + '" does not exist. A class claiming live protection must point at a real file; a deleted or mistyped gate is a false claim of coverage.' };
}

// classifyGapRow(row, gateExists, deferred) where row = { cls, gate, t }. Bundled into one row object
// so the signature stays within the argument cap (CR round-4: <=4 formal parameters).
function classifyGapRow(row, gateExists, deferred) {
  const { cls, gate, t } = row;
  // rule 3: a gap must carry a phase that closes it.
  if (!t.phase || !PHASE_RX.test(String(t.phase))) {
    return { class: cls, kind: 'gap-no-phase', detail: 'status=gap with no valid phase (expected P0..P9). A gap with no committed phase is an unowned hole, not a plan.' };
  }
  // rule 4: the planned gate has landed; the ledger must be flipped to guarded.
  if (gateExists(gate)) {
    return { class: cls, kind: 'gap-gate-landed', detail: 'status=gap but its planned catching_gate "' + gate + '" now EXISTS. Flip this class to guarded and rebuild the crossref (npm run history:build) so the ledger does not understate live coverage.' };
  }
  deferred.push({ class: cls, phase: String(t.phase), gate, past_severity: t.past_severity || '?' });
  return null;
}

// rowClassAndGate(t) -> the normalised { cls, gate } for one taxonomy row: a trimmed class id (or
// "(unnamed)") and a trimmed catching_gate string (or ""). Factored out so validateTaxonomyRow stays
// a thin dispatcher under the complexity cap.
function rowClassAndGate(t) {
  const cls = t && t.class ? String(t.class) : '(unnamed)';
  const gate = t && typeof t.catching_gate === 'string' ? t.catching_gate.trim() : '';
  return { cls, gate };
}

// validateTaxonomyRow(t, gateExists, counters, deferred) -> a violation object or null, incrementing
// counters.guarded / counters.gap as it classifies one row (rules 1, 2, 3, 4, 5a).
function validateTaxonomyRow(t, gateExists, counters, deferred) {
  const { cls, gate } = rowClassAndGate(t);
  if (!gate || gate === 'MISSING') {
    return { class: cls, kind: 'no-gate-named', detail: 'catching_gate is empty or "MISSING": no gate has been named for this historical failure class.' };
  }
  if (t.status === 'guarded') { counters.guarded++; return classifyGuardedRow(cls, gate, gateExists); }
  if (t.status === 'gap') { counters.gap++; return classifyGapRow({ cls, gate, t }, gateExists, deferred); }
  return { class: cls, kind: 'bad-status', detail: 'status must be "guarded" or "gap"; got "' + String(t.status) + '".' };
}

// validateDefects(defects, known, byClass) -> violations[] (rule 5b): every defect references a known
// class with a consistent gate + status (one door per class).
function validateDefects(defects, known, byClass) {
  const violations = [];
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
  return violations;
}

// indexTaxonomy(taxonomy) -> { known, byClass }: the Set of class ids and the class->row Map the defect
// validation reads. Built after validateClassIdentifiers has already flagged duplicates, so the silent
// last-wins collapse of these structures is never load-bearing.
function indexTaxonomy(taxonomy) {
  const known = new Set(taxonomy.map((t) => t && t.class));
  const byClass = new Map(taxonomy.map((t) => [t && t.class, t]));
  return { known, byClass };
}

// validate(doc, gateExists) -> { violations, guarded, gap, deferred }
// Pure over its inputs (Constitution: pure functions over explicit inputs). Never reads argv,
// never exits; the CLI wrapper decides exit codes.
function validate(doc, gateExists) {
  const taxonomy = Array.isArray(doc && doc.taxonomy) ? doc.taxonomy : null;
  if (!taxonomy) {
    return { violations: [{ class: '(document)', kind: 'no-taxonomy', detail: 'crossref.json has no taxonomy array; nothing can be validated.' }], guarded: 0, gap: 0, deferred: [] };
  }

  const violations = validateClassIdentifiers(taxonomy);
  const { known, byClass } = indexTaxonomy(taxonomy);
  const counters = { guarded: 0, gap: 0 };
  const deferred = []; // gap classes correctly awaiting a future phase (reported, not failed)

  for (const t of taxonomy) {
    const v = validateTaxonomyRow(t, gateExists, counters, deferred);
    if (v) violations.push(v);
  }
  violations.push(...validateDefects(Array.isArray(doc.defects) ? doc.defects : [], known, byClass));

  return { violations, guarded: counters.guarded, gap: counters.gap, deferred };
}

// SELF_TEST_CASES: one document per violation kind (plus two clean controls), each asserting the
// EXACT set of kinds validate() must emit - a partially broken checker cannot pass by tripping on
// some unrelated violation (caution.md C-149; hoisted to module scope so selfTest stays a thin loop
// under the health caps). exists() treats only 'live/gate.js' as present in the fake tree.
const SELF_TEST_GATE_EXISTS = (rel) => rel === 'live/gate.js';
const SELF_TEST_CASES = [
  { name: 'guarded gate present -> clean', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [] }, wantKinds: [] },
  { name: 'guarded gate missing -> guarded-gate-missing', doc: { taxonomy: [{ class: 'a', catching_gate: 'ghost/gate.js', status: 'guarded' }], defects: [] }, wantKinds: ['guarded-gate-missing'] },
  { name: 'MISSING literal -> no-gate-named', doc: { taxonomy: [{ class: 'a', catching_gate: 'MISSING', status: 'guarded' }], defects: [] }, wantKinds: ['no-gate-named'] },
  { name: 'gap with phase, gate absent -> clean (deferred)', doc: { taxonomy: [{ class: 'a', catching_gate: 'planned/gate.js', status: 'gap', phase: 'P3' }], defects: [] }, wantKinds: [] },
  { name: 'gap with no phase -> gap-no-phase', doc: { taxonomy: [{ class: 'a', catching_gate: 'planned/gate.js', status: 'gap' }], defects: [] }, wantKinds: ['gap-no-phase'] },
  { name: 'gap whose gate has landed -> gap-gate-landed', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'gap', phase: 'P3' }], defects: [] }, wantKinds: ['gap-gate-landed'] },
  { name: 'defect referencing unknown class -> unknown-class', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [{ id: 'X', class: 'b', catching_gate: 'live/gate.js', status: 'guarded' }] }, wantKinds: ['unknown-class'] },
  { name: 'no taxonomy array -> no-taxonomy', doc: { defects: [] }, wantKinds: ['no-taxonomy'] },
  { name: 'unknown status value -> bad-status', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'sometimes' }], defects: [] }, wantKinds: ['bad-status'] },
  { name: 'defect whose gate/status disagree with its class row -> defect-class-mismatch', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [{ id: 'X', class: 'a', catching_gate: 'other/gate.js', status: 'guarded' }] }, wantKinds: ['defect-class-mismatch'] },
  { name: 'taxonomy row with no class identifier -> no-class', doc: { taxonomy: [{ catching_gate: 'live/gate.js', status: 'guarded' }], defects: [] }, wantKinds: ['no-class'] },
  { name: 'two taxonomy rows sharing a class id -> duplicate-class', doc: { taxonomy: [{ class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }, { class: 'a', catching_gate: 'live/gate.js', status: 'guarded' }], defects: [] }, wantKinds: ['duplicate-class'] },
];

// Self-test: prove, in memory, that validate() can see each violation kind it exists to catch.
// A checker that cannot see its own disease reports every clean run unearned (caution.md C-149).
function selfTest() {
  const exists = SELF_TEST_GATE_EXISTS;
  const cases = SELF_TEST_CASES;
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

// abortIfSelfTestFails() -> run the in-memory self-test and exit 2 (a broken tool) if the checker
// cannot see the class it exists to catch. Every clean run after a failed self-test is unearned.
function abortIfSelfTestFails() {
  const st = selfTest();
  if (st.pass) return;
  console.error(NAME + ' SELF-TEST FAILED: ' + st.detail);
  console.error('The checker cannot see the class it exists to catch. Every clean run it reports is unearned.');
  process.exit(2);
}

// runCalibration(writeJson) -> --calibrate: validate the seeded broken fixture and REQUIRE it trips
// exactly the planted defect (guarded-gate-missing) and only that. Never returns (always exits).
function runCalibration(writeJson) {
  if (!fs.existsSync(FIXTURE)) {
    console.error(NAME + ' CALIBRATION FAILED: ' + path.relative(ROOT, FIXTURE) + ' does not exist. There is nothing to earn a zero against.');
    process.exit(1);
  }
  const res = validate(loadDoc(FIXTURE), realGateExists);
  writeJson(toFindings(res.violations));
  const kinds = res.violations.map((v) => v.kind).sort();
  // The fixture seeds EXACTLY one planted defect: a status=guarded class pointing at a gate file
  // that does not exist (guarded-gate-missing), plus a control clean class. Assert the checker
  // catches precisely that kind - "any violation > 0" would let a partially-broken checker earn a
  // green by tripping on some unrelated defect while missing the seeded one (CR).
  const WANT = ['guarded-gate-missing'];
  console.log('  ' + NAME + ' calibration: ' + res.violations.length + ' seeded violation(s) caught in the broken fixture');
  for (const v of res.violations) console.log('    CAUGHT [' + v.kind + '] ' + v.class + ': ' + v.detail);
  if (JSON.stringify(kinds) !== JSON.stringify(WANT)) {
    console.error(NAME + ' CALIBRATION FAILED: expected exactly [' + WANT.join(', ') + '] on the seeded fixture, got [' + kinds.join(', ') + ']. The fixture must trip its planted defect and only that.');
    process.exit(1);
  }
  process.exit(0);
}

// printDeferred(deferred) -> the honest phase-owned gap report: historical classes not yet guarded,
// printed loudly every run (they are visible by design, never a silent hole) but not a failure.
function printDeferred(deferred) {
  if (!deferred.length) return;
  console.log('  ' + deferred.length + ' historical failure class(es) NOT YET GUARDED (visible by design, phase-owned):');
  for (const g of deferred.slice().sort((a, b) => a.phase.localeCompare(b.phase))) {
    console.log('    GAP  [' + g.phase + '] ' + g.class.padEnd(26) + ' -> ' + g.gate + '  (past severity ' + g.past_severity + ')');
  }
}

// runValidation(writeJson) -> the normal run: validate the committed crossref, report guarded/gap
// counts and any integrity violations, and exit 1 if any violation exists. Never returns.
function runValidation(writeJson) {
  if (!fs.existsSync(CROSSREF)) {
    console.error(NAME + ': ' + path.relative(ROOT, CROSSREF) + ' does not exist. Build it with `npm run history:build`.');
    process.exit(1);
  }
  const res = validate(loadDoc(CROSSREF), realGateExists);
  writeJson(toFindings(res.violations));

  console.log('  ' + NAME + ': ' + res.guarded + ' guarded classes, ' + res.gap + ' gap classes, ' + res.violations.length + ' integrity violation(s) (self-test: earned)');
  printDeferred(res.deferred);
  for (const v of res.violations) console.error('  VIOLATION [' + v.kind + '] ' + v.class + ': ' + v.detail);
  process.exit(res.violations.length > 0 ? 1 : 0);
}

function main() {
  const { calibrate, writeJson } = parseGateArgs(process.argv);
  abortIfSelfTestFails();
  if (calibrate) return runCalibration(writeJson);
  return runValidation(writeJson);
}

if (require.main === module) main();
module.exports = { validate, selfTest, toFindings, realGateExists };
