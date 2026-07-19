'use strict';
// evidence/crawler/language.test.js - node:test for the C-022 non-English honesty gate producer.
// Run: node --test evidence/crawler/language.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectLanguage, stopwordDensity, primaryLangSubtag, wordsOf,
  MIN_SAMPLE_WORDS, ENGLISH_DENSITY_FLOOR, CONFIDENT_NON_ENGLISH_CEILING,
} = require('./language.js');

// A realistic-length synthetic English privacy-notice paragraph (not copied from any real site).
const ENGLISH_SAMPLE = Array(10).fill(
  'We are committed to protecting your privacy and your personal data. This notice explains how we ' +
  'collect, use and store the information you provide to us, and the choices you have about how your ' +
  'data is handled. If you have any questions about this notice, please contact us using the details ' +
  'below and we will respond to you as soon as we are able.',
).join(' ');

// A realistic-length synthetic FRENCH privacy-notice paragraph (not copied from any real site;
// hand-written for this fixture only).
const FRENCH_SAMPLE = Array(10).fill(
  'Nous nous engageons a proteger votre vie privee et vos donnees personnelles. Cette notice explique ' +
  'comment nous recueillons, utilisons et conservons les informations que vous nous fournissez, ainsi ' +
  'que les choix dont vous disposez quant a la maniere dont vos donnees sont traitees. Si vous avez des ' +
  'questions au sujet de cette notice, veuillez nous contacter en utilisant les coordonnees ci-dessous.',
).join(' ');

// A realistic-length synthetic GERMAN privacy-notice paragraph (hand-written, not copied).
const GERMAN_SAMPLE = Array(10).fill(
  'Wir setzen uns dafuer ein, Ihre Privatsphaere und Ihre personenbezogenen Daten zu schuetzen. Dieser ' +
  'Hinweis erklaert, wie wir die von Ihnen bereitgestellten Informationen erheben, verwenden und ' +
  'speichern, sowie die Moeglichkeiten, die Sie im Umgang mit Ihren Daten haben. Wenn Sie Fragen zu ' +
  'diesem Hinweis haben, kontaktieren Sie uns bitte ueber die unten stehenden Angaben.',
).join(' ');

// ── wordsOf: Unicode-letter tokenisation, script-agnostic ────────────────────────────────────────────
test('wordsOf: tokenises Latin, accented and Arabic-script runs alike (script-agnostic, C-022)', () => {
  assert.deepEqual(wordsOf('the cat sat'), ['the', 'cat', 'sat']);
  assert.deepEqual(wordsOf('societe francaise'), ['societe', 'francaise']);
  assert.deepEqual(wordsOf(''), []);
  assert.deepEqual(wordsOf(null), []);
  const arabicWords = wordsOf('مرحبا بكم في موقعنا');
  assert.ok(arabicWords.length >= 4, 'space-delimited Arabic script tokenises into real words, not zero');
});

// ── stopwordDensity: the sufficiency floor + the density signal ──────────────────────────────────────
test('stopwordDensity: too little text returns null (Rule 6 - ambiguity never gates)', () => {
  assert.equal(stopwordDensity('the cat sat on the mat'), null, 'a handful of words is below MIN_SAMPLE_WORDS');
  assert.equal(stopwordDensity(''), null);
  assert.equal(stopwordDensity(null), null);
});

test('stopwordDensity: a real English sample clears the English floor; a real French/German sample does not', () => {
  const en = stopwordDensity(ENGLISH_SAMPLE);
  const fr = stopwordDensity(FRENCH_SAMPLE);
  const de = stopwordDensity(GERMAN_SAMPLE);
  assert.ok(en !== null && en >= ENGLISH_DENSITY_FLOOR, 'English sample density=' + en + ' must clear the floor ' + ENGLISH_DENSITY_FLOOR);
  assert.ok(fr !== null && fr <= CONFIDENT_NON_ENGLISH_CEILING, 'French sample density=' + fr + ' must sit at/under the non-English ceiling ' + CONFIDENT_NON_ENGLISH_CEILING);
  assert.ok(de !== null && de <= CONFIDENT_NON_ENGLISH_CEILING, 'German sample density=' + de + ' must sit at/under the non-English ceiling ' + CONFIDENT_NON_ENGLISH_CEILING);
});

// ── primaryLangSubtag ──────────────────────────────────────────────────────────────────────────────
test('primaryLangSubtag: extracts the primary BCP-47 subtag, empty/malformed -> ""', () => {
  assert.equal(primaryLangSubtag('fr-FR'), 'fr');
  assert.equal(primaryLangSubtag('en-GB'), 'en');
  assert.equal(primaryLangSubtag('DE'), 'de');
  assert.equal(primaryLangSubtag(''), '');
  assert.equal(primaryLangSubtag('not a tag'), '');
  assert.equal(primaryLangSubtag(undefined), '');
});

// ── detectLanguage: the combining door, with explicit POSITIVE and NEGATIVE controls ─────────────────
test('POSITIVE CONTROL: a French sample page (correct or missing html lang) resolves to a non-English tag', () => {
  assert.equal(detectLanguage({ htmlLang: 'fr-FR', text: FRENCH_SAMPLE }), 'fr');
  assert.equal(detectLanguage({ htmlLang: '', text: FRENCH_SAMPLE }), 'und', 'no declared tag but the text is confidently non-English -> the honest generic marker');
});

test('POSITIVE CONTROL: a German sample page resolves to a non-English tag', () => {
  assert.equal(detectLanguage({ htmlLang: 'de', text: GERMAN_SAMPLE }), 'de');
});

test('POSITIVE CONTROL: a WRONGLY lang-tagged page (declares "en", prose is French) still resolves non-English - the text signal wins (C-022)', () => {
  assert.equal(detectLanguage({ htmlLang: 'en', text: FRENCH_SAMPLE }), 'und', 'a self-declared "en" tag cannot override what the prose actually says');
});

test('NEGATIVE CONTROL: a genuine English sample page resolves to "en" regardless of a missing/odd tag', () => {
  assert.equal(detectLanguage({ htmlLang: 'en-GB', text: ENGLISH_SAMPLE }), 'en');
  assert.equal(detectLanguage({ htmlLang: '', text: ENGLISH_SAMPLE }), 'en', 'the text itself is enough; a declared tag is not required to pass');
});

test('NEGATIVE CONTROL (conservative default): too little text or an ambiguous density never gates - undefined, not a guess', () => {
  assert.equal(detectLanguage({ htmlLang: 'fr', text: 'Bonjour' }), undefined, 'a thin sample stays unknown even with a foreign-looking tag');
  assert.equal(detectLanguage({}), undefined);
  assert.equal(detectLanguage(), undefined);
});

test('MIN_SAMPLE_WORDS is a real, non-zero floor (self-check that the fixtures above are not accidentally exempt from it)', () => {
  assert.ok(MIN_SAMPLE_WORDS > 0);
  assert.ok(wordsOf(ENGLISH_SAMPLE).length > MIN_SAMPLE_WORDS, 'the English fixture is long enough to be a real (non-trivial) sample');
  assert.ok(wordsOf(FRENCH_SAMPLE).length > MIN_SAMPLE_WORDS, 'the French fixture is long enough to be a real (non-trivial) sample');
});
