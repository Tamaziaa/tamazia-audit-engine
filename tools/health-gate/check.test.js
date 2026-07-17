'use strict';
// tools/health-gate/check.test.js - node:test suite for the complexity-caps gate (caution.md C-163:
// "a gate that cannot fire is theatre"). Run: node --test tools/health-gate/check.js
//
// Runs the whole suite against BOTH engines (acorn and the heuristic fallback) via HEALTH_GATE_ENGINE,
// the same discipline tools/swallow-gate/check.js uses for SWALLOW_GATE_ENGINE=regex: a fallback that
// is never exercised in CI is a fallback that silently rots.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const { CALIBRATE_DIR } = require('../lib/gate-cli');

// Load a fresh copy of the gate under a forced engine: require.cache must be cleared for both
// check.js and heuristic.js so the `let acorn = ...` module-level decision re-runs.
function loadGate(engine) {
  const checkPath = require.resolve('./check.js');
  const heuristicPath = require.resolve('./heuristic.js');
  delete require.cache[checkPath];
  delete require.cache[heuristicPath];
  const prev = process.env.HEALTH_GATE_ENGINE;
  if (engine) process.env.HEALTH_GATE_ENGINE = engine;
  else delete process.env.HEALTH_GATE_ENGINE;
  const gate = require('./check.js');
  if (prev === undefined) delete process.env.HEALTH_GATE_ENGINE;
  else process.env.HEALTH_GATE_ENGINE = prev;
  return gate;
}

