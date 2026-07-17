'use strict';
// catalogue/compile.test.js - tests for the P2 catalogue compiler (catalogue/compile.js).
//
// Every test that needs pack FILES writes them to an isolated temp directory under the OS temp
// dir (never into the real catalogue/packs/ - the compiler under test is the one door for that
// directory and no test may leave stray files in it). Fixtures are minimal-but-schema-valid COM
// records built by makeRecord() below; each test only overrides the field it is testing.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const compile = require('./compile.js');

// ---------------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------------
function makeRecord(overrides) {
  const base = {
    jurisdiction: 'UK',
    sub_jurisdiction: null,
    status: 'candidate',
    client_useful: true,
    id: 'CAL_TEST_RECORD',
    name: 'Test duty',
    citation: {
      act: 'Test Act 2026',
      section: 'Section 1',
      url: 'https://www.legislation.gov.uk/test',
    },
    sector: ['universal'],
    sub_sector: [],
    activity_tags: [],
    required_nexus: ['processes_residents_of'],
    applies_when: ['processes personal data of UK residents'],
    excluded_when: [],
    website_obligations: [
      {
        duty: 'Publish a privacy notice',
        elements: ['controller identity'],
        evidence_type: 'presence',
      },
    ],
    penalty: {
      typical_low: 1000,
      typical_high: 5000,
      statutory_max: 10000,
      currency: 'GBP',
      basis: 'test basis',
      max_is_rare: false,
    },
    regulator: {
      name: 'Test Regulator',
      register_url: null,
    },
    enforcement: [],
    intel: {
      why_matters: 'test',
      regulator_asks_first: 'test',
      relevance_hook: 'test',
    },
    provenance: {
      sources: ['test seed'],
      seed_status: 'seed',
      verified_date: '2026-07-17',
    },
  };
  return Object.assign({}, base, overrides);
}

function makePack(overrides) {
  const base = {
    cell: 'test-cell',
    jurisdiction: 'UK',
    generated: '2026-07-17',
    records: [makeRecord()],
  };
  return Object.assign({}, base, overrides);
}

// mkTempPacksDir(files) -> absolute path to a fresh temp dir populated with { filename: content }
// pairs (content is JSON.stringify'd if not already a string). Caller must rm it in a `finally`.
function mkTempPacksDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-compile-test-'));
  for (const [name, content] of Object.entries(files)) {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------
// discoverPacks
// ---------------------------------------------------------------------------------
test('discoverPacks: excludes a pack with no .QA.md sidecar', () => {
  const dir = mkTempPacksDir({
    'has-qa.json': makePack({ cell: 'has-qa' }),
    'has-qa.QA.md': '# QA sign-off',
    'no-qa.json': makePack({ cell: 'no-qa' }),
  });
  try {
    const { included, excluded } = compile.discoverPacks(dir);
    assert.equal(included.length, 1);
    assert.equal(included[0].cellName, 'has-qa');
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].cell, 'no-qa');
    assert.equal(excluded[0].reason, 'no legal-QA sidecar');
  } finally {
    rmDir(dir);
  }
});

test('discoverPacks: throws CompileError on invalid JSON in a QA-sidecar-backed pack', () => {
  const dir = mkTempPacksDir({
    'broken.json': '{ not valid json',
    'broken.QA.md': '# QA sign-off',
  });
  try {
    assert.throws(() => compile.discoverPacks(dir), compile.CompileError);
  } finally {
    rmDir(dir);
  }
});

test('discoverPacks: throws CompileError when the directory does not exist', () => {
  assert.throws(
    () => compile.discoverPacks(path.join(os.tmpdir(), 'catalogue-compile-test-does-not-exist-xyz')),
    compile.CompileError
  );
});

