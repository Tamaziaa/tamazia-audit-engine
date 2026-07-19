'use strict';
// eval/reality-corpus/lib/yaml.js - a minimal, hand-rolled YAML-subset loader.
//
// WHY NOT A DEPENDENCY: the repo runs zero runtime npm dependencies unless the blueprint says
// otherwise (CONSTITUTION.md scope note, package.json's own devDependencies-only shape). Reaching
// for js-yaml here would be the first runtime dependency the eval/ tooling has ever needed for a
// format this small and fully under our own control, so instead this file implements exactly the
// subset of YAML the corpus files in eval/reality-corpus/sites/*.yml actually use:
//   - block mappings (key: value), 2-space indent per nesting level
//   - block sequences (- item), including sequences of mappings and sequences of scalars
//   - scalars: bare strings, single/double-quoted strings, numbers, true/false/null
//   - comments (# ...) and blank lines, ignored
//   - no anchors, no multi-doc streams, no flow style ([a,b]/{a:b}), no block scalars (|, >)
// A corpus YAML that needs any of the unsupported features will parse wrong or throw; this is a
// deliberate, documented scope limit (see eval/reality-corpus/README.md), not a silent gap: every
// corpus file is validated by eval/reality-corpus/run.js --lint and by node:test fixtures below.

// quoteMask(s) -> boolean[] the same length as s, true at every index that lies INSIDE a single- or
// double-quoted span (the quote characters themselves count as inside). Shared by stripComment() and
// findColon() so both agree on what "inside a quote" means, including a backslash-escaped double quote
// (\") never closing the span (CodeRabbit PR #32: `\"` previously toggled quote state early, so a `#`
// or `:` appearing later in a legitimately-quoted, JSON-style scalar was wrongly treated as unquoted).
// Single-quoted spans use no backslash escaping in this format (a literal quote is written '' -
// parseScalar()'s own concern when it unescapes the matched scalar, not this positional scan).
// stepQuoteState(ch, state) -> the {inSingle, inDouble} state after consuming one non-escape char.
function stepQuoteState(ch, state) {
  if (ch === "'" && !state.inDouble) return { inSingle: !state.inSingle, inDouble: state.inDouble };
  if (ch === '"' && !state.inSingle) return { inSingle: state.inSingle, inDouble: !state.inDouble };
  return state;
}

function quoteMask(s) {
  const mask = new Array(s.length).fill(false);
  let state = { inSingle: false, inDouble: false };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && state.inDouble) {
      mask[i] = true;
      if (i + 1 < s.length) mask[i + 1] = true;
      i++;
      continue;
    }
    state = stepQuoteState(ch, state);
    mask[i] = mask[i] || state.inSingle || state.inDouble;
  }
  return mask;
}

// stripComment(line) -> line with a trailing `# ...` comment removed, unless the `#` lies inside a
// quoted span (a `#` never starts a comment mid-quote). Only a `#` that starts a token (line-start or
// preceded by whitespace) counts as a comment marker - the corpus format never needs a literal
// unquoted '#'.
function stripComment(line) {
  const mask = quoteMask(line);
  for (let i = 0; i < line.length; i++) {
    if (mask[i]) continue;
    if (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

// --- parseScalar() internals, decomposed for CodeScene (each parser below tries ONE scalar class and
// reports whether it matched, so parseScalar() itself is a flat, ordered list of attempts) ---

const NULLISH_SCALARS = new Set(['', '~', 'null', 'Null', 'NULL']);
const TRUE_SCALARS = new Set(['true', 'True', 'TRUE']);
const FALSE_SCALARS = new Set(['false', 'False', 'FALSE']);
const DOUBLE_QUOTED_RX = /^"([^"\\]|\\.)*"$/;
const SINGLE_QUOTED_RX = /^'([^']|'')*'$/;
const NUMBER_RX = /^-?\d+(\.\d+)?$/;
const NO_MATCH = { matched: false, value: undefined };

function matched(value) {
  return { matched: true, value };
}

function parseKeywordScalar(s) {
  if (NULLISH_SCALARS.has(s)) return matched(null);
  if (TRUE_SCALARS.has(s)) return matched(true);
  if (FALSE_SCALARS.has(s)) return matched(false);
  return NO_MATCH;
}

// Flow-style EMPTY collections only ([] / {}) - the one bit of flow style the corpus format allows,
// because "no items" is common enough (known_clean_laws: [], labelled_breaches: []) that forcing an
// empty block sequence (which YAML cannot express - a block sequence needs at least one '- ' line) is
// needless friction. Non-empty flow collections ([a, b], {a: b}) remain out of scope (see file header).
function parseEmptyFlowCollection(s) {
  if (s === '[]') return matched([]);
  if (s === '{}') return matched({});
  return NO_MATCH;
}

function parseQuotedOrNumericScalar(s) {
  if (DOUBLE_QUOTED_RX.test(s)) return matched(JSON.parse(s));
  if (SINGLE_QUOTED_RX.test(s)) return matched(s.slice(1, -1).replace(/''/g, "'"));
  if (NUMBER_RX.test(s)) return matched(Number(s));
  return NO_MATCH;
}

