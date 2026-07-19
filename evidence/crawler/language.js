'use strict';
/**
 * evidence/crawler/language.js - the ONE producer of corpus.language (Constitution Rule 1; caution.md
 * C-022; repetition-audit-2026-07-19.md DG-04b; hidden-defects.md RANK 6).
 *
 * THE DEFECT THIS CLOSES: breach/proposers/propose.js's isNonEnglishGated() reads bundle.corpus.language
 * and bundle.compliance_unassessed - a real, correctly-written consumer - but grep proved NEITHER field
 * was ever ASSIGNED anywhere in facts/, evidence/ or mint/ (only in comments). So a genuinely non-English
 * site ran English-anchored detection patterns, matched almost nothing, and rendered as a near-clean
 * audit instead of the honest "unassessed" - the exact caution.md C-022 pathology in new clothes
 * ("Sixteen non-English pages fed English disclosure regexes and fabricated a 16-breach GDPR cascade").
 * This module is the missing producer, wired at crawl.js's ONE corpus-assembly door.
 *
 * A LIGHTWEIGHT, DEPENDENCY-FREE, TWO-SIGNAL classifier (deliberately "cheap", not an NLP library):
 *   (1) the page's own <html lang> declaration (extract.extractHtmlLang) - present but NOT trusted
 *       alone, because a site can self-declare "en" while its prose is French (the exact
 *       "wrongly lang-tagged" case caution.md C-022 also names);
 *   (2) a stopword-density check on the ACTUAL crawled text: a small, curated set of extremely common
 *       English function words ("the", "and", "you", ...) that are near-universal across English prose
 *       of any register and rare-to-absent as WHOLE WORDS in the other Latin/Arabic/Cyrillic-script
 *       languages this campaign targets (the UAE priority market among them - LAW-COVERAGE-MAP /
 *       CLAUDE.md). Word tokenisation uses \p{L}+ (Unicode letter runs), which works for ANY
 *       space-delimited script (Latin European languages, Arabic, Cyrillic, Hebrew); it does NOT
 *       segment scriptio-continua scripts (Chinese/Japanese, which use no inter-word spacing) into
 *       real "words", so a purely CJK corpus falls through the sufficiency floor to "unknown, do not
 *       gate" rather than a confident tag - a documented, honestly-scoped residual limit of a CHEAP
 *       heuristic, not a claim of universal script coverage.
 *
 * CONSERVATIVE BY DESIGN (Constitution Rule 6: ambiguity defaults to withholding the accusation - here
 * applied to the ABSTENTION itself, not just a breach). Three outcomes, not two:
 *   - confidently English            -> 'en'        (isNonEnglishGated does NOT fire)
 *   - confidently NOT English        -> a language tag (isNonEnglishGated FIRES, propose() asserts [])
 *   - too little text / ambiguous    -> undefined    (isNonEnglishGated does NOT fire - unknown never
 *                                                      gates a real audit into a false "unassessed")
 * Pure and synchronous: no network, no clock, no environment.
 */

// A small, dependency-free set of extremely common English function words. Chosen for being
// (a) near-universal across English prose of any register (legal, marketing, technical) and
// (b) absent or rare as WHOLE WORDS in French/German/Spanish/Italian/Portuguese/Dutch/Arabic prose, so
// the density check is a real discriminator, not a coincidence of shared vocabulary. Matched as whole
// \p{L}+ tokens (exact Set membership), never a substring (caution.md C-059's word-boundary discipline).
const ENGLISH_STOPWORDS = Object.freeze([
  'the', 'and', 'you', 'your', 'for', 'with', 'this', 'that', 'are', 'have',
  'from', 'will', 'not', 'our', 'about', 'is', 'to', 'of', 'in', 'we',
]);

