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
      last_synced: '2026-07-17',
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

// makePackAndSidecar(packObj, opts) -> { text, sidecar }. Stringifies the pack ONCE, so the exact
// bytes written to disk and the bytes hashed for the sidecar's qa-approval header are IDENTICAL
// (CR-2: compile.js now refuses any pack whose sidecar does not carry a CURRENT, matching
// pack_sha256). Every synthetic fixture pack this suite writes must be paired with a sidecar built
// by this helper, or discoverPacks() correctly refuses it exactly as it refuses every real,
// not-yet-stamped catalogue/packs/*.QA.md sidecar today (see the dedicated CR-2 test block below).
function makePackAndSidecar(packObj, opts) {
  const o = opts || {};
  const text = JSON.stringify(packObj, null, 2);
  const sha = compile.sha256Hex(text);
  const verdict = o.verdict || 'approved';
  const reviewed = o.reviewed || '2026-07-17';
  const sidecar = '<!-- qa-approval pack_sha256=' + sha + ' verdict=' + verdict + ' reviewed=' + reviewed + ' -->\n# QA sign-off (test fixture)\n';
  return { text, sidecar, sha };
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

// mkTempWorkWithPacks(files) -> { workdir, packsRel }. Builds an isolated temp WORKING directory
// with a `packs/` subdirectory populated by the given { filename: content } pairs. The CLI smoke
// tests below run the real binary with `cwd: workdir` and pass RELATIVE --packs/--out arguments,
// because the shared path-traversal gate (tools/lib/safe-path.js) now rejects ABSOLUTE path
// arguments as well as "../" traversal (CR safe-path.js:43): the CLI contract is genuinely
// relative-to-cwd, so the tests exercise exactly that. Caller must rm workdir in a `finally`.
function mkTempWorkWithPacks(files) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-compile-test-work-'));
  const packsRel = 'packs';
  const packsDir = path.join(workdir, packsRel);
  fs.mkdirSync(packsDir);
  for (const [name, content] of Object.entries(files)) {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(path.join(packsDir, name), text);
  }
  return { workdir, packsRel };
}