for (const engine of ['acorn', 'heuristic']) {
  test(`[${engine}] selfTest passes`, () => {
    const gate = loadGate(engine);
    const st = gate.selfTest();
    assert.equal(st.pass, true, st.detail);
  });

  test(`[${engine}] scanContent: a long function trips the long-function cap only`, () => {
    const gate = loadGate(engine);
    const lines = Array.from({ length: 62 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const src = `function longOne(a) {\n${lines}\n  return a;\n}\n`;
    const r = gate.scanContent('f.js', src);
    assert.ok(r.violations.some((v) => v.kind === 'long-function'));
    assert.ok(!r.violations.some((v) => v.kind === 'deep-nesting'));
    assert.ok(!r.violations.some((v) => v.kind === 'high-branching'));
    assert.ok(!r.violations.some((v) => v.kind === 'too-many-params'));
  });

  test(`[${engine}] scanContent: nesting exactly at the cap (4) is clean; one level deeper (5) is not`, () => {
    const gate = loadGate(engine);
    const four = 'function f4(a) { if (a) { if (a) { if (a) { if (a) { x(); } } } } }\n';
    const five = 'function f5(a) { if (a) { if (a) { if (a) { if (a) { if (a) { x(); } } } } } }\n';
    assert.deepEqual(gate.scanContent('four.js', four).violations.filter((v) => v.kind === 'deep-nesting'), []);
    assert.ok(gate.scanContent('five.js', five).violations.some((v) => v.kind === 'deep-nesting'));
  });

  test(`[${engine}] scanContent: an "else if" chain does not itself deepen nesting (sibling branches, not nested ones)`, () => {
    const gate = loadGate(engine);
    const src = 'function chain(a) {\n'
      + '  if (a === 1) { x(); }\n'
      + '  else if (a === 2) { x(); }\n'
      + '  else if (a === 3) { x(); }\n'
      + '  else if (a === 4) { x(); }\n'
      + '  else if (a === 5) { x(); }\n'
      + '  else { x(); }\n'
      + '}\n';
    const r = gate.scanContent('chain.js', src);
    assert.deepEqual(r.violations.filter((v) => v.kind === 'deep-nesting'), []);
  });

  test(`[${engine}] scanContent: exactly 12 decision points is clean; 13 is not`, () => {
    const gate = loadGate(engine);
    const twelve = 'function d12(a) {\n' + Array.from({ length: 12 }, (_, i) => `  if (a${i}) { y(); }`).join('\n') + '\n}\n';
    const thirteen = 'function d13(a) {\n' + Array.from({ length: 13 }, (_, i) => `  if (a${i}) { y(); }`).join('\n') + '\n}\n';
    assert.deepEqual(gate.scanContent('t12.js', twelve).violations.filter((v) => v.kind === 'high-branching'), []);
    assert.ok(gate.scanContent('t13.js', thirteen).violations.some((v) => v.kind === 'high-branching'));
  });

  test(`[${engine}] scanContent: 5 parameters is clean; 6 is not`, () => {
    const gate = loadGate(engine);
    const five = 'function p5(a, b, c, d, e) { return a; }\n';
    const six = 'function p6(a, b, c, d, e, f) { return a; }\n';
    assert.deepEqual(gate.scanContent('p5.js', five).violations, []);
    assert.ok(gate.scanContent('p6.js', six).violations.some((v) => v.kind === 'too-many-params'));
  });

  test(`[${engine}] scanContent: file length over 500 lines flags large-file independent of function shape`, () => {
    const gate = loadGate(engine);
    const src = Array.from({ length: 501 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
    const r = gate.scanContent('big.js', src);
    assert.ok(r.violations.some((v) => v.kind === 'large-file'));
  });

  test(`[${engine}] scanContent: an arrow function assigned to a const is measured and named from its declarator`, () => {
    const gate = loadGate(engine);
    const body = Array.from({ length: 62 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const src = `const myHandler = (a, b) => {\n${body}\n  return a + b;\n};\n`;
    const r = gate.scanContent('arrow.js', src);
    const hit = r.violations.find((v) => v.kind === 'long-function');
    assert.ok(hit, JSON.stringify(r.violations));
    if (engine === 'acorn') assert.equal(hit.name, 'myHandler');
  });

  test(`[${engine}] scanContent: a clean file with ordinary short functions produces zero violations`, () => {
    const gate = loadGate(engine);
    const src = 'function add(a, b) { return a + b; }\nconst double = (x) => x * 2;\n';
    assert.deepEqual(gate.scanContent('clean.js', src).violations, []);
  });

  test(`[${engine}] scan against eval/calibration-known-bad/fixtures catches the seeded p2-health-deep-nested-function.js on all four function-level caps`, () => {
    const gate = loadGate(engine);
    const res = gate.scanTree([CALIBRATE_DIR]);
    const hits = res.violations.filter((v) => v.file.includes('p2-health-deep-nested-function.js'));
    const kinds = new Set(hits.map((v) => v.kind));
    for (const k of ['long-function', 'deep-nesting', 'high-branching', 'too-many-params']) {
      assert.ok(kinds.has(k), `expected ${k} on the seeded fixture; got kinds: ${[...kinds].join(', ')}`);
    }
  });
}

// ── acorn-only structural tests: nested functions are independent units, never double-charged ──────────────

test('collectFunctions + scanContent (acorn): a nested inner function does not inflate the outer function\'s own decision/nesting count', () => {
  const gate = loadGate('acorn');
  const src = [
    'function outer(a) {',
    '  function inner(b) {',
    '    if (b) { if (b) { if (b) { if (b) { if (b) { z(); } } } } }', // 5 deep, but INSIDE inner
    '  }',
    '  if (a) { y(); }',
    '  return inner;',
    '}',
  ].join('\n');
  const r = gate.scanContent('nested.js', src);
  // inner is flagged for deep-nesting; outer is not (outer's own body only has one shallow if).
  const outerHit = r.violations.find((v) => v.name === 'outer' && v.kind === 'deep-nesting');
  const innerHit = r.violations.find((v) => v.name === 'inner' && v.kind === 'deep-nesting');
  assert.equal(outerHit, undefined, 'the outer function must not inherit the inner function\'s nesting depth');
  assert.ok(innerHit, 'the inner function itself must still be caught');
});

test('scanContent (acorn): a parse-unparseable file throws rather than silently reporting zero violations (Constitution Rule 4: fail closed)', () => {
  const gate = loadGate('acorn');
  assert.throws(() => gate.scanContent('broken.js', 'function ( { ) this is not javascript'));
});

// ── judgeFunction: pure unit coverage of the cap-comparison table ───────────────────────────────────────────

test('judgeFunction: a function sitting exactly on every cap produces zero violations (caps are ceilings, not exclusive bounds)', () => {
  const gate = loadGate('acorn');
  const fn = { name: 'onCap', line: 1, lines: 60, maxDepth: 4, decisions: 12, params: 5 };
  assert.deepEqual(gate.judgeFunction('f.js', fn), []);
});

test('judgeFunction: one unit over every cap produces all four violation kinds', () => {
  const gate = loadGate('acorn');
  const fn = { name: 'overCap', line: 1, lines: 61, maxDepth: 5, decisions: 13, params: 6 };
  const kinds = gate.judgeFunction('f.js', fn).map((v) => v.kind).sort();
  assert.deepEqual(kinds, ['deep-nesting', 'high-branching', 'long-function', 'too-many-params'].sort());
});

// ── scanTree: real directory walking, skip rules ────────────────────────────────────────────────────────────

test('scanTree: *.test.js files are never scanned (they are fixtures/tests, not builder-authored logic)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const gate = loadGate('acorn');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-gate-test-'));
  try {
    const longBody = Array.from({ length: 62 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    fs.writeFileSync(path.join(dir, 'thing.test.js'), `function longTest(a) {\n${longBody}\n  return a;\n}\n`);
    const r = gate.scanTree([dir]);
    assert.deepEqual(r.violations, []);
    assert.equal(r.scanned, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanTree: a "packs" or "fixtures" subdirectory is skipped by name (data directories, not builder logic)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const gate = loadGate('acorn');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-gate-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'packs'));
    const longBody = Array.from({ length: 62 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    fs.writeFileSync(path.join(dir, 'packs', 'data.js'), `function longInPack(a) {\n${longBody}\n  return a;\n}\n`);
    const r = gate.scanTree([dir]);
    assert.deepEqual(r.violations, []);
    assert.equal(r.scanned, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanTree: health-gate\'s OWN source tree (tools/health-gate/) is itself clean against all five caps (earn-your-zero applies to the gate too)', () => {
  const gate = loadGate('acorn');
  const r = gate.scanTree(['tools/health-gate']);
  assert.deepEqual(r.violations, [], 'tools/health-gate/check.js and heuristic.js must satisfy their own gate');
});

test('toFindings: shapes violations for the sweep normaliser with a stable ruleId prefix', () => {
  const gate = loadGate('acorn');
  const findings = gate.toFindings([{ file: 'f.js', line: 3, name: 'x', kind: 'long-function', message: 'msg' }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'health-gate/long-function');
  assert.equal(findings[0].tool, 'health-gate');
  assert.equal(findings[0].startLine, 3);
});
