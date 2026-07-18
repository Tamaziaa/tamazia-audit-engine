'use strict';
// tools/lib/safe-path.js - the one allowlist gate for a dynamic path.join/path.resolve component
// (a filename, a CLI argument, or a directory-listing entry).
//
// WHY THIS FILE EXISTS: Semgrep's javascript.lang.security.audit.path-traversal rule fires on any
// path.join/path.resolve call whose argument is not a string literal, regardless of whether the
// value is genuinely attacker-controlled (catalogue/compile.js, catalogue/linters/lib.js and
// tools/facts-abstain/check.js all build paths from fs.readdirSync() entries or CLI argv, which are
// operator/repo-controlled in this codebase, not network input). Rather than suppress the finding,
// every such call site routes its dynamic component(s) through this module first: each one is
// checked against an allowlist shape BEFORE it reaches path.join, and a component that fails the
// allowlist throws rather than silently resolving outside its intended directory (Constitution Rule
// 4: fail closed). This is the single door for that check, so four call sites do not grow four
// slightly different traversal guards (the clone class jscpd exists to catch elsewhere in this
// repo).
//
// FIX-A NOTE (path-traversal alert sweep): the scanner's taint rule has no sanitizer that
// recognises a custom assert/validate function by name, only `.replace(...)`, `.indexOf(...)` and a
// function literally named "sanitize*" (checked against the live Semgrep registry rule during this
// sweep). That means "assert immediately before" alone does not silence the finding at a call site -
// only REMOVING the literal path.join/path.resolve syntax from that site does. safeJoin,
// resolveSafeRelativePath, resolveSafeScanPath and resolveRepoRelative below all perform the actual
// join/resolve call INSIDE this file so every external call site delegates instead of joining
// itself; a handful of alerts on THIS file's own four internal join/resolve calls are the
// consequence (this is the terminal implementation - there is no further door to route through) and
// are expected residue of being the one path door, not a missed fix.
//
// Three distinct shapes are validated, because they have different legitimate semantics:
//   - a PATH COMPONENT (one segment: a bare filename or "name.ext", e.g. "uk-legal.json",
//     "uk-legal.QA.md") - used for entries that come from fs.readdirSync() output. These must never
//     contain a path separator, "." or ".." alone, or a null byte.
//   - a RELATIVE PATH (one or more segments, e.g. "catalogue/packs" or "out/catalogue.v1.json") -
//     used for CLI-supplied WRITE/config path arguments (compile.js's --out, --stamp-file, --packs)
//     that legitimately name a nested location chosen by the trusted operator, RESOLVED AGAINST A
//     FIXED BASE. These may contain separators, but must be genuinely RELATIVE: no segment may be
//     ".." (the traversal vector), the path may not be ABSOLUTE (an absolute path discards the base
//     under path.resolve and so escapes just as surely as "..", CR safe-path.js:43), and no null
//     byte is ever permitted.
//   - a SCAN PATH (a READ target: a file or directory an operator/caller names for a gate to READ,
//     e.g. facts-abstain/check.js's scan argv and the catalogue linters' scan dirs) - CONSUMER
//     AUDIT (CR safe-path.js:43): unlike a base-relative WRITE arg, a scan target is used DIRECTLY,
//     not path.resolve(base, p)'d against a base it could discard, and it legitimately arrives
//     ABSOLUTE (an already-safeJoin-validated internal path the compiler hands its linters, or an
//     operator naming a bundle/pack anywhere on disk). So a scan path accepts EITHER an absolute
//     path OR a genuinely-relative one with no ".." segment; a relative one is still resolved
//     against the base and its traversal guarded. Null bytes are never permitted. Directory ENTRIES
//     discovered under a scan path are still routed through safeJoin regardless.
const path = require('path');

const SAFE_COMPONENT_RX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// isEmptyOrHasNullByte(p) -> true for a non-string, an empty string, or a string carrying a null byte.
// The shared first gate of all three shapes (never a valid path), so each predicate opens with one call
// instead of repeating the same two guards.
function isEmptyOrHasNullByte(p) {
  if (typeof p !== 'string' || p.length === 0) return true;
  return p.includes('\0');
}

function isSafePathComponent(component) {
  if (isEmptyOrHasNullByte(component)) return false;
  if (component === '.' || component === '..') return false;
  if (component.includes('/') || component.includes('\\')) return false;
  return SAFE_COMPONENT_RX.test(component);
}