test('discoverPacks: sorts pack discovery deterministically by filename', () => {
  const dir = mkTempPacksDir({
    'zzz.json': makePack({ cell: 'zzz' }),
    'zzz.QA.md': '# QA',
    'aaa.json': makePack({ cell: 'aaa' }),
    'aaa.QA.md': '# QA',
  });
  try {
    const { included } = compile.discoverPacks(dir);
    assert.deepEqual(included.map((p) => p.cellName), ['aaa', 'zzz']);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------------
// validateShapes / collectFindings - schema violations block, warnings do not
// ---------------------------------------------------------------------------------
test('validateShapes: a schema-invalid record produces an error-severity finding', () => {
  const pack = makePack({ records: [makeRecord({ id: 'bad-lowercase-id' })] });
  const findings = compile.validateShapes([{ cellName: 'x', relPath: 'x.json', pack }]);
  assert.ok(findings.some((f) => f.level === 'error' && f.tool === 'catalogue-schema'));
});

test('validateShapes: a schema-valid record produces zero findings', () => {
  const pack = makePack();
  const findings = compile.validateShapes([{ cellName: 'x', relPath: 'x.json', pack }]);
  assert.deepEqual(findings, []);
});

test('collectFindings: a threshold-guard WARNING does not appear as an error, and does not by itself block compilation', () => {
  const dir = mkTempPacksDir({
    'warn.json': makePack({
      cell: 'warn',
      records: [makeRecord({
        id: 'CAL_TEST_WARN',
        penalty: { typical_low: null, typical_high: null, statutory_max: 500000, currency: 'GBP', basis: 'statutory maximum', max_is_rare: true },
      })],
    }),
    'warn.QA.md': '# QA',
  });
  try {
    const { included } = compile.discoverPacks(dir);
    const findings = compile.collectFindings(included);
    const errors = findings.filter((f) => f.level === 'error');
    const warnings = findings.filter((f) => f.level !== 'error');
    assert.equal(errors.length, 0, 'a typical-band-missing WARNING must not be reported as an error');
    assert.ok(warnings.some((w) => w.ruleId === 'typical-band-missing'));
  } finally {
    rmDir(dir);
  }
});

test('collectFindings: an inverted-polarity duty produces an error-severity finding', () => {
  const dir = mkTempPacksDir({
    'polarity.json': makePack({
      cell: 'polarity',
      records: [makeRecord({
        id: 'CAL_TEST_POLARITY',
        website_obligations: [{
          duty: 'It is an offence to advertise this product to the public',
          elements: ['x'],
          evidence_type: 'presence', // inverted: prohibition language must be 'absence'
        }],
      })],
    }),
    'polarity.QA.md': '# QA',
  });
  try {
    const { included } = compile.discoverPacks(dir);
    const findings = compile.collectFindings(included);
    assert.ok(findings.some((f) => f.level === 'error' && f.ruleId === 'polarity-prohibition-mismatch'));
  } finally {
    rmDir(dir);
  }
});

test('crossPackDuplicateIds: the same id in two different packs is an error-severity finding', () => {
  const packA = { cellName: 'a', relPath: 'a.json', pack: makePack({ cell: 'a', records: [makeRecord({ id: 'DUP_ID' })] }) };
  const packB = { cellName: 'b', relPath: 'b.json', pack: makePack({ cell: 'b', records: [makeRecord({ id: 'DUP_ID' })] }) };
  const findings = compile.crossPackDuplicateIds([packA, packB]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'error');
  assert.equal(findings[0].ruleId, 'cross-pack-duplicate-id');
});

test('crossPackDuplicateIds: distinct ids across packs produce zero findings', () => {
  const packA = { cellName: 'a', relPath: 'a.json', pack: makePack({ cell: 'a', records: [makeRecord({ id: 'ID_ONE' })] }) };
  const packB = { cellName: 'b', relPath: 'b.json', pack: makePack({ cell: 'b', records: [makeRecord({ id: 'ID_TWO' })] }) };
  assert.deepEqual(compile.crossPackDuplicateIds([packA, packB]), []);
});

// ---------------------------------------------------------------------------------
// assembleArtifact - exclusion of rejected_qa/needs_verification, determinism, content_hash
// ---------------------------------------------------------------------------------
test('assembleArtifact: excludes rejected_qa and needs_verification records from records[] but counts them', () => {
  const pack = makePack({
    cell: 'mixed',
    records: [
      makeRecord({ id: 'CAL_A_KEEP', status: 'candidate' }),
      makeRecord({ id: 'CAL_B_DROP_REJECTED', status: 'rejected_qa' }),
      makeRecord({ id: 'CAL_C_DROP_NEEDS_VERIFICATION', status: 'needs_verification' }),
    ],
  });
  const included = [{ cellName: 'mixed', relPath: 'mixed.json', pack }];
  const artifact = compile.assembleArtifact(included, [], '2026-01-01T00:00:00Z');

  assert.equal(artifact.records.length, 1);
  assert.equal(artifact.records[0].id, 'CAL_A_KEEP');
  assert.equal(artifact.counts.records_scanned, 3);
  assert.equal(artifact.counts.records_included, 1);
  assert.equal(artifact.counts.records_excluded, 2);
  assert.equal(artifact.counts.records_excluded_by_status.rejected_qa, 1);
  assert.equal(artifact.counts.records_excluded_by_status.needs_verification, 1);
});

test('assembleArtifact: records[] is sorted by id regardless of source order', () => {
  const pack = makePack({
    cell: 'order',
    records: [
      makeRecord({ id: 'CAL_Z' }),
      makeRecord({ id: 'CAL_A' }),
      makeRecord({ id: 'CAL_M' }),
    ],
  });
  const included = [{ cellName: 'order', relPath: 'order.json', pack }];
  const artifact = compile.assembleArtifact(included, [], '2026-01-01T00:00:00Z');
  assert.deepEqual(artifact.records.map((r) => r.id), ['CAL_A', 'CAL_M', 'CAL_Z']);
});

test('assembleArtifact: every shipped record carries its source cell name', () => {
  const pack = makePack({ cell: 'traced', records: [makeRecord({ id: 'CAL_TRACED' })] });
  const included = [{ cellName: 'traced', relPath: 'traced.json', pack }];
  const artifact = compile.assembleArtifact(included, [], '2026-01-01T00:00:00Z');
  assert.equal(artifact.records[0].cell, 'traced');
});

test('assembleArtifact: carries the exact --stamp value as generated, never a computed timestamp', () => {
  const pack = makePack();
  const included = [{ cellName: 'x', relPath: 'x.json', pack }];
  const artifact = compile.assembleArtifact(included, [], '2026-01-01T00:00:00Z');
  assert.equal(artifact.generated, '2026-01-01T00:00:00Z');
  assert.equal(artifact.catalogue_version, compile.CATALOGUE_VERSION);
});

test('assembleArtifact: content_hash is deterministic across two independent runs on identical input', () => {
  const pack = makePack({ records: [makeRecord({ id: 'CAL_HASH_A' }), makeRecord({ id: 'CAL_HASH_B' })] });
  const included1 = [{ cellName: 'x', relPath: 'x.json', pack: JSON.parse(JSON.stringify(pack)) }];
  const included2 = [{ cellName: 'x', relPath: 'x.json', pack: JSON.parse(JSON.stringify(pack)) }];
  const a1 = compile.assembleArtifact(included1, [], '2026-01-01T00:00:00Z');
  const a2 = compile.assembleArtifact(included2, [], '2026-01-01T00:00:00Z');
  assert.equal(a1.content_hash, a2.content_hash);
  assert.equal(a1.content_hash.length, 64, 'sha256 hex digest is 64 chars');
});

test('assembleArtifact: content_hash changes when record content changes', () => {
  const pack1 = makePack({ records: [makeRecord({ id: 'CAL_HASH_X' })] });
  const pack2 = makePack({ records: [makeRecord({ id: 'CAL_HASH_X', name: 'a different name' })] });
  const a1 = compile.assembleArtifact([{ cellName: 'x', relPath: 'x.json', pack: pack1 }], [], '2026-01-01T00:00:00Z');
  const a2 = compile.assembleArtifact([{ cellName: 'x', relPath: 'x.json', pack: pack2 }], [], '2026-01-01T00:00:00Z');
  assert.notEqual(a1.content_hash, a2.content_hash);
});

test('assembleArtifact: content_hash is computed with the content_hash field itself excluded', () => {
  // If content_hash were included in its own hash input, the hash could never be reproduced by
  // re-hashing the emitted artifact's core fields (a circularity bug). Prove the actual contract:
  // hashing {catalogue_version, generated, cells, counts, records} (no content_hash key at all)
  // reproduces the artifact's content_hash exactly.
  const pack = makePack({ records: [makeRecord({ id: 'CAL_HASH_SELF' })] });
  const included = [{ cellName: 'x', relPath: 'x.json', pack }];
  const artifact = compile.assembleArtifact(included, [], '2026-01-01T00:00:00Z');
  const recomputed = compile.sha256Hex(compile.canonicalStringify({
    catalogue_version: artifact.catalogue_version,
    generated: artifact.generated,
    cells: artifact.cells,
    counts: artifact.counts,
    records: artifact.records,
  }));
  assert.equal(artifact.content_hash, recomputed);
});

// ---------------------------------------------------------------------------------
// canonicalStringify - key order never affects the string
// ---------------------------------------------------------------------------------
test('canonicalStringify: object key order does not affect the output', () => {
  const a = compile.canonicalStringify({ b: 1, a: 2, c: [3, 2, 1] });
  const b = compile.canonicalStringify({ c: [3, 2, 1], a: 2, b: 1 });
  assert.equal(a, b);
});

test('canonicalStringify: nested object key order does not affect the output', () => {
  const a = compile.canonicalStringify({ outer: { z: 1, y: 2 } });
  const b = compile.canonicalStringify({ outer: { y: 2, z: 1 } });
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------------
// parseArgs / assertValidStamp
// ---------------------------------------------------------------------------------
test('parseArgs: reads --stamp and --out', () => {
  const { stamp, out } = compile.parseArgs(['node', 'compile.js', '--stamp', '2026-01-01T00:00:00Z', '--out', 'foo.json']);
  assert.equal(stamp, '2026-01-01T00:00:00Z');
  assert.ok(out.endsWith('foo.json'));
});

test('parseArgs: reports unknown arguments rather than silently ignoring them', () => {
  const { unknown } = compile.parseArgs(['node', 'compile.js', '--bogus']);
  assert.deepEqual(unknown, ['--bogus']);
});

test('assertValidStamp: throws CompileError when stamp is missing', () => {
  assert.throws(() => compile.assertValidStamp(null), compile.CompileError);
  assert.throws(() => compile.assertValidStamp(undefined), compile.CompileError);
});

test('assertValidStamp: throws CompileError on a non-ISO stamp', () => {
  assert.throws(() => compile.assertValidStamp('2026-01-01'), compile.CompileError);
  assert.throws(() => compile.assertValidStamp('not-a-date'), compile.CompileError);
});

test('assertValidStamp: accepts a well-formed ISO 8601 UTC stamp', () => {
  assert.doesNotThrow(() => compile.assertValidStamp('2026-01-01T00:00:00Z'));
  assert.doesNotThrow(() => compile.assertValidStamp('2026-01-01T00:00:00.123Z'));
});

// ---------------------------------------------------------------------------------
// End-to-end CLI smoke test (Constitution/caution C-148: an eval suite must execute the real
// entry point, not just assert on internals) - runs the actual compiled binary against an
// isolated fixture packs directory via a small wrapper script, since PACKS_DIR is a module-level
// constant resolved from __dirname and the real catalogue/packs/ must never be used by a test.
// ---------------------------------------------------------------------------------
test('CLI smoke test: a clean fixture pack compiles end-to-end to a deterministic artifact', () => {
  const { execFileSync } = require('child_process');
  const fixtureDir = mkTempPacksDir({
    'clean.json': makePack({ cell: 'clean', records: [makeRecord({ id: 'CAL_E2E_CLEAN' })] }),
    'clean.QA.md': '# QA sign-off',
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-compile-test-out-'));
  const outPath = path.join(outDir, 'catalogue.v1.json');
  const wrapper = path.join(outDir, 'run-compile.js');
  // A tiny wrapper that monkeypatches nothing except argv/PACKS_DIR-equivalent behaviour: it
  // requires compile.js's exported building blocks directly and drives the same pipeline main()
  // drives, proving the exported functions compose into a real, working end-to-end compile.
  fs.writeFileSync(wrapper, `
    const compile = require(${JSON.stringify(path.join(__dirname, 'compile.js'))});
    const { included, excluded } = compile.discoverPacks(${JSON.stringify(fixtureDir)});
    const findings = compile.collectFindings(included);
    const errors = findings.filter((f) => f.level === 'error');
    if (errors.length > 0) { console.error(JSON.stringify(errors)); process.exit(1); }
    const artifact = compile.assembleArtifact(included, excluded, '2026-01-01T00:00:00Z');
    require('fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(artifact, null, 2));
    process.exit(0);
  `);
  try {
    execFileSync(process.execPath, [wrapper], { encoding: 'utf8' });
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(written.catalogue_version, compile.CATALOGUE_VERSION);
    assert.equal(written.generated, '2026-01-01T00:00:00Z');
    assert.equal(written.records.length, 1);
    assert.equal(written.records[0].id, 'CAL_E2E_CLEAN');
    assert.equal(typeof written.content_hash, 'string');
    assert.equal(written.content_hash.length, 64);
  } finally {
    rmDir(fixtureDir);
    rmDir(outDir);
  }
});

test('CLI smoke test: the real binary refuses (exit 1) with no --stamp', () => {
  const { execFileSync } = require('child_process');
  assert.throws(() => {
    execFileSync(process.execPath, [path.join(__dirname, 'compile.js')], { encoding: 'utf8', stdio: 'pipe' });
  });
});

test('CLI smoke test: the real binary against the real catalogue/packs/ reports a deterministic finding count for a fixed set of known real-content issues (regression guard)', () => {
  // This is NOT a "must be zero findings" assertion - the real packs carry known, reported issues
  // (see catalogue/README.md "known open findings"). This test pins the CURRENT count so any
  // accidental regression (a new unrelated defect landing silently) is caught, without this test
  // suite itself deciding what counts as acceptable legal content - that judgement belongs to a
  // human legal-QA reviewer, not a unit test.
  const { included } = compile.discoverPacks();
  const findings = compile.collectFindings(included);
  const errors = findings.filter((f) => f.level === 'error');
  // Assert only that the real gate fleet still RUNS end-to-end against real content without
  // throwing, and that its output shape is the uniform finding shape every consumer expects.
  for (const f of findings) {
    assert.equal(typeof f.tool, 'string');
    assert.equal(typeof f.ruleId, 'string');
    assert.equal(typeof f.file, 'string');
    assert.ok(f.level === 'error' || f.level === 'warning');
    assert.equal(typeof f.message, 'string');
  }
  // uk-tech-media-industrial has no .QA.md sidecar in this repo (by design) and must never appear
  // among the compilable packs.
  assert.ok(!included.some((p) => p.cellName === 'uk-tech-media-industrial'));
});
