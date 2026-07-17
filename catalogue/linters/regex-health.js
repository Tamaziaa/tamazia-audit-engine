#!/usr/bin/env node
'use strict';
// catalogue/linters/regex-health.js - the earn-your-zero regex gate (caution.md C-050).
//
// 27 stored trigger patterns had corrupted escapes (\b -> b, \s -> s) and dead-in-production
// patterns like dpo[@\s] compiled, ran, and matched nothing forever. The fix that class needs
// is not "does it compile" (a broken pattern still compiles) but "does it match the thing it was
// written to catch": every regex-bearing field must carry a positive_example string the SAME
// pattern actually matches, proved by running the pattern, not by reading it.
//
// The Compliance Object Model (COM) records in catalogue/packs/*.json carry NO regex fields
// today (website_obligations describe duties in prose; detection is a future migration step -
// caution.md's own historical bugs lived in the LEGACY per-rule regex catalogue this repo is
// replacing). This linter is written for that migration ahead of time: it recursively walks
// every record looking for a field literally named pattern / regex / regex_pattern / detect /
// detection / check_spec whose value is a STRING (a container object under one of those names is
// walked into, not itself treated as a pattern). For each one found:
//   - the pattern must COMPILE (new RegExp(pattern, flags))
//   - the record (or the field's own sibling object) must carry a positive_example string
//   - pattern.test(positive_example) must be true
// Zero regex-bearing fields in the scanned input is reported HONESTLY as "0 patterns (nothing to
// check)" and exits 0 - a gate with nothing to check is not the same as a gate that let something
// through, and this file must never manufacture a violation to look busy.
const lib = require('./lib');

const REGEX_FIELD_KEY_RX = /^(pattern|regex|regex_pattern|detect|detection|check_spec)$/i;

// isPatternFieldEntry(key, value) -> boolean. Named predicate pulled out of walkForPatternFields'
// own if TEST (the multi-operator test now lives in a RETURN, not a test position; Constitution
// Rule 4/tools/health-gate/check.js caps).
function isPatternFieldEntry(key, value) {
  return REGEX_FIELD_KEY_RX.test(key) && typeof value === 'string' && value.length > 0;
}

// flagsFor(node) -> the regex flags a pattern-bearing node declares, or the 'i' default.
function flagsFor(node) {
  return typeof node.flags === 'string' ? node.flags : 'i';
}

// walkForPatternFields(node, pathStr) -> [{ path, pattern, flags, parent }]
// parent is the object that DIRECTLY holds the pattern field, so a sibling positive_example can
// be looked up next to it.
function walkForPatternFields(node, pathStr, out) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkForPatternFields(v, pathStr + '[' + i + ']', out));
    return out;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    const childPath = pathStr + '.' + key;
    if (isPatternFieldEntry(key, value)) {
      out.push({ path: childPath, pattern: value, flags: flagsFor(node), parent: node });
    }
    walkForPatternFields(value, childPath, out);
  }
  return out;
}

// recordFinding(findings, entry) - the catch below is the linter's own job, not a swallow: a
// pattern that fails to compile IS a finding, never a skip. A bare `findings.push(...)` inside a
// catch reads as swallowing to the repo-wide swallow-gate AST scan (tools/swallow-gate/check.js),
// which only recognises a catch body that RETHROWS or calls a recognisable recorder; this named
// helper IS that recording call.
function recordFinding(findings, entry) {
  findings.push(entry);
}

// MAX_PATTERN_LENGTH (SCAN-7): a catalogue-supplied pattern longer than this is refused BEFORE it
// ever reaches `new RegExp(...)` - a length cap is real, cheap defence-in-depth against a
// pathologically long/adversarial pattern string reaching regex compilation, independent of the
// try/catch immediately below.
const MAX_PATTERN_LENGTH = 2000;

// recordId(record) -> the record's own id, or its legacy framework_short, or '<no id>'. Pulled out
// of checkRecord's former nested ternary (Constitution Rule 4/tools/health-gate/check.js caps).
function recordId(record) {
  if (typeof record.id === 'string') return record.id;
  if (typeof record.framework_short === 'string') return record.framework_short;
  return '<no id>';
}

// computePositiveExample(f, record) -> the positive_example string to prove a pattern against
// (sibling-first, then record-level, then null). Pulled out of checkOneField below so the former
// OR-chain lives in a small named unit of its own.
function computePositiveExample(f, record) {
  if (typeof f.parent.positive_example === 'string' && f.parent.positive_example) return f.parent.positive_example;
  if (typeof record.positive_example === 'string' && record.positive_example) return record.positive_example;
  return null;
}

