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

function stripComment(line) {
  // Only strips a # that starts a token outside of any quotes (the corpus format never needs a
  // literal '#' inside an unquoted scalar; quoted scalars are handled before this is called).
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  // Flow-style EMPTY collections only ([] / {}) - the one bit of flow style the corpus format allows,
  // because "no items" is common enough (known_clean_laws: [], labelled_breaches: []) that forcing an
  // empty block sequence (which YAML cannot express - a block sequence needs at least one '- ' line) is
  // needless friction. Non-empty flow collections ([a, b], {a: b}) remain out of scope (see file header).
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (/^"([^"\\]|\\.)*"$/.test(s)) return JSON.parse(s);
  if (/^'([^']|'')*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
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
    if (rest === '') {
      const nextIndent = pos < tokens.length ? tokens[pos].indent : -1;
      if (nextIndent > indent) {
        const [val, next] = parseBlock(tokens, pos, nextIndent);
        obj[key] = val;
        pos = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(rest);
    }
  }
  return [obj, pos];
}

function findColon(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble && (i === s.length - 1 || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}

// parse(text) -> plain JS value (object, usually) for a supported YAML document.
function parse(text) {
  const tokens = tokenise(text);
  if (tokens.length === 0) return null;
  const [val] = parseBlock(tokens, 0, tokens[0].indent);
  return val;
}

module.exports = { parse };
