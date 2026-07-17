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
// Two distinct shapes are validated, because they have different legitimate semantics:
//   - a PATH COMPONENT (one segment: a bare filename or "name.ext", e.g. "uk-legal.json",
//     "uk-legal.QA.md") - used for entries that come from fs.readdirSync() output. These must never
//     contain a path separator, "." or ".." alone, or a null byte.
//   - a RELATIVE PATH (one or more segments, e.g. "catalogue/packs" or "out/catalogue.v1.json") -
//     used for CLI-supplied path arguments (--out, --stamp-file) that legitimately name a nested
//     location chosen by the trusted operator. These may contain separators, but no segment may be
//     ".." (the actual traversal vector) and no null byte is ever permitted.
const path = require('path');

const SAFE_COMPONENT_RX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafePathComponent(component) {
  if (typeof component !== 'string' || component.length === 0) return false;
  if (component === '.' || component === '..') return false;
  if (component.includes('/') || component.includes('\\')) return false;
  if (component.includes('\0')) return false;
  return SAFE_COMPONENT_RX.test(component);
}

function isSafeRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.includes('\0')) return false;
  const segments = p.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  return segments.every((seg) => seg !== '.' && seg !== '..');
}

// assertSafePathComponent(component, opts) -> component. THROWS (opts.ErrorClass, default Error) on
// anything that is not a single, traversal-free path segment. opts.label names the call site.
function assertSafePathComponent(component, opts) {
  const o = opts || {};
  if (!isSafePathComponent(component)) {
    const ErrorClass = o.ErrorClass || Error;
    throw new ErrorClass(
      (o.label || 'path component') + ': ' + JSON.stringify(component)
      + ' is not a safe path component (must match ' + SAFE_COMPONENT_RX
      + ', no "." or ".." alone, no path separators, no null byte)'
    );
  }
  return component;
}

// assertSafeRelativePath(p, opts) -> p. THROWS on a null byte or any ".."/"." traversal segment.
function assertSafeRelativePath(p, opts) {
  const o = opts || {};
  if (!isSafeRelativePath(p)) {
    const ErrorClass = o.ErrorClass || Error;
    throw new ErrorClass(
      (o.label || 'path') + ': ' + JSON.stringify(p)
      + ' is not a safe relative path (no ".."/"." traversal segments, no null byte, non-empty)'
    );
  }
  return p;
}

// safeJoin(baseDir, components, opts) -> path.join(baseDir, ...components), after asserting every
// entry in `components` is a safe single segment (assertSafePathComponent) AND that the resolved
// result stays inside baseDir (belt-and-braces: even an allowlisted component could theoretically
// still escape on a platform with unusual path semantics, so the resolved path is re-checked too).
function safeJoin(baseDir, components, opts) {
  const parts = Array.isArray(components) ? components : [components];
  for (const c of parts) assertSafePathComponent(c, opts);
  const joined = path.join(baseDir, ...parts);
  const resolvedBase = path.resolve(baseDir);
  const resolvedJoined = path.resolve(joined);
  if (resolvedJoined !== resolvedBase && !resolvedJoined.startsWith(resolvedBase + path.sep)) {
    const o = opts || {};
    const ErrorClass = o.ErrorClass || Error;
    throw new ErrorClass(
      (o.label || 'safeJoin') + ': resolved path ' + JSON.stringify(resolvedJoined)
      + ' escapes base directory ' + JSON.stringify(resolvedBase)
    );
  }
  return joined;
}

module.exports = {
  SAFE_COMPONENT_RX,
  isSafePathComponent,
  isSafeRelativePath,
  assertSafePathComponent,
  assertSafeRelativePath,
  safeJoin,
};
