'use strict';
// enforcement/collectors/lib/text.js - THE one HTML-to-text stripper shared by every per-source
// parser (Constitution Rule 1). Deliberately dependency-free (zero runtime npm dependencies, per
// the engine's constitution): a small, well-tested regex strip is sufficient for the deterministic,
// known-structure regulator pages this directory parses, and avoids pulling in a DOM/HTML parser
// dependency for a handful of well-behaved government sites.
//
// This is NOT a general-purpose HTML sanitiser (script/style contents are dropped from the OUTPUT
// text but the module makes no security claim about the input); it exists purely to turn a fetched
// regulator page into a whitespace-normalised text stream that per-source regexes can pattern-match
// against, the same way a human reads the rendered page.

// stripHtmlToText(html) -> string. Removes script/style blocks entirely, strips remaining tags,
// unescapes the small set of named/numeric HTML entities these regulator sites actually use, and
// collapses runs of whitespace to single spaces (newlines are preserved as single '\n' so
// line-anchored parsers can still find "label\nvalue" pairs).
function stripHtmlToText(html) {
  if (typeof html !== 'string') throw new TypeError('stripHtmlToText requires a string');
  let text = html;
  // CodeQL js/bad-tag-filter: browsers accept ANY junk between `</script` and the closing `>`
  // (e.g. `</script foo="bar">`, `</script  >`) as a valid end tag - a real-world filter-bypass
  // technique (CWE-116/CWE-184). The closing-tag half of both regexes below must therefore match
  // `[^>]*`, not just optional whitespace, or a script/style body can leak into extracted text.
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = unescapeEntities(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.split('\n').map((line) => line.trim()).join('\n');
  text = text.replace(/\n{2,}/g, '\n');
  return text.trim();
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à',
  pound: '£', euro: '€', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°', times: '×',
};

function unescapeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m));
}

// firstMatch(text, regex) -> the first capture group 1 match, or null. Small helper so per-source
// parsers do not each re-implement "regex.exec then null-guard".
function firstMatch(text, regex) {
  const m = regex.exec(text);
  return m ? m[1] : null;
}

// firstCurlyQuote(text, minLength = 15) -> the first "quoted" span at least minLength chars, or
// null. Regulator ruling pages (ASA in particular) render the verbatim offending advertising copy
// inside quotes; this is the deterministic extraction Discipline 1 of the blueprint requires (a
// verbatim span, never a paraphrase). Curly typographic quotes are tried first (the common case);
// straight quotes are a fallback for pages whose "Ad description" copy was encoded as &quot; (decoded
// to ASCII " by unescapeEntities upstream) rather than rendered with curly marks - without this
// fallback, a page like that skips its own ad copy entirely and returns the first unrelated
// curly-quoted span found elsewhere (a rebuttal or assessment paragraph), which is verbatim but not
// the actual offending text.
function firstCurlyQuote(text, minLength = 15) {
  const curly = firstQuoteMatching(text, /“([^”]{1,400})”/g, minLength);
  if (curly) return curly;
  return firstQuoteMatching(text, /"([^"]{1,400})"/g, minLength);
}

// firstQuoteMatching(text, rx, minLength) -> the first captured span from rx at least minLength
// chars, or null. Shared by both quote styles above so curly and straight follow one rule.
function firstQuoteMatching(text, rx, minLength) {
  let m = rx.exec(text);
  while (m) {
    if (m[1].trim().length >= minLength) return m[1].trim();
    m = rx.exec(text);
  }
  return null;
}

module.exports = { stripHtmlToText, firstMatch, firstCurlyQuote };