// ---------------------------------------------------------------------------------
// discoverPacks
// ---------------------------------------------------------------------------------
test('discoverPacks: excludes a pack with no .QA.md sidecar', () => {
  const hasQa = makePackAndSidecar(makePack({ cell: 'has-qa' }));
  const dir = mkTempPacksDir({
    'has-qa.json': hasQa.text,
    'has-qa.QA.md': hasQa.sidecar,
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
  const zzz = makePackAndSidecar(makePack({ cell: 'zzz' }));
  const aaa = makePackAndSidecar(makePack({ cell: 'aaa' }));
  const dir = mkTempPacksDir({
    'zzz.json': zzz.text,
    'zzz.QA.md': zzz.sidecar,
    'aaa.json': aaa.text,
    'aaa.QA.md': aaa.sidecar,
  });
  try {
    const { included } = compile.discoverPacks(dir);
    assert.deepEqual(included.map((p) => p.cellName), ['aaa', 'zzz']);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------------
// CR-3: pack.cell must match the filename-derived cell name
// ---------------------------------------------------------------------------------
test('discoverPacks: throws CompileError when pack.cell does not match its filename-derived cell', () => {
  const mismatched = makePackAndSidecar(makePack({ cell: 'some-other-cell' }));
  const dir = mkTempPacksDir({
    'uk-legal.json': mismatched.text,
    'uk-legal.QA.md': mismatched.sidecar,
  });
  try {
    assert.throws(
      () => compile.discoverPacks(dir),
      (e) => e instanceof compile.CompileError && e.message.includes('must match its filename-derived cell'),
    );
  } finally {
    rmDir(dir);
  }
});

test('discoverPacks: a pack whose cell matches its filename is included normally', () => {
  const matched = makePackAndSidecar(makePack({ cell: 'uk-legal' }));
  const dir = mkTempPacksDir({
    'uk-legal.json': matched.text,
    'uk-legal.QA.md': matched.sidecar,
  });
  try {
    const { included } = compile.discoverPacks(dir);
    assert.equal(included.length, 1);
    assert.equal(included[0].cellName, 'uk-legal');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------------
// CR-2: the .QA.md sidecar must START with a machine-readable qa-approval header binding it to
// the pack's EXACT sha256; a stale or absent header refuses compilation (CompileError), never a
// silent pass.
// ---------------------------------------------------------------------------------
test('computePackSha: returns the sha256 hex digest of the exact file bytes, matching sha256Hex of the same text read back', () => {
  const dir = mkTempPacksDir({ 'x.json': '{"a":1}' });
  try {
    const abs = path.join(dir, 'x.json');
    assert.equal(compile.computePackSha(abs), compile.sha256Hex('{"a":1}'));
    assert.equal(compile.computePackSha(abs).length, 64);
  } finally {
    rmDir(dir);
  }
});

test('parseQaApprovalHeader: parses a well-formed leading qa-approval block and returns null for anything else, never throwing', () => {
  const good = compile.parseQaApprovalHeader('<!-- qa-approval pack_sha256=' + 'a'.repeat(64) + ' verdict=approved reviewed=2026-07-17 -->\n# QA notes\n');
  assert.deepEqual(good, { pack_sha256: 'a'.repeat(64), verdict: 'approved', reviewed: '2026-07-17' });

  assert.equal(compile.parseQaApprovalHeader('# QA sign-off\nno header here'), null);
  assert.equal(compile.parseQaApprovalHeader(''), null);
  assert.equal(compile.parseQaApprovalHeader(null), null);
  // verdict must be the literal "approved" - any other value (or a missing one) fails to match,
  // which discoverPacks treats identically to "no header at all" (never a second, separate check).
  assert.equal(compile.parseQaApprovalHeader('<!-- qa-approval pack_sha256=' + 'a'.repeat(64) + ' verdict=rejected reviewed=2026-07-17 -->'), null);
  // the header must be at the very START of the sidecar, not merely present somewhere inside it.
  assert.equal(compile.parseQaApprovalHeader('# QA notes\n<!-- qa-approval pack_sha256=' + 'a'.repeat(64) + ' verdict=approved reviewed=2026-07-17 -->'), null);
});

test('discoverPacks: throws CompileError when the sidecar has no qa-approval header at all (every real committed sidecar today, deliberately - see the dedicated real-packs test below)', () => {
  const pack = makePack({ cell: 'no-header' });
  const dir = mkTempPacksDir({
    'no-header.json': JSON.stringify(pack, null, 2),
    'no-header.QA.md': '# QA sign-off\n\nLooks fine but carries no machine-readable header.',
  });
  try {
    assert.throws(
      () => compile.discoverPacks(dir),
      (e) => e instanceof compile.CompileError && e.message.includes('does not START with the required machine-readable approval block'),
    );
  } finally {
    rmDir(dir);
  }
});

test('discoverPacks: throws CompileError "QA approval stale: pack changed since sign-off" when the sidecar\'s approved hash no longer matches the pack', () => {
  const original = makePackAndSidecar(makePack({ cell: 'stale', records: [makeRecord({ id: 'CAL_ORIGINAL' })] }));
  // The pack changes AFTER sign-off (a real edit landing without re-review) - write DIFFERENT pack
  // content under the SAME sidecar that approved the original.
  const changedText = JSON.stringify(makePack({ cell: 'stale', records: [makeRecord({ id: 'CAL_CHANGED' })] }), null, 2);
  const dir = mkTempPacksDir({
    'stale.json': changedText,
    'stale.QA.md': original.sidecar,
  });
  try {
    assert.throws(
      () => compile.discoverPacks(dir),
      (e) => e instanceof compile.CompileError && e.message.includes('QA approval stale: pack changed since sign-off'),
    );
  } finally {
    rmDir(dir);
  }
});

test('discoverPacks: includes a pack whose sidecar carries a CURRENT, matching qa-approval header', () => {
  const good = makePackAndSidecar(makePack({ cell: 'current', records: [makeRecord({ id: 'CAL_CURRENT' })] }));
  const dir = mkTempPacksDir({ 'current.json': good.text, 'current.QA.md': good.sidecar });
  try {
    const { included } = compile.discoverPacks(dir);
    assert.equal(included.length, 1);
    assert.equal(included[0].cellName, 'current');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------------
// listPackFiles - the --print-hashes utility mode's own file listing, independent of QA state
// ---------------------------------------------------------------------------------
test('listPackFiles: lists every *.json pack file regardless of QA-sidecar presence or validity', () => {
  const dir = mkTempPacksDir({
    'has-qa.json': makePack({ cell: 'has-qa' }),
    'has-qa.QA.md': '# no machine-readable header at all',
    'no-qa.json': makePack({ cell: 'no-qa' }),
  });
  try {
    const files = compile.listPackFiles(dir);
    assert.deepEqual(files.map((f) => f.cellName).sort(), ['has-qa', 'no-qa']);
    for (const f of files) assert.equal(typeof compile.computePackSha(f.absPath), 'string');
  } finally {
    rmDir(dir);
  }
});

test('listPackFiles: throws CompileError when the directory does not exist', () => {
  assert.throws(
    () => compile.listPackFiles(path.join(os.tmpdir(), 'catalogue-compile-test-does-not-exist-xyz')),
    compile.CompileError,
  );
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
  const warn = makePackAndSidecar(makePack({
    cell: 'warn',
    records: [makeRecord({
      id: 'CAL_TEST_WARN',
      penalty: { typical_low: null, typical_high: null, statutory_max: 500000, currency: 'GBP', basis: 'statutory maximum', max_is_rare: true },
    })],
  }));
  const dir = mkTempPacksDir({
    'warn.json': warn.text,
    'warn.QA.md': warn.sidecar,
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
  const polarityPack = makePackAndSidecar(makePack({
    cell: 'polarity',
    records: [makeRecord({
      id: 'CAL_TEST_POLARITY',
      website_obligations: [{
        duty: 'It is an offence to advertise this product to the public',
        elements: ['x'],
        evidence_type: 'presence', // inverted: prohibition language must be 'absence'
      }],
    })],
  }));
  const dir = mkTempPacksDir({
    'polarity.json': polarityPack.text,
    'polarity.QA.md': polarityPack.sidecar,
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

test('assertValidStamp: rejects ISO-shaped but impossible calendar dates/times (2026-02-30 class)', () => {
  // Shape passes ISO_RX yet the instant does not exist - the semantic date validator must reject it.
  assert.throws(() => compile.assertValidStamp('2026-02-30T00:00:00Z'), compile.CompileError);
  assert.throws(() => compile.assertValidStamp('2026-13-01T00:00:00Z'), compile.CompileError);
  assert.throws(() => compile.assertValidStamp('2026-01-01T25:00:00Z'), compile.CompileError);
  assert.throws(() => compile.assertValidStamp('2026-01-01T00:60:00Z'), compile.CompileError);
  // A real leap day still passes (2028 is a leap year).
  assert.doesNotThrow(() => compile.assertValidStamp('2028-02-29T12:00:00Z'));
});

test('parseArgs: reads --stamp-file and --packs', () => {
  const { stampFile, packsDir } = compile.parseArgs(['node', 'compile.js', '--stamp-file', 'RELEASE_STAMP', '--packs', 'some/dir']);
  assert.equal(stampFile, 'RELEASE_STAMP');
  assert.ok(packsDir.endsWith(path.join('some', 'dir')));
});

test('parseArgs: reads --print-hashes as a bare boolean flag', () => {
  const { printHashes } = compile.parseArgs(['node', 'compile.js', '--print-hashes']);
  assert.equal(printHashes, true);
  assert.equal(compile.parseArgs(['node', 'compile.js']).printHashes, false);
});

test('parseArgs (SCAN path-traversal): --out/--stamp-file/--packs each reject a ".." traversal segment via CompileError', () => {
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--out', '../../etc/passwd']), compile.CompileError);
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--stamp-file', '../../etc/passwd']), compile.CompileError);
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--packs', '../../etc']), compile.CompileError);
});

test('parseArgs (SCAN path-traversal): --out/--stamp-file/--packs each reject an ABSOLUTE path via CompileError (CR safe-path.js:43 - the shared contract is relative-to-cwd only)', () => {
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--out', '/etc/cron.d/x']), compile.CompileError);
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--stamp-file', '/etc/passwd']), compile.CompileError);
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--packs', '/etc']), compile.CompileError);
});

// ---------------------------------------------------------------------------------
// CR-1: resolveStamp - --stamp-file reads a COMMITTED file's trimmed contents as the stamp
// ---------------------------------------------------------------------------------
test('resolveStamp: with no --stamp-file, returns --stamp unchanged (including null)', () => {
  assert.equal(compile.resolveStamp('2026-01-01T00:00:00Z', null), '2026-01-01T00:00:00Z');
  assert.equal(compile.resolveStamp(null, null), null);
});

test('resolveStamp: reads and trims the contents of --stamp-file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-compile-test-stampfile-'));
  const stampFile = path.join(dir, 'RELEASE_STAMP');
  fs.writeFileSync(stampFile, '2026-07-17T00:00:00Z\n');
  try {
    assert.equal(compile.resolveStamp(null, stampFile), '2026-07-17T00:00:00Z');
  } finally {
    rmDir(dir);
  }
});

test('resolveStamp: throws CompileError when --stamp-file does not exist', () => {
  assert.throws(
    () => compile.resolveStamp(null, path.join(os.tmpdir(), 'catalogue-compile-test-no-such-stamp-file')),
    compile.CompileError,
  );
});

test('resolveStamp: throws CompileError when --stamp and --stamp-file are both given with DIFFERENT values (never silently prefers one)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-compile-test-stampfile-'));
  const stampFile = path.join(dir, 'RELEASE_STAMP');
  fs.writeFileSync(stampFile, '2026-07-17T00:00:00Z\n');
  try {
    assert.throws(() => compile.resolveStamp('2026-01-01T00:00:00Z', stampFile), compile.CompileError);
    // identical values are NOT a conflict.
    assert.equal(compile.resolveStamp('2026-07-17T00:00:00Z', stampFile), '2026-07-17T00:00:00Z');
  } finally {
    rmDir(dir);
  }
});

test('resolveStamp: the committed repo-root RELEASE_STAMP file resolves to a valid ISO8601 stamp', () => {
  const resolved = compile.resolveStamp(null, 'RELEASE_STAMP');
  assert.doesNotThrow(() => compile.assertValidStamp(resolved));
  assert.equal(resolved, '2026-07-17T00:00:00Z');
});

// ---------------------------------------------------------------------------------
// End-to-end CLI smoke test (Constitution/caution C-148: an eval suite must execute the real
// entry point, not just assert on internals). CR-4/CR-5: these run the ACTUAL `node
// catalogue/compile.js` binary via execFileSync - real argv parsing, real --stamp validation, the
// real CLI error boundary in main() - against an isolated fixture directory via the CLI's own
// `--packs <dir>` override (so the real catalogue/packs/ is never touched and PACKS_DIR's
// module-level default stays exactly what every non-test caller relies on).
// ---------------------------------------------------------------------------------
test('CLI smoke test: a clean fixture pack compiles end-to-end to a deterministic artifact via the real CLI (--packs injectable)', () => {
  const { execFileSync } = require('child_process');
  const clean = makePackAndSidecar(makePack({ cell: 'clean', records: [makeRecord({ id: 'CAL_E2E_CLEAN' })] }));
  const { workdir, packsRel } = mkTempWorkWithPacks({ 'clean.json': clean.text, 'clean.QA.md': clean.sidecar });
  const outRel = path.join('out', 'catalogue.v1.json');
  try {
    execFileSync(process.execPath, [
      path.join(__dirname, 'compile.js'),
      '--stamp', '2026-01-01T00:00:00Z',
      '--packs', packsRel,
      '--out', outRel,
    ], { encoding: 'utf8', cwd: workdir });
    const written = JSON.parse(fs.readFileSync(path.join(workdir, outRel), 'utf8'));
    assert.equal(written.catalogue_version, compile.CATALOGUE_VERSION);
    assert.equal(written.generated, '2026-01-01T00:00:00Z');
    assert.equal(written.records.length, 1);
    assert.equal(written.records[0].id, 'CAL_E2E_CLEAN');
    assert.equal(typeof written.content_hash, 'string');
    assert.equal(written.content_hash.length, 64);
  } finally {
    rmDir(workdir);
  }
});

test('CLI smoke test: the real binary refuses (exit 1) with no --stamp', () => {
  const { execFileSync } = require('child_process');
  assert.throws(() => {
    execFileSync(process.execPath, [path.join(__dirname, 'compile.js')], { encoding: 'utf8', stdio: 'pipe' });
  });
});

test('CLI smoke test: the real binary reports an EXACT, deterministic finding count for a fixture with one seeded polarity defect (--packs injectable)', () => {
  const { execFileSync } = require('child_process');
  const badRecord = makeRecord({
    id: 'CAL_E2E_BAD_POLARITY',
    website_obligations: [{
      duty: 'It is an offence to advertise this product to the public',
      elements: ['x'],
      evidence_type: 'presence', // inverted: prohibition language must be 'absence'
    }],
  });
  const defects = makePackAndSidecar(makePack({ cell: 'defects', records: [badRecord] }));
  const { workdir, packsRel } = mkTempWorkWithPacks({ 'defects.json': defects.text, 'defects.QA.md': defects.sidecar });
  try {
    // assert.throws' validator callback receives the thrown error directly, so this needs no
    // manual try/catch of its own (and nothing to swallow): a run that does NOT throw fails this
    // assertion immediately, and the validator's own assertions on stderr run only once a refusal
    // is already proven.
    assert.throws(
      () => execFileSync(process.execPath, [
        path.join(__dirname, 'compile.js'),
        '--stamp', '2026-01-01T00:00:00Z',
        '--packs', packsRel,
      ], { encoding: 'utf8', stdio: 'pipe', cwd: workdir }),
      (e) => {
        const stderr = String(e.stderr || '');
        const errorLines = stderr.split('\n').filter((l) => l.includes('  ERROR ['));
        assert.equal(errorLines.length, 1, 'expected EXACTLY one ERROR-severity finding line; got:\n' + stderr);
        assert.ok(errorLines[0].includes('polarity-prohibition-mismatch'), 'expected the one finding to be the seeded polarity defect; got: ' + errorLines[0]);
        return true;
      },
      'expected the CLI to refuse compilation (exit 1) on a seeded polarity defect'
    );
  } finally {
    rmDir(workdir);
  }
});

test('CLI smoke test: --print-hashes against a fixture directory prints one deterministic sha256 line per pack file, independent of any QA-approval state', () => {
  const { execFileSync } = require('child_process');
  const clean = makePackAndSidecar(makePack({ cell: 'clean', records: [makeRecord({ id: 'CAL_HASH_PRINT' })] }));
  const { workdir, packsRel } = mkTempWorkWithPacks({
    'clean.json': clean.text,
    'clean.QA.md': clean.sidecar,
    'unstamped.json': makePack({ cell: 'unstamped' }), // no sidecar at all - must still be hashed
  });
  try {
    const stdout = execFileSync(process.execPath, [
      path.join(__dirname, 'compile.js'),
      '--print-hashes',
      '--packs', packsRel,
    ], { encoding: 'utf8', cwd: workdir });
    assert.ok(stdout.includes('clean  ' + clean.sha), 'expected the printed hash to match the exact sha256 of the fixture pack bytes; got:\n' + stdout);
    assert.ok(stdout.includes('unstamped  '), 'expected --print-hashes to hash a pack with no sidecar too - it exists precisely to produce a hash BEFORE a sidecar exists');
  } finally {
    rmDir(workdir);
  }
});

test('discoverPacks() against the real catalogue/packs/ succeeds now every committed sidecar carries a current CR-2 qa-approval header', () => {
  // Constitution/caution C-201: the P2 law-verification wave hash-stamped every QA'd sidecar's
  // approval header (`node catalogue/compile.js --print-hashes`, then a human legal-QA sign-off
  // per pack) - this is the graduated state predicted by the prior version of this test. Six packs
  // have a sidecar and a valid, current header and must be INCLUDED; uk-tech-media-industrial has
  // no sidecar at all (by design, a parallel workstream not yet QA'd) and must be EXCLUDED, never
  // thrown.
  const { included, excluded } = compile.discoverPacks();
  const includedCells = included.map((p) => p.cellName).sort();
  assert.deepStrictEqual(
    includedCells,
    ['uk-healthcare', 'uk-legal', 'uk-universal', 'us-healthcare', 'us-legal', 'us-universal'],
    'expected exactly the six QA-stamped packs to be included'
  );
  assert.ok(
    excluded.some((e) => e.cell === 'uk-tech-media-industrial' && e.reason === 'no legal-QA sidecar'),
    'expected uk-tech-media-industrial to stay excluded (no sidecar yet), not thrown'
  );
});

test('--print-hashes against the real catalogue/packs/ prints a deterministic sha256 line for every real pack file', () => {
  const { execFileSync } = require('child_process');
  const stdout = execFileSync(process.execPath, [path.join(__dirname, 'compile.js'), '--print-hashes'], { encoding: 'utf8' });
  const realFiles = compile.listPackFiles();
  assert.ok(realFiles.length >= 7, 'expected at least 7 real pack files, found ' + realFiles.length);
  for (const f of realFiles) {
    const expectedSha = compile.computePackSha(f.absPath);
    assert.ok(stdout.includes(f.cellName + '  ' + expectedSha), 'expected --print-hashes stdout to include ' + f.cellName + '  ' + expectedSha);
  }
  // uk-tech-media-industrial has no .QA.md sidecar in this repo (by design); --print-hashes must
  // still hash it, since generating the hash is the very first step towards writing that sidecar.
  assert.ok(realFiles.some((f) => f.cellName === 'uk-tech-media-industrial'));
});

test('parseArgs: a value flag must not consume the next flag as its value (CR round-5)', () => {
  // "--out --print-hashes" would otherwise treat "--print-hashes" as the output path and complete
  // the wrong operation entirely.
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--out', '--print-hashes']), compile.CompileError);
  assert.throws(() => compile.parseArgs(['node', 'compile.js', '--stamp']), compile.CompileError);
});