function parseScalar(raw) {
  const s = raw.trim();
  const keyword = parseKeywordScalar(s);
  if (keyword.matched) return keyword.value;
  const flow = parseEmptyFlowCollection(s);
  if (flow.matched) return flow.value;
  const quotedOrNumeric = parseQuotedOrNumericScalar(s);
  if (quotedOrNumeric.matched) return quotedOrNumeric.value;
  return s;
}

function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  return m[1].length;
}

// tokenise(text) -> [{indent, raw}] for every non-blank, non-comment-only line, preserving the
// original (comment-stripped, right-trimmed) content so nested parsing can re-slice it.
function tokenise(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    const stripped = stripComment(line).replace(/\s+$/, '');
    if (stripped.trim() === '') continue;
    out.push({ indent: indentOf(stripped), raw: stripped });
  }
  return out;
}

// parseBlock(tokens, pos, indent) -> [value, nextPos]. Decides mapping vs sequence from the first
// token at this indent level, then consumes every subsequent token at the SAME indent belonging to
// that block, recursing into deeper indents for nested values.
function parseBlock(tokens, pos, indent) {
  if (pos >= tokens.length || tokens[pos].indent < indent) return [null, pos];
  const first = tokens[pos].raw.trim();
  if (first.startsWith('- ') || first === '-') {
    return parseSequence(tokens, pos, indent);
  }
  return parseMapping(tokens, pos, indent);
}

function parseSequence(tokens, pos, indent) {
  const arr = [];
  while (pos < tokens.length && tokens[pos].indent === indent) {
    const trimmed = tokens[pos].raw.trim();
    if (!(trimmed.startsWith('- ') || trimmed === '-')) break;
    const rest = trimmed === '-' ? '' : trimmed.slice(2);
    if (rest === '') {
      // '- ' alone: the item is a nested block on following, deeper-indented lines.
      pos++;
      const [val, next] = parseBlock(tokens, pos, indent + 2);
      arr.push(val);
      pos = next;
      continue;
    }
    const colonMatch = /^([A-Za-z0-9_.\-]+):(\s|$)/.exec(rest);
    if (colonMatch) {
      // '- key: value' starts an inline mapping item; its own indent is treated as indent+2 for the
      // purpose of sibling keys that follow on subsequent, deeper-indented lines.
      const itemIndent = indent + 2;
      const syntheticRaw = ' '.repeat(itemIndent) + rest;
      tokens[pos] = { indent: itemIndent, raw: syntheticRaw };
      const [val, next] = parseMapping(tokens, pos, itemIndent);
      arr.push(val);
      pos = next;
      continue;
    }
    arr.push(parseScalar(rest));
    pos++;
  }
  return [arr, pos];
}

// parseMappingValue(tokens, pos, indent, rest) -> [value, nextPos] for ONE key's value: an inline
// scalar (rest non-empty), a nested block on deeper-indented following lines, or null (nothing follows
// at a deeper indent - an empty mapping value, e.g. "note:" with nothing under it).
function parseMappingValue(tokens, pos, indent, rest) {
  if (rest !== '') return [parseScalar(rest), pos];
  const nextIndent = pos < tokens.length ? tokens[pos].indent : -1;
  if (nextIndent <= indent) return [null, pos];
  return parseBlock(tokens, pos, nextIndent);
}

function parseMapping(tokens, pos, indent) {
  const obj = {};
  while (pos < tokens.length && tokens[pos].indent === indent) {
    const trimmed = tokens[pos].raw.trim();
    if (trimmed.startsWith('- ') || trimmed === '-') break;
    const idx = findColon(trimmed);
    if (idx === -1) throw new Error('eval/reality-corpus/lib/yaml.js: expected "key: value" at "' + trimmed + '"');
    const key = trimmed.slice(0, idx).trim();
    const rest = trimmed.slice(idx + 1).trim();
    pos++;
    const [value, next] = parseMappingValue(tokens, pos, indent, rest);
    obj[key] = value;
    pos = next;
  }
  return [obj, pos];
}

function findColon(s) {
  const mask = quoteMask(s);
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) continue;
    if (s[i] === ':' && (i === s.length - 1 || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}

// parse(text) -> plain JS value (object, usually) for a supported YAML document. FAILS CLOSED
// (CodeRabbit PR #32) if the top-level block does not consume every token: a document that starts
// validly but is followed by a stray, badly-indented (or otherwise unparseable-as-a-sibling) line used
// to parse "successfully" with the trailing content silently ignored - a malformed corpus/harness input
// must throw, not pass lint quietly missing data.
function parse(text) {
  const tokens = tokenise(text);
  if (tokens.length === 0) return null;
  const [val, nextPos] = parseBlock(tokens, 0, tokens[0].indent);
  if (nextPos < tokens.length) {
    const stray = tokens[nextPos];
    throw new Error('eval/reality-corpus/lib/yaml.js: unconsumed/malformed content at indent '
      + stray.indent + ': "' + stray.raw.trim() + '" (every nested value must be indented MORE than '
      + 'its parent, and sibling keys/items must share exactly the same indent as each other)');
  }
  return val;
}

module.exports = { parse };
