'use strict';
/**
 * tools/health-gate/heuristic.js - the brace/indent fallback engine for tools/health-gate/check.js.
 *
 * Used only when acorn cannot be required (or HEALTH_GATE_ENGINE=heuristic forces it, mirroring
 * SWALLOW_GATE_ENGINE=regex, so this path can never rot unnoticed). Honest limitations, by design:
 *   - only block-bodied functions/methods/arrows are measured (an expression-bodied arrow is,
 *     definitionally, one line and cannot trip any of the five caps, so skipping it loses nothing);
 *   - nesting depth is approximated from raw brace depth rather than a control-construct-aware walk,
 *     so it can over-count (e.g. an object literal nested inside a function body adds to the count).
 *     That is a conservative, fail-closed bias (Constitution Rule 4): the fallback is allowed to flag
 *     something the precise acorn engine would not, never the reverse.
 */

// Replace every string/template/comment span with spaces of the same length, preserving newlines, so
// downstream regex/brace scans never mistake string or comment content for code and line numbers stay
// exact (the same trick tools/swallow-gate/check.js's context-aware scan performs implicitly).
function maskNonCode(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const skip = maskOneToken(src, i);
    if (skip) { out += skip.masked; i = skip.next; continue; }
    out += src[i];
    i++;
  }
  return out;
}

// One masking step at position i: a line comment, a block comment, or a quoted/templated string.
// Returns null when none of those start at i (the caller then copies one plain character).
function maskOneToken(src, i) {
  const c = src[i];
  const next = src[i + 1];
  if (c === '/' && next === '/') {
    const nl = src.indexOf('\n', i);
    const end = nl === -1 ? src.length : nl;
    return { masked: ' '.repeat(end - i), next: end };
  }
  if (c === '/' && next === '*') {
    const close = src.indexOf('*/', i + 2);
    const end = close === -1 ? src.length : close + 2;
    return { masked: src.slice(i, end).replace(/[^\n]/g, ' '), next: end };
  }
  if (c === '\'' || c === '"' || c === '`') {
    const end = scanQuoted(src, i, c);
    return { masked: src.slice(i, end).replace(/[^\n]/g, ' '), next: end };
  }
  return null;
}

function scanQuoted(src, start, quote) {
  let j = start + 1;
  while (j < src.length && src[j] !== quote) { if (src[j] === '\\') j++; j++; }
  return Math.min(j + 1, src.length);
}

// Find the index just past the matching close paren/brace for the opener at openIdx, on masked text.
function matchPair(masked, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === openCh) depth++;
    else if (masked[i] === closeCh) { depth--; if (depth === 0) return i + 1; }
  }
  return masked.length;
}

// Scan backward from just before "=>" to find the parameter source text: either a parenthesised list
// (possibly with nested parens/brackets/braces for destructuring/defaults) or a single bare identifier.
function backscanArrowParams(masked, arrowIdx) {
  let j = arrowIdx - 1;
  while (j >= 0 && /\s/.test(masked[j])) j--;
  if (j < 0) return null;
  if (masked[j] === ')') return backscanParenParams(masked, j);
  return backscanBareIdentifier(masked, j);
}

function backscanParenParams(masked, closeParenIdx) {
  let depth = 0;
  let k = closeParenIdx;
  for (; k >= 0; k--) {
    if (masked[k] === ')') depth++;
    else if (masked[k] === '(') { depth--; if (depth === 0) break; }
  }
  if (k < 0) return null;
  return { start: k, paramsText: masked.slice(k + 1, closeParenIdx) };
}

function backscanBareIdentifier(masked, lastIdx) {
  let k = lastIdx;
  while (k >= 0 && /[\w$]/.test(masked[k])) k--;
  if (k === lastIdx) return null;
  return { start: k + 1, paramsText: masked.slice(k + 1, lastIdx + 1) };
}