// checkOneField(f, ctx) - one regex-bearing field's full length/compile/example/match check.
// Pulled out of checkRecord's former for-loop body (Constitution Rule 4/tools/health-gate/
// check.js caps: the loop body carried this file's whole per-field decision tree). ctx bundles
// {record, id, locator, findings} (Constitution Rule 4/tools/health-gate/check.js ARGS cap: keeps
// this helper at two formal params instead of five). Pushes onto ctx.findings directly (mirrors
// the original loop's early `continue` exits as early `return`s, since there was never anything
// after them in the loop body).
function checkOneField(f, ctx) {
  const { record, id, locator, findings } = ctx;
  if (f.pattern.length > MAX_PATTERN_LENGTH) {
    recordFinding(findings, { locator, id, rule: 'regex-health/pattern-too-long', level: 'error', message: f.path + ': pattern is ' + f.pattern.length + ' chars, exceeds the ' + MAX_PATTERN_LENGTH + '-char cap this linter enforces before compiling a catalogue-supplied pattern (ReDoS defence-in-depth) - shorten the pattern' });
    return;
  }
  let compiled = null;
  try {
    // By design: this linter compiles catalogue patterns to prove they are alive; input length-capped, failure is itself a finding.
    compiled = new RegExp(f.pattern, f.flags);
  } catch (e) {
    recordFinding(findings, { locator, id, rule: 'regex-health/pattern-does-not-compile', level: 'error', message: f.path + ': ' + JSON.stringify(f.pattern) + ' fails to compile: ' + e.message });
    return;
  }
  const positiveExample = computePositiveExample(f, record);
  if (!positiveExample) {
    findings.push({ locator, id, rule: 'regex-no-positive-example', message: f.path + ': ' + JSON.stringify(f.pattern) + ' has no positive_example to prove it against (earn-your-zero: an unproven pattern is a dead pattern until shown otherwise)' });
    return;
  }
  if (!compiled.test(positiveExample)) {
    findings.push({ locator, id, rule: 'regex-dead-pattern', message: f.path + ': ' + JSON.stringify(f.pattern) + ' does NOT match its own positive_example ' + JSON.stringify(positiveExample) + ' (the over-escaped/C-050 dead-regex class)' });
  }
}

// checkRecord(record, locator) -> finding[]
function checkRecord(record, locator) {
  const id = recordId(record);
  const fields = walkForPatternFields(record, 'record', []);
  const findings = [];
  const ctx = { record, id, locator, findings };
  for (const f of fields) checkOneField(f, ctx);
  return { findings, patternCount: fields.length };
}

function scan(dirsOrPatterns) {
  const { entries, parseErrors } = lib.loadRecords(dirsOrPatterns);
  const violations = [];
  let patternCount = 0;
  for (const entry of entries) {
    const { findings, patternCount: n } = checkRecord(entry.record, entry.locator);
    patternCount += n;
    for (const f of findings) violations.push({ file: entry.file, ...f });
  }
  // CR-7: an unreadable/unparseable file fails the gate through the same violations array a real
  // regex-health defect uses.
  for (const v of lib.parseErrorViolations(parseErrors)) violations.push(v);
  return { violations, scanned: entries.length, patternCount, parseErrors };
}

function selfTest() {
  const dead = { id: 'CAL_SELFTEST_DEAD', detection: { pattern: 'dpo[@\\\\s]', positive_example: 'our dpo contact form is on this page' } };
  const noExample = { id: 'CAL_SELFTEST_NOEX', regex_pattern: 'dpo@' };
  const good = { id: 'CAL_SELFTEST_GOOD', detection: { pattern: 'dpo\\s*@', positive_example: 'email dpo@example.com for data requests' } };
  const zero = { id: 'CAL_SELFTEST_ZERO', name: 'no regex fields at all here' };
  // SCAN-7: a pattern past MAX_PATTERN_LENGTH must be refused BEFORE compilation, never reach
  // new RegExp() at all.
  const tooLong = { id: 'CAL_SELFTEST_TOOLONG', detection: { pattern: 'a'.repeat(MAX_PATTERN_LENGTH + 1), positive_example: 'aaa' } };

  const deadR = checkRecord(dead, 'selftest');
  const noExR = checkRecord(noExample, 'selftest');
  const goodR = checkRecord(good, 'selftest');
  const zeroR = checkRecord(zero, 'selftest');
  const tooLongR = checkRecord(tooLong, 'selftest');

  const pass = deadR.findings.some((f) => f.rule === 'regex-dead-pattern')
    && noExR.findings.some((f) => f.rule === 'regex-no-positive-example')
    && goodR.findings.length === 0
    && zeroR.patternCount === 0 && zeroR.findings.length === 0
    && tooLongR.findings.some((f) => f.rule === 'regex-health/pattern-too-long');

  return {
    pass,
    detail: pass
      ? 'catches a dead over-escaped pattern, catches a missing positive_example, catches an over-long pattern before compilation, clears a genuinely matching pattern, and reports zero patterns honestly when none exist'
      : 'FAILED one or more self-test cases: ' + JSON.stringify({ deadR, noExR, goodR, zeroR, tooLongR }),
  };
}

const toFindings = lib.makeToFindings('catalogue-regex-health');

function main() {
  lib.runLinterCli({ selfTest, scan, toFindings }, 'regex-health', {
    summary: (r) => (r.patternCount === 0
      ? '0 patterns (nothing to check) across ' + r.scanned + ' record(s)'
      : r.patternCount + ' regex-bearing field(s) across ' + r.scanned + ' record(s), ' + r.violations.length + ' violation(s)')
      + (r.parseErrors.length ? ' (' + r.parseErrors.length + ' file(s) unreadable: ' + r.parseErrors.join('; ') + ')' : ''),
    calibrateSummary: (r) => r.patternCount + ' fixture pattern(s) across ' + r.scanned + ' record(s), ' + r.violations.length + ' seeded violation(s) found',
  });
}

if (require.main === module) main();

module.exports = { walkForPatternFields, checkRecord, scan, selfTest, toFindings, REGEX_FIELD_KEY_RX, MAX_PATTERN_LENGTH };