const MIN_SAMPLE_WORDS = 60;        // below this the density estimate is too noisy either way (Rule 6).
const SAMPLE_CHAR_CAP = 20000;      // a cheap heuristic reads a bounded sample; a CAP, never a floor (Rule 8).
const ENGLISH_DENSITY_FLOOR = 0.02; // >=2% of tokens are common English stopwords -> reads as English.
const CONFIDENT_NON_ENGLISH_CEILING = 0.005; // <=0.5% -> confidently NOT English prose.

const STOPWORD_SET = new Set(ENGLISH_STOPWORDS);

// wordsOf(text) -> Unicode letter/number runs, lowercased. \p{L}/\p{N} (not \w, which is ASCII-only)
// so an accented or non-Latin word tokenises as ONE token rather than fragmenting at every diacritic or
// disappearing entirely - the same "no Unicode folding" class caution.md/hidden-defects.md flags
// elsewhere in this engine (H22/H23), avoided here on purpose.
function wordsOf(text) {
  const m = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return m || [];
}

// stopwordDensity(text) -> the fraction of tokens that are one of ENGLISH_STOPWORDS, over a bounded
// sample, or null when the sample carries too little tokenisable text to trust either direction.
function stopwordDensity(text) {
  const sample = String(text || '').slice(0, SAMPLE_CHAR_CAP);
  const words = wordsOf(sample);
  if (words.length < MIN_SAMPLE_WORDS) return null;
  let hits = 0;
  for (const w of words) if (STOPWORD_SET.has(w)) hits++;
  return hits / words.length;
}

// primaryLangSubtag(raw) -> the lowercased primary subtag of a BCP-47-shaped value ('fr' from 'fr-FR'),
// or '' when raw is empty/malformed. A light shape check (mirrors dom-assert-predicates.js's VALID_LANG,
// including its 2-OR-3-letter primary subtag width - ISO 639-2/3 alpha-3 codes like "fil"/"yue" are
// valid too), kept as an independent copy on purpose: that module grades a live-DOM signal, this one
// grades a fetched-HTML signal, and the two lanes stay independently testable without importing a
// browser-only module.
const LANG_TAG_RX = /^([a-z]{2,3})(?:-[A-Za-z0-9]+)*$/i;
function primaryLangSubtag(raw) {
  const m = LANG_TAG_RX.exec(String(raw || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * detectLanguage({ htmlLang, text }) -> string|undefined.
 *   htmlLang  the raw <html lang="..."> attribute value (extract.extractHtmlLang output), '' if absent.
 *   text      a representative sample of the crawled corpus text (the caller may pass the full
 *             concatenated corpus; this module bounds its own read via SAMPLE_CHAR_CAP).
 *
 * Returns the resolved corpus.language value, or undefined when the classification is not confident
 * enough to act on (Rule 6: unknown never gates). The TEXT signal always wins over the declared tag -
 * a page cannot self-certify its way out of what its own prose says (the "wrongly lang-tagged" case).
 */
function detectLanguage({ htmlLang, text } = {}) {
  const density = stopwordDensity(text);
  if (density === null) return undefined; // too little text to trust either signal.
  if (density >= ENGLISH_DENSITY_FLOOR) return 'en';
  if (density <= CONFIDENT_NON_ENGLISH_CEILING) {
    const tag = primaryLangSubtag(htmlLang);
    // the declared tag is used when it CORROBORATES (itself non-English); a missing or self-contradicting
    // tag (declared "en" while the text reads as confidently not-English) falls back to an honest generic
    // non-English marker rather than a guessed specific language.
    return tag && tag !== 'en' ? tag : 'und';
  }
  return undefined; // the ambiguous middle band: not confident either way (Rule 6).
}

module.exports = {
  detectLanguage,
  stopwordDensity,
  primaryLangSubtag,
  wordsOf,
  ENGLISH_STOPWORDS,
  MIN_SAMPLE_WORDS,
  SAMPLE_CHAR_CAP,
  ENGLISH_DENSITY_FLOOR,
  CONFIDENT_NON_ENGLISH_CEILING,
};