// isSafeDirEntry(name) -> true for a genuine filesystem directory-entry name (fs.readdirSync
// output): any non-empty string with no path separator and no null byte. Deliberately BROADER than
// isSafePathComponent above (which additionally forbids a leading dot and restricts the character
// set to SAFE_COMPONENT_RX) - a real directory listing legitimately contains dotfiles (.gitkeep,
// .gitignore both exist in this repo's own scanned trees, caution.md C-201) and any filename a
// filesystem allows. The safety property that matters for a WALKER (as opposed to a caller building
// a name from its own allowlist, e.g. a catalogue pack id) is narrower: fs.readdirSync can never
// return "." or ".." as an entry (the OS excludes them from the listing), so the only genuine
// escape vector for a single "entry" is a path separator smuggled into the name.
function isSafeDirEntry(name) {
  if (isEmptyOrHasNullByte(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
}

function isSafeRelativePath(p) {
  if (isEmptyOrHasNullByte(p)) return false;
  // CR (safe-path.js:43): a "relative" path must actually BE relative. An ABSOLUTE path
  // (/etc/passwd, C:\Windows) carries no ".." segment yet still escapes the intended base
  // entirely: path.resolve(base, absolute) discards base and resolves to the absolute location.
  // Rejecting it here closes that hole for every consumer at once, so the whole shared contract
  // rejects absolute AND traversal consistently (compile.js CLI args, catalogue linters,
  // facts-abstain scan paths), not just the "../" vector.
  if (path.isAbsolute(p)) return false;
  const segments = p.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  return segments.every((seg) => seg !== '.' && seg !== '..');
}

// isSafeScanPath(p) -> true for a READ-scan target (see file header, third shape). Accepts an
// ABSOLUTE path (used directly, so there is no base for it to escape - the compiler's own
// already-validated linter paths and operator-named read targets both arrive this way), OR a
// genuinely-relative path with no ".." traversal segment. Never a null byte, never empty. This is
// the READ-side counterpart to isSafeRelativePath (the WRITE/config-arg side, which resolves against
// a base and so MUST keep rejecting absolute). One door for the read-scan shape so lib.js and
// facts-abstain do not grow two subtly-different absolute-path branches (CR safe-path.js:43 consumer
// audit).
function isSafeScanPath(p) {
  if (isEmptyOrHasNullByte(p)) return false;
  if (path.isAbsolute(p)) return true;
  return isSafeRelativePath(p);
}

// assertSafe(value, isValid, opts, defaultLabel, reason) -> value. THE shared assert body for all
// three shapes: run the shape's own predicate and, on failure, throw opts.ErrorClass (default Error)
// with a "<label>: <value> <reason>" message. Extracted so the three public asserts are one-line
// wrappers around one door, not three structurally-identical throw blocks (CodeScene Code Duplication;
// this is exactly the clone class jscpd exists to catch elsewhere in the repo).
function assertSafe(value, isValid, opts, message) {
  const o = opts || {};
  if (!isValid(value)) {
    const ErrorClass = o.ErrorClass || Error;
    throw new ErrorClass((o.label || message.defaultLabel) + ': ' + JSON.stringify(value) + ' ' + message.reason);
  }
  return value;
}

// assertSafePathComponent(component, opts) -> component. THROWS (opts.ErrorClass, default Error) on
// anything that is not a single, traversal-free path segment. opts.label names the call site.
function assertSafePathComponent(component, opts) {
  return assertSafe(component, isSafePathComponent, opts, {
    defaultLabel: 'path component',
    reason: 'is not a safe path component (must match ' + SAFE_COMPONENT_RX + ', no "." or ".." alone, no path separators, no null byte)',
  });
}

// assertSafeDirEntry(name, opts) -> name. THROWS on a path separator, a null byte, or an empty/
// non-string value; ACCEPTS a dotfile (see isSafeDirEntry above for why a walker needs the broader
// shape).
function assertSafeDirEntry(name, opts) {
  return assertSafe(name, isSafeDirEntry, opts, {
    defaultLabel: 'directory entry',
    reason: 'is not a safe directory-entry name (no path separator, no null byte, non-empty)',
  });
}

// assertSafeRelativePath(p, opts) -> p. THROWS on an absolute path, a null byte, or any
// ".."/"." traversal segment.
function assertSafeRelativePath(p, opts) {
  return assertSafe(p, isSafeRelativePath, opts, {
    defaultLabel: 'path',
    reason: 'is not a safe relative path (must be relative, not absolute; no ".."/"." traversal segments; no null byte; non-empty)',
  });
}

// assertSafeScanPath(p, opts) -> p. THROWS on a null byte, an empty/non-string, or a RELATIVE path
// carrying a ".."/"." traversal segment. An absolute path is accepted (see isSafeScanPath).
function assertSafeScanPath(p, opts) {
  return assertSafe(p, isSafeScanPath, opts, {
    defaultLabel: 'scan path',
    reason: 'is not a safe scan path (absolute is allowed; a relative one must carry no ".."/"." traversal segments; no null byte; non-empty)',
  });
}

// safeJoin(baseDir, components, opts) -> path.join(baseDir, ...components), after asserting every
// entry in `components` is a safe single segment (assertSafePathComponent) AND that the resolved
// result stays inside baseDir (belt-and-braces: even an allowlisted component could theoretically
// still escape on a platform with unusual path semantics, so the resolved path is re-checked too).
// assertInsideBase(resolvedBase, resolvedJoined, opts) -> throws when the resolved join landed
// outside the base directory (the belt-and-braces escape check safeJoin delegates to).
function assertInsideBase(resolvedBase, resolvedJoined, opts) {
  if (resolvedJoined === resolvedBase || resolvedJoined.startsWith(resolvedBase + path.sep)) return;
  const o = opts || {};
  const ErrorClass = o.ErrorClass || Error;
  throw new ErrorClass(
    (o.label || 'safeJoin') + ': resolved path ' + JSON.stringify(resolvedJoined)
    + ' escapes base directory ' + JSON.stringify(resolvedBase)
  );
}

function safeJoin(baseDir, components, opts) {
  const parts = Array.isArray(components) ? components : [components];
  for (const c of parts) assertSafePathComponent(c, opts);
  const joined = path.join(baseDir, ...parts);
  assertInsideBase(path.resolve(baseDir), path.resolve(joined), opts);
  return joined;
}

// safeJoinEntry(baseDir, name, opts) -> path.join(baseDir, name), after assertSafeDirEntry(name)
// and the same assertInsideBase belt-and-braces check safeJoin performs. The WALKER-specific
// sibling of safeJoin: used where the component is a raw fs.readdirSync() entry name (which may
// legitimately be a dotfile - safeJoin's stricter SAFE_COMPONENT_RX would wrongly refuse
// ".gitkeep"), not a name the caller itself is choosing from its own allowlist.
function safeJoinEntry(baseDir, name, opts) {
  assertSafeDirEntry(name, opts);
  const joined = path.join(baseDir, name);
  assertInsideBase(path.resolve(baseDir), path.resolve(joined), opts);
  return joined;
}

// resolveSafeRelativePath(baseDir, p, opts) -> path.resolve(baseDir, p), after asserting p is a
// safe RELATIVE path (assertSafeRelativePath: not absolute, no ".."/"." traversal segment, no null
// byte) and re-checking the resolved result stays inside baseDir (the same belt-and-braces
// assertInsideBase check safeJoin performs). This is safeJoin's MULTI-SEGMENT sibling: safeJoin only
// accepts single path COMPONENTS (a bare filename, no separators), but some callers legitimately
// name a nested relative location in ONE string (a --out/--packs CLI flag, a hardcoded
// "tools/one-door/check.js" table entry, a "facts/jurisdiction.js" producer path read from a
// committed manifest). Before this existed, those call sites did
// `path.resolve(base, assertSafeRelativePath(p))` themselves - genuinely validated, but the
// traversal scanner (Semgrep's path-join-resolve-traversal rule, taint mode, sees ANY function
// parameter as a source with no sanitizer recognising a custom assert function) still flagged the
// literal path.resolve call at each of those sites. Moving the actual path.resolve call in here
// keeps that syntax inside the one file the scanner needs to reason about, instead of scattered
// across every caller (Constitution Rule 1: one door, and the fix is making safety analysable, not
// re-deriving it four times).
function resolveSafeRelativePath(baseDir, p, opts) {
  assertSafeRelativePath(p, opts);
  const resolved = path.resolve(baseDir, p);
  assertInsideBase(path.resolve(baseDir), resolved, opts);
  return resolved;
}

// resolveSafeScanPath(baseDir, p, opts) -> path.resolve(baseDir, p), after asserting p is a safe
// SCAN path (assertSafeScanPath: absolute is accepted and used directly - path.resolve(base, abs)
// discards base exactly as intended - or a relative path with no ".." traversal). The READ-side
// counterpart to resolveSafeRelativePath above: also used by callers that treat an
// operator-supplied CLI directory argument as a trusted scan-or-write target (a test harness's
// --fresh/--goldens flag, both of which may legitimately be an absolute tmp directory). The shape
// needed there - "an operator names a directory anywhere on disk, or a short relative one" - is
// exactly isSafeScanPath's contract, not the WRITE-arg contract that forbids absolute.
function resolveSafeScanPath(baseDir, p, opts) {
  assertSafeScanPath(p, opts);
  return path.resolve(baseDir, p);
}

// resolveRepoRelative(rootDir, fromFile, spec, opts) -> an absolute path for a relative require()
// specifier (spec may start with "." or ".." - ordinary relative-require syntax; a require
// specifier legitimately climbs directories with "../", unlike a WRITE/config arg where ".." is
// the traversal vector assertSafeRelativePath exists to reject). Used only by the reachability
// walker (tools/sweep/collect-local.js), which resolves require() targets found by regex in
// ALREADY-COMMITTED repo source purely to check file existence (read-only, no write, no execution
// of the resolved path). The one property still enforced here: the resolved path must stay inside
// rootDir (assertInsideBase) - a specifier that would resolve outside the repo tree is refused, not
// followed, so the read-only file-existence probe can never be pointed at anything outside the
// tree it was asked to reason about.
function resolveRepoRelative(rootDir, fromFile, spec, opts) {
  const resolved = path.resolve(path.dirname(fromFile), spec);
  assertInsideBase(path.resolve(rootDir), resolved, opts);
  return resolved;
}

module.exports = {
  SAFE_COMPONENT_RX,
  isSafePathComponent,
  isSafeDirEntry,
  isSafeRelativePath,
  isSafeScanPath,
  assertSafePathComponent,
  assertSafeDirEntry,
  assertSafeRelativePath,
  assertSafeScanPath,
  safeJoin,
  safeJoinEntry,
  resolveSafeRelativePath,
  resolveSafeScanPath,
  resolveRepoRelative,
};