// Count top-level (paren/bracket/brace-depth-0) comma-separated entries in a parameter list.
function countParams(paramsText) {
  const t = paramsText.trim();
  if (t === '') return 0;
  let depth = 0;
  let count = 1;
  for (const ch of t) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

// Raw brace-depth inside a masked body span, minus the function's own outer block (depth 1).
function braceDepthMetrics(masked, bodyStart, bodyEnd) {
  let depth = 0;
  let maxDepth = 0;
  for (let i = bodyStart; i < bodyEnd; i++) {
    if (masked[i] === '{') { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (masked[i] === '}') depth = Math.max(0, depth - 1);
  }
  return Math.max(0, maxDepth - 1);
}

const DECISION_PATTERNS = [
  /\bif\s*\(/g,
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bcase\b(?!\s*:\s*default)/g,
  /&&/g,
  /\|\|/g,
  /\?(?!\.|\?)/g, // ternary, excluding optional-chaining `?.` and nullish-coalescing `??`
];

function countDecisions(bodyText) {
  let n = 0;
  for (const rx of DECISION_PATTERNS) n += (bodyText.match(rx) || []).length;
  return n;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

// Build one function-metrics record: the shared shape every finder below produces, given the source
// position to report as "line", a display name, an already-counted param total, and the index of the
// body's opening brace (the body's extent is (re)computed here via matchPair, once, in one place).
// ctx = {src, masked} bundles the two read-only inputs every finder already holds, keeping this at
// four parameters rather than five.
function buildRecord(ctx, nameIdx, name, params, bodyOpenBrace) {
  const { src, masked } = ctx;
  const bodyEnd = matchPair(masked, bodyOpenBrace, '{', '}');
  return {
    name,
    line: lineOf(src, nameIdx),
    params,
    lines: lineOf(src, bodyEnd - 1) - lineOf(src, nameIdx) + 1,
    decisions: countDecisions(masked.slice(bodyOpenBrace, bodyEnd)),
    maxDepth: braceDepthMetrics(masked, bodyOpenBrace, bodyEnd),
  };
}

function firstNonSpace(masked, from) {
  let k = from;
  while (k < masked.length && /\s/.test(masked[k])) k++;
  return k;
}

const FN_KEYWORD_RX = /\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g;

function findKeywordFunctions(ctx) {
  const { masked } = ctx;
  const out = [];
  let m;
  FN_KEYWORD_RX.lastIndex = 0;
  while ((m = FN_KEYWORD_RX.exec(masked)) !== null) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchPair(masked, parenOpen, '(', ')');
    const brace = firstNonSpace(masked, parenClose);
    if (masked[brace] !== '{') continue;
    const params = countParams(masked.slice(parenOpen + 1, parenClose - 1));
    out.push(buildRecord(ctx, m.index, m[1] || '(anonymous function)', params, brace));
  }
  return out;
}

function findArrowFunctions(ctx) {
  const { masked } = ctx;
  const out = [];
  const rx = /=>\s*\{/g;
  let m;
  while ((m = rx.exec(masked)) !== null) {
    const paramSrc = backscanArrowParams(masked, m.index);
    if (!paramSrc) continue;
    const braceIdx = masked.indexOf('{', m.index);
    const params = countParams(paramSrc.paramsText.replace(/^\(|\)$/g, ''));
    out.push(buildRecord(ctx, paramSrc.start, '(arrow function)', params, braceIdx));
  }
  return out;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'finally']);
const METHOD_RX = /(^|[,;{}])\s*(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;

function findMethodShorthands(ctx) {
  const { masked } = ctx;
  const out = [];
  let m;
  METHOD_RX.lastIndex = 0;
  while ((m = METHOD_RX.exec(masked)) !== null) {
    const name = m[2];
    if (CONTROL_KEYWORDS.has(name)) continue;
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchPair(masked, parenOpen, '(', ')');
    const brace = firstNonSpace(masked, parenClose);
    if (masked[brace] !== '{') continue;
    const params = countParams(masked.slice(parenOpen + 1, parenClose - 1));
    out.push(buildRecord(ctx, m.index, name, params, brace));
  }
  return out;
}

function scanContentHeuristic(src) {
  const ctx = { src, masked: maskNonCode(src) };
  return [
    ...findKeywordFunctions(ctx),
    ...findArrowFunctions(ctx),
    ...findMethodShorthands(ctx),
  ];
}

module.exports = {
  scanContentHeuristic,
  maskNonCode,
  matchPair,
  backscanArrowParams,
  countParams,
  countDecisions,
  braceDepthMetrics,
};
